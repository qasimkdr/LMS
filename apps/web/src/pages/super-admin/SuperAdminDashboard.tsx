import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import ArrowOutwardRoundedIcon from '@mui/icons-material/ArrowOutwardRounded';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const kpis = [
  { label: 'Active schools', value: '12', hint: '+2 this month', icon: SchoolRoundedIcon, accent: 'from-blue-500 to-cyan-400' },
  { label: 'Students', value: '8,420', hint: '+6.8%', icon: GroupsRoundedIcon, accent: 'from-violet-500 to-fuchsia-400' },
  { label: 'Monthly revenue', value: 'PKR 184K', hint: '+12.4%', icon: PaymentsRoundedIcon, accent: 'from-emerald-500 to-lime-400' },
  { label: 'Needs attention', value: '3', hint: '2 overdue · 1 trial', icon: WarningAmberRoundedIcon, accent: 'from-amber-400 to-rose-500' },
];

const trend = [
  { month: 'Apr', schools: 5, students: 3210 },
  { month: 'May', schools: 6, students: 3890 },
  { month: 'Jun', schools: 8, students: 4720 },
  { month: 'Jul', schools: 9, students: 5630 },
  { month: 'Aug', schools: 10, students: 6900 },
  { month: 'Sep', schools: 12, students: 8420 },
];

function KpiCard({ item, index }: { item: (typeof kpis)[number]; index: number }) {
  const Icon = item.icon;
  return (
    <article className="kpi-card card-3d glass-panel group rounded-[28px] p-5 transition-transform duration-300 hover:-translate-y-1" style={{ transform: `perspective(900px) rotateX(${index % 2 ? -1 : 1}deg)` }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{item.label}</p>
          <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-900">{item.value}</h3>
          <p className="mt-2 text-xs font-semibold text-slate-500">{item.hint}</p>
        </div>
        <div className={`rounded-2xl bg-gradient-to-br ${item.accent} p-3 text-white shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
          <Icon fontSize="small" />
        </div>
      </div>
    </article>
  );
}

export default function SuperAdminDashboard() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.dashboard-intro', { y: 24, opacity: 0, duration: 0.65, ease: 'power3.out' });
      gsap.from('.kpi-card', { y: 28, opacity: 0, duration: 0.6, stagger: 0.08, ease: 'power3.out', delay: 0.08 });
      gsap.from('.chart-panel', { y: 30, opacity: 0, duration: 0.7, ease: 'power3.out', delay: 0.2 });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={root} className="nexora-grid min-h-screen bg-[radial-gradient(circle_at_top_left,#eff6ff_0,#f8fbff_35%,#fff7ed_100%)] px-4 py-6 md:px-8 lg:px-10">
      <main className="mx-auto max-w-[1500px]">
        <section className="dashboard-intro glass-panel relative overflow-hidden rounded-[34px] px-6 py-7 md:px-8 md:py-9">
          <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gradient-to-br from-blue-300/35 via-violet-300/25 to-rose-300/25 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50/80 px-3 py-1 text-xs font-bold text-blue-700">NEXORA CONTROL CENTER</div>
              <h1 className="text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-5xl">Run every school from <span className="gradient-text">one intelligent LMS.</span></h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">Platform health, subscriptions, school activity and academic growth in one responsive workspace.</p>
            </div>
            <button className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-rose-500 px-5 py-3 text-sm font-extrabold text-white shadow-[0_16px_45px_rgba(79,70,229,.28)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_55px_rgba(79,70,229,.36)] active:translate-y-0">
              Add school <ArrowOutwardRoundedIcon className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" fontSize="small" />
            </button>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((item, index) => <KpiCard key={item.label} item={item} index={index} />)}
        </section>

        <section className="chart-panel glass-panel mt-6 rounded-[32px] p-5 md:p-7">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">Platform growth</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Student adoption</h2>
            </div>
            <p className="text-sm text-slate-500">Illustrative dashboard data until API analytics are connected.</p>
          </div>
          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="studentsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.42} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbeafe" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} width={48} tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 18, border: '1px solid #e2e8f0', boxShadow: '0 20px 50px rgba(15,23,42,.12)' }} />
                <Area type="monotone" dataKey="students" stroke="#6366f1" strokeWidth={3} fill="url(#studentsFill)" animationDuration={1200} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </main>
    </div>
  );
}
