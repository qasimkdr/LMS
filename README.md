# Nexora LMS

Nexora LMS is a production-oriented, multi-tenant SaaS learning management and school operations platform. It is designed so one Nexora installation can serve many independent schools while keeping each school's users, academic data, finance data and files isolated.

> Platform hierarchy: **Super Admin → School / Principal → Staff & Teachers → Students & Parents**

## Contents

- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Roles and permissions](#roles-and-permissions)
- [Role-based navigation](#role-based-navigation)
- [Feature catalogue](#feature-catalogue)
- [API catalogue](#api-catalogue)
- [Approval workflow](#approval-workflow)
- [Authentication and security](#authentication-and-security)
- [Multi-tenancy](#multi-tenancy)
- [Database and storage](#database-and-storage)
- [Frontend UX](#frontend-ux)
- [Deployment](#deployment)
- [Environment variables](#environment-variables)
- [Current implementation notes](#current-implementation-notes)

## Architecture

```text
Nexora Platform
│
├── SUPER_ADMIN                 Cross-tenant platform owner
│   └── Schools
│       └── PRINCIPAL           Full administrator of one school
│           ├── STAFF           Operational administration
│           ├── TEACHER         Assigned classes/subjects
│           ├── STUDENT         Own academic account
│           └── PARENT          Read-only linked-child portal
│
├── React/Vite web application
├── Express REST API
├── PostgreSQL / Supabase
├── Prisma ORM
└── Supabase Storage
```

Repository layout:

```text
apps/
  web/              React + Vite frontend
  api/              Node/Express REST API
packages/
  database/         Prisma schema, database client and SQL migrations
scripts/             Production/bootstrap scripts
```

## Technology stack

### Frontend
- React
- Vite
- TypeScript
- Tailwind CSS
- Material UI
- Material Icons
- GSAP animations
- Recharts / Chart.js style analytics surfaces
- Axios API client
- Responsive role-based application shell

### Backend
- Node.js
- Express
- TypeScript
- Zod request validation
- JWT access/refresh authentication
- bcrypt password hashing
- Role-based authorization middleware
- Module/subscription entitlement gates

### Data / infrastructure
- PostgreSQL
- Supabase managed PostgreSQL
- Prisma ORM for core models
- SQL migrations for operational modules
- Supabase Storage for school-scoped documents/media
- Render web service for API
- Render static site for frontend

## Roles and permissions

### 1. Super Admin

The Super Admin is the Nexora platform owner and is the **only role allowed to operate across school tenants**.

Main capabilities:
- Platform dashboard
- View platform-wide school/user/student/teacher metrics
- Create schools
- Create the initial Principal account while creating a school
- Search and manage schools
- Manage school lifecycle/status
- Assign/manage subscription plans
- Manage quotas and module availability
- View subscription/renewal information
- Control student, teacher and storage limits
- Support center access
- Notifications
- Platform audit capabilities
- Secure Principal impersonation architecture with auditing
- Global platform settings/branding architecture
- School suspension/read-only/grace-period controls

School lifecycle is designed to support states such as ACTIVE, GRACE_PERIOD, READ_ONLY and SUSPENDED.

### 2. Principal

Principal is the highest authority **inside one school**. A Principal never gains access to another school.

Principal capabilities:
- School dashboard
- Manage students
- Create student accounts
- Manage teachers
- Create teacher credentials
- Manage staff
- Create staff credentials
- Manage classes and sections
- Manage subjects
- Assign teachers to class/subject combinations
- Manage timetable
- View/manage attendance
- Review staff approval requests
- Coursework management
- Exam studio access
- Results and report cards
- Fee recovery
- Finance dashboard
- Student fee ledger
- Announcements
- Academic terms and analytics
- Advanced analytics
- Calendar/events
- Leave management/review
- School settings
- Approval policies
- Notifications
- Support center

### 3. Staff

Staff handles day-to-day school administration. Sensitive operations can be routed to the Principal approval center depending on school policy.

Staff capabilities include:
- Staff dashboard
- Operational requests
- Student/administrative operations supported by policy
- Announcements
- Fee collection/recovery
- Student fee ledger
- Timetable access
- Leave center
- School calendar
- Notifications
- Support

Sensitive staff actions can be configured as directly allowed, approval-required or unavailable.

### 4. Teacher

Teachers are intended to operate only on their assigned class/subject scope.

Teacher capabilities:
- Teacher dashboard
- Assigned timetable
- Attendance for assigned classes
- Coursework
- Syllabus/material management
- Assignment management
- Student submission review
- Exam creation
- Question management
- Exam grading
- Report cards
- Calendar
- Leave requests
- Notifications

Teacher assignment model:

```text
Teacher → Class → Subject
```

The Class entity can include a section, allowing assignments such as:

```text
Teacher A → Grade 8 / Section A → Mathematics
```

### 5. Student

Students access only their own academic/account scope.

Student capabilities:
- Student dashboard
- Eligible exams
- Start/continue/submit exams
- Coursework
- Assignments
- Assignment submission
- Report card
- Fee ledger
- Timetable
- Leave center where enabled
- Calendar
- Notifications

### 6. Parent

Parent accounts are linked to one or more Student profiles. Parents are read-only for student academic actions and **cannot act as the student**.

Parent capabilities:
- Parent dashboard
- Switch between linked children
- View linked-child coursework
- View report cards
- View fee ledger/receipts
- View timetable
- View calendar
- Notifications

## Role-based navigation

Nexora uses a responsive role-aware application shell. Desktop receives a persistent navigation sidebar; mobile uses a drawer/hamburger experience.

### Super Admin navigation
- Dashboard
- Schools
- Plans
- Notifications
- Support
- Logout

### Principal navigation
- Dashboard
- Students / Teachers / Staff
- Classes & Subjects
- Teacher Assignments
- Timetable
- Attendance
- Coursework
- Exam Studio
- Report Cards
- Finance
- Fee Recovery
- Approvals
- Announcements
- Calendar
- Leave
- Analytics
- Advanced Analytics
- Notifications
- Settings
- Support
- Logout

### Staff navigation
- Dashboard
- Requests
- Fee Recovery
- Student Fees
- Announcements
- Timetable
- Calendar
- Leave
- Notifications
- Support
- Logout

### Teacher navigation
- Dashboard
- Attendance
- Coursework
- Submission Review
- Exam Studio
- Grading
- Report Cards
- Timetable
- Calendar
- Leave
- Notifications
- Logout

### Student navigation
- Dashboard
- Exams
- Coursework
- Assignments
- Report Card
- Fees
- Timetable
- Calendar
- Leave
- Notifications
- Logout

### Parent navigation
- Dashboard
- Coursework
- Report Card
- Fees
- Timetable
- Calendar
- Notifications
- Logout

## Feature catalogue

### Authentication and sessions
- Email or username login
- Short-lived access tokens
- Refresh-token session architecture
- Refresh cookie is HttpOnly
- Secure cookie in production
- SameSite=Lax
- Session duration up to approximately 3 days
- Automatic access-token refresh
- Logout/session revocation
- School lifecycle enforcement during authentication
- Role-based protected frontend routes
- Role-based protected API routes

### School management
- Create tenant school
- Unique school slug
- School contact information
- School description/address/phone/email
- School branding/logo architecture
- Student quota
- Teacher quota
- Storage quota
- Principal account provisioning
- School subscription/lifecycle management

### People and account management
Principal School Operations supports:
- Teacher creation
- Staff creation
- Student creation/enrolment
- Temporary credentials
- Student admission number
- Guardian information
- Class assignment
- School-scoped user directory

Parent provisioning supports:
- Create Parent account
- Link Parent to multiple students
- Child switching architecture

### Classes and subjects
- Create classes
- Sections
- Academic year
- Create subjects
- Subject codes
- School-scoped academic structure

### Teacher assignments
- Assign Teacher → Class → Subject
- Principal-controlled assignment interface
- Teacher scope used by academic features

### Attendance
- Attendance sessions
- Per-student attendance records
- Teacher attendance flow
- Principal attendance view
- Staff/old-attendance approval architecture
- Attendance statuses and summaries
- Foundation for parent absence notifications

### Approval engine
Generic school approval system for sensitive staff actions.

Workflow:

```text
DRAFT
  ↓
PENDING
  ↓
REVISION_REQUIRED → RESUBMITTED
  ↓
APPROVED
```

Additional terminal states include REJECTED and CANCELLED.

Approval policies can cover actions such as:
- CREATE_STUDENT
- EDIT_STUDENT
- DELETE_STUDENT
- CHANGE_STUDENT_CLASS
- ASSIGN_TEACHER
- EDIT_TIMETABLE
- PUBLISH_ANNOUNCEMENT
- EDIT_OLD_ATTENDANCE
- CORRECT_RESULT
- DELETE_RECORD

Approval requests maintain revision/history architecture rather than silently replacing sensitive requests.

### Coursework
- Assignments
- Course materials
- Syllabus items
- Student assignment submissions
- Teacher submission review
- Marks/feedback
- Assignment publication notifications
- Grading notifications
- Parent coursework view

### Exams
Exam Studio supports an extensible question model including:
- MCQ
- Multiple select
- True/False
- Fill in the blank
- Short answer
- Long answer
- Numerical
- Matching
- Essay

Exam configuration architecture includes:
- Duration
- Start/end dates
- Total marks
- Pass marks
- Randomization settings
- Auto-submit
- Result settings

Exam attempt lifecycle includes:
- IN_PROGRESS
- SUBMITTED
- PENDING_REVIEW
- GRADED

Grading:
- Objective answers can be auto-graded
- Written/subjective answers can be manually reviewed
- Final percentage/pass calculation
- Autosave/continue attempt flow

Import architecture includes exam/question import routes for formats such as DOCX/TXT/CSV as development continues.

### Report cards and academic reporting
- Academic terms
- Current term selection
- Term date ranges
- Report-card calculation API
- Attendance summary integration
- Exam/assignment performance
- Print / Save PDF through browser print flow
- Teacher/Principal/Student/Parent report-card routes
- Signature footer architecture
- Report-card publication/snapshot migration architecture

### Analytics
Principal analytics:
- Students
- Teachers
- Classes
- Pending approvals
- Academic term analytics
- Performance charts
- Advanced rankings
- Teacher activity/performance analytics

Finance analytics:
- Collection trends
- Staff recovery ranking
- Paid/pending/overdue financial views

### Finance and fees
- Fee structures
- Fee payments
- Fee invoices
- Fee recovery batches
- Student dues
- Staff fee collection
- Principal fee recovery dashboard
- Batch submission
- Batch collection/review
- Student/Parent fee ledger
- Payment receipts
- Collection trends
- Staff recovery ranking
- Fee adjustment/installment migration architecture
- Finance settings

### Timetable
- School timetable entries
- Principal timetable management
- Staff timetable access
- Teacher timetable access
- Student timetable access
- Parent linked-child timetable architecture

### Leave management
- Leave requests
- Leave listing
- Principal/reviewer decision flow
- Teacher/staff/student leave surfaces where enabled
- Calendar integration architecture

### School calendar
- School calendar/events API
- Principal/Staff/Teacher/Student/Parent calendar surfaces

### Announcements
- School announcements
- Principal publishing
- Staff publishing subject to approval policy
- Role-targeted communication architecture

### Notifications
Central notification center for all roles. Event architecture supports notifications for events such as:
- Assignment publication
- Assignment grading
- Exams/results
- Announcements
- Approval remarks
- Fee/payment events
- Absence
- Report-card publication
- Subscription events

Future channels can include email, push, SMS or WhatsApp while in-app notification remains the base channel.

### Support
- Support center for Super Admin / Principal / Staff
- Support-ticket database/API architecture

### Backups and export
Backend backup/export architecture exists for school data. Long-term goal is tenant-safe backup/restore and export for authorized administrators.

### Audit and activity
Sensitive operations are designed to capture:
- Actor
- Actor role
- School
- Entity/action
- Old/new values where appropriate
- Timestamp
- Approval context

## API catalogue

All REST routes are served below the API prefix, normally `/api`.

> The lists below describe the functional API groups. Exact HTTP methods and subpaths should be checked in the corresponding `apps/api/src/routes/*.ts` file when extending the backend.

### Authentication — `/api/auth`
Used by: **all roles**

Responsibilities:
- Login by email/username
- Refresh access token
- Logout/session revocation
- Current authenticated session/user operations

### Dashboard — `/api/dashboard`
Used by: role-specific dashboards

Examples:
- Principal metrics
- Teacher dashboard data
- Staff/dashboard metrics where implemented

### Super Admin — `/api/super-admin`
Used by: **SUPER_ADMIN only**

Responsibilities:
- Platform metrics
- School creation
- Principal provisioning
- School management
- Lifecycle/status changes
- Tenant quotas/subscription controls
- Cross-tenant administrative operations

### Subscription plans
Used by: **SUPER_ADMIN**

Responsibilities:
- Plan configuration
- Module entitlements
- School plan assignment
- Quota/subscription controls

### School Operations — `/api/school-operations`
Used by: primarily **PRINCIPAL**

Implemented operations include:
- `GET /overview`
- class creation
- subject creation
- teacher/staff account creation
- student creation/enrolment

### School Directory
Used by: authorized school roles

Responsibilities:
- Tenant-scoped directory/reference data

### Teacher Assignments — `/api/teacher-assignments`
Used by: primarily **PRINCIPAL**, consumed by teacher-scoped features

Responsibilities:
- Teacher/class/subject assignment
- Assignment listing and management

### Attendance — `/api/attendance`
Used by: **PRINCIPAL, TEACHER** and authorized operational flows

Responsibilities:
- Attendance sessions
- Attendance records
- Class/date attendance loading
- Attendance marking/update
- Attendance summaries

### Approvals — `/api/approvals`
Used by: **PRINCIPAL, STAFF**

Responsibilities:
- Create staff requests
- Submit/resubmit
- Principal review
- Approve/reject/request revision
- Revision history

### Policies — `/api/policies`
Used by: **PRINCIPAL**

Responsibilities:
- Configure whether staff may perform an action
- Configure whether an action requires Principal approval

### Coursework — `/api/coursework`
Used by: **PRINCIPAL, TEACHER, STUDENT** according to endpoint

Responsibilities:
- Assignments
- Student submissions
- Submission listing
- Grading
- Course materials
- Syllabus

### Parent Coursework
Used by: **PARENT**

Responsibilities:
- Read-only coursework information for linked children

### Exams — `/api/exams`
Used by: **TEACHER, PRINCIPAL** according to endpoint

Responsibilities:
- Exam creation/configuration
- Questions/options
- Exam management

### Exam Attempts — `/api/exam-attempts`
Used by: **STUDENT, TEACHER** according to endpoint

Responsibilities:
- Eligible exams
- Start attempt
- Autosave answers
- Continue attempt
- Submit
- Objective auto-grading
- Manual review/grading
- Final result calculation

### Exam Import
Used by: authorized **TEACHER/PRINCIPAL** flows

Responsibilities:
- Import/parse exam questions from supported document/text formats

### Reports — `/api/reports`
Used by: **PRINCIPAL, TEACHER, STUDENT, PARENT** with scope enforcement

Implemented/reporting operations include:
- `GET /terms`
- `POST /terms`
- `GET /report-card`

### Advanced Analytics — `/api/advanced-analytics`
Used by: **PRINCIPAL**

Implemented operations include:
- `GET /rankings`
- `GET /teacher-performance`

### Fees — `/api/fees`
Used by: **PRINCIPAL, STAFF** according to operation

Important operations include:
- `GET /recovery-dashboard`
- `GET /student-dues`
- `POST /receive`
- `POST /batches/:id/submit`
- `GET /batches`
- `GET /batches/:id`
- `PATCH /batches/:id/collect`

### Fee Ledger — `/api/fee-ledger`
Used by: **PRINCIPAL, STAFF, STUDENT, PARENT** with scope enforcement

Implemented operations include:
- `GET /ledger`
- `GET /receipt/:paymentId`
- `GET /collection-trends`
- `GET /staff-ranking`

Parent ledger selection uses a linked Student profile identifier.

### Fee Adjustments
Used by: authorized finance administration

Responsibilities:
- Fee adjustments/financial corrections according to authorization

### Finance Settings
Used by: school finance administration

Responsibilities:
- School finance configuration

### Campus / timetable / leave — `/api/campus`
Used by: school roles according to endpoint

Timetable operations include:
- `GET /timetable`
- `POST /timetable`

Leave operations include:
- `GET /leave`
- `POST /leave`
- `PATCH /leave/:id/review`

Legacy campus fee endpoints may coexist while the dedicated `/api/fees` service becomes the canonical finance implementation.

### Leave Calendar
Used by: role-authorized school users

Responsibilities:
- Leave/calendar operational data
- School event/calendar integration

### Announcements — `/api/announcements`
Used by: **PRINCIPAL, STAFF** for management and relevant school roles for consumption

Responsibilities:
- Announcement creation/listing/publishing
- Approval-aware staff publication

### Notifications — `/api/notifications`
Used by: **all authenticated roles**

Important operations include:
- `GET /`
- `PATCH /read-all`
- `PATCH /:id/read`

### Parent management — `/api/parents`
Used by: **PRINCIPAL**

Responsibilities:
- Create Parent account
- Link Parent to one or multiple students
- Manage Parent/student relationships

### Portal — `/api/portal`
Used by: **STUDENT / PARENT**

Responsibilities:
- Student portal data
- Parent linked-child portal data
- Role-safe academic summaries

### Storage
Used by: authorized roles based on feature

Responsibilities:
- Supabase-backed school file metadata/upload architecture
- School-scoped object paths

Recommended object key convention:

```text
{schoolId}/{feature}/{entityId}/{filename}
```

### Backups
Used by: authorized administrative roles

Responsibilities:
- Tenant data export/backup/restore architecture

### Support
Used by: **SUPER_ADMIN, PRINCIPAL, STAFF**

Responsibilities:
- Support-ticket workflow

### Health — API health endpoint
Used by: deployment/infrastructure monitoring

Responsibilities:
- API/service health status
- Deployment connectivity checks

## Approval workflow

Nexora separates routine staff work from sensitive school-authority decisions.

Example:

```text
Staff requests student deletion
        ↓
Policy engine checks DELETE_STUDENT
        ↓
Approval required
        ↓
PENDING request created
        ↓
Principal reviews
   ┌────┴───────────────┐
APPROVE      REVISION_REQUIRED / REJECT
   ↓
Authorized mutation executes
```

This model is intended to prevent Staff from silently performing high-impact changes.

## Authentication and security

### Token model
- Access token: short-lived, approximately 15 minutes
- Refresh session: approximately 3 days
- Access token kept in application memory rather than localStorage
- Refresh token delivered through HttpOnly cookie
- Production cookie uses Secure
- SameSite=Lax
- Refresh sessions can be revoked

### Authorization
Three layers are expected:
1. Authentication: who is the user?
2. Role authorization: is this role allowed to perform this action?
3. Tenant/object authorization: does this resource belong to the user's school / assignment / linked child?

### Passwords and secrets
- Passwords are hashed server-side
- Database/JWT/Supabase credentials belong in environment variables
- Secrets must never be committed
- Bootstrap credentials should be removed/disabled after production bootstrap

## Multi-tenancy

Nexora currently uses a shared PostgreSQL database.

Every tenant-owned resource must be scoped by `schoolId`.

Example security principle:

```text
Authenticated Principal
        ↓
JWT/auth context resolves schoolId = SCHOOL_A
        ↓
GET /students/123
        ↓
Backend query must require:
student.id = 123 AND student.schoolId = SCHOOL_A
```

Changing an ID in the browser must never expose School B's records.

Super Admin is the only cross-tenant role.

Additional scoping rules:
- Teachers must be constrained by teacher assignment where relevant
- Students must be constrained to their own Student profile
- Parents must be constrained to explicitly linked children
- Files must be scoped to the owning school
- Financial data must be school-scoped
- Analytics must be school-scoped

## Database and storage

### Core database
Permanent production database: **Supabase PostgreSQL**.

Prisma manages the core relational schema. Operational SQL migrations also exist for newer modules.

Important data domains include:
- School
- User
- Student
- Parent/student links
- Class
- Subject
- Teacher assignments
- Attendance sessions/records
- Approval policies/requests/revisions
- Assignments/submissions
- Course materials
- Syllabus
- Exams/questions/options
- Exam attempts/student answers
- Notifications
- Announcements
- Fee invoices/payments/recovery batches
- Academic reporting/publications
- Timetable
- Leave
- Calendar/events
- Support tickets
- Refresh sessions
- Storage metadata

### Storage
Supabase Storage is the intended persistent object store for:
- School logos
- Coursework documents
- Assignment resources
- Student submissions
- Exam/import files
- Reports/exports
- Other tenant media

## Frontend UX

Nexora's UI direction is a modern SaaS command-center experience:
- Responsive desktop/mobile layouts
- Role-based sidebar/navigation
- Mobile hamburger drawer
- Gradient backgrounds
- Glassmorphism surfaces
- 3D card depth
- Animated gradient controls
- Hover lift effects
- Icon scale/rotation interactions
- Shimmer/highlight effects
- GSAP page entrance animations
- Skeleton loaders while data loads
- Spinners during mutations
- Clear empty/error states
- Material UI dialogs/forms/icons
- Dashboard analytics cards and charts

## Deployment

Current intended production architecture:

```text
Browser
   │
   ├── https://nexora-lms-web.onrender.com
   │        Render Static Site / React
   │
   └── https://nexora-lms-api.onrender.com/api
            Render Node API
                 │
                 ├── Supabase PostgreSQL
                 └── Supabase Storage
```

The frontend build must define the production API base URL.

The API must allow the deployed frontend origin through CORS.

Render's temporary/free PostgreSQL resource is not intended as Nexora's permanent database; Supabase is the persistent database target.

## Environment variables

Typical API variables:

```env
DATABASE_URL=
DIRECT_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
CLIENT_URL=
PORT=
NODE_ENV=
```

Frontend:

```env
VITE_API_URL=https://nexora-lms-api.onrender.com/api
```

Production bootstrap may temporarily use variables such as:

```env
INIT_PRODUCTION_DB=
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_USERNAME=
BOOTSTRAP_ADMIN_FIRST_NAME=
BOOTSTRAP_ADMIN_LAST_NAME=
BOOTSTRAP_ADMIN_PASSWORD=
```

Bootstrap/init flags and bootstrap credentials should be disabled/removed after successful first-time initialization.

## Development

Copy the relevant `.env.example` files to local `.env` files and supply local credentials.

```bash
npm install
npm run dev
```

Build/CI should validate frontend, API and database packages before deployment.

## Current implementation notes

Nexora is actively being developed. The README documents both implemented modules and the intended authorization boundaries around those modules.

Important engineering items to continue hardening:
- Keep every tenant query scoped by `schoolId`
- Ensure Parent timetable/data queries validate linked-child ownership
- Ensure Teacher coursework/attendance queries use assignment scope rather than creator-only shortcuts
- Keep dedicated `/api/fees` as the canonical finance service and phase out legacy campus fee behavior
- Prevent duplicate/approved fee payments from being overwritten
- Continue syncing raw-SQL operational tables into the Prisma schema where appropriate
- Improve report-card publication, branding, remarks and persisted PDF/snapshot flows
- Expand actual Supabase Storage upload workflows
- Expand audit logging and event-driven notifications
- Continue performance work on analytics to avoid N+1 queries

## Product goal

Nexora LMS is intended to become a complete school operating system rather than only an online classroom: academic management, people/accounts, attendance, exams, coursework, finance, approvals, communication, analytics and parent visibility all live under one tenant-safe SaaS platform.
