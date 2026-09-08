import { useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import ArrowOutwardRoundedIcon from '@mui/icons-material/ArrowOutwardRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import { Skeleton } from '@mui/material';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';

type DashboardData = {
  metrics: { schools: number; activeSchools: number; students: number; teachers: number; users: number; attentionSchools: number; newSchools: number };
  trend: Array<{ month: string; schools: number }>;
};

function KpiCard({ label, value, hint, icon: Icon, accent }: { label: string; value: string; hint: string; icon: typeof SchoolRoundedIcon; accent: string }) {
  return (
    <article className="kpi-card card-3d glass-panel group rounded-[28px] p-5 transition-transform duration-300 hover:-translate-y-1">
      <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-slate-500">{label}</p><h3 className="mt-2 text-3xl font-black tracking-tight text-slate-900">{value}</h3><p className="mt-2 text-xs font-semibold text-slate-500">{hint}</p></div><div className={`rounded-2xl bg-gradient-to-br ${accent} p-3 text-white shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}><Icon fontSize="small" /></div></div>
    </article>
  );
}

export default function SuperAdminDashboard() {
  const root = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<DashboardData>('/super-admin/dashboard').then(({ data }) => setData(data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    const ctx = gsap.context(() => {
      gsap.from('.dashboard-intro', { y: 24, opacity: 0, duration: 0.65, ease: 'power3.out' });
      gsap.from('.kpi-card', { y: 28, opacity: 0, duration: 0.6, stagger: 0.08, ease: 'power3.out', delay: 0.08 });
      gsap.from('.chart-panel', { y: 30, opacity: 0, duration: 0.7, ease: 'power3.out', delay: 0.2 });
    }, root);
    return () => ctx.revert();
  }, [loading]);

  const kpis = useMemo(() => data ? [
    { label: 'Active schools', value: String(data.metrics.activeSchools), hint: `${data.metrics.newSchools} new this month`, icon: SchoolRoundedIcon, accent: 'from-blue-500 to-cyan-400' },
    { label: 'Students', value: data.metrics.students.toLocaleString(), hint: `${data.metrics.teachers.toLocaleString()} teachers`, icon: GroupsRoundedIcon, accent: 'from-violet-500 to-fuchsia-400' },
    { label: 'Platform users', value: data.metrics.users.toLocaleString(), hint: `${data.metrics.schools} total schools`, icon: PaymentsRoundedIcon, accent: 'from-emerald-500 to-lime-400' },
    { label: 'Needs attention', value: String(data.metrics.attentionSchools), hint: 'Trial, grace, read-only or suspended', icon: WarningAmberRoundedIcon, accent: 'from-amber-400 to-rose-500' },
  ] : [], [data]);

  return (
    <div ref={root} className="nexora-grid min-h-screen bg-[radial-gradient(circle_at_top_left,#eff6ff_0,#f8fbff_35%,#fff7ed_100%)] px-4 py-6 md:px-8 lg:px-10">
      <main className="mx-auto max-w-[1500px]">
        <section className="dashboard-intro glass-panel relative overflow-hidden rounded-[34px] px-6 py-7 md:px-8 md:py-9">
          <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gradient-to-br from-blue-300/35 via-violet-300/25 to-rose-300/25 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"><div><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50/80 px-3 py-1 text-xs font-bold text-blue-700">NEXORA CONTROL CENTER</div><h1 className="text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-5xl">Run every school from <span className="gradient-text">one intelligent LMS.</span></h1><p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">Platform health, subscriptions, school activity and academic growth in one responsive workspace.</p></div><div className="flex flex-wrap gap-3"><Link to="/support" className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-extrabold text-white shadow-lg transition-all duration-300 hover:-translate-y-1"><SupportAgentRoundedIcon fontSize="small"/>Support center</Link><Link to="/super-admin/plans" className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-5 py-3 text-sm font-extrabold text-white shadow-lg transition-all duration-300 hover:-translate-y-1"><CreditCardRoundedIcon fontSize="small"/>Plans</Link><Link to="/super-admin/schools" className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-rose-500 px-5 py-3 text-sm font-extrabold text-white shadow-[0_16px_45px_rgba(79,70,229,.28)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_55px_rgba(79,70,229,.36)]">Manage schools <ArrowOutwardRoundedIcon className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" fontSize="small" /></Link></div></div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={150} sx={{ borderRadius: 7 }} />) : kpis.map((item) => <KpiCard key={item.label} {...item} />)}</section>

        <section className="chart-panel glass-panel mt-6 rounded-[32px] p-5 md:p-7">
          <div className="mb-5"><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">Platform growth</p><h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">New schools by month</h2></div>
          <div className="h-[340px] w-full">{loading ? <Skeleton variant="rounded" height="100%" sx={{ borderRadius: 5 }} /> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={data?.trend ?? []} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}><defs><linearGradient id="schoolsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.42} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0.03} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbeafe" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} width={36} tick={{ fill: '#64748b', fontSize: 12 }} /><Tooltip contentStyle={{ borderRadius: 18, border: '1px solid #e2e8f0', boxShadow: '0 20px 50px rgba(15,23,42,.12)' }} /><Area type="monotone" dataKey="schools" stroke="#6366f1" strokeWidth={3} fill="url(#schoolsFill)" animationDuration={1200} /></AreaChart></ResponsiveContainer>}</div>
        </section>
      </main>
    </div>
  );
}
