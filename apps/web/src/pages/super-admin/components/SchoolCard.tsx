import BusinessIcon from '@mui/icons-material/Business';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import SchoolIcon from '@mui/icons-material/School';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import { Chip, IconButton, Menu, MenuItem } from '@mui/material';
import { useState, type ReactNode } from 'react';

export type SchoolSummary = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  status: 'TRIAL' | 'ACTIVE' | 'GRACE_PERIOD' | 'READ_ONLY' | 'SUSPENDED' | 'CANCELLED';
  studentLimit: number;
  teacherLimit: number;
  storageLimitMb: number;
  storageUsedBytes?: number;
  storageFiles?: number;
  subscriptionEnd?: string | null;
  graceEndsAt?: string | null;
  trialEndsAt?: string | null;
  _count: { users: number; classes: number; exams: number };
  users: Array<{ id: string; firstName: string; lastName: string; email: string; isActive: boolean }>;
};

const statusClass: Record<SchoolSummary['status'], string> = {
  ACTIVE: 'from-emerald-400 to-green-600',
  TRIAL: 'from-blue-400 to-cyan-500',
  GRACE_PERIOD: 'from-amber-400 to-orange-500',
  READ_ONLY: 'from-yellow-400 to-amber-500',
  SUSPENDED: 'from-red-400 to-rose-600',
  CANCELLED: 'from-slate-400 to-slate-600',
};

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

export default function SchoolCard({
  school,
  busy,
  onLifecycle,
  onPlan,
  onQuotas,
  onImpersonate,
}: {
  school: SchoolSummary;
  busy?: boolean;
  onLifecycle: () => void;
  onPlan: () => void;
  onQuotas: () => void;
  onImpersonate: () => void;
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const principal = school.users[0];
  const used = mb(school.storageUsedBytes ?? 0);
  const pct = school.storageLimitMb ? Math.round((used / school.storageLimitMb) * 100) : 0;

  return (
    <article className="group relative overflow-hidden rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-[0_18px_55px_rgba(38,82,148,.12)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_25px_70px_rgba(38,82,148,.2)]">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${statusClass[school.status]}`} />
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 shadow-inner">
            {school.logoUrl ? <img src={school.logoUrl} alt="" className="h-full w-full object-cover" /> : <BusinessIcon className="text-blue-700" />}
          </div>
          <div className="min-w-0"><h3 className="truncate text-lg font-black text-slate-900">{school.name}</h3><p className="truncate text-sm text-slate-500">{principal ? `${principal.firstName} ${principal.lastName} · ${principal.email}` : 'Principal not assigned'}</p></div>
        </div>
        <IconButton size="small" onClick={(event) => setAnchor(event.currentTarget)} disabled={busy}><MoreVertIcon /></IconButton>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2"><Metric icon={<PeopleAltIcon fontSize="small" />} value={school._count.users} label="Users" /><Metric icon={<SchoolIcon fontSize="small" />} value={school._count.classes} label="Classes" /><Metric icon={<BusinessIcon fontSize="small" />} value={school._count.exams} label="Exams" /></div>
      <div className="mt-4 rounded-2xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1 font-bold text-slate-600"><StorageRoundedIcon sx={{ fontSize: 15 }} />{used} / {school.storageLimitMb} MB</span><span className={`font-black ${pct >= 90 ? 'text-rose-600' : pct >= 75 ? 'text-amber-600' : 'text-emerald-600'}`}>{pct}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600" style={{ width: `${Math.min(100, pct)}%` }} /></div>{school.subscriptionEnd && <p className="mt-2 text-[11px] font-semibold text-slate-500">Subscription ends {new Date(school.subscriptionEnd).toLocaleDateString()}</p>}</div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4"><Chip size="small" label={school.status.replaceAll('_', ' ')} className="font-bold" /><span className="text-xs font-semibold text-slate-500">{school.studentLimit.toLocaleString()} students · {school.teacherLimit.toLocaleString()} teachers</span></div>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem disabled={!principal || school.status === 'CANCELLED' || busy} onClick={() => { setAnchor(null); onImpersonate(); }}><SupportAgentRoundedIcon fontSize="small" sx={{ mr: 1 }} />Support as Principal</MenuItem>
        <MenuItem onClick={() => { setAnchor(null); onPlan(); }}><CreditCardRoundedIcon fontSize="small" sx={{ mr: 1 }} />Assign plan</MenuItem>
        <MenuItem onClick={() => { setAnchor(null); onLifecycle(); }}><EventRepeatRoundedIcon fontSize="small" sx={{ mr: 1 }} />Manage subscription</MenuItem>
        <MenuItem onClick={() => { setAnchor(null); onQuotas(); }}>Edit quotas</MenuItem>
      </Menu>
    </article>
  );
}

function Metric({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return <div className="rounded-2xl bg-slate-50/90 px-3 py-3 text-center transition group-hover:bg-white"><div className="flex items-center justify-center gap-1 text-blue-700">{icon}<strong>{value.toLocaleString()}</strong></div><div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div></div>;
}
