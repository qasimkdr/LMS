import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';
import { autoDigests } from '../src/services/lms';

type Client = Awaited<ReturnType<typeof setupSchool>>['principal'];

beforeEach(async () => {
  await resetDb();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.${Math.random()}` }] }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

const png = { name: 'notes.png', content: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), type: 'image/png' };

/** Class 5 (A, B): t1 teaches English in A and is class teacher of A; t2 teaches Maths in A and B. */
async function school(principal: Client, schoolId: string) {
  await principal.post('/api/setup/classes', { name: 'Class 5', sections: ['A', 'B'] });
  await principal.post('/api/setup/subjects', { names: ['English', 'Maths', 'Urdu'] });
  const s = (await principal.get('/api/setup/structure')).body;
  const cls = s.classes[0];
  const sub = (n: string) => s.subjects.find((x: { name: string }) => x.name === n).id;
  await principal.put(`/api/setup/classes/${cls.id}/subjects`, { subjects: ['English', 'Maths', 'Urdu'].map((n) => ({ subjectId: sub(n) })) });
  const secA = cls.sections.find((x: { name: string }) => x.name === 'A').id;
  const secB = cls.sections.find((x: { name: string }) => x.name === 'B').id;
  const t1 = await createUser({ role: 'TEACHER', username: 't1', schoolId });
  const t2 = await createUser({ role: 'TEACHER', username: 't2', schoolId });
  await principal.put('/api/setup/assignments', { sectionId: secA, subjectId: sub('English'), teacherId: t1.id });
  await principal.put('/api/setup/assignments', { sectionId: secA, subjectId: sub('Maths'), teacherId: t2.id });
  await principal.put('/api/setup/assignments', { sectionId: secB, subjectId: sub('Maths'), teacherId: t2.id });
  await principal.patch(`/api/setup/sections/${secA}`, { classTeacherId: t1.id });
  const add = async (name: string, sectionId: string, phone: string) => {
    const r = (await principal.post('/api/students', { student: { fullName: name, gender: 'MALE', classId: cls.id, sectionId, dob: '2015-01-01' }, guardians: [{ relation: 'FATHER', fullName: `${name} Sr`, phone }] })).body;
    const p = r.logins.find((l: { role: string }) => l.role === 'PARENT');
    await prisma.user.update({ where: { username: p.username }, data: { mustChangePassword: false } });
    return { id: r.studentId as string, parent: p as { username: string; tempPassword: string } };
  };
  const ali = await add('Ali', secA, '03001110001');
  const sara = await add('Sara', secA, '03001110002');
  const dani = await add('Dani', secB, '03001110003');
  return { cls, secA, secB, english: sub('English'), maths: sub('Maths'), urdu: sub('Urdu'), ali, sara, dani };
}

describe('syllabus', () => {
  it('subject teachers write the syllabus and mark progress per section; principal sees coverage; parents see progress', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, secB, english, maths, ali } = await school(principal, schoolId);
    const t1 = await login('t1');
    const t2 = await login('t2');
    // t2 does not teach English
    expect((await t2.put('/api/lms/syllabus', { classId: cls.id, subjectId: english, chapters: [{ title: 'X' }] })).status).toBe(403);
    const saved = await t1.put('/api/lms/syllabus', {
      classId: cls.id,
      subjectId: english,
      chapters: [
        { title: 'Ch 1: Nouns', term: 'First term', topics: [{ title: 'Common nouns' }, { title: 'Proper nouns' }] },
        { title: 'Ch 2: Poem – Daffodils', term: 'First term' },
        { title: 'Ch 3: Verbs', term: 'Second term', topics: [{ title: 'Tenses' }] },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ total: 4, completed: 0 }); // 3 topics + 1 chapter without topics

    const syl = (await t1.get(`/api/lms/syllabus?classId=${cls.id}&subjectId=${english}&sectionId=${secA}`)).body;
    expect(syl).toMatchObject({ canEdit: true, canMark: true });
    const [ch1, ch2] = syl.chapters;
    const r = await t1.put('/api/lms/syllabus/progress', { sectionId: secA, subjectId: english, itemIds: [ch1.topics[0].id, ch2.id], done: true, date: '2026-11-10' });
    expect(r.body).toMatchObject({ completed: 2, percent: 50 });
    // A chapter with topics is not itself a checkbox; t1 cannot mark section B (not their class)
    expect((await t1.put('/api/lms/syllabus/progress', { sectionId: secA, subjectId: english, itemIds: [ch1.id], done: true })).status).toBe(400);
    expect((await t1.put('/api/lms/syllabus/progress', { sectionId: secB, subjectId: english, itemIds: [ch2.id], done: true })).status).toBe(403);

    // Editing keeps progress for items sent back with their id; removed items lose it
    await t1.put('/api/lms/syllabus', { classId: cls.id, subjectId: english, chapters: [{ id: ch1.id, title: 'Ch 1: Nouns', topics: [{ id: ch1.topics[0].id, title: 'Common nouns' }] }, { id: ch2.id, title: 'Ch 2: Daffodils' }] });
    const after = (await t1.get(`/api/lms/syllabus?classId=${cls.id}&subjectId=${english}&sectionId=${secA}`)).body;
    expect(after).toMatchObject({ total: 2, completed: 2, percent: 100 });
    expect(after.chapters[1].done).toMatchObject({ completedOn: '2026-11-10', by: 't1' });

    const cov = (await principal.get('/api/lms/syllabus/coverage')).body.rows;
    expect(cov.find((x: { sectionId: string; subjectId: string }) => x.sectionId === secA && x.subjectId === english)).toMatchObject({ total: 2, completed: 2, percent: 100, teacher: 't1' });
    expect(cov.find((x: { sectionId: string; subjectId: string }) => x.sectionId === secB && x.subjectId === english)).toMatchObject({ total: 2, completed: 0, percent: 0 });
    expect(cov.find((x: { sectionId: string; subjectId: string }) => x.sectionId === secA && x.subjectId === maths)).toMatchObject({ total: 0, percent: null });
    // Teacher coverage is limited to their classes
    const t2cov = (await t2.get('/api/lms/syllabus/coverage')).body.rows;
    expect(t2cov.every((x: { subjectId: string }) => x.subjectId === maths)).toBe(true);

    const parent = await login(ali.parent.username, ali.parent.tempPassword);
    const mine = (await parent.get('/api/lms/syllabus/my')).body.children[0];
    expect(mine.subjects).toHaveLength(1);
    expect(mine.subjects[0]).toMatchObject({ subject: { name: 'English' }, percent: 100 });
    expect((await parent.get(`/api/lms/syllabus?classId=${cls.id}&subjectId=${english}`)).status).toBe(403);
  });
});

describe('study material and documents', () => {
  it('teachers share material with their classes; families see what is meant for their section', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, secB, english, maths, ali, dani } = await school(principal, schoolId);
    const t1 = await login('t1');
    const up = await t1.upload('/api/files', { category: 'STUDY_MATERIAL' }, png);
    expect(up.status).toBe(201);
    expect((await t1.post('/api/lms/material', { classId: cls.id, subjectId: english, kind: 'NOTES', title: 'Noun notes', fileIds: [up.body.file.id], sectionIds: [secA] })).status).toBe(201);
    expect((await t1.post('/api/lms/material', { classId: cls.id, subjectId: english, kind: 'VIDEO', title: 'Nouns video', url: 'https://www.youtube.com/watch?v=abc' })).status).toBe(201);
    // Not allowed: subject they don't teach, a javascript: link, nothing attached
    expect((await t1.post('/api/lms/material', { classId: cls.id, subjectId: maths, kind: 'NOTES', title: 'Maths', url: 'https://x.org', sectionIds: [secB] })).status).toBe(403);
    expect((await t1.post('/api/lms/material', { classId: cls.id, subjectId: english, kind: 'LINK', title: 'Bad', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await t1.post('/api/lms/material', { classId: cls.id, subjectId: english, kind: 'NOTES', title: 'Empty' })).status).toBe(400);

    const pa = await login(ali.parent.username, ali.parent.tempPassword);
    const a = (await pa.get('/api/lms/material/my')).body.children[0].material;
    expect(a.map((m: { title: string }) => m.title).sort()).toEqual(['Noun notes', 'Nouns video']);
    expect(a.find((m: { title: string }) => m.title === 'Noun notes').files[0]).toMatchObject({ name: 'notes.png' });
    const pd = await login(dani.parent.username, dani.parent.tempPassword);
    expect((await pd.get('/api/lms/material/my')).body.children[0].material.map((m: { title: string }) => m.title)).toEqual(['Nouns video']);
    // Parents can download the file
    expect((await pa.get(`/api/files/${up.body.file.id}/download`)).status).toBe(200);
    // Only the author or principal can delete
    const id = a[0].id;
    const t2 = await login('t2');
    expect((await t2.del(`/api/lms/material/${id}`)).status).toBe(403);
    expect((await principal.del(`/api/lms/material/${id}`)).status).toBe(200);
  });

  it('school documents are shown only to the chosen roles', async () => {
    const { principal, schoolId } = await setupSchool();
    const { ali } = await school(principal, schoolId);
    const up = await principal.upload('/api/files', { category: 'SCHOOL_DOCUMENT' }, png);
    await principal.post('/api/lms/documents', { title: 'Staff leave policy', fileId: up.body.file.id, audience: ['STAFF', 'TEACHER'] });
    await principal.post('/api/lms/documents', { title: 'School rules', fileId: up.body.file.id, audience: ['PARENT', 'STUDENT', 'TEACHER'] });
    const t1 = await login('t1');
    expect((await t1.get('/api/lms/documents')).body.documents).toHaveLength(2);
    const pa = await login(ali.parent.username, ali.parent.tempPassword);
    expect((await pa.get('/api/lms/documents')).body.documents.map((d: { title: string }) => d.title)).toEqual(['School rules']);
    expect((await t1.post('/api/lms/documents', { title: 'X', fileId: up.body.file.id, audience: ['PARENT'] })).status).toBe(403);
  });
});

describe('homework / diary', () => {
  it('teachers post homework for their subjects; parents see the day; the diary digest goes out once', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, secB, english, maths, urdu, ali } = await school(principal, schoolId);
    await prisma.messagingSettings.upsert({ where: { schoolId }, create: { schoolId, verifyToken: 'x', whatsappEnabled: true, status: 'CONNECTED', phoneNumberId: '1', accessTokenEnc: 'x', rules: { HOMEWORK: 'auto' } }, update: { whatsappEnabled: true, status: 'CONNECTED', phoneNumberId: '1', accessTokenEnc: 'x', rules: { HOMEWORK: 'auto' } } });
    const t1 = await login('t1');
    const t2 = await login('t2');
    const day = '2026-11-16';
    expect((await t1.post('/api/lms/homework', { sectionId: secA, subjectId: english, date: day, dueDate: '2026-11-17', text: 'Learn 10 spellings on page 12.' })).status).toBe(201);
    expect((await t2.post('/api/lms/homework', { sectionId: secA, subjectId: maths, date: day, text: 'Exercise 3.2, questions 1 to 5.' })).status).toBe(201);
    // Class teacher may post any subject of their class (school setting on by default)…
    expect((await t1.post('/api/lms/homework', { sectionId: secA, subjectId: urdu, date: day, text: 'Write 5 sentences.' })).status).toBe(201);
    // …but not for another section, and a subject teacher not other subjects
    expect((await t1.post('/api/lms/homework', { sectionId: secB, subjectId: english, date: day, text: 'No' })).status).toBe(403);
    expect((await t2.post('/api/lms/homework', { sectionId: secA, subjectId: english, date: day, text: 'No' })).status).toBe(403);
    expect((await t1.post('/api/lms/homework', { sectionId: secA, subjectId: english, date: day, dueDate: '2026-11-01', text: 'Bad due date' })).status).toBe(400);

    const list = (await t1.get(`/api/lms/homework?sectionId=${secA}&date=${day}`)).body;
    expect(list.homework).toHaveLength(3);
    expect(list.canSend).toBe(true);
    expect((await t2.get(`/api/lms/homework?sectionId=${secA}&date=${day}`)).body.canSend).toBe(false);

    const pa = await login(ali.parent.username, ali.parent.tempPassword);
    const mine = (await pa.get(`/api/lms/homework/my?date=${day}`)).body.children[0];
    expect(mine.homework.map((h: { subject: string }) => h.subject).sort()).toEqual(['English', 'Maths', 'Urdu']);
    expect(mine.days[0]).toMatchObject({ date: day, count: 3 });

    // Automatic digest: not before the diary time (16:00 Karachi = 11:00 UTC), then once per section
    expect(await autoDigests(new Date('2026-11-16T10:30:00Z'))).toBe(0);
    expect(await autoDigests(new Date('2026-11-16T11:05:00Z'))).toBe(1);
    expect(await autoDigests(new Date('2026-11-16T11:10:00Z'))).toBe(0);
    const msgs = await prisma.message.findMany({ where: { type: 'HOMEWORK' } });
    expect(msgs).toHaveLength(2); // Ali and Sara's fathers
    expect(msgs[0].body).toContain('Learn 10 spellings on page 12.');
    expect(msgs[0].body).not.toContain('\n');
    expect(await prisma.notification.count({ where: { type: 'HOMEWORK' } })).toBe(4); // parent + student each

    // Manual re-send by class teacher only
    expect((await t2.post('/api/lms/homework/send', { sectionId: secA, date: day })).status).toBe(403);
    expect((await t1.post('/api/lms/homework/send', { sectionId: secA, date: day })).body).toMatchObject({ students: 2, items: 3 });
    expect((await t1.post('/api/lms/homework/send', { sectionId: secA, date: '2026-11-15' })).status).toBe(400);
  });
});
