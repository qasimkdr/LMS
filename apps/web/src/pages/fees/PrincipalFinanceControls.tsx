import { AddCardRounded, NotificationsActiveRounded, SavingsRounded, TuneRounded } from '@mui/icons-material';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Skeleton, TextField } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';

type Structure = {
  classId: string;
  className: string;
  section?: string | null;
  academicYear?: string | null;
  configured: boolean;
  monthlyAmount: number;
  currency: string;
  dueDay: number;
  lateFineAmount: number;
  lateFineGraceDays: number;
};

type Student = {
  studentProfileId: string;
  name: string;
  admissionNo: string;
  className: string;
  expectedAmount: number;
  paidAmount: number;
  balance: number;
};

type Trend = { month: string; received: number; principalCollected: number; payments: number };
type StaffRow = { rank: number; staffId: string; name: string; studentPayments: number; recovered: number; handedOver: number; cashPending: number };

type Props = {
  month: string;
  students: Student[];
  onChanged: () => Promise<void> | void;
};

const money = (value: number) => `Rs ${Number(value || 0).toLocaleString('en-PK')}`;

export default function PrincipalFinanceControls({ month, students, onChanged }: Props) {
  const [structures, setStructures] = useState<Structure[]>([]);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<Structure | null>(null);
  const [adjustStudent, setAdjustStudent] = useState<Student | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<'DISCOUNT' | 'SCHOLARSHIP' | 'WAIVER' | 'FINE'>('DISCOUNT');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [structureRes, trendRes, staffRes] = await Promise.all([
        api.get<Structure[]>('/finance-settings/structures'),
        api.get<Trend[]>('/fee-ledger/collection-trends', { params: { months: 6 } }),
        api.get<StaffRow[]>('/fee-ledger/staff-ranking', { params: { month } }),
      ]);
      setStructures(structureRes.data);
      setTrends(trendRes.data);
      setStaff(staffRes.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not load Principal finance controls.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [month]);

  const configured = useMemo(() => structures.filter((row) => row.configured).length, [structures]);

  const saveStructure = async () => {
    if (!editing) return;
    setBusy('structure');
    setError('');
    try {
      await api.put(`/finance-settings/structures/${editing.classId}`, {
        monthlyAmount: Number(editing.monthlyAmount),
        currency: editing.currency || 'PKR',
        dueDay: Number(editing.dueDay),
        lateFineAmount: Number(editing.lateFineAmount),
        lateFineGraceDays: Number(editing.lateFineGraceDays),
      });
      setEditing(null);
      setMessage('Class fee settings saved.');
      await load();
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not save class fee settings.');
    } finally {
      setBusy('');
    }
  };

  const createAdjustment = async () => {
    if (!adjustStudent) return;
    setBusy('adjustment');
    setError('');
    try {
      await api.post('/fee-adjustments/adjustments', {
        studentProfileId: adjustStudent.studentProfileId,
        month,
        type: adjustmentType,
        amount: Number(adjustmentAmount),
        reason: adjustmentReason || undefined,
      });
      setAdjustStudent(null);
      setAdjustmentAmount('');
      setAdjustmentReason('');
      setMessage(`${adjustmentType.toLowerCase()} applied for ${month}.`);
      await onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not apply fee adjustment.');
    } finally {
      setBusy('');
    }
  };

  const sendReminders = async () => {
    setBusy('reminders');
    setError('');
    try {
      const { data } = await api.post('/fee-adjustments/send-overdue-notifications', { month });
      setMessage(`${data.notificationsSent} overdue reminder${data.notificationsSent === 1 ? '' : 's'} sent for ${data.overdueStudents} student${data.overdueStudents === 1 ? '' : 's'}.`);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not send overdue reminders.');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <section className="mt-6 grid gap-4 lg:grid-cols-2">{[1, 2, 3, 4].map((item) => <Skeleton key={item} variant="rounded" height={210} sx={{ borderRadius: 5 }} />)}</section>;

  return <section className="mt-6 space-y-6">
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}

    <section className="rounded-[30px] border border-white bg-white/90 p-6 shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.2em] text-violet-600">Principal controls</p>
          <h2 className="mt-2 text-2xl font-black">Finance configuration</h2>
          <p className="mt-1 text-sm text-slate-500">{configured} of {structures.length} classes have a fee structure.</p>
        </div>
        <Button variant="contained" startIcon={busy === 'reminders' ? <CircularProgress size={16} color="inherit" /> : <NotificationsActiveRounded />} disabled={busy === 'reminders'} onClick={() => void sendReminders()} sx={{ borderRadius: 3, fontWeight: 900, background: 'linear-gradient(90deg,#f59e0b,#ef4444)' }}>Send overdue reminders</Button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {structures.map((row) => <article key={row.classId} className={`rounded-[22px] border p-4 ${row.configured ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-100 bg-amber-50/60'}`}>
          <div className="flex items-start justify-between gap-3">
            <div><p className="font-black text-slate-900">{row.className}{row.section ? ` - ${row.section}` : ''}</p><p className="text-xs text-slate-500">{row.academicYear || 'Academic year not set'}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${row.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.configured ? 'CONFIGURED' : 'SETUP NEEDED'}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-slate-400">Monthly fee</p><p className="mt-1 text-lg font-black">{money(row.monthlyAmount)}</p></div><div><p className="text-slate-400">Due / grace</p><p className="mt-1 font-black">Day {row.dueDay} · {row.lateFineGraceDays}d</p></div><div><p className="text-slate-400">Late fine</p><p className="mt-1 font-black">{money(row.lateFineAmount)}</p></div><div><p className="text-slate-400">Currency</p><p className="mt-1 font-black">{row.currency}</p></div></div>
          <Button fullWidth variant="outlined" startIcon={<TuneRounded />} onClick={() => setEditing({ ...row })} sx={{ mt: 2, borderRadius: 2.5, fontWeight: 800 }}>{row.configured ? 'Edit fee settings' : 'Configure class fee'}</Button>
        </article>)}
      </div>
    </section>

    <section className="grid gap-6 xl:grid-cols-2">
      <article className="rounded-[30px] border border-white bg-white/90 p-6 shadow-xl">
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 p-3 text-white"><SavingsRounded /></div><div><h2 className="text-xl font-black">Collection trend</h2><p className="text-sm text-slate-500">Received vs cash verified by Principal.</p></div></div>
        <div className="mt-5 h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={trends}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Bar dataKey="received" name="Received" radius={[8, 8, 0, 0]} /><Bar dataKey="principalCollected" name="Principal verified" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </article>

      <article className="rounded-[30px] border border-white bg-white/90 p-6 shadow-xl">
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 p-3 text-white"><AddCardRounded /></div><div><h2 className="text-xl font-black">Staff collection accountability</h2><p className="text-sm text-slate-500">Collection activity and cash still awaiting handover for {month}.</p></div></div>
        <div className="mt-5 space-y-3">{staff.length ? staff.map((row) => <div key={row.staffId} className="rounded-2xl bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-black">#{row.rank} · {row.name}</p><p className="text-xs text-slate-500">{row.studentPayments} payment records</p></div><p className={`text-sm font-black ${row.cashPending > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{money(row.cashPending)} pending</p></div><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><p className="text-slate-400">Recovered</p><p className="font-black">{money(row.recovered)}</p></div><div><p className="text-slate-400">Handed over</p><p className="font-black text-emerald-700">{money(row.handedOver)}</p></div></div></div>) : <p className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500">No Staff fee collections for this month.</p>}</div>
      </article>
    </section>

    <section className="rounded-[30px] border border-white bg-white/90 p-6 shadow-xl">
      <div><h2 className="text-xl font-black">Student adjustments</h2><p className="text-sm text-slate-500">Apply discounts, scholarships, waivers or fines to the selected recovery month.</p></div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{students.map((student) => <button key={student.studentProfileId} onClick={() => { setAdjustStudent(student); setAdjustmentAmount(''); setAdjustmentReason(''); }} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50"><p className="font-black">{student.name}</p><p className="text-xs text-slate-500">{student.admissionNo} · {student.className}</p><div className="mt-3 flex justify-between text-xs"><span>Expected {money(student.expectedAmount)}</span><span className="font-black text-rose-600">Balance {money(student.balance)}</span></div></button>)}</div>
    </section>

    <Dialog open={!!editing} onClose={() => busy !== 'structure' && setEditing(null)} fullWidth maxWidth="sm">
      <DialogTitle>{editing?.configured ? 'Edit class fee settings' : 'Configure class fee'}</DialogTitle>
      <DialogContent className="grid gap-4 pt-3">
        <p className="font-black">{editing?.className}{editing?.section ? ` - ${editing.section}` : ''}</p>
        <TextField label="Monthly fee" type="number" value={editing?.monthlyAmount ?? 0} onChange={(e) => editing && setEditing({ ...editing, monthlyAmount: Number(e.target.value) })} inputProps={{ min: 0, step: '0.01' }} />
        <TextField label="Currency" value={editing?.currency ?? 'PKR'} onChange={(e) => editing && setEditing({ ...editing, currency: e.target.value.toUpperCase() })} />
        <TextField label="Due day of month" type="number" value={editing?.dueDay ?? 10} onChange={(e) => editing && setEditing({ ...editing, dueDay: Number(e.target.value) })} inputProps={{ min: 1, max: 28 }} />
        <TextField label="Late fine" type="number" value={editing?.lateFineAmount ?? 0} onChange={(e) => editing && setEditing({ ...editing, lateFineAmount: Number(e.target.value) })} inputProps={{ min: 0, step: '0.01' }} />
        <TextField label="Grace days" type="number" value={editing?.lateFineGraceDays ?? 0} onChange={(e) => editing && setEditing({ ...editing, lateFineGraceDays: Number(e.target.value) })} inputProps={{ min: 0, max: 30 }} />
      </DialogContent>
      <DialogActions><Button disabled={busy === 'structure'} onClick={() => setEditing(null)}>Cancel</Button><Button variant="contained" disabled={busy === 'structure'} onClick={() => void saveStructure()}>{busy === 'structure' ? <CircularProgress size={20} /> : 'Save settings'}</Button></DialogActions>
    </Dialog>

    <Dialog open={!!adjustStudent} onClose={() => busy !== 'adjustment' && setAdjustStudent(null)} fullWidth maxWidth="sm">
      <DialogTitle>Apply fee adjustment</DialogTitle>
      <DialogContent className="grid gap-4 pt-3">
        <div className="rounded-2xl bg-slate-50 p-4"><p className="font-black">{adjustStudent?.name}</p><p className="text-xs text-slate-500">{adjustStudent?.admissionNo} · {adjustStudent?.className} · {month}</p></div>
        <TextField select label="Adjustment type" value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value as typeof adjustmentType)}>{['DISCOUNT', 'SCHOLARSHIP', 'WAIVER', 'FINE'].map((item) => <MenuItem key={item} value={item}>{item.replaceAll('_', ' ')}</MenuItem>)}</TextField>
        <TextField label="Amount" type="number" value={adjustmentAmount} onChange={(e) => setAdjustmentAmount(e.target.value)} inputProps={{ min: 0, step: '0.01' }} />
        <TextField label="Reason" multiline minRows={2} value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} />
      </DialogContent>
      <DialogActions><Button disabled={busy === 'adjustment'} onClick={() => setAdjustStudent(null)}>Cancel</Button><Button variant="contained" disabled={busy === 'adjustment' || !Number(adjustmentAmount)} onClick={() => void createAdjustment()}>{busy === 'adjustment' ? <CircularProgress size={20} /> : 'Apply adjustment'}</Button></DialogActions>
    </Dialog>
  </section>;
}
