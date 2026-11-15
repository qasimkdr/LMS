'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { StorageAlert, UsageBars } from '@/components/UsageBars';
import { Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import type { Usage } from '@/lib/types';

const upcoming = [
  ['Classes, sections and subjects', 'Step 2'],
  ['Student enrollment form with photo and documents', 'Step 2'],
  ['Staff and teacher accounts', 'Step 2'],
  ['Timetable and teacher schedules', 'Step 3'],
  ['Attendance with WhatsApp alerts', 'Step 4'],
  ['Fees, vouchers, collection and hand-over', 'Step 5'],
  ['Tests, exams and report cards', 'Step 6'],
  ['Online exams', 'Step 7'],
];

export default function SchoolDashboard() {
  const { me } = useAuth();
  const { data, error, loading } = useData<{ usage: Usage }>('/school/overview');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader title={`${greet}, ${me?.user.fullName.split(' ')[0]}`} subtitle={me?.school?.name} />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="space-y-6">
          <StorageAlert usage={data.usage} />
          <div className="grid gap-6 lg:grid-cols-3">
            <Card
              title="Plan usage"
              className="lg:col-span-2"
              actions={
                <Link href="/school/usage" className="text-sm font-medium text-brand-700 hover:underline">
                  Details →
                </Link>
              }
            >
              <UsageBars usage={data.usage} />
            </Card>
            <Card title="Getting started">
              <ol className="space-y-3 text-sm">
                <li className="flex gap-2">
                  <span className="text-emerald-600">✓</span> Account created
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-600">✓</span> Password set
                </li>
                <li className="flex gap-2">
                  <span className="text-gray-400">○</span>
                  <Link href="/school/settings" className="text-brand-700 hover:underline">
                    Add school logo and contact details
                  </Link>
                </li>
                <li className="flex gap-2 text-gray-500">
                  <span className="text-gray-400">○</span> Set up classes and add students (coming next)
                </li>
              </ol>
            </Card>
          </div>
          <Card title="Coming soon to your school">
            <ul className="grid gap-2 sm:grid-cols-2">
              {upcoming.map(([name, step]) => (
                <li key={name} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                  <span>{name}</span>
                  <span className="text-xs text-gray-400">{step}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </>
  );
}
