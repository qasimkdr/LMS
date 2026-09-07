CREATE TABLE "ReportCardPublication" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "snapshot" JSONB NOT NULL,
  "remarks" TEXT,
  "publishedById" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportCardPublication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportCardPublication_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportCardPublication_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportCardPublication_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportCardPublication_schoolId_studentProfileId_termId_key" ON "ReportCardPublication"("schoolId","studentProfileId","termId");
CREATE INDEX "ReportCardPublication_schoolId_termId_idx" ON "ReportCardPublication"("schoolId","termId");