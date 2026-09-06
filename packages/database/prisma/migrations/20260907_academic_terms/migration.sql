CREATE TABLE IF NOT EXISTS "AcademicTerm" (
  "id" TEXT PRIMARY KEY,
  "schoolId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "academicYear" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcademicTerm_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AcademicTerm_schoolId_name_academicYear_key" ON "AcademicTerm"("schoolId","name","academicYear");
CREATE INDEX IF NOT EXISTS "AcademicTerm_schoolId_startsAt_endsAt_idx" ON "AcademicTerm"("schoolId","startsAt","endsAt");