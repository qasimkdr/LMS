import { AccountBalanceWalletRounded, CheckCircleRounded, PrintRounded, ReceiptLongRounded, WarningAmberRounded } from '@mui/icons-material';
import { Alert, Button, CircularProgress, Skeleton } from '@mui/material';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';

const money = (n: number) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0);
const prettyStatus = (value: string) => value.replaceAll('_', ' ');

function statusClass(status: string) {
  if (status === 'PAID') return 'bg-emerald-100 text-emerald-700';
  if (status === 'PENDING_HANDOVER' || status === 'PARTIAL_PENDING') return 'bg-amber-100 text-amber-700';
  if (status === 'PARTIAL') return 'bg-blue-100 text-blue-700';
  return 'bg-rose-100 text-rose-700';
}

export default function StudentFeeLedger() {
  const [params] = useSearchParams();
  const studentProfileId = params.get('studentProfileId') || undefined;
  const [data, setData] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/fee-ledger/ledger', { params: { studentProfileId, months: 12 } })
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.message ?? 'Could not load fee ledger.'))
      .finally(() => setLoading(false));
  }, [studentProfileId]);

  const showReceipt = async (id: string) => {
    setBusy(id);
    try {
      setReceipt((await api.get(`/fee-ledger/receipt/${id}`)).data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not load receipt.');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <main className="min-h-screen bg-[#f7f9ff] p-6"><div className="mx-auto max-w-6xl space-y-4">{[1, 2, 3, 4].map((x) => <Skeleton key={x} height={130} variant="rounded" sx={{ borderRadius: 5 }} />)}</div></main>;
  }

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e9f3ff,transparent_32%),radial-gradient(circle_at_top_right,#efffed,transparent_28%),#f8faff] p-4 text-slate-800 md:p-8">
    <style>{`@media print { body * { visibility: hidden !important; } #fee-receipt, #fee-receipt * { visibility: visible !important; } #fee-receipt { position: absolute; inset: 0 auto auto 0; width: 100%; max-width: none !important; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; } }`}</style>
    <section className="mx-auto max-w-6xl">
      {error && <Alert severity="error" className="mb-4">{error}</Alert>}
      {data && <>
        <header className="rounded-[32px] border border-white bg-white/85 p-6 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[.2em] text-indigo-600">Student finance</p>
          <h1 className="mt-2 text-3xl font-black">Fee Ledger</h1>
          <p className="mt-2 text-slate-500">{data.student.name} · {data.student.admissionNo} · {data.student.className}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
            <span className="rounded-full bg-indigo-50 px-3 py-1">Monthly fee {money(data.feeSettings?.monthlyFee ?? data.monthlyFee)}</span>
            <span className="rounded-full bg-blue-50 px-3 py-1">Due day {data.feeSettings?.dueDay ?? 10}</span>
            <span className="rounded-full bg-amber-50 px-3 py-1">Late fine {money(data.feeSettings?.lateFineAmount ?? 0)}</span>
            <span className="rounded-full bg-violet-50 px-3 py-1">Grace {data.feeSettings?.lateFineGraceDays ?? 0} days</span>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [AccountBalanceWalletRounded, '12 month expected', data.summary.expected],
            [CheckCircleRounded, 'Received', data.summary.received],
            [ReceiptLongRounded, 'Principal verified', data.summary.approved],
            [WarningAmberRounded, 'Outstanding', data.summary.outstanding],
          ].map(([Icon, label, value]: any) => <article key={label} className="rounded-[24px] border border-white bg-white/90 p-5 shadow-lg">
            <Icon className="text-indigo-600" />
            <p className="mt-3 text-xs font-black uppercase text-slate-400">{label}</p>
            <p className="mt-1 text-2xl font-black">{money(value)}</p>
          </article>)}
        </section>

        <section className="mt-6 overflow-hidden rounded-[30px] border border-white bg-white/90 shadow-xl">
          <div className="p-6">
            <h2 className="text-xl font-black">Monthly history</h2>
            <p className="text-sm text-slate-500">Installments are combined for the monthly balance, while every individual payment keeps its own receipt and handover status.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>{['Month', 'Expected', 'Adjustments', 'Received', 'Balance', 'Due', 'Status', 'Receipts'].map((x) => <th key={x} className="p-4">{x}</th>)}</tr>
              </thead>
              <tbody>
                {data.ledger.map((row: any) => <tr key={row.month} className="border-t border-slate-100 align-top">
                  <td className="p-4 font-black">{row.month}</td>
                  <td className="p-4">
                    <p className="font-bold">{money(row.expected)}</p>
                    <p className="mt-1 text-xs text-slate-400">Base {money(row.baseFee)}</p>
                  </td>
                  <td className="p-4 text-xs">
                    {row.discount > 0 && <p className="font-bold text-emerald-700">− {money(row.discount)} discount</p>}
                    {row.manualFine > 0 && <p className="font-bold text-rose-600">+ {money(row.manualFine)} fine</p>}
                    {row.autoFine > 0 && <p className="font-bold text-amber-700">+ {money(row.autoFine)} late fine</p>}
                    {!row.discount && !row.manualFine && !row.autoFine && <span className="text-slate-400">None</span>}
                  </td>
                  <td className="p-4">
                    <p className="font-bold text-emerald-700">{money(row.paid)}</p>
                    {row.pending > 0 && <p className="mt-1 text-xs font-bold text-amber-600">{money(row.pending)} awaiting handover</p>}
                  </td>
                  <td className="p-4 font-bold text-rose-600">{money(row.balance)}</td>
                  <td className="p-4 text-xs">
                    <p>{new Date(row.dueDate).toLocaleDateString()}</p>
                    {row.overdue && <p className="mt-1 font-black text-rose-600">Overdue</p>}
                  </td>
                  <td className="p-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(row.status)}`}>{prettyStatus(row.status)}</span></td>
                  <td className="p-4">
                    <div className="flex min-w-[170px] flex-col gap-2">
                      {(row.payments ?? []).length ? row.payments.map((payment: any, index: number) => <Button
                        key={payment.id}
                        size="small"
                        variant="outlined"
                        startIcon={busy === payment.id ? <CircularProgress size={15} /> : <ReceiptLongRounded />}
                        onClick={() => void showReceipt(payment.id)}
                        disabled={busy === payment.id}
                        sx={{ justifyContent: 'flex-start', borderRadius: 2.5 }}
                      >
                        #{index + 1} · {money(payment.amount)} · {payment.approvalStatus === 'PENDING' ? 'Pending' : payment.approvalStatus === 'APPROVED' ? 'Verified' : 'Rejected'}
                      </Button>) : <span className="text-xs text-slate-400">No payment yet</span>}
                    </div>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>
      </>}

      {receipt && <div className="fixed inset-0 z-50 overflow-auto bg-slate-950/55 p-4 backdrop-blur-sm print:static print:bg-white print:p-0">
        <div id="fee-receipt" className="mx-auto mt-8 max-w-xl rounded-[28px] bg-white p-8 shadow-2xl print:mt-0 print:shadow-none">
          <div className="border-b-2 border-slate-900 pb-5 text-center">
            <h2 className="text-2xl font-black">{receipt.school.name}</h2>
            <p className="text-sm text-slate-500">{receipt.school.address || ''} {receipt.school.phone ? `· ${receipt.school.phone}` : ''}</p>
            <p className="mt-3 text-xs font-black uppercase tracking-widest">Fee Payment Receipt</p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-slate-400">Receipt No</p><p className="font-black">{receipt.receiptNo}</p></div>
            <div><p className="text-slate-400">Month</p><p className="font-black">{receipt.payment.month}</p></div>
            <div><p className="text-slate-400">Student</p><p className="font-black">{receipt.student.name}</p></div>
            <div><p className="text-slate-400">Admission No</p><p className="font-black">{receipt.student.admissionNo}</p></div>
            <div><p className="text-slate-400">Class</p><p className="font-black">{receipt.student.className}</p></div>
            <div><p className="text-slate-400">Method</p><p className="font-black">{receipt.payment.method || 'Cash'}</p></div>
          </div>
          <div className="my-7 rounded-2xl bg-emerald-50 p-5 text-center">
            <p className="text-xs font-black uppercase text-emerald-700">Installment received</p>
            <p className="mt-1 text-4xl font-black text-emerald-800">{money(receipt.payment.amount)}</p>
            <p className="mt-2 text-xs text-emerald-700">Status: {receipt.payment.status}</p>
          </div>
          <div className="text-sm">
            <p>Received by <b>{receipt.payment.receivedBy}</b></p>
            <p className="mt-1 text-slate-500">{new Date(receipt.payment.paidAt).toLocaleString()}</p>
            {receipt.payment.reference && <p className="mt-1">Reference: <b>{receipt.payment.reference}</b></p>}
          </div>
          <div className="mt-8 flex gap-3 print:hidden">
            <Button fullWidth variant="outlined" onClick={() => setReceipt(null)}>Close</Button>
            <Button fullWidth variant="contained" startIcon={<PrintRounded />} onClick={() => window.print()}>Print / Save PDF</Button>
          </div>
        </div>
      </div>}
    </section>
  </main>;
}
