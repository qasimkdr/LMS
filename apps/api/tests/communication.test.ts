import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';
import { cleanupChat } from '../src/routes/chat';

type Client = Awaited<ReturnType<typeof setupSchool>>['principal'];

beforeEach(async () => {
  await resetDb();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.${Math.random()}` }] }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

/** Class 5 (A, B): t1 class teacher of A + English in A; t2 Maths in B. Students Ali, Sara (A), Dani (B). */
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
  const t2 = await createUser({ role: 'TEACHER', username: 't2', schoolId });
  await principal.put('/api/setup/assignments', { sectionId: secA, subjectId: sub('English'), teacherId: t1.id });
  await principal.put('/api/setup/assignments', { sectionId: secB, subjectId: sub('Maths'), teacherId: t2.id });
  await principal.patch(`/api/setup/sections/${secA}`, { classTeacherId: t1.id });
  const add = async (name: string, sectionId: string, phone: string) => {
    const r = (await principal.post('/api/students', { student: { fullName: name, gender: 'MALE', classId: cls.id, sectionId, dob: '2015-01-01' }, guardians: [{ relation: 'FATHER', fullName: `${name} Sr`, phone }] })).body;
    const p = r.logins.find((l: { role: string }) => l.role === 'PARENT');
    const st = r.logins.find((l: { role: string }) => l.role === 'STUDENT');
    await prisma.user.updateMany({ where: { username: { in: [p.username, st.username] } }, data: { mustChangePassword: false } });
    return { id: r.studentId as string, parent: p as { username: string; tempPassword: string }, login: st as { username: string; tempPassword: string } };
  };
  const ali = await add('Ali', secA, '03001110001');
  const sara = await add('Sara', secA, '03001110002');
  const dani = await add('Dani', secB, '03001110003');
  return { cls, secA, secB, t1, t2, ali, sara, dani };
}

describe('class chat', () => {
  it('students and teachers of a section chat; teachers moderate; messages older than 30 days are removed', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, secB, ali, sara, dani } = await school(principal, schoolId);
    const a = await login(ali.login.username, ali.login.tempPassword);
    const s = await login(sara.login.username, sara.login.tempPassword);
    const d = await login(dani.login.username, dani.login.tempPassword);
    const t1 = await login('t1');

    expect((await a.get('/api/chat/rooms')).body.rooms.map((r: { sectionId: string }) => r.sectionId)).toEqual([secA]);
    expect((await a.post(`/api/chat/rooms/${secA}/messages`, { text: 'Hello class!' })).status).toBe(201);
    const first = (await s.get(`/api/chat/rooms/${secA}`)).body;
    expect(first.messages[0]).toMatchObject({ text: 'Hello class!', sender: { fullName: 'Ali' } });
    expect(first.canSend).toBe(true);
    // Reply
    expect((await s.post(`/api/chat/rooms/${secA}/messages`, { text: 'Hi Ali', replyToId: first.messages[0].id })).status).toBe(201);
    // Other sections cannot see it; parents have no chat
    expect((await d.get(`/api/chat/rooms/${secA}`)).status).toBe(404);
    expect((await d.post(`/api/chat/rooms/${secB}/messages`, { text: 'B here' })).status).toBe(201);
    const parent = await login(ali.parent.username, ali.parent.tempPassword);
    expect((await parent.get('/api/chat/rooms')).status).toBe(403);

    // Announcement mode and mute
    await t1.put(`/api/chat/rooms/${secA}/mode`, { mode: 'TEACHERS_ONLY' });
    expect((await a.post(`/api/chat/rooms/${secA}/messages`, { text: 'x' })).status).toBe(403);
    expect((await t1.post(`/api/chat/rooms/${secA}/messages`, { text: 'Homework is on the diary page.' })).status).toBe(201);
    await t1.put(`/api/chat/rooms/${secA}/mode`, { mode: 'OPEN' });
    const aliUser = await prisma.user.findUniqueOrThrow({ where: { username: ali.login.username } });
    await t1.post(`/api/chat/rooms/${secA}/mute`, { userId: aliUser.id, minutes: 30 });
    expect((await a.post(`/api/chat/rooms/${secA}/messages`, { text: 'x' })).status).toBe(403);
    expect((await a.get(`/api/chat/rooms/${secA}`)).body.mutedUntil).toBeTruthy();

    // Report → teacher notified; students cannot delete others' messages; teacher can
    const msgs = (await s.get(`/api/chat/rooms/${secA}`)).body.messages;
    const aliMsg = msgs.find((m: { text: string }) => m.text === 'Hello class!');
    expect((await s.post(`/api/chat/messages/${aliMsg.id}/report`, { reason: 'Spam' })).status).toBe(200);
    expect(await prisma.notification.count({ where: { type: 'CHAT', userId: (await prisma.user.findUniqueOrThrow({ where: { username: 't1' } })).id } })).toBe(1);
    expect((await t1.get(`/api/chat/rooms/${secA}`)).body.messages.find((m: { id: string }) => m.id === aliMsg.id).reported).toBe(true);
    expect((await s.del(`/api/chat/messages/${aliMsg.id}`)).status).toBe(403);

    // 30-day cleanup keeps unreviewed reported messages
    await prisma.chatMessage.updateMany({ where: { schoolId }, data: { createdAt: new Date(Date.now() - 31 * 86400000) } });
    await cleanupChat();
    expect((await prisma.chatMessage.findMany({ where: { schoolId } })).map((m) => m.text)).toEqual(['Hello class!']);
    await t1.post(`/api/chat/messages/${aliMsg.id}/review`);
    await cleanupChat();
    expect(await prisma.chatMessage.count({ where: { schoolId } })).toBe(0);

    // Principal can switch class chat off
    await principal.put('/api/chat/settings', { classChatEnabled: false });
    expect((await s.post(`/api/chat/rooms/${secA}/messages`, { text: 'x' })).status).toBe(403);
  });
});

describe('parent–teacher messages and complaints', () => {
  it("parents message only their child's teachers; the principal sees all; complaints are tickets", async () => {
    const { principal, schoolId } = await setupSchool();
    const { ali, t1, t2 } = await school(principal, schoolId);
    const parent = await login(ali.parent.username, ali.parent.tempPassword);
    const teachers = (await parent.get('/api/conversations/teachers')).body.children[0].teachers;
    expect(teachers).toEqual([expect.objectContaining({ id: t1.id, classTeacher: true, subjects: ['English'] })]);
    expect((await parent.post('/api/conversations', { studentId: ali.id, teacherId: t2.id, text: 'Hi' })).status).toBe(403);
    const c = await parent.post('/api/conversations', { studentId: ali.id, teacherId: t1.id, kind: 'QUERY', text: 'When is the English test?' });
    expect(c.status).toBe(201);

    const tc = await login('t1');
    const inbox = (await tc.get('/api/conversations')).body.conversations;
    expect(inbox[0]).toMatchObject({ kind: 'QUERY', unread: 1, student: { fullName: 'Ali' } });
    const thread = (await tc.get(`/api/conversations/${c.body.id}`)).body;
    expect(thread.messages[0]).toMatchObject({ text: 'When is the English test?', mine: false });
    await tc.post(`/api/conversations/${c.body.id}/messages`, { text: 'On Friday.' });
    const pv = (await parent.get(`/api/conversations/${c.body.id}`)).body.messages;
    expect(pv[0].readAt).toBeTruthy(); // read tick
    expect(pv[1]).toMatchObject({ text: 'On Friday.', mine: false });
    // Principal reads all, cannot write; teacher forwards
    expect((await principal.get('/api/conversations?all=true')).body.conversations).toHaveLength(1);
    expect((await principal.post(`/api/conversations/${c.body.id}/messages`, { text: 'x' })).status).toBe(403);
    expect((await tc.post(`/api/conversations/${c.body.id}/forward`, { note: 'Please see' })).status).toBe(200);

    // Message hours: outside hours the parent gets an automatic reply (once)
    await tc.put('/api/conversations/settings/hours', { enabled: true, start: '00:00', end: '00:01' });
    await parent.post(`/api/conversations/${c.body.id}/messages`, { text: 'Thanks!' });
    await parent.post(`/api/conversations/${c.body.id}/messages`, { text: 'One more thing' });
    const auto = (await parent.get(`/api/conversations/${c.body.id}`)).body.messages.filter((m: { isAuto: boolean }) => m.isAuto);
    expect(auto).toHaveLength(1);

    // Complaint
    const comp = await parent.post('/api/complaints', { studentId: ali.id, category: 'FACILITIES', subject: 'Broken fan in class 5A', description: 'The fan has not worked for a week.', privateFromTeachers: true });
    expect(comp.body.ticketNo).toBe(1);
    const second = await parent.post('/api/complaints', { category: 'FEES', subject: 'Fee voucher question', description: 'Why is there a late fee?' });
    expect(second.body.ticketNo).toBe(2);
    const list = (await principal.get('/api/complaints')).body;
    expect(list.counts).toMatchObject({ NEW: 2 });
    // Private from teachers: cannot be assigned to a teacher
    expect((await principal.patch(`/api/complaints/${comp.body.id}`, { assignedToId: t1.id })).status).toBe(400);
    await principal.post(`/api/complaints/${comp.body.id}/entries`, { kind: 'NOTE', text: 'Ask the caretaker.' });
    await principal.post(`/api/complaints/${comp.body.id}/entries`, { text: 'Thank you, we are fixing it.' });
    await principal.patch(`/api/complaints/${comp.body.id}`, { status: 'RESOLVED' });
    const pview = (await parent.get(`/api/complaints/${comp.body.id}`)).body;
    expect(pview.complaint.status).toBe('RESOLVED');
    expect(pview.entries.map((e: { kind: string }) => e.kind)).toEqual(['REPLY', 'STATUS']); // internal note hidden
    // Parent reply reopens a resolved complaint
    await parent.post(`/api/complaints/${comp.body.id}/entries`, { text: 'Still not working.' });
    expect((await principal.get(`/api/complaints/${comp.body.id}`)).body.complaint.status).toBe('IN_PROGRESS');
    // Teachers cannot see complaints not assigned to them
    expect((await tc.get(`/api/complaints/${comp.body.id}`)).status).toBe(404);
  });
});

describe('circulars, gate pass and gallery', () => {
  it('circulars reach the chosen parents with read receipts', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, ali, dani } = await school(principal, schoolId);
    const r = await principal.post('/api/circulars', { title: 'Sports day on Friday', body: 'Wear house colours.', audience: 'SECTIONS', sectionIds: [secA], includeStaff: true });
    expect(r.body.recipients).toBe(4); // 2 parents + 2 teachers
    const pa = await login(ali.parent.username, ali.parent.tempPassword);
    const pd = await login(dani.parent.username, dani.parent.tempPassword);
    expect((await pd.get('/api/circulars')).body.circulars).toHaveLength(0);
    const mine = (await pa.get('/api/circulars')).body.circulars;
    expect(mine[0]).toMatchObject({ title: 'Sports day on Friday', read: false });
    await pa.get(`/api/circulars/${r.body.id}`);
    expect((await pa.get('/api/circulars')).body.circulars[0].read).toBe(true);
    const rec = (await principal.get(`/api/circulars/${r.body.id}/receipts`)).body;
    expect(rec).toMatchObject({ total: 4, read: 1 });
    expect(rec.rows.find((x: { readAt: string | null }) => x.readAt).children[0]).toContain('Ali');
    expect((await pa.get(`/api/circulars/${r.body.id}/receipts`)).status).toBe(403);
  });

  it('gate pass is recorded and parents are told', async () => {
    const { principal, schoolId } = await setupSchool();
    const { ali, dani } = await school(principal, schoolId);
    await prisma.messagingSettings.upsert({ where: { schoolId }, create: { schoolId, verifyToken: 'x', whatsappEnabled: true, status: 'CONNECTED', phoneNumberId: '1', accessTokenEnc: 'x' }, update: { whatsappEnabled: true, status: 'CONNECTED', phoneNumberId: '1', accessTokenEnc: 'x' } });
    const t1 = await login('t1');
    const g = await t1.post('/api/gate-passes', { studentId: ali.id, reason: 'Fever', pickedUpBy: 'Ali Sr', relation: 'Father' });
    expect(g.body).toMatchObject({ passNo: 1, whatsapp: 1 });
    expect((await t1.post('/api/gate-passes', { studentId: dani.id, reason: 'Sick', pickedUpBy: 'Someone', relation: 'Uncle' })).status).toBe(403); // not their class
    const pa = await login(ali.parent.username, ali.parent.tempPassword);
    expect((await pa.get('/api/gate-passes')).body.passes[0]).toMatchObject({ reason: 'Fever', pickedUpBy: 'Ali Sr' });
    expect(await prisma.notification.count({ where: { type: 'GATE_PASS' } })).toBe(1);
  });

  it('gallery photos are compressed with thumbnails and shown only to allowed viewers', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, ali } = await school(principal, schoolId);
    await prisma.plan.updateMany({ data: { storageLimitMb: 50, maxFileSizeMb: 5 } });
    const jpg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#3b82f6' } }).jpeg({ quality: 95 }).toBuffer();
    const album = await principal.post('/api/gallery/albums', { title: 'Sports day 2026', eventDate: '2026-11-10' });
    const staffAlbum = await principal.post('/api/gallery/albums', { title: 'Staff dinner', visibility: 'STAFF' });
    await principal.post('/api/gallery/albums', { title: 'Class 5 trip', visibility: 'CLASSES', classIds: [cls.id] });
    const up = await principal.agent.post(`/api/gallery/albums/${album.body.id}/photos`).set('X-Requested-With', 'fetch').attach('files', jpg, { filename: 'race.jpg', contentType: 'image/jpeg' }).attach('files', Buffer.from('nope'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ added: 1, failed: ['x.jpg'] });
    const photo = await prisma.albumPhoto.findFirstOrThrow({ where: { albumId: album.body.id } });
    expect(photo).toMatchObject({ width: 1920, height: 1280 });
    const files = await prisma.storedFile.findMany({ where: { id: { in: [photo.fileId, photo.thumbFileId!] } } });
    expect(files.every((f) => f.mimeType === 'image/webp')).toBe(true);
    const pa = await login(ali.parent.username, ali.parent.tempPassword);
    const albums = (await pa.get('/api/gallery/albums')).body.albums.map((a: { title: string }) => a.title).sort();
    expect(albums).toEqual(['Class 5 trip', 'Sports day 2026']);
    expect((await pa.get(`/api/gallery/albums/${staffAlbum.body.id}`)).status).toBe(404);
    expect((await pa.post('/api/gallery/albums', { title: 'Mine' })).status).toBe(403);
  });
});

describe('dashboards and exports', () => {
  it('each role gets its dashboard; reports download as Excel for those allowed', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, ali } = await school(principal, schoolId);
    const pd = (await principal.get('/api/dashboard')).body;
    expect(pd).toMatchObject({ role: 'MANAGER', students: { total: 3, boys: 3 }, staff: { teachers: 2 } });
    expect(pd.classStrength).toEqual([{ label: 'Class 5', count: 3 }]);
    const t1 = await login('t1');
    const td = (await t1.get('/api/dashboard')).body;
    expect(td.role).toBe('TEACHER');
    expect(td.sections).toEqual([expect.objectContaining({ id: secA, classTeacher: true, students: 2, subjects: ['English'] })]);
    const pa = await login(ali.parent.username, ali.parent.tempPassword);
    const fd = (await pa.get('/api/dashboard')).body;
    expect(fd.role).toBe('FAMILY');
    expect(fd.children[0].student.fullName).toBe('Ali');

    const list = (await principal.get('/api/reports')).body.reports.map((r: { key: string }) => r.key);
    expect(list).toEqual(expect.arrayContaining(['students', 'attendance-register', 'fee-collection', 'results']));
    const xl = await principal.agent.get('/api/reports/students').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xl.status).toBe(200);
    expect(xl.headers['content-type']).toContain('spreadsheetml');
    expect((xl.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // xlsx is a zip
    expect((await principal.get(`/api/reports/attendance-register?sectionId=${secA}&month=2026-11`)).status).toBe(200);
    expect((await t1.get('/api/reports/students')).status).toBe(403);
    expect((await pa.get('/api/reports')).body.reports).toEqual([]);
  });
});
