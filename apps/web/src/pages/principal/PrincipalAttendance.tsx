import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import BeachAccessRoundedIcon from '@mui/icons-material/BeachAccessRounded';
import { Alert, Button, CircularProgress, MenuItem, Skeleton, TextField } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type Directory = { classes: Array<{ id:string; name:string; section?:string|null; academicYear?:string|null }> };
type Student = { id:string; admissionNo:string; user:{ id:string; firstName:string; lastName:string } };
type Status = 'PRESENT'|'ABSENT'|'LATE'|'LEAVE';

const statusStyles: Record<Status,string> = {
  PRESENT:'bg-emerald-50 text-emerald-700 border-emerald-200',
  ABSENT:'bg-rose-50 text-rose-700 border-rose-200',
  LATE:'bg-amber-50 text-amber-700 border-amber-200',
  LEAVE:'bg-blue-50 text-blue-700 border-blue-200',
};

export default function PrincipalAttendance(){
  const [classes,setClasses]=useState<Directory['classes']>([]);
  const [classId,setClassId]=useState('');
  const [students,setStudents]=useState<Student[]>([]);
  const [records,setRecords]=useState<Record<string,Status>>({});
  const [loading,setLoading]=useState(true);
  const [rosterLoading,setRosterLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [summary,setSummary]=useState({attendanceRate:0,present:0,absent:0,late:0,leave:0,total:0});
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));

  useEffect(()=>{(async()=>{try{const [{data:d},{data:s}]=await Promise.all([api.get<Directory>('/school-directory'),api.get('/attendance/summary')]);setClasses(d.classes);setSummary(s);if(d.classes[0])setClassId(d.classes[0].id);}catch{setError('Could not load attendance workspace.');}finally{setLoading(false);}})();},[]);
  useEffect(()=>{if(!classId)return;setRosterLoading(true);api.get(`/attendance/class/${classId}`).then(({data})=>{setStudents(data.students);setRecords(Object.fromEntries(data.students.map((s:Student)=>[s.user.id,'PRESENT'])));}).catch(()=>setError('Could not load class roster.')).finally(()=>setRosterLoading(false));},[classId]);

  const stats=useMemo(()=>({present:Object.values(records).filter(v=>v==='PRESENT').length,absent:Object.values(records).filter(v=>v==='ABSENT').length,late:Object.values(records).filter(v=>v==='LATE').length,leave:Object.values(records).filter(v=>v==='LEAVE').length}),[records]);
  const save=async()=>{if(!classId||!students.length)return;setSaving(true);setError('');setMessage('');try{await api.post('/attendance/mark',{classId,date,records:students.map(s=>({studentId:s.user.id,status:records[s.user.id]}))});const {data}=await api.get('/attendance/summary');setSummary(data);setMessage('Attendance saved successfully.');}catch(e:any){setError(e?.response?.data?.message??'Attendance could not be saved.');}finally{setSaving(false);}};

  if(loading)return <div className="min-h-screen bg-[#f8fbff] p-6"><div className="mx-auto max-w-6xl space-y-4">{Array.from({length:5}).map((_,i)=><Skeleton key={i} variant="rounded" height={120} sx={{borderRadius:5}} />)}</div></div>;

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#edf5ff,#fff_48%,#fff7ed)] px-4 py-6 sm:px-8">
    <section className="mx-auto max-w-6xl">
      <header className="mb-6"><span className="text-xs font-black uppercase tracking-[.22em] text-blue-600">Attendance intelligence</span><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Daily attendance</h1><p className="mt-2 text-sm text-slate-500">Mark students quickly, track attendance health and keep every action tenant-safe.</p></header>
      {error&&<Alert severity="error" className="mb-4" onClose={()=>setError('')}>{error}</Alert>}{message&&<Alert severity="success" className="mb-4" onClose={()=>setMessage('')}>{message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5 mb-6">
        {[['30-day rate',`${summary.attendanceRate}%`,CheckCircleRoundedIcon,'from-emerald-500 to-lime-400'],['Present',summary.present,CheckCircleRoundedIcon,'from-blue-500 to-cyan-400'],['Absent',summary.absent,EventBusyRoundedIcon,'from-rose-500 to-orange-400'],['Late',summary.late,ScheduleRoundedIcon,'from-amber-400 to-yellow-300'],['Leave',summary.leave,BeachAccessRoundedIcon,'from-violet-500 to-fuchsia-400']].map(([label,value,Icon,accent]:any)=><article key={label} className="glass-panel rounded-[24px] p-4"><div className={`mb-3 inline-flex rounded-2xl bg-gradient-to-br ${accent} p-2 text-white`}><Icon fontSize="small"/></div><p className="text-xs font-bold text-slate-500">{label}</p><h3 className="mt-1 text-2xl font-black text-slate-950">{value}</h3></article>)}
      </div>
      <section className="glass-panel rounded-[30px] p-5 md:p-7">
        <div className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
          <TextField select label="Class" value={classId} onChange={e=>setClassId(e.target.value)}>{classes.map(c=><MenuItem key={c.id} value={c.id}>{c.name}{c.section?` - ${c.section}`:''}</MenuItem>)}</TextField>
          <TextField type="date" label="Date" value={date} onChange={e=>setDate(e.target.value)} InputLabelProps={{shrink:true}} />
          <Button variant="contained" onClick={()=>void save()} disabled={saving||rosterLoading||!students.length} sx={{borderRadius:3,px:3,py:1.8,fontWeight:900,background:'linear-gradient(90deg,#2563eb,#7c3aed,#ef4444)'}}>{saving?<CircularProgress size={20} color="inherit"/>:'Save attendance'}</Button>
        </div>
        <div className="mt-6 grid gap-3">
          {rosterLoading?Array.from({length:6}).map((_,i)=><Skeleton key={i} variant="rounded" height={82} sx={{borderRadius:4}}/>):students.map(s=><div key={s.id} className="flex flex-col gap-4 rounded-[22px] border border-white bg-white/80 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black text-slate-900">{s.user.firstName} {s.user.lastName}</p><p className="text-xs font-semibold text-slate-400">Admission {s.admissionNo}</p></div><div className="flex flex-wrap gap-2">{(['PRESENT','ABSENT','LATE','LEAVE'] as Status[]).map(st=><button key={st} onClick={()=>setRecords(r=>({...r,[s.user.id]:st}))} className={`rounded-xl border px-3 py-2 text-xs font-black transition ${records[s.user.id]===st?statusStyles[st]:'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'}`}>{st}</button>)}</div></div>)}
          {!rosterLoading&&!students.length&&<div className="rounded-[22px] border border-dashed border-slate-300 py-14 text-center text-sm text-slate-500">No students are assigned to this class yet.</div>}
        </div>
      </section>
    </section>
  </main>;
}
