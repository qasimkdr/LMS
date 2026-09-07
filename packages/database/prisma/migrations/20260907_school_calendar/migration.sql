CREATE TABLE IF NOT EXISTS "SchoolEvent" (
 "id" TEXT PRIMARY KEY,
 "schoolId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "description" TEXT,
 "eventType" TEXT NOT NULL DEFAULT 'GENERAL',
 "startsAt" TIMESTAMP(3) NOT NULL,
 "endsAt" TIMESTAMP(3),
 "audience" TEXT NOT NULL DEFAULT 'ALL',
 "classId" TEXT,
 "location" TEXT,
 "isAllDay" BOOLEAN NOT NULL DEFAULT FALSE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SchoolEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
 CONSTRAINT "SchoolEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE,
 CONSTRAINT "SchoolEvent_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "SchoolEvent_school_date_idx" ON "SchoolEvent"("schoolId","startsAt");
CREATE INDEX IF NOT EXISTS "SchoolEvent_school_class_idx" ON "SchoolEvent"("schoolId","classId");