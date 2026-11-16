import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';

type Client = Awaited<ReturnType<typeof setupSchool>>['principal'];

beforeEach(async () => {
  await resetDb();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.${Math.random()}` }] }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

async function school(principal: Client) {
  await principal.post('/api/setup/sessions', { name: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31', isCurrent: true });
  for (const name of ['Class 4', 'Class 5', 'Class 6']) await principal.post('/api/setup/classes', { name, sections: ['A', 'B'] });
  await principal.post('/api/setup/subjects', { names: ['English', 'Maths'] });
  const s = (await principal.get('/api/setup/structure')).body;
  const [c4, c5, c6] = s.classes;
  const add = async (name: string, c: { id: string; sections: { id: string; name: string }[] }, sec: string) =>
    (await principal.post('/api/students', { student: { fullName: name, gender: 'MALE', classId: c.id, sectionId: c.sections.find((x) => x.name === sec)!.id, dob: '2015-01-01' }, guardians: [{ relation: 'FATHER', fullName: `${name} Sr`, phone: `0300${Math.floor(1000000 + Math.random() * 8999999)}` }] })).body.studentId as string;
  return { s, c4, c5, c6, add, english: s.subjects.find((x: { name: string }) => x.name === 'English').id, maths: s.subjects.find((x: { name: string }) => x.name === 'Maths').id };
}

describe('teacher enrollment', () => {
  it('saves full bio data with qualifications and specialist subjects', async () => {
    const { principal } = await setupSchool();
    const { english, maths } = await school(principal);
    const r = await principal.post('/api/staff', {
      fullName: 'Sana Iqbal',
      role: 'TEACHER',
      email: 'sana@example.com',
      phone: '03001234567',
      profile: {
        designation: 'Senior Teacher',
        cnic: '3520212345671',
        gender: 'FEMALE',
        guardianName: 'Iqbal Ahmed',
        maritalStatus: 'MARRIED',
        bloodGroup: 'B+',
        qualifications: [{ degree: 'M.Sc Mathematics', institute: 'University of the Punjab', year: 2014, grade: 'A' }, { degree: 'B.Ed', institute: 'AIOU', year: 2016 }],
        experienceYears: 8,
        previousEmployer: 'Beaconhouse',
        specialistSubjectIds: [maths],
        specialization: 'O-Level Mathematics',
        joiningDate: '2026-04-01',
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.username).toMatch(/^alpha\.e\d+$/);
    expect(r.body.tempPassword).toBeTruthy();
    const p = await prisma.staffProfile.findFirstOrThrow({ where: { userId: r.body.id ?? r.body.userId } });
    expect(p).toMatchObject({ maritalStatus: 'MARRIED', bloodGroup: 'B+', experienceYears: 8, specialistSubjectIds: [maths] });
    expect((p.qualifications as unknown[]).length).toBe(2);
    // Can log in with email too
    await prisma.user.update({ where: { email: 'sana@example.com' }, data: { mustChangePassword: false } });
    expect((await login('sana@example.com', r.body.tempPassword)).agent).toBeTruthy();
    // Unknown subject rejected; editing specialist subjects works
    expect((await principal.post('/api/staff', { fullName: 'X Y', role: 'TEACHER', profile: { specialistSubjectIds: ['nope'] } })).status).toBe(400);
    const id = p.userId;
    expect((await principal.patch(`/api/staff/${id}`, { profile: { specialistSubjectIds: [maths, english] } })).status).toBe(200);
    expect((await prisma.staffProfile.findFirstOrThrow({ where: { userId: id } })).specialistSubjectIds).toEqual([maths, english]);
  });
});

describe('admissions pipeline', () => {
  it('enquiry → follow-up → test → admit links the new student', async () => {
    const { principal } = await setupSchool();
    const { c5 } = await school(principal);
    const e = await principal.post('/api/admissions/enquiries', { childName: 'Bilal Ahmed', parentName: 'Ahmed Khan', phone: '03009998887', classId: c5.id, source: 'REFERRAL', followUpDate: '2026-11-20', note: 'Called, wants a visit on Friday' });
    expect(e.status).toBe(201);
    expect(e.body.enquiryNo).toBe(1);
    await principal.post(`/api/admissions/enquiries/${e.body.id}/notes`, { text: 'Visited the school', followUpDate: '2026-11-25' });
    await principal.patch(`/api/admissions/enquiries/${e.body.id}`, { testAt: '2026-11-26T09:00:00Z', testTotal: 50 });
    expect((await principal.get(`/api/admissions/enquiries/${e.body.id}`)).body.enquiry.stage).toBe('TEST');
    expect((await principal.patch(`/api/admissions/enquiries/${e.body.id}`, { testMarks: 60 })).status).toBe(400);
    await principal.patch(`/api/admissions/enquiries/${e.body.id}`, { testMarks: 41, stage: 'PASSED' });
    expect((await principal.patch(`/api/admissions/enquiries/${e.body.id}`, { stage: 'ADMITTED' })).status).toBe(400);
    const list = (await principal.get('/api/admissions/enquiries?stage=OPEN')).body;
    expect(list.enquiries[0]).toMatchObject({ childName: 'Bilal Ahmed', stage: 'PASSED', testMarks: 41, classLabel: 'Class 5' });
    expect(list.month.bySource.REFERRAL).toBe(1);
    // Admit
    const st = await principal.post('/api/students', { enquiryId: e.body.id, student: { fullName: 'Bilal Ahmed', gender: 'MALE', classId: c5.id, dob: '2016-02-02' }, guardians: [{ relation: 'FATHER', fullName: 'Ahmed Khan', phone: '03009998887' }] });
    expect(st.status).toBe(201);
    const after = (await principal.get(`/api/admissions/enquiries/${e.body.id}`)).body.enquiry;
    expect(after).toMatchObject({ stage: 'ADMITTED', studentId: st.body.studentId });
    expect((await principal.post('/api/students', { enquiryId: e.body.id, student: { fullName: 'Again', gender: 'MALE', classId: c5.id }, guardians: [] })).status).toBe(400);
    // Permission
    await createUser({ role: 'TEACHER', username: 'tt', schoolId: (await prisma.school.findFirstOrThrow()).id });
    expect((await (await login('tt')).get('/api/admissions/enquiries')).status).toBe(403);
  });
});

describe('withdrawal and leaving certificate', () => {
  it('needs fee clearance (or a principal waiver), then issues the certificate and marks the student as left', async () => {
    const { principal, schoolId } = await setupSchool();
    const { c5, add } = await school(principal);
    const ali = await add('Ali', c5, 'A');
    const fam = await prisma.student.findUniqueOrThrow({ where: { id: ali } });
    await prisma.feeInvoice.create({ data: { schoolId, studentId: ali, familyId: fam.familyId, invoiceNo: 'INV-1', period: '2026-10', title: 'October fee', issueDate: new Date('2026-10-01'), dueDate: new Date('2026-10-10'), total: 3000, lines: { create: [{ kind: 'MONTHLY', description: 'Tuition', amount: 3000 }] } } });
    const w = await principal.post('/api/withdrawals', { studentId: ali, reason: 'Family moving to Karachi', leavingDate: '2026-11-30' });
    expect(w.status).toBe(201);
    expect((await principal.post('/api/withdrawals', { studentId: ali, reason: 'again', leavingDate: '2026-11-30' })).status).toBe(409);
    expect((await principal.get(`/api/withdrawals/${w.body.id}`)).body.dues.total).toBe(3000);
    const blocked = await principal.post(`/api/withdrawals/${w.body.id}/complete`, {});
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/3000/);
    // Office staff cannot waive
    await createUser({ role: 'STAFF', username: 'clerk', schoolId, permissions: ['students.manage', 'students.view'] });
    const clerk = await login('clerk');
    expect((await clerk.post(`/api/withdrawals/${w.body.id}/waive`, { reason: 'x1' })).status).toBe(403);
    expect((await principal.post(`/api/withdrawals/${w.body.id}/waive`, { reason: 'Hardship' })).body.waived).toBe(3000);
    expect((await prisma.feeInvoice.findFirstOrThrow({ where: { studentId: ali } })).status).toBe('PAID');
    const done = await clerk.post(`/api/withdrawals/${w.body.id}/complete`, { conduct: 'Very good' });
    expect(done.body.certificateNo).toBe(1);
    const st = await prisma.student.findUniqueOrThrow({ where: { id: ali } });
    expect(st.status).toBe('LEFT');
    const cert = (await principal.get(`/api/withdrawals/${w.body.id}/certificate`)).body.certificate;
    expect(cert).toMatchObject({ no: 1, studentName: 'Ali', fatherName: 'Ali Sr', classAtLeaving: 'Class 5 A', conduct: 'Very good', reason: 'Family moving to Karachi', leavingDate: '2026-11-30' });
    // Student and parent logins are switched off
    const logins = await prisma.user.findMany({ where: { id: { in: [st.userId!] } } });
    expect(logins.every((u) => !u.isActive)).toBe(true);
  });
});

describe('session closing', () => {
  it('promotes, retains failed students, graduates the last class, starts the new session and raises fees', async () => {
    const { principal, schoolId } = await setupSchool();
    const { c4, c5, c6, add } = await school(principal);
    const a = await add('Ahmad', c4, 'B');
    const b = await add('Bina', c5, 'A');
    const c = await add('Chand', c5, 'A');
    const d = await add('Dawood', c6, 'A');
    // Chand failed the final exam of this session.
    const session = await prisma.academicSession.findFirstOrThrow({ where: { schoolId, isCurrent: true } });
    const type = (await principal.get('/api/exams/settings')).body.types.find((t: { kind: string }) => t.kind === 'EXAM');
    const asmt = await prisma.assessment.create({ data: { schoolId, kind: 'EXAM', typeId: type.id, title: 'Final 2026', sessionId: session.id, classId: c5.id, status: 'PUBLISHED', publishedAt: new Date(), createdById: (await prisma.user.findFirstOrThrow({ where: { role: 'PRINCIPAL' } })).id } });
    await prisma.studentResult.createMany({ data: [{ schoolId, assessmentId: asmt.id, studentId: b, obtained: 80, total: 100, percent: 80, grade: 'A', passed: true }, { schoolId, assessmentId: asmt.id, studentId: c, obtained: 20, total: 100, percent: 20, grade: 'F', passed: false }] });
    const head = await prisma.feeHead.create({ data: { schoolId, name: 'Tuition', frequency: 'MONTHLY' } as never });
    await prisma.classFee.create({ data: { classId: c5.id, headId: head.id, amount: 3000 } });

    const plan = (await principal.get('/api/promotion/plan')).body;
    expect(plan.current.name).toBe('2025-26');
    const p5 = plan.classes.find((x: { id: string }) => x.id === c5.id);
    expect(p5.suggestedTargetClassId).toBe(c6.id);
    expect(p5.students.map((s: { fullName: string; suggested: string }) => [s.fullName, s.suggested]).sort()).toEqual([['Bina', 'PROMOTE'], ['Chand', 'RETAIN']]);
    expect(plan.classes.find((x: { id: string }) => x.id === c6.id).students[0].suggested).toBe('GRADUATE');

    const body = {
      newSession: { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' },
      feeIncreasePercent: 10,
      classes: plan.classes.map((k: { id: string; suggestedTargetClassId: string | null; students: { id: string; suggested: string }[] }) => ({ classId: k.id, targetClassId: k.suggestedTargetClassId, students: k.students.map((s) => ({ studentId: s.id, action: s.suggested })) })),
    };
    // Every active student needs a decision
    expect((await principal.post('/api/promotion/run', { ...body, classes: body.classes.slice(1) })).status).toBe(400);
    const r = await principal.post('/api/promotion/run', body);
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ PROMOTE: 2, RETAIN: 1, GRADUATE: 1 });
    const now = await prisma.student.findMany({ where: { id: { in: [a, b, c, d] } }, include: { class: true, section: true } });
    const where = (id: string) => now.find((x) => x.id === id)!;
    expect([where(a).class.name, where(a).section?.name]).toEqual(['Class 5', 'B']); // same section name
    expect(where(b).class.name).toBe('Class 6');
    expect(where(c).class.name).toBe('Class 5');
    expect(where(d).status).toBe('GRADUATED');
    expect((await prisma.academicSession.findFirstOrThrow({ where: { schoolId, isCurrent: true } })).name).toBe('2026-27');
    expect(Number((await prisma.classFee.findFirstOrThrow({ where: { classId: c5.id } })).amount)).toBe(3300);
    // Cannot close the same session twice; teachers cannot run it
    expect((await principal.get('/api/promotion/plan')).body.alreadyPromoted).toBe(false); // the new session has not been closed
    expect((await principal.post('/api/promotion/run', { ...body, newSession: { name: '2027-28', startDate: '2026-05-01', endDate: '2027-04-30' } })).status).toBe(400);
    // Academic history shows both sessions
    const h = (await principal.get(`/api/history/students/${c}`)).body;
    expect(h.sessions.map((s: { session: { name: string }; classLabel: string; outcome: string | null }) => [s.session.name, s.classLabel, s.outcome])).toEqual([
      ['2026-27', 'Class 5 A', null],
      ['2025-26', 'Class 5 A', 'RETAIN'],
    ]);
    expect(h.sessions[1].exams[0]).toMatchObject({ title: 'Final 2026', passed: false });
  });
});
