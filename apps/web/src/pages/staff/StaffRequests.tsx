import SendIcon from '@mui/icons-material/Send';
import ReplayIcon from '@mui/icons-material/Replay';
import { Alert, Button, CircularProgress, MenuItem, Skeleton, TextField } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type Directory = {
  school: { id: string; name: string; logoUrl?: string | null } | null;
  teachers: Array<{ id: string; firstName: string; lastName: string; email: string }>;
  classes: Array<{ id: string; name: string; section?: string | null; academicYear?: string | null }>;
  subjects: Array<{ id: string; name: string; code?: string | null }>;
};
type Approval = { id: string; status: string; revision: number; requestType: string; proposedData: { teacherId: string; classId: string; subjectId: string }; principalRemark?: string | null; updatedAt: string };

export default function StaffRequests() {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [teacherId, setTeacherId] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Approval | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { const [d, a] = await Promise.all([api.get<Directory>('/school-directory'), api.get<Approval[]>('/approvals')]); setDirectory(d.data); setItems(a.data); }
    catch { setError('Could not load your school workspace.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const canSubmit = teacherId && classId && subjectId;
  const map = useMemo(() => ({
    teachers: new Map(directory?.teachers.map((x)=>[x.id, `${x.firstName} ${x.lastName}`]) ?? []),
    classes: new Map(directory?.classes.map((x)=>[x.id, `${x.name}${x.section ? ` · ${x.section}` : ''}`]) ?? []),
    subjects: new Map(directory?.subjects.map((x)=>[x.id, x.name]) ?? []),
  }), [directory]);

  const reset = () => { setTeacherId(''); setClassId(''); setSubjectId(''); setNote(''); setEditing(null); };
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError('');
    try {
      const payload = { proposedData: { teacherId, classId, subjectId }, note: note || undefined };
      if (editing) await api.patch(`/approvals/${editing.id}/resubmit`, payload);
      else await api.post('/approvals', { requestType: 'TEACHER_ASSIGNMENT', entityType: 'TeacherAssignment', ...payload });
      reset(); await load();
    } catch (e: any) { setError(e?.response?.data?.message ?? 'Request could not be submitted.'); }
    finally { setBusy(false); }
  };

  const revise = (item: Approval) => { setEditing(item); setTeacherId(item.proposedData.teacherId); setClassId(item.proposedData.classId); setSubjectId(item.proposedData.subjectId); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#edf7ff,#fff_48%,#fff7ef)] px-4 py-7 sm:px-8">
    <section className="mx-auto max-w-6xl">
      <header className="mb-6"><span className="text-xs font-black uppercase tracking-[.22em] text-blue-600">Staff Workspace</span><h1 className="mt-2 text-3xl font-black text-slate-950">Requests & Assignments</h1><p className="mt-2 text-sm text-slate-500">Prepare operational changes for Principal approval. Nothing becomes live until approved.</p></header>
      {error && <Alert severity="error" className="mb-5" onClose={()=>setError('')}>{error}</Alert>}

      <section className="mb-7 rounded-[28px] border border-white bg-white/82 p-5 shadow-[0_18px_60px_rgba(38,82,148,.10)] backdrop-blur-xl sm:p-6">
        <div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-black text-slate-900">{editing ? `Revise request · #${editing.revision + 1}` : 'Assign teacher to class'}</h2><p className="mt-1 text-sm text-slate-500">Select records from {directory?.school?.name ?? 'your school'}.</p></div>{editing && <Button onClick={reset}>Cancel revision</Button>}</div>
        {loading ? <div className="grid gap-4 md:grid-cols-3">{Array.from({length:3}).map((_,i)=><Skeleton key={i} variant="rounded" height={56} />)}</div> : <div className="grid gap-4 md:grid-cols-3">
          <TextField select label="Teacher" value={teacherId} onChange={(e)=>setTeacherId(e.target.value)} fullWidth>{directory?.teachers.map((t)=><MenuItem key={t.id} value={t.id}>{t.firstName} {t.lastName}</MenuItem>)}</TextField>
          <TextField select label="Class" value={classId} onChange={(e)=>setClassId(e.target.value)} fullWidth>{directory?.classes.map((c)=><MenuItem key={c.id} value={c.id}>{c.name}{c.section ? ` · ${c.section}` : ''}</MenuItem>)}</TextField>
          <TextField select label="Subject" value={subjectId} onChange={(e)=>setSubjectId(e.target.value)} fullWidth>{directory?.subjects.map((s)=><MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}</TextField>
          <TextField className="md:col-span-3" multiline minRows={3} label="Note for Principal (optional)" value={note} onChange={(e)=>setNote(e.target.value)} fullWidth />
          <div className="md:col-span-3 flex justify-end"><Button startIcon={busy?<CircularProgress size={17} color="inherit"/>:<SendIcon/>} disabled={!canSubmit||busy} variant="contained" onClick={()=>void submit()} sx={{borderRadius:3,px:3,py:1.2,fontWeight:900,background:'linear-gradient(90deg,#2563eb,#14b8a6)'}}>{editing?'Resubmit for approval':'Send for approval'}</Button></div>
        </div>}
      </section>

      <section><h2 className="mb-4 text-lg font-black text-slate-900">My request history</h2><div className="space-y-3">{loading ? Array.from({length:3}).map((_,i)=><Skeleton key={i} variant="rounded" height={115} sx={{borderRadius:5}} />) : items.map((item)=><article key={item.id} className="rounded-[24px] border border-white bg-white/76 p-5 shadow-sm backdrop-blur-xl"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="flex gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{item.status.replaceAll('_',' ')}</span><span className="px-2 py-1 text-xs font-bold text-slate-400">Revision {item.revision}</span></div><p className="mt-3 font-black text-slate-900">{map.teachers.get(item.proposedData.teacherId) ?? 'Teacher'} → {map.classes.get(item.proposedData.classId) ?? 'Class'} · {map.subjects.get(item.proposedData.subjectId) ?? 'Subject'}</p>{item.principalRemark && <p className="mt-2 text-sm text-amber-700"><b>Principal:</b> {item.principalRemark}</p>}</div>{item.status==='REVISION_REQUIRED' && <Button startIcon={<ReplayIcon/>} variant="outlined" onClick={()=>revise(item)} sx={{borderRadius:3,fontWeight:900}}>Edit & resubmit</Button>}</div></article>)}{!loading&&!items.length&&<div className="rounded-[24px] border border-dashed border-slate-300 py-16 text-center text-slate-500">No requests submitted yet.</div>}</div></section>
    </section>
  </main>;
}
