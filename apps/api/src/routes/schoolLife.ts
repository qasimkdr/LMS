import { Router, type Request } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { enqueue, getSettings, notify, ruleFor, studentsWithContacts, whatsappReady } from '../services/messaging';
import { deleteSchoolFile, saveSchoolFile } from '../services/files';
import { effectiveLimits } from '../services/limits';
import { nextNumber } from '../services/counters';
import { MESSAGE_TYPES, renderTemplate } from '../config/messageTypes';

const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;

// ---------- Gate pass (early leave) ----------

export const gatePassRouter = Router();

async function canIssue(req: Request, sectionId: string | null) {
  if (can(req, 'attendance.manage') || can(req, 'students.manage')) return true;
  if (req.user!.role !== 'TEACHER' || !sectionId) return false;
  return Boolean(await prisma.section.findFirst({ where: { id: sectionId, classTeacherId: req.user!.id } }));
}

async function presentPasses(rows: Awaited<ReturnType<typeof prisma.gatePass.findMany>>) {
  const students = await prisma.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, fullName: true, admissionNo: true, photoFileId: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } } } });
  const issuers = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.issuedById) } }, select: { id: true, fullName: true } });
  return rows.map((r) => {
    const s = students.find((x) => x.id === r.studentId);
    return {
      id: r.id,
      passNo: r.passNo,
      student: s ? { id: s.id, fullName: s.fullName, admissionNo: s.admissionNo, photoFileId: s.photoFileId, classLabel: classLabel(s.class, s.section) } : null,
      reason: r.reason,
      pickedUpBy: r.pickedUpBy,
      relation: r.relation,
      pickerPhone: r.pickerPhone,
      leftAt: r.leftAt,
      issuedBy: issuers.find((i) => i.id === r.issuedById)?.fullName ?? '',
      notifiedAt: r.notifiedAt,
    };
  });
}

gatePassRouter.get(
  '/',
  ah(async (req, res) => {
    const u = req.user!;
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), studentId: z.string().optional() }), req.query);
    const schoolId = tenantId(req);
    let where: object;
    if (u.role === 'PARENT' || u.role === 'STUDENT') {
      const kids = await prisma.student.findMany({ where: { schoolId, ...(u.role === 'PARENT' ? { family: { parentUserId: u.id } } : { userId: u.id }) }, select: { id: true } });
      where = { studentId: { in: kids.map((k) => k.id) } };
    } else if (can(req, 'attendance.manage') || can(req, 'students.view')) where = q.studentId ? { studentId: q.studentId } : {};
    else if (u.role === 'TEACHER') {
      const secs = await prisma.section.findMany({ where: { schoolId, classTeacherId: u.id }, select: { id: true } });
      const kids = await prisma.student.findMany({ where: { sectionId: { in: secs.map((s) => s.id) } }, select: { id: true } });
      where = { studentId: { in: kids.map((k) => k.id) } };
    } else throw forbidden();
    // A day in the school's time zone: fetch a 3-day window, then keep the passes of that local date.
    const tz = u.school!.timezone;
    const day = q.date ? { leftAt: { gte: new Date(new Date(`${q.date}T00:00:00Z`).getTime() - 86400000), lt: new Date(new Date(`${q.date}T00:00:00Z`).getTime() + 2 * 86400000) } } : {};
    const local = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const rows = (await prisma.gatePass.findMany({ where: { schoolId, ...where, ...day }, orderBy: { leftAt: 'desc' }, take: 300 })).filter((r) => !q.date || local(r.leftAt) === q.date);
    res.json({ passes: await presentPasses(rows), canIssue: can(req, 'attendance.manage') || can(req, 'students.manage') || u.role === 'TEACHER' });
  }),
);

gatePassRouter.post(
  '/',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const body = parse(z.object({ studentId: z.string(), reason: z.string().trim().min(2).max(300), pickedUpBy: z.string().trim().min(2).max(120), relation: z.string().trim().min(2).max(40), pickerPhone: optStr(20), leftAt: z.coerce.date().optional() }), req.body);
    const st = await prisma.student.findFirst({ where: { id: body.studentId, schoolId, deletedAt: null, status: 'ACTIVE' } });
    if (!st) throw badRequest('Unknown student');
    if (!(await canIssue(req, st.sectionId))) throw forbidden('Only the class teacher or office staff can issue a gate pass');
    const pass = await prisma.$transaction(async (tx) => {
      const passNo = await nextNumber(tx, schoolId, 'gatepass');
      return tx.gatePass.create({ data: { schoolId, passNo, studentId: st.id, reason: body.reason, pickedUpBy: body.pickedUpBy, relation: body.relation, pickerPhone: body.pickerPhone ?? null, leftAt: body.leftAt ?? new Date(), issuedById: req.user!.id } });
    });
    // Tell the parents.
    const school = req.user!.school!;
    const time = pass.leftAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: school.timezone });
    const [contact] = await studentsWithContacts(schoolId, { id: st.id });
    const settings = await getSettings(schoolId);
    let whatsapp = 0;
    if (contact) {
      const params = [st.fullName, time, `${body.pickedUpBy} (${body.relation})`, body.reason, school.name];
      if (whatsappReady(settings) && ruleFor(settings, 'GATE_PASS') === 'auto') whatsapp = await enqueue(schoolId, settings, contact.guardians.map((g) => ({ to: { phone: g.phone ?? '', name: g.name, studentId: st.id }, type: 'GATE_PASS', params, body: renderTemplate(MESSAGE_TYPES.GATE_PASS.suggestedTemplate.text, params) })));
      if (contact.parentUserId) await notify(schoolId, [{ userId: contact.parentUserId, type: 'GATE_PASS', title: `${st.fullName} left school early`, body: `At ${time} with ${body.pickedUpBy} (${body.relation}). Reason: ${body.reason}`, link: '/gate-pass' }]);
      await prisma.gatePass.update({ where: { id: pass.id }, data: { notifiedAt: new Date() } });
    }
    await audit(req, { action: 'gatepass.create', entityType: 'GatePass', entityId: pass.id, after: { passNo: pass.passNo, studentId: st.id } });
    res.status(201).json({ id: pass.id, passNo: pass.passNo, whatsapp });
  }),
);

gatePassRouter.get(
  '/:id',
  ah(async (req, res) => {
    const p = await prisma.gatePass.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) } });
    if (!p) throw notFound('Gate pass not found');
    const u = req.user!;
    if (u.role === 'PARENT' || u.role === 'STUDENT') {
      const st = await prisma.student.findFirst({ where: { id: p.studentId, ...(u.role === 'PARENT' ? { family: { parentUserId: u.id } } : { userId: u.id }) } });
      if (!st) throw notFound('Gate pass not found');
    } else if (!(can(req, 'attendance.manage') || can(req, 'students.view') || u.role === 'TEACHER')) throw forbidden();
    const [pass] = await presentPasses([p]);
    res.json({ pass, school: { name: u.school!.name, address: u.school!.address, phone: u.school!.phone, logoFileId: u.school!.logoFileId } });
  }),
);

// ---------- Gallery ----------

export const galleryRouter = Router();
const isGalleryManager = (req: Request) => can(req, 'gallery.manage');

async function visibleWhere(req: Request) {
  const u = req.user!;
  if (isGalleryManager(req)) return {};
  if (u.role === 'TEACHER' || u.role === 'STAFF') return { visibility: { in: ['SCHOOL', 'STAFF', 'CLASSES'] } };
  const kids = await prisma.student.findMany({ where: { schoolId: tenantId(req), deletedAt: null, ...(u.role === 'PARENT' ? { family: { parentUserId: u.id } } : { userId: u.id }) }, select: { classId: true } });
  return { OR: [{ visibility: 'SCHOOL' }, ...kids.map((k) => ({ visibility: 'CLASSES', classIds: { array_contains: k.classId } }))] };
}

galleryRouter.get(
  '/albums',
  ah(async (req, res) => {
    const rows = await prisma.album.findMany({ where: { schoolId: tenantId(req), deletedAt: null, ...(await visibleWhere(req)) }, orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }], include: { _count: { select: { photos: true } }, photos: { take: 4, orderBy: { sortOrder: 'asc' }, select: { thumbFileId: true, fileId: true } } } });
    const covers = await prisma.albumPhoto.findMany({ where: { fileId: { in: rows.map((r) => r.coverFileId).filter((x): x is string => Boolean(x)) } }, select: { fileId: true, thumbFileId: true } });
    res.json({
      canManage: isGalleryManager(req),
      albums: rows.map((r) => {
        const cover = covers.find((c) => c.fileId === r.coverFileId);
        return {
          id: r.id,
          title: r.title,
          description: r.description,
          eventDate: r.eventDate,
          visibility: r.visibility,
          classIds: r.classIds,
          photos: r._count.photos,
          cover: cover ? (cover.thumbFileId ?? cover.fileId) : (r.photos[0]?.thumbFileId ?? r.photos[0]?.fileId ?? null),
          previews: r.photos.map((p) => p.thumbFileId ?? p.fileId),
        };
      }),
    });
  }),
);

const albumBody = z.object({ title: z.string().trim().min(2).max(160), description: optStr(1000), eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), visibility: z.enum(['SCHOOL', 'CLASSES', 'STAFF']).default('SCHOOL'), classIds: z.array(z.string()).max(50).default([]) });

galleryRouter.post(
  '/albums',
  ah(async (req, res) => {
    if (!isGalleryManager(req)) throw forbidden();
    const b = parse(albumBody, req.body);
    if (b.visibility === 'CLASSES' && !b.classIds.length) throw badRequest('Choose the classes that can see this album');
    const a = await prisma.album.create({ data: { schoolId: tenantId(req), title: b.title, description: b.description ?? null, eventDate: b.eventDate ? new Date(b.eventDate) : null, visibility: b.visibility, classIds: b.visibility === 'CLASSES' ? b.classIds : undefined, createdById: req.user!.id } });
    await audit(req, { action: 'album.create', entityType: 'Album', entityId: a.id, after: { title: a.title } });
    res.status(201).json({ id: a.id });
  }),
);

async function loadAlbum(req: Request, id: string) {
  const a = await prisma.album.findFirst({ where: { id, schoolId: tenantId(req), deletedAt: null, ...(await visibleWhere(req)) } });
  if (!a) throw notFound('Album not found');
  return a;
}

galleryRouter.get(
  '/albums/:id',
  ah(async (req, res) => {
    const a = await loadAlbum(req, req.params.id);
    const photos = await prisma.albumPhoto.findMany({ where: { albumId: a.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    res.json({ album: { id: a.id, title: a.title, description: a.description, eventDate: a.eventDate, visibility: a.visibility, classIds: a.classIds, coverFileId: a.coverFileId }, photos: photos.map((p) => ({ id: p.id, fileId: p.fileId, thumbFileId: p.thumbFileId ?? p.fileId, caption: p.caption, width: p.width, height: p.height })), canManage: isGalleryManager(req) });
  }),
);

galleryRouter.patch(
  '/albums/:id',
  ah(async (req, res) => {
    if (!isGalleryManager(req)) throw forbidden();
    const a = await loadAlbum(req, req.params.id);
    const b = parse(albumBody.partial().extend({ coverFileId: z.string().nullish() }), req.body);
    if (b.coverFileId && !(await prisma.albumPhoto.findFirst({ where: { albumId: a.id, fileId: b.coverFileId } }))) throw badRequest('Choose a photo of this album');
    await prisma.album.update({
      where: { id: a.id },
      data: { ...(b.title ? { title: b.title } : {}), ...(b.description !== undefined ? { description: b.description } : {}), ...(b.eventDate !== undefined ? { eventDate: b.eventDate ? new Date(b.eventDate) : null } : {}), ...(b.visibility ? { visibility: b.visibility, classIds: b.visibility === 'CLASSES' ? (b.classIds ?? []) : [] } : {}), ...(b.coverFileId !== undefined ? { coverFileId: b.coverFileId } : {}) },
    });
    res.json({ ok: true });
  }),
);

galleryRouter.delete(
  '/albums/:id',
  ah(async (req, res) => {
    if (!isGalleryManager(req)) throw forbidden();
    const a = await loadAlbum(req, req.params.id);
    const photos = await prisma.albumPhoto.findMany({ where: { albumId: a.id } });
    for (const p of photos) {
      await deleteSchoolFile(a.schoolId, p.fileId);
      if (p.thumbFileId) await deleteSchoolFile(a.schoolId, p.thumbFileId);
    }
    await prisma.album.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    await prisma.albumPhoto.deleteMany({ where: { albumId: a.id } });
    await audit(req, { action: 'album.delete', entityType: 'Album', entityId: a.id, before: { title: a.title, photos: photos.length } });
    res.json({ ok: true });
  }),
);

/** Upload photos: each is resized (max 1920px), compressed to WebP, and gets a small thumbnail. */
galleryRouter.post(
  '/albums/:id/photos',
  ah(async (req, res) => {
    if (!isGalleryManager(req)) throw forbidden();
    const a = await loadAlbum(req, req.params.id);
    const school = req.user!.school!;
    // Originals may be larger than the plan's file limit because they are compressed before saving.
    const rawLimit = Math.max(effectiveLimits(school).maxFileBytes, 15 * 1024 * 1024);
    await new Promise<void>((resolve, reject) => multer({ storage: multer.memoryStorage(), limits: { fileSize: rawLimit, files: 20 } }).array('files', 20)(req, {} as never, (err) => (err ? reject(err) : resolve())));
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest('Choose photos to upload');
    const max = (await prisma.albumPhoto.aggregate({ where: { albumId: a.id }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const added = [];
    const failed: string[] = [];
    for (const [i, f] of files.entries()) {
      try {
        if (!f.mimetype.startsWith('image/')) throw new Error('not an image');
        const img = sharp(f.buffer, { failOn: 'none' }).rotate();
        const big = await img.clone().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
        const thumb = await img.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
        const base = f.originalname.replace(/\.[^.]+$/, '');
        const saved = await saveSchoolFile({ school, uploadedById: req.user!.id, category: 'GALLERY', file: { originalname: `${base}.webp`, mimetype: 'image/webp', size: big.data.length, buffer: big.data } });
        const savedThumb = await saveSchoolFile({ school, uploadedById: req.user!.id, category: 'GALLERY', file: { originalname: `${base}-thumb.webp`, mimetype: 'image/webp', size: thumb.length, buffer: thumb } });
        added.push(await prisma.albumPhoto.create({ data: { albumId: a.id, fileId: saved.id, thumbFileId: savedThumb.id, width: big.info.width, height: big.info.height, sortOrder: max + i + 1 } }));
      } catch (e) {
        if ((e as { code?: string }).code === 'STORAGE_FULL') throw e;
        failed.push(f.originalname);
      }
    }
    if (!a.coverFileId && added[0]) await prisma.album.update({ where: { id: a.id }, data: { coverFileId: added[0].fileId } });
    await audit(req, { action: 'album.photos', entityType: 'Album', entityId: a.id, after: { added: added.length, failed: failed.length } });
    res.status(201).json({ added: added.length, failed });
  }),
);

galleryRouter.patch(
  '/photos/:id',
  ah(async (req, res) => {
    if (!isGalleryManager(req)) throw forbidden();
    const p = await prisma.albumPhoto.findFirst({ where: { id: req.params.id, album: { schoolId: tenantId(req) } } });
    if (!p) throw notFound('Photo not found');
    const { caption } = parse(z.object({ caption: optStr(200) }), req.body);
    await prisma.albumPhoto.update({ where: { id: p.id }, data: { caption: caption ?? null } });
    res.json({ ok: true });
  }),
);

galleryRouter.delete(
  '/photos/:id',
  ah(async (req, res) => {
    if (!isGalleryManager(req)) throw forbidden();
    const p = await prisma.albumPhoto.findFirst({ where: { id: req.params.id, album: { schoolId: tenantId(req) } }, include: { album: true } });
    if (!p) throw notFound('Photo not found');
    await deleteSchoolFile(p.album.schoolId, p.fileId);
    if (p.thumbFileId) await deleteSchoolFile(p.album.schoolId, p.thumbFileId);
    await prisma.albumPhoto.delete({ where: { id: p.id } });
    if (p.album.coverFileId === p.fileId) await prisma.album.update({ where: { id: p.albumId }, data: { coverFileId: (await prisma.albumPhoto.findFirst({ where: { albumId: p.albumId }, orderBy: { sortOrder: 'asc' } }))?.fileId ?? null } });
    res.json({ ok: true });
  }),
);
