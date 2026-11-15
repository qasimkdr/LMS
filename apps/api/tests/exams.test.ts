import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';
import { rank } from '../src/services/exams';
import { processOutbox } from '../src/services/messaging';

type Client = Awaited<ReturnType<typeof setupSchool>>['principal'];

beforeEach(async () => {
  await resetDb();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('/messages') ? { messages: [{ id: `wamid.${Math.random()}` }] } : { display_phone_number: '1', verified_name: 'x' }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

/** Class 5 (sections A, B), English + Maths; t1 teaches English in A, t2 Maths in A, t1 is class teacher of A. */
async function examSchool(principal: Client, schoolId: string) {
  await principal.post('/api/setup/sessions', { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
  await principal.post('/api/setup/classes', { name: 'Class 5', sections: ['A', 'B'] });
  await principal.post('/api/setup/subjects', { names: ['English', 'Maths'] });
  let s = (await principal.get('/api/setup/structure')).body;
  const cls = s.classes[0];
  const sub = (n: string) => s.subjects.find((x: { name: string }) => x.name === n).id;
  await principal.put(`/api/setup/classes/${cls.id}/subjects`, { subjects: [{ subjectId: sub('English') }, { subjectId: sub('Maths') }] });
  s = (await principal.get('/api/setup/structure')).body;
  const secA = cls.sections.find((x: { name: string }) => x.name === 'A').id;
  const secB = cls.sections.find((x: { name: string }) => x.name === 'B').id;
  const t1 = await createUser({ role: 'TEACHER', username: 't1', schoolId });
  const t2 = await createUser({ role: 'TEACHER', username: 't2', schoolId });
  await principal.put('/api/setup/assignments', { sectionId: secA, subjectId: sub('English'), teacherId: t1.id });
  await principal.put('/api/setup/assignments', { sectionId: secA, subjectId: sub('Maths'), teacherId: t2.id });
  await principal.patch(`/api/setup/sections/${secA}`, { classTeacherId: t1.id });
  const add = async (name: string, sectionId: string, phone: string) =>
    (await principal.post('/api/students', { student: { fullName: name, gender: 'MALE', classId: cls.id, sectionId, dob: '2015-01-01' }, guardians: [{ relation: 'FATHER', fullName: `${name} Sr`, phone }] })).body;
  const ali = await add('Ali', secA, '03001110001');
  const bilal = await add('Bilal', secA, '03001110002');
  const cyra = await add('Cyra', secA, '03001110003');
  const dani = await add('Dani', secB, '03001110004');
  return { cls, secA, secB, english: sub('English'), maths: sub('Maths'), t1, t2, ali, bilal, cyra, dani };
}

describe('ranking', () => {
  it('ties share a position', () => {
    const r = rank([{ p: 90 }, { p: 80 }, { p: 90 }, { p: 70 }], (x) => x.p);
    expect([...r.values()].sort()).toEqual([1, 1, 3, 4]);
  });
});

describe('class tests', () => {
  it('ready-made and custom test types; teachers only test their own subjects', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, english, maths } = await examSchool(principal, schoolId);
    const set = (await principal.get('/api/exams/settings')).body;
    expect(set.types.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['Weekly test', 'Monthly test', 'Mid-term', 'Final / Annual']));
    expect(set.settings.passPercent).toBe(33);

    const t1 = await login('t1');
    const custom = await t1.post('/api/exams/tests', { newTypeName: 'Spelling bee', sectionId: secA, subjectId: english, title: 'Spelling round 1', date: '2026-11-10', totalMarks: 20 });
    expect(custom.status).toBe(201);
    expect(await prisma.assessmentType.count({ where: { name: 'Spelling bee', kind: 'TEST' } })).toBe(1);
    const weekly = set.types.find((t: { name: string }) => t.name === 'Weekly test').id;
    expect((await t1.post('/api/exams/tests', { typeId: weekly, sectionId: secA, subjectId: english, title: 'Week 1', date: '2026-11-10', totalMarks: 25 })).status).toBe(201);
    // t2 teaches Maths only; t1 is class teacher so may also test Maths.
    const t2 = await login('t2');
    expect((await t2.post('/api/exams/tests', { typeId: weekly, sectionId: secA, subjectId: english, title: 'Not mine', date: '2026-11-10', totalMarks: 10 })).status).toBe(403);
    expect((await t1.post('/api/exams/tests', { typeId: weekly, sectionId: secA, subjectId: maths, title: 'Maths w1', date: '2026-11-10', totalMarks: 10 })).status).toBe(201);
    // Teachers cannot create exam types.
    expect((await t1.post('/api/exams/types', { name: 'Big exam', kind: 'EXAM' })).status).toBe(403);
  });

  it('marks entry, submit, principal approval and publish; parents see results only after publishing', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, english, ali, bilal, cyra } = await examSchool(principal, schoolId);
    const t1 = await login('t1');
    const types = (await t1.get('/api/exams/settings')).body.types;
    const test = await t1.post('/api/exams/tests', { typeId: types[0].id, sectionId: secA, subjectId: english, title: 'Week 1', date: '2026-11-10', totalMarks: 25 });
    const paperId = test.body.paperId;
    expect((await t1.put(`/api/exams/papers/${paperId}/sheet`, { sectionId: secA, marks: [{ studentId: ali.studentId, marks: 30 }] })).status).toBe(400); // over total
    await t1.put(`/api/exams/papers/${paperId}/sheet`, { sectionId: secA, marks: [{ studentId: ali.studentId, marks: 22 }, { studentId: bilal.studentId, marks: 22 }] });
    expect((await t1.post(`/api/exams/papers/${paperId}/sheet/submit`, { sectionId: secA })).body.error.message).toMatch(/1 missing/);
    await t1.put(`/api/exams/papers/${paperId}/sheet`, { sectionId: secA, marks: [{ studentId: cyra.studentId, marks: null, isAbsent: true }] });
    expect((await t1.post(`/api/exams/papers/${paperId}/sheet/submit`, { sectionId: secA })).body.status).toBe('SUBMITTED');
    // Locked for the teacher now.
    expect((await t1.put(`/api/exams/papers/${paperId}/sheet`, { sectionId: secA, marks: [{ studentId: ali.studentId, marks: 25 }] })).status).toBe(403);
    expect(await prisma.notification.count({ where: { type: 'MARKS' } })).toBe(1);

    const parentLogin = ali.logins.find((l: { role: string }) => l.role === 'PARENT');
    await prisma.user.update({ where: { username: parentLogin.username }, data: { mustChangePassword: false } });
    const parent = await login(parentLogin.username, parentLogin.tempPassword);
    expect((await parent.get('/api/results/my')).body.children[0].rows).toHaveLength(0);

    expect((await principal.post(`/api/exams/${test.body.id}/publish`)).status).toBe(200);
    const res = (await principal.get(`/api/exams/${test.body.id}/results`)).body;
    const ranks = Object.fromEntries(res.rows.map((r: { student: { fullName: string }; positionSection: number }) => [r.student.fullName, r.positionSection]));
    expect(ranks).toEqual({ Ali: 1, Bilal: 1, Cyra: 3 });
    const mine = (await parent.get('/api/results/my')).body.children[0];
    expect(mine.rows[0]).toMatchObject({ title: 'Week 1', obtained: 22, total: 25, percent: 88, grade: 'A' });
    expect(mine.testMonths[0]).toMatchObject({ month: '2026-11', tests: 1, average: 88 });
  });

  it('schools can let teachers publish class tests directly', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, english, ali, bilal, cyra } = await examSchool(principal, schoolId);
    await principal.put('/api/exams/settings', { testsNeedApproval: false });
    const t1 = await login('t1');
    const types = (await t1.get('/api/exams/settings')).body.types;
    const test = await t1.post('/api/exams/tests', { typeId: types[0].id, sectionId: secA, subjectId: english, title: 'Quick', date: '2026-11-10', totalMarks: 10 });
    await t1.put(`/api/exams/papers/${test.body.paperId}/sheet`, { sectionId: secA, marks: [ali, bilal, cyra].map((s, i) => ({ studentId: s.studentId, marks: 5 + i })) });
    const sub = await t1.post(`/api/exams/papers/${test.body.paperId}/sheet/submit`, { sectionId: secA });
    expect(sub.body).toMatchObject({ status: 'APPROVED', published: true });
    expect((await prisma.assessment.findUniqueOrThrow({ where: { id: test.body.id } })).status).toBe('PUBLISHED');
  });
});

describe('term exams', () => {
  async function makeExam(principal: Client, classId: string) {
    const types = (await principal.get('/api/exams/settings')).body.types;
    const mid = types.find((t: { name: string }) => t.name === 'Mid-term').id;
    const r = await principal.post('/api/exams', { typeId: mid, title: 'Mid-term 2026', classIds: [classId], totalMarks: 100, startDate: '2026-10-01' });
    expect(r.status).toBe(201);
    const id = r.body.ids[0];
    return { id, detail: (await principal.get(`/api/exams/${id}`)).body };
  }

  it('creates papers per subject with a date sheet; each teacher enters their subject; principal returns and approves', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, english, maths, ali, bilal, cyra } = await examSchool(principal, schoolId);
    const { id, detail } = await makeExam(principal, cls.id);
    expect(detail.papers).toHaveLength(2);
    expect(detail.papers[0].sheets).toHaveLength(2); // sections A and B
    expect(detail.papers.find((p: { subject: string }) => p.subject === 'English').sheets.find((s: { section: string }) => s.section === 'A').teacher.fullName).toBe('t1');
    const engPaper = detail.papers.find((p: { subjectId: string }) => p.subjectId === english).id;
    const mathPaper = detail.papers.find((p: { subjectId: string }) => p.subjectId === maths).id;

    const t1 = await login('t1');
    const t2 = await login('t2');
    expect((await t1.put(`/api/exams/papers/${mathPaper}/sheet`, { sectionId: secA, marks: [{ studentId: ali.studentId, marks: 50 }] })).status).toBe(403);
    await t1.put(`/api/exams/papers/${engPaper}/sheet`, { sectionId: secA, marks: [{ studentId: ali.studentId, marks: 90 }, { studentId: bilal.studentId, marks: 40 }, { studentId: cyra.studentId, marks: 70 }] });
    await t1.post(`/api/exams/papers/${engPaper}/sheet/submit`, { sectionId: secA });
    await principal.post(`/api/exams/papers/${engPaper}/sheet/review`, { sectionId: secA, approve: false, note: 'Check Bilal' });
    const sheet = (await t1.get(`/api/exams/papers/${engPaper}/sheet?sectionId=${secA}`)).body;
    expect(sheet.sheet).toMatchObject({ status: 'RETURNED', returnNote: 'Check Bilal' });
    expect(sheet.canEdit).toBe(true);
    await t1.put(`/api/exams/papers/${engPaper}/sheet`, { sectionId: secA, marks: [{ studentId: bilal.studentId, marks: 45 }] });
    await t1.post(`/api/exams/papers/${engPaper}/sheet/submit`, { sectionId: secA });
    await principal.post(`/api/exams/papers/${engPaper}/sheet/review`, { sectionId: secA, approve: true });

    await t2.put(`/api/exams/papers/${mathPaper}/sheet`, { sectionId: secA, marks: [{ studentId: ali.studentId, marks: 80 }, { studentId: bilal.studentId, marks: 20 }, { studentId: cyra.studentId, marks: 70 }] });
    await t2.post(`/api/exams/papers/${mathPaper}/sheet/submit`, { sectionId: secA });

    // Section B (Dani) has no marks yet -> publishing warns.
    const blocked = await principal.post(`/api/exams/${id}/publish`, {});
    expect(blocked.status).toBe(400);
    expect((await principal.post(`/api/exams/${id}/publish`, { force: true })).status).toBe(200);

    const res = (await principal.get(`/api/exams/${id}/results?sectionId=${secA}`)).body;
    const by = Object.fromEntries(res.rows.map((r: { student: { fullName: string } }) => [r.student.fullName, r]));
    expect(by.Ali).toMatchObject({ obtained: 170, percent: 85, grade: 'A', passed: true, positionSection: 1 });
    expect(by.Bilal).toMatchObject({ obtained: 65, passed: false }); // Maths 20 < 33
    expect(by.Cyra).toMatchObject({ percent: 70, grade: 'B', positionSection: 2 });
    expect(res.papers.find((p: { subject: string }) => p.subject === 'English')).toMatchObject({ highest: 90, appeared: 3, passed: 3 });
  });

  it('remarks, report cards with attendance, corrections after publishing, and WhatsApp results', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, english, maths, ali, bilal, cyra } = await examSchool(principal, schoolId);
    const { id, detail } = await makeExam(principal, cls.id);
    const engPaper = detail.papers.find((p: { subjectId: string }) => p.subjectId === english).id;
    const mathPaper = detail.papers.find((p: { subjectId: string }) => p.subjectId === maths).id;
    const marks = (vals: number[]) => [ali, bilal, cyra].map((s, i) => ({ studentId: s.studentId, marks: vals[i] }));
    await principal.put(`/api/exams/papers/${engPaper}/sheet`, { sectionId: secA, marks: marks([60, 70, 80]) });
    await principal.put(`/api/exams/papers/${mathPaper}/sheet`, { sectionId: secA, marks: marks([60, 70, 80]) });
    await principal.put(`/api/attendance/sections/${secA}`, { date: '2026-09-01', records: [{ studentId: ali.studentId, status: 'PRESENT' }, { studentId: bilal.studentId, status: 'ABSENT' }, { studentId: cyra.studentId, status: 'PRESENT' }] });

    const t1 = await login('t1'); // class teacher of A
    const t2 = await login('t2');
    expect((await t1.put(`/api/exams/${id}/remarks`, { remarks: [{ studentId: ali.studentId, teacherRemark: 'Hard working', principalRemark: 'x' }] })).status).toBe(200);
    expect((await t2.put(`/api/exams/${id}/remarks`, { remarks: [{ studentId: ali.studentId, teacherRemark: 'x' }] })).status).toBe(403);
    await principal.put(`/api/exams/${id}/remarks`, { remarks: [{ studentId: ali.studentId, principalRemark: 'Keep it up' }] });
    await principal.post(`/api/exams/${id}/publish`, { force: true });

    const cards = (await principal.get(`/api/exams/${id}/report-cards?studentId=${ali.studentId}`)).body;
    const card = cards.cards[0];
    expect(card.result).toMatchObject({ obtained: 120, percent: 60, grade: 'C', positionSection: 3 });
    expect(card.remarks).toEqual({ teacher: 'Hard working', principal: 'Keep it up' });
    expect(card.attendance.counts).toEqual({ PRESENT: 1 });
    expect(card.subjects[0]).toMatchObject({ subject: 'English', obtained: 60, grade: 'C' });

    // Teachers cannot change published marks; the principal can, with a reason, and positions update.
    expect((await t1.put(`/api/exams/papers/${engPaper}/sheet`, { sectionId: secA, marks: [{ studentId: ali.studentId, marks: 100 }] })).status).toBe(403);
    expect((await principal.put(`/api/exams/papers/${engPaper}/sheet`, { sectionId: secA, marks: [{ studentId: ali.studentId, marks: 100 }] })).status).toBe(400);
    expect((await principal.put(`/api/exams/papers/${engPaper}/sheet`, { sectionId: secA, marks: [{ studentId: ali.studentId, marks: 100 }], reason: 'Totalling mistake', notifyCorrection: true })).status).toBe(200);
    const after = await prisma.studentResult.findFirstOrThrow({ where: { assessmentId: id, studentId: ali.studentId } });
    expect(after.positionSection).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'exams.marks_correct', reason: 'Totalling mistake' } })).toBe(1);

    // Send results on WhatsApp.
    await principal.put('/api/messaging/settings', { whatsappEnabled: true, phoneNumberId: '1234567890', accessToken: 'EAAG-test-token-1234567890' });
    const sent = await principal.post(`/api/exams/${id}/send`, {});
    expect(sent.body.whatsapp).toBe(3);
    await processOutbox();
    const msg = await prisma.message.findFirstOrThrow({ where: { type: 'RESULT', toPhone: '923001110001' } });
    expect(msg.body).toMatch(/Mid-term 2026 for Ali is out: 160\/200 \(80%\), grade A, position 1/);
  });

  it('changing grade bands updates published grades', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, english, maths, ali, bilal, cyra } = await examSchool(principal, schoolId);
    const { id, detail } = await makeExam(principal, cls.id);
    for (const p of detail.papers) await principal.put(`/api/exams/papers/${p.id}/sheet`, { sectionId: secA, marks: [ali, bilal, cyra].map((s) => ({ studentId: s.studentId, marks: 75 })) });
    await principal.post(`/api/exams/${id}/publish`, { force: true });
    expect((await prisma.studentResult.findFirstOrThrow({ where: { assessmentId: id } })).grade).toBe('B');
    await principal.put('/api/exams/settings', { gradeBands: [{ grade: 'Pass', min: 50 }, { grade: 'Fail', min: 0 }], passPercent: 50 });
    expect((await prisma.studentResult.findFirstOrThrow({ where: { assessmentId: id } })).grade).toBe('Pass');
    void english;
    void maths;
  });

  it('exams need the module; only managers create exams', async () => {
    const { principal, schoolId, planId } = await setupSchool();
    const { cls } = await examSchool(principal, schoolId);
    const t1 = await login('t1');
    const types = (await t1.get('/api/exams/settings')).body.types;
    expect((await t1.post('/api/exams', { typeId: types[5].id, title: 'X', classIds: [cls.id] })).status).toBe(403);
    await prisma.plan.update({ where: { id: planId }, data: { modules: ['attendance'] } });
    expect((await principal.get('/api/exams/settings')).body.error.code).toBe('MODULE_DISABLED');
  });
});
