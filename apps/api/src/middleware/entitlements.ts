import type { NextFunction, Request, Response } from 'express';
import { Prisma, prisma } from '@nexora/database';

export const MODULE_KEYS = [
  'ATTENDANCE',
  'TIMETABLE',
  'ANNOUNCEMENTS',
  'COURSEWORK',
  'EXAMS',
  'REPORTS',
  'FINANCE',
  'LEAVE',
  'STORAGE',
  'ANALYTICS',
  'SUPPORT',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

type EntitlementRow = {
  modules: string[] | null;
  planCode: string | null;
  planName: string | null;
  endsAt: Date | null;
};

export async function getSchoolEntitlements(schoolId: string) {
  const rows = await prisma.$queryRaw<EntitlementRow[]>(Prisma.sql`
    SELECT COALESCE(ss."moduleOverrides", p."modules") AS modules,
           p."code" AS "planCode",
           p."name" AS "planName",
           ss."endsAt"
    FROM "SchoolSubscription" ss
    JOIN "SubscriptionPlan" p ON p."id" = ss."planId"
    WHERE ss."schoolId" = ${schoolId} AND p."isActive" = true
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) {
    return {
      unrestricted: true as const,
      modules: [...MODULE_KEYS],
      planCode: null,
      planName: null,
      endsAt: null,
    };
  }
  return {
    unrestricted: false as const,
    modules: (row.modules ?? []).filter((value): value is ModuleKey =>
      MODULE_KEYS.includes(value as ModuleKey),
    ),
    planCode: row.planCode,
    planName: row.planName,
    endsAt: row.endsAt,
  };
}

export function requireModule(moduleKey: ModuleKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role === 'SUPER_ADMIN') return next();
    const schoolId = req.auth?.schoolId;
    if (!schoolId) return res.status(403).json({ message: 'School scope required' });

    try {
      const entitlement = await getSchoolEntitlements(schoolId);
      const subscriptionExpired =
        Boolean(entitlement.endsAt) && entitlement.endsAt!.getTime() < Date.now();
      const lifecycleAllowsExpiredSubscription =
        req.tenantAccess?.status === 'GRACE_PERIOD' || req.tenantAccess?.status === 'READ_ONLY';

      if (subscriptionExpired && !lifecycleAllowsExpiredSubscription) {
        return res.status(402).json({
          message: 'School subscription has expired',
          code: 'SUBSCRIPTION_EXPIRED',
        });
      }

      if (!entitlement.modules.includes(moduleKey)) {
        return res.status(403).json({
          message: `${moduleKey} is not enabled for this school plan`,
          code: 'MODULE_DISABLED',
          module: moduleKey,
          plan: entitlement.planCode,
        });
      }
      return next();
    } catch (error) {
      // Backward compatibility during staged migrations: if the entitlement tables
      // have not been deployed yet, existing schools keep their current access.
      const message = error instanceof Error ? error.message : '';
      if (message.includes('SubscriptionPlan') || message.includes('SchoolSubscription')) {
        return next();
      }
      return next(error);
    }
  };
}
