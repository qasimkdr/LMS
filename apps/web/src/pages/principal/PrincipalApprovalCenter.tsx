import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditNoteIcon from '@mui/icons-material/EditNote';
import CancelIcon from '@mui/icons-material/Cancel';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Skeleton, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Approval = {
  id: string; requestType: string; status: string; revision: number; proposedData: Record<string,string>; principalRemark?: string | null; updatedAt: string;
  requester: { firstName: string; lastName: string };
  versions: Array<{ id: string; revision: number; note?: string | null; createdAt: string }>;
};

export default function PrincipalApprovalCenter() {
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [decision, setDecision] = useState<'APPROVE'|'REJECT'|'REVISION_REQUIRED'>('APPROVE');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => { setLoading(true); try { const { data } = await api.get<Approval[]>('/approvals'); setItems(data); } catch { setError('Could not load approval requests.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);

  const review = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try { await api.patch(`/approvals/${selected.id}/review`, { decision, remark: remark || undefined }); setSelected(null); setRemark(''); await load(); }
    catch (e: any) { setError(e?.response?.data?.message ?? 'Review could not be submitted.'); }
    finally { setBusy(false); }
  };

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,#eef4ff,#fff_48%,#fff8ed)] px-4 py-7 sm:px-8">
    <section className="mx-auto max-w-6xl">
      <div className="mb-7"><span className="text-xs font-black uppercase tracking-[.22em] text-violet-600">Principal Workspace</span><h1 className="mt-2 text-3xl font-black text-slate-950">Approval Center</h1><p className="mt-2 text-sm text-slate-500">Review staff proposals before they become live school data.</p></div>
      {error && <Alert severity="error" className="mb-5" onClose={() => setError('')}>{error}</Alert>}
      {loading ? <div className="space-y-3">{Array.from({length:4}).map((_,i)=><Skeleton key={i} variant="rounded" height={120} sx={{borderRadius:5}} />)}</div> : <div className="space-y-3">{items.map((item)=><article key={item.id} className="rounded-[26px] border border-white bg-white/80 p-5 shadow-[0_16px_50px_rgba(50,70,120,.09)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700">{item.status.replaceAll('_',' ')}</span><span className="text-xs font-bold text-slate-400">Revision {item.revision}</span></div><h2 className="mt-3 text-lg font-black text-slate-900">{item.requestType.replaceAll('_',' ')}</h2><p className="mt-1 text-sm text-slate-500">Requested by {item.requester.firstName} {item.requester.lastName}</p></div>
        {(item.status==='PENDING'||item.status==='RESUBMITTED') && <Button variant="contained" onClick={()=>setSelected(item)} sx={{borderRadius:3,fontWeight:900,background:'linear-gradient(90deg,#2563eb,#7c3aed)'}}>Review request</Button>}</div>
        {item.principalRemark && <div className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800"><b>Previous remark:</b> {item.principalRemark}</div>}
      </article>)}{!items.length && <div className="rounded-[26px] border border-dashed border-slate-300 bg-white/60 py-20 text-center text-slate-500">No approval requests yet.</div>}</div>}
    </section>

    <Dialog open={Boolean(selected)} onClose={()=>!busy&&setSelected(null)} fullWidth maxWidth="sm" PaperProps={{sx:{borderRadius:5}}}><DialogTitle sx={{fontWeight:900}}>Review staff request</DialogTitle><DialogContent>
      <div className="mb-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Revision {selected?.revision} · {selected?.requestType.replaceAll('_',' ')}</div>
      <div className="grid grid-cols-3 gap-2 mb-4"><DecisionButton active={decision==='APPROVE'} onClick={()=>setDecision('APPROVE')} icon={<CheckCircleIcon/>} label="Approve" /><DecisionButton active={decision==='REVISION_REQUIRED'} onClick={()=>setDecision('REVISION_REQUIRED')} icon={<EditNoteIcon/>} label="Revise" /><DecisionButton active={decision==='REJECT'} onClick={()=>setDecision('REJECT')} icon={<CancelIcon/>} label="Reject" /></div>
      <TextField fullWidth multiline minRows={3} label={decision==='APPROVE'?'Optional remark':'Remark required'} value={remark} onChange={(e)=>setRemark(e.target.value)} />
    </DialogContent><DialogActions sx={{p:3}}><Button onClick={()=>setSelected(null)} disabled={busy}>Cancel</Button><Button variant="contained" disabled={busy || (decision!=='APPROVE'&&!remark.trim())} onClick={()=>void review()} sx={{borderRadius:3,fontWeight:900}}>{busy?<CircularProgress size={20} color="inherit"/>:'Submit decision'}</Button></DialogActions></Dialog>
  </main>;
}

function DecisionButton({active,onClick,icon,label}:{active:boolean;onClick:()=>void;icon:React.ReactNode;label:string}) { return <button onClick={onClick} className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs font-black transition ${active?'border-blue-400 bg-blue-50 text-blue-700':'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>{icon}{label}</button>; }
