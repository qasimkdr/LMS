import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';
import { autoGenerateMonthly } from '../src/services/monthlyReports';

type Client = Awaited<ReturnType<typeof setupSchool>>['principal'];

beforeEach(async () => {
  await resetDb();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.${Math.random()}` }] }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

/** Class 5 A (Ali, Bilal, Cyra) taught by t1 (class teacher); Class 6 A (Dani) taught by t2. */
async function school(principal: Client, schoolId: string) {
  await principal.post('/api/setup/sessions', { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
  await principal.post('/api/setup/classes', { name: 'Class 5', sections: ['A'] });
  await principal.post('/api/setup/classes', { name: 'Class 6', sections: ['A'] });
  await principal.post('/api/setup/subjects', { names: ['English'] });
  const s = (await principal.get('/api/setup/structure')).body;
  const english = s.subjects[0].id;
  const [c5, c6] = s.classes;
  for (const c of s.classes) await principal.put(`/api/setup/classes/${c.id}/subjects`, { subjects: [{ subjectId: english }] });
  const t1 = await createUser({ role: 'TEACHER', username: 't1', schoolId });
  const t2 = await createUser({ role: 'TEACHER', username: 't2', schoolId });
  const sec5 = c5.sections[0].id;
  const sec6 = c6.sections[0].id;
  await principal.put('/api/setup/assignments', { sectionId: sec5, subjectId: english, teacherId: t1.id });
  await principal.put('/api/setup/assignments', { sectionId: sec6, subjectId: english, teacherId: t2.id });
  await principal.patch(`/api/setup/sections/${sec5}`, { classTeacherId: t1.id });
  const add = async (name: string, c: { id: string }, sectionId: string, phone: string) => {
    const r = (await principal.post('/api/students', { student: { fullName: name, gender: 'MALE', classId: c.id, sectionId, dob: '2015-01-01' }, guardians: [{ relation: 'FATHER', fullName: `${name} Sr`, phone }] })).body;
    const p = r.logins.find((l: { role: string }) => l.role === 'PARENT');
    await prisma.user.update({ where: { username: p.username }, data: { mustChangePassword: false } });
    return { id: r.studentId as string, parent: p as { username: string; tempPassword: string } };
  };
  const ali = await add('Ali', c5, sec5, '03001110001');
  const bilal = await add('Bilal', c5, sec5, '03001110002');
  const cyra = await add('Cyra', c5, sec5, '03001110003');
  const dani = await add('Dani', c6, sec6, '03001110004');
  return { c5, c6, sec5, sec6, english, t1, t2, ali, bilal, cyra, dani };
}

/** Publishes a class test with the given marks out of 100. */
async function test(principal: Client, teacher: Client, sectionId: string, subjectId: string, date: string, marks: Record<string, number>) {
  const types = (await principal.get('/api/exams/settings')).body.types.filter((t: { kind: string }) => t.kind === 'TEST');
  const t = await teacher.post('/api/exams/tests', { typeId: types[0].id, sectionId, subjectId, title: `Test ${date}`, date, totalMarks: 100 });
  expect(t.status).toBe(201);
  await teacher.put(`/api/exams/papers/${t.body.paperId}/sheet`, { sectionId, marks: Object.entries(marks).map(([studentId, m]) => ({ studentId, marks: m })) });
  await teacher.post(`/api/exams/papers/${t.body.paperId}/sheet/submit`, { sectionId });
  expect((await principal.post(`/api/exams/${t.body.id}/publish`, { force: true })).status).toBe(200);
}

async function attendance(schoolId: string, studentId: string, sectionId: string, days: string[], absent: string[] = []) {
  for (const d of days) await prisma.attendanceRecord.create({ data: { schoolId, studentId, sectionId, date: new Date(d), status: absent.includes(d) ? 'ABSENT' : 'PRESENT' } });
}

describe('remarks', () => {
  it('teachers write remarks for their students; shared ones reach parents, internal ones do not', async () => {
    const { principal, schoolId } = await setupSchool();
    const { ali, bilal, dani } = await school(principal, schoolId);
    const t1 = await login('t1');
    // Whole-class remark
    const r = await t1.post('/api/remarks', { studentIds: [ali.id, bilal.id], category: 'APPRECIATION', text: 'Great work in the science fair.' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ created: 2 });
    expect(await prisma.notification.count({ where: { type: 'REMARK' } })).toBe(4); // parent + student login each
    // Internal remark: no notice
    await t1.post('/api/remarks', { studentIds: [ali.id], category: 'HEALTH', text: 'Complained of headache.', shared: false });
    expect(await prisma.notification.count({ where: { type: 'REMARK' } })).toBe(4); // parent + student login each
    // Not their student
    expect((await t1.post('/api/remarks', { studentIds: [dani.id], category: 'BEHAVIOR', text: 'Noisy' })).status).toBe(403);
    // Parent sees only shared remarks
    const parent = await login(ali.parent.username, ali.parent.tempPassword);
    const mine = (await parent.get('/api/remarks/my')).body.children[0].remarks;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ category: 'APPRECIATION', by: { fullName: 't1' } });
    // Staff list: teacher sees their own; t2 cannot see section 5 remarks
    expect((await t1.get(`/api/remarks?studentId=${ali.id}`)).body.remarks).toHaveLength(2);
    const t2 = await login('t2');
    expect((await t2.get(`/api/remarks?studentId=${ali.id}`)).body.remarks).toHaveLength(0);
    // Only the writer or principal can edit / delete
    const id = (await t1.get(`/api/remarks?studentId=${ali.id}`)).body.remarks[0].id;
    expect((await t2.del(`/api/remarks/${id}`)).status).toBe(403);
    expect((await principal.del(`/api/remarks/${id}`)).status).toBe(200);
    expect((await t1.get(`/api/remarks?studentId=${ali.id}`)).body.remarks).toHaveLength(1);
  });

  it('WhatsApp follows the school rule (manual: only when ticked)', async () => {
    const { principal, schoolId } = await setupSchool();
    const { ali } = await school(principal, schoolId);
    await prisma.messagingSettings.upsert({ where: { schoolId }, create: { schoolId, verifyToken: 'x', whatsappEnabled: true, status: 'CONNECTED', phoneNumberId: '1', accessTokenEnc: 'x' }, update: { whatsappEnabled: true, status: 'CONNECTED', phoneNumberId: '1', accessTokenEnc: 'x' } });
    const t1 = await login('t1');
    await t1.post('/api/remarks', { studentIds: [ali.id], category: 'ACADEMIC', text: 'Needs to practise reading.' });
    expect(await prisma.message.count({ where: { type: 'REMARK' } })).toBe(0);
    const r = await t1.post('/api/remarks', { studentIds: [ali.id], category: 'ACADEMIC', text: 'Reading is improving.', whatsapp: true });
    expect(r.body.whatsapp).toBe(1);
    expect((await prisma.message.findFirstOrThrow({ where: { type: 'REMARK' } })).body).toContain('Reading is improving.');
  });
});

describe('rankings and honors', () => {
  it('ranks by month, suggests winners, and the honor board shows only public honors', async () => {
    const { principal, schoolId } = await setupSchool();
    const { sec5, sec6, english, ali, bilal, cyra, dani } = await school(principal, schoolId);
    const t1 = await login('t1');
    const t2 = await login('t2');
    // October: Ali 60, Bilal 40. November: Ali 90, Bilal 80, Cyra 70; Dani 95 (class 6).
    await test(principal, t1, sec5, english, '2026-10-10', { [ali.id]: 60, [bilal.id]: 40, [cyra.id]: 70 });
    await test(principal, t1, sec5, english, '2026-11-10', { [ali.id]: 90, [bilal.id]: 80, [cyra.id]: 70 });
    await test(principal, t2, sec6, english, '2026-11-11', { [dani.id]: 95 });
    await attendance(schoolId, ali.id, sec5, ['2026-11-02', '2026-11-03']);
    await attendance(schoolId, bilal.id, sec5, ['2026-11-02', '2026-11-03'], ['2026-11-03']);

    const r = (await principal.get('/api/rankings?scope=month&period=2026-11')).body;
    expect(r.school.map((x: { student: { fullName: string } }) => x.student.fullName)).toEqual(['Dani', 'Ali', 'Bilal', 'Cyra']);
    expect(r.byClass.map((c: { label: string; rows: unknown[] }) => [c.label, c.rows.length])).toEqual([['Class 5', 3], ['Class 6', 1]]);
    expect(r.mostImproved[0]).toMatchObject({ student: { fullName: 'Bilal' }, before: 40, percent: 80, change: 40 });
    expect(r.perfectAttendance.map((x: { student: { fullName: string } }) => x.student.fullName)).toEqual(['Ali']);
    // Teacher sees only their sections.
    const tr = (await t2.get('/api/rankings?scope=month&period=2026-11')).body;
    expect(tr.school.map((x: { student: { fullName: string } }) => x.student.fullName)).toEqual(['Dani']);

    const sug = (await principal.get('/api/honors/suggestions?period=2026-11')).body.suggestions;
    expect(sug.TOP_MONTH.map((x: { student: { fullName: string } }) => x.student.fullName).sort()).toEqual(['Ali', 'Dani']);
    expect(sug.ATTENDANCE.map((x: { student: { fullName: string } }) => x.student.fullName)).toEqual(['Ali']);

    const types = (await principal.get('/api/honors/types')).body.types;
    const som = types.find((t: { name: string }) => t.name === 'Student of the Month');
    const behavior = types.find((t: { name: string }) => t.name === 'Best Behavior');
    const g = await principal.post('/api/honors', { typeId: som.id, studentIds: [ali.id, dani.id], period: '2026-11', citation: 'Top of the class' });
    expect(g.body).toMatchObject({ created: 2 });
    expect((await principal.post('/api/honors', { typeId: som.id, studentIds: [ali.id], period: '2026-11' })).status).toBe(400); // already awarded
    await principal.post('/api/honors', { typeId: behavior.id, studentIds: [bilal.id], period: '2026-11', isPublic: false });
    expect(await prisma.notification.count({ where: { type: 'HONOR' } })).toBe(6);

    // Everyone in the school sees the public honors only.
    const parent = await login(cyra.parent.username, cyra.parent.tempPassword);
    const board = (await parent.get('/api/honors/board')).body.periods;
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ period: '2026-11', label: 'November 2026' });
    expect(board[0].honors.map((h: { student: { fullName: string } }) => h.student.fullName).sort()).toEqual(['Ali', 'Dani']);
    // Parents cannot give honors; teachers cannot see the full list.
    expect((await parent.post('/api/honors', { typeId: som.id, studentIds: [cyra.id], period: '2026-11' })).status).toBe(403);
    expect((await t1.get('/api/honors')).status).toBe(403);
    // Student profile shows private honors to staff.
    expect((await principal.get(`/api/honors/students/${bilal.id}`)).body.honors).toHaveLength(1);
  });
});

describe('monthly reports', () => {
  it('generates drafts, the class teacher comments, the principal sends, parents read', async () => {
    const { principal, schoolId } = await setupSchool();
    const { sec5, english, ali, bilal, cyra } = await school(principal, schoolId);
    const t1 = await login('t1');
    await test(principal, t1, sec5, english, '2026-10-10', { [ali.id]: 60, [bilal.id]: 50, [cyra.id]: 70 });
    await test(principal, t1, sec5, english, '2026-11-10', { [ali.id]: 90, [bilal.id]: 80, [cyra.id]: 70 });
    await attendance(schoolId, ali.id, sec5, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'], ['2026-11-05']);
    await t1.post('/api/remarks', { studentIds: [ali.id], category: 'APPRECIATION', text: 'Helpful in class.', date: '2026-11-12' });
    await t1.post('/api/remarks', { studentIds: [ali.id], category: 'HEALTH', text: 'Private note.', date: '2026-11-12', shared: false });
    const types = (await principal.get('/api/honors/types')).body.types;
    await principal.post('/api/honors', { typeId: types[0].id, studentIds: [ali.id], period: '2026-11', notify: false });

    expect((await t1.post('/api/monthly-reports/generate', { period: '2026-11' })).status).toBe(403);
    const g = await principal.post('/api/monthly-reports/generate', { period: '2026-11' });
    expect(g.body).toMatchObject({ generated: 4, skipped: 0 });
    const list = (await principal.get('/api/monthly-reports?period=2026-11')).body.reports;
    const aliRow = list.find((r: { student: { fullName: string } }) => r.student.fullName === 'Ali');
    expect(aliRow).toMatchObject({ status: 'DRAFT', attendance: 75, tests: 1, average: 90, remarks: 1, honors: 1 });
    const full = (await t1.get(`/api/monthly-reports/${aliRow.id}`)).body;
    expect(full.canComment).toBe(true);
    expect(full.report.data).toMatchObject({ previousAverage: 60, sectionAverage: 80, attendance: { present: 3, absent: 1, days: 4 } });
    expect(full.report.data.remarks).toHaveLength(1);

    // Class teacher comments; parents cannot see drafts.
    expect((await t1.put(`/api/monthly-reports/${aliRow.id}/comment`, { comment: 'Keep it up!' })).status).toBe(200);
    const parent = await login(ali.parent.username, ali.parent.tempPassword);
    expect((await parent.get(`/api/monthly-reports/${aliRow.id}`)).status).toBe(404);

    const sent = await principal.post('/api/monthly-reports/send', { period: '2026-11' });
    expect(sent.body.sent).toBe(4);
    expect(await prisma.notification.count({ where: { type: 'MONTHLY_REPORT' } })).toBeGreaterThanOrEqual(4);
    const mine = (await parent.get('/api/monthly-reports/my')).body.children[0].reports;
    expect(mine).toHaveLength(1);
    const view = (await parent.get(`/api/monthly-reports/${aliRow.id}`)).body;
    expect(view.report).toMatchObject({ comment: 'Keep it up!', commentBy: 't1', status: 'SENT' });
    expect(view.canComment).toBe(false);
    // Regenerating leaves sent reports alone.
    expect((await principal.post('/api/monthly-reports/generate', { period: '2026-11' })).body).toMatchObject({ generated: 0, skipped: 4 });
    // Nothing new to send.
    expect((await principal.post('/api/monthly-reports/send', { period: '2026-11' })).status).toBe(400);
  });

  it('drafts last month automatically at the start of a month', async () => {
    const { principal, schoolId } = await setupSchool();
    await school(principal, schoolId);
    expect(await autoGenerateMonthly(new Date('2026-12-15T10:00:00Z'))).toBe(0);
    expect(await autoGenerateMonthly(new Date('2026-12-01T10:00:00Z'))).toBe(4);
    expect(await prisma.monthlyReport.count({ where: { period: '2026-11' } })).toBe(4);
    expect(await autoGenerateMonthly(new Date('2026-12-02T10:00:00Z'))).toBe(0);
  });
});
