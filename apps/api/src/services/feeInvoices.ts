import { Prisma, prisma } from '@nexora/database';

const FEE_INVOICE_LOCK_ID = 20_260_908;

type InvoiceRow = {
  id: string;
  studentProfileId: string;
  classId: string | null;
  month: string;
  monthlyAmount: unknown;
  currency: string;
  dueDay: unknown;
  lateFineAmount: unknown;
  lateFineGraceDays: unknown;
  structureUpdatedAt: Date | null;
};

export const feeMonth = (date = new Date()) => date.toISOString().slice(0, 7);

const nextMonthStart = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 1));
};

export async function ensureFeeInvoiceForStudent(
  tx: Prisma.TransactionClient,
  schoolId: string,
  studentProfileId: string,
  month: string,
): Promise<InvoiceRow | undefined> {
  const cutoff = nextMonthStart(month);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "FeeInvoice"
      (id,"schoolId","studentProfileId","classId",month,"baseFee",currency,"dueDay","lateFineAmount","lateFineGraceDays","structureUpdatedAt","createdAt","updatedAt")
    SELECT
      ${`finv_${studentProfileId}_${month}`},
      sp."schoolId",
      sp.id,
      sp."classId",
      ${month},
      fs."monthlyAmount",
      fs.currency,
      fs."dueDay",
      fs."lateFineAmount",
      fs."lateFineGraceDays",
      fs."updatedAt",
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM "StudentProfile" sp
    JOIN "FeeStructure" fs
      ON fs."schoolId"=sp."schoolId" AND fs."classId"=sp."classId"
    WHERE sp."schoolId"=${schoolId}
      AND sp.id=${studentProfileId}
      AND sp."createdAt" < ${cutoff}
    ON CONFLICT ("schoolId","studentProfileId",month) DO NOTHING
  `);

  const rows = await tx.$queryRaw<InvoiceRow[]>(Prisma.sql`
    SELECT id,"studentProfileId","classId",month,
           "baseFee" AS "monthlyAmount",currency,"dueDay","lateFineAmount","lateFineGraceDays","structureUpdatedAt"
    FROM "FeeInvoice"
    WHERE "schoolId"=${schoolId} AND "studentProfileId"=${studentProfileId} AND month=${month}
    LIMIT 1
  `);
  return rows[0];
}

export async function snapshotCurrentMonthFeeInvoices(now = new Date()) {
  const month = feeMonth(now);
  const cutoff = nextMonthStart(month);

  return prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(${FEE_INVOICE_LOCK_ID}) AS locked`,
    );
    if (!lock[0]?.locked) return { skipped: true, month, created: 0 };

    const created = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "FeeInvoice"
        (id,"schoolId","studentProfileId","classId",month,"baseFee",currency,"dueDay","lateFineAmount","lateFineGraceDays","structureUpdatedAt","createdAt","updatedAt")
      SELECT
        'finv_' || sp.id || '_' || ${month},
        sp."schoolId",
        sp.id,
        sp."classId",
        ${month},
        fs."monthlyAmount",
        fs.currency,
        fs."dueDay",
        fs."lateFineAmount",
        fs."lateFineGraceDays",
        fs."updatedAt",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM "StudentProfile" sp
      JOIN "FeeStructure" fs
        ON fs."schoolId"=sp."schoolId" AND fs."classId"=sp."classId"
      WHERE sp."classId" IS NOT NULL
        AND sp."createdAt" < ${cutoff}
      ON CONFLICT ("schoolId","studentProfileId",month) DO NOTHING
    `);

    return { skipped: false, month, created };
  });
}

export function startFeeInvoiceSnapshotScheduler() {
  if (process.env.DISABLE_FEE_INVOICE_SNAPSHOTS === 'true') return;

  const run = () => {
    void snapshotCurrentMonthFeeInvoices().catch((error) => {
      console.error('Fee invoice snapshot run failed', error);
    });
  };

  const initial = setTimeout(run, 8_000);
  initial.unref();
  const interval = setInterval(run, 6 * 60 * 60 * 1000);
  interval.unref();
}
