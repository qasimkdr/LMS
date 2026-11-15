import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';
import { processOutbox } from '../src/services/messaging';
import { schoolToday, percent } from '../src/routes/attendance';
import { normalizePhone } from '../src/services/whatsapp';

type Client = Awaited<ReturnType<typeof setupSchool>>['principal'];

// ---- Fake Meta Graph API ----
let graphCalls: { url: string; body: Record<string, unknown> | null }[] = [];
let nextResponses: { status: number; json: unknown }[] = [];
function fakeFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    graphCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = nextResponses.shift();
    if (r) return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    if (String(url).includes('/messages')) return new Response(JSON.stringify({ messages: [{ id: `wamid.${graphCalls.length}` }] }), { status: 200 });
    return new Response(JSON.stringify({ display_phone_number: '+92 300 0000000', verified_name: 'Alpha School' }), { status: 200 });
  });
}

beforeEach(async () => {
  await resetDb();
  graphCalls = [];
  nextResponses = [];
  vi.stubGlobal('fetch', fakeFetch());
});
afterEach(() => vi.unstubAllGlobals());

const today = () => schoolToday('Asia/Karachi');

async function school(principal: Client, schoolId: string) {
  await principal.post('/api/setup/classes', { name: 'Class 5', sections: ['A', 'B'] });
  const s = (await principal.get('/api/setup/structure')).body;
  const cls = s.classes[0];
  const secA = cls.sections.find((x: { name: string }) => x.name === 'A').id;
  const secB = cls.sections.find((x: { name: string }) => x.name === 'B').id;
  const teacher = await createUser({ role: 'TEACHER', username: 'ct', schoolId });
  const other = await createUser({ role: 'TEACHER', username: 'other', schoolId });
  await principal.patch(`/api/setup/sections/${secA}`, { classTeacherId: teacher.id });
  const add = async (name: string, father: string, phone: string, sectionId = secA, familyId?: string) =>
    (
      await principal.post('/api/students', {
        student: { fullName: name, gender: 'MALE', classId: cls.id, sectionId, dob: '2015-01-01' },
        ...(familyId ? { familyId } : { guardians: [{ relation: 'FATHER', fullName: father, phone }, { relation: 'MOTHER', fullName: `${father} wife`, phone: '03110000000' }] }),
      })
    ).body;
  const ali = await add('Ali Raza', 'Raza Ahmed', '03001234567');
  const sara = await add('Sara Khan', 'Imran Khan', '03005555555');
  const fam = await prisma.student.findUniqueOrThrow({ where: { id: ali.studentId } });
  const hira = await add('Hira Raza', '', '', secB, fam.familyId); // Ali's sister in section B
  return { cls, secA, secB, teacher, other, ali, sara, hira };
}

async function connectWhatsapp(principal: Client, rules: Record<string, string> = {}) {
  const r = await principal.put('/api/messaging/settings', { whatsappEnabled: true, phoneNumberId: '1234567890', accessToken: 'EAAG-test-token-1234567890', rules });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.settings.status).toBe('CONNECTED');
  return r.body.settings;
}

describe('phone numbers and percentages', () => {
  it('normalizes Pakistani numbers', () => {
    expect(normalizePhone('0300-1234567')).toBe('923001234567');
    expect(normalizePhone('+92 300 1234567')).toBe('923001234567');
    expect(normalizePhone('00923001234567')).toBe('923001234567');
    expect(normalizePhone('12')).toBeNull();
  });
  it('computes attendance %', () => {
    expect(percent({ PRESENT: 18, ABSENT: 1, LATE: 1 })).toBe(95);
    expect(percent({ PRESENT: 1, HALF_DAY: 1 })).toBe(75);
    expect(percent({})).toBeNull();
  });
});

describe('attendance', () => {
  it('class teacher marks today; other teachers cannot; past days only for the principal; no future dates', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, ali, sara } = await school(principal, schoolId);
    const ct = await login('ct');
    const get = await ct.get(`/api/attendance/sections/${secA}`);
    expect(get.body.canEdit).toBe(true);
    expect(get.body.students).toHaveLength(2);
    const mark = await ct.put(`/api/attendance/sections/${secA}`, { date: today(), records: [{ studentId: ali.studentId, status: 'PRESENT' }, { studentId: sara.studentId, status: 'LATE' }] });
    expect(mark.status).toBe(200);
    expect((await ct.get(`/api/attendance/sections/${secA}`)).body.marked).toBe(true);

    expect((await (await login('other')).put(`/api/attendance/sections/${secA}`, { date: today(), records: [{ studentId: ali.studentId, status: 'ABSENT' }] })).status).toBe(403);
    expect((await ct.put(`/api/attendance/sections/${secA}`, { date: '2026-01-05', records: [{ studentId: ali.studentId, status: 'ABSENT' }] })).status).toBe(403);
    expect((await principal.put(`/api/attendance/sections/${secA}`, { date: '2026-01-05', records: [{ studentId: ali.studentId, status: 'ABSENT' }], reason: 'Late entry' })).status).toBe(200);
    expect((await principal.put(`/api/attendance/sections/${secA}`, { date: '2099-01-01', records: [{ studentId: ali.studentId, status: 'PRESENT' }] })).status).toBe(400);
    const log = await prisma.auditLog.findFirst({ where: { action: 'attendance.mark', reason: 'Late entry' } });
    expect(log).not.toBeNull();
  });

  it('register, student summary, today overview and parent view', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, ali, sara } = await school(principal, schoolId);
    await principal.put(`/api/attendance/sections/${secA}`, { date: '2026-03-02', records: [{ studentId: ali.studentId, status: 'PRESENT' }, { studentId: sara.studentId, status: 'ABSENT' }] });
    await principal.put(`/api/attendance/sections/${secA}`, { date: '2026-03-03', records: [{ studentId: ali.studentId, status: 'ABSENT' }, { studentId: sara.studentId, status: 'ABSENT' }] });
    const reg = (await principal.get(`/api/attendance/register?sectionId=${secA}&month=2026-03`)).body;
    expect(reg.days).toHaveLength(31);
    const aliRow = reg.students.find((s: { id: string }) => s.id === ali.studentId);
    expect(aliRow.days['2026-03-02']).toBe('PRESENT');
    expect(aliRow.percent).toBe(50);

    const sum = (await principal.get(`/api/attendance/students/${ali.studentId}?month=2026-03`)).body;
    expect(sum.month.counts).toEqual({ PRESENT: 1, ABSENT: 1 });

    const low = (await principal.get('/api/attendance/summary?month=2026-03&below=60')).body;
    expect(low.lowAttendance.map((l: { student: { fullName: string } }) => l.student.fullName).sort()).toEqual(['Ali Raza', 'Sara Khan']);

    const ov = (await principal.get('/api/attendance/today')).body;
    expect(ov.notMarked).toBe(2); // nothing marked today in A and B

    const parentUser = ali.logins.find((l: { role: string }) => l.role === 'PARENT');
    await prisma.user.update({ where: { username: parentUser.username }, data: { mustChangePassword: false } });
    const parent = await login(parentUser.username, parentUser.tempPassword);
    const my = (await parent.get('/api/attendance/my?month=2026-03')).body;
    expect(my.children.map((c: { student: { fullName: string } }) => c.student.fullName).sort()).toEqual(['Ali Raza', 'Hira Raza']);
    expect((await parent.get(`/api/attendance/students/${sara.studentId}`)).status).toBe(404);
  });
});

describe('absent alerts', () => {
  it('auto: marking absent queues one WhatsApp per guardian who gets messages, sends it, and never repeats', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, ali, sara } = await school(principal, schoolId);
    await connectWhatsapp(principal);
    const r = await principal.put(`/api/attendance/sections/${secA}`, { date: today(), records: [{ studentId: ali.studentId, status: 'ABSENT' }, { studentId: sara.studentId, status: 'PRESENT' }] });
    expect(r.body).toMatchObject({ whatsappQueued: 1, notified: 1 });

    graphCalls = [];
    expect(await processOutbox()).toBe(1);
    const call = graphCalls[0];
    expect(call.url).toMatch(/\/1234567890\/messages$/);
    expect(call.body).toMatchObject({ to: '923001234567', type: 'template', template: { name: 'absent_alert', language: { code: 'en' } } });
    const params = (call.body!.template as { components: { parameters: { text: string }[] }[] }).components[0].parameters.map((p) => p.text);
    expect(params[0]).toBe('Ali Raza');
    expect(params[1]).toBe('Class 5 A');
    expect(params[3]).toBe('School alpha');
    expect((await prisma.message.findFirstOrThrow()).status).toBe('SENT');

    // Saving again (or toggling) does not alert twice.
    await principal.put(`/api/attendance/sections/${secA}`, { date: today(), records: [{ studentId: ali.studentId, status: 'ABSENT' }] });
    expect(await prisma.message.count()).toBe(1);

    // Parent sees the in-app notification.
    const n = await prisma.notification.findFirstOrThrow();
    expect(n.title).toBe('Ali Raza is absent today');
  });

  it('manual: nothing goes until "send alerts"; off: only in-app; not connected: nothing queued', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, ali, sara } = await school(principal, schoolId);
    await connectWhatsapp(principal, { ABSENT: 'manual' });
    const r = await principal.put(`/api/attendance/sections/${secA}`, { date: today(), records: [{ studentId: ali.studentId, status: 'ABSENT' }, { studentId: sara.studentId, status: 'LATE' }] });
    expect(r.body.whatsappQueued).toBe(0);
    const send = await principal.post('/api/attendance/alerts', {});
    expect(send.body.queued).toBe(1); // late alerts are "off" by default
    expect((await principal.post('/api/attendance/alerts', {})).body.queued).toBe(0);

    await principal.put('/api/messaging/settings', { rules: { ABSENT: 'off' } });
    const r2 = await principal.put(`/api/attendance/sections/${secA}`, { date: today(), records: [{ studentId: sara.studentId, status: 'ABSENT' }] });
    expect(r2.body).toMatchObject({ whatsappQueued: 0, notified: 1 });

    await principal.put('/api/messaging/settings', { whatsappEnabled: false });
    expect((await principal.post('/api/attendance/alerts', {})).status).toBe(400);
  });
});

describe('WhatsApp settings', () => {
  it('keeps the token secret, reports connection errors, and sends a test message', async () => {
    const { principal } = await setupSchool();
    nextResponses.push({ status: 401, json: { error: { message: 'Error validating access token: Session has expired', code: 190 } } });
    const bad = await principal.put('/api/messaging/settings', { phoneNumberId: '1234567890', accessToken: 'EAAG-expired-token-123456' });
    expect(bad.body.settings.status).toBe('TOKEN_EXPIRED');
    expect(JSON.stringify(bad.body)).not.toContain('EAAG');
    const stored = await prisma.messagingSettings.findFirstOrThrow();
    expect(stored.accessTokenEnc).not.toContain('EAAG');

    const ok = await principal.post('/api/messaging/settings/check');
    expect(ok.body.settings.status).toBe('CONNECTED');
    expect(ok.body.settings.verifiedName).toBe('Alpha School');

    const t = await principal.post('/api/messaging/settings/test', { phone: '03001112233' });
    expect(t.status).toBe(200);
    expect(graphCalls.at(-1)!.body).toMatchObject({ to: '923001112233', template: { name: 'hello_world' } });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'messaging.settings' } });
    expect(JSON.stringify(audit.after)).not.toContain('EAAG');
  });

  it('is principal-only and needs the whatsapp module', async () => {
    const { principal, schoolId, planId } = await setupSchool();
    await createUser({ role: 'STAFF', username: 'clerk', schoolId, permissions: ['messages.send'] });
    expect((await (await login('clerk')).get('/api/messaging/settings')).status).toBe(403);
    await prisma.plan.update({ where: { id: planId }, data: { modules: ['attendance'] } });
    expect((await principal.get('/api/messaging/settings')).body.error.code).toBe('MODULE_DISABLED');
  });
});

describe('manual messages', () => {
  it('sends to a class, one message per parent number, plus in-app notices', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls } = await school(principal, schoolId);
    await connectWhatsapp(principal);
    const audience = { kind: 'classes', ids: [cls.id] };
    const prev = (await principal.post('/api/messaging/compose/preview', { message: 'School closed tomorrow', audience })).body;
    // 3 students, 2 families; Ali and Hira share a father.
    expect(prev.whatsappNumbers).toBe(2);
    expect(prev.appUsers).toBe(2);
    expect(prev.sample).toBe('Message from School alpha: School closed tomorrow Thank you.');

    const sent = await principal.post('/api/messaging/compose', { title: 'Holiday', message: 'School closed tomorrow', audience, channels: { whatsapp: true, inApp: true } });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ whatsappQueued: 2, inAppNotified: 2 });
    await processOutbox();
    const batch = (await principal.get(`/api/messaging/batches/${sent.body.batchId}`)).body;
    expect(batch.messages.every((m: { status: string }) => m.status === 'SENT')).toBe(true);
    expect(graphCalls.filter((c) => c.url.includes('/messages'))[0].body).toMatchObject({ template: { name: 'school_notice' } });
  });

  it('personalised messages go per child; scheduled messages wait; staff need permission', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls } = await school(principal, schoolId);
    await connectWhatsapp(principal);
    const r = await principal.post('/api/messaging/compose', {
      title: 'Result',
      message: 'Dear parent, {student} of {class} has a test on Monday.',
      audience: { kind: 'classes', ids: [cls.id] },
      channels: { whatsapp: true, inApp: false },
      sendAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(r.body.whatsappQueued).toBe(3);
    expect(await processOutbox()).toBe(0); // scheduled for later
    const msgs = await prisma.message.findMany();
    expect(msgs.map((m) => m.body).sort()[0]).toMatch(/Ali Raza of Class 5 A/);

    await createUser({ role: 'STAFF', username: 'clerk', schoolId });
    expect((await (await login('clerk')).post('/api/messaging/compose/preview', { message: 'x y', audience: { kind: 'school' } })).status).toBe(403);
  });

  it('can message staff, and refuses WhatsApp when it is not connected', async () => {
    const { principal, schoolId } = await setupSchool();
    await createUser({ role: 'TEACHER', username: 't9', schoolId });
    await prisma.user.update({ where: { username: 't9' }, data: { phone: '03009998887' } });
    const no = await principal.post('/api/messaging/compose', { title: 'Meeting', message: 'Staff meeting at 2pm', audience: { kind: 'staff', roles: ['TEACHER'] }, channels: { whatsapp: true, inApp: true } });
    expect(no.status).toBe(400);
    const yes = await principal.post('/api/messaging/compose', { title: 'Meeting', message: 'Staff meeting at 2pm', audience: { kind: 'staff', roles: ['TEACHER'] }, channels: { whatsapp: false, inApp: true } });
    expect(yes.body.inAppNotified).toBe(1);
    const t9 = await login('t9');
    const n = (await t9.get('/api/notifications')).body;
    expect(n.unread).toBe(1);
    await t9.post('/api/notifications/read', { all: true });
    expect((await t9.get('/api/notifications/unread-count')).body.unread).toBe(0);
  });
});

describe('outbox retries and delivery webhooks', () => {
  it('retries temporary errors, fails permanent ones, and retry puts failures back', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, ali } = await school(principal, schoolId);
    await connectWhatsapp(principal);
    await principal.put(`/api/attendance/sections/${secA}`, { date: today(), records: [{ studentId: ali.studentId, status: 'ABSENT' }] });
    nextResponses.push({ status: 500, json: { error: { message: 'Temporary' } } });
    await processOutbox();
    let m = await prisma.message.findFirstOrThrow();
    expect(m.status).toBe('QUEUED');
    expect(m.attempts).toBe(1);
    await prisma.message.update({ where: { id: m.id }, data: { nextAttemptAt: new Date() } });
    nextResponses.push({ status: 400, json: { error: { message: 'Template name does not exist', code: 132001 } } });
    await processOutbox();
    m = await prisma.message.findFirstOrThrow();
    expect(m.status).toBe('FAILED');
    expect(m.error).toMatch(/Template/);
    expect((await principal.post('/api/messaging/retry', { messageIds: [m.id] })).body.retried).toBe(1);
  });

  it('verifies the webhook and applies signed delivery and read receipts', async () => {
    const { principal, schoolId } = await setupSchool();
    const { secA, ali } = await school(principal, schoolId);
    const s = await connectWhatsapp(principal);
    await principal.put('/api/messaging/settings', { appSecret: 'app-secret-0123456789abcdef' });
    await principal.put(`/api/attendance/sections/${secA}`, { date: today(), records: [{ studentId: ali.studentId, status: 'ABSENT' }] });
    await processOutbox();
    const m = await prisma.message.findFirstOrThrow();

    const v = await request(app).get(`/api/webhooks/whatsapp/${schoolId}?hub.mode=subscribe&hub.verify_token=${s.verifyToken}&hub.challenge=42`);
    expect(v.text).toBe('42');
    expect((await request(app).get(`/api/webhooks/whatsapp/${schoolId}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`)).status).toBe(403);

    const post = (payload: object, secret = 'app-secret-0123456789abcdef') => {
      const raw = JSON.stringify(payload);
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
      return request(app).post(`/api/webhooks/whatsapp/${schoolId}`).set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw);
    };
    const status = (st: string) => ({ entry: [{ changes: [{ value: { statuses: [{ id: m.providerMessageId, status: st, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    expect((await post(status('read'), 'wrong-secret')).status).toBe(401);
    expect((await post(status('delivered'))).status).toBe(200);
    expect((await prisma.message.findFirstOrThrow()).status).toBe('DELIVERED');
    await post(status('read'));
    await post(status('delivered')); // late, out-of-order receipt is ignored
    const done = await prisma.message.findFirstOrThrow();
    expect(done.status).toBe('READ');
    expect(done.readAt).not.toBeNull();
  });
});
