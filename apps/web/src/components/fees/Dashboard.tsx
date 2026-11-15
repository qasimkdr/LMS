'use client';

import Link from 'next/link';
import { useData } from '../useData';
import { BarChart } from '../BarChart';
import { Card, ErrorBox, Loading, Stat } from '../ui';
import { methodLabel, useMoney } from './shared';

interface Summary {
  collection: { today: number; thisMonth: number; lastMonth: number; last6Months: number; last12Months: number; sameMonthLastYear: number; series: { month: string; amount: number }[]; byMethod: Record<string, number>; byCollector: { id: string; name: string; amount: number }[] };
  outstanding: number;
  studentsOverdue: number;
  currentMonth: { period: string; vouchers: number; expected: number; collected: number; recovery: number | null };
  pendingHandovers: number;
  pendingCancellations: number;
}

export function FeeDashboard() {
  const money = useMoney();
  const { data, error, loading } = useData<Summary>('/fees/reports/summary');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const c = data.collection;
  const change = c.lastMonth ? Math.round(((c.thisMonth - c.lastMonth) / c.lastMonth) * 100) : null;
  return (
    <div className="space-y-6">
      {(data.pendingHandovers > 0 || data.pendingCancellations > 0) && (
        <Link href="/school/fees?tab=handover" className="block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:border-amber-400">
          {data.pendingHandovers > 0 && `${data.pendingHandovers} hand-over(s) waiting for your approval. `}
          {data.pendingCancellations > 0 && `${data.pendingCancellations} receipt cancellation request(s). `}
          Review →
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected today" value={money(c.today)} />
        <Stat label="Outstanding dues" value={money(data.outstanding)} hint={`${data.studentsOverdue} students overdue`} tone={data.studentsOverdue ? 'down' : undefined} />
        <Stat
          label={`Recovery ${new Date(`${data.currentMonth.period}-01`).toLocaleDateString('en-GB', { month: 'short' })}`}
          value={data.currentMonth.recovery === null ? '—' : `${data.currentMonth.recovery}%`}
          hint={`${money(data.currentMonth.collected)} of ${money(data.currentMonth.expected)}`}
        />
        <Stat label="Vouchers this month" value={data.currentMonth.vouchers} />
      </div>
      <h2 className="text-sm font-semibold text-gray-900">Collection</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="This month" value={money(c.thisMonth)} hint={change === null ? undefined : `${change >= 0 ? '+' : ''}${change}% vs last month`} tone={change === null ? undefined : change >= 0 ? 'up' : 'down'} />
        <Stat label="Last month" value={money(c.lastMonth)} />
        <Stat label="Last 6 months" value={money(c.last6Months)} />
        <Stat label="Last 12 months" value={money(c.last12Months)} />
        <Stat label="Same month last year" value={money(c.sameMonthLastYear)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Monthly collection (13 months)" className="lg:col-span-2">
          <BarChart series={c.series} format={(n) => money(n)} />
        </Card>
        <Card title="This month by">
          <div className="text-xs font-semibold uppercase text-gray-500">Method</div>
          <ul className="mt-1 space-y-1 text-sm">
            {Object.entries(c.byMethod).length === 0 && <li className="text-gray-500">Nothing yet</li>}
            {Object.entries(c.byMethod).map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span>{methodLabel[k] ?? k}</span>
                <span className="font-medium">{money(v)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 text-xs font-semibold uppercase text-gray-500">Collected by</div>
          <ul className="mt-1 space-y-1 text-sm">
            {c.byCollector.map((x) => (
              <li key={x.id} className="flex justify-between">
                <span>{x.name}</span>
                <span className="font-medium">{money(x.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
