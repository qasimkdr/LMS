import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';
import { autoMark, normalizeQuestion, paperTotal, scoreAttempt } from '../src/services/onlineExams';
import { closeExpiredAttempts } from '../src/routes/onlineExams';

beforeEach(resetDb);

type Client = Awaited<ReturnType<typeof setupSchool>>['principal'];

const q = (type: string, answer: unknown, marks = 2) => ({ type, answer, marks }) as never;

describe('auto marking', () => {
  it('marks each question type', () => {
    expect(autoMark(q('MCQ', 'b'), 'b', 0.25)).toBe(2);
    expect(autoMark(q('MCQ', 'b'), 'a', 0.25)).toBe(-0.5); // negative marking
    expect(autoMark(q('MCQ', 'b'), undefined, 0.25)).toBe(0); // unanswered: no penalty
    expect(autoMark(q('TRUE_FALSE', true), false, 0)).toBe(0);
    expect(autoMark(q('MULTI', ['a', 'c']), ['c', 'a'], 0)).toBe(2);
    expect(autoMark(q('MULTI', ['a', 'c']), ['a'], 0)).toBe(0);
    expect(autoMark(q('FILL', [['Lahore'], ['Ravi', 'River Ravi']], 2), [' lahore ', 'river  ravi'], 0)).toBe(2);
    expect(autoMark(q('FILL', [['Lahore'], ['Ravi']], 2), ['Lahore', 'Indus'], 0)).toBe(1);
    expect(autoMark(q('MATCH', [0, 1, 2, 3], 4), [0, 1, 3, 2], 0)).toBe(2);
    expect(autoMark(q('SHORT', null), 'anything', 0)).toBeNull();
  });

  it('validates questions', () => {
    expect(() => normalizeQuestion({ type: 'MCQ', text: 'Q', marks: 1, options: [{ id: 'a', text: 'x' }], answer: 'a' })).toThrow(/2 options/);
    expect(() => normalizeQuestion({ type: 'FILL', text: 'No blanks', marks: 1, answer: [['x']] })).toThrow(/___/);
    expect(normalizeQuestion({ type: 'FILL', text: 'Capital is ___ and river ___', marks: 1, answer: [['Lahore'], ['Ravi']] }).answer).toEqual([['Lahore'], ['Ravi']]);
    expect(normalizeQuestion({ type: 'MATCH', text: 'Match', marks: 1, options: { left: ['a', 'b'], right: ['1', '2'] } }).answer).toEqual([0, 1]);
  });

  it('attempt-any sections count only the best answers', () => {
    const sections = [{ id: 's1', attemptAny: null }, { id: 's2', attemptAny: 2 }];
    const questions = [
      { id: 'q1', sectionId: 's1', type: 'MCQ', marks: 1 },
      { id: 'q2', sectionId: 's2', type: 'SHORT', marks: 5 },
      { id: 'q3', sectionId: 's2', type: 'SHORT', marks: 5 },
      { id: 'q4', sectionId: 's2', type: 'SHORT', marks: 5 },
    ] as never[];
    expect(paperTotal(sections, questions)).toBe(11);
    const marking = { q1: { auto: 1, manual: null, remark: null }, q2: { auto: null, manual: 3, remark: null }, q3: { auto: null, manual: 5, remark: null }, q4: { auto: null, manual: 4, remark: null } };
    expect(scoreAttempt(sections, questions, marking, { q2: 'x', q3: 'x', q4: 'x' })).toEqual({ score: 10, pending: 0 });
    expect(scoreAttempt(sections, questions, { ...marking, q4: { auto: null, manual: null, remark: null } }, { q2: 'x', q3: 'x', q4: 'x' }).pending).toBe(1);
  });
});

async function school(principal: Client, schoolId: string) {
  await principal.post('/api/setup/classes', { name: 'Class 5', sections: ['A', 'B'] });
  await principal.post('/api/setup/subjects', { names: ['English', 'Maths'] });
  const s = (await principal.get('/api/setup/structure')).body;
  const cls = s.classes[0];
  const sub = (n: string) => s.subjects.find((x: { name: string }) => x.name === n).id;
  await principal.put(`/api/setup/classes/${cls.id}/subjects`, { subjects: [{ subjectId: sub('English') }, { subjectId: sub('Maths') }] });
  const secA = cls.sections.find((x: { name: string }) => x.name === 'A').id;
  const secB = cls.sections.find((x: { name: string }) => x.name === 'B').id;
  const t1 = await createUser({ role: 'TEACHER', username: 't1', schoolId });
  await createUser({ role: 'TEACHER', username: 't2', schoolId });
  await principal.put('/api/setup/assignments', { sectionId: secA, subjectId: sub('English'), teacherId: t1.id });
  const add = async (name: string, sectionId: string) => {
    const r = (await principal.post('/api/students', { student: { fullName: name, gender: 'MALE', classId: cls.id, sectionId, dob: '2015-01-01' }, guardians: [{ relation: 'FATHER', fullName: `${name} Sr`, phone: '0300' + Math.floor(1000000 + Math.random() * 8999999) }] })).body;
    const st = r.logins.find((l: { role: string }) => l.role === 'STUDENT');
    await prisma.user.update({ where: { username: st.username }, data: { mustChangePassword: false } });
    return { ...r, username: st.username, password: st.tempPassword, parent: r.logins.find((l: { role: string }) => l.role === 'PARENT') };
  };
  const ali = await add('Ali', secA);
  const sara = await add('Sara', secA);
  const dani = await add('Dani', secB);
  return { cls, secA, secB, english: sub('English'), maths: sub('Maths'), t1, ali, sara, dani };
}

const structure = {
  sections: [
    {
      title: 'Section A: Objective',
      questions: [
        { type: 'MCQ', text: 'Capital of Pakistan?', marks: 1, options: [{ id: 'a', text: 'Lahore' }, { id: 'b', text: 'Islamabad' }, { id: 'c', text: 'Karachi' }], answer: 'b', chapter: 'Ch 1' },
        { type: 'TRUE_FALSE', text: 'The sun rises in the west.', marks: 1, answer: false },
        { type: 'FILL', text: 'Lahore is on the river ___.', marks: 2, answer: [['Ravi']] },
      ],
    },
    {
      title: 'Section B: Short questions',
      attemptAny: 1,
      questions: [
        { type: 'SHORT', text: 'What is a noun?', marks: 3 },
        { type: 'SHORT', text: 'What is a verb?', marks: 3 },
      ],
    },
  ],
};

async function makePaper(t: Client, cls: { id: string }, secA: string, english: string, opts: Record<string, unknown> = {}) {
  const now = Date.now();
  const r = await t.post('/api/online-exams', {
    title: 'Grammar quiz',
    subjectId: english,
    classId: cls.id,
    sectionIds: [secA],
    instructions: 'Answer carefully.',
    startAt: new Date(now - 60_000).toISOString(),
    endAt: new Date(now + 3600_000).toISOString(),
    durationMinutes: 20,
    negativeMarking: 0.25,
    ...opts,
  });
  expect(r.status).toBe(201);
  const s = await t.put(`/api/online-exams/${r.body.id}/structure`, structure);
  expect(s.body).toMatchObject({ totalMarks: 7, questions: 5 });
  return r.body.id as string;
}

describe('online exams', () => {
  it('teacher builds a paper (questions saved to the bank) and only for subjects they teach', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, secB, english, maths } = await school(principal, schoolId);
    const t1 = await login('t1');
    const id = await makePaper(t1, cls, secA, english);
    expect(await prisma.bankQuestion.count({ where: { schoolId } })).toBe(5);
    const bank = (await t1.get(`/api/online-exams/bank?subjectId=${english}`)).body.questions;
    expect(bank).toHaveLength(5);
    // Not their subject / section:
    expect((await t1.post('/api/online-exams', { title: 'X quiz', subjectId: maths, classId: cls.id, sectionIds: [secA] })).status).toBe(403);
    expect((await t1.post('/api/online-exams', { title: 'X quiz', subjectId: english, classId: cls.id, sectionIds: [secB] })).status).toBe(403);
    // Invalid question rejected.
    const bad = await t1.put(`/api/online-exams/${id}/structure`, { sections: [{ title: 'A', questions: [{ type: 'MCQ', text: 'Q?', marks: 1, options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }] }] }] });
    expect(bad.body.error.message).toMatch(/correct option/);
    // Duplicate.
    const dup = await t1.post(`/api/online-exams/${id}/duplicate`);
    expect((await t1.get(`/api/online-exams/${dup.body.id}`)).body.paper.totalMarks).toBe(7);
    // A partial update keeps the other settings (no defaults filled in).
    await t1.patch(`/api/online-exams/${id}`, { shuffleQuestions: false, showAnswers: false, durationMinutes: 45 });
    await t1.patch(`/api/online-exams/${id}`, { title: 'Grammar quiz 2' });
    expect((await t1.get(`/api/online-exams/${id}`)).body.paper).toMatchObject({ title: 'Grammar quiz 2', shuffleQuestions: false, showAnswers: false, durationMinutes: 45, negativeMarking: 0.25 });
  });

  it('full flow: schedule, students take it with autosave, marking, principal approval, publish', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, english, ali, sara, dani } = await school(principal, schoolId);
    const t1 = await login('t1');
    const id = await makePaper(t1, cls, secA, english);
    expect((await t1.post(`/api/online-exams/${id}/schedule`)).body.status).toBe('SCHEDULED');
    expect(await prisma.notification.count({ where: { type: 'ONLINE_EXAM' } })).toBeGreaterThanOrEqual(2);

    const s1 = await login(ali.username, ali.password);
    const list = (await s1.get('/api/online-exams/student/list')).body.papers;
    expect(list[0]).toMatchObject({ phase: 'LIVE', totalMarks: 7 });

    // Section B student cannot see or start it.
    const sB = await login(dani.username, dani.password);
    expect((await sB.get('/api/online-exams/student/list')).body.papers).toHaveLength(0);
    expect((await sB.post(`/api/online-exams/${id}/start`)).status).toBe(404);

    const start = await s1.post(`/api/online-exams/${id}/start`);
    expect(start.status).toBe(201);
    expect(JSON.stringify(start.body.questions)).not.toContain('"answer"'); // answers never sent to students
    const qs = start.body.questions as { id: string; type: string; text: string; options?: { id: string; text: string }[] }[];
    const byText = (t: string) => qs.find((x) => x.text.startsWith(t))!;
    const attemptId = start.body.attempt.id;

    await s1.put(`/api/online-exams/attempts/${attemptId}/answers`, { answers: { [byText('Capital').id]: 'b', [byText('The sun').id]: false }, tabSwitches: 1 });
    // Resume after "connection drop" returns the same attempt with saved answers.
    const resumed = await s1.post(`/api/online-exams/${id}/start`);
    expect(resumed.body.attempt.id).toBe(attemptId);
    expect(resumed.body.attempt.answers[byText('Capital').id]).toBe('b');
    await s1.put(`/api/online-exams/attempts/${attemptId}/answers`, { answers: { [byText('Lahore').id]: ['ravi'], [byText('What is a noun').id]: 'A naming word.', [byText('What is a verb').id]: 'An action word.' } });
    expect((await s1.post(`/api/online-exams/attempts/${attemptId}/submit`)).status).toBe(200);
    expect((await s1.post(`/api/online-exams/${id}/start`)).status).toBe(400); // one attempt only

    // Sara never starts.
    const att = await prisma.onlineAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(att.score).toBeNull(); // short answers still to check
    expect(att.tabSwitches).toBe(1);

    // Teacher checks by question for the whole class.
    const noun = byText('What is a noun').id;
    const verb = byText('What is a verb').id;
    expect((await t1.post(`/api/online-exams/${id}/submit-results`)).body.error.message).toMatch(/Wait until the exam closes/);
    await prisma.onlinePaper.update({ where: { id }, data: { endAt: new Date(Date.now() - 1000) } });
    expect((await t1.post(`/api/online-exams/${id}/submit-results`)).body.error.message).toMatch(/1 paper/);
    const qa = (await t1.get(`/api/online-exams/${id}/questions/${noun}/answers`)).body;
    expect(qa.answers[0].given).toBe('A naming word.');
    await t1.put(`/api/online-exams/${id}/questions/${noun}/marking`, { marks: [{ attemptId, marks: 2, remark: 'Give an example' }] });
    await t1.put(`/api/online-exams/attempts/${attemptId}/marking`, { marks: { [verb]: { marks: 3 } }, overallRemark: 'Well done' });
    const scored = await prisma.onlineAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(Number(scored.score)).toBe(7); // 1 + 1 + 2 + best of (2, 3)

    const rows = (await t1.get(`/api/online-exams/${id}/attempts`)).body.rows;
    expect(rows.find((r: { student: { fullName: string } }) => r.student.fullName === 'Sara').status).toBe('ABSENT');

    expect((await t1.post(`/api/online-exams/${id}/submit-results`)).status).toBe(200);
    // Teacher can no longer change marks; principal sends back, teacher resubmits.
    expect((await t1.put(`/api/online-exams/attempts/${attemptId}/marking`, { marks: { [verb]: { marks: 1 } } })).status).toBe(403);
    await principal.post(`/api/online-exams/${id}/review-results`, { approve: false, note: 'Recheck noun answers' });
    expect((await prisma.onlinePaper.findUniqueOrThrow({ where: { id } })).status).toBe('RESULTS_RETURNED');
    await t1.post(`/api/online-exams/${id}/submit-results`);

    // Student cannot see the result before publishing.
    expect((await s1.get(`/api/online-exams/attempts/${attemptId}/result`)).status).toBe(400);

    // Principal publishes and copies marks into a mid-term English paper (scaled to 100).
    const types = (await principal.get('/api/exams/settings')).body.types;
    const exam = await principal.post('/api/exams', { typeId: types.find((t: { name: string }) => t.name === 'Mid-term').id, title: 'Mid-term', classIds: [cls.id] });
    const examDetail = (await principal.get(`/api/exams/${exam.body.ids[0]}`)).body;
    const engPaper = examDetail.papers.find((p: { subjectId: string }) => p.subjectId === english).id;
    const pub = await principal.post(`/api/online-exams/${id}/review-results`, { approve: true, linkPaperId: engPaper });
    expect(pub.status).toBe(200);
    const linked = await prisma.mark.findFirstOrThrow({ where: { paperId: engPaper, studentId: ali.studentId } });
    expect(Number(linked.marks)).toBe(100);

    const result = (await s1.get(`/api/online-exams/attempts/${attemptId}/result`)).body;
    expect(result).toMatchObject({ score: 7, overallRemark: 'Well done' });
    expect(result.questions.find((x: { id: string }) => x.id === noun)).toMatchObject({ awarded: 2, remark: 'Give an example' });

    // Shows with other results for the family (as an "Online test").
    const parentLogin = ali.parent;
    await prisma.user.update({ where: { username: parentLogin.username }, data: { mustChangePassword: false } });
    const parent = await login(parentLogin.username, parentLogin.tempPassword);
    const fam = (await parent.get('/api/results/my')).body.children[0].rows;
    expect(fam[0]).toMatchObject({ type: 'Online test', obtained: 7, total: 7 });
    const sr = await prisma.studentResult.findFirstOrThrow({ where: { studentId: sara.studentId } });
    expect(sr.absentPapers).toBe(1);
  });

  it('time limit: late answers are refused and the attempt is submitted automatically', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, english, ali } = await school(principal, schoolId);
    const t1 = await login('t1');
    const id = await makePaper(t1, cls, secA, english);
    await t1.post(`/api/online-exams/${id}/schedule`);
    const s1 = await login(ali.username, ali.password);
    const start = await s1.post(`/api/online-exams/${id}/start`);
    const attemptId = start.body.attempt.id;
    await prisma.onlineAttempt.update({ where: { id: attemptId }, data: { deadline: new Date(Date.now() - 60_000) } });
    const late = await s1.put(`/api/online-exams/attempts/${attemptId}/answers`, { answers: {} });
    expect(late.body.error.message).toMatch(/Time is up/);
    const a = await prisma.onlineAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(a.autoSubmitted).toBe(true);
    expect(Number(a.score)).toBe(0);
    expect(await closeExpiredAttempts()).toBe(0);
  });

  it('school can require principal approval before a paper goes live', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, english } = await school(principal, schoolId);
    await principal.put('/api/exams/settings', { onlinePaperApproval: true });
    const t1 = await login('t1');
    const id = await makePaper(t1, cls, secA, english);
    expect((await t1.post(`/api/online-exams/${id}/schedule`)).body.status).toBe('AWAITING_APPROVAL');
    expect((await principal.post(`/api/online-exams/${id}/approve-paper`, { approve: false })).status).toBe(400);
    await principal.post(`/api/online-exams/${id}/approve-paper`, { approve: true });
    expect((await prisma.onlinePaper.findUniqueOrThrow({ where: { id } })).status).toBe('SCHEDULED');
  });

  it('needs the online exams module', async () => {
    const { principal, planId } = await setupSchool();
    await prisma.plan.update({ where: { id: planId }, data: { modules: ['exams'] } });
    expect((await principal.get('/api/online-exams')).body.error.code).toBe('MODULE_DISABLED');
  });
});
