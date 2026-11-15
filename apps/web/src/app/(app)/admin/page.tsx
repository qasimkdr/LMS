'use client';

import Link from 'next/link';
import { useData } from '@/components/useData';
import { BarChart } from '@/components/BarChart';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Stat, statusTone } from '@/components/ui';
import { date, dateTime, money, statusLabel } from '@/lib/format';

interface Dashboard {
  schools: { total: number; byStatus: Record<string, number> };
  totalStudents: number;
  revenue: { thisMonth: number; lastMonth: number; last6Months: number; last12Months: number; sameMonthLastYear: number; series: { month: string; amount: number }[] };
  dues: { outstanding: number; overdueCount: number; overdue: { invoiceId: string; period: string; amount: number; dueDate: string; school: { id: string; name: string; status: string } }[] };
  upgradeRequests: { id: string; school: { id: string; name: string } | null; message: string | null; createdAt: string }[];
}

function change(now: number, before: number) {
  if (!before) return now ? { text: 'New this month', tone: 'up' as const } : { text: 'No change', tone: undefined };
  const pct = Math.round(((now - before) / before) * 100);
  return { text: `${pct >= 0 ? '+' : ''}${pct}% vs last month`, tone: pct >= 0 ? ('up' as const) : ('down' as const) };
}

export default function AdminDashboard() {
  const { data, error, loading } = useData<Dashboard>('/admin/dashboard');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const r = data.revenue;
  const c = change(r.thisMonth, r.lastMonth);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="All schools on your platform" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Schools" value={data.schools.total} />
        <Stat label="Active" value={data.schools.byStatus.ACTIVE} />
        <Stat label="On trial" value={data.schools.byStatus.TRIAL} />
        <Stat label="Read-only / suspended" value={data.schools.byStatus.READ_ONLY + data.schools.byStatus.SUSPENDED} />
        <Stat label="Students (all schools)" value={data.totalStudents.toLocaleString()} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-gray-900">Revenue received</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="This month" value={money(r.thisMonth)} hint={c.text} tone={c.tone} />
        <Stat label="Last month" value={money(r.lastMonth)} />
        <Stat label="Last 6 months" value={money(r.last6Months)} />
        <Stat label="Last 12 months" value={money(r.last12Months)} />
        <Stat label="Same month last year" value={money(r.sameMonthLastYear)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Monthly revenue (13 months)" className="lg:col-span-2">
          <BarChart series={r.series} format={(n) => money(n)} />
        </Card>
        <Card title="Dues">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Outstanding</div>
          <div className="mt-1 text-2xl font-semibold">{money(data.dues.outstanding)}</div>
          <div className="mt-1 text-sm text-gray-500">{data.dues.overdueCount} overdue invoice(s)</div>
          <ul className="mt-4 divide-y divide-gray-100">
            {data.dues.overdue.map((o) => (
              <li key={o.invoiceId} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/admin/schools/${o.school.id}`} className="truncate font-medium text-gray-800 hover:underline">
                  {o.school.name}
                </Link>
                <span className="text-right text-xs text-gray-500">
                  {money(o.amount)}
                  <br />
                  due {date(o.dueDate)}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/admin/invoices?status=UNPAID" className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
            View unpaid invoices →
          </Link>
        </Card>
      </div>

      <Card title="Upgrade requests from schools" className="mt-6">
        {data.upgradeRequests.length === 0 ? (
          <Empty title="No upgrade requests yet" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.upgradeRequests.map((u) => (
              <li key={u.id} className="py-2.5 text-sm">
                <div className="flex justify-between gap-2">
                  {u.school ? (
                    <Link href={`/admin/schools/${u.school.id}`} className="font-medium hover:underline">
                      {u.school.name}
                    </Link>
                  ) : (
                    <span>Unknown school</span>
                  )}
                  <span className="text-xs text-gray-500">{dateTime(u.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-gray-600">{u.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-6 text-xs text-gray-400">
        Status key: {Object.entries(statusLabel).map(([k, v]) => (
          <span key={k} className="mr-2">
            <Badge tone={statusTone[k]}>{v}</Badge>
          </span>
        ))}
      </p>
    </>
  );
}
