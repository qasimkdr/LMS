'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

/** Bell with unread count; refreshes every minute and on page changes. */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();
  useEffect(() => {
    let alive = true;
    const load = () => api.get<{ unread: number }>('/notifications/unread-count').then((r) => alive && setUnread(r.unread)).catch(() => undefined);
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);
  return (
    <Link href="/notifications" className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" />
      </svg>
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
