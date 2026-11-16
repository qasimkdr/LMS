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

## What works now (step 5: fees)

- **Fee setup:** fee heads (every month / only some months like annual charges / one-off only), which heads student discounts apply to, a class × head amount grid with "copy above", due day, late fee (none / fixed / per day with a cap), bank details and note printed on vouchers, receipt prefix, automatic voucher creation on the 1st.
- **Discounts:** per student, percentage and/or fixed amount per month (sibling, staff child, scholarship…).
- **Vouchers:** generate a month for the whole school or chosen classes (skips students who already have one or joined later), one-off charges (admission, trip, books), cancel, principal adjustments/waivers. Printable vouchers with bank / school / parent copies, per student or **one family voucher** for all siblings, showing previous dues and the amount after the due date.
- **Collection:** find a family by student, father, phone or family no., tick vouchers, take cash/bank/cheque, full or partial. Oldest vouchers are paid first; extra money is kept as advance and used automatically on the next vouchers. Late fee added once when paying after the due date; only the principal can waive it or back-date a payment. Printable receipt, sent to parents on WhatsApp and in the app.
- **Hand-over:** each collector sees the money with them (by method) and hands it to the principal with the amount they're giving; the principal sees expected vs handed over, approves or rejects with a reason, and sees who still holds money. Staff can only *ask* to cancel a receipt; the principal decides. Cancelling restores the voucher balance.
- **Reports:** collection today / this month / last month / last 6 and 12 months / same month last year with a 13-month chart, by method and collector; paid / partly / unpaid / no voucher for any month; defaulters ranked by months unpaid and amount, with one-click WhatsApp reminders (selected, a class, or all); recovery % by month and by class; day sheet.
- **Online payment:** each school connects its own JazzCash merchant account (password and integrity salt stored encrypted). Parents pay their dues from the app; the result is accepted only with a valid signature and matching amount, and the receipt is created once. A built-in test gateway (`PAYMENTS_TEST_GATEWAY=true`) is for development only.

## What works now (step 6: tests, exams and results)

- **Test and exam types:** ready-made Weekly / Monthly / Class / Surprise test and First term / Mid-term / Second term / Send-up / Final (Annual); the principal can add or hide types, and teachers can type their own test name (e.g. "Quiz", "Unit test"), which is saved for next time.
- **Class tests:** teachers create a test for a subject they teach (class teachers: any subject of their class), enter marks quickly (Enter moves down, absent tick, remark), and submit. By default the principal approves before families see it; the school can let teachers publish tests directly.
- **Term exams:** the principal creates an exam for one or many classes; papers are made from each class's subjects with a date sheet (date, time, total and pass marks), which can be shared with students and parents. Each subject teacher enters marks for their own section; the principal approves or sends back with a note.
- **Publishing:** totals, percentage, grade (school's own grade bands), pass/fail (overall % and every paper), positions in class and in section (ties share a position). Only the principal can change published marks, with a reason; positions recalculate and parents can be told.
- **Results:** result sheet with subject averages and highest marks; report card remarks by the class teacher and principal; printable A4 report cards with photo, marks, grades, position, attendance and signatures; results sent to parents on WhatsApp and in the app.
- **Families:** results of every test and exam, the date sheet of upcoming exams, a monthly test average, and the report card.

## What works now (step 7: online exams)

- **Paper builder:** teachers make online exams for the classes/subjects they teach: MCQ, multiple-answer MCQ, true/false, fill in the blanks (several accepted answers per blank), matching, short and long answers (with optional model answer), pictures in questions, sections with "attempt any N", marks per question, preview as the student sees it, duplicate.
- **Question bank:** every question written in a paper is saved to the school's bank by subject, class and chapter; teachers search and reuse questions and manage their own.
- **Scheduling:** open/close time window and time allowed per student, shuffled question and option order per student, optional negative marking for MCQ/true-false, pass marks, and whether to show correct answers with the result. The school can require principal approval before a paper goes live (Exam settings). Students and parents get an in-app notice.
- **Taking the exam:** one question at a time with a question navigator and "mark for review", countdown from the server's deadline, autosave every change (keeps working through short internet drops), copy/paste blocked, leaving the screen is counted and shown to the teacher, photo upload of handwritten long answers, automatic submission when time ends. The teacher can let a student restart (e.g. power cut) with a reason.
- **Checking:** objective questions are marked automatically (partial marks for blanks and matching); the teacher marks short/long answers per student or one question for the whole class, can override any mark, and adds remarks per question and overall.
- **Results:** the teacher sends the checked results to the principal, who publishes or sends back with a note. Publishing creates a normal "Online test" result (positions, monthly averages, report to parents) and can also copy the marks, scaled, into a term-exam paper. Students see their score, each answer with marks, remarks and (if allowed) the correct answers.

## What works now (step 8: remarks, monthly reports, rankings and honors)

- **Remarks:** teachers (for their own classes) and the principal write remarks — academic, behavior, discipline, appreciation, health — for one student or many at once. Each remark is either shared with parents (in the app, optionally WhatsApp) or kept staff-only. Remarks history is on the student profile ("Remarks & progress" tab); parents and students see shared remarks.
- **Monthly progress report:** for every student: attendance %, each test/exam result of the month with grade and position, test average with the change from last month and the class average, fee status, shared remarks and honors, plus a class teacher's comment. Drafts are prepared automatically on the 1st of each month (or on demand); the principal reviews and sends them in one click (in-app + WhatsApp template `monthly_report`). Printable / save as PDF.
- **Rankings:** top of the school and top 3 in each class by month, by term exam or for the whole session (ties share a position); subject toppers per exam; most improved since last month / the previous exam; 100% attendance list. Teachers see rankings of the classes they teach.
- **Honors:** ready-made honors (Student of the Month, Best Attendance, Most Improved, Star Performer, Best Behavior, Subject Star, Sports Star, Head Boy / Head Girl, Prefect) plus the school's own. The principal (or staff with "Give honors") picks winners — the system suggests them from results and attendance — and chooses which honors appear on the **honor board** that everyone in the school can see. Parents get a congratulation (in-app + WhatsApp template `honor_award`); honors appear on the profile and in the monthly report.
- **Fix:** PATCH requests no longer reset fields that were not sent to their defaults.

## What works now (step 9: LMS — syllabus, study material, documents, homework)

- **Syllabus:** chapters (with optional term and topics) for each class and subject, written by the principal or the subject's teacher, plus uploaded syllabus PDFs. The subject teacher ticks topics/chapters as completed for their section (date and teacher recorded). **Coverage report:** % covered for every section and subject with the teacher and last update; teachers see their own classes. Parents and students see each subject's progress and chapters.
- **Study material:** notes, worksheets, books, videos and web links with file attachments, for a class (all or chosen sections), a subject and optionally a syllabus chapter. Teachers share only with classes they teach; families see what is meant for their child's section and can download it.
- **School documents:** policies, forms and circulars, each shown only to the roles chosen (office staff, teachers, parents, students).
- **Homework / diary:** daily homework per section and subject (or a general diary by the class teacher), with due date and attachments; a day-by-day view for teachers and families. Each day's diary goes to parents as **one message per student** at the school's diary time (in-app always; WhatsApp template `daily_diary` when switched on), or right away when the class teacher presses Send. Class teachers can write every subject of their class (school setting).
- New staff permission "Syllabus, study material, documents and homework" (`lms.manage`).

## What works now (step 10: communication, school life, dashboards and exports)

- **New look:** redesigned interface with a dark grouped sidebar (collapsible sections, animated active item), glass top bar, gradient hero banners, 3D tilt cards with light glare, count-up numbers, animated SVG charts (area, bars, gauges, sparklines), skeleton loading, smooth page/modal/list transitions and button press feedback. Motion is turned off for people who prefer reduced motion. New split-screen login page.
- **Dashboards:** one data call per role. Principal/staff: students, fee collection today with month-on-month trend, outstanding dues, syllabus coverage, attendance trend, fee collection chart, class strength, "needs your attention" (hand-overs, marks sheets, online papers/results, complaints, unmarked classes, setup checklist), top students, upcoming exam papers, recent remarks, circular read rates, open complaints. Teacher: classes with today's attendance and homework, to-dos, timetable, own-class attendance trend, top students, upcoming papers. Parents/students: per-child attendance, fees, latest result and results trend, homework, timetable, remarks, honors, notices, gallery, online exams.
- **Class chat:** one group per section for its students and teachers (parents don't join); text, files, replies; near real-time (refreshes every few seconds). Teachers moderate: delete messages, mute a student, announcement mode or close the chat. Students can report a message to the class teacher; reported messages are kept until reviewed. The principal can see every chat and switch class chat off for the school. **Messages and their files are deleted automatically after 30 days.**
- **Parent ↔ teacher messages:** parents see only their child's class and subject teachers; message, query or complaint with attachments; read ticks; optional teacher message hours with an automatic reply; teacher can forward to the principal; the principal can read (not write in) every conversation. Kept as school record.
- **Complaints to the principal:** ticket numbers, categories, attachments, "private from teachers", statuses New → In progress → Resolved / Closed, replies, internal notes, assignment to staff/teachers, parent notified at every step, a parent reply reopens a resolved ticket, escalation from a teacher conversation.
- **Circulars:** to all parents, chosen classes or sections, or staff only (optionally staff too), with attachments and an optional WhatsApp nudge (template `school_circular`). **Read receipts** per parent with their children's names.
- **Gate pass:** class teacher or office staff record early leave (who picked up, relation, reason, time); parents are told in the app and on WhatsApp (template `gate_pass`); printable slip; parents see their children's gate passes.
- **Gallery:** albums visible to the whole school, chosen classes, or staff only; bulk photo upload where each photo is resized (max 1920 px), compressed to WebP and gets a thumbnail; masonry grid, lightbox with keyboard and swipe, captions, album cover.
- **Reports & exports (Excel):** student list and contacts, class strength by gender, monthly attendance register, low attendance list, fee collection (receipts) for a date range, fee defaulters, result / tabulation sheet, syllabus coverage, WhatsApp messages log — each shown only to users with the right permission.

## What works now (step 11: admissions, leaving, session closing, teacher profiles)

- **Teacher enrollment:** full bio data — name, photo, mobile, email, CNIC, gender, date of birth, father/husband name, marital status, blood group, religion, address, emergency contact, joining date, salary (principal only), designation, highest qualification plus a list of qualifications (degree, institute, year, grade), teaching experience, previous school, specialization and **specialist subjects**. Specialists are starred and listed first in Teacher assignments, but any teacher can still be given any class or subject. Staff documents (CNIC copy, degrees…) are uploaded on the profile.
- **Admissions pipeline:** enquiry register (child, class wanted, parent, phone, source, follow-up date, notes) on a board — New → Following up → Test / interview → Passed / Waiting list (or Not passed / Not joining). Admission test with date, marks and remarks; follow-up notes with the next follow-up date; "due today" counter; this month's enquiries, admissions and best source. **Admit now** opens the enrollment form already filled from the enquiry and links the new student.
- **Leaving / withdrawal:** start from the student profile → fee clearance (collect, or the principal waives the remaining dues) → complete: a numbered **School Leaving Certificate** (printable, with date of birth in words, class, reason, conduct, last exam) and the student is marked Left; the student login (and the parent login, if no other child studies here) is switched off.
- **Session closing:** a wizard for the principal — next session name/dates suggested, every class mapped to its next class, every student set to Promote / Stay / Graduate (students who did not pass the final exam are suggested to stay), same section name kept, optional % increase of all class fees, typed confirmation. Unpaid vouchers carry forward automatically; graduates are marked and their logins switched off; past sessions stay viewable.
- **Academic history:** a History tab on each student — class and outcome in every session, attendance %, term exam results, test average, fees paid and honors per year, plus the leaving certificate.

## Accounts and logins

| Who | Created by | Username | First password |
| --- | --- | --- | --- |
| Principal | Platform super admin, when the school is added | chosen by the super admin | temporary, shown once |
| Teacher / office staff | Principal (or staff with "Add and edit staff") in Staff & teachers → Add, or bulk import from Excel | automatic `schoolcode.e001` (from the employee no.) or a custom username; the email (if given) also works for login | temporary, shown once and printable as a login slip |
| Student | Created automatically on admission | `schoolcode.<admission no>` | temporary, printed on the admission slip |
| Parent | Created automatically on the first child's admission; brothers and sisters share **one** family login | `schoolcode.p<family no>` | temporary, printed on the admission slip |

Everyone must choose their own password at first login. Forgotten passwords are reset by the principal (or staff with the permission) from the person's profile → Logins / Reset password, which shows a new temporary password. Logins of students who leave or graduate are switched off automatically.

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
