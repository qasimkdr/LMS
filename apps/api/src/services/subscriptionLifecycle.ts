import { Prisma, prisma } from '@nexora/database';

const DAY_MS = 24 * 60 * 60 * 1000;
const LIFECYCLE_LOCK_ID = 20_260_907;

export type LifecycleStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'GRACE_PERIOD'
  | 'READ_ONLY'
  | 'SUSPENDED'
  | 'CANCELLED';

type TerminalStatus = 'READ_ONLY' | 'SUSPENDED';
type TransitionStatus = 'GRACE_PERIOD' | TerminalStatus;

export type LifecycleSchoolState = {
  status: LifecycleStatus;
  trialEndsAt: Date | null;
  subscriptionEnd: Date | null;
  graceEndsAt: Date | null;
};

type LifecycleStats = {
  skipped: boolean;
  transitioned: number;
  reminders: number;
};

const graceDays = () => {
  const parsed = Number(process.env.SUBSCRIPTION_GRACE_DAYS ?? 7);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(30, Math.max(1, Math.round(parsed)));
};

const afterGraceStatus = (): TerminalStatus =>
  process.env.SUBSCRIPTION_AFTER_GRACE_STATUS === 'SUSPENDED' ? 'SUSPENDED' : 'READ_ONLY';

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

export function resolveEffectiveLifecycleStatus(
  school: LifecycleSchoolState,
  now = new Date(),
): LifecycleStatus {
  if (
    school.status === 'READ_ONLY' ||
    school.status === 'SUSPENDED' ||
    school.status === 'CANCELLED'
  ) {
    return school.status;
  }

  if (school.status === 'GRACE_PERIOD') {
    if (school.graceEndsAt && school.graceEndsAt <= now) return afterGraceStatus();
    return 'GRACE_PERIOD';
  }

  const expiry = school.status === 'TRIAL' ? school.trialEndsAt : school.subscriptionEnd;
  if (!expiry || expiry > now) return school.status;

  if (school.graceEndsAt && school.graceEndsAt <= now) return afterGraceStatus();
  return 'GRACE_PERIOD';
}

const notifyPrincipals = async (
  tx: Prisma.TransactionClient,
  schoolId: string,
  title: string,
  body: string,
) => {
  const principals = await tx.user.findMany({
    where: { schoolId, role: 'PRINCIPAL', isActive: true },
    select: { id: true },
  });
  if (!principals.length) return;
  await tx.notification.createMany({
    data: principals.map(({ id }) => ({
      schoolId,
      userId: id,
      title,
      body,
      link: '/principal/settings',
    })),
  });
};

const recordTransition = async (
  tx: Prisma.TransactionClient,
  schoolId: string,
  from: string,
  to: TransitionStatus,
  reason: string,
) => {
  await tx.auditLog.create({
    data: {
      schoolId,
      actorId: null,
      action: 'SCHOOL_LIFECYCLE_AUTO_TRANSITION',
      entityType: 'School',
      entityId: schoolId,
      beforeData: { status: from },
      afterData: { status: to, reason, automated: true },
    },
  });
};

const transitionSchool = async (
  tx: Prisma.TransactionClient,
  school: {
    id: string;
    name: string;
    status: string;
    trialEndsAt: Date | null;
    subscriptionEnd: Date | null;
    graceEndsAt: Date | null;
  },
  nextStatus: TransitionStatus,
  nextGraceEndsAt: Date | null,
  reason: string,
) => {
  const updated = await tx.school.updateMany({
    where: { id: school.id, status: school.status as any },
    data: {
      status: nextStatus as any,
      ...(nextStatus === 'GRACE_PERIOD' ? { graceEndsAt: nextGraceEndsAt } : {}),
    },
  });
  if (updated.count !== 1) return false;

  await recordTransition(tx, school.id, school.status, nextStatus, reason);

  if (nextStatus === 'GRACE_PERIOD') {
    await notifyPrincipals(
      tx,
      school.id,
      'Nexora subscription grace period started',
      nextGraceEndsAt
        ? `Your school subscription has expired. Full access remains available until ${nextGraceEndsAt.toLocaleDateString('en-GB')}.`
        : 'Your school subscription has expired and is now in its grace period.',
    );
  } else if (nextStatus === 'READ_ONLY') {
    await notifyPrincipals(
      tx,
      school.id,
      'Nexora school moved to read-only',
      'The subscription grace period has ended. School data remains available to view, but changes are locked until renewal.',
    );
  } else {
    await notifyPrincipals(
      tx,
      school.id,
      'Nexora school suspended',
      'The subscription grace period has ended and the school has been suspended. Contact Nexora support to restore access.',
    );
  }

  return true;
};

const maybeSendExpiryReminder = async (
  tx: Prisma.TransactionClient,
  school: { id: string; subscriptionEnd: Date | null; status: string },
  now: Date,
) => {
  if (school.status !== 'ACTIVE' || !school.subscriptionEnd) return 0;
  const remainingMs = school.subscriptionEnd.getTime() - now.getTime();
  if (remainingMs <= 0) return 0;

  for (const threshold of [7, 3, 1]) {
    const upper = threshold * DAY_MS;
    const lower = Math.max(0, (threshold - 1) * DAY_MS);
    if (remainingMs > upper || remainingMs <= lower) continue;

    const action = `SUBSCRIPTION_EXPIRY_REMINDER_${threshold}D`;
    const existing = await tx.auditLog.findFirst({
      where: {
        schoolId: school.id,
        action,
        createdAt: { gte: new Date(school.subscriptionEnd.getTime() - (threshold + 1) * DAY_MS) },
      },
      select: { id: true },
    });
    if (existing) return 0;

    await notifyPrincipals(
      tx,
      school.id,
      `Nexora subscription expires in ${threshold} day${threshold === 1 ? '' : 's'}`,
      `Your current subscription ends on ${school.subscriptionEnd.toLocaleDateString('en-GB')}. Renew before expiry to avoid lifecycle restrictions.`,
    );
    await tx.auditLog.create({
      data: {
        schoolId: school.id,
        actorId: null,
        action,
        entityType: 'School',
        entityId: school.id,
        afterData: {
          subscriptionEnd: school.subscriptionEnd.toISOString(),
          thresholdDays: threshold,
          automated: true,
        },
      },
    });
    return 1;
  }

  return 0;
};

export async function runSubscriptionLifecycle(now = new Date()): Promise<LifecycleStats> {
  return prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(${LIFECYCLE_LOCK_ID}) AS locked`,
    );
    if (!lock[0]?.locked) return { skipped: true, transitioned: 0, reminders: 0 };

    const schools = await tx.school.findMany({
      where: {
        status: { in: ['TRIAL', 'ACTIVE', 'GRACE_PERIOD'] as any },
      },
      select: {
        id: true,
        name: true,
        status: true,
        trialEndsAt: true,
        subscriptionEnd: true,
        graceEndsAt: true,
      },
    });

    let transitioned = 0;
    let reminders = 0;
    const graceLength = graceDays();
    const terminalStatus = afterGraceStatus();

    for (const school of schools) {
      reminders += await maybeSendExpiryReminder(tx, school, now);

      const effectiveStatus = resolveEffectiveLifecycleStatus(
        {
          status: school.status as LifecycleStatus,
          trialEndsAt: school.trialEndsAt,
          subscriptionEnd: school.subscriptionEnd,
          graceEndsAt: school.graceEndsAt,
        },
        now,
      );

      if (effectiveStatus === school.status) continue;

      if (effectiveStatus === 'GRACE_PERIOD') {
        const graceEnd = school.graceEndsAt ?? addDays(now, graceLength);
        if (
          await transitionSchool(
            tx,
            school,
            'GRACE_PERIOD',
            graceEnd,
            school.status === 'TRIAL' ? 'Trial expired' : 'Subscription expired',
          )
        ) {
          transitioned += 1;
        }
        continue;
      }

      if (effectiveStatus === terminalStatus) {
        const reason =
          school.status === 'GRACE_PERIOD'
            ? 'Subscription grace period expired'
            : school.status === 'TRIAL'
              ? 'Trial and configured grace period expired'
              : 'Subscription and configured grace period expired';
        if (await transitionSchool(tx, school, terminalStatus, null, reason)) {
          transitioned += 1;
        }
      }
    }

    return { skipped: false, transitioned, reminders };
  });
}

export function startSubscriptionLifecycleScheduler() {
  if (process.env.DISABLE_SUBSCRIPTION_LIFECYCLE === 'true') return;

  const run = () => {
    void runSubscriptionLifecycle().catch((error) => {
      console.error('Subscription lifecycle run failed', error);
    });
  };

  const initial = setTimeout(run, 5_000);
  initial.unref();
  const interval = setInterval(run, 60 * 60 * 1000);
  interval.unref();
}
