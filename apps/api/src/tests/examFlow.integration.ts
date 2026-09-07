import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { prisma } from '@nexora/database';

const PORT = 4024;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const slugs = ['ci-exams-a', 'ci-exams-b'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForApi(child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health/live`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Timed out waiting for API test server');
}

async function closeChild(child: ChildProcess) {
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function token(userId: string, role: string, schoolId: string) {
  return jwt.sign({ userId, role, schoolId }, ACCESS_SECRET, { expiresIn: '15m' });
}

async function request(path: string, bearer: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${bearer}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await response.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

async function cleanup() {
  await prisma.school.deleteMany({ where: { slug: { in: slugs } } });
}

async function seed() {
  await cleanup();
  const [schoolA, schoolB] = await Promise.all([
    prisma.school.create({ data: { name: 'CI Exams A', slug: slugs[0], status: 'ACTIVE' } }),
    prisma.school.create({ data: { name: 'CI Exams B', slug: slugs[1], status: 'ACTIVE' } }),
  ]);
  const makeUser = (schoolId: string, role: any, suffix: string) => prisma.user.create({
    data: {
      schoolId,
      role,
      email: `ci-exams-${suffix}@nexora.test`,
      username: `ci-exams-${suffix}`,
      passwordHash: 'not-used',
      firstName: 'CI',
      lastName: suffix,
    },
  });
  const [teacherA, teacherUnassigned, teacherB, studentAUser, studentOtherUser] = await Promise.all([
    makeUser(schoolA.id, 'TEACHER', 'teacher-a'),
    makeUser(schoolA.id, 'TEACHER', 'teacher-unassigned'),
    makeUser(schoolB.id, 'TEACHER', 'teacher-b'),
    makeUser(schoolA.id, 'STUDENT', 'student-a'),
    makeUser(schoolA.id, 'STUDENT', 'student-other'),
  ]);
  const [classA, classOther, classB, subjectA, subjectB] = await Promise.all([
    prisma.class.create({ data: { schoolId: schoolA.id, name: 'Exam Class A', section: 'A' } }),
    prisma.class.create({ data: { schoolId: schoolA.id, name: 'Exam Other', section: 'B' } }),
    prisma.class.create({ data: { schoolId: schoolB.id, name: 'Exam Class B', section: 'B' } }),
    prisma.subject.create({ data: { schoolId: schoolA.id, name: 'Exam Subject A', code: 'EX-A' } }),
    prisma.subject.create({ data: { schoolId: schoolB.id, name: 'Exam Subject B', code: 'EX-B' } }),
  ]);
  const [studentA, studentOther] = await Promise.all([
    prisma.studentProfile.create({ data: { schoolId: schoolA.id, userId: studentAUser.id, admissionNo: 'EX-001', classId: classA.id } }),
    prisma.studentProfile.create({ data: { schoolId: schoolA.id, userId: studentOtherUser.id, admissionNo: 'EX-002', classId: classOther.id } }),
  ]);
  await prisma.teacherAssignment.create({
    data: { schoolId: schoolA.id, teacherId: teacherA.id, classId: classA.id, subjectId: subjectA.id },
  });
  return { schoolA, schoolB, teacherA, teacherUnassigned, teacherB, studentAUser, studentOtherUser, classA, classOther, classB, subjectA, subjectB, studentA, studentOther };
}

const question = (type: string, prompt: string, marks: number, correctAnswer?: any, options: any[] = []) => ({
  type,
  prompt,
  marks,
  correctAnswer,
  options,
});

async function createExam(bearer: string, payload: any) {
  return request('/exams', bearer, { method: 'POST', body: JSON.stringify(payload) });
}

async function main() {
  const fixture = await seed();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CLIENT_URL: 'http://localhost:5173',
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'ci-refresh-secret-at-least-32-characters-long',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const teacherToken = token(fixture.teacherA.id, 'TEACHER', fixture.schoolA.id);
  const unassignedToken = token(fixture.teacherUnassigned.id, 'TEACHER', fixture.schoolA.id);
  const studentToken = token(fixture.studentAUser.id, 'STUDENT', fixture.schoolA.id);
  const otherStudentToken = token(fixture.studentOtherUser.id, 'STUDENT', fixture.schoolA.id);

  try {
    await waitForApi(child);

    const foreignCreate = await createExam(teacherToken, {
      classId: fixture.classB.id,
      subjectId: fixture.subjectB.id,
      title: 'Foreign Exam',
      durationMin: 30,
      questions: [question('MCQ', 'Foreign question?', 1, 'A', [
        { label: 'A', value: 'Yes', isCorrect: true },
        { label: 'B', value: 'No', isCorrect: false },
      ])],
    });
    assert.ok([400, 403].includes(foreignCreate.response.status), 'Teacher must not create an exam using foreign tenant references');

    const unassignedCreate = await createExam(unassignedToken, {
      classId: fixture.classA.id,
      subjectId: fixture.subjectA.id,
      title: 'Unassigned Exam',
      durationMin: 30,
      questions: [question('TRUE_FALSE', 'The sky can appear blue.', 1, 'true')],
    });
    assert.equal(unassignedCreate.response.status, 403, 'Unassigned Teacher must not create class/subject exam');

    const mixedExamCreate = await createExam(teacherToken, {
      classId: fixture.classA.id,
      subjectId: fixture.subjectA.id,
      title: 'Mixed CI Exam',
      durationMin: 30,
      passingMarks: 3,
      showResults: true,
      questions: [
        question('MCQ', 'Choose the letter B.', 2, 'b', [
          { label: 'A', value: 'a', isCorrect: false },
          { label: 'B', value: 'b', isCorrect: true },
        ]),
        question('SHORT_ANSWER', 'Write the word hello.', 3),
      ],
    });
    assert.equal(mixedExamCreate.response.status, 201, `Exam creation failed: ${JSON.stringify(mixedExamCreate.body)}`);
    const mixedExamId = mixedExamCreate.body.id as string;

    const available = await request('/exam-attempts/available', studentToken);
    assert.equal(available.response.status, 200);
    assert.ok(available.body.some((exam: any) => exam.id === mixedExamId), 'Student in assigned class must see exam');
    const otherAvailable = await request('/exam-attempts/available', otherStudentToken);
    assert.equal(otherAvailable.response.status, 200);
    assert.ok(!otherAvailable.body.some((exam: any) => exam.id === mixedExamId), 'Student in another class must not see exam');

    const started = await request(`/exam-attempts/${mixedExamId}/start`, studentToken, { method: 'POST' });
    assert.equal(started.response.status, 200);
    const attemptId = started.body.attempt.id as string;
    const questions = started.body.exam.questions as any[];
    const mcq = questions.find((q) => q.type === 'MCQ');
    const written = questions.find((q) => q.type === 'SHORT_ANSWER');
    assert.ok(mcq && written);

    const resumed = await request(`/exam-attempts/${mixedExamId}/start`, studentToken, { method: 'POST' });
    assert.equal(resumed.response.status, 200, 'IN_PROGRESS attempt should be resumable');
    assert.equal(resumed.body.attempt.id, attemptId, 'Resume must not create another attempt');

    const savedMcq = await request(`/exam-attempts/${attemptId}/answer`, studentToken, {
      method: 'PATCH',
      body: JSON.stringify({ questionId: mcq.id, answer: ' B ' }),
    });
    assert.equal(savedMcq.response.status, 200);
    assert.equal(Number(savedMcq.body.autoScore), 2, 'Objective answer normalization should auto-grade correctly');

    const savedWritten = await request(`/exam-attempts/${attemptId}/answer`, studentToken, {
      method: 'PATCH',
      body: JSON.stringify({ questionId: written.id, answer: 'hello' }),
    });
    assert.equal(savedWritten.response.status, 200);
    assert.equal(savedWritten.body.autoScore, null, 'Written answer must wait for manual grading');

    const objectiveExamCreate = await createExam(teacherToken, {
      classId: fixture.classA.id,
      subjectId: fixture.subjectA.id,
      title: 'Objective CI Exam',
      durationMin: 30,
      passingMarks: 1,
      questions: [question('TRUE_FALSE', 'Two plus two equals four.', 1, 'true')],
    });
    assert.equal(objectiveExamCreate.response.status, 201);
    const objectiveStart = await request(`/exam-attempts/${objectiveExamCreate.body.id}/start`, studentToken, { method: 'POST' });
    assert.equal(objectiveStart.response.status, 200);
    const objectiveAttemptId = objectiveStart.body.attempt.id as string;
    const objectiveQuestionId = objectiveStart.body.exam.questions[0].id as string;

    const foreignQuestionAnswer = await request(`/exam-attempts/${attemptId}/answer`, studentToken, {
      method: 'PATCH',
      body: JSON.stringify({ questionId: objectiveQuestionId, answer: true }),
    });
    assert.equal(foreignQuestionAnswer.response.status, 400, 'Answer endpoint must reject a question from another exam');

    const objectiveAnswer = await request(`/exam-attempts/${objectiveAttemptId}/answer`, studentToken, {
      method: 'PATCH',
      body: JSON.stringify({ questionId: objectiveQuestionId, answer: 'TRUE' }),
    });
    assert.equal(objectiveAnswer.response.status, 200);
    assert.equal(Number(objectiveAnswer.body.autoScore), 1);
    const objectiveSubmit = await request(`/exam-attempts/${objectiveAttemptId}/submit`, studentToken, { method: 'POST' });
    assert.equal(objectiveSubmit.response.status, 200);
    assert.equal(objectiveSubmit.body.status, 'GRADED', 'Objective-only exam should grade immediately');
    assert.equal(Number(objectiveSubmit.body.score), 1);
    assert.equal(Number(objectiveSubmit.body.percentage), 100);
    assert.equal(objectiveSubmit.body.passed, true);

    const submitted = await request(`/exam-attempts/${attemptId}/submit`, studentToken, { method: 'POST' });
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.body.status, 'PENDING_REVIEW', 'Exam with written question must require manual review');

    const earlyResult = await request(`/exam-attempts/${attemptId}/result`, studentToken);
    assert.equal(earlyResult.response.status, 403, 'Student must not see result before manual grading completes');

    const review = await request('/exam-attempts/review', teacherToken);
    assert.equal(review.response.status, 200);
    const reviewAttempt = review.body.find((item: any) => item.id === attemptId);
    assert.ok(reviewAttempt, 'Creating Teacher must see pending review attempt');
    const writtenAnswer = reviewAttempt.answers.find((answer: any) => answer.question.type === 'SHORT_ANSWER');
    assert.ok(writtenAnswer);

    const excessiveGrade = await request(`/exam-attempts/${attemptId}/grade`, teacherToken, {
      method: 'PATCH',
      body: JSON.stringify({ answers: [{ answerId: writtenAnswer.id, score: 4 }] }),
    });
    assert.equal(excessiveGrade.response.status, 400, 'Manual score above question marks must be rejected');

    const graded = await request(`/exam-attempts/${attemptId}/grade`, teacherToken, {
      method: 'PATCH',
      body: JSON.stringify({
        answers: [{ answerId: writtenAnswer.id, score: 3, feedback: 'Correct' }],
        teacherFeedback: 'Good work',
      }),
    });
    assert.equal(graded.response.status, 200);
    assert.equal(graded.body.status, 'GRADED');
    assert.equal(Number(graded.body.score), 5);
    assert.equal(Number(graded.body.percentage), 100);
    assert.equal(graded.body.passed, true);

    const ownResult = await request(`/exam-attempts/${attemptId}/result`, studentToken);
    assert.equal(ownResult.response.status, 200);
    const otherResult = await request(`/exam-attempts/${attemptId}/result`, otherStudentToken);
    assert.equal(otherResult.response.status, 403, 'Another Student must not read someone else’s exam result');

    const restartCompleted = await request(`/exam-attempts/${mixedExamId}/start`, studentToken, { method: 'POST' });
    assert.equal(restartCompleted.response.status, 409, 'Completed exam attempt must not be startable again');
    assert.equal(await prisma.examAttempt.count({ where: { examId: mixedExamId, studentUserId: fixture.studentAUser.id } }), 1);

    const validTxt = await request('/exam-import/preview', teacherToken, {
      method: 'POST',
      body: JSON.stringify({
        format: 'txt',
        text: 'TYPE: MCQ\nQ: What is 2 + 2?\nA) 3\nB) 4\nANSWER: B\nMARKS: 2\n\nTYPE: SHORT_ANSWER\nQ: Say hello\nMARKS: 3',
      }),
    });
    assert.equal(validTxt.response.status, 200);
    assert.equal(validTxt.body.questions.length, 2);
    assert.equal(validTxt.body.issues.length, 0);
    assert.equal(validTxt.body.totalMarks, 5);

    const malformedCsv = await request('/exam-import/preview', teacherToken, {
      method: 'POST',
      body: JSON.stringify({
        format: 'csv',
        text: 'type,prompt,marks,optionA,optionB,answer\nMCQ,Broken objective,2,One,Two,',
      }),
    });
    assert.equal(malformedCsv.response.status, 200);
    assert.equal(malformedCsv.body.questions.length, 0);
    assert.ok(malformedCsv.body.issues.some((issue: any) => String(issue.message).includes('no correct option')));

    const emptyImport = await request('/exam-import/preview', teacherToken, {
      method: 'POST',
      body: JSON.stringify({ format: 'csv', text: 'type,prompt,marks' }),
    });
    assert.equal(emptyImport.response.status, 400, 'Header-only CSV must be rejected');

    console.log('Exam flow and import integration tests passed');
  } finally {
    await closeChild(child);
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  try { await cleanup(); } catch {}
  await prisma.$disconnect();
  process.exitCode = 1;
});
