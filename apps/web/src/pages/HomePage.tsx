import { Link } from 'react-router-dom';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import AutoGraphRoundedIcon from '@mui/icons-material/AutoGraphRounded';
import AssignmentRoundedIcon from '@mui/icons-material/AssignmentRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';

const features = [
  [<GroupsRoundedIcon key="students" />, 'Student Management', 'Admissions, profiles, guardians, class history and complete academic records in one place.'],
  [<FactCheckRoundedIcon key="attendance" />, 'Attendance System', 'Fast attendance workflows with approved leave protection, correction history and reports.'],
  [<PaymentsRoundedIcon key="fees" />, 'Fees & Recovery', 'Fee structures, invoices, installments, staff collections, handovers and recovery analytics.'],
  [<AutoGraphRoundedIcon key="analytics" />, 'Analytics & Reports', 'Live school intelligence across attendance, academics, syllabus progress and operations.'],
  [<AssignmentRoundedIcon key="coursework" />, 'Coursework & Exams', 'Assignments, submissions, materials, exam builder, imports, grading and report cards.'],
  [<CalendarMonthRoundedIcon key="timetable" />, 'Timetable & School Life', 'Conflict-aware timetables, leave requests, school calendar and announcements.'],
];

const highlights = [
  'Role-based experiences for principals, staff, teachers, students and parents',
  'Multi-school tenant isolation designed for SaaS scale',
  'Principal approvals for sensitive staff actions',
  'Secure private file storage with signed access',
  'Parent portal with linked children and read-only visibility',
  'Audit logs for sensitive changes across the platform',
];

const testimonials = [
  ['Ayesha Khan', 'School Administrator', 'Nexora brings daily operations into one clean system. Attendance, fees and approvals finally feel connected.'],
  ['Bilal Ahmed', 'Teacher', 'The teacher experience is focused and practical. I can work with only the classes and subjects assigned to me.'],
  ['Sara Ali', 'Principal', 'The visibility across school activity is the strongest part. I can review, approve and understand what is happening quickly.'],
];

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#050816] text-white selection:bg-violet-500/40">
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute left-[-10rem] top-20 h-96 w-96 rounded-full bg-blue-600/20 blur-[120px]" />
        <div className="absolute right-[-8rem] top-[28rem] h-[28rem] w-[28rem] rounded-full bg-violet-600/20 blur-[140px]" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-cyan-500/10 blur-[140px]" />
      </div>

      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#050816]/80 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <a href="#home" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-blue-500 to-cyan-400 shadow-lg shadow-violet-500/25"><SchoolRoundedIcon fontSize="small" /></div>
            <div><p className="font-black leading-none">Nexora</p><p className="text-[10px] font-bold uppercase tracking-[.28em] text-slate-400">LMS</p></div>
          </a>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-300 md:flex">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#schools" className="transition hover:text-white">For Schools</a>
            <a href="#security" className="transition hover:text-white">Security</a>
            <a href="#about" className="transition hover:text-white">About</a>
          </nav>
          <Link to="/login" className="rounded-2xl bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2.5 text-sm font-extrabold shadow-lg shadow-violet-500/20 transition hover:-translate-y-0.5">Sign In</Link>
        </div>
      </header>

      <section id="home" className="relative mx-auto grid min-h-[88vh] max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.02fr_.98fr] lg:px-8">
        <div className="relative z-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[.18em] text-violet-200">
            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" /> Modern learning for stronger schools
          </div>
          <h1 className="max-w-4xl text-5xl font-black leading-[.95] tracking-[-.05em] sm:text-6xl lg:text-7xl xl:text-8xl">Manage. Educate. <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-300 bg-clip-text text-transparent">Grow Together.</span></h1>
          <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">Nexora LMS is a complete school operating system built for modern institutions. Manage academics, attendance, fees, approvals, teachers, students, parents and analytics from one secure platform.</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link to="/login" className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 via-purple-500 to-blue-500 px-6 py-4 font-extrabold shadow-2xl shadow-violet-500/20 transition hover:-translate-y-1">Get Started <ArrowForwardRoundedIcon className="transition group-hover:translate-x-1" /></Link>
            <a href="#schools" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-4 font-bold text-slate-200 backdrop-blur-xl transition hover:bg-white/10"><PlayCircleRoundedIcon /> Explore Nexora</a>
          </div>
          <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400"><span>Multi-school SaaS</span><span>Role based access</span><span>Production security</span></div>
        </div>

        <div className="relative mx-auto w-full max-w-2xl lg:rotate-[-2deg]">
          <div className="absolute -inset-8 rounded-full bg-gradient-to-r from-blue-600/25 via-violet-500/35 to-cyan-400/20 blur-3xl" />
          <div className="relative rounded-[2rem] border border-white/10 bg-white/[.06] p-3 shadow-[0_40px_120px_rgba(73,54,255,.25)] backdrop-blur-2xl transition duration-500 hover:rotate-[1deg] hover:scale-[1.01]">
            <div className="rounded-[1.5rem] border border-white/10 bg-[#090d1c] p-5 sm:p-7">
              <div className="mb-6 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-violet-300">Nexora command center</p><h2 className="mt-1 text-2xl font-black">Good morning.</h2></div><span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">Live</span></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {['480 Students','34 Teachers','96% Attendance','Rs 805K Fees'].map((item) => <div key={item} className="rounded-2xl border border-white/10 bg-white/[.04] p-4"><p className="text-sm font-extrabold">{item}</p><div className="mt-4 h-1.5 rounded-full bg-white/10"><div className="h-full w-2/3 rounded-full bg-gradient-to-r from-violet-500 to-cyan-400" /></div></div>)}
              </div>
              <div className="mt-4 rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-cyan-400/5 p-5">
                <div className="flex h-48 items-end gap-2 sm:h-56">{[28,44,38,64,52,78,71,88,66,92,82,96].map((height,index)=><div key={index} className="flex-1 rounded-t-lg bg-gradient-to-t from-violet-600 to-cyan-400/90 shadow-lg shadow-violet-500/10 transition duration-500 hover:brightness-125" style={{height:`${height}%`}} />)}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center"><p className="text-sm font-black uppercase tracking-[.22em] text-violet-300">Everything you need</p><h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">Powerful features for <span className="text-violet-400">modern education</span></h2><p className="mt-5 text-slate-400">Built around real school workflows instead of disconnected tools.</p></div>
        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map(([icon,title,copy])=><article key={String(title)} className="group rounded-[1.75rem] border border-white/10 bg-white/[.045] p-6 backdrop-blur-xl transition duration-300 hover:-translate-y-2 hover:border-violet-400/30 hover:bg-white/[.07]"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-500/30 to-violet-500/30 text-cyan-300 transition group-hover:scale-110">{icon}</div><h3 className="mt-5 text-xl font-extrabold">{title}</h3><p className="mt-3 leading-7 text-slate-400">{copy}</p></article>)}
        </div>
      </section>

      <section id="schools" className="relative mx-auto grid max-w-7xl gap-10 px-4 py-24 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-blue-500/15 via-violet-500/10 to-transparent p-4 sm:p-7">
          <div className="rounded-[1.5rem] border border-white/10 bg-[#090d1c]/90 p-5"><p className="text-sm font-bold text-violet-300">School operations overview</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{['Approvals waiting','Attendance today','Fee recovery','Syllabus progress'].map((item,index)=><div key={item} className="rounded-2xl bg-white/[.05] p-5"><p className="text-sm text-slate-400">{item}</p><p className="mt-2 text-3xl font-black">{[8,'94%','82%','76%'][index]}</p></div>)}</div><div className="mt-4 rounded-2xl bg-white/[.04] p-5"><div className="h-36 rounded-xl bg-[radial-gradient(circle_at_30%_20%,rgba(139,92,246,.35),transparent_35%),linear-gradient(135deg,rgba(59,130,246,.12),rgba(34,211,238,.06))]" /></div></div>
        </div>
        <div className="flex flex-col justify-center"><p className="text-sm font-black uppercase tracking-[.22em] text-cyan-300">Built for real schools</p><h2 className="mt-4 text-4xl font-black sm:text-5xl">A smarter way to manage every school day.</h2><p className="mt-6 text-lg leading-8 text-slate-400">From morning attendance to fee recovery, exams, parent visibility and principal approvals, Nexora keeps the institution connected without sacrificing control.</p><div className="mt-8 space-y-4">{highlights.map((item)=><div key={item} className="flex items-start gap-3"><CheckCircleRoundedIcon className="mt-0.5 text-violet-400" fontSize="small"/><span className="text-slate-300">{item}</span></div>)}</div></div>
      </section>

      <section id="security" className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[[<VerifiedUserRoundedIcon key="secure"/>,'Tenant Security','School data is scoped and isolated by authenticated tenant context.'],[<CloudRoundedIcon key="cloud"/>,'Private Storage','Signed private access and school-scoped object paths.'],[<AutoGraphRoundedIcon key="scale"/>,'SaaS Ready','Plans, modules, lifecycle controls and Super Admin oversight.'],[<SupportAgentRoundedIcon key="support"/>,'Support Center','Cross-role support with internal notes and tenant-safe conversations.']].map(([icon,title,copy])=><div key={String(title)} className="rounded-3xl border border-white/10 bg-white/[.04] p-6"><div className="text-violet-300">{icon}</div><h3 className="mt-4 text-lg font-extrabold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p></div>)}
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="grid overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-r from-violet-600/20 via-blue-600/15 to-cyan-500/10 sm:grid-cols-4">
          {[['500+','Students managed'],['50+','Institution-ready'],['98%','Workflow coverage'],['24/7','Platform access']].map(([value,label])=><div key={label} className="border-b border-white/10 p-8 text-center last:border-0 sm:border-b-0 sm:border-r"><p className="text-4xl font-black">{value}</p><p className="mt-2 text-sm text-slate-400">{label}</p></div>)}
        </div>
      </section>

      <section id="about" className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center"><p className="text-sm font-black uppercase tracking-[.22em] text-violet-300">What schools need</p><h2 className="mt-4 text-4xl font-black sm:text-5xl">Trusted workflows for educators.</h2></div>
        <div className="mt-12 grid gap-5 lg:grid-cols-3">{testimonials.map(([name,role,quote])=><article key={name} className="rounded-[1.75rem] border border-white/10 bg-white/[.04] p-6"><div className="flex gap-0.5 text-amber-300">{Array.from({length:5}).map((_,i)=><StarRoundedIcon key={i} fontSize="small"/>)}</div><p className="mt-5 leading-7 text-slate-300">“{quote}”</p><div className="mt-6"><p className="font-extrabold">{name}</p><p className="text-sm text-slate-500">{role}</p></div></article>)}</div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-[2.25rem] border border-violet-400/20 bg-gradient-to-br from-violet-600/30 via-blue-600/20 to-cyan-500/10 px-6 py-16 text-center sm:px-12">
          <div className="absolute -left-20 top-0 h-60 w-60 rounded-full bg-violet-500/30 blur-[100px]"/><div className="absolute -right-20 bottom-0 h-60 w-60 rounded-full bg-cyan-400/20 blur-[100px]"/>
          <div className="relative"><p className="text-sm font-black uppercase tracking-[.2em] text-violet-200">Ready to transform your school?</p><h2 className="mx-auto mt-4 max-w-3xl text-4xl font-black sm:text-5xl">Bring your entire school into one intelligent platform.</h2><p className="mx-auto mt-5 max-w-2xl text-slate-300">Secure operations, modern learning tools and visibility for every role.</p><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Link to="/login" className="rounded-2xl bg-white px-6 py-3.5 font-extrabold text-slate-950 transition hover:-translate-y-1">Sign In to Nexora</Link><a href="#features" className="rounded-2xl border border-white/20 bg-white/5 px-6 py-3.5 font-bold">View Features</a></div></div>
        </div>
      </section>

      <footer className="relative border-t border-white/10 px-4 py-12 sm:px-6 lg:px-8"><div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-4"><div className="md:col-span-2"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400"><SchoolRoundedIcon fontSize="small"/></div><div><p className="font-black">Nexora</p><p className="text-[10px] uppercase tracking-[.22em] text-slate-500">LMS</p></div></div><p className="mt-5 max-w-md text-sm leading-7 text-slate-500">A modern multi-tenant school management and learning platform built to connect administration, teachers, students and families.</p></div><div><p className="font-extrabold">Quick Links</p><div className="mt-4 space-y-3 text-sm text-slate-500"><a className="block hover:text-white" href="#features">Features</a><a className="block hover:text-white" href="#schools">For Schools</a><Link className="block hover:text-white" to="/login">Sign In</Link></div></div><div><p className="font-extrabold">Platform</p><div className="mt-4 space-y-3 text-sm text-slate-500"><p>Secure by design</p><p>Multi-tenant SaaS</p><p>Responsive web app</p></div></div></div><div className="mx-auto mt-10 flex max-w-7xl flex-col justify-between gap-3 border-t border-white/10 pt-6 text-xs text-slate-600 sm:flex-row"><p>© 2026 Nexora LMS. All rights reserved.</p><p>Built for better education.</p></div></footer>
    </main>
  );
}
