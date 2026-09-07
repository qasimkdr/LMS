CREATE TABLE "SubscriptionPlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceMonthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'PKR',
  "modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "studentLimit" INTEGER NOT NULL DEFAULT 1000,
  "teacherLimit" INTEGER NOT NULL DEFAULT 100,
  "storageLimitMb" INTEGER NOT NULL DEFAULT 1024,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

CREATE TABLE "SchoolSubscription" (
  "schoolId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "moduleOverrides" TEXT[],
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolSubscription_pkey" PRIMARY KEY ("schoolId"),
  CONSTRAINT "SchoolSubscription_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SchoolSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SchoolSubscription_planId_idx" ON "SchoolSubscription"("planId");

INSERT INTO "SubscriptionPlan" ("id","code","name","description","priceMonthly","currency","modules","studentLimit","teacherLimit","storageLimitMb") VALUES
('plan_starter','STARTER','Starter','Core school operations','0','PKR',ARRAY['ATTENDANCE','TIMETABLE','ANNOUNCEMENTS','SUPPORT'],500,50,512),
('plan_growth','GROWTH','Growth','Academic and finance operations','0','PKR',ARRAY['ATTENDANCE','TIMETABLE','ANNOUNCEMENTS','COURSEWORK','EXAMS','REPORTS','FINANCE','LEAVE','STORAGE','SUPPORT'],2000,200,4096),
('plan_pro','PRO','Pro','Full Nexora LMS suite','0','PKR',ARRAY['ATTENDANCE','TIMETABLE','ANNOUNCEMENTS','COURSEWORK','EXAMS','REPORTS','FINANCE','LEAVE','STORAGE','ANALYTICS','SUPPORT'],10000,1000,20480)
ON CONFLICT ("code") DO NOTHING;