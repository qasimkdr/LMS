'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { homeFor, useAuth } from './auth';
import { Badge, Loading, statusTone } from './ui';
import { date, roleLabel, statusLabel } from '@/lib/format';
import type { Me } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

function navFor(me: Me): NavItem[] {
  const r = me.user.role;
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
    const items: NavItem[] = [{ href: '/school', label: 'Dashboard', icon: '◧' }];
    if (r === 'PRINCIPAL' || me.user.permissions.includes('files.manage')) items.push({ href: '/school/files', label: 'Files', icon: '▤' });
    items.push({ href: '/school/usage', label: 'Plan & usage', icon: '◔' });
    if (r === 'PRINCIPAL') items.push({ href: '/school/settings', label: 'School profile', icon: '⚙' });
    return items;
  }
  return [{ href: '/home', label: 'Home', icon: '◧' }];
}

/** Which area each role may open. */
function allowed(me: Me, path: string) {
  const r = me.user.role;
  if (path.startsWith('/admin')) return r === 'SUPER_ADMIN';
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
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-gray-200 bg-white lg:block">{sidebar}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-gray-900/40" />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <button onClick={() => setMenuOpen(true)} className="rounded-lg p-1.5 text-gray-700 hover:bg-gray-100" aria-label="Open menu">
          ☰
        </button>
        <span className="truncate text-sm font-semibold">{me.school?.name ?? 'Platform Admin'}</span>
        {me.school && (
          <span className="ml-auto">
            <Badge tone={statusTone[me.school.effectiveStatus]}>{statusLabel[me.school.effectiveStatus]}</Badge>
          </span>
        )}
      </header>
      {me.school && <SchoolBanner school={me.school} />}
      <main className="mx-auto max-w-6xl overflow-x-hidden px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
