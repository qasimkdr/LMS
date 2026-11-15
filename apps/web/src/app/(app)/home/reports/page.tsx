'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { monthName, type ReportSummary } from '@/components/progress/StudentProgress';
import { money } from '@/lib/format';

export default function FamilyReportsPage() {
  const { me } = useAuth();
  const { data, error, loading } = useData<{ children: { student: { id: string; fullName: string }; reports: ReportSummary[] }[] }>('/monthly-reports/my');
  const [idx, setIdx] = useState(0);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const child = data?.children[idx];
  if (!child) return <Empty title="No reports yet" />;
  return (
    <>
      <PageHeader title="Monthly reports" subtitle={child.student.fullName} />
      {data!.children.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data!.children.map((c, i) => (
            <Button key={c.student.id} variant={i === idx ? 'primary' : 'secondary'} onClick={() => setIdx(i)}>
              {c.student.fullName}
            </Button>
          ))}
        </div>
      )}
      {!child.reports.length ? (
        <Empty title="No monthly reports yet">The school sends a report at the start of every month.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {child.reports.map((r) => (
            <Link key={r.id} href={`/monthly-reports/${r.id}`}>
              <Card className="h-full transition hover:border-brand-300 hover:shadow">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{monthName(r.period ?? '')}</div>
                  {r.honors > 0 && <span title="Honor">🏅</span>}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div>
                    <dt className="text-xs text-gray-500">Attendance</dt>
                    <dd className="font-semibold">{r.attendance === null ? '—' : `${r.attendance}%`}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Tests</dt>
                    <dd className="font-semibold">{r.average === null ? '—' : `${r.average}%`}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Fee due</dt>
                    <dd className="font-semibold">{r.balance === null ? '—' : r.balance > 0 ? money(r.balance, me?.school?.currency) : 'Clear'}</dd>
                  </div>
                </dl>
                <div className="mt-3 text-sm text-brand-700">Open report →</div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
