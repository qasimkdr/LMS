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
      on('admissions') && has('admissions.manage') && { href: '/admissions', label: 'Admissions', icon: '✚' },
      has('staff.view') && { href: '/school/staff', label: 'Staff & teachers', icon: '♟' },
      (has('attendance.manage') || has('students.view')) && { href: '/gate-pass', label: 'Gate pass', icon: '⇥' },
      has('students.view') && { href: '/withdrawals', label: 'Leaving & certificates', icon: '⎋' },
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
      p && { href: '/school/session-close', label: 'Close session', icon: '↻' },
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
    return <div className="border-b border-sky-100 bg-sky-50/80 px-4 py-2 text-center text-sm text-sky-900">Free trial ends on {date(school.trialEndsAt)}.</div>;
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
          <aside className="absolute inset-y-0 left-0 w-72 animate-slide-in bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
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

/**
 * Each sidebar section has its own colour; the open page is highlighted in its section's colour,
 * so people always see which part of the app they are in.
 */
const SECTION: Record<string, { dot: string; active: string; chip: string; bar: string; icon: string }> = {
  blue: { dot: 'bg-blue-500', active: 'bg-blue-50 text-blue-800 ring-blue-100', chip: 'bg-blue-600 text-white shadow-blue-600/30', bar: 'bg-blue-600', icon: 'text-blue-500' },
  sky: { dot: 'bg-sky-500', active: 'bg-sky-50 text-sky-800 ring-sky-100', chip: 'bg-sky-600 text-white shadow-sky-600/30', bar: 'bg-sky-600', icon: 'text-sky-500' },
  emerald: { dot: 'bg-emerald-500', active: 'bg-emerald-50 text-emerald-800 ring-emerald-100', chip: 'bg-emerald-600 text-white shadow-emerald-600/30', bar: 'bg-emerald-600', icon: 'text-emerald-500' },
  amber: { dot: 'bg-amber-500', active: 'bg-amber-50 text-amber-900 ring-amber-100', chip: 'bg-amber-500 text-white shadow-amber-500/30', bar: 'bg-amber-500', icon: 'text-amber-500' },
  rose: { dot: 'bg-rose-500', active: 'bg-rose-50 text-rose-800 ring-rose-100', chip: 'bg-rose-600 text-white shadow-rose-600/30', bar: 'bg-rose-600', icon: 'text-rose-500' },
  teal: { dot: 'bg-teal-500', active: 'bg-teal-50 text-teal-800 ring-teal-100', chip: 'bg-teal-600 text-white shadow-teal-600/30', bar: 'bg-teal-600', icon: 'text-teal-500' },
  slate: { dot: 'bg-slate-400', active: 'bg-slate-100 text-slate-900 ring-slate-200', chip: 'bg-slate-700 text-white shadow-slate-700/30', bar: 'bg-slate-700', icon: 'text-slate-500' },
};
const GROUP_COLOR: Record<string, keyof typeof SECTION> = {
  Platform: 'blue',
  Overview: 'blue',
  People: 'sky',
  Students: 'sky',
  Academics: 'emerald',
  Teaching: 'emerald',
  Learning: 'emerald',
  Progress: 'amber',
  Communication: 'rose',
  School: 'rose',
  Finance: 'teal',
  Settings: 'slate',
};

/** Light frosted sidebar with collapsible, colour-coded sections. */
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
    <nav className="relative flex h-full flex-col border-r border-slate-200/80 bg-white/80 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-base font-bold text-white shadow-sm">{initial}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{me.school?.name ?? 'Platform Admin'}</div>
          <div className="text-xs text-slate-500">{roleLabel[me.user.role]}</div>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-4 [scrollbar-color:rgb(148_163_184/0.4)_transparent] [scrollbar-width:thin]">
        {nav.map((g) => {
          const c = SECTION[GROUP_COLOR[g.title] ?? 'slate'];
          const hasActive = g.items.some((n) => isActive(n.href));
          const open = hasActive || !closed[g.title] || nav.length === 1;
          return (
            <div key={g.title}>
              {nav.length > 1 && (
                <button onClick={() => toggle(g.title)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-slate-600">
                  <span className={`h-1.5 w-1.5 rounded-full ${c.dot} ${hasActive ? '' : 'opacity-60'}`} aria-hidden />
                  <span className="flex-1 text-left">{g.title}</span>
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
                          aria-current={active ? 'page' : undefined}
                          className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition duration-200 ease-[var(--ease-out-soft)] active:scale-[0.98] ${
                            active ? `font-semibold ring-1 ${c.active}` : 'text-slate-600 hover:translate-x-0.5 hover:bg-slate-100/80 hover:text-slate-900'
                          }`}
                        >
                          <span className={`absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full transition-all duration-300 ${c.bar} ${active ? 'opacity-100' : 'scale-y-0 opacity-0'}`} aria-hidden />
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[13px] transition duration-300 ${active ? `shadow-md ${c.chip}` : `${c.icon} opacity-80 group-hover:opacity-100`}`} aria-hidden>
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
      <div className="border-t border-slate-200/80 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{initials}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900">{me.user.fullName}</div>
            <div className="truncate text-xs text-slate-500">@{me.user.username}</div>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <Link href="/change-password" className="flex-1 rounded-lg px-2 py-1.5 text-center text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
            Password
          </Link>
          <button onClick={onLogout} className="flex-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}
