CREATE TABLE IF NOT EXISTS "FeeInvoice" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "classId" TEXT,
  "month" TEXT NOT NULL,
  "baseFee" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'PKR',
  "dueDay" INTEGER NOT NULL DEFAULT 10,
  "lateFineAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "lateFineGraceDays" INTEGER NOT NULL DEFAULT 0,
  "structureUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeInvoice_month_check" CHECK ("month" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "FeeInvoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeInvoice_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeInvoice_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "FeeInvoice_school_student_month_key"
  ON "FeeInvoice"("schoolId", "studentProfileId", "month");
CREATE INDEX IF NOT EXISTS "FeeInvoice_school_month_idx"
  ON "FeeInvoice"("schoolId", "month");
CREATE INDEX IF NOT EXISTS "FeeInvoice_student_month_idx"
  ON "FeeInvoice"("studentProfileId", "month");
