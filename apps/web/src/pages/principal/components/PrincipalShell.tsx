import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import ApprovalRoundedIcon from '@mui/icons-material/ApprovalRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

const links = [
  { to: '/principal', label: 'Overview', icon: DashboardRoundedIcon },
  { to: '/principal/operations', label: 'School operations', icon: GroupsRoundedIcon },
  { to: '/principal/approvals', label: 'Approvals', icon: ApprovalRoundedIcon },
  { to: '/teacher/exams/new', label: 'Exam studio', icon: SchoolRoundedIcon },
  { to: '/principal/settings', label: 'Settings', icon: TuneRoundedIcon },
];

export default function PrincipalShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#edf4ff_0,#f8fbff_42%,#fff8ed_100%)] lg:grid lg:grid-cols-[270px_1fr]">
    <aside className="border-r border-white/70 bg-white/72 p-4 backdrop-blur-2xl lg:min-h-screen lg:p-5">
      <div className="mb-5 rounded-[24px] bg-gradient-to-br from-blue-600 via-violet-600 to-rose-500 p-4 text-white shadow-[0_18px_55px_rgba(79,70,229,.25)]"><div className="text-xs font-black uppercase tracking-[.2em] text-white/70">Nexora LMS</div><div className="mt-1 text-xl font-black">Principal Portal</div></div>
      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">{links.map(({to,label,icon:Icon}) => <NavLink key={to} to={to} end={to==='/principal'} className={({isActive})=>`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-black transition ${isActive?'bg-slate-950 text-white shadow-lg':'text-slate-600 hover:-translate-y-.5 hover:bg-white hover:text-slate-950 hover:shadow-md'}`}><Icon fontSize="small" />{label}</NavLink>)}</nav>
    </aside>
    <div className="min-w-0">{children}</div>
  </div>;
}
