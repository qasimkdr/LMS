import type { ExamSettings, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { round2 } from '../lib/money';

type Tx = Prisma.TransactionClient;
export const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export interface GradeBand {
  grade: string;
  min: number;
  remark?: string;
}

export const DEFAULT_BANDS: GradeBand[] = [
  { grade: 'A+', min: 90, remark: 'Outstanding' },
  { grade: 'A', min: 80, remark: 'Excellent' },
  { grade: 'B', min: 70, remark: 'Very good' },
  { grade: 'C', min: 60, remark: 'Good' },
  { grade: 'D', min: 50, remark: 'Satisfactory' },
  { grade: 'E', min: 33, remark: 'Needs improvement' },
  { grade: 'F', min: 0, remark: 'Fail' },
];

export async function getExamSettings(schoolId: string): Promise<ExamSettings> {
  return (
    (await prisma.examSettings.findUnique({ where: { schoolId } })) ??
    prisma.examSettings.upsert({ where: { schoolId }, create: { schoolId, gradeBands: DEFAULT_BANDS as never }, update: {} })
  );
}

export const bandsOf = (s: ExamSettings) => ((s.gradeBands as unknown as GradeBand[]) ?? DEFAULT_BANDS).slice().sort((a, b) => b.min - a.min);

export function gradeFor(bands: GradeBand[], percent: number): GradeBand {
  return bands.find((b) => percent >= b.min) ?? bands[bands.length - 1];
}

/** Ready-made types every school starts with; schools and teachers can add more. */
const DEFAULT_TYPES: { name: string; kind: 'TEST' | 'EXAM' }[] = [
  { name: 'Weekly test', kind: 'TEST' },
  { name: 'Monthly test', kind: 'TEST' },
  { name: 'Class test', kind: 'TEST' },
  { name: 'Surprise test', kind: 'TEST' },
  { name: 'First term', kind: 'EXAM' },
  { name: 'Mid-term', kind: 'EXAM' },
  { name: 'Second term', kind: 'EXAM' },
  { name: 'Send-up', kind: 'EXAM' },
  { name: 'Final / Annual', kind: 'EXAM' },
];

export async function ensureDefaultTypes(schoolId: string) {
  if (await prisma.assessmentType.count({ where: { schoolId } })) return;
  await prisma.assessmentType.createMany({ data: DEFAULT_TYPES.map((t, i) => ({ ...t, schoolId, sortOrder: (i + 1) * 10 })) });
}

/** "1, 2, 2, 4" ranking (ties share a position). */
export function rank<T>(rows: T[], score: (r: T) => number): Map<T, number> {
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  const out = new Map<T, number>();
  sorted.forEach((r, i) => out.set(r, i > 0 && score(r) === score(sorted[i - 1]) ? out.get(sorted[i - 1])! : i + 1));
  return out;
}

/**
 * Totals, percentage, grade, pass/fail and positions for every student of an assessment.
 * A student fails if the overall % is below the pass mark or any paper is below its pass marks (absent = 0).
 */
export async function computeResults(tx: Tx, assessmentId: string) {
  const a = await tx.assessment.findUniqueOrThrow({ where: { id: assessmentId }, include: { papers: { include: { marks: true } } } });
  const settings = (await tx.examSettings.findUnique({ where: { schoolId: a.schoolId } })) ?? (await getExamSettings(a.schoolId));
  const bands = bandsOf(settings);
  const passPercent = num(settings.passPercent);
  const studentIds = new Set(a.papers.flatMap((p) => p.marks.map((m) => m.studentId)));
  const students = await tx.student.findMany({ where: { id: { in: [...studentIds] } }, select: { id: true, sectionId: true } });
  const total = round2(a.papers.reduce((s, p) => s + num(p.totalMarks), 0));
  const rows = students.map((st) => {
    let obtained = 0;
    let absent = 0;
    let failedPaper = false;
    for (const p of a.papers) {
      const m = p.marks.find((x) => x.studentId === st.id);
      const v = m && !m.isAbsent ? num(m.marks) : 0;
      if (!m || m.isAbsent) absent++;
      obtained += v;
      if (v < num(p.passMarks)) failedPaper = true;
    }
    const percent = total ? round2((obtained / total) * 100) : 0;
    return { st, obtained: round2(obtained), percent, absent, passed: percent >= passPercent && !failedPaper, grade: gradeFor(bands, percent).grade };
  });
  const classRank = rank(rows, (r) => r.percent);
  const bySection = new Map<string, typeof rows>();
  for (const r of rows) bySection.set(r.st.sectionId ?? '', [...(bySection.get(r.st.sectionId ?? '') ?? []), r]);
  const sectionRank = new Map<(typeof rows)[number], number>();
  for (const list of bySection.values()) for (const [r, pos] of rank(list, (x) => x.percent)) sectionRank.set(r, pos);

  await tx.studentResult.deleteMany({ where: { assessmentId, studentId: { notIn: [...studentIds] } } });
  for (const r of rows) {
    const data = {
      schoolId: a.schoolId,
      sectionId: r.st.sectionId,
      obtained: r.obtained,
      total,
      percent: r.percent,
      grade: r.grade,
      passed: r.passed,
      positionClass: classRank.get(r) ?? null,
      positionSection: sectionRank.get(r) ?? null,
      absentPapers: r.absent,
    };
    await tx.studentResult.upsert({ where: { assessmentId_studentId: { assessmentId, studentId: r.st.id } }, create: { ...data, assessmentId, studentId: r.st.id }, update: data });
  }
  return rows.length;
}

/** Who teaches this subject in this section (for marks entry rights and labels). */
export async function subjectTeacher(sectionId: string, subjectId: string) {
  return (await prisma.teachingAssignment.findUnique({ where: { sectionId_subjectId: { sectionId, subjectId } }, include: { teacher: { select: { id: true, fullName: true } } } }))?.teacher ?? null;
}
