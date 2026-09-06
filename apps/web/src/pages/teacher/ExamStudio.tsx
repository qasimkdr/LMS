import { useEffect, useMemo, useState } from 'react';
import { Add, AutoAwesome, CloudUploadOutlined, SaveOutlined } from '@mui/icons-material';
import { CircularProgress, MenuItem, Switch, TextField } from '@mui/material';
import { api } from '../../lib/api';
import QuestionEditor, { type DraftQuestion } from './components/QuestionEditor';

type Directory = { classes: { id:string; name:string; section?:string }[]; subjects:{ id:string; name:string }[] };
const blank = (): DraftQuestion => ({ type:'MCQ', prompt:'', marks:1, options:[{label:'A',value:'',isCorrect:true},{label:'B',value:'',isCorrect:false}] });

function parseTxt(text:string): DraftQuestion[] {
  const blocks = text.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines=block.split('\n').map(x=>x.trim()).filter(Boolean); const q=lines.find(x=>/^Q:/i.test(x))?.replace(/^Q:\s*/i,'') ?? lines[0];
    const opts=lines.filter(x=>/^[A-F][).]/i.test(x)).map((x,i)=>({label:String.fromCharCode(65+i),value:x.replace(/^[A-F][).]\s*/i,''),isCorrect:false}));
    const answer=lines.find(x=>/^ANSWER:/i.test(x))?.replace(/^ANSWER:\s*/i,'').trim(); const marks=Number(lines.find(x=>/^MARKS:/i.test(x))?.replace(/^MARKS:\s*/i,''))||1;
    if(opts.length){ const idx=Math.max(0,(answer?.toUpperCase().charCodeAt(0)??65)-65); if(opts[idx]) opts[idx].isCorrect=true; return {type:'MCQ',prompt:q,marks,options:opts}; }
    return {type:'LONG_ANSWER',prompt:q,marks,correctAnswer:answer,options:[]};
  }).filter(x=>x.prompt);
}

export default function ExamStudio(){
  const [directory,setDirectory]=useState<Directory>({classes:[],subjects:[]}); const [questions,setQuestions]=useState<DraftQuestion[]>([blank()]); const [saving,setSaving]=useState(false); const [message,setMessage]=useState('');
  const [form,setForm]=useState({title:'',classId:'',subjectId:'',durationMin:30,passingMarks:0,randomizeQuestions:true,randomizeOptions:true,showResults:false});
  useEffect(()=>{api.get('/school-directory').then(r=>setDirectory(r.data));},[]);
  const total=useMemo(()=>questions.reduce((s,q)=>s+Number(q.marks||0),0),[questions]);
  const importFile=async(file?:File)=>{ if(!file)return; setMessage(''); if(file.name.toLowerCase().endsWith('.txt')){const parsed=parseTxt(await file.text()); if(parsed.length)setQuestions(parsed); else setMessage('No valid questions detected.');} else setMessage('TXT parser is active. DOCX/CSV server import is the next parser layer.'); };
  const save=async()=>{setSaving(true);setMessage('');try{await api.post('/exams',{...form,passingMarks:form.passingMarks||undefined,questions:questions.map(q=>({...q,correctAnswer:q.type==='MCQ'?q.options.find(o=>o.isCorrect)?.value:q.correctAnswer}))});setMessage('Exam saved successfully.');}catch(e:any){setMessage(e.response?.data?.message??'Could not save exam.');}finally{setSaving(false)}};
  return <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#eef2ff_0,#fbfdff_38%,#f6fbff_100%)] p-4 md:p-8">
    <div className="mx-auto max-w-7xl"><header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 font-black text-indigo-600"><AutoAwesome/> NEXORA EXAM STUDIO</div><h1 className="text-4xl font-black tracking-tight text-slate-900 md:text-5xl">Create smarter <span className="bg-gradient-to-r from-blue-600 via-violet-500 to-rose-500 bg-clip-text text-transparent">exams.</span></h1><p className="mt-2 text-slate-500">Build, import, validate and publish assessments for your assigned classes.</p></div><label className="group flex cursor-pointer items-center gap-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 font-black text-white shadow-xl transition hover:-translate-y-1 hover:shadow-blue-200"><CloudUploadOutlined/> Import TXT / CSV / DOCX<input type="file" accept=".txt,.csv,.docx" hidden onChange={e=>importFile(e.target.files?.[0])}/></label></header>
    <section className="mb-6 grid gap-4 rounded-[30px] border border-white bg-white/70 p-5 shadow-[0_24px_80px_rgba(88,90,180,.12)] backdrop-blur-xl md:grid-cols-3"><TextField label="Exam title" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/><TextField select label="Class" value={form.classId} onChange={e=>setForm({...form,classId:e.target.value})}>{directory.classes.map(c=><MenuItem key={c.id} value={c.id}>{c.name}{c.section?` · ${c.section}`:''}</MenuItem>)}</TextField><TextField select label="Subject" value={form.subjectId} onChange={e=>setForm({...form,subjectId:e.target.value})}>{directory.subjects.map(s=><MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}</TextField><TextField label="Duration (minutes)" type="number" value={form.durationMin} onChange={e=>setForm({...form,durationMin:Number(e.target.value)})}/><TextField label={`Passing marks · total ${total}`} type="number" value={form.passingMarks} onChange={e=>setForm({...form,passingMarks:Number(e.target.value)})}/><div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-600"><label><Switch checked={form.randomizeQuestions} onChange={e=>setForm({...form,randomizeQuestions:e.target.checked})}/> Shuffle questions</label><label><Switch checked={form.randomizeOptions} onChange={e=>setForm({...form,randomizeOptions:e.target.checked})}/> Shuffle options</label></div></section>
    <div className="space-y-5">{questions.map((q,i)=><QuestionEditor key={i} value={q} index={i} onChange={v=>setQuestions(x=>x.map((a,j)=>j===i?v:a))} onDelete={()=>setQuestions(x=>x.length>1?x.filter((_,j)=>j!==i):x)}/>)}</div>
    <div className="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white bg-white/85 p-4 shadow-2xl backdrop-blur-xl"><div className="font-black text-slate-700">{questions.length} questions · <span className="text-violet-600">{total} marks</span>{message&&<span className="ml-3 text-sm text-slate-500">{message}</span>}</div><div className="flex gap-2"><button onClick={()=>setQuestions(x=>[...x,blank()])} className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 to-orange-400 px-5 py-3 font-black text-slate-900 transition hover:-translate-y-1"><Add/> Add question</button><button disabled={saving} onClick={save} className="flex min-w-36 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-green-600 px-5 py-3 font-black text-white shadow-lg transition hover:-translate-y-1 disabled:opacity-60">{saving?<CircularProgress size={20} color="inherit"/>:<SaveOutlined/>} Save exam</button></div></div>
    </div></main>;
}
