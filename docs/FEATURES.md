# School Management System (SMS + LMS): Feature Plan

Status: **planning, revision 3**. All features below are approved for building except the add-on modules (section 16), which are out of scope.
Priority tags: **[P1]** must ship in the first release (MVP), **[P2]** second release, **[P3]** later.

**Revision 2 changes:** add-ons removed; detailed admission form and profile photo (4.1, 4.2); teacher's own schedule (5.1, 7.4 moved to P1); full online exam paper builder, review and publishing (8.3); one approval and publishing workflow for all results (8.4); principal can edit everything (1.2); new sections 18 to 25 for features that were missing.

**Revision 3 changes:** each school connects and pays for its own WhatsApp number (10.1); plans with storage and usage limits and a usage meter (0.3, 0.4); class chat with 30-day auto-delete (22.1); parent messages to their child's teachers and complaints to the principal (22.2, 22.3); decisions recorded (section 27).

---

## 0. Platform and business model

### 0.1 Tech stack
| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript, Tailwind CSS, responsive and installable as a PWA (works on phones) |
| Backend | Node.js + Express + TypeScript, REST API, JWT access tokens + refresh tokens in httpOnly cookies |
| Database | MySQL 8 on Oracle Cloud Infrastructure (OCI) |
| ORM / migrations | Prisma or Drizzle (MySQL), versioned migrations |
| File storage | OCI Object Storage (gallery photos, documents, syllabus PDFs, receipts, report-card PDFs) |
| Hosting | OCI compute (Next.js + API behind Nginx, PM2 or Docker), SSL via Let's Encrypt |
| Background jobs | Queue (BullMQ + Redis) for WhatsApp/SMS sends, PDF generation, monthly reports, reminders |
| Messaging | WhatsApp Business Cloud API (Meta) using **each school's own number and Meta account**, plus email; real-time in-app chat over WebSockets (Socket.IO) |
| PDFs | Server-side PDF generation (report cards, fee vouchers, receipts, certificates, ID cards) |

### 0.2 Multi-tenancy (one system, many schools)
- [P1] Every school is a tenant. All data rows carry a `school_id`, and every query is scoped to the logged-in user's school.
- [P1] One school can have multiple campuses or branches (optional per school).
- [P1] Schools are fully isolated: a principal can never see another school's data.
- [P2] Custom subdomain per school (e.g. `cityschool.yourapp.com`) with school logo and colors on the login page.

### 0.3 Your revenue model (Super Admin billing)
- [P1] Monthly subscription per school.
- [P1] Plans and pricing: flat monthly fee, or per-student pricing, or tiers (Basic / Standard / Premium) that switch modules on/off.
- [P1] Each plan sets limits (see 0.4); Super Admin can create, edit and price plans and give a school custom limits.
- [P1] Invoice to each school every month, record payments received, payment history.
- [P1] Grace period, then automatic read-only mode, then suspension if unpaid; one-click reactivation.
- [P2] Free trial period for new schools.
- WhatsApp is **not** billed by you: each school connects its own WhatsApp Business number and pays Meta directly (see 10.1). You only sell the software.
- [P3] Online payment of subscription (bank transfer proof upload, JazzCash/Easypaisa/Stripe, etc.).

### 0.4 Plan limits and usage tracking
**Limits a plan can set** [P1]
- Total storage (e.g. 5 GB / 20 GB / 50 GB), covering all uploads: syllabus files, study material, documents, student photos and documents, gallery, chat attachments, homework submissions, online exam answer photos.
- Maximum size of a single file (e.g. 10 MB).
- Number of active students, number of staff/teacher accounts.
- Number of campuses.
- Gallery albums / photos [P2], online exams per month [P2].
- Modules included (e.g. online exams, class chat, payroll on higher plans only).

**Usage meter for the school** [P1]
- Settings → "Plan and usage" page for the principal: plan name, renewal date, and progress bars like **"Storage: 3.2 GB of 5 GB used (64%)"**, "Students: 412 of 500".
- Storage breakdown by type: syllabus, study material, gallery, documents, photos, chat, exams; and by uploader [P2].
- Largest files list so the principal can delete old files to free space.
- Warnings at 80% and 95% (dashboard banner + notification to principal); at 100% new uploads are blocked with a clear message ("Storage full, upgrade plan or delete files"), while everything else keeps working.
- Upgrade request button that notifies Super Admin.
- Files deleted from chat (30-day cleanup) and recycle bin (after 30 days) are subtracted from usage automatically.

**Usage for Super Admin** [P1]
- Table of all schools with storage used vs limit, students vs limit, schools near their limits (upsell list).

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

### 1.2 Principal has full control of their school
- [P1] Principal can **view, edit, correct or delete any record** in the school: student enrollment forms and profiles, staff profiles, attendance, test marks, exam marks, online exam answers and marks, remarks, fee records, receipts, honors, gallery.
- [P1] Principal can edit marks and results **even after publishing**; parents see the corrected result and can optionally be notified of the correction.
- [P1] Every principal edit keeps the old value and new value in the audit log (who, when, why: a reason box on sensitive edits like marks and fees).
- [P1] Principal can lock records (e.g. lock a term's results or a month's attendance) so teachers and staff can no longer change them.
- [P1] Recycle bin: deleted records can be restored by the principal for 30 days.

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

### 4.1 Enrollment / admission form (student bio data)
All fields can be edited later by the principal (and by staff who have permission). Principal can mark which fields are required for their school.

**Admission details** [P1]
- Admission number (auto-generated), admission date, session, class and section applied for, roll number, admission type (new / transfer from another school / re-admission), house [P2].

**Student personal information** [P1]
- Full name, name in Urdu [P2], gender, date of birth (age calculated automatically), place of birth.
- B-Form / CRC / CNIC number (validated format).
- Religion, nationality, mother tongue.
- Blood group.
- Current address, permanent address, city, area / sector (useful for reports).
- Student's own phone/email (optional, older students).

**Father's information** [P1]
- Name, CNIC, mobile, WhatsApp number, email, occupation, organization, monthly income [P2], education [P2], office address [P2].
- Status: alive / deceased (affects fee concession and communication).

**Mother's information** [P1]
- Name, CNIC, mobile, WhatsApp number, occupation, education [P2].

**Guardian (if not living with parents)** [P1]
- Name, relation, CNIC, mobile, WhatsApp, address.
- Primary contact selection: which number gets WhatsApp messages (father / mother / guardian, or more than one).

**Emergency contact** [P1]
- Name, relation, phone (someone other than parents).

**Previous school** [P1]
- School name, last class passed, year, marks/grade, reason for leaving, School Leaving Certificate number.

**Health information** [P1]
- Allergies, chronic conditions (asthma, diabetes, epilepsy…), regular medicines, disabilities / special needs, family doctor and phone.
- Vaccination record [P2], height and weight [P2].

**Siblings** [P1]
- Link brothers/sisters already studying in the school (one parent login, sibling discount, one family fee voucher).

**Fee details at admission** [P1]
- Fee category, discount/concession type and %, admission fee paid, transport needed (yes/no, noted only).

**Documents upload** [P1]
- B-Form copy, father's CNIC front/back, mother's CNIC, previous result card, leaving certificate, medical certificate, birth certificate, any other files.
- Checklist showing which documents are still missing.

**Admission declaration** [P2]
- Parent agrees to school rules (checkbox / signature image), date.

**Printing and output**
- [P1] Printable admission form PDF (filled), and a blank form for parents who fill it on paper.
- [P1] Admission confirmation sent to parent on WhatsApp with the parent and student login details.

### 4.2 Student profile photo
- [P1] Upload a profile photo from computer or phone gallery, or **take it with the phone/laptop camera**.
- [P1] Crop and rotate before saving; automatic resize and compression.
- [P1] Photo is used everywhere: profile, attendance lists, report cards, ID cards, certificates, honor board.
- [P1] Change photo later (principal/staff; parents can request a change [P2]).
- [P2] Bulk photo upload: upload many images named by admission number and the system matches them to students.
- [P1] Same photo features for staff and teacher profiles.

### 4.3 Student records
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

### 5.1 Teacher's own schedule ("My Classes")
- [P1] Teacher sees **which classes and sections they are assigned, which subject, and at what time** (period number, start and end time, room) for every day of the week.
- [P1] "Today" view on the teacher dashboard: next period, current period, classes left today.
- [P1] Weekly view and printable personal timetable.
- [P1] Their upcoming duties in one list: tests to take, online exams scheduled, marks entry pending, homework to post, papers waiting for review.
- [P2] Notification before each period / exam duty (optional).
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

### 7.4 Timetable (moved to P1 so teachers see their schedule)
- [P1] Period timings per school (can differ for e.g. Friday or summer/winter timings [P2]).
- [P1] Class timetable (periods, subjects, teachers, rooms).
- [P1] Teacher timetable auto-generated from class timetables; clash detection (same teacher in two classes at once).
- [P1] Students and parents see the class timetable.
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

### 8.3 Online exams (full online paper)

**Paper builder (teacher)** [P1]
- Teacher creates an online paper for the classes/sections and subjects they are assigned to.
- Paper header: title, exam/term it belongs to (or standalone test), class, section(s), subject, total marks, passing marks, instructions.
- Paper divided into sections (e.g. Section A: MCQs, Section B: Short questions, Section C: Long questions), each with its own instructions and marks.
- Question types:
  - **MCQ, single correct answer**
  - **MCQ, multiple correct answers** [P2]
  - **True / False**
  - **Fill in the blanks** (one or more blanks in a sentence; accepted answers list, case-insensitive option)
  - **Matching columns** [P2]
  - **Short question / answer** (text box, word limit optional)
  - **Long question / answer** (large text box; option to also upload photos of a handwritten answer)
- Marks per question; optional negative marking for MCQs.
- Images in questions and options (diagrams, maps, figures); maths/science symbols [P2].
- "Attempt any X out of Y" choice questions (e.g. attempt any 5 of 8 short questions).
- Save from question bank, or write new questions that are saved to the bank automatically.
- Preview the paper exactly as students will see it.
- Duplicate an old paper and edit it; save as draft.
- [P2] Principal approval of the paper before it goes live (optional setting per school).
- [P2] Bulk import questions from Excel/Word.

**Scheduling** [P1]
- Start date/time and end date/time (window), and duration (e.g. 45 minutes from when the student starts).
- Which classes/sections can attend; exclude specific students; extra time for specific students [P2].
- Students and parents are notified of the upcoming exam (in-app, WhatsApp optional).

**Student attempts the exam** [P1]
- Every student logs in with their own ID and sees "Upcoming / Live / Completed" exams.
- Works on phone, tablet and computer.
- Countdown timer; question navigator (answered / not answered / marked for review).
- **Answers auto-save every few seconds**, so if internet drops or the phone switches off, the student can log back in and continue (within the time limit).
- Auto-submit when time ends; confirm screen on manual submit.
- One attempt only (teacher can allow a re-attempt for a specific student).
- Shuffle question order and MCQ options per student.
- Anti-cheating basics: warning and log when the student leaves the tab/app, copy-paste disabled, full-screen mode on computers [P2].

**Checking and review (teacher)** [P1]
- MCQ, true/false, fill-in-the-blank and matching are **marked automatically**.
- Teacher can override any auto-marked answer (e.g. accept a spelling variation in a blank).
- Short and long answers: teacher reads each student's answer and gives marks.
- **Remarks per question** and an **overall remark per student** (e.g. "Good effort, revise chapter 3").
- Check student-by-student, or question-by-question across the whole class (faster for checking one question for everyone).
- Progress bar: how many papers checked out of total.
- See who did not attend; mark absent.

**Publishing with principal permission** [P1]
- When checking is done, teacher **submits results to the principal for approval**.
- Principal sees the result sheet, can open any student's paper, **edit marks or remarks**, then **approve and publish** or **send back to the teacher with a comment**.
- After publishing, students see marks, correct answers (if the teacher allows), per-question remarks and overall remark; parents see the result in their portal and can receive it on WhatsApp (one click for the whole class).
- Online exam marks can count towards the term result (e.g. a mid-term held online feeds into the report card).

**Analytics** [P2]
- Class average, highest/lowest, pass %, question-wise analysis (which question most students got wrong), time taken per student.

### 8.4 One approval and publishing workflow for all results
Applies to class tests, term exams and online exams. [P1]
1. **Draft:** teacher enters or checks marks; only teacher, class teacher and principal can see them.
2. **Submitted:** teacher submits to principal; teacher can no longer edit (unless sent back).
3. **Sent back:** principal returns it with a comment; teacher fixes and resubmits.
4. **Approved and published:** principal approves; students and parents can see it; WhatsApp sending becomes available.
5. **Corrected after publishing:** only the principal can change it; change is logged and parents can be notified.
- Principal setting: class tests can be allowed to publish directly by the teacher (no approval) if the school prefers, while exams always need approval.
- Principal dashboard shows "Results waiting for approval".

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
- [P1] **Each school uses its own WhatsApp number.** In Settings → WhatsApp, the principal connects the school's WhatsApp Business account (Meta WhatsApp Cloud API: phone number ID, business account ID, access token). The school pays Meta directly for messages; the platform charges nothing for messaging.
- [P1] Step-by-step setup guide inside settings, a "Send test message" button, and connection status (connected / token expired / not set up).
- [P1] Message templates (required by Meta for messages a parent did not start) are listed in settings with their approval status; the system provides ready-made template texts the school submits to Meta.
- [P1] **On/off switch for every automatic message type**: absent alert, late alert, fee voucher, fee reminder, payment receipt, test result, report card, monthly report, remarks, announcements, homework digest, gate pass, honors, exam reminders. Each can also be set to "manual only" (sent only when someone clicks Send).
- [P1] Master switch to turn WhatsApp off completely; if WhatsApp is off or not set up, everything still goes to the in-app notification center.
- [P1] Access token stored encrypted; only the principal can view/change WhatsApp settings.
- [P1] In-app notifications (parent/student/teacher portal).
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
- [P1] Monthly WhatsApp count per school (messages sent / failed by type), so the school can estimate its Meta bill.

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

## 16. Add-on modules: OUT OF SCOPE

Not being built: transport, library, inventory, hostel, surveys/polls, native mobile apps (the PWA covers phones), Urdu RTL interface, AI helpers. Can be reconsidered later.

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

## 18. Admissions pipeline (before a child becomes a student)
- [P1] Enquiry register: parent name, phone, child name, class wanted, source (referral, banner, social media), follow-up date and notes.
- [P1] Admission test / interview for applicants: schedule, marks, result (pass / fail / waiting list).
- [P1] Convert an applicant to a student in one click (enquiry data fills the enrollment form).
- [P2] Admission reports: enquiries vs admissions per month, by source, by class.
- [P2] Seats per section and capacity warnings.

## 19. Student lifecycle and session end
- [P1] **Withdrawal process:** request, fee clearance check (all dues must be paid or waived by principal), then School Leaving Certificate issued and status set to "Left".
- [P1] **Session closing:** promote students, carry forward arrears, archive the old session (still viewable, read-only), start the new session with new fee structure.
- [P1] Full academic history per student across all years: classes, results, attendance, fees, remarks, honors.
- [P2] Re-admission of a student who left (keeps old history).
- [P2] Alumni list (graduated students with contact).

## 20. More fee features
- [P1] **Family voucher:** one combined voucher and one payment for all siblings.
- [P1] Advance payment (pay several months ahead), with the balance shown as credit.
- [P1] Duplicate voucher / reprint receipt.
- [P1] Receipt numbering per school, bank account details printed on vouchers.
- [P2] Refunds and security deposit (refundable on leaving).
- [P2] Bank deposit entry: principal records cash deposited to bank, with slip photo.
- [P2] Fee structure change mid-session (new fee applies from a chosen month).

## 21. Exam administration
- [P1] Date sheet creation and publishing to students and parents.
- [P2] Admit cards / roll number slips (PDF).
- [P2] Seating plan per exam room.
- [P2] Invigilation duty roster for teachers (shows on teacher's schedule).
- [P2] Result re-check request by parents, tracked until the teacher/principal responds.
- [P2] Supplementary / re-exam for failed students.

## 22. Chat, messaging and complaints
All chat is inside the app (real-time), not on WhatsApp. Chat attachments count towards the school's storage limit.

### 22.1 Class chat (per class section)
- [P1] Every class section has one group chat automatically; all students of that section are members, plus the class teacher and subject teachers of that section.
- [P1] Text, emojis, images and files (size limits from plan); reply to a message.
- [P1] **Messages and attachments are deleted automatically after 30 days** (a daily job removes anything older than 30 days; a notice at the top of the chat says so).
- [P1] Teachers are moderators: delete any message, mute a student for a time, turn the chat to "teachers only can send" (announcement mode) or close it outside school hours.
- [P1] Principal can see every class chat and delete messages; principal can turn class chat on/off for the whole school or a section.
- [P1] Students can report a message to the teacher; reported messages are kept as evidence until the teacher/principal reviews them (even past 30 days).
- [P1] Students moved to another section are removed from the old chat and added to the new one; students who leave are removed.
- [P2] Bad-word filter (configurable word list).
- [P2] Parents do not join class chats (students and teachers only).

### 22.2 Parent ↔ teacher messaging
- [P1] Parent opens "Message a teacher", chooses the child (if siblings), and sees **only that child's teachers** (class teacher and subject teachers, with subject name); picks one and writes a message.
- [P1] Message types: general message, query, or **complaint**; text, images, files.
- [P1] One-to-one conversation thread per parent–teacher; read ticks; teacher replies in the app.
- [P1] Teacher can turn off messages outside set hours (auto-reply "I will reply during school hours").
- [P1] Principal can view all parent–teacher conversations (for safety and quality).
- [P1] Teacher can forward a conversation to the principal if it needs action.
- [P1] These conversations are **not** auto-deleted (kept as school record), principal can delete.

### 22.3 Complaints to the principal
- [P1] Parent can send a complaint **directly to the principal** (about a teacher, staff, another student, fees, facilities, transport, anything), with category, description and attachments; option to keep it private from teachers.
- [P1] Each complaint gets a ticket number and status: **New → In progress → Resolved / Closed**; principal can reply, assign it to a staff member/teacher, add internal notes.
- [P1] Parent sees the status and replies; gets notified on each update.
- [P1] Complaints raised to a teacher (22.2) can be escalated to the principal by the parent if not resolved.
- [P1] Principal dashboard: open complaints count, oldest unresolved, complaints by category and by month.
- [P2] Students can also send a complaint to the principal (e.g. bullying), with option to stay anonymous to teachers.

### 22.4 Other parent interaction
- [P1] Circulars with **read receipts**: see which parents have opened an announcement.
- [P2] Digital consent forms (e.g. trip permission): parent taps Agree / Disagree.
- [P2] Parent–teacher meeting scheduling: teacher opens slots, parents book a time.

## 23. Student safety and daily life
- [P1] Early leave / gate pass: student leaves early, recorded with who picked them up; parent gets a WhatsApp.
- [P2] Authorized pick-up persons per student (name, relation, photo).
- [P2] Visitor log at the school gate.
- [P2] Co-curricular activities and clubs: memberships, events, positions won (feeds honors).
- [P2] External achievements (competitions, olympiads, sports) on the student profile.

## 24. Usability for everyone
- [P1] Setup wizard for a new school: step-by-step checklist (school profile, session, classes, subjects, fee structure, import students, import staff).
- [P1] Global search: type a name, roll number, admission number or phone to jump to a student, staff or receipt.
- [P1] Notification center in the app with unread count.
- [P1] Every list is filterable, sortable, printable and exportable to Excel/PDF.
- [P1] Light and dark mode; works well on small phones.
- [P2] Help guides and short videos inside the app for each role.
- [P2] Notification preferences (which alerts each user wants).

## 25. Live classes and online learning extras
- [P2] Schedule online classes with a meeting link (Zoom / Google Meet); appears on student and teacher schedules; attendance for the online class.
- [P2] Class discussion / doubts board where students ask questions and teachers answer.
- [P2] Recorded lecture links attached to syllabus topics.

---

## 26. Suggested build order

1. **Foundation:** monorepo, Next.js + Express + MySQL setup, auth, roles/permissions, multi-tenancy, audit log, Super Admin creates schools and principals, subscription plans with limits, file storage with usage tracking.
2. **School setup + people:** setup wizard, sessions, classes, sections, subjects, period timings, full enrollment form with profile photo and documents, parent logins, staff/teachers, bulk import, global search.
3. **Timetable + teacher schedule** ("My Classes").
4. **Attendance** + school WhatsApp settings (own number, on/off switches) + absent alerts.
5. **Fees:** structure, monthly generation, family vouchers, collection, receipts, hand-over and principal approval, defaulters, comparisons.
6. **Tests and exams:** marks entry, approval and publishing workflow, results, report cards, date sheets, WhatsApp sending.
7. **Online exams:** question bank, paper builder (all question types), scheduling, student attempt with auto-save, checking and remarks, principal approval and publishing.
8. **Remarks, monthly parent report, rankings, honors, honor board.**
9. **LMS:** syllabus + progress, study material, homework.
10. **Communication:** class chat with 30-day cleanup, parent–teacher messaging, complaints to principal, circulars with read receipts, gate pass; gallery, dashboards polish, reports export.
11. **Admissions pipeline and session closing / withdrawal.**
12. **P2 items:** payroll, expenses, certificates, ID cards, live classes, etc.

## 27. Decisions and open questions

**Decided**
- Hosting and database: Oracle Cloud (OCI), MySQL 8.
- WhatsApp: each school connects its own number and pays Meta itself; every message type can be turned on/off in settings.
- Plans limit storage, students, staff and modules; schools see their usage.
- Add-on modules are out of scope.

**Still open** (see the latest conversation)
