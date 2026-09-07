ALTER TABLE "FeeStructure" ADD COLUMN IF NOT EXISTS "dueDay" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "FeeStructure" ADD COLUMN IF NOT EXISTS "lateFineAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "FeeStructure" ADD COLUMN IF NOT EXISTS "lateFineGraceDays" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "FeePayment" DROP CONSTRAINT IF EXISTS "FeePayment_school_student_month_key";
ALTER TABLE "FeePayment" DROP CONSTRAINT IF EXISTS "FeePayment_schoolId_studentProfileId_month_key";
CREATE INDEX IF NOT EXISTS "FeePayment_schoolId_studentProfileId_month_idx" ON "FeePayment"("schoolId","studentProfileId","month");

CREATE TABLE IF NOT EXISTS "FeeAdjustment" (
 "id" TEXT NOT NULL,
 "schoolId" TEXT NOT NULL,
 "studentProfileId" TEXT NOT NULL,
 "month" TEXT NOT NULL,
 "type" TEXT NOT NULL,
 "amount" DECIMAL(12,2) NOT NULL,
 "reason" TEXT,
 "createdById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FeeAdjustment_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "FeeAdjustment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "FeeAdjustment_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "FeeAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "FeeAdjustment_schoolId_studentProfileId_month_idx" ON "FeeAdjustment"("schoolId","studentProfileId","month");