ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "cnic" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "alternatePhone" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappNo" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gender" TEXT,
  ADD COLUMN IF NOT EXISTS "profileData" JSONB;

ALTER TABLE "StudentProfile"
  ADD COLUMN IF NOT EXISTS "profileData" JSONB;

CREATE INDEX IF NOT EXISTS "User_schoolId_role_firstName_lastName_idx"
  ON "User" ("schoolId", "role", "firstName", "lastName");

CREATE INDEX IF NOT EXISTS "User_schoolId_cnic_idx"
  ON "User" ("schoolId", "cnic");
