import { prisma } from '../lib/prisma';

/** Section ids a teacher may see: class teacher of, or teaching any subject in. */
export async function teacherSectionIds(schoolId: string, teacherId: string): Promise<string[]> {
  const [own, taught] = await Promise.all([
    prisma.section.findMany({ where: { schoolId, classTeacherId: teacherId, deletedAt: null }, select: { id: true } }),
    prisma.teachingAssignment.findMany({ where: { schoolId, teacherId }, select: { sectionId: true } }),
  ]);
  return [...new Set([...own.map((s) => s.id), ...taught.map((t) => t.sectionId)])];
}
