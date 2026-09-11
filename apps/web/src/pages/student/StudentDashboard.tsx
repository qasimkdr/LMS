import { useEffect, useState } from 'react';
import { AssessmentRounded, CalendarMonthRounded, QuizRounded, SchoolRounded } from '@mui/icons-material';
import { Alert, Skeleton } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

type Data = { profile: { admissionNo:string; user:{firstName:string;lastName:string}; class?:{name:string;section?:string}|null }; attendanceRate:number; averageScore:number; examsTaken:number; recentResults:Array<{id:string;status:string;percentage?:string|number|null;exam:{title:string;subject:{name:string}}}> };

export default function StudentDashboard(){
 const [data,setData]=useState<Data|null>(null); const nav=useNavigate();
 useEffect(()=>{api.get('/portal/student').then(r=>setData(r.data));},[]);
 if(!data) return <main className="min-h-screen bg-[#f7f9ff] p-6"><Skeleton height={100}/><div className="grid gap-4 md:grid-cols-3">{[1,2,3].map(x=><Skeleton key={x} height={150}/>)}</div></main>;
 const cards=[['Attendance',`${data.attendanceRate}%`,CalendarMonthRounded],['Average score',`${data.averageScore}%`,AssessmentRounded],['Exams taken',String(data.examsTaken),QuizRounded]] as const;
 return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e8f0ff,transparent_35%),radial-gradient(circle_at_top_right,#f2e9ff,transparent_30%),#f8faff] p-5 md:p-8 text-slate-800">
  <header className="mx-auto max-w-7xl rounded-[30px] border border-white bg-white/75 p-6 shadow-[0_25px_70px_rgba(66,88,140,.12)] backdrop-blur-xl">
   <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-semibold text-indigo-600">Nexora Student Portal</p><h1 className="text-3xl font-black">Welcome, {data.profile.user.firstName}</h1><p className="text-slate-500">{data.profile.class ? `${data.profile.class.name}${data.profile.class.section ? ` ${data.profile.class.section}` : ''}` : 'Class not assigned'} · Admission {data.profile.admissionNo}</p></div><button onClick={()=>nav('/student/exams')} className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-500 px-5 py-3 font-bold text-white shadow-lg transition hover:-translate-y-1">Open Exam Center</button></div>
  </header>
  {!data.profile.class&&<Alert severity="warning" className="mx-auto mt-5 max-w-7xl">Your account is not assigned to a class. Ask the Principal or school staff to assign your class so assignments, timetable, exams, tests and class performance can appear.</Alert>}
  <section className="mx-auto mt-6 grid max-w-7xl gap-4 md:grid-cols-3">{cards.map(([label,value,Icon])=><article key={label} className="group rounded-[26px] border border-white bg-white/80 p-5 shadow-[0_18px_50px_rgba(70,90,140,.1)] transition duration-300 hover:-translate-y-2 hover:rotate-[.3deg]"><div className="mb-5 inline-flex rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 p-3 text-white shadow-lg"><Icon/></div><p className="text-sm font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-4xl font-black">{value}</p></article>)}</section>
  <section className="mx-auto mt-6 max-w-7xl rounded-[28px] border border-white bg-white/80 p-6 shadow-xl"><div className="mb-4 flex items-center gap-2"><SchoolRounded className="text-indigo-600"/><h2 className="text-xl font-black">Recent academic results</h2></div><div className="grid gap-3">{data.recentResults.length?data.recentResults.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4"><div><p className="font-bold">{r.exam.title}</p><p className="text-sm text-slate-500">{r.exam.subject.name}</p></div><div className="text-right"><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">{r.status}</span><p className="mt-1 text-lg font-black">{r.percentage!=null?`${Number(r.percentage).toFixed(1)}%`:'Pending'}</p></div></div>):<p className="text-slate-500">No exam results yet.</p>}</div></section>
 </main>;
}
