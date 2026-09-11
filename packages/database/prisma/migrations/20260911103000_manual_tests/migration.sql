CREATE TABLE "ManualTest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "testType" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "marksPerQuestion" DECIMAL(8,2) NOT NULL,
    "totalMarks" DECIMAL(8,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManualTest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManualTestResult" (
    "id" TEXT NOT NULL,
    "manualTestId" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "correctAnswers" INTEGER NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "questionMarks" JSONB NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManualTestResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManualTest_schoolId_classId_subjectId_heldAt_idx" ON "ManualTest"("schoolId", "classId", "subjectId", "heldAt");
CREATE INDEX "ManualTest_createdById_idx" ON "ManualTest"("createdById");
CREATE INDEX "ManualTest_classId_idx" ON "ManualTest"("classId");
CREATE INDEX "ManualTest_subjectId_idx" ON "ManualTest"("subjectId");
CREATE INDEX "ManualTestResult_studentUserId_createdAt_idx" ON "ManualTestResult"("studentUserId", "createdAt");
CREATE UNIQUE INDEX "ManualTestResult_manualTestId_studentUserId_key" ON "ManualTestResult"("manualTestId", "studentUserId");

ALTER TABLE "ManualTest" ADD CONSTRAINT "ManualTest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManualTest" ADD CONSTRAINT "ManualTest_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManualTest" ADD CONSTRAINT "ManualTest_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManualTest" ADD CONSTRAINT "ManualTest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManualTestResult" ADD CONSTRAINT "ManualTestResult_manualTestId_fkey" FOREIGN KEY ("manualTestId") REFERENCES "ManualTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManualTestResult" ADD CONSTRAINT "ManualTestResult_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManualTest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManualTestResult" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "ManualTest", "ManualTestResult" FROM anon, authenticated;
