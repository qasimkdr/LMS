import { Alert, Skeleton, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import PrincipalFinanceControls from './PrincipalFinanceControls';

type Student = {
  studentProfileId: string;
  name: string;
  admissionNo: string;
  className: string;
  expectedAmount: number;
  paidAmount: number;
  balance: number;
};

type Dashboard = {
  expected: number;
  received: number;
  principalCollected: number;
  cashPendingWithStaff: number;
  remaining: number;
  studentCards: Student[];
};

const money = (value: number) => `Rs ${Number(value || 0).toLocaleString('en-PK')}`;

export default function PrincipalFinancePage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: dashboard } = await api.get<Dashboard>('/fees/recovery-dashboard', { params: { month } });
      setData(dashboard);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not load finance workspace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [month]);

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#edf4ff,transparent_32%),radial-gradient(circle_at_top_right,#f3edff,transparent_28%),#f8faff] p-4 text-slate-800 md:p-8">
    <section className="mx-auto max-w-7xl">
      <header className="rounded-[32px] border border-white bg-white/85 p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div><p className="text-xs font-black uppercase tracking-[.22em] text-violet-600">Principal finance</p><h1 className="mt-2 text-3xl font-black md:text-4xl">Finance Control Center</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">Configure class fees, apply student adjustments, review recovery trends and keep Staff cash handovers accountable.</p></div>
          <TextField type="month" label="Finance month" value={month} onChange={(e) => setMonth(e.target.value)} InputLabelProps={{ shrink: true }} />
        </div>
      </header>

      {error && <Alert severity="error" className="mt-5" onClose={() => setError('')}>{error}</Alert>}
      {loading ? <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[1,2,3,4,5,6].map((item) => <Skeleton key={item} height={130} variant="rounded" sx={{ borderRadius: 5 }} />)}</div> : data && <>
        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ['Adjusted expected', money(data.expected)],
            ['Received', money(data.received)],
            ['Principal verified', money(data.principalCollected)],
            ['Cash with Staff', money(data.cashPendingWithStaff)],
            ['Outstanding', money(data.remaining)],
          ].map(([label, value]) => <article key={label} className="rounded-[24px] border border-white bg-white/90 p-5 shadow-lg"><p className="text-xs font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></article>)}
        </section>
        <PrincipalFinanceControls month={month} students={data.studentCards} onChanged={load} />
      </>}
    </section>
  </main>;
}
