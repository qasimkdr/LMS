import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AttendanceStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { alertItems, enqueue, getSettings, notify, ruleFor, studentsWithContacts, whatsappReady } from '../services/messaging';
import { workingDaysOf } from './timetable';

const router = Router();

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY'] as const;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/** Today's date (YYYY-MM-DD) in the school's time zone. */
export function schoolToday(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const weekday = (s: string) => ((asDate(s).getUTCDay() + 6) % 7) + 1; // 1 = Monday
const niceDate = (s: string) => asDate(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Attendance % : present, late and half-day (as half) out of all marked days. */
export function percent(c: Record<string, number>) {
  const total = STATUSES.reduce((n, s) => n + (c[s] ?? 0), 0);
  if (!total) return null;
  return Math.round((((c.PRESENT ?? 0) + (c.LATE ?? 0) + 0.5 * (c.HALF_DAY ?? 0)) / total) * 1000) / 10;
}

/**
 * Principal and staff with attendance.manage may mark any past day.
 * The class teacher may mark only today. Other teachers of the section may view.
 */
async function access(req: Request, section: { id: string; classTeacherId: string | null }, date: string, today: string) {
  const u = req.user!;
  if (can(req, 'attendance.manage')) return { view: true, edit: true };
  if (u.role === 'TEACHER') {
    if (section.classTeacherId === u.id) return { view: true, edit: date === today };
    const teaches = await prisma.teachingAssignment.count({ where: { sectionId: section.id, teacherId: u.id } });
    return { view: teaches > 0, edit: false };
  }
  if (u.role === 'STAFF' && can(req, 'students.view')) return { view: true, edit: false };
  return { view: false, edit: false };
}

async function loadSection(req: Request, id: string) {
  const s = await prisma.section.findFirst({ where: { id, schoolId: tenantId(req), deletedAt: null }, include: { class: true } });
  if (!s) throw notFound('Section not found');
  return s;
}

// ---------- Mark attendance for a section ----------

router.get(
  '/sections/:id',
  ah(async (req, res) => {
    const school = req.user!.school!;
    const today = schoolToday(school.timezone);
    const { date = today } = parse(z.object({ date: dateStr.optional() }), req.query);
    const section = await loadSection(req, req.params.id);
    const acc = await access(req, section, date, today);
    if (!acc.view) throw forbidden();
    const d = asDate(date);
    const [students, records, session] = await Promise.all([
      prisma.student.findMany({
        where: { sectionId: section.id, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, fullName: true, rollNo: true, admissionNo: true, photoFileId: true, gender: true },
        orderBy: [{ rollNo: 'asc' }, { fullName: 'asc' }],
      }),
      prisma.attendanceRecord.findMany({ where: { sectionId: section.id, date: d } }),
      prisma.attendanceSession.findUnique({ where: { sectionId_date: { sectionId: section.id, date: d } } }),
    ]);
    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    const markedBy = session ? await prisma.user.findUnique({ where: { id: session.updatedById ?? session.markedById }, select: { fullName: true } }) : null;
    const settings = await getSettings(school.id);
    const workingDays = workingDaysOf((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).settings);
    res.json({
      section: { id: section.id, name: section.name, class: { id: section.class.id, name: section.class.name, stream: section.class.stream } },
      date,
      today,
      isWorkingDay: workingDays.includes(weekday(date)),
      canEdit: acc.edit && date <= today,
      marked: Boolean(session),
      markedAt: session?.updatedAt ?? null,
      markedBy: markedBy?.fullName ?? null,
      alerts: {
        absent: ruleFor(settings, 'ABSENT'),
        late: ruleFor(settings, 'LATE'),
        whatsappReady: whatsappReady(settings),
        pending: date === today ? records.filter((r) => !r.alertSentAt && (r.status === 'ABSENT' || r.status === 'LATE')).length : 0,
      },
      students: students.map((s) => {
        const r = byStudent.get(s.id);
        return { ...s, status: r?.status ?? null, remark: r?.remark ?? null, alertSent: Boolean(r?.alertSentAt) };
      }),
    });
  }),
);

/** Queues WhatsApp alerts for today's absent/late students that have not been alerted yet. */
async function sendAlerts(schoolId: string, schoolName: string, date: string, recordIds: string[], forceManual: boolean) {
  const settings = await getSettings(schoolId);
  if (!whatsappReady(settings)) return 0;
  const records = await prisma.attendanceRecord.findMany({ where: { id: { in: recordIds }, alertSentAt: null, status: { in: ['ABSENT', 'LATE'] } } });
  const wanted = records.filter((r) => {
    const rule = ruleFor(settings, r.status);
    return rule === 'auto' || (forceManual && rule === 'manual');
  });
  if (!wanted.length) return 0;
  const students = await studentsWithContacts(schoolId, { id: { in: wanted.map((r) => r.studentId) } });
  const byId = new Map(students.map((s) => [s.id, s]));
  let queued = 0;
  for (const r of wanted) {
    const st = byId.get(r.studentId);
    if (!st) continue;
    queued += await enqueue(schoolId, settings, alertItems(r.status as 'ABSENT' | 'LATE', st, niceDate(date), schoolName));
  }
  await prisma.attendanceRecord.updateMany({ where: { id: { in: wanted.map((r) => r.id) } }, data: { alertSentAt: new Date() } });
  return queued;
}

router.put(
  '/sections/:id',
  ah(async (req, res) => {
    const school = req.user!.school!;
    const schoolId = school.id;
    const today = schoolToday(school.timezone);
    const body = parse(
      z.object({
        date: dateStr,
        records: z.array(z.object({ studentId: z.string(), status: z.enum(STATUSES), remark: optStr(200) })).min(1).max(500),
        reason: optStr(300),
      }),
      req.body,
    );
    if (body.date > today) throw badRequest('Attendance cannot be marked for a future date');
    const section = await loadSection(req, req.params.id);
    const acc = await access(req, section, body.date, today);
    if (!acc.edit) throw forbidden(acc.view ? 'Only the principal can change attendance of past days' : 'You cannot mark attendance for this class');
    const d = asDate(body.date);
    const validIds = new Set((await prisma.student.findMany({ where: { sectionId: section.id, deletedAt: null, status: 'ACTIVE' }, select: { id: true } })).map((s) => s.id));
    const bad = body.records.find((r) => !validIds.has(r.studentId));
    if (bad) throw badRequest('A student is not in this section');

    const before = await prisma.attendanceRecord.findMany({ where: { sectionId: section.id, date: d } });
    const prev = new Map(before.map((r) => [r.studentId, r]));
    const session = await prisma.attendanceSession.findUnique({ where: { sectionId_date: { sectionId: section.id, date: d } } });

    await prisma.$transaction(async (tx) => {
      for (const r of body.records) {
        await tx.attendanceRecord.upsert({
          where: { studentId_date: { studentId: r.studentId, date: d } },
          create: { schoolId, studentId: r.studentId, sectionId: section.id, date: d, status: r.status as AttendanceStatus, remark: r.remark ?? null },
          update: { status: r.status as AttendanceStatus, remark: r.remark ?? null, sectionId: section.id },
        });
      }
      await tx.attendanceSession.upsert({
        where: { sectionId_date: { sectionId: section.id, date: d } },
        create: { schoolId, sectionId: section.id, date: d, markedById: req.user!.id },
        update: { updatedById: req.user!.id },
      });
    });

    // Parents are told about today's absences and late arrivals (once per student per day).
    let whatsappQueued = 0;
    let notified = 0;
    if (body.date === today) {
      const newly = body.records.filter((r) => (r.status === 'ABSENT' || r.status === 'LATE') && prev.get(r.studentId)?.status !== r.status);
      if (newly.length) {
        const students = await studentsWithContacts(schoolId, { id: { in: newly.map((r) => r.studentId) } });
        const items = students
          .filter((s) => s.parentUserId)
          .map((s) => {
            const st = newly.find((r) => r.studentId === s.id)!.status;
            return {
              userId: s.parentUserId!,
              type: st,
              title: st === 'ABSENT' ? `${s.fullName} is absent today` : `${s.fullName} came late today`,
              body: `${s.fullName} (${s.classLabel}) was marked ${st === 'ABSENT' ? 'absent' : 'late'} on ${niceDate(body.date)}.`,
              link: '/home/attendance',
            };
          });
        await notify(schoolId, items);
        notified = items.length;
      }
      const ids = (await prisma.attendanceRecord.findMany({ where: { sectionId: section.id, date: d, status: { in: ['ABSENT', 'LATE'] }, alertSentAt: null }, select: { id: true } })).map((r) => r.id);
      whatsappQueued = await sendAlerts(schoolId, school.name, body.date, ids, false);
    }

    const changed = body.records.filter((r) => prev.get(r.studentId) && prev.get(r.studentId)!.status !== r.status);
    await audit(req, {
      action: session ? 'attendance.update' : 'attendance.mark',
      entityType: 'Section',
      entityId: section.id,
      before: session ? changed.map((r) => ({ studentId: r.studentId, status: prev.get(r.studentId)!.status })) : undefined,
      after: { date: body.date, counts: countBy(body.records.map((r) => r.status)), changed: changed.map((r) => ({ studentId: r.studentId, status: r.status })) },
      reason: body.reason,
    });
    res.json({ ok: true, whatsappQueued, notified });
  }),
);

const countBy = (list: string[]) => list.reduce<Record<string, number>>((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});

/** Send WhatsApp alerts now (for schools that choose "send manually"). Whole school or one section. */
router.post(
  '/alerts',
  ah(async (req, res) => {
    if (!(can(req, 'attendance.manage') || can(req, 'messages.send') || req.user!.role === 'TEACHER')) throw forbidden();
    const school = req.user!.school!;
    const today = schoolToday(school.timezone);
    const body = parse(z.object({ sectionId: z.string().optional() }), req.body ?? {});
    if (req.user!.role === 'TEACHER') {
      if (!body.sectionId) throw forbidden();
      const s = await loadSection(req, body.sectionId);
      if (s.classTeacherId !== req.user!.id) throw forbidden();
    }
    const settings = await getSettings(school.id);
    if (!whatsappReady(settings)) throw badRequest('WhatsApp is not connected. Set it up in Settings → WhatsApp.');
    const ids = (
      await prisma.attendanceRecord.findMany({
        where: { schoolId: school.id, date: asDate(today), status: { in: ['ABSENT', 'LATE'] }, alertSentAt: null, ...(body.sectionId ? { sectionId: body.sectionId } : {}) },
        select: { id: true },
      })
    ).map((r) => r.id);
    const queued = await sendAlerts(school.id, school.name, today, ids, true);
    await audit(req, { action: 'attendance.alerts', entityType: 'School', entityId: school.id, after: { date: today, sectionId: body.sectionId, queued } });
    res.json({ queued });
  }),
);

// ---------- Principal dashboard: today across the school ----------

router.get(
  '/today',
  ah(async (req, res) => {
    if (!(req.user!.role === 'PRINCIPAL' || req.user!.role === 'STAFF')) throw forbidden();
    const school = req.user!.school!;
    const today = schoolToday(school.timezone);
    const { date = today } = parse(z.object({ date: dateStr.optional() }), req.query);
    const d = asDate(date);
    const [sections, sessions, counts, active] = await Promise.all([
      prisma.section.findMany({
        where: { schoolId: school.id, deletedAt: null, class: { deletedAt: null } },
        select: { id: true, name: true, class: { select: { name: true, stream: true, sortOrder: true } }, classTeacher: { select: { fullName: true } } },
        orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }],
      }),
      prisma.attendanceSession.findMany({ where: { schoolId: school.id, date: d } }),
      prisma.attendanceRecord.groupBy({ by: ['sectionId', 'status'], where: { schoolId: school.id, date: d }, _count: { _all: true } }),
      prisma.student.groupBy({ by: ['sectionId'], where: { schoolId: school.id, status: 'ACTIVE', deletedAt: null }, _count: { _all: true } }),
    ]);
    const marked = new Map(sessions.map((s) => [s.sectionId, s]));
    const size = new Map(active.map((a) => [a.sectionId, a._count._all]));
    const totals: Record<string, number> = {};
    const rows = sections
      .filter((s) => (size.get(s.id) ?? 0) > 0)
      .map((s) => {
        const c: Record<string, number> = {};
        for (const r of counts.filter((x) => x.sectionId === s.id)) {
          c[r.status] = r._count._all;
          totals[r.status] = (totals[r.status] ?? 0) + r._count._all;
        }
        return { id: s.id, name: s.name, class: s.class, classTeacher: s.classTeacher?.fullName ?? null, students: size.get(s.id) ?? 0, marked: marked.has(s.id), markedAt: marked.get(s.id)?.updatedAt ?? null, counts: c, percent: percent(c) };
      });
    const absentees = await prisma.attendanceRecord.findMany({
      where: { schoolId: school.id, date: d, status: { in: ['ABSENT', 'LATE'] } },
      select: { status: true, alertSentAt: true, studentId: true },
    });
    const absentStudents = await prisma.student.findMany({
      where: { id: { in: absentees.map((a) => a.studentId) } },
      select: { id: true, fullName: true, admissionNo: true, class: { select: { name: true } }, section: { select: { name: true } } },
    });
    const settings = await getSettings(school.id);
    res.json({
      date,
      today,
      totals,
      percent: percent(totals),
      sections: rows,
      notMarked: rows.filter((r) => !r.marked).length,
      absentees: absentees.map((a) => ({ ...a, student: absentStudents.find((s) => s.id === a.studentId) })),
      alerts: { absent: ruleFor(settings, 'ABSENT'), late: ruleFor(settings, 'LATE'), whatsappReady: whatsappReady(settings), pending: date === today ? absentees.filter((a) => !a.alertSentAt).length : 0 },
    });
  }),
);

// ---------- Monthly register ----------

function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

router.get(
  '/register',
  ah(async (req, res) => {
    const school = req.user!.school!;
    const today = schoolToday(school.timezone);
    const q = parse(z.object({ sectionId: z.string(), month: monthStr.default(today.slice(0, 7)) }), req.query);
    const section = await loadSection(req, q.sectionId);
    if (!(await access(req, section, today, today)).view) throw forbidden();
    const days = monthDays(q.month);
    const workingDays = workingDaysOf((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).settings);
    const [records, sessions] = await Promise.all([
      prisma.attendanceRecord.findMany({ where: { sectionId: section.id, date: { gte: asDate(days[0]), lte: asDate(days[days.length - 1]) } } }),
      prisma.attendanceSession.findMany({ where: { sectionId: section.id, date: { gte: asDate(days[0]), lte: asDate(days[days.length - 1]) } }, select: { date: true } }),
    ]);
    // Students currently in the section plus anyone with a record here this month.
    const ids = [...new Set(records.map((r) => r.studentId))];
    const students = await prisma.student.findMany({
      where: { OR: [{ sectionId: section.id, status: 'ACTIVE', deletedAt: null }, { id: { in: ids } }] },
      select: { id: true, fullName: true, rollNo: true, admissionNo: true },
      orderBy: [{ rollNo: 'asc' }, { fullName: 'asc' }],
    });
    const markedDays = new Set(sessions.map((s) => ymd(s.date)));
    const rows = students.map((s) => {
      const mine = records.filter((r) => r.studentId === s.id);
      const byDay: Record<string, string> = {};
      for (const r of mine) byDay[ymd(r.date)] = r.status;
      const c = countBy(mine.map((r) => r.status));
      return { ...s, days: byDay, counts: c, percent: percent(c) };
    });
    res.json({
      section: { id: section.id, name: section.name, class: { name: section.class.name, stream: section.class.stream } },
      month: q.month,
      days: days.map((d) => ({ date: d, weekday: weekday(d), working: workingDays.includes(weekday(d)), marked: markedDays.has(d) })),
      students: rows,
    });
  }),
);

// ---------- One student ----------

async function studentSummary(studentId: string, from: string, to: string) {
  const records = await prisma.attendanceRecord.findMany({ where: { studentId, date: { gte: asDate(from), lte: asDate(to) } }, orderBy: { date: 'asc' } });
  const c = countBy(records.map((r) => r.status));
  return { from, to, counts: c, percent: percent(c), days: records.map((r) => ({ date: ymd(r.date), status: r.status, remark: r.remark })) };
}

router.get(
  '/students/:id',
  ah(async (req, res) => {
    const school = req.user!.school!;
    const today = schoolToday(school.timezone);
    const q = parse(z.object({ month: monthStr.default(today.slice(0, 7)) }), req.query);
    const st = await prisma.student.findFirst({ where: { id: req.params.id, schoolId: school.id, deletedAt: null } });
    if (!st) throw notFound('Student not found');
    const u = req.user!;
    let ok = can(req, 'students.view') || can(req, 'attendance.manage');
    if (!ok && u.role === 'TEACHER' && st.sectionId) ok = (await access(req, (await loadSection(req, st.sectionId)), today, today)).view;
    if (!ok && u.role === 'PARENT') ok = (await prisma.family.count({ where: { id: st.familyId, parentUserId: u.id } })) > 0;
    if (!ok && u.role === 'STUDENT') ok = st.userId === u.id;
    if (!ok) throw notFound('Student not found');
    const days = monthDays(q.month);
    // Session year to date: from the current session's start (or 1 Jan).
    const session = await prisma.academicSession.findFirst({ where: { schoolId: school.id, isCurrent: true } });
    const yearFrom = session ? ymd(session.startDate) : `${today.slice(0, 4)}-01-01`;
    res.json({ month: await studentSummary(st.id, days[0], days[days.length - 1]), year: await studentSummary(st.id, yearFrom, today) });
  }),
);

/** Parents and students: attendance of their children this month. */
router.get(
  '/my',
  ah(async (req, res) => {
    const school = req.user!.school!;
    const today = schoolToday(school.timezone);
    const q = parse(z.object({ month: monthStr.default(today.slice(0, 7)) }), req.query);
    const u = req.user!;
    const where = u.role === 'PARENT' ? { family: { parentUserId: u.id } } : u.role === 'STUDENT' ? { userId: u.id } : null;
    if (!where) throw forbidden();
    const kids = await prisma.student.findMany({ where: { ...where, schoolId: school.id, deletedAt: null }, select: { id: true, fullName: true }, orderBy: { dob: 'asc' } });
    const days = monthDays(q.month);
    const workingDays = workingDaysOf((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).settings);
    res.json({
      month: q.month,
      today,
      days: days.map((d) => ({ date: d, weekday: weekday(d), working: workingDays.includes(weekday(d)) })),
      children: await Promise.all(kids.map(async (k) => ({ student: k, ...(await studentSummary(k.id, days[0], days[days.length - 1])) }))),
    });
  }),
);

// ---------- Monthly summary and low attendance ----------

router.get(
  '/summary',
  ah(async (req, res) => {
    if (!(can(req, 'students.view') || can(req, 'attendance.manage'))) throw forbidden();
    const school = req.user!.school!;
    const today = schoolToday(school.timezone);
    const q = parse(z.object({ month: monthStr.default(today.slice(0, 7)), below: z.coerce.number().min(1).max(100).default(75) }), req.query);
    const days = monthDays(q.month);
    const range = { gte: asDate(days[0]), lte: asDate(days[days.length - 1]) };
    const [bySection, byStudent, sections] = await Promise.all([
      prisma.attendanceRecord.groupBy({ by: ['sectionId', 'status'], where: { schoolId: school.id, date: range }, _count: { _all: true } }),
      prisma.attendanceRecord.groupBy({ by: ['studentId', 'status'], where: { schoolId: school.id, date: range }, _count: { _all: true } }),
      prisma.section.findMany({ where: { schoolId: school.id, deletedAt: null }, select: { id: true, name: true, class: { select: { name: true, stream: true, sortOrder: true } } }, orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }] }),
    ]);
    const secCounts = new Map<string, Record<string, number>>();
    for (const r of bySection) secCounts.set(r.sectionId, { ...(secCounts.get(r.sectionId) ?? {}), [r.status]: r._count._all });
    const stuCounts = new Map<string, Record<string, number>>();
    for (const r of byStudent) stuCounts.set(r.studentId, { ...(stuCounts.get(r.studentId) ?? {}), [r.status]: r._count._all });
    const low = [...stuCounts.entries()].map(([id, c]) => ({ id, counts: c, percent: percent(c) })).filter((s) => s.percent !== null && s.percent < q.below);
    const lowStudents = await prisma.student.findMany({
      where: { id: { in: low.map((l) => l.id) }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, fullName: true, admissionNo: true, class: { select: { name: true } }, section: { select: { name: true } } },
    });
    res.json({
      month: q.month,
      below: q.below,
      sections: sections.filter((s) => secCounts.has(s.id)).map((s) => ({ ...s, counts: secCounts.get(s.id)!, percent: percent(secCounts.get(s.id)!) })),
      lowAttendance: low
        .map((l) => ({ ...l, student: lowStudents.find((s) => s.id === l.id) }))
        .filter((l) => l.student)
        .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0)),
    });
  }),
);

/** Sections the logged-in teacher marks (class teacher) — for the teacher's attendance page. */
router.get(
  '/my-sections',
  ah(async (req, res) => {
    const school = req.user!.school!;
    const today = schoolToday(school.timezone);
    const u = req.user!;
    const where = can(req, 'attendance.manage') ? { schoolId: school.id, deletedAt: null } : u.role === 'TEACHER' ? { schoolId: school.id, deletedAt: null, classTeacherId: u.id } : null;
    if (!where) throw forbidden();
    const sections = await prisma.section.findMany({
      where: { ...where, class: { deletedAt: null } },
      select: { id: true, name: true, class: { select: { name: true, stream: true, sortOrder: true } } },
      orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
    const sessions = await prisma.attendanceSession.findMany({ where: { sectionId: { in: sections.map((s) => s.id) }, date: asDate(today) }, select: { sectionId: true } });
    const done = new Set(sessions.map((s) => s.sectionId));
    res.json({ today, sections: sections.map((s) => ({ ...s, markedToday: done.has(s.id) })) });
  }),
);

export default router;
