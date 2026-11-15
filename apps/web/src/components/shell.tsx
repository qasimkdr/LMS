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

function navFor(me: Me): NavItem[] {
  const r = me.user.role;
  const mods = me.school?.plan.modules ?? [];
  if (r === 'SUPER_ADMIN') {
    return [
      { href: '/admin', label: 'Dashboard', icon: '◧' },
      { href: '/admin/schools', label: 'Schools', icon: '⌂' },
      { href: '/admin/plans', label: 'Plans', icon: '☰' },
      { href: '/admin/invoices', label: 'Invoices', icon: '₨' },
      { href: '/admin/audit', label: 'Audit log', icon: '⎙' },
    ];
  }
  if (r === 'PRINCIPAL' || r === 'STAFF') {
    const p = r === 'PRINCIPAL';
    const has = (k: string) => p || me.user.permissions.includes(k);
    const items: NavItem[] = [{ href: '/school', label: 'Dashboard', icon: '◧' }];
    if (has('students.view')) items.push({ href: '/school/students', label: 'Students', icon: '☺' });
    if (has('staff.view')) items.push({ href: '/school/staff', label: 'Staff & teachers', icon: '♟' });
    if (p) items.push({ href: '/school/setup', label: 'Classes & subjects', icon: '▦' }, { href: '/school/assignments', label: 'Teacher assignments', icon: '⇄' });
    if (mods.includes('timetable')) items.push({ href: '/school/timetable', label: 'Timetable', icon: '◷' });
    if (mods.includes('attendance') && (has('attendance.manage') || has('students.view'))) items.push({ href: '/school/attendance', label: 'Attendance', icon: '✓' });
    if (mods.includes('exams') && (has('exams.manage') || has('students.view'))) items.push({ href: '/school/exams', label: 'Exams & results', icon: '✎' });
    if (mods.includes('online_exams') && has('exams.manage')) items.push({ href: '/online-exams', label: 'Online exams', icon: '⌨' });
    if (has('students.view')) items.push({ href: '/remarks', label: 'Remarks', icon: '✍' });
    if (has('reports.view')) items.push({ href: '/monthly-reports', label: 'Monthly reports', icon: '▤' });
    if (mods.includes('honors') && (has('exams.manage') || has('students.view'))) items.push({ href: '/rankings', label: 'Rankings', icon: '▲' });
    if (mods.includes('honors') && has('honors.manage')) items.push({ href: '/school/honors', label: 'Honors', icon: '★' });
    if (mods.includes('honors')) items.push({ href: '/honors', label: 'Honor board', icon: '♛' });
    if (mods.includes('fees') && (has('fees.collect') || has('fees.manage') || has('fees.reports'))) items.push({ href: '/school/fees', label: 'Fees', icon: '₨' });
    if (has('messages.send')) items.push({ href: '/school/messages', label: 'Messages', icon: '✉' });
    if (p && mods.includes('whatsapp')) items.push({ href: '/school/whatsapp', label: 'WhatsApp settings', icon: '☏' });
    if (has('files.manage')) items.push({ href: '/school/files', label: 'Files', icon: '▤' });
    items.push({ href: '/school/usage', label: 'Plan & usage', icon: '◔' });
    if (p) items.push({ href: '/school/settings', label: 'School profile', icon: '⚙' }, { href: '/school/recycle-bin', label: 'Recycle bin', icon: '♻' });
    return items;
  }
  const items: NavItem[] = [{ href: '/home', label: 'Home', icon: '◧' }];
  if (mods.includes('timetable')) items.push({ href: '/home/timetable', label: r === 'TEACHER' ? 'My timetable' : 'Timetable', icon: '◷' });
  if (mods.includes('attendance')) items.push({ href: '/home/attendance', label: 'Attendance', icon: '✓' });
  if (mods.includes('exams')) items.push(r === 'TEACHER' ? { href: '/home/marks', label: 'Tests & marks', icon: '✎' } : { href: '/home/results', label: 'Results', icon: '✎' });
  if (mods.includes('online_exams') && r === 'TEACHER') items.push({ href: '/online-exams', label: 'Online exams', icon: '⌨' });
  if (mods.includes('online_exams') && r === 'STUDENT') items.push({ href: '/home/online-exams', label: 'Online exams', icon: '⌨' });
  if (r === 'TEACHER') items.push({ href: '/remarks', label: 'Remarks', icon: '✍' }, { href: '/monthly-reports', label: 'Monthly reports', icon: '▤' });
  else items.push({ href: '/home/remarks', label: 'Remarks', icon: '✍' }, { href: '/home/reports', label: 'Monthly reports', icon: '▤' });
  if (mods.includes('honors') && r === 'TEACHER') items.push({ href: '/rankings', label: 'Rankings', icon: '▲' });
  if (mods.includes('honors')) items.push({ href: '/honors', label: 'Honor board', icon: '♛' });
  if (mods.includes('fees') && (r === 'PARENT' || r === 'STUDENT')) items.push({ href: '/home/fees', label: 'Fees', icon: '₨' });
  items.push({ href: '/notifications', label: 'Notifications', icon: '◉' });
  return items;
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
    return (
      <div className="border-b border-brand-100 bg-brand-50 px-4 py-2 text-center text-sm text-brand-900">
        Free trial ends on {date(school.trialEndsAt)}.
      </div>
    );
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

  if (loading || !me || me.user.mustChangePassword || !allowed(me, pathname)) return <Loading />;

  if (me.school?.effectiveStatus === 'SUSPENDED') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
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
  const isActive = (href: string) => (href === '/admin' || href === '/school' || href === '/home' ? pathname === href : pathname.startsWith(href));

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">S</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">{me.school?.name ?? 'Platform Admin'}</div>
          <div className="text-xs text-gray-500">{roleLabel[me.user.role]}</div>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-2">
        {nav.map((n) => (
          <li key={n.href}>
            <Link
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive(n.href) ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="w-4 text-center opacity-70" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-100 p-3">
        <div className="truncate px-1 text-sm font-medium text-gray-900">{me.user.fullName}</div>
        <div className="truncate px-1 text-xs text-gray-500">@{me.user.username}</div>
        <div className="mt-2 flex gap-2">
          <Link href="/change-password" className="flex-1 rounded-lg px-2 py-1.5 text-center text-xs font-medium text-gray-600 hover:bg-gray-100">
            Password
          </Link>
          <button onClick={logout} className="flex-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
            Log out
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-60 print:pl-0">
      <aside className="fixed inset-y-0 left-0 hidden w-60 overflow-y-auto border-r border-gray-200 bg-white lg:block print:hidden">{sidebar}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-gray-900/40" />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden print:hidden">
        <button onClick={() => setMenuOpen(true)} className="rounded-lg p-1.5 text-gray-700 hover:bg-gray-100" aria-label="Open menu">
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
        <div className={`border-b border-gray-200 bg-white px-4 py-2.5 sm:px-6 print:hidden ${showSearch ? '' : 'hidden lg:block'}`}>
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            {showSearch ? <GlobalSearch /> : <span className="flex-1" />}
            <span className="ml-auto hidden lg:inline-flex">
              <NotificationBell />
            </span>
          </div>
        </div>
      )}
      <main className="mx-auto max-w-6xl overflow-x-hidden px-4 py-6 sm:px-6 lg:py-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
