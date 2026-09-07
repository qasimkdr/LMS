import { AccountBalanceWalletRounded, CheckCircleRounded, GroupsRounded, PaymentsRounded, ReceiptLongRounded, WarningAmberRounded } from '@mui/icons-material';
import { Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Skeleton, TextField } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider';
import { api } from '../../lib/api';

type StudentCard = {
  studentProfileId: string;
  name: string;
  admissionNo: string;
  className: string;
  monthlyFee: number;
  expectedAmount: number;
  paidAmount: number;
  approvedAmount: number;
  cashPending: number;
  balance: number;
  discount: number;
  manualFine: number;
  autoFine: number;
  dueDate?: string | null;
  overdue: boolean;
  status: string;
  configured: boolean;
};
type ClassRow = { classId: string; className: string; monthlyAmount: number; students: number; paid: number; remaining: number; expected: number; collected: number; pending: number; recoveryRate: number };
type Batch = { id: string; status: string; totalAmount: number; studentCount: number; firstName: string; lastName: string; createdAt: string; submittedAt?: string | null };
type Dashboard = { month: string; expected: number; received: number; principalCollected: number; cashPendingWithStaff: number; remaining: number; paidStudents: number; totalStudents: number; unconfiguredStudents: number; classRows: ClassRow[]; studentCards: StudentCard[]; batches: Batch[] };
type Due = { studentProfileId: string; name: string; admissionNo: string; className: string; monthlyFee: number; unpaidMonths: number; overdueMonths?: number; dueAmount: number; missingMonths: string[]; configured?: boolean };

const money = (n: number) => `Rs ${Number(n || 0).toLocaleString()}`;
const prettyStatus = (value: string) => value.replaceAll('_', ' ');

function statusColor(status: string): 'success' | 'warning' | 'info' | 'error' | 'default' {
  if (status === 'PAID') return 'success';
  if (status === 'PENDING_HANDOVER' || status === 'PARTIAL_PENDING') return 'warning';
  if (status === 'PARTIAL') return 'info';
  if (status === 'NO_STRUCTURE') return 'default';
  return 'error';
}

export default function FeeRecoveryPage() {
  const { user } = useAuth();
  const principal = user?.role === 'PRINCIPAL';
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Dashboard | null>(null);
  const [dues, setDues] = useState<Due[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [payStudent, setPayStudent] = useState<StudentCard | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [batch, setBatch] = useState<any | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboard, dueRows] = await Promise.all([
        api.get('/fees/recovery-dashboard', { params: { month } }),
        api.get('/fees/student-dues', { params: { months: 12 } }),
      ]);
      setData(dashboard.data);
      setDues(dueRows.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not load fee recovery.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [month]);

  const openBatch = useMemo(() => data?.batches.find((item) => item.status === 'OPEN'), [data]);
  const submitted = data?.batches.filter((item) => item.status === 'SUBMITTED') ?? [];

  const openPayment = (student: StudentCard) => {
    setPayStudent(student);
    setAmount(student.balance > 0 ? String(student.balance) : '');
    setReference('');
  };

  const receive = async () => {
    if (!payStudent) return;
    setBusy('pay');
    setError('');
    try {
      await api.post('/fees/receive', {
        studentProfileId: payStudent.studentProfileId,
        month,
        amount: Number(amount),
        method,
        reference: reference || undefined,
      });
      setPayStudent(null);
      setAmount('');
      setReference('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not record fee.');
    } finally {
      setBusy('');
    }
  };

  const submitBatch = async (id: string) => {
    setBusy(id);
    try {
      await api.post(`/fees/batches/${id}/submit`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not submit batch.');
    } finally {
      setBusy('');
    }
  };

  const inspect = async (id: string) => {
    setBusy(id);
    try {
      setBatch((await api.get(`/fees/batches/${id}`)).data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not load batch.');
    } finally {
      setBusy('');
    }
  };

  const collect = async (id: string) => {
    setBusy(id);
    try {
      await api.patch(`/fees/batches/${id}/collect`, {});
      setBatch(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not collect batch.');
    } finally {
      setBusy('');
    }
  };

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eaf4ff,transparent_32%),radial-gradient(circle_at_top_right,#fff2df,transparent_30%),#f7f9ff] p-4 text-slate-800 md:p-8">
    <section className="mx-auto max-w-7xl">
      <header className="rounded-[32px] border border-white bg-white/85 p-6 shadow-[0_30px_90px_rgba(70,90,140,.14)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[.22em] text-emerald-600">Finance intelligence</p>
            <h1 className="mt-2 text-3xl font-black md:text-4xl">Fee Recovery Center</h1>
            <p className="mt-2 max-w-2xl text-slate-500">Adjusted dues, installments, staff cash accountability and money actually handed over to the Principal.</p>
          </div>
          <TextField label="Recovery month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} InputLabelProps={{ shrink: true }} />
        </div>
      </header>

      {error && <Alert severity="error" className="mt-5" onClose={() => setError('')}>{error}</Alert>}

      {loading ? <div className="mt-6 grid gap-4 md:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((x) => <Skeleton key={x} height={120} variant="rounded" sx={{ borderRadius: 5 }} />)}</div> : data && <>
        {data.unconfiguredStudents > 0 && <Alert severity="warning" className="mt-5">{data.unconfiguredStudents} student{data.unconfiguredStudents === 1 ? '' : 's'} currently have no class fee structure and cannot be charged until the Principal configures one.</Alert>}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [PaymentsRounded, 'Adjusted expected', money(data.expected), `${data.totalStudents} configured students`],
            [CheckCircleRounded, 'Received from students', money(data.received), `${data.paidStudents} fully settled`],
            [AccountBalanceWalletRounded, 'Principal collected', money(data.principalCollected), 'verified school cash'],
            [WarningAmberRounded, 'Cash with staff', money(data.cashPendingWithStaff), 'received but awaiting handover'],
            [GroupsRounded, 'Students remaining', String(Math.max(0, data.totalStudents - data.paidStudents)), money(data.remaining) + ' outstanding'],
            [ReceiptLongRounded, 'Recovery rate', `${data.expected ? Math.round((Math.min(data.received, data.expected) / data.expected) * 1000) / 10 : 100}%`, 'against adjusted dues'],
          ].map(([Icon, title, value, note]: any) => <article key={title} className="rounded-[26px] border border-white bg-white/90 p-5 shadow-xl transition hover:-translate-y-1">
            <div className="inline-flex rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 p-3 text-white"><Icon /></div>
            <p className="mt-4 text-xs font-bold uppercase tracking-wider text-slate-400">{title}</p>
            <p className="mt-1 text-2xl font-black">{value}</p>
            <p className="mt-1 text-sm text-slate-500">{note}</p>
          </article>)}
        </section>

        {!principal && <section className="mt-6 rounded-[30px] border border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 p-6 shadow-xl">
          <h2 className="text-xl font-black">My cash handover</h2>
          {openBatch ? <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div><p className="text-3xl font-black">{money(openBatch.totalAmount)}</p><p className="text-sm text-slate-600">{openBatch.studentCount} students currently represented in your pending cash batch</p></div>
            <div className="flex gap-2"><Button variant="outlined" onClick={() => void inspect(openBatch.id)}>View payments</Button><Button variant="contained" disabled={busy === openBatch.id || !Number(openBatch.studentCount)} onClick={() => void submitBatch(openBatch.id)}>{busy === openBatch.id ? <CircularProgress size={20} /> : 'Submit to Principal'}</Button></div>
          </div> : <p className="mt-3 text-slate-500">No open cash batch. Receiving a student installment will create one automatically.</p>}
        </section>}

        {principal && submitted.length > 0 && <section className="mt-6 rounded-[30px] border border-emerald-100 bg-white/90 p-6 shadow-xl">
          <h2 className="text-xl font-black">Cash waiting for collection</h2>
          <div className="mt-4 grid gap-3">{submitted.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 p-4"><div><p className="font-black">{item.firstName} {item.lastName}</p><p className="text-sm text-slate-600">{item.studentCount} students · {money(item.totalAmount)}</p></div><Button variant="contained" onClick={() => void inspect(item.id)}>Review & collect</Button></div>)}</div>
        </section>}

        <section className="mt-6 rounded-[30px] border border-white bg-white/90 p-6 shadow-xl">
          <h2 className="text-xl font-black">Student recovery cards</h2>
          <p className="text-sm text-slate-500">Expected amounts already include discounts, scholarships, waivers and applicable fines.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.studentCards.map((student) => <article key={student.studentProfileId} className={`rounded-2xl border p-4 ${student.status === 'PAID' ? 'border-emerald-100 bg-emerald-50/70' : student.status === 'NO_STRUCTURE' ? 'border-slate-200 bg-slate-50/80' : student.overdue ? 'border-rose-100 bg-rose-50/60' : 'border-amber-100 bg-amber-50/50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-black">{student.name}</p><p className="text-xs text-slate-500">{student.admissionNo} · {student.className}</p></div>
                <Chip size="small" label={prettyStatus(student.status)} color={statusColor(student.status)} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-slate-400">Expected</p><p className="mt-1 font-black">{money(student.expectedAmount)}</p></div>
                <div><p className="text-slate-400">Received</p><p className="mt-1 font-black text-emerald-700">{money(student.paidAmount)}</p></div>
                <div><p className="text-slate-400">Balance</p><p className="mt-1 font-black text-rose-600">{money(student.balance)}</p></div>
              </div>
              {(student.discount > 0 || student.manualFine > 0 || student.autoFine > 0) && <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs">
                {student.discount > 0 && <p className="font-bold text-emerald-700">Discount/waiver − {money(student.discount)}</p>}
                {student.manualFine > 0 && <p className="font-bold text-rose-600">Manual fine + {money(student.manualFine)}</p>}
                {student.autoFine > 0 && <p className="font-bold text-amber-700">Late fine + {money(student.autoFine)}</p>}
              </div>}
              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500">{student.cashPending > 0 ? `${money(student.cashPending)} awaiting Principal` : student.overdue ? 'Overdue balance' : student.configured ? 'Current balance' : 'Fee setup required'}</div>
                {student.configured && student.balance > 0 && <Button size="small" variant="contained" onClick={() => openPayment(student)}>Receive</Button>}
              </div>
            </article>)}
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-[30px] border border-white bg-white/90 shadow-xl">
          <div className="p-6"><h2 className="text-xl font-black">Class-wise recovery</h2></div>
          <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-400"><tr>{['Class', 'Paid', 'Remaining', 'Expected', 'Recovered', 'Outstanding', 'Rate'].map((x) => <th key={x} className="p-4">{x}</th>)}</tr></thead><tbody>{data.classRows.map((row) => <tr key={row.classId} className="border-t border-slate-100"><td className="p-4 font-black">{row.className}</td><td className="p-4">{row.paid}/{row.students}</td><td className="p-4 font-bold text-rose-600">{row.remaining}</td><td className="p-4">{money(row.expected)}</td><td className="p-4 text-emerald-700">{money(row.collected)}</td><td className="p-4">{money(row.pending)}</td><td className="p-4"><Chip label={`${row.recoveryRate}%`} color={row.recoveryRate >= 90 ? 'success' : row.recoveryRate >= 70 ? 'warning' : 'error'} /></td></tr>)}</tbody></table></div>
        </section>

        <section className="mt-6 overflow-hidden rounded-[30px] border border-white bg-white/90 shadow-xl">
          <div className="p-6"><h2 className="text-xl font-black">Outstanding fee ranking</h2><p className="text-sm text-slate-500">Last 12 months, adjusted outstanding balances first. Months before the student profile was created are excluded.</p></div>
          <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-400"><tr>{['Rank', 'Student', 'Class', 'Unpaid months', 'Overdue', 'Outstanding', 'Missing months'].map((x) => <th key={x} className="p-4">{x}</th>)}</tr></thead><tbody>{dues.map((due, index) => <tr key={due.studentProfileId} className="border-t border-slate-100"><td className="p-4 font-black">#{index + 1}</td><td className="p-4"><p className="font-black">{due.name}</p><p className="text-xs text-slate-400">{due.admissionNo}</p></td><td className="p-4">{due.className}</td><td className="p-4 font-black text-rose-600">{due.unpaidMonths}</td><td className="p-4 font-bold text-amber-700">{due.overdueMonths ?? 0}</td><td className="p-4 font-black">{money(due.dueAmount)}</td><td className="p-4 text-xs text-slate-500">{due.missingMonths.join(' · ') || 'Clear'}</td></tr>)}</tbody></table></div>
        </section>
      </>}
    </section>

    <Dialog open={!!payStudent} onClose={() => !busy && setPayStudent(null)} fullWidth maxWidth="sm">
      <DialogTitle>Receive fee installment</DialogTitle>
      <DialogContent className="grid gap-4 pt-3">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="font-black">{payStudent?.name} · {month}</p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-xs"><div><p className="text-slate-400">Adjusted due</p><p className="font-black">{money(payStudent?.expectedAmount ?? 0)}</p></div><div><p className="text-slate-400">Already received</p><p className="font-black text-emerald-700">{money(payStudent?.paidAmount ?? 0)}</p></div><div><p className="text-slate-400">Remaining</p><p className="font-black text-rose-600">{money(payStudent?.balance ?? 0)}</p></div></div>
        </div>
        <TextField label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ min: 0, max: payStudent?.balance ?? undefined, step: '0.01' }} />
        <TextField select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>{['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH', 'OTHER'].map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}</TextField>
        <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
      </DialogContent>
      <DialogActions><Button onClick={() => setPayStudent(null)} disabled={busy === 'pay'}>Cancel</Button><Button variant="contained" disabled={busy === 'pay' || !Number(amount) || Number(amount) > Number(payStudent?.balance ?? 0)} onClick={() => void receive()}>{busy === 'pay' ? <CircularProgress size={20} /> : principal ? 'Receive & approve' : 'Receive into my cash batch'}</Button></DialogActions>
    </Dialog>

    <Dialog open={!!batch} onClose={() => setBatch(null)} fullWidth maxWidth="md">
      <DialogTitle>Recovery batch · {batch?.firstName} {batch?.lastName}</DialogTitle>
      <DialogContent>
        <div className="mb-4 rounded-2xl bg-slate-50 p-4"><p className="text-2xl font-black">{money(batch?.totalAmount)}</p><p className="text-sm text-slate-500">{batch?.studentCount} students · {batch?.status}</p></div>
        <div className="max-h-[45vh] overflow-auto">{batch?.payments?.map((payment: any) => <div key={payment.id} className="flex justify-between border-b border-slate-100 py-3"><div><p className="font-bold">{payment.firstName} {payment.lastName}</p><p className="text-xs text-slate-500">{payment.admissionNo} · {payment.className}{payment.section ? ` - ${payment.section}` : ''} · {payment.month} · {payment.approvalStatus}</p></div><p className="font-black">{money(payment.amount)}</p></div>)}</div>
      </DialogContent>
      <DialogActions><Button onClick={() => setBatch(null)}>Close</Button>{principal && batch?.status === 'SUBMITTED' && <Button variant="contained" color="success" disabled={busy === batch.id} onClick={() => void collect(batch.id)}>{busy === batch.id ? <CircularProgress size={20} /> : 'Confirm cash collected'}</Button>}</DialogActions>
    </Dialog>
  </main>;
}
