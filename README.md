# School Management System (SMS + LMS)

Multi-school SaaS. The Super Admin creates schools and principal accounts; each school pays monthly
(fixed plan price + per-student charge above the plan's included students).

- **Frontend:** Next.js 16 (App Router) + Tailwind CSS 4, in `apps/web`
- **Backend:** Node.js + Express + TypeScript, in `apps/api`
- **Database:** MySQL 8 (Prisma ORM), hosted on Oracle Cloud
- **Files:** local disk in development, Oracle Cloud Object Storage in production

Feature plan: [docs/FEATURES.md](docs/FEATURES.md) · Deployment: [docs/DEPLOY_OCI.md](docs/DEPLOY_OCI.md)

## What works now (step 1: foundation)

- Login for all six roles, with forced password change on first login, refresh tokens that rotate (and reuse detection), logout everywhere, and login rate limiting.
- Multi-tenancy: every school-owned row has `schoolId`; school routes always filter by the logged-in user's school.
- School status: Trial → Active → Read-only → Suspended. Trials that end and overdue invoices make a school read-only (after 7 days) and then suspended (after 30 days). Paying restores read-only schools automatically.
- Super Admin panel: dashboard with revenue for this month, last month, last 6 and 12 months and the same month last year; schools (create with principal, edit, custom limits, status, reset principal password, delete); plans; monthly invoices and payments; audit log.
- Plans limit storage, file size, students, staff, campuses and modules.
- Principal: dashboard, **Plan & usage** page (storage bars, breakdown by type, largest files, warnings at 80% and 95%, upgrade request), file manager, school profile with logo.
- Files: uploads checked against the plan's file-size and storage limits; downloads only within the same school.
- Audit log of important actions (secrets are never logged).

## What works now (step 2: school setup and people)

- **Classes & subjects:** academic sessions, classes and sections (one-click Playgroup → Class 10 or → Intermediate with FSc/ICS/I.Com/FA groups), subjects per class (compulsory/optional), campuses (limited by plan), and which enrollment fields are required.
- **Teacher assignments:** class teacher for each section and a teacher for each subject in each section.
- **Students:** full admission form (student, father, mother, guardian, emergency contact, previous school, health, fee details) with photo upload or camera capture and crop. Automatic admission and family numbers. Brothers and sisters are detected from the father's CNIC or mobile and share one family and one parent login. Student and parent logins with printable slips. Profile with family, documents checklist and uploads, login reset/disable, status (left, struck off, graduated, transferred), printable filled and blank admission forms.
- **Staff:** teachers and office staff with profile, salary (principal only) and per-person permissions; password reset and disable.
- **Excel/CSV import** for students and staff: template download, row-by-row check before saving, sibling grouping, login slips afterwards.
- **Global search** by name, admission number, roll number, CNIC, father's name or phone.
- **Recycle bin:** deleted students and staff can be restored for 30 days. All edits are audited with old and new values.
- **Teachers** see their classes and students; **parents** see all their children; **students** see their profile.

## What works now (step 3: timetable)

- **Period timings:** working days, periods and breaks, with different timings for some days (e.g. shorter Friday). A typical setup is pre-filled.
- **Class timetables:** click a cell to choose subject, teacher (the assigned subject teacher is picked automatically), room and note. A teacher can never be in two classes at once (busy teachers are shown and blocked); room double-booking gives a warning. Copy a timetable from another section, clear, print. Periods-a-week per subject.
- **Teacher timetables** are built automatically from the class timetables, with weekly load per teacher.
- **Teachers** see today's periods (current and next highlighted) and their week; **students and parents** see each child's timetable, day by day on phones.
- Timetable is a plan module: schools without it on their plan don't see it.

## What works now (step 4: attendance and messaging)

- **Attendance:** the class teacher marks today (everyone starts Present; P / A / L / Leave / Half day, optional remark). The principal (and staff with permission) can mark or correct any past day, with a reason; every change is audited. Today's overview (who hasn't marked, absentees), printable monthly register, low-attendance list, class-wise %, a calendar on each student's profile, and a calendar for parents and students.
- **Each school's own WhatsApp:** Settings → WhatsApp: phone number ID and permanent token (stored encrypted), connection check, test message, master on/off, and for each message type *Send automatically / Only when we press Send / Off*. Suggested template texts to submit to Meta, editable template names, webhook URL and verify token for delivered/read ticks.
- **Absent alerts:** on save, parents of absent (and optionally late) students get a WhatsApp template message once per day, plus an in-app notification. Manual mode adds a "Send alerts" button.
- **Manual messages:** write to the whole school, classes, sections, selected students' parents, or staff; `{student}`, `{class}`, `{parent}` placeholders; WhatsApp and/or app notification; schedule for later; preview with counts; history with sent/delivered/read/failed per person and retry.
- **Outbox:** messages are queued in the database and sent by a background worker with retries; delivery and read receipts arrive by webhook (signature checked).
- **Notifications:** bell with unread count for every school user.
- Set `WHATSAPP_DRY_RUN=true` in development to record messages as sent without calling Meta.

## Run it locally

Requirements: Node.js 20+ and MySQL 8.

```bash
npm install

# API config
cp apps/api/.env.example apps/api/.env      # then edit DATABASE_URL, secrets, SUPER_ADMIN_PASSWORD
cp apps/web/.env.example apps/web/.env.local

# Database
npm run db:migrate -w apps/api               # creates tables
npm run create-super-admin -w apps/api       # your login, from SUPER_ADMIN_* in .env
npm run seed:dev -w apps/api                 # optional: Basic / Standard / Premium plans

# Start (two terminals)
npm run dev:api                              # http://localhost:4000
npm run dev:web                              # http://localhost:3000
```

Open http://localhost:3000 and log in with the super admin username and password from `.env`.

The MySQL user needs permission to create databases, because Prisma uses a temporary "shadow" database during `migrate dev`.

## Tests

```bash
npm test          # API tests against a separate database (sms_test), reset on every run
npm run typecheck
```

Set `TEST_DATABASE_URL` to use a different test database.

## Project layout

```
apps/api/
  prisma/schema.prisma      database tables
  src/routes/               auth, admin (super admin), school, files
  src/middleware/           authentication, school status gate, CSRF, errors
  src/services/             billing, usage limits, files, audit, sessions
  src/storage/              local disk and Oracle Object Storage drivers
  tests/                    API tests
apps/web/
  src/app/login, change-password
  src/app/(app)/admin/...   super admin pages
  src/app/(app)/school/...  principal and staff pages
  src/app/(app)/home        teacher / student / parent (coming in later steps)
docs/                       feature plan and deployment guide
```

## Security notes

- Cookies are httpOnly and SameSite=Lax; every state-changing request must send `X-Requested-With: fetch` (CSRF protection).
- The browser only talks to the Next.js app; `/api` is forwarded to Express, so no cross-origin requests are allowed.
- Passwords are hashed with bcrypt. School secrets (WhatsApp tokens, payment keys, coming later) are encrypted with AES-256-GCM using `ENCRYPTION_KEY`.
