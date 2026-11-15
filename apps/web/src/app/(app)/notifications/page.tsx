'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';

interface N {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const icon: Record<string, string> = { ABSENT: '⚠', LATE: '⏰', MANUAL: '✉' };

export default function NotificationsPage() {
  const { data, error, loading, reload } = useData<{ notifications: N[]; unread: number }>('/notifications');
  async function markAll() {
    await api.post('/notifications/read', { all: true });
    reload();
  }
  async function markOne(id: string) {
    await api.post('/notifications/read', { ids: [id] });
    reload();
  }
  return (
    <>
      <PageHeader title="Notifications" subtitle={data ? `${data.unread} unread` : undefined} actions={data?.unread ? <Button variant="secondary" onClick={markAll}>Mark all as read</Button> : undefined} />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : !data?.notifications.length ? (
        <Empty title="No notifications yet" />
      ) : (
        <Card>
          <ul className="-my-2 divide-y divide-gray-100">
            {data.notifications.map((n) => {
              const inner = (
                <div className="flex gap-3 py-3">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${n.readAt ? 'bg-gray-100 text-gray-500' : 'bg-brand-100 text-brand-700'}`} aria-hidden>
                    {icon[n.type] ?? '•'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${n.readAt ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>{n.title}</div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-600">{n.body}</p>
                    <div className="mt-1 text-xs text-gray-400">{dateTime(n.createdAt)}</div>
                  </div>
                  {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                </div>
              );
              return (
                <li key={n.id} onClick={() => !n.readAt && markOne(n.id)} className="cursor-default">
                  {n.link ? <Link href={n.link}>{inner}</Link> : inner}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
