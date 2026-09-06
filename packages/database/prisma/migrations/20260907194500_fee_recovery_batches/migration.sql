ALTER TABLE "FeePayment"
  ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recoveryBatchId" TEXT;

CREATE TABLE IF NOT EXISTS "FeeRecoveryBatch" (
  "id" TEXT PRIMARY KEY,
  "schoolId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "studentCount" INTEGER NOT NULL DEFAULT 0,
  "submittedAt" TIMESTAMP(3),
  "collectedByPrincipalId" TEXT,
  "collectedAt" TIMESTAMP(3),
  "principalRemark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeRecoveryBatch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  CONSTRAINT "FeeRecoveryBatch_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "FeeRecoveryBatch_collectedByPrincipalId_fkey" FOREIGN KEY ("collectedByPrincipalId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "FeeRecoveryBatch_school_status_idx" ON "FeeRecoveryBatch"("schoolId","status");
CREATE INDEX IF NOT EXISTS "FeeRecoveryBatch_staff_status_idx" ON "FeeRecoveryBatch"("staffId","status");

DO $$ BEGIN
  ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_recoveryBatchId_fkey" FOREIGN KEY ("recoveryBatchId") REFERENCES "FeeRecoveryBatch"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "FeePayment_batch_idx" ON "FeePayment"("recoveryBatchId");
CREATE INDEX IF NOT EXISTS "FeePayment_school_approval_idx" ON "FeePayment"("schoolId","approvalStatus","month");