import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';

beforeEach(resetDb);

const png = (bytes: number) => ({ name: 'pic.png', content: Buffer.alloc(bytes, 1), type: 'image/png' });

describe('files, plan limits and tenant isolation', () => {
  it('uploads, lists, downloads and deletes a file and tracks usage', async () => {
    const { principal } = await setupSchool();
    const up = await principal.upload('/api/files', { category: 'SYLLABUS' }, png(1000));
    expect(up.status).toBe(201);
    const usage = await principal.get('/api/school/usage');
    expect(usage.body.usage.storage.usedBytes).toBe(1000);
    expect(usage.body.byCategory).toEqual([{ category: 'SYLLABUS', bytes: 1000, files: 1 }]);
    expect(usage.body.largest[0].id).toBe(up.body.file.id);

    const dl = await principal.get(`/api/files/${up.body.file.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');

    expect((await principal.del(`/api/files/${up.body.file.id}`)).status).toBe(200);
    expect((await principal.get('/api/school/usage')).body.usage.storage.usedBytes).toBe(0);
  });

  it('enforces the per-file size limit and blocked file types', async () => {
    const { principal } = await setupSchool();
    // Plan max file size is 1 MB.
    const big = await principal.upload('/api/files', { category: 'OTHER' }, png(1024 * 1024 + 1));
    expect(big.status).toBe(413);
    const exe = await principal.upload('/api/files', {}, { name: 'x.exe', content: Buffer.from('MZ'), type: 'application/x-msdownload' });
    expect(exe.status).toBe(415);
  });

  it('blocks uploads when storage is full, with warning levels before that', async () => {
    const { principal, schoolId } = await setupSchool();
    // Plan storage is 10 MB. Pretend 9.7 MB is used.
    await prisma.storedFile.create({
      data: { schoolId, uploadedById: 'x', category: 'GALLERY', storageKey: 'fake/1', originalName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: Math.round(9.7 * 1024 * 1024) },
    });
    const usage = await principal.get('/api/school/usage');
    expect(usage.body.usage.storage.level).toBe('critical');
    const res = await principal.upload('/api/files', {}, png(512 * 1024));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('STORAGE_FULL');
  });

  it('a school can never see or delete another school\'s files', async () => {
    const a = await setupSchool('alpha');
    const b = await setupSchool('beta');
    const up = await a.principal.upload('/api/files', {}, png(10));
    const id = up.body.file.id;
    expect((await b.principal.get(`/api/files/${id}/download`)).status).toBe(404);
    expect((await b.principal.del(`/api/files/${id}`)).status).toBe(404);
    expect((await b.principal.get('/api/files')).body.files).toHaveLength(0);
    expect((await a.principal.get('/api/files')).body.files).toHaveLength(1);
  });

  it('staff need the files.manage permission; students cannot upload', async () => {
    const { schoolId } = await setupSchool();
    await createUser({ role: 'STAFF', username: 'clerk', schoolId });
    await createUser({ role: 'STAFF', username: 'clerk2', schoolId, permissions: ['files.manage'] });
    await createUser({ role: 'STUDENT', username: 'kid', schoolId });
    expect((await (await login('clerk')).upload('/api/files', {}, png(10))).status).toBe(403);
    expect((await (await login('clerk2')).upload('/api/files', {}, png(10))).status).toBe(201);
    expect((await (await login('kid')).upload('/api/files', {}, png(10))).status).toBe(403);
  });

  it('school routes are not available to the super admin', async () => {
    const { sa } = await setupSchool();
    expect((await sa.get('/api/school/overview')).status).toBe(403);
  });
});
