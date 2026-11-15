import type { Plan, School } from '@prisma/client';
import { prisma } from '../lib/prisma';

const MB = 1024 * 1024;

export interface EffectiveLimits {
  storageBytes: number;
  maxFileBytes: number;
  maxStudents: number | null;
  maxStaff: number | null;
  maxCampuses: number;
  modules: string[];
}

export function effectiveLimits(school: School & { plan: Plan }): EffectiveLimits {
  return {
    storageBytes: (school.customStorageLimitMb ?? school.plan.storageLimitMb) * MB,
    maxFileBytes: school.plan.maxFileSizeMb * MB,
    maxStudents: school.customMaxStudents ?? school.plan.maxStudents,
    maxStaff: school.customMaxStaff ?? school.plan.maxStaff,
    maxCampuses: school.plan.maxCampuses,
    modules: Array.isArray(school.plan.modules) ? (school.plan.modules as string[]) : [],
  };
}

export async function storageUsedBytes(schoolId: string): Promise<number> {
  const agg = await prisma.storedFile.aggregate({
    where: { schoolId, deletedAt: null },
    _sum: { sizeBytes: true },
  });
  return agg._sum.sizeBytes ?? 0;
}

export async function storageByCategory(schoolId: string) {
  const rows = await prisma.storedFile.groupBy({
    by: ['category'],
    where: { schoolId, deletedAt: null },
    _sum: { sizeBytes: true },
    _count: { _all: true },
  });
  return rows.map((r) => ({ category: r.category, bytes: r._sum.sizeBytes ?? 0, files: r._count._all }));
}

export const countActiveStudents = (schoolId: string) =>
  prisma.user.count({ where: { schoolId, role: 'STUDENT', isActive: true, deletedAt: null } });

export const countStaff = (schoolId: string) =>
  prisma.user.count({ where: { schoolId, role: { in: ['STAFF', 'TEACHER'] }, isActive: true, deletedAt: null } });

/** Full usage summary shown on the principal's "Plan and usage" page and the super admin table. */
export async function usageSummary(school: School & { plan: Plan }) {
  const limits = effectiveLimits(school);
  const [used, students, staff, campuses] = await Promise.all([
    storageUsedBytes(school.id),
    countActiveStudents(school.id),
    countStaff(school.id),
    prisma.campus.count({ where: { schoolId: school.id } }),
  ]);
  const pct = (a: number, b: number | null) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const storagePct = pct(used, limits.storageBytes) ?? 0;
  return {
    storage: {
      usedBytes: used,
      limitBytes: limits.storageBytes,
      percent: storagePct,
      level: storagePct >= 100 ? 'full' : storagePct >= 95 ? 'critical' : storagePct >= 80 ? 'warning' : 'ok',
    },
    maxFileBytes: limits.maxFileBytes,
    students: { used: students, limit: limits.maxStudents, percent: pct(students, limits.maxStudents) },
    staff: { used: staff, limit: limits.maxStaff, percent: pct(staff, limits.maxStaff) },
    campuses: { used: campuses, limit: limits.maxCampuses },
    modules: limits.modules,
  };
}
