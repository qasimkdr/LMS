import FamilyRestroomRoundedIcon from '@mui/icons-material/FamilyRestroomRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import { Alert, MenuItem, Skeleton, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

type Child = { id:string; relation?:string|null; user:{firstName:string;lastName:string}; class?:{name:string;section?:string|null}|null };
type Detail = { student:Child; relation?:string|null; attendanceRate:number; averageScore:number; results:Array<{id:string;percentage?:number|string|null;passed?:boolean|null;exam:{title:string;subject:{name:string}}}>; announcements:Array<{id:string;title:string;body:string}> };

export default function ParentDashboard(){
 const [children,setChildren]=useState<Child[]>([]); const [selected,setSelected]=useState(''); const [detail,setDetail]=useState<Detail|null>(null); const [error,setError]=useState('');
 useEffect(()=>{api.get<Child[]>('/portal/parent/children').then(r=>{setChildren(r.data);if(r.data[0])setSelected(r.data[0].id);}).catch(()=>setError('Could not load linked children.'));},[]);
 useEffect(()=>{if(!selected)return;setDetail(null);api.get<Detail>(`/portal/parent/children/${selected}`).then(r=>setDetail(r.data)).catch(()=>setError('Could not load child dashboard.'));},[selected]);
 const name=detail?`${detail.student.user.firstName} ${detail.student.user.lastName}`:'';
 return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#edf4ff,#fbfdff_45%,#fff8ed)] px-4 py-6 sm:px-8"><div className="mx-auto max-w-6xl">
  <header className="glass-panel rounded-[32px] p-6 md:p-8"><div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><div><span className="text-xs font-black uppercase tracking-[.2em] text-violet-600">Parent Portal</span><h1 className="mt-3 text-3xl font-black text-slate-950 md:text-5xl">Follow every child in one place.</h1><p className="mt-3 text-sm text-slate-500">Read-only access to academics, fees, timetable, calendar and announcements.</p></div>{children.length>0&&<TextField select label="Switch student" value={selected} onChange={e=>setSelected(e.target.value)} sx={{minWidth:240}}>{children.map(c=><MenuItem key={c.id} value={c.id}>{c.user.firstName} {c.user.lastName}</MenuItem>)}</TextField>}</div></header>
  {error&&<Alert severity="error" className="mt-5">{error}</Alert>}
  {!detail&&!error&&<div className="mt-5 grid gap-4 md:grid-cols-3">{[1,2,3].map(i=><Skeleton key={i} variant="rounded" height={140} sx={{borderRadius:6}} />)}</div>}
  {detail&&<>
   <section className="mt-5 grid gap-4 md:grid-cols-3"><Metric label="Attendance" value={`${detail.attendanceRate}%`} /><Metric label="Average score" value={`${detail.averageScore}%`} /><Metric label="Class" value={detail.student.class?`${detail.student.class.name}${detail.student.class.section?` ${detail.student.class.section}`:''}`:'—'} /></section>
   <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><QuickLink to={`/parent/report-card?studentId=${selected}`} title="Report card" note={`Academic performance for ${name}`} icon={<AssessmentRoundedIcon/>}/><QuickLink to={`/parent/fees?studentProfileId=${selected}`} title="Fee ledger" note="Paid, pending and outstanding months" icon={<PaymentsRoundedIcon/>}/><QuickLink to={`/parent/timetable?studentId=${selected}`} title="Timetable" note="Weekly class schedule" icon={<ScheduleRoundedIcon/>}/><QuickLink to={`/parent/calendar?studentId=${selected}`} title="School calendar" note="Events, exams and holidays" icon={<CalendarMonthRoundedIcon/>}/></section>
   <section className="mt-5 grid gap-5 lg:grid-cols-2"><Panel title="Results" icon={<FamilyRestroomRoundedIcon className="text-violet-600"/>}>{detail.results.length?detail.results.map(r=><div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0"><div><p className="font-black text-slate-800">{r.exam.title}</p><p className="text-xs text-slate-500">{r.exam.subject.name}</p></div><div className="text-right"><p className="font-black text-violet-700">{r.percentage!=null?`${Number(r.percentage).toFixed(1)}%`:'—'}</p><p className="text-xs text-slate-400">{r.passed==null?'Graded':r.passed?'Passed':'Needs support'}</p></div></div>):<p className="text-sm text-slate-500">No graded results yet.</p>}</Panel><Panel title="Announcements" icon={<CampaignRoundedIcon className="text-blue-600"/>}>{detail.announcements.length?detail.announcements.map(a=><article key={a.id} className="border-b border-slate-100 py-3 last:border-0"><h3 className="font-black text-slate-800">{a.title}</h3><p className="mt-1 text-sm text-slate-500">{a.body}</p></article>):<p className="text-sm text-slate-500">No announcements.</p>}</Panel></section>
  </>}
 </div></main>;
}
function Metric({label,value}:{label:string;value:string}){return <article className="card-3d glass-panel rounded-[26px] p-5"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></article>}
function Panel({title,icon,children}:{title:string;icon:React.ReactNode;children:React.ReactNode}){return <section className="glass-panel rounded-[28px] p-5"><div className="mb-3 flex items-center gap-2">{icon}<h2 className="text-xl font-black text-slate-900">{title}</h2></div>{children}</section>}
function QuickLink({to,title,note,icon}:{to:string;title:string;note:string;icon:React.ReactNode}){return <Link to={to} className="group rounded-[24px] border border-white bg-white/85 p-5 shadow-lg transition hover:-translate-y-1 hover:shadow-xl"><div className="inline-flex rounded-2xl bg-gradient-to-br from-violet-600 to-blue-500 p-3 text-white">{icon}</div><h3 className="mt-4 font-black text-slate-900">{title}</h3><p className="mt-1 text-xs text-slate-500">{note}</p></Link>}
