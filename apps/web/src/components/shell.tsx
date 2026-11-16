'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { homeFor, useAuth } from './auth';
import { Badge, Loading, statusTone } from './ui';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { date, roleLabel, statusLabel } from '@/lib/format';
import type { Me } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

function navFor(me: Me): NavGroup[] {
  const r = me.user.role;
  const mods = me.school?.plan.modules ?? [];
  const on = (m: string) => mods.includes(m);
  const groups: NavGroup[] = [];
  const add = (title: string, items: (NavItem | false | null | undefined)[]) => {
    const list = items.filter(Boolean) as NavItem[];
    if (list.length) groups.push({ title, items: list });
  };
  if (r === 'SUPER_ADMIN') {
    add('Platform', [
      { href: '/admin', label: 'Dashboard', icon: '◧' },
      { href: '/admin/schools', label: 'Schools', icon: '⌂' },
      { href: '/admin/plans', label: 'Plans', icon: '☰' },
      { href: '/admin/invoices', label: 'Invoices', icon: '₨' },
      { href: '/admin/audit', label: 'Audit log', icon: '⎙' },
    ]);
    return groups;
  }
  if (r === 'PRINCIPAL' || r === 'STAFF') {
    const p = r === 'PRINCIPAL';
    const has = (k: string) => p || me.user.permissions.includes(k);
    add('Overview', [{ href: '/school', label: 'Dashboard', icon: '◧' }, (has('reports.view') || has('students.view') || has('fees.reports')) && { href: '/reports', label: 'Reports & exports', icon: '⇩' }]);
    add('People', [
      has('students.view') && { href: '/school/students', label: 'Students', icon: '☺' },
      has('staff.view') && { href: '/school/staff', label: 'Staff & teachers', icon: '♟' },
      (has('attendance.manage') || has('students.view')) && { href: '/gate-pass', label: 'Gate pass', icon: '⇥' },
    ]);
    add('Academics', [
      p && { href: '/school/setup', label: 'Classes & subjects', icon: '▦' },
      p && { href: '/school/assignments', label: 'Teacher assignments', icon: '⇄' },
      on('timetable') && { href: '/school/timetable', label: 'Timetable', icon: '◷' },
      on('attendance') && (has('attendance.manage') || has('students.view')) && { href: '/school/attendance', label: 'Attendance', icon: '✓' },
      on('exams') && (has('exams.manage') || has('students.view')) && { href: '/school/exams', label: 'Exams & results', icon: '✎' },
      on('online_exams') && has('exams.manage') && { href: '/online-exams', label: 'Online exams', icon: '⌨' },
      on('lms') && (has('lms.manage') || has('students.view')) && { href: '/homework', label: 'Homework / diary', icon: '✐' },
      on('lms') && (has('lms.manage') || has('students.view')) && { href: '/syllabus', label: 'Syllabus', icon: '☷' },
      on('lms') && (has('lms.manage') || has('students.view')) && { href: '/material', label: 'Study material', icon: '❐' },
    ]);
    add('Progress', [
      has('students.view') && { href: '/remarks', label: 'Remarks', icon: '✍' },
      has('reports.view') && { href: '/monthly-reports', label: 'Monthly reports', icon: '▤' },
      on('honors') && (has('exams.manage') || has('students.view')) && { href: '/rankings', label: 'Rankings', icon: '▲' },
      on('honors') && has('honors.manage') && { href: '/school/honors', label: 'Honors', icon: '★' },
      on('honors') && { href: '/honors', label: 'Honor board', icon: '♛' },
    ]);
    add('Communication', [
      has('messages.send') && { href: '/circulars', label: 'Circulars', icon: '✦' },
      on('parent_messaging') && p && { href: '/conversations', label: 'Parent messages', icon: '✉' },
      on('parent_messaging') && (p || has('students.manage')) && { href: '/complaints', label: 'Complaints', icon: '⚑' },
      on('class_chat') && p && { href: '/chat', label: 'Class chat', icon: '❝' },
      has('messages.send') && { href: '/school/messages', label: 'WhatsApp messages', icon: '☏' },
      on('gallery') && { href: '/gallery', label: 'Gallery', icon: '▣' },
      on('lms') && { href: '/documents', label: 'School documents', icon: '⎘' },
    ]);
    add('Finance', [on('fees') && (has('fees.collect') || has('fees.manage') || has('fees.reports')) && { href: '/school/fees', label: 'Fees', icon: '₨' }]);
    add('Settings', [
      p && on('whatsapp') && { href: '/school/whatsapp', label: 'WhatsApp settings', icon: '⚙' },
      has('files.manage') && { href: '/school/files', label: 'Files', icon: '▤' },
      { href: '/school/usage', label: 'Plan & usage', icon: '◔' },
      p && { href: '/school/settings', label: 'School profile', icon: '⌂' },
      p && { href: '/school/recycle-bin', label: 'Recycle bin', icon: '♻' },
    ]);
    return groups;
  }
  const teacher = r === 'TEACHER';
  add('Overview', [{ href: '/home', label: 'Home', icon: '◧' }, { href: '/notifications', label: 'Notifications', icon: '◉' }]);
  if (teacher) {
    add('Teaching', [
      on('timetable') && { href: '/home/timetable', label: 'My timetable', icon: '◷' },
      on('attendance') && { href: '/home/attendance', label: 'Attendance', icon: '✓' },
      on('exams') && { href: '/home/marks', label: 'Tests & marks', icon: '✎' },
      on('online_exams') && { href: '/online-exams', label: 'Online exams', icon: '⌨' },
      on('lms') && { href: '/homework', label: 'Homework / diary', icon: '✐' },
      on('lms') && { href: '/syllabus', label: 'Syllabus', icon: '☷' },
      on('lms') && { href: '/material', label: 'Study material', icon: '❐' },
    ]);
    add('Students', [
      { href: '/remarks', label: 'Remarks', icon: '✍' },
      { href: '/monthly-reports', label: 'Monthly reports', icon: '▤' },
      on('honors') && { href: '/rankings', label: 'Rankings', icon: '▲' },
      { href: '/gate-pass', label: 'Gate pass', icon: '⇥' },
    ]);
    add('Communication', [
      on('class_chat') && { href: '/chat', label: 'Class chat', icon: '❝' },
      on('parent_messaging') && { href: '/conversations', label: 'Parent messages', icon: '✉' },
      { href: '/circulars', label: 'Circulars', icon: '✦' },
      on('gallery') && { href: '/gallery', label: 'Gallery', icon: '▣' },
      on('honors') && { href: '/honors', label: 'Honor board', icon: '♛' },
      on('lms') && { href: '/documents', label: 'School documents', icon: '⎘' },
    ]);
    return groups;
  }
  const parent = r === 'PARENT';
  add('Learning', [
    on('timetable') && { href: '/home/timetable', label: 'Timetable', icon: '◷' },
    on('attendance') && { href: '/home/attendance', label: 'Attendance', icon: '✓' },
    on('exams') && { href: '/home/results', label: 'Results', icon: '✎' },
    on('online_exams') && !parent && { href: '/home/online-exams', label: 'Online exams', icon: '⌨' },
    on('lms') && { href: '/home/homework', label: 'Homework / diary', icon: '✐' },
    on('lms') && { href: '/home/syllabus', label: 'Syllabus', icon: '☷' },
    on('lms') && { href: '/home/material', label: 'Study material', icon: '❐' },
  ]);
  add('Progress', [{ href: '/home/remarks', label: 'Remarks', icon: '✍' }, { href: '/home/reports', label: 'Monthly reports', icon: '▤' }, on('honors') && { href: '/honors', label: 'Honor board', icon: '♛' }]);
  add('School', [
    on('fees') && { href: '/home/fees', label: 'Fees', icon: '₨' },
    { href: '/circulars', label: 'Circulars', icon: '✦' },
    on('parent_messaging') && parent && { href: '/conversations', label: 'Message a teacher', icon: '✉' },
    on('parent_messaging') && parent && { href: '/complaints', label: 'Complaints', icon: '⚑' },
    on('class_chat') && !parent && { href: '/chat', label: 'Class chat', icon: '❝' },
    on('gallery') && { href: '/gallery', label: 'Gallery', icon: '▣' },
    parent && { href: '/gate-pass', label: 'Gate passes', icon: '⇥' },
    on('lms') && { href: '/documents', label: 'School documents', icon: '⎘' },
  ]);
  return groups;
}

/** Which area each role may open. */
function allowed(me: Me, path: string) {
  const r = me.user.role;
  if (path.startsWith('/admin')) return r === 'SUPER_ADMIN';
  // Teachers may open the profile of a student in their classes (the API checks the section).
  if (r === 'TEACHER' && /^\/school\/students\/(?!new$|import$|blank-form$)[^/]+$/.test(path)) return true;
  if (path.startsWith('/school')) return r === 'PRINCIPAL' || r === 'STAFF';
  return true;
}

function SchoolBanner({ school }: { school: NonNullable<Me['school']> }) {
  if (school.effectiveStatus === 'READ_ONLY') {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
        {school.status === 'TRIAL' ? 'Your free trial has ended.' : 'Your subscription payment is overdue.'} The account is read-only: you can view
        everything but cannot make changes. Please contact support.
      </div>
    );
  }
  if (school.effectiveStatus === 'TRIAL' && school.trialEndsAt) {
    return <div className="border-b border-brand-100 bg-gradient-to-r from-brand-50 via-indigo-50 to-violet-50 px-4 py-2 text-center text-sm text-brand-900">Free trial ends on {date(school.trialEndsAt)}.</div>;
  }
  return null;
}

export function Shell({ children }: { children: ReactNode }) {
  const { me, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!me) router.replace('/login');
    else if (me.user.mustChangePassword) router.replace('/change-password');
    else if (!allowed(me, pathname)) router.replace(homeFor(me.user.role));
  }, [me, loading, pathname, router]);

  useEffect(() => setMenuOpen(false), [pathname]);

  if (loading || !me || me.user.mustChangePassword || !allowed(me, pathname))
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Loading />
      </div>
    );

  if (me.school?.effectiveStatus === 'SUSPENDED') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md animate-scale-in rounded-3xl border border-red-200 bg-white p-6 text-center shadow-xl">
          <h1 className="text-lg font-semibold text-gray-900">{me.school.name} is suspended</h1>
          <p className="mt-2 text-sm text-gray-600">Access to this school account is paused. Please contact support to reactivate it.</p>
          <button onClick={logout} className="mt-4 text-sm font-medium text-brand-700 hover:underline">
            Log out
          </button>
        </div>
      </main>
    );
  }

  const nav = navFor(me);
  const showSearch =
    me.user.role === 'PRINCIPAL' || (me.user.role === 'STAFF' && (me.user.permissions.includes('students.view') || me.user.permissions.includes('staff.view')));
  const isActive = (href: string) => (href === '/admin' || href === '/school' || href === '/home' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const initial = (me.school?.name ?? 'P').trim().charAt(0).toUpperCase();
  const sidebar = <Sidebar nav={nav} isActive={isActive} me={me} initial={initial} onLogout={logout} />;

  return (
    <div className="min-h-screen lg:pl-64 print:pl-0">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block print:hidden">{sidebar}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 animate-fade-in bg-gray-950/50 backdrop-blur-sm" />
          <aside className="absolute inset-y-0 left-0 w-72 animate-slide-in shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200/70 bg-white/75 px-4 py-3 backdrop-blur-xl lg:hidden print:hidden">
        <button onClick={() => setMenuOpen(true)} className="rounded-xl p-1.5 text-gray-700 transition hover:bg-gray-100 active:scale-90" aria-label="Open menu">
          ☰
        </button>
        <span className="truncate text-sm font-semibold">{me.school?.name ?? 'Platform Admin'}</span>
        {me.school && (
          <span className="ml-auto flex items-center gap-2">
            <Badge tone={statusTone[me.school.effectiveStatus]}>{statusLabel[me.school.effectiveStatus]}</Badge>
            <NotificationBell />
          </span>
        )}
      </header>
      {me.school && (
        <div className="print:hidden">
          <SchoolBanner school={me.school} />
        </div>
      )}
      {me.school && (
        <div className={`border-b border-gray-200/70 bg-white/70 px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:sticky lg:top-0 lg:z-20 lg:px-8 print:hidden ${showSearch ? '' : 'hidden lg:block'}`}>
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            {showSearch ? <GlobalSearch /> : <span className="flex-1" />}
            <span className="ml-auto hidden lg:inline-flex">
              <NotificationBell />
            </span>
          </div>
        </div>
      )}
      <main key={pathname} className="mx-auto max-w-7xl animate-fade-in overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}

/** Dark sidebar with collapsible groups and an animated active item. */
function Sidebar({ nav, isActive, me, initial, onLogout }: { nav: NavGroup[]; isActive: (h: string) => boolean; me: Me; initial: string; onLogout: () => void }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      setClosed(JSON.parse(localStorage.getItem('nav-closed') ?? '{}'));
    } catch {
      /* private mode: start with everything open */
    }
  }, []);
  const toggle = (t: string) => {
    const n = { ...closed, [t]: !closed[t] };
    setClosed(n);
    try {
      localStorage.setItem('nav-closed', JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };
  const initials = me.user.fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <nav className="relative flex h-full flex-col overflow-hidden bg-ink-950 text-white">
      <div aria-hidden className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-brand-600/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-20 h-64 w-64 rounded-full bg-violet-600/25 blur-3xl" />
      <div className="relative flex items-center gap-3 px-4 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 via-indigo-500 to-violet-600 text-base font-bold shadow-lg shadow-brand-600/40 ring-1 ring-white/20">{initial}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{me.school?.name ?? 'Platform Admin'}</div>
          <div className="text-xs text-white/50">{roleLabel[me.user.role]}</div>
        </div>
      </div>
      <div className="relative flex-1 space-y-4 overflow-y-auto px-3 pb-4 [scrollbar-color:rgb(255_255_255/0.15)_transparent] [scrollbar-width:thin]">
        {nav.map((g) => {
          const hasActive = g.items.some((n) => isActive(n.href));
          const open = hasActive || !closed[g.title] || nav.length === 1;
          return (
            <div key={g.title}>
              {nav.length > 1 && (
                <button onClick={() => toggle(g.title)} aria-expanded={open} className="flex w-full items-center justify-between px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35 transition hover:text-white/70">
                  {g.title}
                  <span className={`transition-transform duration-300 ${open ? '' : '-rotate-90'}`} aria-hidden>
                    ▾
                  </span>
                </button>
              )}
              <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-out-soft)] ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <ul className="space-y-0.5 overflow-hidden">
                  {g.items.map((n) => {
                    const active = isActive(n.href);
                    return (
                      <li key={n.href}>
                        <Link
                          href={n.href}
                          tabIndex={open ? 0 : -1}
                          className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition duration-200 ease-[var(--ease-out-soft)] active:scale-[0.98] ${
                            active ? 'bg-white/[0.09] font-medium text-white' : 'text-white/65 hover:translate-x-0.5 hover:bg-white/[0.05] hover:text-white'
                          }`}
                        >
                          <span className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-300 to-violet-400 transition-all duration-300 ${active ? 'opacity-100' : 'scale-y-0 opacity-0'}`} aria-hidden />
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[13px] transition duration-300 ${active ? 'bg-gradient-to-br from-brand-400 to-violet-500 text-white shadow-md shadow-brand-500/40' : 'text-white/55 group-hover:text-white'}`} aria-hidden>
                            {n.icon}
                          </span>
                          <span className="truncate">{n.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
      <div className="relative border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">{initials}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{me.user.fullName}</div>
            <div className="truncate text-xs text-white/45">@{me.user.username}</div>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <Link href="/change-password" className="flex-1 rounded-lg px-2 py-1.5 text-center text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white">
            Password
          </Link>
          <button onClick={onLogout} className="flex-1 rounded-lg px-2 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white">
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}
