import { beforeEach, describe, expect, it } from 'vitest';
import { client, createUser, login, resetDb } from './helpers';
import { prisma } from '../src/lib/prisma';

beforeEach(resetDb);

describe('auth', () => {
  it('logs in with username or email and returns the profile', async () => {
    await createUser({ role: 'SUPER_ADMIN', username: 'boss' });
    await prisma.user.update({ where: { username: 'boss' }, data: { email: 'boss@example.com' } });
    const c = client();
    expect((await c.post('/api/auth/login', { identifier: 'boss@example.com', password: 'Passw0rd!' })).status).toBe(200);
    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('SUPER_ADMIN');
    expect(me.body.school).toBeNull();
  });

  it('rejects a wrong password and unknown user with the same message', async () => {
    await createUser({ role: 'SUPER_ADMIN', username: 'boss' });
    const a = await client().post('/api/auth/login', { identifier: 'boss', password: 'nope' });
    const b = await client().post('/api/auth/login', { identifier: 'ghost', password: 'nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('requires the CSRF header on state-changing requests', async () => {
    await createUser({ role: 'SUPER_ADMIN', username: 'boss' });
    const c = client();
    const res = await c.agent.post('/api/auth/login').send({ identifier: 'boss', password: 'Passw0rd!' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });

  it('forces a temporary password to be changed before anything else', async () => {
    await createUser({ role: 'SUPER_ADMIN', username: 'boss', mustChangePassword: true });
    const c = await login('boss');
    const blocked = await c.get('/api/admin/dashboard');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await c.post('/api/auth/change-password', { currentPassword: 'Passw0rd!', newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await c.post('/api/auth/change-password', { currentPassword: 'Passw0rd!', newPassword: 'NewPassw0rd' });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/admin/dashboard')).status).toBe(200);
  });

  it('rotates refresh tokens and detects reuse of an old one', async () => {
    await createUser({ role: 'SUPER_ADMIN', username: 'boss' });
    const c = await login('boss');
    const cookies = c.agent.jar.getCookies({ domain: '127.0.0.1', path: '/api/auth', secure: false, script: false });
    const oldRefresh = cookies.find((k) => k.name === 'sms_rt')!.value;

    expect((await c.post('/api/auth/refresh')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(200);

    // Replaying the rotated token ends all sessions.
    const thief = client();
    const replay = await thief.agent.post('/api/auth/refresh').set('X-Requested-With', 'fetch').set('Cookie', `sms_rt=${oldRefresh}`);
    expect(replay.status).toBe(401);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.post('/api/auth/refresh')).status).toBe(401);
  });

  it('logout revokes the session', async () => {
    await createUser({ role: 'SUPER_ADMIN', username: 'boss' });
    const c = await login('boss');
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.post('/api/auth/refresh')).status).toBe(401);
  });

  it('deactivated users cannot log in or keep using their session', async () => {
    const u = await createUser({ role: 'SUPER_ADMIN', username: 'boss' });
    const c = await login('boss');
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await client().post('/api/auth/login', { identifier: 'boss', password: 'Passw0rd!' })).status).toBe(401);
  });
});
