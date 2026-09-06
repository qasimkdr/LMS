import AssignmentTurnedInRoundedIcon from '@mui/icons-material/AssignmentTurnedInRounded';
import Groups2RoundedIcon from '@mui/icons-material/Groups2Rounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import AcademicPerformanceChart from './components/AcademicPerformanceChart';

const cards = [
  { label: 'Students', value: '1,248', hint: '42 new this month', icon: Groups2RoundedIcon, accent: 'from-blue-500 to-cyan-400' },
  { label: 'Teachers', value: '64', hint: '91% active today', icon: SchoolRoundedIcon, accent: 'from-violet-500 to-fuchsia-400' },
  { label: 'Pending approvals', value: '7', hint: '3 need review today', icon: AssignmentTurnedInRoundedIcon, accent: 'from-amber-400 to-orange-500' },
  { label: 'Avg. performance', value: '82%', hint: '+4.3% this term', icon: TrendingUpRoundedIcon, accent: 'from-emerald-500 to-lime-400' },
];

export default function PrincipalDashboard() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.principal-hero', { y: 24, opacity: 0, duration: .65, ease: 'power3.out' });
      gsap.from('.principal-card', { y: 30, opacity: 0, stagger: .08, duration: .55, delay: .08, ease: 'power3.out' });
      gsap.from('.principal-chart', { y: 28, opacity: 0, duration: .65, delay: .2, ease: 'power3.out' });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <main ref={root} className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eaf3ff_0,#f8fbff_42%,#fff8ed_100%)] px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1450px]">
        <section className="principal-hero glass-panel relative overflow-hidden rounded-[34px] p-6 md:p-8">
          <div className="absolute -right-10 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-blue-300/40 via-violet-300/25 to-amber-200/30 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-[.18em] text-blue-700">Principal command center</span>
              <h1 className="mt-4 text-3xl font-black tracking-[-.04em] text-slate-950 md:text-5xl">Your school at a <span className="gradient-text">single glance.</span></h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">Approvals, performance, attendance and staff operations in one responsive workspace.</p>
            </div>
            <Link to="/principal/approvals" className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-rose-500 px-5 py-3 text-sm font-black text-white shadow-[0_16px_45px_rgba(79,70,229,.28)] transition hover:-translate-y-1 hover:shadow-[0_22px_60px_rgba(79,70,229,.36)]">Open approval center</Link>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((item) => {
            const Icon = item.icon;
            return <article key={item.label} className="principal-card card-3d glass-panel group rounded-[28px] p-5 transition duration-300 hover:-translate-y-1">
              <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-500">{item.label}</p><h3 className="mt-2 text-3xl font-black text-slate-950">{item.value}</h3><p className="mt-2 text-xs font-bold text-slate-500">{item.hint}</p></div><div className={`rounded-2xl bg-gradient-to-br ${item.accent} p-3 text-white shadow-lg transition duration-300 group-hover:scale-110 group-hover:rotate-3`}><Icon fontSize="small" /></div></div>
            </article>;
          })}
        </section>

        <div className="principal-chart mt-6"><AcademicPerformanceChart /></div>
      </div>
    </main>
  );
}
