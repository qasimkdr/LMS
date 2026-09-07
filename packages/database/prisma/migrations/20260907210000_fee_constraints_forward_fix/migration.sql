-- Forward repair for databases that already applied the original fee migrations.
-- Enable multiple installments per student/month and repair the FeeInvoice month check.

ALTER TABLE "FeePayment"
  DROP CONSTRAINT IF EXISTS "FeePayment_school_student_month_key";

ALTER TABLE "FeePayment"
  DROP CONSTRAINT IF EXISTS "FeePayment_schoolId_studentProfileId_month_key";

CREATE INDEX IF NOT EXISTS "FeePayment_schoolId_studentProfileId_month_idx"
  ON "FeePayment"("schoolId","studentProfileId","month");

ALTER TABLE "FeeInvoice"
  DROP CONSTRAINT IF EXISTS "FeeInvoice_month_check";

ALTER TABLE "FeeInvoice"
  ADD CONSTRAINT "FeeInvoice_month_check"
  CHECK ("month" ~ '^[0-9]{4}-[0-9]{2}$');
