# School Management System (SMS + LMS): Feature Plan

Status: **planning**. Nothing gets built until this list is agreed.
Priority tags: **[P1]** must ship in the first release (MVP), **[P2]** second release, **[P3]** later or optional add-on.

---

## 0. Platform and business model

### 0.1 Tech stack
| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript, Tailwind CSS, responsive and installable as a PWA (works on phones) |
| Backend | Node.js + Express + TypeScript, REST API, JWT access tokens + refresh tokens in httpOnly cookies |
| Database | MySQL 8 on Oracle Cloud (OCI MySQL HeatWave, or MySQL on an OCI compute VM) |
| ORM / migrations | Prisma or Drizzle (MySQL), versioned migrations |
| File storage | OCI Object Storage (gallery photos, documents, syllabus PDFs, receipts, report-card PDFs) |
| Hosting | OCI compute (Next.js + API behind Nginx, PM2 or Docker), SSL via Let's Encrypt |
| Background jobs | Queue (BullMQ + Redis) for WhatsApp/SMS sends, PDF generation, monthly reports, reminders |
| Messaging | WhatsApp Business Cloud API (Meta), plus SMS gateway as fallback, plus email |
| PDFs | Server-side PDF generation (report cards, fee vouchers, receipts, certificates, ID cards) |

### 0.2 Multi-tenancy (one system, many schools)
- [P1] Every school is a tenant. All data rows carry a `school_id`, and every query is scoped to the logged-in user's school.
- [P1] One school can have multiple campuses or branches (optional per school).
- [P1] Schools are fully isolated: a principal can never see another school's data.
- [P2] Custom subdomain per school (e.g. `cityschool.yourapp.com`) with school logo and colors on the login page.

### 0.3 Your revenue model (Super Admin billing)
- [P1] Monthly subscription per school.
- [P1] Plans and pricing: flat monthly fee, or per-student pricing, or tiers (Basic / Standard / Premium) that switch modules on/off.
- [P1] Student and staff limits per plan.
- [P1] Invoice to each school every month, record payments received, payment history.
- [P1] Grace period, then automatic read-only mode, then suspension if unpaid; one-click reactivation.
- [P2] Free trial period for new schools.
- [P2] WhatsApp/SMS credit packs (messages cost money; bill schools for usage or include a quota per plan).
- [P3] Online payment of subscription (bank transfer proof upload, JazzCash/Easypaisa/Stripe, etc.).

---

## 1. Roles and logins

| Role | Created by | Scope |
|---|---|---|
| **Super Admin** (you) | System | All schools, billing, platform settings |
| **Principal** | Super Admin | Everything inside their own school |
| **Vice Principal / Coordinator** [P2] | Principal | Principal-like access limited to assigned classes or sections |
| **Accountant / Office Staff** | Principal | Fee collection, admissions, records (permissions set by principal) |
| **Teacher** | Principal | Their assigned classes and subjects only |
| **Student** | Principal / Staff | Their own data |
| **Parent** | Auto-created with the student (linked by phone number) | All of their children (siblings under one login) |

### 1.1 Login and security
- [P1] Login with username/email/phone + password.
- [P1] Forced password change on first login.
- [P1] Forgot password via OTP on WhatsApp/SMS/email.
- [P1] Principal can reset passwords of staff, teachers, students, parents.
- [P1] Role-based permissions; principal can tick/untick permissions for each staff member (custom roles).
- [P1] Activate / deactivate any account (e.g. staff leaves, student withdrawn).
- [P1] Audit log: who did what and when (fee edits, mark changes, deletions, approvals).
- [P2] Login history and active sessions; log out all devices.
- [P2] Two-factor authentication (OTP) for Super Admin and Principal.
- [P2] Super Admin "login as principal" (impersonation) for support, recorded in the audit log.

---

## 2. Super Admin panel (you)

- [P1] Dashboard: total schools, active / trial / suspended, total students across platform, monthly revenue, overdue schools.
- [P1] Create school: name, logo, address, contact, campuses, plan, limits.
- [P1] Create principal account for the school and send credentials on WhatsApp/email.
- [P1] Edit, suspend, reactivate, delete (soft delete) schools.
- [P1] Plans and modules: decide which features each school gets.
- [P1] Subscription billing: invoices, payments received, dues, payment reminders to principals.
- [P1] Revenue reports: this month vs last month vs last 6 months vs last year.
- [P2] Global announcements to all principals (e.g. maintenance, new features).
- [P2] Support tickets from principals.
- [P2] Message usage per school (WhatsApp/SMS counts and cost).
- [P2] Backups: per-school data export, automatic daily database backups.
- [P3] System health: storage used per school, error logs, uptime.

---

## 3. School setup (Principal)

- [P1] School profile: name, logo, address, phone, motto, principal signature (used on report cards and receipts).
- [P1] Academic sessions/years (e.g. 2026–27); terms (1st term, mid-term, final).
- [P1] Classes (Playgroup to Matric/A-levels, configurable) and sections (A, B, C…).
- [P1] Subjects per class; optional/elective subjects.
- [P1] Assign class teacher to each section; assign subject teachers.
- [P1] Grading system: grade bands (A+, A, B…), pass percentage, GPA if used.
- [P1] Fee structure setup (see section 9).
- [P1] Holiday and school calendar (holidays, events, exam dates).
- [P1] Working days and school timings.
- [P2] Houses (for sports/competitions).
- [P2] Promotion rules (minimum % to pass, compartment/supplementary).
- [P2] Student ID / roll number format, admission number format.

---

## 4. Student management

- [P1] Admission form: photo, name, father/mother name, CNIC/B-form, DOB, gender, address, phone numbers, WhatsApp number, blood group, previous school, admission date, class, section, roll number.
- [P1] Parent/guardian details; multiple guardians; link siblings (sibling discount, one parent login).
- [P1] Auto-create student login and parent login.
- [P1] Student profile page: personal info, attendance summary, fee history, results, remarks, honors, documents, all on one screen.
- [P1] Search and filter students by class, section, name, roll no, father name, phone.
- [P1] Bulk import students from Excel/CSV.
- [P1] Student status: active, left, struck off, graduated, transferred.
- [P1] Promote students to next class at session end (bulk, with exceptions for failed students).
- [P1] Transfer section / change class.
- [P2] Student documents upload (B-form, previous result, medical certificate, photos).
- [P2] School Leaving Certificate / Character Certificate / Bonafide Certificate generation (PDF).
- [P2] Student ID card generation (PDF, printable, with photo and QR code).
- [P2] Admission inquiry / enquiry register (prospective students, follow-ups, convert to admission).
- [P2] Medical info and allergies, emergency contact.
- [P3] Online admission form (public link the school shares).

---

## 5. Staff and teacher management

- [P1] Staff profile: photo, CNIC, qualification, designation, joining date, salary, phone, address.
- [P1] Create teacher/staff login with role and permissions.
- [P1] Assign classes and subjects to teachers.
- [P1] Bulk import staff.
- [P2] Staff attendance (manual, or QR/biometric later).
- [P2] Staff leave requests and approval by principal.
- [P2] Payroll: monthly salary, allowances, deductions (late, absent, advance), payslip PDF, salary paid register.
- [P2] Staff documents (CV, degrees, contract).
- [P3] Teacher performance review (based on class results, attendance, parent feedback).

---

## 6. Attendance

### 6.1 Student attendance
- [P1] Daily attendance by class teacher: Present / Absent / Late / Leave / Half-day. Default all present, tap the absentees.
- [P1] Edit window (e.g. same day), later edits need principal permission, all edits logged.
- [P1] **Automatic WhatsApp to parents when the child is absent** (and optionally late), on/off per school.
- [P1] Attendance reports: daily, monthly, by class, by student, percentage.
- [P1] Monthly attendance register (printable, like the paper register).
- [P1] Principal dashboard: today's attendance across all classes, which classes haven't marked yet.
- [P2] Subject/period-wise attendance (for higher classes).
- [P2] Leave application by parent from the app; teacher/principal approves.
- [P2] Low attendance alert (below X%) to parents and principal.
- [P3] QR code / RFID / biometric attendance integration.

---

## 7. Academics (LMS)

### 7.1 Syllabus and planning
- [P1] Online syllabus per class and subject (term-wise), upload PDF or type it in.
- [P1] Syllabus progress: teacher marks chapters/topics as completed; principal sees % covered per class and subject.
- [P2] Lesson plans by teachers, reviewed by principal/coordinator.
- [P2] Exam syllabus/date sheet publishing per term.

### 7.2 Study material and documents
- [P1] Teachers upload notes, worksheets, PDFs, images, video links per class/subject/chapter.
- [P1] Students and parents can view/download.
- [P1] School documents library (policies, circulars, forms) visible to selected roles.

### 7.3 Homework / diary
- [P1] Daily diary / homework per class and subject, with attachments.
- [P1] Parents see it in the app and optionally get it on WhatsApp (daily digest).
- [P2] Assignment submission by students (upload photo/PDF), teacher checks and gives marks/feedback.

### 7.4 Timetable
- [P2] Class timetable (periods, subjects, teachers).
- [P2] Teacher timetable auto-generated from class timetables; clash detection.
- [P3] Substitute teacher assignment when a teacher is absent.

---

## 8. Tests, exams and results

### 8.1 Class tests (manual / paper)
- [P1] Teacher creates a test: class, subject, topic, date, total marks.
- [P1] Enter marks for the whole class on one screen (fast grid entry); mark absent.
- [P1] Test results visible to students/parents; send result to parents on WhatsApp (individual or whole class in one click).
- [P1] Monthly test summary per student.

### 8.2 Term exams
- [P1] Create exam (e.g. Mid-Term 2026) with date sheet, subjects, total and passing marks per subject.
- [P1] Teachers enter marks for their subjects; class teacher sees full class.
- [P1] Principal reviews and **publishes** results (nothing visible to parents until published).
- [P1] Auto calculation: total, percentage, grade, pass/fail, position in class and section.
- [P1] **Report card / result card PDF** with school logo, student photo, subject marks, grade, attendance, teacher remarks, principal remarks, signature.
- [P1] Send report card to parents on WhatsApp: individually, or a whole class in one click.
- [P1] Print report cards in bulk for a class.
- [P2] Cumulative / annual result (combining terms with weightage, e.g. 30% mid + 70% final).
- [P2] Award list / tabulation sheet / gazette for a class (printable).
- [P2] Exam admit cards / roll number slips.
- [P2] Result comparison charts (subject-wise, term-wise progress of a student).
- [P3] Custom report card templates per school.

### 8.3 Online exams / quizzes
- [P1] Question bank per subject and chapter: MCQ, true/false, fill in the blank, short answer.
- [P1] Create online test: pick questions (manual or random), duration, start/end time, marks, negative marking option.
- [P1] Students attempt on phone/computer with timer; auto-submit when time ends.
- [P1] Auto-grading for objective questions; teacher grades short answers.
- [P1] Result shown instantly or after teacher releases it.
- [P2] Shuffle questions and options per student; one attempt only; anti-cheating basics (tab switch warnings).
- [P2] Bulk import questions from Excel/Word.
- [P2] Analytics: hardest questions, average score, per-student breakdown.
- [P3] Long answer with file upload; image-based questions.

---

## 9. Fees and finance

### 9.1 Fee setup
- [P1] Fee heads: tuition, admission, annual charges, exam fee, transport, lab, sports, fine, etc.
- [P1] Fee structure per class (monthly amounts).
- [P1] Discounts/concessions per student: sibling discount, staff child, scholarship, merit, custom %, or fixed amount.
- [P1] Late fee fine rules (after due date, per day or fixed).
- [P1] Monthly fee generation for all students in one click (or automatic on the 1st of each month).
- [P2] Installments for annual/admission fees.
- [P2] One-time charges to selected students (trip, event, book fee).

### 9.2 Fee collection (by staff)
- [P1] Fee vouchers/challans PDF (single and bulk per class), with due date and fine after due date; bank copy / school copy / student copy.
- [P1] Staff collects fee: search student, see all dues (current + arrears), take full or partial payment, choose method (cash, bank, online).
- [P1] Instant receipt (PDF + WhatsApp receipt to parent automatically).
- [P1] Arrears carry forward automatically to next month.

### 9.3 Collection hand-over and principal approval
- [P1] Each staff member has their own collection ledger ("cash in hand").
- [P1] End of day/shift: staff creates a **hand-over** of collected amount to principal (list of receipts, total by cash/bank).
- [P1] Principal reviews and **approves** or **rejects with reason**; once approved, the amount is moved to school account and receipts are locked.
- [P1] Discrepancy tracking: expected vs handed over.
- [P1] Edits or cancellations of receipts require principal approval; full audit trail.
- [P2] Fee concession / waiver requests by staff, approved by principal.

### 9.4 Fee recovery reports and rankings
- [P1] Who paid / who didn't, for any month, by class and section.
- [P1] Defaulter list with total due and number of months unpaid.
- [P1] **Ranking of defaulters**: students with the most unpaid months / highest balance at the top.
- [P1] Collection comparison: **this month vs last month vs last 6 months vs last year** (charts and table).
- [P1] Recovery %: expected vs collected per month, per class.
- [P1] Daily collection report, collection by staff member, collection by payment method.
- [P1] One-click WhatsApp fee reminders: individual, class-wise, or all defaulters.
- [P2] Automatic reminders (e.g. on due date, 3 days after, 7 days after).
- [P2] Student fee ledger / statement (all charges and payments since admission), printable.

### 9.5 Expenses and income [P2]
- Expense entries by category (salaries, utilities, rent, maintenance, stationery) with receipts.
- Other income (canteen, uniform/book sales, donations).
- Profit and loss summary per month; comparison with previous periods.
- Expense approvals by principal.

### 9.6 Online fee payment [P3]
- Parents pay through bank/JazzCash/Easypaisa/card; auto-reconcile with vouchers.

---

## 10. Parent communication (WhatsApp, SMS, app)

### 10.1 Channels
- [P1] WhatsApp Business Cloud API (official). Message templates must be approved by Meta first; each school can use a shared platform number or connect its own number [P2].
- [P1] In-app notifications (parent/student/teacher portal).
- [P2] SMS fallback when WhatsApp is not available on a number.
- [P2] Email.

### 10.2 What can be sent
- [P1] Absent / late alert.
- [P1] Fee voucher, fee reminder, payment receipt.
- [P1] Test result, exam report card (PDF).
- [P1] **Monthly progress report** to every parent: attendance %, tests and marks, fee status, teacher remarks, honors. Generated automatically at month end, principal reviews and sends in one click.
- [P1] Teacher/principal **remarks** about a student (behavior, performance, appreciation, complaint), sent to an individual parent or class-wise.
- [P1] Announcements/circulars (holidays, events, meetings) to the whole school, a class, or selected parents.
- [P1] Homework/diary digest.
- [P2] Birthday wishes to students.
- [P2] Parent-teacher meeting invitations.

### 10.3 Sending controls
- [P1] Send to: one student's parents, selected students, a section, a class, multiple classes, or the whole school.
- [P1] Preview before sending; send now or schedule.
- [P1] Delivery log per message: sent / delivered / read / failed, with retry.
- [P1] Every report about a student can be sent "on click" from the student profile.
- [P2] Message templates library editable by principal.
- [P2] Monthly usage counter vs plan quota.

---

## 11. Remarks and behavior

- [P1] Teachers add remarks on a student: category (academic, behavior, discipline, appreciation, health), text, date.
- [P1] Remark visibility: internal only or shared with parents.
- [P1] Send remarks to parents individually or for a whole class at once.
- [P1] Remarks history on student profile; included in monthly report and report card.
- [P2] Discipline/incident register with actions taken.
- [P2] Positive points / merit system (feeds into rankings and honors).

---

## 12. Rankings, performance and honors

### 12.1 Rankings
- [P1] Position in class and section for every test and exam.
- [P1] **Top performers by class** and **by whole school** (by exam, by term, by month, by year).
- [P1] Subject toppers.
- [P1] Most improved students (compared to previous exam).
- [P1] Attendance ranking (100% attendance list).
- [P2] Overall score that combines academics + attendance + behavior points (weights set by principal).
- [P2] Class vs class comparison (average %).

### 12.2 Honors and awards (principal controls what is public)
- [P1] **Student of the Month** (per class and/or whole school).
- [P1] Other honors: Best Attendance, Most Improved, Star Performer, Best Behavior, Subject Star, Sports Star, Head Boy/Head Girl, prefects, custom honors created by principal.
- [P1] Principal selects winners (system suggests candidates from rankings) and chooses **which honors are shown to everyone**.
- [P1] Honor Board / Wall of Fame page visible to all students, parents and staff in the school.
- [P1] Honor shown on student profile and included in monthly report; WhatsApp congratulation to parents.
- [P2] Printable certificates (PDF) for each honor.
- [P2] Teacher of the Month (optional, principal decides if public).

---

## 13. School gallery and school life

- [P1] Photo gallery with albums (events, sports day, functions, trips).
- [P1] Principal/authorized staff upload; choose visibility (whole school, specific class, staff only).
- [P1] Image compression and thumbnails to save storage.
- [P2] Video links (YouTube) in albums.
- [P2] News/notice board on dashboard.
- [P2] Events calendar with RSVP for parents.
- [P3] Public school website page (about, gallery, honors, admissions open) generated from the system.

---

## 14. Dashboards

- [P1] **Super Admin**: schools, revenue, dues, growth.
- [P1] **Principal**: today's attendance, fee collection today/this month, pending hand-overs to approve, defaulters count, upcoming exams, syllabus progress, top students, recent remarks, comparison charts.
- [P1] **Staff/Accountant**: today's collection, cash in hand, pending hand-overs, dues to collect.
- [P1] **Teacher**: my classes, mark attendance, pending marks entry, today's timetable, homework to post.
- [P1] **Student**: timetable, homework, upcoming tests, online exams, results, attendance, honors, gallery.
- [P1] **Parent**: switch between children, attendance, fee status and vouchers, results, remarks, homework, announcements, honors.

---

## 15. Reports (all exportable to PDF and Excel)

**Students:** strength by class/section/gender, new admissions, left students, birthday list, contact list, sibling list.
**Attendance:** daily, monthly register, student-wise %, class-wise %, low attendance list.
**Academics:** test results, exam results, report cards, tabulation sheet, toppers, subject analysis, progress over time, syllabus coverage.
**Fees:** daily collection, collection by staff, hand-over register, defaulters with ranking, month comparisons (1 / 6 / 12 months), recovery %, concession report, student ledger, class-wise dues.
**Finance [P2]:** expenses, income, profit/loss, salaries.
**Staff [P2]:** attendance, leave, payroll.
**Communication:** messages sent, delivery status, usage.
**Audit:** changes to marks, fees, attendance.

---

## 16. Extra modules schools commonly ask for [P3, sell as add-ons]

- **Transport:** routes, vehicles, drivers, stops, transport fee, student-to-route mapping.
- **Library:** books catalog, issue/return, fines.
- **Inventory:** uniforms, books, stationery stock and sales.
- **Hostel:** rooms, allocation, hostel fee.
- **Parent feedback / complaints** box with tracking.
- **Surveys and polls** for parents/staff.
- **Mobile apps** (Android/iOS) after the PWA proves itself.
- **Urdu language** support (RTL) alongside English.
- **AI helpers:** auto-written report card remarks, question generation from syllabus.

---

## 17. Non-functional requirements

- [P1] Mobile-first: parents and teachers mostly use phones.
- [P1] Fast on slow internet: paginated lists, compressed images.
- [P1] Data isolation between schools enforced in the backend, with automated tests.
- [P1] Daily automated database backups on OCI; point-in-time restore.
- [P1] Passwords hashed (bcrypt/argon2), rate-limited login, HTTPS only.
- [P1] Soft deletes for critical records (students, receipts, marks); nothing financial is hard-deleted.
- [P1] Time zone and currency per school (default PKR, Asia/Karachi; configurable).
- [P2] Data export for a school on request (they own their data).

---

## 18. Suggested build order

1. **Foundation:** monorepo, Next.js + Express + MySQL setup, auth, roles/permissions, multi-tenancy, Super Admin creates schools and principals, subscription plans.
2. **School setup + people:** sessions, classes, sections, subjects, students (with parent logins), staff/teachers, bulk import.
3. **Attendance** + absent WhatsApp alerts (sets up the WhatsApp pipeline early).
4. **Fees:** structure, monthly generation, vouchers, collection, receipts, hand-over and principal approval, defaulters, comparisons.
5. **Tests and exams:** marks entry, results, report cards, publishing, WhatsApp sending.
6. **Remarks, monthly parent report, rankings, honors, honor board.**
7. **LMS:** syllabus + progress, study material, homework, online exams/question bank.
8. **Gallery, announcements, dashboards polish, reports export.**
9. **P2 items:** payroll, expenses, timetable, certificates, ID cards, etc.

---

## 19. Open questions to settle before coding

1. **Database:** MySQL on Oracle Cloud (OCI), or the Oracle Database product itself? This plan assumes **MySQL on OCI**.
2. **WhatsApp:** one platform-wide WhatsApp number for all schools, or each school connects its own number? Who pays per-message costs?
3. **Pricing model:** flat monthly per school, or per student?
4. **Grading system and report card layout:** do you have a sample report card from a school you want to match?
5. **Classes range:** Playgroup to Matric only, or also Intermediate / O & A levels?
6. **Language:** English only at launch, or Urdu too?
7. **Online fee payment:** needed at launch or later?
8. **Product name and domain.**
