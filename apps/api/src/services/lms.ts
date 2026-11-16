import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { MESSAGE_TYPES, renderTemplate } from '../config/messageTypes';
import { enqueue, getSettings, notify, ruleFor, studentsWithContacts, whatsappReady } from './messaging';
import { schoolToday } from '../routes/attendance';

export const isLmsManager = (req: Request) => can(req, 'lms.manage');

export async function getLmsSettings(schoolId: string) {
  return (await prisma.lmsSettings.findUnique({ where: { schoolId } })) ?? prisma.lmsSettings.upsert({ where: { schoolId }, create: { schoolId }, update: {} });
}

/** May this user post homework / mark syllabus progress for this section and subject? */
export async function canTeach(req: Request, sectionId: string, subjectId: string | null) {
  if (isLmsManager(req)) return true;
  const u = req.user!;
  if (u.role !== 'TEACHER') return false;
  const schoolId = tenantId(req);
  if (subjectId && (await prisma.teachingAssignment.findFirst({ where: { schoolId, sectionId, subjectId, teacherId: u.id } }))) return true;
  const section = await prisma.section.findFirst({ where: { id: sectionId, schoolId, deletedAt: null }, select: { classTeacherId: true } });
  if (section?.classTeacherId !== u.id) return false;
  // Class teachers may post the general diary (no subject) and, if the school allows, any subject.
  return !subjectId || (await getLmsSettings(schoolId)).classTeacherAllSubjects;
}

/** May this user edit the syllabus of this class and subject? (managers, or a teacher of the subject in that class) */
export async function canEditSyllabus(req: Request, classId: string, subjectId: string) {
  if (isLmsManager(req)) return true;
  const u = req.user!;
  if (u.role !== 'TEACHER') return false;
  return Boolean(await prisma.teachingAssignment.findFirst({ where: { schoolId: tenantId(req), subjectId, teacherId: u.id, section: { classId, deletedAt: null } } }));
}

/** Sections a teacher works in (class teacher or any subject), with the subjects they teach there. */
export async function teacherScope(schoolId: string, teacherId: string) {
  const [own, taught] = await Promise.all([
    prisma.section.findMany({ where: { schoolId, classTeacherId: teacherId, deletedAt: null }, select: { id: true, classId: true } }),
    prisma.teachingAssignment.findMany({ where: { schoolId, teacherId, section: { deletedAt: null } }, select: { sectionId: true, subjectId: true, section: { select: { classId: true } } } }),
  ]);
  return { classTeacherOf: own, taught: taught.map((t) => ({ sectionId: t.sectionId, subjectId: t.subjectId, classId: t.section.classId })) };
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Sends the day's diary of one section to parents (and students): one in-app notice per student,
 * and WhatsApp when allowed. Returns counts; does nothing if there is no homework that day.
 */
export async function sendDigest(schoolId: string, sectionId: string, date: string, opts: { byUserId?: string | null; whatsapp: boolean }) {
  const day = new Date(`${date}T00:00:00.000Z`);
  const homework = await prisma.homework.findMany({ where: { schoolId, sectionId, date: day, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  if (!homework.length) return { students: 0, whatsapp: 0, items: 0 };
  const subjects = await prisma.subject.findMany({ where: { id: { in: homework.map((h) => h.subjectId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  const summary = homework.map((h) => `${h.subjectId ? (subjects.find((s) => s.id === h.subjectId)?.name ?? 'Subject') : 'Diary'}: ${oneLine(h.text)}`).join('; ');
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  const settings = await getSettings(schoolId);
  const useWa = opts.whatsapp && whatsappReady(settings) && ruleFor(settings, 'HOMEWORK') !== 'off';
  const students = await studentsWithContacts(schoolId, { sectionId });
  const logins = await prisma.student.findMany({ where: { id: { in: students.map((s) => s.id) } }, select: { id: true, userId: true } });
  const dateLabel = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const notices: Parameters<typeof notify>[1] = [];
  let queued = 0;
  for (const st of students) {
    // WhatsApp template parameters are limited in length and may not contain new lines.
    const params = [st.fullName, dateLabel, summary.length > 900 ? `${summary.slice(0, 897)}...` : summary, school.name];
    const body = renderTemplate(MESSAGE_TYPES.HOMEWORK.suggestedTemplate.text, params);
    if (useWa) queued += await enqueue(schoolId, settings, st.guardians.map((g) => ({ to: { phone: g.phone ?? '', name: g.name, studentId: st.id }, type: 'HOMEWORK', params, body })));
    const short = summary.length > 240 ? `${summary.slice(0, 237)}...` : summary;
    if (st.parentUserId) notices.push({ userId: st.parentUserId, type: 'HOMEWORK', title: `Diary ${dateLabel}: ${st.fullName}`, body: short, link: '/home/homework' });
    const su = logins.find((l) => l.id === st.id)?.userId;
    if (su) notices.push({ userId: su, type: 'HOMEWORK', title: `Today's diary (${dateLabel})`, body: short, link: '/home/homework' });
  }
  await notify(schoolId, notices);
  await prisma.homeworkDigest.upsert({
    where: { sectionId_date: { sectionId, date: day } },
    create: { schoolId, sectionId, date: day, sentById: opts.byUserId ?? null, items: homework.length },
    update: { sentAt: new Date(), sentById: opts.byUserId ?? null, items: homework.length },
  });
  return { students: students.length, whatsapp: queued, items: homework.length };
}

/** Runs every few minutes: after each school's diary time, sends today's diary of every section once. */
export async function autoDigests(now = new Date()) {
  const schools = await prisma.school.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] }, deletedAt: null }, include: { plan: true } });
  let sent = 0;
  for (const school of schools) {
    if (!((school.plan.modules as string[] | null) ?? []).includes('lms')) continue;
    const settings = await getLmsSettings(school.id);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: school.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    if (time < settings.digestTime) continue;
    const today = schoolToday(school.timezone, now);
    const day = new Date(`${today}T00:00:00.000Z`);
    const sections = await prisma.homework.groupBy({ by: ['sectionId'], where: { schoolId: school.id, date: day, deletedAt: null } });
    if (!sections.length) continue;
    const done = await prisma.homeworkDigest.findMany({ where: { schoolId: school.id, date: day }, select: { sectionId: true } });
    const msg = await getSettings(school.id);
    const wa = ruleFor(msg, 'HOMEWORK') === 'auto';
    for (const s of sections.filter((x) => !done.some((d) => d.sectionId === x.sectionId))) {
      await sendDigest(school.id, s.sectionId, today, { whatsapp: wa });
      sent++;
    }
  }
  return sent;
}
