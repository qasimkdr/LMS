import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';
import { schoolNow } from '../src/routes/timetable';

beforeEach(resetDb);

type Client = Awaited<ReturnType<typeof setupSchool>>['principal'];

const regular = [
  { name: 'Period 1', startTime: '08:00', endTime: '08:40' },
  { name: 'Period 2', startTime: '08:40', endTime: '09:20' },
  { name: 'Break', startTime: '09:20', endTime: '09:40', isBreak: true },
  { name: 'Period 3', startTime: '09:40', endTime: '10:20' },
];
const friday = [
  { name: 'Period 1', startTime: '08:00', endTime: '08:35' },
  { name: 'Period 2', startTime: '08:35', endTime: '09:10' },
];

async function setup(principal: Client, schoolId: string) {
  await principal.put('/api/timetable/setup', {
    workingDays: [1, 2, 3, 4, 5, 6],
    schedules: [
      { name: 'Regular', days: [1, 2, 3, 4, 6], periods: regular },
      { name: 'Friday', days: [5], periods: friday },
    ],
  });
  await principal.post('/api/setup/classes', { name: 'Class 5', sections: ['A', 'B'] });
  await principal.post('/api/setup/subjects', { names: ['English', 'Maths'] });
  const s = (await principal.get('/api/setup/structure')).body;
  const cls = s.classes[0];
  const sub = (n: string) => s.subjects.find((x: { name: string }) => x.name === n).id;
  await principal.put(`/api/setup/classes/${cls.id}/subjects`, { subjects: [{ subjectId: sub('English') }, { subjectId: sub('Maths') }] });
  const t1 = await createUser({ role: 'TEACHER', username: 't1', schoolId });
  const t2 = await createUser({ role: 'TEACHER', username: 't2', schoolId });
  const secA = cls.sections.find((x: { name: string }) => x.name === 'A').id;
  const secB = cls.sections.find((x: { name: string }) => x.name === 'B').id;
  await principal.put('/api/setup/assignments', { sectionId: secA, subjectId: sub('English'), teacherId: t1.id });
  const setupRes = (await principal.get('/api/timetable/setup')).body;
  const reg = setupRes.schedules.find((x: { name: string }) => x.name === 'Regular');
  const fri = setupRes.schedules.find((x: { name: string }) => x.name === 'Friday');
  return { secA, secB, english: sub('English'), maths: sub('Maths'), t1, t2, reg, fri, cls };
}

describe('bell schedule', () => {
  it('saves timings per weekday and rejects bad timings', async () => {
    const { principal, schoolId } = await setupSchool();
    const { reg, fri } = await setup(principal, schoolId);
    expect(reg.periods).toHaveLength(4);
    expect(fri.days).toEqual([5]);

    const overlap = await principal.put('/api/timetable/setup', {
      workingDays: [1],
      schedules: [{ name: 'X', days: [1], periods: [{ name: 'P1', startTime: '08:00', endTime: '08:40' }, { name: 'P2', startTime: '08:30', endTime: '09:00' }] }],
    });
    expect(overlap.status).toBe(400);
    const missingDay = await principal.put('/api/timetable/setup', { workingDays: [1, 2], schedules: [{ name: 'X', days: [1], periods: regular }] });
    expect(missingDay.body.error.message).toMatch(/Tuesday/);
    const twice = await principal.put('/api/timetable/setup', {
      workingDays: [1],
      schedules: [
        { name: 'A', days: [1], periods: regular },
        { name: 'B', days: [1], periods: regular },
      ],
    });
    expect(twice.status).toBe(400);
  });

  it('is blocked when the plan does not include the timetable module', async () => {
    const { principal, planId } = await setupSchool();
    await prisma.plan.update({ where: { id: planId }, data: { modules: ['attendance'] } });
    const r = await principal.get('/api/timetable/setup');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MODULE_DISABLED');
  });
});

describe('class timetable', () => {
  it('fills cells, defaults to the assigned subject teacher, and blocks teacher clashes', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, secB, english, maths, t1, t2, reg } = await setup(principal, schoolId);
    const p1 = reg.periods[0].id;

    const r = await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 1, periodId: p1, subjectId: english, room: '12' });
    expect(r.status).toBe(200);
    const cell = await prisma.timetableEntry.findFirstOrThrow({ where: { sectionId: secA } });
    expect(cell.teacherId).toBe(t1.id);

    // Same teacher, same time, other section -> clash.
    const clash = await principal.put(`/api/timetable/sections/${secB}/slot`, { day: 1, periodId: p1, subjectId: maths, teacherId: t1.id });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toMatch(/already teaches Class 5 A on Monday in Period 1/);

    // Different teacher is fine; same room only warns.
    const ok = await principal.put(`/api/timetable/sections/${secB}/slot`, { day: 1, periodId: p1, subjectId: maths, teacherId: t2.id, room: '12' });
    expect(ok.status).toBe(200);
    expect(ok.body.warning).toMatch(/Room 12/);

    // Breaks and periods from another day's schedule are rejected.
    expect((await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 1, periodId: reg.periods[2].id, subjectId: english })).status).toBe(400);
    expect((await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 5, periodId: p1, subjectId: english })).status).toBe(400);

    // Clearing a cell.
    await principal.put(`/api/timetable/sections/${secB}/slot`, { day: 1, periodId: p1 });
    expect(await prisma.timetableEntry.count({ where: { sectionId: secB } })).toBe(0);
  });

  it('returns the week grid with subjects, periods per week and teachers busy elsewhere', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, secB, english, reg, t1 } = await setup(principal, schoolId);
    await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 1, periodId: reg.periods[0].id, subjectId: english });
    await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 2, periodId: reg.periods[0].id, subjectId: english });
    const a = (await principal.get(`/api/timetable/sections/${secA}`)).body;
    expect(a.week.map((d: { dayName: string }) => d.dayName)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    expect(a.week[4].periods).toHaveLength(2); // Friday timings
    expect(a.subjects.find((s: { name: string }) => s.name === 'English').periodsPerWeek).toBe(2);
    const b = (await principal.get(`/api/timetable/sections/${secB}`)).body;
    expect(b.busy).toContainEqual({ day: 1, periodId: reg.periods[0].id, teacherId: t1.id, where: 'Class 5 A' });
  });

  it('copies a timetable to another section, skipping clashes', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, secB, english, maths, reg, t2 } = await setup(principal, schoolId);
    await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 1, periodId: reg.periods[0].id, subjectId: english });
    await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 1, periodId: reg.periods[1].id, subjectId: maths, teacherId: t2.id });
    const r = await principal.post(`/api/timetable/sections/${secB}/copy`, { fromSectionId: secA, withTeachers: true });
    expect(r.body.copied).toBe(0);
    expect(r.body.skipped).toHaveLength(2); // both teachers are busy in A at those times
    const r2 = await principal.post(`/api/timetable/sections/${secB}/copy`, { fromSectionId: secA });
    // Without teachers: B has no assigned teachers, so subjects copy without a teacher.
    expect(r2.body.copied).toBe(2);
  });

  it('removing a period in the bell schedule removes its cells', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, english, reg, fri } = await setup(principal, schoolId);
    await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 1, periodId: reg.periods[3].id, subjectId: english });
    const keep = reg.periods.slice(0, 3).map((p: Record<string, unknown>) => ({ id: p.id, name: p.name, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }));
    const r = await principal.put('/api/timetable/setup', {
      workingDays: [1, 2, 3, 4, 5, 6],
      schedules: [
        { id: reg.id, name: 'Regular', days: [1, 2, 3, 4, 6], periods: keep },
        { id: fri.id, name: 'Friday', days: [5], periods: friday },
      ],
    });
    expect(r.body.removedEntries).toBe(1);
    expect(await prisma.timetableEntry.count()).toBe(0);
  });

  it('only the principal edits; deleting a teacher frees their cells', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, english, reg, t1 } = await setup(principal, schoolId);
    await createUser({ role: 'STAFF', username: 'clerk', schoolId, permissions: ['students.manage'] });
    const clerk = await login('clerk');
    expect((await clerk.put(`/api/timetable/sections/${secA}/slot`, { day: 1, periodId: reg.periods[0].id, subjectId: english })).status).toBe(403);
    await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 1, periodId: reg.periods[0].id, subjectId: english });
    await principal.del(`/api/staff/${t1.id}`);
    const cell = await prisma.timetableEntry.findFirstOrThrow({ where: { sectionId: secA } });
    expect(cell.teacherId).toBeNull();
  });
});

describe('my timetable', () => {
  it('teachers see their week and load; students and parents see their section', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, secB, english, maths, reg, cls, t2 } = await setup(principal, schoolId);
    await principal.put(`/api/timetable/sections/${secA}/slot`, { day: 1, periodId: reg.periods[0].id, subjectId: english });
    await principal.put(`/api/timetable/sections/${secB}/slot`, { day: 1, periodId: reg.periods[1].id, subjectId: maths, teacherId: t2.id });

    const t1 = await login('t1');
    const mine = (await t1.get('/api/timetable/my')).body;
    expect(mine.periodsPerWeek).toBe(1);
    expect(mine.week[0].periods[0].entries[0].section.name).toBe('A');
    expect(mine.now.day).toBeGreaterThanOrEqual(1);
    // t1 cannot see t2's timetable; principal can.
    expect((await t1.get(`/api/timetable/teachers/${t2.id}`)).status).toBe(403);
    expect((await principal.get(`/api/timetable/teachers/${t2.id}`)).body.periodsPerWeek).toBe(1);
    // t1 teaches in A only.
    expect((await t1.get(`/api/timetable/sections/${secB}`)).status).toBe(403);

    const st = await principal.post('/api/students', {
      student: { fullName: 'Ali Raza', gender: 'MALE', classId: cls.id, sectionId: secA, dob: '2015-01-01' },
      guardians: [{ relation: 'FATHER', fullName: 'Raza Ahmed', phone: '03001234567' }],
    });
    const parentLogin = st.body.logins.find((l: { role: string }) => l.role === 'PARENT');
    await prisma.user.update({ where: { username: parentLogin.username }, data: { mustChangePassword: false } });
    const parent = await login(parentLogin.username, parentLogin.tempPassword);
    const pt = (await parent.get('/api/timetable/my')).body;
    expect(pt.children[0].week[0].periods[0].entries[0].subject.name).toBe('English');
    expect((await parent.get(`/api/timetable/sections/${secA}`)).status).toBe(200);
    expect((await parent.get(`/api/timetable/sections/${secB}`)).status).toBe(403);
  });

  it('computes weekday and time in the school time zone', () => {
    // 2026-11-16 is a Monday. 03:30 UTC = 08:30 in Karachi (UTC+5).
    expect(schoolNow('Asia/Karachi', new Date('2026-11-16T03:30:00Z'))).toEqual({ day: 1, minutes: 8 * 60 + 30 });
    // 20:00 UTC Sunday = 01:00 Monday in Karachi.
    expect(schoolNow('Asia/Karachi', new Date('2026-11-15T20:00:00Z'))).toEqual({ day: 1, minutes: 60 });
  });
});
