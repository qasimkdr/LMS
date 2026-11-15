import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { assertPrincipal, can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';

/** Bell schedules (period timings), class timetables, teacher timetables. */
const router = Router();

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5, 6];
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour), e.g. 08:00');
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export function workingDaysOf(settings: unknown): number[] {
  const d = (settings as { workingDays?: number[] } | null)?.workingDays;
  return Array.isArray(d) && d.length ? d : DEFAULT_WORKING_DAYS;
}

/** Weekday (1 = Monday) and minutes since midnight, in the school's time zone. */
export function schoolNow(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

async function loadSchedules(schoolId: string) {
  const schedules = await prisma.bellSchedule.findMany({
    where: { schoolId },
    include: { periods: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
  return schedules.map((s) => ({ ...s, days: (s.days as number[]) ?? [] }));
}

/** Which schedule (and periods) applies on each working day. */
async function dayMap(schoolId: string) {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  const workingDays = workingDaysOf(school.settings);
  const schedules = await loadSchedules(schoolId);
  const byDay = new Map<number, (typeof schedules)[number]>();
  for (const s of schedules) for (const d of s.days) byDay.set(d, s);
  return { workingDays, schedules, byDay, timezone: school.timezone };
}

// ---------- Bell schedule setup ----------

router.get(
  '/setup',
  ah(async (req, res) => {
    const { workingDays, schedules } = await dayMap(tenantId(req));
    res.json({ workingDays, schedules, dayNames: DAY_NAMES });
  }),
);

const scheduleBody = z.object({
  workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  schedules: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(60),
        days: z.array(z.number().int().min(1).max(7)).min(1),
        periods: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string().trim().min(1).max(40),
              startTime: time,
              endTime: time,
              isBreak: z.boolean().default(false),
            }),
          )
          .min(1)
          .max(16),
      }),
    )
    .min(1)
    .max(5),
});

/** Saves working days and all schedules at once. Removed periods delete their timetable cells. */
router.put(
  '/setup',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const body = parse(scheduleBody, req.body);
    const working = [...new Set(body.workingDays)].sort();

    // Every working day needs exactly one schedule.
    const seen = new Map<number, string>();
    for (const s of body.schedules) {
      for (const d of s.days) {
        if (!working.includes(d)) throw badRequest(`${DAY_NAMES[d]} is not a working day but is used by "${s.name}"`);
        if (seen.has(d)) throw badRequest(`${DAY_NAMES[d]} is in both "${seen.get(d)}" and "${s.name}"`);
        seen.set(d, s.name);
      }
      // Periods must be in order and must not overlap.
      let prevEnd = -1;
      for (const p of s.periods) {
        const a = toMin(p.startTime);
        const b = toMin(p.endTime);
        if (b <= a) throw badRequest(`"${s.name}" → ${p.name}: end time must be after start time`);
        if (a < prevEnd) throw badRequest(`"${s.name}" → ${p.name} starts before the previous period ends`);
        prevEnd = b;
      }
    }
    const missing = working.filter((d) => !seen.has(d));
    if (missing.length) throw badRequest(`Choose timings for ${missing.map((d) => DAY_NAMES[d]).join(', ')}`);

    const existing = await loadSchedules(schoolId);
    const existingPeriodIds = new Set(existing.flatMap((s) => s.periods.map((p) => p.id)));
    const keepScheduleIds = new Set(body.schedules.map((s) => s.id).filter(Boolean) as string[]);
    const keepPeriodIds = new Set(body.schedules.flatMap((s) => s.periods.map((p) => p.id)).filter(Boolean) as string[]);
    for (const id of keepScheduleIds) if (!existing.find((s) => s.id === id)) throw badRequest('Unknown schedule');
    for (const id of keepPeriodIds) if (!existingPeriodIds.has(id)) throw badRequest('Unknown period');

    const removedPeriods = [...existingPeriodIds].filter((id) => !keepPeriodIds.has(id));
    const lostEntries = removedPeriods.length ? await prisma.timetableEntry.count({ where: { periodId: { in: removedPeriods } } }) : 0;

    await prisma.$transaction(async (tx) => {
      await tx.bellSchedule.deleteMany({ where: { schoolId, id: { notIn: [...keepScheduleIds] } } });
      if (removedPeriods.length) await tx.period.deleteMany({ where: { id: { in: removedPeriods } } });
      for (const s of body.schedules) {
        const sched = s.id
          ? await tx.bellSchedule.update({ where: { id: s.id }, data: { name: s.name, days: s.days } })
          : await tx.bellSchedule.create({ data: { schoolId, name: s.name, days: s.days } });
        for (const [i, p] of s.periods.entries()) {
          const data = { name: p.name, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak, sortOrder: i };
          if (p.id) await tx.period.update({ where: { id: p.id }, data: { ...data, scheduleId: sched.id } });
          else await tx.period.create({ data: { ...data, scheduleId: sched.id } });
        }
      }
      // Breaks hold no classes; cells on days that no longer use a schedule are removed.
      await tx.timetableEntry.deleteMany({ where: { schoolId, period: { isBreak: true } } });
      const all = await tx.bellSchedule.findMany({ where: { schoolId }, include: { periods: { select: { id: true } } } });
      for (const s of all) {
        const days = s.days as number[];
        await tx.timetableEntry.deleteMany({ where: { schoolId, periodId: { in: s.periods.map((p) => p.id) }, day: { notIn: days } } });
      }
      const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId } });
      await tx.school.update({ where: { id: schoolId }, data: { settings: { ...((school.settings as object) ?? {}), workingDays: working } } });
    });
    await audit(req, { action: 'timetable.schedule', entityType: 'School', entityId: schoolId, after: body, reason: lostEntries ? `${lostEntries} timetable cells removed` : null });
    res.json({ ok: true, removedEntries: lostEntries });
  }),
);

// ---------- Shared: build a weekly grid ----------

const entryInclude = {
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, fullName: true } },
  section: { select: { id: true, name: true, class: { select: { id: true, name: true, stream: true } } } },
} satisfies Prisma.TimetableEntryInclude;

type Entry = Prisma.TimetableEntryGetPayload<{ include: typeof entryInclude }>;

function buildWeek(map: Awaited<ReturnType<typeof dayMap>>, entries: Entry[]) {
  const key = (day: number, periodId: string) => `${day}:${periodId}`;
  const byKey = new Map<string, Entry[]>();
  for (const e of entries) byKey.set(key(e.day, e.periodId), [...(byKey.get(key(e.day, e.periodId)) ?? []), e]);
  return map.workingDays.map((day) => {
    const sched = map.byDay.get(day);
    return {
      day,
      dayName: DAY_NAMES[day],
      scheduleName: sched?.name ?? null,
      periods: (sched?.periods ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        startTime: p.startTime,
        endTime: p.endTime,
        isBreak: p.isBreak,
        entries: (byKey.get(key(day, p.id)) ?? []).map((e) => ({
          id: e.id,
          subject: e.subject,
          teacher: e.teacher,
          section: e.section,
          room: e.room,
          note: e.note,
        })),
      })),
    };
  });
}

// ---------- Class (section) timetable ----------

async function loadSection(req: Request, id: string) {
  const section = await prisma.section.findFirst({
    where: { id, schoolId: tenantId(req), deletedAt: null },
    include: { class: { include: { subjects: { include: { subject: true } } } }, classTeacher: { select: { id: true, fullName: true } } },
  });
  if (!section) throw notFound('Section not found');
  return section;
}

/** Who may view a section's timetable: principal/staff, its teachers, its students and their parents. */
async function canViewSection(req: Request, sectionId: string) {
  const u = req.user!;
  if (u.role === 'PRINCIPAL' || u.role === 'STAFF') return true;
  if (u.role === 'TEACHER') {
    const n = await prisma.section.count({
      where: { id: sectionId, OR: [{ classTeacherId: u.id }, { assignments: { some: { teacherId: u.id } } }, { timetable: { some: { teacherId: u.id } } }] },
    });
    return n > 0;
  }
  if (u.role === 'STUDENT') return (await prisma.student.count({ where: { userId: u.id, sectionId, deletedAt: null } })) > 0;
  if (u.role === 'PARENT') return (await prisma.student.count({ where: { sectionId, deletedAt: null, family: { parentUserId: u.id } } })) > 0;
  return false;
}

router.get(
  '/sections/:id',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const section = await loadSection(req, req.params.id);
    if (!(await canViewSection(req, section.id))) throw forbidden();
    const map = await dayMap(schoolId);
    const entries = await prisma.timetableEntry.findMany({ where: { sectionId: section.id }, include: entryInclude });
    const assignments = await prisma.teachingAssignment.findMany({
      where: { sectionId: section.id },
      select: { subjectId: true, teacher: { select: { id: true, fullName: true } } },
    });
    // Teachers busy elsewhere in each slot, to warn before a clash.
    const busy = can(req, 'students.view') || req.user!.role === 'PRINCIPAL'
      ? await prisma.timetableEntry.findMany({
          where: { schoolId, sectionId: { not: section.id }, teacherId: { not: null } },
          select: { day: true, periodId: true, teacherId: true, section: { select: { name: true, class: { select: { name: true } } } } },
        })
      : [];
    const subjectsCount = new Map<string, number>();
    for (const e of entries) if (e.subjectId) subjectsCount.set(e.subjectId, (subjectsCount.get(e.subjectId) ?? 0) + 1);
    res.json({
      section: { id: section.id, name: section.name, room: section.room, class: { id: section.class.id, name: section.class.name, stream: section.class.stream }, classTeacher: section.classTeacher },
      subjects: section.class.subjects.map((cs) => ({
        id: cs.subject.id,
        name: cs.subject.name,
        isOptional: cs.isOptional,
        teacher: assignments.find((a) => a.subjectId === cs.subject.id)?.teacher ?? null,
        periodsPerWeek: subjectsCount.get(cs.subject.id) ?? 0,
      })),
      week: buildWeek(map, entries),
      busy: busy.map((b) => ({ day: b.day, periodId: b.periodId, teacherId: b.teacherId, where: `${b.section.class.name} ${b.section.name}` })),
    });
  }),
);

const slotBody = z.object({
  day: z.number().int().min(1).max(7),
  periodId: z.string(),
  subjectId: z.string().nullish(),
  teacherId: z.string().nullish(),
  room: optStr(40),
  note: optStr(60),
});

/** Checks one cell and returns the data to save (or null to clear it). Throws on teacher clashes. */
async function validateSlot(schoolId: string, section: Awaited<ReturnType<typeof loadSection>>, slot: z.infer<typeof slotBody>, map: Awaited<ReturnType<typeof dayMap>>) {
  const sched = map.byDay.get(slot.day);
  if (!map.workingDays.includes(slot.day) || !sched) throw badRequest(`${DAY_NAMES[slot.day]} is not a working day`);
  const period = sched.periods.find((p) => p.id === slot.periodId);
  if (!period) throw badRequest(`That period is not in the ${DAY_NAMES[slot.day]} timings`);
  if (period.isBreak) throw badRequest('Classes cannot be placed in a break');
  if (!slot.subjectId && !slot.teacherId && !slot.note) return null;

  if (slot.subjectId && !section.class.subjects.some((cs) => cs.subjectId === slot.subjectId)) throw badRequest('This subject is not taught in this class');
  let teacherId = slot.teacherId ?? null;
  if (slot.teacherId === undefined && slot.subjectId) {
    // Default to the subject teacher assigned to this section.
    teacherId = (await prisma.teachingAssignment.findUnique({ where: { sectionId_subjectId: { sectionId: section.id, subjectId: slot.subjectId } } }))?.teacherId ?? null;
  }
  if (teacherId) {
    const t = await prisma.user.findFirst({ where: { id: teacherId, schoolId, role: 'TEACHER', deletedAt: null } });
    if (!t) throw badRequest('Choose a teacher of this school');
    const clash = await prisma.timetableEntry.findFirst({
      where: { schoolId, teacherId, day: slot.day, periodId: slot.periodId, sectionId: { not: section.id } },
      include: { section: { include: { class: true } } },
    });
    if (clash) throw conflict(`${t.fullName} already teaches ${clash.section.class.name} ${clash.section.name} on ${DAY_NAMES[slot.day]} in ${period.name}`);
  }
  return { subjectId: slot.subjectId ?? null, teacherId, room: slot.room ?? null, note: slot.note ?? null };
}

router.put(
  '/sections/:id/slot',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const section = await loadSection(req, req.params.id);
    const slot = parse(slotBody, req.body);
    const map = await dayMap(schoolId);
    const data = await validateSlot(schoolId, section, slot, map);
    const where = { sectionId_day_periodId: { sectionId: section.id, day: slot.day, periodId: slot.periodId } };
    if (!data) await prisma.timetableEntry.deleteMany({ where: { sectionId: section.id, day: slot.day, periodId: slot.periodId } });
    else await prisma.timetableEntry.upsert({ where, create: { ...data, schoolId, sectionId: section.id, day: slot.day, periodId: slot.periodId }, update: data });

    // Room double-booking is a warning, not an error (e.g. a shared hall).
    let warning: string | null = null;
    if (data?.room) {
      const other = await prisma.timetableEntry.findFirst({
        where: { schoolId, room: data.room, day: slot.day, periodId: slot.periodId, sectionId: { not: section.id } },
        include: { section: { include: { class: true } } },
      });
      if (other) warning = `Room ${data.room} is also used by ${other.section.class.name} ${other.section.name} at this time`;
    }
    await audit(req, { action: 'timetable.slot', entityType: 'Section', entityId: section.id, after: { ...slot, ...data } });
    res.json({ ok: true, warning });
  }),
);

/** Copy another section's timetable into this one (same subjects only); clashing cells are skipped. */
router.post(
  '/sections/:id/copy',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const section = await loadSection(req, req.params.id);
    const { fromSectionId, withTeachers } = parse(z.object({ fromSectionId: z.string(), withTeachers: z.boolean().default(false) }), req.body);
    const from = await loadSection(req, fromSectionId);
    if (from.id === section.id) throw badRequest('Choose a different section');
    const map = await dayMap(schoolId);
    const source = await prisma.timetableEntry.findMany({ where: { sectionId: from.id } });
    await prisma.timetableEntry.deleteMany({ where: { sectionId: section.id } });
    let copied = 0;
    const skipped: string[] = [];
    for (const e of source) {
      try {
        const data = await validateSlot(
          schoolId,
          section,
          {
            day: e.day,
            periodId: e.periodId,
            subjectId: section.class.subjects.some((cs) => cs.subjectId === e.subjectId) ? e.subjectId : null,
            // Same teacher as the source, or this section's own subject teacher.
            teacherId: withTeachers ? e.teacherId : undefined,
            room: null,
            note: e.note,
          },
          map,
        );
        if (data) {
          await prisma.timetableEntry.create({ data: { ...data, schoolId, sectionId: section.id, day: e.day, periodId: e.periodId } });
          copied++;
        }
      } catch (err) {
        skipped.push((err as Error).message);
      }
    }
    await audit(req, { action: 'timetable.copy', entityType: 'Section', entityId: section.id, after: { fromSectionId, copied, skipped: skipped.length } });
    res.json({ copied, skipped });
  }),
);

router.post(
  '/sections/:id/clear',
  ah(async (req, res) => {
    assertPrincipal(req);
    const section = await loadSection(req, req.params.id);
    const { count } = await prisma.timetableEntry.deleteMany({ where: { sectionId: section.id } });
    await audit(req, { action: 'timetable.clear', entityType: 'Section', entityId: section.id, before: { cells: count } });
    res.json({ cleared: count });
  }),
);

// ---------- Teacher timetable ----------

async function teacherWeek(schoolId: string, teacherId: string) {
  const map = await dayMap(schoolId);
  const entries = await prisma.timetableEntry.findMany({ where: { schoolId, teacherId }, include: entryInclude });
  const teaching = entries.filter((e) => !map.byDay.get(e.day)?.periods.find((p) => p.id === e.periodId)?.isBreak);
  return { week: buildWeek(map, entries), periodsPerWeek: teaching.length, timezone: map.timezone };
}

router.get(
  '/teachers/:id',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const u = req.user!;
    if (!(u.role === 'PRINCIPAL' || can(req, 'staff.view') || u.id === req.params.id)) throw forbidden();
    const teacher = await prisma.user.findFirst({ where: { id: req.params.id, schoolId, role: 'TEACHER', deletedAt: null }, select: { id: true, fullName: true } });
    if (!teacher) throw notFound('Teacher not found');
    res.json({ teacher, ...(await teacherWeek(schoolId, teacher.id)) });
  }),
);

/** Overview for the principal: how full each class timetable is and each teacher's weekly load. */
router.get(
  '/overview',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    if (!(req.user!.role === 'PRINCIPAL' || req.user!.role === 'STAFF')) throw forbidden();
    const map = await dayMap(schoolId);
    const slotsPerWeek = map.workingDays.reduce((n, d) => n + (map.byDay.get(d)?.periods.filter((p) => !p.isBreak).length ?? 0), 0);
    const [sections, perSection, perTeacher, teachers] = await Promise.all([
      prisma.section.findMany({
        where: { schoolId, deletedAt: null, class: { deletedAt: null } },
        select: { id: true, name: true, class: { select: { name: true, stream: true, sortOrder: true } } },
        orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }],
      }),
      prisma.timetableEntry.groupBy({ by: ['sectionId'], where: { schoolId }, _count: { _all: true } }),
      prisma.timetableEntry.groupBy({ by: ['teacherId'], where: { schoolId, teacherId: { not: null } }, _count: { _all: true } }),
      prisma.user.findMany({ where: { schoolId, role: 'TEACHER', deletedAt: null, isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
    ]);
    const filled = new Map(perSection.map((r) => [r.sectionId, r._count._all]));
    const load = new Map(perTeacher.map((r) => [r.teacherId!, r._count._all]));
    res.json({
      configured: map.schedules.length > 0,
      slotsPerWeek,
      sections: sections.map((s) => ({ id: s.id, name: s.name, class: s.class, filled: filled.get(s.id) ?? 0 })),
      teachers: teachers.map((t) => ({ ...t, periodsPerWeek: load.get(t.id) ?? 0 })),
    });
  }),
);

// ---------- "My timetable" for teachers, students and parents ----------

router.get(
  '/my',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const u = req.user!;
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const now = schoolNow(school.timezone);
    if (u.role === 'TEACHER') {
      return res.json({ role: u.role, now, ...(await teacherWeek(schoolId, u.id)) });
    }
    let students: { id: string; fullName: string; sectionId: string | null }[] = [];
    if (u.role === 'STUDENT') students = await prisma.student.findMany({ where: { userId: u.id, deletedAt: null }, select: { id: true, fullName: true, sectionId: true } });
    else if (u.role === 'PARENT') students = await prisma.student.findMany({ where: { family: { parentUserId: u.id }, deletedAt: null, status: 'ACTIVE' }, select: { id: true, fullName: true, sectionId: true }, orderBy: { dob: 'asc' } });
    else throw forbidden();
    const map = await dayMap(schoolId);
    const result = [];
    for (const s of students) {
      const entries = s.sectionId ? await prisma.timetableEntry.findMany({ where: { sectionId: s.sectionId }, include: entryInclude }) : [];
      result.push({ student: { id: s.id, fullName: s.fullName }, hasSection: Boolean(s.sectionId), week: buildWeek(map, entries) });
    }
    res.json({ role: u.role, now, children: result });
  }),
);

export default router;
