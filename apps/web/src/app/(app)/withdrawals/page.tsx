'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Avatar } from '@/components/Avatar';
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, PageHeader, type Tone } from '@/components/ui';
import { date, money } from '@/lib/format';

interface W {
  id: string;
  status: string;
  reason: string;
  leavingDate: string;
  requestedAt: string;
  waivedAmount: number;
  conduct: string | null;
  certificateNo: number | null;
  student: { id: string; fullName: string; admissionNo: string; photoFileId: string | null; classLabel: string; status: string } | null;
  dues?: number;
}
const STATUS: Record<string, { label: string; tone: Tone }> = { REQUESTED: { label: 'In progress', tone: 'amber' }, COMPLETED: { label: 'Left · certificate issued', tone: 'green' }, CANCELLED: { label: 'Cancelled', tone: 'gray' } };

export default function WithdrawalsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Withdrawals />
    </Suspense>
  );
}

function Withdrawals() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useData<{ withdrawals: W[] }>(`/withdrawals${status ? `?status=${status}` : ''}`);
  const open = params.get('id');
  const { me } = useAuth();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <PageHeader title="Leaving & certificates" subtitle="Students leaving school: fee clearance, then the School Leaving Certificate. Start from a student's profile → Leave school." />
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ['', 'All'],
          ['REQUESTED', 'In progress'],
          ['COMPLETED', 'Left'],
          ['CANCELLED', 'Cancelled'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)} className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${status === k ? 'bg-gray-900 text-white shadow' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {l}
          </button>
        ))}
      </div>
      {!data?.withdrawals.length ? (
        <Empty title="No leaving requests">{me?.user.role !== 'STAFF' || me.user.permissions.includes('students.manage') ? 'Open a student profile and choose "Leave school" to start.' : null}</Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.withdrawals.map((w, i) => (
            <li key={w.id} className="reveal" style={{ '--i': i } as CSSProperties}>
              <button onClick={() => router.replace(`/withdrawals?id=${w.id}`)} className="lift flex w-full items-start gap-3 rounded-2xl border border-gray-200/70 bg-white p-4 text-left shadow-sm">
                <Avatar fileId={w.student?.photoFileId ?? null} name={w.student?.fullName ?? '?'} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{w.student?.fullName}</span>
                    <Badge tone={STATUS[w.status].tone}>{STATUS[w.status].label}</Badge>
                  </span>
                  <span className="block text-xs text-gray-500">
                    {w.student?.classLabel} · Adm. {w.student?.admissionNo} · leaving {date(w.leavingDate)}
                  </span>
                  <span className="mt-1 block truncate text-sm text-gray-600">{w.reason}</span>
                  {w.status === 'REQUESTED' && <span className={`mt-1 block text-xs font-medium ${w.dues ? 'text-rose-600' : 'text-emerald-700'}`}>{w.dues ? `Dues to clear: ${money(w.dues, me?.school?.currency)}` : '✓ Fees cleared – ready to complete'}</span>}
                  {w.certificateNo && <span className="mt-1 block text-xs text-gray-500">Certificate no. {w.certificateNo}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <Detail id={open} onClose={() => router.replace('/withdrawals')} onChange={reload} />}
    </>
  );
}

function Detail({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const { data, reload } = useData<{ withdrawal: W; dues: { invoices: { id: string; invoiceNo: string; title: string; total: number; paid: number; balance: number }[]; total: number }; canWaive: boolean }>(`/withdrawals/${id}`);
  const [conduct, setConduct] = useState('Good');
  const [remarks, setRemarks] = useState('');
  const cur = me?.school?.currency;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      reload();
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };
  if (!data) return null;
  const w = data.withdrawal;
  const steps = [
    { label: 'Request', done: true },
    { label: 'Fee clearance', done: w.status === 'COMPLETED' || data.dues.total === 0 },
    { label: 'Certificate', done: w.status === 'COMPLETED' },
  ];
  return (
    <Modal open onClose={onClose} title={`Leaving: ${w.student?.fullName}`} wide>
      <div className="space-y-5">
        <ol className="flex items-center gap-2">
          {steps.map((s, i) => (
            <li key={s.label} className="flex flex-1 items-center gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition ${s.done ? 'animate-pop bg-emerald-500 text-white shadow-md' : 'bg-gray-100 text-gray-500'}`}>{s.done ? '✓' : i + 1}</span>
              <span className={`text-sm ${s.done ? 'font-medium' : 'text-gray-500'}`}>{s.label}</span>
              {i < steps.length - 1 && <span className={`h-0.5 flex-1 rounded ${steps[i + 1].done ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
            </li>
          ))}
        </ol>
        <div className="grid gap-3 rounded-2xl bg-gray-50 p-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-gray-500">Class</div>
            {w.student?.classLabel}
          </div>
          <div>
            <div className="text-xs text-gray-500">Leaving date</div>
            {date(w.leavingDate)}
          </div>
          <div>
            <div className="text-xs text-gray-500">Reason</div>
            {w.reason}
          </div>
        </div>
        {w.status === 'REQUESTED' && (
          <>
            <div>
              <div className="mb-2 text-sm font-semibold">Fee clearance</div>
              {!data.dues.total ? (
                <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ No dues. {w.waivedAmount > 0 && `(${money(w.waivedAmount, cur)} waived by the principal)`}</p>
              ) : (
                <>
                  <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                    {data.dues.invoices.map((i) => (
                      <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>
                          {i.title} <span className="text-xs text-gray-400">{i.invoiceNo}</span>
                        </span>
                        <span className="font-medium text-rose-600">{money(i.balance, cur)}</span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between bg-gray-50 px-3 py-2 text-sm font-semibold">
                      Total due <span className="text-rose-600">{money(data.dues.total, cur)}</span>
                    </li>
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/school/fees?student=${w.student?.id}`}>
                      <Button variant="secondary">Collect fee</Button>
                    </Link>
                    {data.canWaive && (
                      <Button variant="ghost" className="text-rose-600" onClick={() => { const reason = prompt(`Waive ${money(data.dues.total, cur)}? Reason:`); if (reason) act(() => api.post(`/withdrawals/${id}/waive`, { reason }), 'Dues waived'); }}>
                        Waive dues
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Conduct / character">
                <select className="input" value={conduct} onChange={(e) => setConduct(e.target.value)}>
                  {['Excellent', 'Very good', 'Good', 'Satisfactory'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Remarks on certificate (optional)">
                <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={data.dues.total > 0} onClick={() => act(() => api.post(`/withdrawals/${id}/complete`, { conduct, remarks: remarks || null }), 'Certificate issued · student marked as left')}>
                Complete & issue certificate
              </Button>
              <Button variant="ghost" onClick={() => confirm('Cancel this leaving request?') && act(() => api.post(`/withdrawals/${id}/cancel`), 'Request cancelled')}>
                Cancel request
              </Button>
            </div>
            <p className="text-xs text-gray-500">Completing marks the student as Left and switches off the student’s login (and the parent login if no other child is studying).</p>
          </>
        )}
        {w.status === 'COMPLETED' && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
            <span className="text-2xl">🎓</span>
            <span className="flex-1 text-sm text-emerald-900">
              School Leaving Certificate no. <b>{w.certificateNo}</b> issued.
            </span>
            <Link href={`/withdrawals/${id}/certificate`}>
              <Button>Print certificate</Button>
            </Link>
          </div>
        )}
      </div>
    </Modal>
  );
}
