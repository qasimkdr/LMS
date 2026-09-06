import AddTaskRoundedIcon from '@mui/icons-material/AddTaskRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { Alert, Button, CircularProgress, MenuItem, Skeleton, TextField } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type Directory = { teachers: Array<{id:string;firstName:string;lastName:string;email:string}>; classes: Array<{id:string;name:string;section?:string|null;academicYear?:string|null}>; subjects: Array<{id:string;name:string;code?:string|null}> };
type Assignment = { id:string; teacher:{id:string;firstName:string;lastName:string;email:string}; class:{id:string;name:string;section?:string|null;academicYear?:string|null}; subject:{id:string;name:string;code?:string|null} };

export default function TeacherAssignmentsPage() {
  const [directory,setDirectory]=useState<Directory>({teachers:[],classes:[],subjects:[]});
  const [rows,setRows]=useState<Assignment[]>([]);
  const [form,setForm]=useState({teacherId:'',classId:'',subjectId:'',note:''});
  const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [busyId,setBusyId]=useState(''); const [message,setMessage]=useState(''); const [error,setError]=useState('');

  const load=async()=>{setLoading(true);setError('');try{const [{data:d},{data:a}]=await Promise.all([api.get<Directory>('/school-directory'),api.get<Assignment[]>('/teacher-assignments')]);setDirectory(d);setRows(a);}catch{setError('Could not load teacher assignments.');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const valid=useMemo(()=>Boolean(form.teacherId&&form.classId&&form.subjectId),[form]);
  const submit=async()=>{if(!valid)return;setSaving(true);setError('');setMessage('');try{const {data}=await api.post('/teacher-assignments',form);setMessage(data.mode==='APPROVAL'?'Assignment sent to Principal approval.':'Teacher assignment saved.');setForm({teacherId:'',classId:'',subjectId:'',note:''});await load();}catch(e:any){setError(e?.response?.data?.message??'Assignment could not be saved.');}finally{setSaving(false);}};
  const remove=async(id:string)=>{setBusyId(id);setError('');try{await api.delete(`/teacher-assignments/${id}`);setRows(r=>r.filter(x=>x.id!==id));}catch(e:any){setError(e?.response?.data?.message??'Assignment could not be removed.');}finally{setBusyId('');}};

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eaf3ff,#f8fbff_45%,#fff8ed)] px-4 py-7 sm:px-8">
    <section className="mx-auto max-w-7xl">
      <header className="mb-7"><span className="text-xs font-black uppercase tracking-[.22em] text-violet-600">Academic structure</span><h1 className="mt-2 text-3xl font-black text-slate-950">Teacher assignments</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">Connect teachers to a class and subject. Staff submissions follow the approval rules configured by the Principal.</p></header>
      {error&&<Alert severity="error" className="mb-4" onClose={()=>setError('')}>{error}</Alert>}{message&&<Alert severity="success" className="mb-4" onClose={()=>setMessage('')}>{message}</Alert>}
      <div className="glass-panel mb-6 grid gap-4 rounded-[28px] p-5 md:grid-cols-4">
        <TextField select label="Teacher" value={form.teacherId} onChange={e=>setForm({...form,teacherId:e.target.value})}>{directory.teachers.map(t=><MenuItem key={t.id} value={t.id}>{t.firstName} {t.lastName}</MenuItem>)}</TextField>
        <TextField select label="Class" value={form.classId} onChange={e=>setForm({...form,classId:e.target.value})}>{directory.classes.map(c=><MenuItem key={c.id} value={c.id}>{c.name}{c.section?` · ${c.section}`:''}</MenuItem>)}</TextField>
        <TextField select label="Subject" value={form.subjectId} onChange={e=>setForm({...form,subjectId:e.target.value})}>{directory.subjects.map(s=><MenuItem key={s.id} value={s.id}>{s.name}{s.code?` · ${s.code}`:''}</MenuItem>)}</TextField>
        <Button startIcon={!saving?<AddTaskRoundedIcon/>:undefined} variant="contained" disabled={!valid||saving} onClick={()=>void submit()} sx={{borderRadius:3,fontWeight:900,background:'linear-gradient(90deg,#2563eb,#7c3aed,#ec4899)'}}>{saving?<CircularProgress size={20} color="inherit"/>:'Assign teacher'}</Button>
      </div>
      {loading?<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({length:6}).map((_,i)=><Skeleton key={i} variant="rounded" height={150} sx={{borderRadius:6}}/>)}</div>:<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map(r=><article key={r.id} className="card-3d glass-panel rounded-[26px] p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.16em] text-blue-600">{r.subject.name}</p><h2 className="mt-2 text-lg font-black text-slate-900">{r.teacher.firstName} {r.teacher.lastName}</h2><p className="mt-1 text-sm text-slate-500">{r.class.name}{r.class.section?` · ${r.class.section}`:''}</p><p className="mt-1 text-xs text-slate-400">{r.teacher.email}</p></div><button onClick={()=>void remove(r.id)} disabled={busyId===r.id} className="rounded-2xl bg-rose-50 p-2 text-rose-600 transition hover:scale-105 hover:bg-rose-100">{busyId===r.id?<CircularProgress size={18}/>:<DeleteOutlineRoundedIcon fontSize="small"/>}</button></div></article>)}{!rows.length&&<div className="md:col-span-2 xl:col-span-3 rounded-[26px] border border-dashed border-slate-300 bg-white/60 py-16 text-center text-slate-500">No teacher assignments yet.</div>}</div>}
    </section>
  </main>;
}
