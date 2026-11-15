'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { StorageAlert, UsageBars } from '@/components/UsageBars';
import { Card, ErrorBox, Loading, PageHeader, Stat } from '@/components/ui';
import type { Usage } from '@/lib/types';

interface Checklist {
  steps: { key: string; label: string; done: boolean; href: string }[];
  done: number;
  total: number;
}

const upcoming = [
  ['Timetable and teacher schedules', 'Step 3'],
  ['Fees, vouchers, collection and hand-over', 'Step 5'],
  ['Tests, exams and report cards', 'Step 6'],
  ['Online exams', 'Step 7'],
  ['Remarks, monthly reports, rankings and honors', 'Step 8'],
];

export default function SchoolDashboard() {
  const { me } = useAuth();
  const isPrincipal = me?.user.role === 'PRINCIPAL';
  const { data, error, loading } = useData<{ usage: Usage }>('/school/overview');
  const { data: checklist } = useData<Checklist>(isPrincipal ? '/setup/checklist' : null);
  const hasAttendance = (me?.school?.plan.modules ?? []).includes('attendance');
  const { data: attendance } = useData<{ percent: number | null; totals: Record<string, number>; notMarked: number }>(hasAttendance ? '/attendance/today' : null);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const allDone = checklist && checklist.done === checklist.total;

  return (
    <>
      <PageHeader title={`${greet}, ${me?.user.fullName.split(' ')[0]}`} subtitle={me?.school?.name} />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="space-y-6">
          <StorageAlert usage={data.usage} />
          {hasAttendance && attendance && (
            <Link href="/school/attendance" className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-brand-500">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Today’s attendance</div>
                  <div className="mt-1 text-2xl font-semibold">{attendance.percent === null ? 'Not marked yet' : `${attendance.percent}%`}</div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    Absent <strong className="text-red-600">{attendance.totals.ABSENT ?? 0}</strong>
                  </span>
                  <span>
                    Late <strong>{attendance.totals.LATE ?? 0}</strong>
                  </span>
                  <span className={attendance.notMarked ? 'text-amber-700' : 'text-emerald-700'}>{attendance.notMarked ? `${attendance.notMarked} class(es) not marked` : 'All classes marked'}</span>
                </div>
              </div>
            </Link>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Active students" value={data.usage.students.used} hint={data.usage.students.limit ? `of ${data.usage.students.limit} on your plan` : undefined} />
            <Stat label="Staff & teachers" value={data.usage.staff.used} hint={data.usage.staff.limit ? `of ${data.usage.staff.limit}` : undefined} />
            <Stat label="Storage used" value={`${data.usage.storage.percent}%`} />
            {checklist && <Stat label="Setup" value={`${checklist.done}/${checklist.total}`} hint={allDone ? 'Complete' : 'steps done'} />}
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            {checklist && !allDone && (
              <Card title="Set up your school" className="lg:col-span-2">
                <div className="mb-4 h-2 rounded-full bg-gray-100">
                  <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(checklist.done / checklist.total) * 100}%` }} />
                </div>
                <ol className="space-y-2">
                  {checklist.steps.map((s, i) => (
                    <li key={s.key}>
                      <Link href={s.href} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${s.done ? 'border-gray-100 text-gray-500' : 'border-gray-200 hover:border-brand-500 hover:bg-brand-50'}`}>
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                          {s.done ? '✓' : i + 1}
                        </span>
                        <span className={s.done ? 'line-through' : 'font-medium text-gray-900'}>{s.label}</span>
                        {!s.done && <span className="ml-auto text-brand-700">→</span>}
                      </Link>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
            <Card
              title="Plan usage"
              className={checklist && !allDone ? '' : 'lg:col-span-2'}
              actions={
                <Link href="/school/usage" className="text-sm font-medium text-brand-700 hover:underline">
                  Details →
                </Link>
              }
            >
              <UsageBars usage={data.usage} />
            </Card>
            {(!checklist || allDone) && (
              <Card title="Quick actions">
                <div className="grid gap-2">
                  <Link href="/school/students/new" className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-brand-500">
                    + New admission
                  </Link>
                  <Link href="/school/students" className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-brand-500">
                    Find a student
                  </Link>
                  {isPrincipal && (
                    <Link href="/school/staff/new" className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-brand-500">
                      + Add staff
                    </Link>
                  )}
                </div>
              </Card>
            )}
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
