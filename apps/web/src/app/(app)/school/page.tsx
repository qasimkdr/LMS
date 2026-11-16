'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { StorageAlert } from '@/components/UsageBars';
import { Avatar } from '@/components/Avatar';
import { AreaChart, BarChart, CountUp, Gauge, HBars, Hero, HeroAction, KpiCard, Panel, PanelLink, TodoRow } from '@/components/fx';
import { ErrorBox, Loading } from '@/components/ui';
import { CATEGORY_LABEL, categoryTone, type RemarkCategory } from '@/components/progress/Remarks';
import { Badge } from '@/components/ui';
import { date } from '@/lib/format';
import type { Usage } from '@/lib/types';

interface Dash {
  today: string;
  students: { total: number; boys: number; girls: number; newThisMonth: number };
  staff: { teachers: number; staff: number };
  classStrength: { label: string; count: number }[];
  attendanceTrend: { date: string; percent: number; absent: number }[];
  syllabus: number | null;
  top: { period: string; title: string; rows: { id: string; fullName: string; classLabel: string; photoFileId: string | null; percent: number; position: number }[] } | null;
  upcomingExams: { id: string; assessmentId: string; title: string; kind: string; date: string | null; subject: string; classLabel: string }[];
  approvals: { sheets: number; onlinePapers: number; onlineResults: number };
  complaints: { open: number; oldest: { ticketNo: number; subject: string; createdAt: string } | null; list: { id: string; ticketNo: number; subject: string; status: string; createdAt: string }[] };
  remarks: { id: string; category: RemarkCategory; text: string; date: string; student: string; studentId: string; by: string }[];
  circulars: { id: string; title: string; createdAt: string; recipients: number; reads: number }[];
  gatePassesToday: number;
}
interface Fees {
  collection: { today: number; thisMonth: number; lastMonth: number; series: { month: string; amount: number }[] };
  outstanding: number;
  studentsOverdue: number;
  pendingHandovers: number;
  currentMonth: { recovery: number | null };
}
interface Checklist {
  steps: { key: string; label: string; done: boolean; href: string }[];
  done: number;
  total: number;
}

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(Math.round(n)));
const monthShort = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const dayShort = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const medal = ['🥇', '🥈', '🥉'];

export default function SchoolDashboard() {
  const { me } = useAuth();
  const isPrincipal = me?.user.role === 'PRINCIPAL';
  const has = (k: string) => isPrincipal || Boolean(me?.user.permissions.includes(k));
  const mods = me?.school?.plan.modules ?? [];
  const { data, error, loading } = useData<Dash>('/dashboard');
  const { data: overview } = useData<{ usage: Usage }>('/school/overview');
  const { data: checklist } = useData<Checklist>(isPrincipal ? '/setup/checklist' : null);
  const feeAccess = mods.includes('fees') && has('fees.reports');
  const { data: fees } = useData<Fees>(feeAccess ? '/fees/reports/summary' : null);
  const { data: att } = useData<{ percent: number | null; totals: Record<string, number>; notMarked: number }>(mods.includes('attendance') ? '/attendance/today' : null);
  const cur = me?.school?.currency ?? 'PKR';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const monthTrend = fees && fees.collection.lastMonth ? Math.round(((fees.collection.thisMonth - fees.collection.lastMonth) / fees.collection.lastMonth) * 100) : null;
  const todo = [
    fees && fees.pendingHandovers > 0 && { href: '/school/fees', icon: '⇄', label: 'Cash hand-overs to approve', count: fees.pendingHandovers, tone: 'amber' as const },
    data.approvals.sheets > 0 && { href: '/school/exams', icon: '✎', label: 'Marks sheets to approve', count: data.approvals.sheets, tone: 'blue' as const },
    data.approvals.onlinePapers > 0 && { href: '/online-exams', icon: '⌨', label: 'Online papers waiting for approval', count: data.approvals.onlinePapers, tone: 'teal' as const },
    data.approvals.onlineResults > 0 && { href: '/online-exams', icon: '✓', label: 'Online exam results to publish', count: data.approvals.onlineResults, tone: 'emerald' as const },
    data.complaints.open > 0 && { href: '/complaints', icon: '⚑', label: 'Open complaints', count: data.complaints.open, tone: 'rose' as const },
    att && att.notMarked > 0 && { href: '/school/attendance', icon: '✓', label: 'Classes without attendance today', count: att.notMarked, tone: 'amber' as const },
  ].filter(Boolean) as { href: string; icon: string; label: string; count: number; tone: 'amber' | 'blue' | 'teal' | 'emerald' | 'rose' }[];
  const setupLeft = checklist && checklist.done < checklist.total;

  return (
    <>
      <Hero
        eyebrow={new Date(`${data.today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
        title={
          <>
            {greet}, {me?.user.fullName.split(' ')[0]} <span className="inline-block origin-[70%_70%] animate-[pop_0.6s_var(--ease-spring)_both]">👋</span>
          </>
        }
        subtitle={`Here is what is happening at ${me?.school?.name} today.`}
        aside={
          att && (
            <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur">
              <Gauge value={att.percent} size={96} stroke={9} color="#059669" />
              <div className="text-sm">
                <div className="font-semibold text-slate-900">Attendance today</div>
                <div className="text-slate-600"><span className="font-medium text-rose-600">{att.totals.ABSENT ?? 0} absent</span> · <span className="font-medium text-amber-600">{att.totals.LATE ?? 0} late</span></div>
                <div className={att.notMarked ? "text-amber-700" : "text-emerald-700"}>{att.notMarked ? `${att.notMarked} class(es) not marked` : 'All classes marked'}</div>
              </div>
            </div>
          )
        }
      >
        {has('students.manage') && <HeroAction href="/school/students/new" icon="＋">New admission</HeroAction>}
        {mods.includes('fees') && has('fees.collect') && <HeroAction href="/school/fees" icon="₨">Collect fee</HeroAction>}
        {mods.includes('attendance') && <HeroAction href="/school/attendance" icon="✓">Attendance</HeroAction>}
        {has('messages.send') && <HeroAction href="/circulars" icon="✦">Send circular</HeroAction>}
      </Hero>

      <div className="space-y-6">
        {overview && <StorageAlert usage={overview.usage} />}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard i={0} label="Students" icon="☺" tone="blue" href={has('students.view') ? '/school/students' : undefined} value={<CountUp value={data.students.total} />} hint={`${data.students.boys} boys · ${data.students.girls} girls${data.students.newThisMonth ? ` · +${data.students.newThisMonth} new` : ''}`} />
          {fees ? (
            <KpiCard i={1} label="Collected today" icon="₨" tone="emerald" href="/school/fees" value={<CountUp value={fees.collection.today} prefix={`${cur} `} />} hint={`This month ${cur} ${short(fees.collection.thisMonth)}`} trend={monthTrend} spark={fees.collection.series.slice(-7).map((s) => s.amount)} />
          ) : (
            <KpiCard i={1} label="Teachers & staff" icon="♟" tone="emerald" value={<CountUp value={data.staff.teachers + data.staff.staff} />} hint={`${data.staff.teachers} teachers · ${data.staff.staff} office staff`} />
          )}
          {fees ? (
            <KpiCard i={2} label="Outstanding dues" icon="⏳" tone="rose" href="/school/fees" value={<CountUp value={fees.outstanding} prefix={`${cur} `} />} hint={`${fees.studentsOverdue} students overdue${fees.currentMonth.recovery !== null ? ` · ${fees.currentMonth.recovery}% recovered` : ''}`} />
          ) : (
            <KpiCard i={2} label="Classes" icon="▦" tone="rose" value={<CountUp value={data.classStrength.length} />} hint="with active students" />
          )}
          <KpiCard
            i={3}
            label={data.syllabus !== null ? 'Syllabus covered' : 'Teachers'}
            icon={data.syllabus !== null ? '☷' : '♟'}
            tone="teal"
            href={data.syllabus !== null ? '/syllabus' : undefined}
            value={data.syllabus !== null ? <CountUp value={data.syllabus} decimals={1} suffix="%" /> : <CountUp value={data.staff.teachers} />}
            hint={data.syllabus !== null ? 'across all classes and subjects' : `${data.staff.staff} office staff`}
          >
            {data.syllabus !== null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full origin-left animate-grow-x rounded-full bg-teal-500" style={{ width: `${data.syllabus}%` }} />
              </div>
            )}
          </KpiCard>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {data.attendanceTrend.length > 1 ? (
            <Panel i={1} className="lg:col-span-2" title="Attendance over the last school days" action={<PanelLink href="/school/attendance">Open</PanelLink>}>
              <AreaChart data={data.attendanceTrend.map((d) => ({ label: dayShort(d.date), value: d.percent }))} max={100} format={(v) => `${v}%`} color="#059669" />
            </Panel>
          ) : fees ? (
            <Panel i={1} className="lg:col-span-2" title="Fee collection, last 7 months" action={<PanelLink href="/school/fees">Fees</PanelLink>}>
              <BarChart data={fees.collection.series.slice(-7).map((s) => ({ label: monthShort(s.month), value: s.amount }))} format={(v) => short(v)} tone="blue" />
            </Panel>
          ) : (
            <Panel i={1} className="lg:col-span-2" title="Students by class">
              <HBars data={(data.classStrength.some((c) => c.count) ? data.classStrength.filter((c) => c.count) : data.classStrength).map((c) => ({ label: c.label, value: c.count }))} />
            </Panel>
          )}
          <Panel i={2} title="Needs your attention">
            {setupLeft && (
              <Link href="/school/setup" className="mb-3 block rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100 transition hover:ring-brand-300">
                <div className="flex items-center justify-between text-sm font-medium text-brand-900">
                  Finish setting up your school
                  <span className="text-xs">
                    {checklist!.done}/{checklist!.total}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                  <div className="h-full origin-left animate-grow-x rounded-full bg-brand-500" style={{ width: `${(checklist!.done / checklist!.total) * 100}%` }} />
                </div>
                <div className="mt-2 text-xs text-brand-800">Next: {checklist!.steps.find((s) => !s.done)?.label}</div>
              </Link>
            )}
            {todo.length ? (
              <div className="-mx-2 space-y-0.5">
                {todo.map((t) => (
                  <TodoRow key={t.label} {...t} />
                ))}
              </div>
            ) : (
              !setupLeft && (
                <div className="flex flex-col items-center py-6 text-center">
                  <span className="mb-2 flex h-12 w-12 animate-pop items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-600">✓</span>
                  <p className="text-sm font-medium text-gray-800">All caught up</p>
                  <p className="text-xs text-gray-500">Nothing is waiting for you right now.</p>
                </div>
              )
            )}
          </Panel>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-3">
          {fees && data.attendanceTrend.length > 1 && (
            <Panel i={3} className="lg:col-span-2" title="Fee collection, last 7 months" action={<PanelLink href="/school/fees">Fees</PanelLink>}>
              <BarChart data={fees.collection.series.slice(-7).map((s) => ({ label: monthShort(s.month), value: s.amount }))} format={(v) => `${cur} ${short(v)}`} tone="blue" />
            </Panel>
          )}
          <Panel i={4} className={fees && data.attendanceTrend.length > 1 ? '' : 'lg:col-span-1'} title="Students by class">
            {data.classStrength.length ? <HBars data={(data.classStrength.some((c) => c.count) ? data.classStrength.filter((c) => c.count) : data.classStrength).map((c) => ({ label: c.label, value: c.count }))} /> : <p className="text-sm text-gray-500">No classes yet.</p>}
          </Panel>
          {data.top && (
            <Panel i={5} title={`Top students · ${data.top.title}`} action={<PanelLink href="/rankings">Rankings</PanelLink>}>
              {!data.top.rows.length ? (
                <p className="text-sm text-gray-500">No published results this month yet.</p>
              ) : (
                <ol className="space-y-2.5">
                  {data.top.rows.map((r, i) => (
                    <li key={r.id} className="reveal group flex items-center gap-3 rounded-xl p-1.5 transition hover:bg-gray-50" style={{ ['--i' as string]: i }}>
                      <span className="w-6 text-center text-lg">{medal[r.position - 1] ?? r.position}</span>
                      <span className="transition-transform duration-300 group-hover:scale-110">
                        <Avatar fileId={r.photoFileId} name={r.fullName} size={34} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.fullName}</span>
                        <span className="block truncate text-xs text-gray-500">{r.classLabel}</span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{r.percent}%</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}
          {data.upcomingExams.length > 0 && (
            <Panel i={6} title="Upcoming exam papers" action={<PanelLink href="/school/exams">Exams</PanelLink>}>
              <ol className="relative space-y-3 border-l-2 border-dashed border-gray-200 pl-4">
                {data.upcomingExams.slice(0, 5).map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[1.4rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500 shadow" />
                    <div className="text-xs font-semibold text-brand-700">{e.date ? dayShort(e.date) : 'Date not set'}</div>
                    <div className="text-sm font-medium">
                      {e.subject} · {e.classLabel}
                    </div>
                    <div className="text-xs text-gray-500">{e.title}</div>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
          {data.remarks.length > 0 && (
            <Panel i={7} title="Recent remarks" action={<PanelLink href="/remarks" />}>
              <ul className="space-y-3">
                {data.remarks.map((r) => (
                  <li key={r.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={categoryTone[r.category]}>{CATEGORY_LABEL[r.category]}</Badge>
                      <Link href={`/school/students/${r.studentId}?tab=progress`} className="font-medium hover:underline">
                        {r.student}
                      </Link>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-gray-600">{r.text}</p>
                    <div className="text-xs text-gray-400">
                      {r.by} · {date(r.date)}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {data.circulars.length > 0 && (
            <Panel i={8} title="Circulars read by parents" action={<PanelLink href="/circulars" />}>
              <ul className="space-y-4">
                {data.circulars.map((c) => {
                  const pct = c.recipients ? Math.round((c.reads / c.recipients) * 100) : 0;
                  return (
                    <li key={c.id}>
                      <Link href={`/circulars?id=${c.id}`} className="group block">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-medium group-hover:text-brand-700">{c.title}</span>
                          <span className="shrink-0 text-xs tabular-nums text-gray-500">
                            {c.reads}/{c.recipients}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full origin-left animate-grow-x rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
          {data.complaints.list.length > 0 && (
            <Panel i={9} title="Open complaints" action={<PanelLink href="/complaints" />}>
              <ul className="space-y-2">
                {data.complaints.list.map((c) => (
                  <li key={c.id}>
                    <Link href={`/complaints?id=${c.id}`} className="flex items-center gap-3 rounded-xl p-1.5 text-sm transition hover:bg-gray-50">
                      <span className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">#{c.ticketNo}</span>
                      <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                      <span className="text-xs text-gray-400">{date(c.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
