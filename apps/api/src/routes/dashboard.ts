import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { forbidden } from '../lib/errors';
import { can } from '../lib/http';
import { round2 } from '../lib/money';
import { tenantId } from '../middleware/auth';
import { num } from '../services/exams';
import { schoolToday, percent as attendancePercent } from './attendance';
import { rankings, prevPeriod } from '../services/rankings';

/** One call per dashboard: headline numbers, trends and to-do lists for the logged-in role. */
const router = Router();

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;
const mods = (req: Request) => (req.user!.school!.plan.modules as string[] | null) ?? [];

/** Attendance % per day for the last N days that have any attendance. */
async function attendanceTrend(schoolId: string, today: string, days: number, where: object = {}) {
  const from = asDate(today);
  from.setUTCDate(from.getUTCDate() - days * 2);
  const groups = await prisma.attendanceRecord.groupBy({ by: ['date', 'status'], where: { schoolId, date: { gte: from, lte: asDate(today) }, ...where }, _count: { _all: true } });
  const byDay = new Map<string, Record<string, number>>();
  for (const g of groups) {
    const k = ymd(g.date);
    const c = byDay.get(k) ?? {};
    c[g.status] = g._count._all;
    byDay.set(k, c);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-days)
    .map(([date, c]) => ({ date, percent: attendancePercent(c) ?? 0, absent: c.ABSENT ?? 0 }));
}

async function syllabusPercent(schoolId: string, sectionIds?: string[]) {
  const sections = await prisma.section.findMany({ where: { schoolId, deletedAt: null, ...(sectionIds ? { id: { in: sectionIds } } : {}) }, select: { id: true, classId: true } });
  const items = await prisma.syllabusItem.findMany({ where: { schoolId }, select: { id: true, classId: true, parentId: true } });
  const parents = new Set(items.map((i) => i.parentId).filter(Boolean));
  const leaves = items.filter((i) => !parents.has(i.id));
  const total = sections.reduce((s, sec) => s + leaves.filter((l) => l.classId === sec.classId).length, 0);
  if (!total) return null;
  const done = await prisma.syllabusProgress.count({ where: { schoolId, sectionId: { in: sections.map((s) => s.id) }, itemId: { in: leaves.map((l) => l.id) } } });
  return Math.round((done / total) * 1000) / 10;
}

async function topStudents(schoolId: string, today: string, sectionIds: string[] | null) {
  let period = today.slice(0, 7);
  let r = await rankings(schoolId, { scope: 'month', period, sectionIds, top: 5 });
  if (!r.school.length) {
    period = prevPeriod(period);
    r = await rankings(schoolId, { scope: 'month', period, sectionIds, top: 5 });
  }
  return { period, title: r.title, rows: r.school.slice(0, 5).map((x) => ({ id: x.student.id, fullName: x.student.fullName, classLabel: x.student.classLabel, photoFileId: x.student.photoFileId, percent: x.percent, position: x.position })) };
}

async function upcomingExams(schoolId: string, today: string, classIds?: string[]) {
  const papers = await prisma.assessmentPaper.findMany({
    where: { date: { gte: asDate(today) }, assessment: { schoolId, status: 'DRAFT', ...(classIds ? { classId: { in: classIds } } : {}) } },
    include: { assessment: { select: { id: true, title: true, kind: true, classId: true } } },
    orderBy: { date: 'asc' },
    take: 8,
  });
  const subjects = await prisma.subject.findMany({ where: { id: { in: papers.map((p) => p.subjectId) } }, select: { id: true, name: true } });
  const classes = await prisma.classLevel.findMany({ where: { id: { in: papers.map((p) => p.assessment.classId) } }, select: { id: true, name: true, stream: true } });
  return papers.map((p) => ({ id: p.id, assessmentId: p.assessment.id, title: p.assessment.title, kind: p.assessment.kind, date: p.date ? ymd(p.date) : null, subject: subjects.find((s) => s.id === p.subjectId)?.name ?? '', classLabel: classLabel(classes.find((c) => c.id === p.assessment.classId) ?? { name: '', stream: null }) }));
}

router.get(
  '/',
  ah(async (req, res) => {
    const u = req.user!;
    const schoolId = tenantId(req);
    const today = schoolToday(u.school!.timezone);
    const m = mods(req);
    if (u.role === 'PRINCIPAL' || u.role === 'STAFF') return res.json(await managerDashboard(req, schoolId, today, m));
    if (u.role === 'TEACHER') return res.json(await teacherDashboard(req, schoolId, today, m));
    if (u.role === 'PARENT' || u.role === 'STUDENT') return res.json(await familyDashboard(req, schoolId, today, m));
    throw forbidden();
  }),
);

async function managerDashboard(req: Request, schoolId: string, today: string, m: string[]) {
  const monthStart = asDate(`${today.slice(0, 7)}-01`);
  const seeStudents = can(req, 'students.view');
  const [students, boys, girls, newThisMonth, teachers, staff, classes] = await Promise.all([
    prisma.student.count({ where: { schoolId, status: 'ACTIVE', deletedAt: null } }),
    prisma.student.count({ where: { schoolId, status: 'ACTIVE', deletedAt: null, gender: 'MALE' } }),
    prisma.student.count({ where: { schoolId, status: 'ACTIVE', deletedAt: null, gender: 'FEMALE' } }),
    prisma.student.count({ where: { schoolId, deletedAt: null, createdAt: { gte: monthStart } } }),
    prisma.user.count({ where: { schoolId, role: 'TEACHER', isActive: true, deletedAt: null } }),
    prisma.user.count({ where: { schoolId, role: 'STAFF', isActive: true, deletedAt: null } }),
    prisma.classLevel.findMany({ where: { schoolId, deletedAt: null }, select: { id: true, name: true, stream: true, sortOrder: true, _count: { select: { students: { where: { status: 'ACTIVE', deletedAt: null } } } } }, orderBy: { sortOrder: 'asc' } }),
  ]);
  const manageExams = can(req, 'exams.manage');
  const [sheetsToApprove, papersToApprove, resultsToApprove] = manageExams
    ? await Promise.all([
        prisma.markSheet.count({ where: { status: 'SUBMITTED', paper: { assessment: { schoolId } } } }),
        m.includes('online_exams') ? prisma.onlinePaper.count({ where: { schoolId, status: 'AWAITING_APPROVAL' } }) : 0,
        m.includes('online_exams') ? prisma.onlinePaper.count({ where: { schoolId, status: 'RESULTS_SUBMITTED' } }) : 0,
      ])
    : [0, 0, 0];
  const complaintsOpen = m.includes('parent_messaging') && req.user!.role === 'PRINCIPAL' ? await prisma.complaint.findMany({ where: { schoolId, status: { in: ['NEW', 'IN_PROGRESS'] } }, select: { id: true, ticketNo: true, subject: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } }) : [];
  const remarks = seeStudents ? await prisma.studentRemark.findMany({ where: { schoolId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 5 }) : [];
  const remarkPeople = await Promise.all([
    prisma.student.findMany({ where: { id: { in: remarks.map((r) => r.studentId) } }, select: { id: true, fullName: true } }),
    prisma.user.findMany({ where: { id: { in: remarks.map((r) => r.createdById) } }, select: { id: true, fullName: true } }),
  ]);
  const circulars = await prisma.circular.findMany({ where: { schoolId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 3, include: { _count: { select: { reads: true } } } });
  const gatePassesToday = await prisma.gatePass.count({ where: { schoolId, leftAt: { gte: new Date(Date.now() - 18 * 3600000) } } });
  return {
    role: 'MANAGER',
    today,
    students: { total: students, boys, girls, newThisMonth },
    staff: { teachers, staff },
    classStrength: classes.map((c) => ({ label: classLabel(c), count: c._count.students })),
    attendanceTrend: m.includes('attendance') ? await attendanceTrend(schoolId, today, 14) : [],
    syllabus: m.includes('lms') ? await syllabusPercent(schoolId) : null,
    top: m.includes('honors') && (manageExams || seeStudents) ? await topStudents(schoolId, today, null) : null,
    upcomingExams: m.includes('exams') ? await upcomingExams(schoolId, today) : [],
    approvals: { sheets: sheetsToApprove, onlinePapers: papersToApprove, onlineResults: resultsToApprove },
    complaints: { open: complaintsOpen.length, oldest: complaintsOpen[0] ?? null, list: complaintsOpen.slice(0, 4) },
    remarks: remarks.map((r) => ({ id: r.id, category: r.category, text: r.text, date: ymd(r.date), student: remarkPeople[0].find((s) => s.id === r.studentId)?.fullName ?? '', studentId: r.studentId, by: remarkPeople[1].find((x) => x.id === r.createdById)?.fullName ?? '' })),
    circulars: circulars.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, recipients: (c.recipientIds as string[]).length, reads: c._count.reads })),
    gatePassesToday,
  };
}

async function teacherDashboard(req: Request, schoolId: string, today: string, m: string[]) {
  const u = req.user!;
  const [own, taught] = await Promise.all([
    prisma.section.findMany({ where: { schoolId, classTeacherId: u.id, deletedAt: null }, select: { id: true, name: true, classId: true, class: { select: { name: true, stream: true } }, _count: { select: { students: { where: { status: 'ACTIVE', deletedAt: null } } } } } }),
    prisma.teachingAssignment.findMany({ where: { schoolId, teacherId: u.id, section: { deletedAt: null } }, select: { sectionId: true, subject: { select: { name: true } }, section: { select: { id: true, name: true, classId: true, class: { select: { name: true, stream: true } }, _count: { select: { students: { where: { status: 'ACTIVE', deletedAt: null } } } } } } } }),
  ]);
  const sectionMap = new Map<string, { id: string; label: string; classId: string; students: number; classTeacher: boolean; subjects: string[] }>();
  for (const s of own) sectionMap.set(s.id, { id: s.id, label: classLabel(s.class, s), classId: s.classId, students: s._count.students, classTeacher: true, subjects: [] });
  for (const t of taught) {
    const x = sectionMap.get(t.sectionId) ?? { id: t.section.id, label: classLabel(t.section.class, t.section), classId: t.section.classId, students: t.section._count.students, classTeacher: false, subjects: [] };
    x.subjects.push(t.subject.name);
    sectionMap.set(t.sectionId, x);
  }
  const sections = [...sectionMap.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const ids = sections.map((s) => s.id);
  const marked = m.includes('attendance') ? await prisma.attendanceSession.findMany({ where: { sectionId: { in: own.map((s) => s.id) }, date: asDate(today) }, select: { sectionId: true } }) : [];
  const todayAtt = m.includes('attendance') ? await prisma.attendanceRecord.groupBy({ by: ['sectionId', 'status'], where: { sectionId: { in: ids }, date: asDate(today) }, _count: { _all: true } }) : [];
  const pendingSheets = m.includes('exams')
    ? await prisma.markSheet.findMany({ where: { status: { in: ['DRAFT', 'RETURNED'] }, sectionId: { in: ids }, paper: { assessment: { schoolId } } }, include: { paper: { include: { assessment: { select: { title: true } } } } }, take: 50 })
    : [];
  // Only sheets of subjects this teacher teaches in that section (or tests they created).
  const taughtPairs = new Set(taught.map((t) => `${t.sectionId}`));
  const mySheets = pendingSheets.filter((s) => taughtPairs.has(s.sectionId) || own.some((o) => o.id === s.sectionId));
  const unread = m.includes('parent_messaging') ? await prisma.conversationMessage.count({ where: { senderId: { not: u.id }, readAt: null, conversation: { teacherId: u.id, deletedAt: null } } }) : 0;
  const homeworkToday = m.includes('lms') ? await prisma.homework.groupBy({ by: ['sectionId'], where: { schoolId, sectionId: { in: ids }, date: asDate(today), deletedAt: null }, _count: { _all: true } }) : [];
  const onlineToCheck = m.includes('online_exams') ? await prisma.onlinePaper.count({ where: { schoolId, createdById: u.id, status: { in: ['SCHEDULED', 'RESULTS_RETURNED'] }, endAt: { lt: new Date() } } }) : 0;
  const reported = m.includes('class_chat') ? await prisma.chatMessage.count({ where: { sectionId: { in: ids }, reportedById: { not: null }, reportReviewedAt: null } }) : 0;
  return {
    role: 'TEACHER',
    today,
    sections: sections.map((s) => {
      const c: Record<string, number> = {};
      todayAtt.filter((g) => g.sectionId === s.id).forEach((g) => (c[g.status] = g._count._all));
      return { ...s, attendanceMarked: marked.some((x) => x.sectionId === s.id), attendancePercent: attendancePercent(c), absent: c.ABSENT ?? 0, homeworkToday: homeworkToday.find((h) => h.sectionId === s.id)?._count._all ?? 0 };
    }),
    students: sections.reduce((n, s) => n + s.students, 0),
    attendanceTrend: m.includes('attendance') && own.length ? await attendanceTrend(schoolId, today, 14, { sectionId: { in: own.map((s) => s.id) } }) : [],
    pendingSheets: mySheets.slice(0, 6).map((s) => ({ id: s.id, paperId: s.paperId, title: s.paper.assessment.title, status: s.status, sectionLabel: sectionMap.get(s.sectionId)?.label ?? '' })),
    pendingSheetCount: mySheets.length,
    unreadMessages: unread,
    onlineToCheck,
    reportedChat: reported,
    syllabus: m.includes('lms') ? await syllabusPercent(schoolId, ids) : null,
    top: m.includes('honors') && ids.length ? await topStudents(schoolId, today, ids) : null,
    upcomingExams: m.includes('exams') ? await upcomingExams(schoolId, today, [...new Set(sections.map((s) => s.classId))]) : [],
  };
}

async function familyDashboard(req: Request, schoolId: string, today: string, m: string[]) {
  const u = req.user!;
  const kids = await prisma.student.findMany({
    where: { schoolId, deletedAt: null, status: 'ACTIVE', ...(u.role === 'PARENT' ? { family: { parentUserId: u.id } } : { userId: u.id }) },
    select: { id: true, fullName: true, photoFileId: true, rollNo: true, classId: true, sectionId: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } } },
    orderBy: { dob: 'asc' },
  });
  const monthStart = asDate(`${today.slice(0, 7)}-01`);
  const children = [];
  for (const k of kids) {
    const [att, todayRec, open, latest, hw, remarks, honors, online] = await Promise.all([
      m.includes('attendance') ? prisma.attendanceRecord.groupBy({ by: ['status'], where: { studentId: k.id, date: { gte: monthStart, lte: asDate(today) } }, _count: { _all: true } }) : [],
      m.includes('attendance') ? prisma.attendanceRecord.findUnique({ where: { studentId_date: { studentId: k.id, date: asDate(today) } }, select: { status: true } }) : null,
      m.includes('fees') ? prisma.feeInvoice.findMany({ where: { studentId: k.id, status: { in: ['UNPAID', 'PARTIAL'] } }, select: { total: true, paidAmount: true, dueDate: true } }) : [],
      m.includes('exams') ? prisma.studentResult.findMany({ where: { studentId: k.id, assessment: { status: 'PUBLISHED' } }, include: { assessment: { select: { id: true, title: true, publishedAt: true } } }, orderBy: { assessment: { publishedAt: 'desc' } }, take: 6 }) : [],
      m.includes('lms') && k.sectionId ? prisma.homework.count({ where: { sectionId: k.sectionId, date: asDate(today), deletedAt: null } }) : 0,
      prisma.studentRemark.findMany({ where: { studentId: k.id, shared: true, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 2 }),
      m.includes('honors') ? prisma.honor.findMany({ where: { studentId: k.id }, include: { type: true }, orderBy: { createdAt: 'desc' }, take: 3 }) : [],
      m.includes('online_exams') && k.sectionId ? prisma.onlinePaper.findMany({ where: { schoolId, classId: k.classId, status: 'SCHEDULED', endAt: { gt: new Date() } }, select: { id: true, title: true, startAt: true, endAt: true, sectionIds: true } }) : [],
    ]);
    const c: Record<string, number> = {};
    att.forEach((g) => (c[g.status] = g._count._all));
    const due = round2(open.reduce((s, i) => s + num(i.total) - num(i.paidAmount), 0));
    children.push({
      student: { id: k.id, fullName: k.fullName, photoFileId: k.photoFileId, rollNo: k.rollNo, classLabel: classLabel(k.class, k.section) },
      attendance: { percent: attendancePercent(c), days: Object.values(c).reduce((a, b) => a + b, 0), absent: c.ABSENT ?? 0, today: todayRec?.status ?? null },
      fees: m.includes('fees') ? { due, overdue: open.some((i) => i.dueDate < asDate(today)) } : null,
      results: latest.map((r) => ({ assessmentId: r.assessment.id, title: r.assessment.title, percent: num(r.percent), grade: r.grade, position: r.positionSection })).reverse(),
      homeworkToday: hw,
      remarks: remarks.map((r) => ({ id: r.id, category: r.category, text: r.text, date: ymd(r.date) })),
      honors: honors.map((h) => ({ id: h.id, name: h.type.name, icon: h.type.icon, period: h.period })),
      onlineExams: online.filter((o) => k.sectionId && (o.sectionIds as string[]).includes(k.sectionId)).map((o) => ({ id: o.id, title: o.title, startAt: o.startAt, endAt: o.endAt })),
    });
  }
  const unreadCirculars = await prisma.circular.count({ where: { schoolId, deletedAt: null, recipientIds: { array_contains: u.id }, reads: { none: { userId: u.id } } } });
  const latestCirculars = await prisma.circular.findMany({ where: { schoolId, deletedAt: null, recipientIds: { array_contains: u.id } }, orderBy: { createdAt: 'desc' }, take: 3, include: { reads: { where: { userId: u.id } } } });
  const albums = m.includes('gallery') ? await prisma.album.findMany({ where: { schoolId, deletedAt: null, OR: [{ visibility: 'SCHOOL' }, ...kids.map((k) => ({ visibility: 'CLASSES', classIds: { array_contains: k.classId } }))] }, orderBy: { createdAt: 'desc' }, take: 4, include: { photos: { take: 1, orderBy: { sortOrder: 'asc' } } } }) : [];
  return {
    role: 'FAMILY',
    today,
    children,
    circulars: { unread: unreadCirculars, latest: latestCirculars.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, read: c.reads.length > 0 })) },
    albums: albums.map((a) => ({ id: a.id, title: a.title, cover: a.photos[0]?.thumbFileId ?? a.photos[0]?.fileId ?? null })),
  };
}

export default router;
