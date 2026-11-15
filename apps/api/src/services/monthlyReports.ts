import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { round2 } from '../lib/money';
import { num } from './exams';
import { attendanceStats, monthRange, periodLabel, prevPeriod, publishedInRange, studentsLite } from './rankings';
import { enqueue, getSettings, notify, ruleFor, studentsWithContacts, whatsappReady } from './messaging';
import { MESSAGE_TYPES, renderTemplate } from '../config/messageTypes';

export interface ReportData {
  student: { fullName: string; classLabel: string; rollNo: string | null; admissionNo: string; photoFileId: string | null };
  schoolName: string;
  period: string;
  periodLabel: string;
  attendance: { present: number; absent: number; late: number; leave: number; halfDay: number; days: number; percent: number } | null;
  tests: { title: string; type: string; kind: string; date: string; obtained: number; total: number; percent: number; grade: string; passed: boolean; positionSection: number | null }[];
  average: number | null;
  previousAverage: number | null;
  sectionAverage: number | null;
  fees: { billed: number; paid: number; balance: number } | null;
  remarks: { date: string; category: string; text: string; by: string }[];
  honors: { name: string; icon: string; period: string }[];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Builds (or rebuilds) the draft reports of a month. Reports already sent are left unchanged unless `resend` is set. */
export async function generateReports(schoolId: string, period: string, where: Prisma.StudentWhereInput = {}, opts: { includeSent?: boolean } = {}) {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, include: { plan: true } });
  const modules = (school.plan.modules as string[] | null) ?? [];
  const { from, to } = monthRange(period);
  const students = await studentsLite(schoolId, where);
  const ids = [...students.keys()];
  if (!ids.length) return { generated: 0, skipped: 0 };
  const extra = await prisma.student.findMany({ where: { id: { in: ids } }, select: { id: true, admissionNo: true } });

  // Results of the month (and last month, for the trend).
  const assessments = modules.includes('exams') ? await publishedInRange(schoolId, from, to) : [];
  const prev = monthRange(prevPeriod(period));
  const prevAssessments = modules.includes('exams') ? await publishedInRange(schoolId, prev.from, prev.to) : [];
  const results = await prisma.studentResult.findMany({ where: { assessmentId: { in: [...assessments, ...prevAssessments].map((a) => a.id) }, studentId: { in: ids } } });
  // Section averages use every active student of the section, not only those being generated.
  const sectionResults = await prisma.studentResult.findMany({ where: { assessmentId: { in: assessments.map((a) => a.id) } }, select: { sectionId: true, percent: true } });

  const att = modules.includes('attendance') ? await attendanceStats(schoolId, from, to, ids) : null;

  const invoices = modules.includes('fees') ? await prisma.feeInvoice.findMany({ where: { schoolId, studentId: { in: ids }, status: { not: 'CANCELLED' }, OR: [{ period }, { status: { in: ['UNPAID', 'PARTIAL'] } }] } }) : null;

  const remarks = await prisma.studentRemark.findMany({ where: { schoolId, studentId: { in: ids }, shared: true, deletedAt: null, date: { gte: from, lt: to } }, orderBy: { date: 'asc' } });
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(remarks.map((r) => r.createdById))] } }, select: { id: true, fullName: true } });
  const honors = await prisma.honor.findMany({ where: { schoolId, studentId: { in: ids }, OR: [{ period }, { createdAt: { gte: from, lt: to } }] }, include: { type: true } });

  const existing = await prisma.monthlyReport.findMany({ where: { studentId: { in: ids }, period }, select: { id: true, studentId: true, status: true } });
  let generated = 0;
  let skipped = 0;
  for (const st of students.values()) {
    const ex = existing.find((e) => e.studentId === st.id);
    if (ex && ex.status === 'SENT' && !opts.includeSent) {
      skipped++;
      continue;
    }
    const mine = results.filter((r) => r.studentId === st.id);
    const tests = assessments
      .map((a) => ({ a, r: mine.find((r) => r.assessmentId === a.id) }))
      .filter((x) => x.r)
      .sort((x, y) => x.a.date.getTime() - y.a.date.getTime())
      .map(({ a, r }) => ({ title: a.title, type: a.type.name, kind: a.kind, date: ymd(a.date), obtained: num(r!.obtained), total: num(r!.total), percent: num(r!.percent), grade: r!.grade, passed: r!.passed, positionSection: r!.positionSection }));
    const prevMine = mine.filter((r) => prevAssessments.some((a) => a.id === r.assessmentId));
    const secRows = sectionResults.filter((r) => r.sectionId && r.sectionId === st.sectionId);
    const a = att?.get(st.id);
    const inv = invoices?.filter((i) => i.studentId === st.id) ?? [];
    const data: ReportData = {
      student: { fullName: st.fullName, classLabel: st.classLabel, rollNo: st.rollNo, admissionNo: extra.find((e) => e.id === st.id)?.admissionNo ?? '', photoFileId: st.photoFileId },
      schoolName: school.name,
      period,
      periodLabel: periodLabel(period),
      attendance: att ? { present: a?.counts.PRESENT ?? 0, absent: a?.counts.ABSENT ?? 0, late: a?.counts.LATE ?? 0, leave: a?.counts.LEAVE ?? 0, halfDay: a?.counts.HALF_DAY ?? 0, days: a?.days ?? 0, percent: a?.percent ?? 0 } : null,
      tests,
      average: tests.length ? round2(tests.reduce((s, t) => s + t.percent, 0) / tests.length) : null,
      previousAverage: prevMine.length ? round2(prevMine.reduce((s, r) => s + num(r.percent), 0) / prevMine.length) : null,
      sectionAverage: secRows.length ? round2(secRows.reduce((s, r) => s + num(r.percent), 0) / secRows.length) : null,
      fees: invoices
        ? {
            billed: round2(inv.filter((i) => i.period === period).reduce((s, i) => s + num(i.total), 0)),
            paid: round2(inv.filter((i) => i.period === period).reduce((s, i) => s + num(i.paidAmount), 0)),
            balance: round2(inv.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL').reduce((s, i) => s + num(i.total) - num(i.paidAmount), 0)),
          }
        : null,
      remarks: remarks.filter((r) => r.studentId === st.id).map((r) => ({ date: ymd(r.date), category: r.category, text: r.text, by: authors.find((u) => u.id === r.createdById)?.fullName ?? '' })),
      honors: honors.filter((h) => h.studentId === st.id).map((h) => ({ name: h.type.name, icon: h.type.icon, period: periodLabel(h.period) })),
    };
    if (ex) await prisma.monthlyReport.update({ where: { id: ex.id }, data: { data: data as never, generatedAt: new Date(), classId: st.classId, sectionId: st.sectionId } });
    else await prisma.monthlyReport.create({ data: { schoolId, studentId: st.id, classId: st.classId, sectionId: st.sectionId, period, data: data as never } });
    generated++;
  }
  return { generated, skipped };
}

const money = (n: number, currency: string) => `${currency} ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;

/** Sends reports to parents (in-app always; WhatsApp unless switched off) and marks them sent. */
export async function sendReports(schoolId: string, reportIds: string[], byUserId: string) {
  const reports = await prisma.monthlyReport.findMany({ where: { schoolId, id: { in: reportIds } } });
  if (!reports.length) return { sent: 0, whatsapp: 0 };
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  const settings = await getSettings(schoolId);
  const useWa = whatsappReady(settings) && ruleFor(settings, 'MONTHLY_REPORT') !== 'off';
  const contacts = await studentsWithContacts(schoolId, { id: { in: reports.map((r) => r.studentId) } });
  const users = await prisma.student.findMany({ where: { id: { in: reports.map((r) => r.studentId) } }, select: { id: true, userId: true } });
  const currency = school.currency;
  let whatsapp = 0;
  const notices: Parameters<typeof notify>[1] = [];
  for (const r of reports) {
    const d = r.data as unknown as ReportData;
    const st = contacts.find((c) => c.id === r.studentId);
    if (!st) continue;
    const params = [st.fullName, d.periodLabel, d.attendance && d.attendance.days ? `${d.attendance.percent}%` : 'not marked', d.average === null ? 'no tests' : `${d.average}%`, d.fees ? money(d.fees.balance, currency) : '-', school.name];
    const body = renderTemplate(MESSAGE_TYPES.MONTHLY_REPORT.suggestedTemplate.text, params);
    if (useWa) whatsapp += await enqueue(schoolId, settings, st.guardians.map((g) => ({ to: { phone: g.phone ?? '', name: g.name, studentId: st.id }, type: 'MONTHLY_REPORT', params, body })));
    const link = `/monthly-reports/${r.id}`;
    if (st.parentUserId) notices.push({ userId: st.parentUserId, type: 'MONTHLY_REPORT', title: `Monthly report: ${st.fullName}`, body: `${d.periodLabel} report is ready.`, link });
    const su = users.find((u) => u.id === r.studentId)?.userId;
    if (su) notices.push({ userId: su, type: 'MONTHLY_REPORT', title: `Your monthly report`, body: `${d.periodLabel} report is ready.`, link });
  }
  await notify(schoolId, notices);
  await prisma.monthlyReport.updateMany({ where: { id: { in: reports.map((r) => r.id) } }, data: { status: 'SENT', sentAt: new Date(), sentById: byUserId } });
  return { sent: reports.length, whatsapp };
}

/** In the first days of a month, creates last month's drafts for schools that have none yet. */
export async function autoGenerateMonthly(now = new Date()) {
  if (now.getUTCDate() > 3) return 0;
  const period = prevPeriod(now.toISOString().slice(0, 7));
  const schools = await prisma.school.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] }, deletedAt: null }, select: { id: true } });
  let n = 0;
  for (const s of schools) {
    if (await prisma.monthlyReport.findFirst({ where: { schoolId: s.id, period }, select: { id: true } })) continue;
    n += (await generateReports(s.id, period)).generated;
  }
  return n;
}
