import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { round2 } from '../lib/money';
import { num, rank } from './exams';
import { percent as attendancePercent } from '../routes/attendance';

export interface StudentLite {
  id: string;
  fullName: string;
  rollNo: string | null;
  classId: string;
  sectionId: string | null;
  photoFileId: string | null;
  classLabel: string;
  className: string;
  classSort: number;
}
export interface RankRow {
  student: StudentLite;
  percent: number;
  count: number;
  position: number;
}

export const isPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
export function monthRange(period: string) {
  const [y, m] = period.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}
export function prevPeriod(period: string) {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
export const periodLabel = (period: string) => (isPeriod(period) ? monthRange(period).from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : period);

export async function studentsLite(schoolId: string, where: Prisma.StudentWhereInput = {}): Promise<Map<string, StudentLite>> {
  const rows = await prisma.student.findMany({
    where: { schoolId, deletedAt: null, status: 'ACTIVE', ...where },
    select: { id: true, fullName: true, rollNo: true, classId: true, sectionId: true, photoFileId: true, class: { select: { name: true, stream: true, sortOrder: true } }, section: { select: { name: true } } },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, fullName: r.fullName, rollNo: r.rollNo, classId: r.classId, sectionId: r.sectionId, photoFileId: r.photoFileId, className: `${r.class.name}${r.class.stream ? ` ${r.class.stream}` : ''}`, classLabel: `${r.class.name}${r.class.stream ? ` ${r.class.stream}` : ''}${r.section ? ` ${r.section.name}` : ''}`, classSort: r.class.sortOrder },
    ]),
  );
}

/** Published tests and exams whose date (last paper date, else publish date) is in [from, to). */
export async function publishedInRange(schoolId: string, from: Date, to: Date, extra: Prisma.AssessmentWhereInput = {}) {
  const list = await prisma.assessment.findMany({
    where: { schoolId, status: 'PUBLISHED', OR: [{ papers: { some: { date: { gte: from, lt: to } } } }, { publishedAt: { gte: from, lt: to } }], ...extra },
    include: { type: true, papers: { select: { id: true, subjectId: true, date: true, totalMarks: true } } },
  });
  return list
    .map((a) => ({ ...a, date: a.papers.map((p) => p.date).filter((d): d is Date => Boolean(d)).sort((x, y) => x.getTime() - y.getTime()).pop() ?? a.publishedAt ?? a.createdAt }))
    .filter((a) => a.date >= from && a.date < to);
}

/** Average % of each student over the given assessments. */
export async function averages(assessmentIds: string[], studentIds?: string[]) {
  const results = await prisma.studentResult.findMany({ where: { assessmentId: { in: assessmentIds }, ...(studentIds ? { studentId: { in: studentIds } } : {}) }, select: { studentId: true, percent: true, absentPapers: true, assessmentId: true } });
  const m = new Map<string, { sum: number; n: number }>();
  for (const r of results) {
    const x = m.get(r.studentId) ?? { sum: 0, n: 0 };
    x.sum += num(r.percent);
    x.n++;
    m.set(r.studentId, x);
  }
  return new Map([...m].map(([id, x]) => [id, { avg: round2(x.sum / x.n), n: x.n }]));
}

export async function attendanceStats(schoolId: string, from: Date, to: Date, studentIds?: string[]) {
  const groups = await prisma.attendanceRecord.groupBy({ by: ['studentId', 'status'], where: { schoolId, date: { gte: from, lt: to }, ...(studentIds ? { studentId: { in: studentIds } } : {}) }, _count: { _all: true } });
  const m = new Map<string, Record<string, number>>();
  for (const g of groups) {
    const c = m.get(g.studentId) ?? {};
    c[g.status] = g._count._all;
    m.set(g.studentId, c);
  }
  return new Map(
    [...m].map(([id, c]) => {
      const days = Object.values(c).reduce((a, b) => a + b, 0);
      return [id, { counts: c, days, percent: attendancePercent(c) ?? 0 }];
    }),
  );
}

function ranked(students: Map<string, StudentLite>, scores: Map<string, { avg: number; n: number }>): RankRow[] {
  const rows = [...scores].filter(([id]) => students.has(id)).map(([id, s]) => ({ student: students.get(id)!, percent: s.avg, count: s.n, position: 0 }));
  const pos = rank(rows, (r) => r.percent);
  for (const r of rows) r.position = pos.get(r)!;
  return rows.sort((a, b) => a.position - b.position || a.student.fullName.localeCompare(b.student.fullName));
}

/** Top N per class (ties at the cut-off are included). */
function byClass(rows: RankRow[], n: number) {
  const groups = new Map<string, { classId: string; label: string; sort: number; rows: RankRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.student.classId) ?? { classId: r.student.classId, label: r.student.className, sort: r.student.classSort, rows: [] };
    g.rows.push(r);
    groups.set(r.student.classId, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, undefined, { numeric: true }))
    .map((g) => {
      const pos = rank(g.rows, (r) => r.percent);
      const withPos = g.rows.map((r) => ({ ...r, position: pos.get(r)! })).sort((a, b) => a.position - b.position);
      return { classId: g.classId, label: g.label, rows: withPos.filter((r) => r.position <= n) };
    });
}

function improvement(students: Map<string, StudentLite>, now: Map<string, { avg: number; n: number }>, before: Map<string, { avg: number; n: number }>) {
  return [...now]
    .filter(([id]) => before.has(id) && students.has(id))
    .map(([id, s]) => ({ student: students.get(id)!, percent: s.avg, before: before.get(id)!.avg, change: round2(s.avg - before.get(id)!.avg) }))
    .filter((r) => r.change > 0)
    .sort((a, b) => b.change - a.change);
}

export interface RankingOptions {
  scope: 'month' | 'session' | 'exam';
  period?: string;
  examKey?: string;
  sectionIds?: string[] | null;
  top?: number;
}

/** Everything the rankings page shows for a month, the session or one exam. */
export async function rankings(schoolId: string, o: RankingOptions) {
  const top = o.top ?? 10;
  const students = await studentsLite(schoolId, o.sectionIds ? { sectionId: { in: o.sectionIds } } : {});
  const ids = [...students.keys()];
  let range: { from: Date; to: Date } | null = null;
  let current: Map<string, { avg: number; n: number }>;
  let previous: Map<string, { avg: number; n: number }> | null = null;
  let subjectToppers: { classLabel: string; subject: string; rows: { student: StudentLite; marks: number; total: number; percent: number }[] }[] = [];
  let title = '';

  if (o.scope === 'exam') {
    const list = await prisma.assessment.findMany({ where: { schoolId, status: 'PUBLISHED', kind: 'EXAM', OR: [{ id: o.examKey }, { groupKey: o.examKey }] }, include: { papers: { include: { marks: true } } } });
    title = list[0]?.title ?? '';
    current = await averages(list.map((a) => a.id), ids);
    // Previous exam of each class, for "most improved".
    const prevIds: string[] = [];
    for (const a of list) {
      const p = await prisma.assessment.findFirst({ where: { schoolId, classId: a.classId, kind: 'EXAM', status: 'PUBLISHED', publishedAt: { lt: a.publishedAt ?? new Date() }, id: { not: a.id } }, orderBy: { publishedAt: 'desc' } });
      if (p) prevIds.push(p.id);
    }
    previous = prevIds.length ? await averages(prevIds, ids) : new Map();
    const subjects = await prisma.subject.findMany({ where: { schoolId }, select: { id: true, name: true } });
    for (const a of list) {
      for (const paper of a.papers) {
        const marks = paper.marks.filter((m) => !m.isAbsent && m.marks !== null && students.has(m.studentId));
        if (!marks.length) continue;
        const best = Math.max(...marks.map((m) => num(m.marks)));
        const winners = marks.filter((m) => num(m.marks) === best);
        const total = num(paper.totalMarks);
        const first = students.get(winners[0].studentId)!;
        subjectToppers.push({
          classLabel: first.className,
          subject: subjects.find((s) => s.id === paper.subjectId)?.name ?? '',
          rows: winners.map((w) => ({ student: students.get(w.studentId)!, marks: best, total, percent: total ? round2((best / total) * 100) : 0 })),
        });
      }
    }
    subjectToppers = subjectToppers.sort((a, b) => (students.get(a.rows[0].student.id)!.classSort - students.get(b.rows[0].student.id)!.classSort) || a.subject.localeCompare(b.subject));
  } else {
    if (o.scope === 'month') {
      range = monthRange(o.period!);
      title = periodLabel(o.period!);
      const prev = monthRange(prevPeriod(o.period!));
      previous = await averages((await publishedInRange(schoolId, prev.from, prev.to)).map((a) => a.id), ids);
    } else {
      const s = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
      const now = new Date();
      range = s ? { from: s.startDate, to: new Date(s.endDate.getTime() + 86400000) } : { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)) };
      title = s ? `Session ${s.name}` : String(now.getUTCFullYear());
    }
    current = await averages((await publishedInRange(schoolId, range.from, range.to)).map((a) => a.id), ids);
  }

  const all = ranked(students, current);
  const att = range ? await attendanceStats(schoolId, range.from, range.to, ids) : null;
  const attendance = att
    ? [...att]
        .filter(([id, a]) => students.has(id) && a.days > 0)
        .map(([id, a]) => ({ student: students.get(id)!, percent: a.percent, days: a.days, absent: (a.counts.ABSENT ?? 0) + (a.counts.LEAVE ?? 0) }))
        .sort((a, b) => b.percent - a.percent || b.days - a.days || a.student.fullName.localeCompare(b.student.fullName))
    : [];
  return {
    title,
    from: range?.from ?? null,
    to: range?.to ?? null,
    school: all.filter((r) => r.position <= top),
    byClass: byClass(all, 3),
    subjectToppers,
    mostImproved: previous ? improvement(students, current, previous).slice(0, top) : [],
    perfectAttendance: attendance.filter((a) => a.percent === 100),
    attendanceTop: attendance.slice(0, top),
    counted: all.length,
  };
}

// ---------- Honors ----------

export const DEFAULT_HONORS: { name: string; icon: string; scope: 'CLASS' | 'SCHOOL'; rule: string | null }[] = [
  { name: 'Student of the Month', icon: '🏆', scope: 'CLASS', rule: 'TOP_MONTH' },
  { name: 'Best Attendance', icon: '📅', scope: 'CLASS', rule: 'ATTENDANCE' },
  { name: 'Most Improved', icon: '📈', scope: 'CLASS', rule: 'IMPROVED' },
  { name: 'Star Performer', icon: '⭐', scope: 'SCHOOL', rule: 'STAR' },
  { name: 'Best Behavior', icon: '😊', scope: 'CLASS', rule: null },
  { name: 'Subject Star', icon: '📘', scope: 'CLASS', rule: null },
  { name: 'Sports Star', icon: '⚽', scope: 'SCHOOL', rule: null },
  { name: 'Head Boy / Head Girl', icon: '🎖️', scope: 'SCHOOL', rule: null },
  { name: 'Prefect', icon: '🛡️', scope: 'SCHOOL', rule: null },
];

export async function ensureHonorTypes(schoolId: string) {
  if (await prisma.honorType.count({ where: { schoolId } })) return;
  await prisma.honorType.createMany({ data: DEFAULT_HONORS.map((h, i) => ({ schoolId, ...h, sortOrder: i * 10 })), skipDuplicates: true });
}

/** Suggested winners for each honor with a rule, based on the month's rankings. */
export async function honorSuggestions(schoolId: string, period: string) {
  const r = await rankings(schoolId, { scope: 'month', period, top: 3 });
  const perClass = <T extends { student: StudentLite }>(rows: T[], n: number) => {
    const m = new Map<string, T[]>();
    for (const x of rows) {
      const list = m.get(x.student.classId) ?? [];
      if (list.length < n) list.push(x);
      m.set(x.student.classId, list);
    }
    return [...m.values()].flat();
  };
  return {
    TOP_MONTH: r.byClass.flatMap((c) => c.rows.filter((x) => x.position === 1).map((x) => ({ student: x.student, reason: `${x.percent}% average in ${x.count} result(s)` }))),
    ATTENDANCE: r.perfectAttendance.map((x) => ({ student: x.student, reason: `100% attendance (${x.days} days)` })),
    IMPROVED: perClass(r.mostImproved, 1).map((x) => ({ student: x.student, reason: `${x.before}% → ${x.percent}% (+${x.change})` })),
    STAR: r.school.filter((x) => x.position <= 3).map((x) => ({ student: x.student, reason: `School position ${x.position} · ${x.percent}%` })),
  } as Record<string, { student: StudentLite; reason: string }[]>;
}
