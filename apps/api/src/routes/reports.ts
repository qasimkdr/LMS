import { Router, type Request, type Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import type { PermissionKey } from '../config/permissions';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { num } from '../services/exams';
import { round2 } from '../lib/money';

/** Excel (.xlsx) exports of the main school reports. */
const router = Router();

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface Sheet {
  title: string;
  subtitle?: string;
  columns: { header: string; key: string; width?: number; numFmt?: string }[];
  rows: Record<string, string | number | null>[];
}

/** A tidy workbook: title rows, bold header, frozen header row, filters, number formats. */
async function sendWorkbook(req: Request, res: Response, filename: string, sheets: Sheet[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = req.user!.school!.name;
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.title.slice(0, 31).replace(/[\\/*?:[\]]/g, ' '));
    ws.addRow([req.user!.school!.name]).font = { bold: true, size: 14 };
    ws.addRow([s.subtitle ?? s.title]).font = { color: { argb: 'FF6B7280' } };
    ws.addRow([]);
    const header = ws.addRow(s.columns.map((c) => c.header));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F63E0' } };
      cell.alignment = { vertical: 'middle' };
    });
    for (const r of s.rows) ws.addRow(s.columns.map((c) => r[c.key] ?? ''));
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.min(40, Math.max(10, c.header.length + 2));
      if (c.numFmt) col.numFmt = c.numFmt;
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: s.columns.length } };
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}.xlsx"`);
  await audit(req, { action: 'report.export', entityType: 'Report', entityId: filename });
  await wb.xlsx.write(res);
  res.end();
}

const need = (req: Request, ...keys: PermissionKey[]) => {
  if (!keys.some((k) => can(req, k))) throw forbidden();
};

/** Which reports this user can download (for the reports page). */
router.get(
  '/',
  ah(async (req, res) => {
    const mods = (req.user!.school!.plan.modules as string[] | null) ?? [];
    const list = [
      { key: 'students', group: 'Students', title: 'Student list and contacts', ok: can(req, 'students.view') },
      { key: 'strength', group: 'Students', title: 'Class strength by gender', ok: can(req, 'students.view') },
      { key: 'attendance-register', group: 'Attendance', title: 'Monthly attendance register', ok: mods.includes('attendance') && (can(req, 'attendance.manage') || can(req, 'students.view')) },
      { key: 'low-attendance', group: 'Attendance', title: 'Low attendance list', ok: mods.includes('attendance') && (can(req, 'attendance.manage') || can(req, 'students.view')) },
      { key: 'fee-collection', group: 'Fees', title: 'Fee collection (receipts)', ok: mods.includes('fees') && can(req, 'fees.reports') },
      { key: 'fee-defaulters', group: 'Fees', title: 'Defaulters with dues', ok: mods.includes('fees') && can(req, 'fees.reports') },
      { key: 'results', group: 'Academics', title: 'Result / tabulation sheet', ok: mods.includes('exams') && can(req, 'exams.manage') },
      { key: 'syllabus', group: 'Academics', title: 'Syllabus coverage', ok: mods.includes('lms') && (can(req, 'lms.manage') || can(req, 'students.view')) },
      { key: 'messages', group: 'Communication', title: 'WhatsApp messages log', ok: can(req, 'messages.send') },
    ];
    res.json({ reports: list.filter((r) => r.ok).map(({ ok: _ok, ...r }) => r) });
  }),
);

router.get(
  '/students',
  ah(async (req, res) => {
    need(req, 'students.view');
    const q = parse(z.object({ classId: z.string().optional(), status: z.string().optional() }), req.query);
    const rows = await prisma.student.findMany({
      where: { schoolId: tenantId(req), deletedAt: null, status: (q.status as never) ?? 'ACTIVE', ...(q.classId ? { classId: q.classId } : {}) },
      include: { class: true, section: true, family: { include: { guardians: true } } },
      orderBy: [{ class: { sortOrder: 'asc' } }, { section: { name: 'asc' } }, { rollNo: 'asc' }, { fullName: 'asc' }],
    });
    await sendWorkbook(req, res, 'students', [
      {
        title: 'Students',
        subtitle: `Student list (${rows.length})`,
        columns: [
          { header: 'Adm. no', key: 'adm' },
          { header: 'Name', key: 'name', width: 26 },
          { header: 'Class', key: 'cls', width: 14 },
          { header: 'Roll', key: 'roll', width: 8 },
          { header: 'Gender', key: 'gender' },
          { header: 'Date of birth', key: 'dob', width: 13 },
          { header: 'Father / guardian', key: 'guardian', width: 24 },
          { header: 'Phone', key: 'phone', width: 16 },
          { header: 'Family no', key: 'family' },
          { header: 'Admitted', key: 'admitted', width: 12 },
          { header: 'Status', key: 'status' },
        ],
        rows: rows.map((s) => {
          const g = s.family.guardians.find((x) => x.relation === 'FATHER') ?? s.family.guardians[0];
          return { adm: s.admissionNo, name: s.fullName, cls: classLabel(s.class, s.section), roll: s.rollNo, gender: s.gender, dob: ymd(s.dob), guardian: g?.fullName ?? '', phone: g?.phone ?? '', family: s.family.familyNo, admitted: ymd(s.admissionDate), status: s.status };
        }),
      },
    ]);
  }),
);

router.get(
  '/strength',
  ah(async (req, res) => {
    need(req, 'students.view');
    const sections = await prisma.section.findMany({ where: { schoolId: tenantId(req), deletedAt: null }, include: { class: true, students: { where: { status: 'ACTIVE', deletedAt: null }, select: { gender: true } } }, orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }] });
    const rows = sections.map((s) => ({ cls: classLabel(s.class, s), boys: s.students.filter((x) => x.gender === 'MALE').length, girls: s.students.filter((x) => x.gender === 'FEMALE').length, total: s.students.length }));
    rows.push({ cls: 'Total', boys: rows.reduce((a, r) => a + r.boys, 0), girls: rows.reduce((a, r) => a + r.girls, 0), total: rows.reduce((a, r) => a + r.total, 0) });
    await sendWorkbook(req, res, 'class-strength', [{ title: 'Strength', subtitle: 'Class strength by gender', columns: [{ header: 'Class', key: 'cls', width: 18 }, { header: 'Boys', key: 'boys' }, { header: 'Girls', key: 'girls' }, { header: 'Total', key: 'total' }], rows }]);
  }),
);

router.get(
  '/attendance-register',
  ah(async (req, res) => {
    need(req, 'attendance.manage', 'students.view');
    const q = parse(z.object({ sectionId: z.string(), month }), req.query);
    const section = await prisma.section.findFirst({ where: { id: q.sectionId, schoolId: tenantId(req) }, include: { class: true } });
    if (!section) throw notFound('Section not found');
    const [y, m] = q.month.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const students = await prisma.student.findMany({ where: { sectionId: section.id, deletedAt: null, status: 'ACTIVE' }, orderBy: [{ rollNo: 'asc' }, { fullName: 'asc' }] });
    const recs = await prisma.attendanceRecord.findMany({ where: { sectionId: section.id, date: { gte: from, lt: to } } });
    const code: Record<string, string> = { PRESENT: 'P', ABSENT: 'A', LATE: 'L', LEAVE: 'LV', HALF_DAY: 'H' };
    const dayCols = Array.from({ length: days }, (_, i) => ({ header: String(i + 1), key: `d${i + 1}`, width: 4 }));
    await sendWorkbook(req, res, `attendance-${classLabel(section.class, section)}-${q.month}`, [
      {
        title: 'Register',
        subtitle: `Attendance register · ${classLabel(section.class, section)} · ${q.month}`,
        columns: [{ header: 'Roll', key: 'roll', width: 6 }, { header: 'Name', key: 'name', width: 24 }, ...dayCols, { header: 'P', key: 'p', width: 5 }, { header: 'A', key: 'a', width: 5 }, { header: 'L', key: 'l', width: 5 }, { header: '%', key: 'pct', width: 7 }],
        rows: students.map((s) => {
          const mine = recs.filter((r) => r.studentId === s.id);
          const row: Record<string, string | number | null> = { roll: s.rollNo, name: s.fullName };
          for (const r of mine) row[`d${r.date.getUTCDate()}`] = code[r.status];
          const p = mine.filter((r) => r.status === 'PRESENT').length;
          const l = mine.filter((r) => r.status === 'LATE').length;
          const h = mine.filter((r) => r.status === 'HALF_DAY').length;
          row.p = p;
          row.a = mine.filter((r) => r.status === 'ABSENT').length;
          row.l = l;
          row.pct = mine.length ? round2(((p + l + h * 0.5) / mine.length) * 100) : null;
          return row;
        }),
      },
    ]);
  }),
);

router.get(
  '/low-attendance',
  ah(async (req, res) => {
    need(req, 'attendance.manage', 'students.view');
    const q = parse(z.object({ from: isoDate, to: isoDate, below: z.coerce.number().min(1).max(100).default(75) }), req.query);
    const groups = await prisma.attendanceRecord.groupBy({ by: ['studentId', 'status'], where: { schoolId: tenantId(req), date: { gte: new Date(q.from), lte: new Date(q.to) } }, _count: { _all: true } });
    const by = new Map<string, Record<string, number>>();
    for (const g of groups) by.set(g.studentId, { ...(by.get(g.studentId) ?? {}), [g.status]: g._count._all });
    const students = await prisma.student.findMany({ where: { id: { in: [...by.keys()] }, status: 'ACTIVE', deletedAt: null }, include: { class: true, section: true } });
    const rows = students
      .map((s) => {
        const c = by.get(s.id)!;
        const total = Object.values(c).reduce((a, b) => a + b, 0);
        const pct = round2((((c.PRESENT ?? 0) + (c.LATE ?? 0) + 0.5 * (c.HALF_DAY ?? 0)) / total) * 100);
        return { name: s.fullName, cls: classLabel(s.class, s.section), days: total, absent: c.ABSENT ?? 0, pct };
      })
      .filter((r) => r.pct < q.below)
      .sort((a, b) => a.pct - b.pct);
    await sendWorkbook(req, res, `low-attendance-${q.from}-${q.to}`, [{ title: 'Low attendance', subtitle: `Below ${q.below}% · ${q.from} to ${q.to}`, columns: [{ header: 'Name', key: 'name', width: 24 }, { header: 'Class', key: 'cls', width: 14 }, { header: 'Days marked', key: 'days' }, { header: 'Absent', key: 'absent' }, { header: 'Attendance %', key: 'pct' }], rows }]);
  }),
);

router.get(
  '/fee-collection',
  ah(async (req, res) => {
    need(req, 'fees.reports');
    const q = parse(z.object({ from: isoDate, to: isoDate }), req.query);
    if (q.to < q.from) throw badRequest('The end date is before the start date');
    const tz = req.user!.school!.timezone;
    const pays = await prisma.feePayment.findMany({ where: { schoolId: tenantId(req), status: { not: 'CANCELLED' }, receivedAt: { gte: new Date(new Date(q.from).getTime() - 86400000), lt: new Date(new Date(q.to).getTime() + 2 * 86400000) } }, orderBy: { receivedAt: 'asc' } });
    const local = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const list = pays.filter((p) => local(p.receivedAt) >= q.from && local(p.receivedAt) <= q.to);
    const families = await prisma.family.findMany({ where: { id: { in: list.map((p) => p.familyId) } }, include: { students: { select: { fullName: true } } } });
    const users = await prisma.user.findMany({ where: { id: { in: list.map((p) => p.collectedById).filter((x): x is string => Boolean(x)) } }, select: { id: true, fullName: true } });
    const rows: Record<string, string | number | null>[] = list.map((p) => {
      const f = families.find((x) => x.id === p.familyId);
      return { receipt: p.receiptNo, date: local(p.receivedAt), family: f?.familyNo ?? '', students: f?.students.map((s) => s.fullName).join(', ') ?? '', amount: num(p.amount), method: p.method, collector: p.source === 'ONLINE' ? 'Online' : (users.find((u) => u.id === p.collectedById)?.fullName ?? '') };
    });
    rows.push({ receipt: 'Total', amount: round2(list.reduce((a, p) => a + num(p.amount), 0)) });
    await sendWorkbook(req, res, `fee-collection-${q.from}-${q.to}`, [{ title: 'Collection', subtitle: `Fee collection · ${q.from} to ${q.to}`, columns: [{ header: 'Receipt', key: 'receipt', width: 14 }, { header: 'Date', key: 'date', width: 12 }, { header: 'Family', key: 'family' }, { header: 'Students', key: 'students', width: 30 }, { header: 'Amount', key: 'amount', width: 12, numFmt: '#,##0' }, { header: 'Method', key: 'method' }, { header: 'Collected by', key: 'collector', width: 20 }], rows }]);
  }),
);

router.get(
  '/fee-defaulters',
  ah(async (req, res) => {
    need(req, 'fees.reports');
    const today = new Date();
    const open = await prisma.feeInvoice.findMany({ where: { schoolId: tenantId(req), status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: today } } });
    const byStudent = new Map<string, { due: number; months: Set<string> }>();
    for (const i of open) {
      const x = byStudent.get(i.studentId) ?? { due: 0, months: new Set<string>() };
      x.due = round2(x.due + num(i.total) - num(i.paidAmount));
      if (i.period) x.months.add(i.period);
      byStudent.set(i.studentId, x);
    }
    const students = await prisma.student.findMany({ where: { id: { in: [...byStudent.keys()] } }, include: { class: true, section: true, family: { include: { guardians: true } } } });
    const rows = students
      .map((s) => {
        const x = byStudent.get(s.id)!;
        const g = s.family.guardians.find((v) => v.relation === 'FATHER') ?? s.family.guardians[0];
        return { name: s.fullName, cls: classLabel(s.class, s.section), family: s.family.familyNo, months: x.months.size, list: [...x.months].sort().join(', '), due: x.due, phone: g?.phone ?? '' };
      })
      .sort((a, b) => b.months - a.months || b.due - a.due);
    await sendWorkbook(req, res, 'fee-defaulters', [{ title: 'Defaulters', subtitle: `Overdue fees (${rows.length} students)`, columns: [{ header: 'Name', key: 'name', width: 24 }, { header: 'Class', key: 'cls', width: 14 }, { header: 'Family', key: 'family' }, { header: 'Months unpaid', key: 'months' }, { header: 'Months', key: 'list', width: 30 }, { header: 'Amount due', key: 'due', width: 12, numFmt: '#,##0' }, { header: 'Phone', key: 'phone', width: 16 }], rows }]);
  }),
);

router.get(
  '/results',
  ah(async (req, res) => {
    need(req, 'exams.manage');
    const q = parse(z.object({ assessmentId: z.string() }), req.query);
    const a = await prisma.assessment.findFirst({ where: { id: q.assessmentId, schoolId: tenantId(req) }, include: { papers: { include: { marks: true }, orderBy: { sortOrder: 'asc' } }, results: true } });
    if (!a) throw notFound('Test or exam not found');
    const subjects = await prisma.subject.findMany({ where: { id: { in: a.papers.map((p) => p.subjectId) } }, select: { id: true, name: true } });
    const students = await prisma.student.findMany({ where: { id: { in: a.results.map((r) => r.studentId) } }, include: { section: true } });
    const subjectCols = a.papers.map((p) => ({ header: `${subjects.find((s) => s.id === p.subjectId)?.name ?? ''} (${num(p.totalMarks)})`, key: p.id, width: 12 }));
    const rows = a.results
      .map((r) => {
        const s = students.find((x) => x.id === r.studentId);
        const row: Record<string, string | number | null> = { roll: s?.rollNo ?? '', name: s?.fullName ?? '', section: s?.section?.name ?? '', total: `${num(r.obtained)}/${num(r.total)}`, pct: num(r.percent), grade: r.grade, pos: r.positionClass, result: r.passed ? 'Pass' : 'Fail' };
        for (const p of a.papers) {
          const m = p.marks.find((x) => x.studentId === r.studentId);
          row[p.id] = m ? (m.isAbsent ? 'Abs' : num(m.marks)) : '';
        }
        return row;
      })
      .sort((x, y) => Number(x.pos ?? 999) - Number(y.pos ?? 999));
    await sendWorkbook(req, res, `results-${a.title}`, [{ title: 'Results', subtitle: `${a.title} · ${a.status === 'PUBLISHED' ? 'published' : 'not published yet'}`, columns: [{ header: 'Roll', key: 'roll', width: 6 }, { header: 'Name', key: 'name', width: 24 }, { header: 'Section', key: 'section' }, ...subjectCols, { header: 'Total', key: 'total' }, { header: '%', key: 'pct' }, { header: 'Grade', key: 'grade' }, { header: 'Position', key: 'pos' }, { header: 'Result', key: 'result' }], rows }]);
  }),
);

router.get(
  '/syllabus',
  ah(async (req, res) => {
    need(req, 'lms.manage', 'students.view');
    const schoolId = tenantId(req);
    const sections = await prisma.section.findMany({ where: { schoolId, deletedAt: null }, include: { class: { include: { subjects: { include: { subject: true } } } } }, orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }] });
    const items = await prisma.syllabusItem.findMany({ where: { schoolId } });
    const parents = new Set(items.map((i) => i.parentId).filter(Boolean));
    const leaves = items.filter((i) => !parents.has(i.id));
    const progress = await prisma.syllabusProgress.findMany({ where: { schoolId } });
    const rows = sections.flatMap((s) =>
      s.class.subjects.map(({ subject }) => {
        const mine = leaves.filter((l) => l.classId === s.classId && l.subjectId === subject.id);
        const done = progress.filter((p) => p.sectionId === s.id && mine.some((x) => x.id === p.itemId)).length;
        return { cls: classLabel(s.class, s), subject: subject.name, total: mine.length, done, pct: mine.length ? round2((done / mine.length) * 100) : null };
      }),
    );
    await sendWorkbook(req, res, 'syllabus-coverage', [{ title: 'Coverage', subtitle: 'Syllabus coverage by section and subject', columns: [{ header: 'Class', key: 'cls', width: 14 }, { header: 'Subject', key: 'subject', width: 18 }, { header: 'Topics', key: 'total' }, { header: 'Done', key: 'done' }, { header: '% covered', key: 'pct' }], rows }]);
  }),
);

router.get(
  '/messages',
  ah(async (req, res) => {
    need(req, 'messages.send');
    const q = parse(z.object({ month }), req.query);
    const [y, m] = q.month.split('-').map(Number);
    const rows = await prisma.message.findMany({ where: { schoolId: tenantId(req), createdAt: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } }, orderBy: { createdAt: 'asc' }, take: 50000 });
    await sendWorkbook(req, res, `whatsapp-${q.month}`, [{ title: 'Messages', subtitle: `WhatsApp messages · ${q.month} (${rows.length})`, columns: [{ header: 'Date', key: 'date', width: 18 }, { header: 'Type', key: 'type', width: 14 }, { header: 'To', key: 'to', width: 22 }, { header: 'Phone', key: 'phone', width: 16 }, { header: 'Status', key: 'status' }, { header: 'Error', key: 'error', width: 30 }, { header: 'Message', key: 'body', width: 60 }], rows: rows.map((r) => ({ date: r.createdAt.toISOString().replace('T', ' ').slice(0, 16), type: r.type, to: r.toName, phone: r.toPhone, status: r.status, error: r.error, body: r.body })) }]);
  }),
);

export default router;
