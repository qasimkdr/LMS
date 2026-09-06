# Nexora LMS

Nexora LMS is a multi-tenant SaaS learning management system for schools.

## Roles

- Super Admin (platform owner)
- Principal (school owner/admin)
- Staff (operational admin with approval workflow)
- Teacher
- Student / Parent portal

## Stack

- React + Vite + TypeScript
- Tailwind CSS
- Material UI + Material Icons
- GSAP
- Node.js + Express + TypeScript
- PostgreSQL (Supabase)
- Prisma ORM
- JWT authentication
- Supabase Storage for documents and media

## Architecture

```text
apps/
  web/       React client
  api/       Express API
packages/
  database/  Prisma schema and database client
```

All tenant-owned records are scoped by `schoolId`. Super Admin is the only cross-tenant role.

## Core security rules

- Tenant isolation is enforced server-side.
- Sensitive staff changes use Principal approval workflows.
- Refresh tokens are stored as secure HttpOnly cookies.
- Access tokens are short lived while login sessions can last up to 3 days.
- Secrets belong in `.env` files and are never committed.

## Development

Copy each `.env.example` to `.env`, fill in local credentials, then install dependencies from the repository root.

```bash
npm install
npm run dev
```

## Status

Foundation development in progress.
