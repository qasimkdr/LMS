'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '../useData';
import { useToast } from '../toast';
import { Avatar } from '../Avatar';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading } from '../ui';
import { date } from '@/lib/format';
import { className } from '@/lib/types';
import { invLabel, invTone, localToday, methodLabel, useFeePerms, useMoney } from './shared';

interface LookupRow {
  id: string;
  fullName: string;
  admissionNo: string;
  status: string;
  photoFileId: string | null;
  familyId: string;
  class: { name: string; stream: string | null };
  section: { name: string } | null;
  family: { familyNo: string; guardians: { fullName: string }[] };
  familyDue: number;
}
interface Dues {
  family: { id: string; familyNo: string; guardians: { relation: string; fullName: string; phone: string | null }[]; students: { id: string; fullName: string; admissionNo: string; status: string; photoFileId: string | null; class: { name: string; stream: string | null }; section: { name: string } | null; discountType: string | null; discountPercent: number }[] };
  invoices: { id: string; invoiceNo: string; title: string; period: string | null; studentId: string; total: number; paidAmount: number; balance: number; dueDate: string; overdue: boolean; lateFeeIfPaidToday: number; status: string; lines: { description: string; amount: number }[] }[];
  due: number;
  lateFee: number;
  credit: number;
  payable: number;
  recentPayments: { id: string; receiptNo: string; amount: number; method: string; receivedAt: string; status: string }[];
}

/** Counter collection: find the family, choose what to pay, take the money, print the receipt. */
export function Collect({ initialFamily }: { initialFamily?: string }) {
  const toast = useToast();
  const money = useMoney();
  const perms = useFeePerms();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LookupRow[] | null>(null);
  const [familyId, setFamilyId] = useState(initialFamily ?? '');
  const { data, error, loading, reload } = useData<Dues>(familyId ? `/fees/families/${familyId}/dues` : null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [chargeLate, setChargeLate] = useState(true);
  const [receivedAt, setReceivedAt] = useState(localToday());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ paymentId: string; receiptNo: string; credit: number; whatsappQueued: number } | null>(null);
  const [formError, setFormError] = useState<unknown>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setResults(null);
    const t = setTimeout(() => api.get<{ students: LookupRow[] }>(`/fees/lookup?q=${encodeURIComponent(q.trim())}`).then((r) => setResults(r.students)).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!data) return;
    setSelected(new Set(data.invoices.map((i) => i.id)));
  }, [data]);

  const chosen = useMemo(() => data?.invoices.filter((i) => selected.has(i.id)) ?? [], [data, selected]);
  const late = chargeLate ? chosen.reduce((a, i) => a + i.lateFeeIfPaidToday, 0) : 0;
  const total = Math.round((chosen.reduce((a, i) => a + i.balance, 0) + late) * 100) / 100;
  useEffect(() => setAmount(total ? String(total) : ''), [total]);

  async function submit() {
    setSaving(true);
    setFormError(null);
    try {
      const allSelected = data && chosen.length === data.invoices.length;
      const r = await api.post<{ paymentId: string; receiptNo: string; credit: number; whatsappQueued: number }>('/fees/payments', {
        familyId,
        invoiceIds: allSelected ? undefined : chosen.map((i) => i.id),
        amount: Number(amount),
        method,
        reference: reference || undefined,
        chargeLateFee: chargeLate,
        receivedAt: receivedAt !== localToday() ? receivedAt : undefined,
      });
      setDone(r);
      toast(`Receipt ${r.receiptNo} saved${r.whatsappQueued ? ' and sent to parents on WhatsApp' : ''}`);
      reload();
    } catch (e) {
      setFormError(e);
    } finally {
      setSaving(false);
    }
  }

  const studentName = (id: string) => data?.family.students.find((s) => s.id === id)?.fullName ?? '';

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Find student or family">
          <input className="input" autoFocus placeholder="Name, admission no, father, phone, family no" value={q} onChange={(e) => setQ(e.target.value)} />
          {results && (
            <ul className="mt-2 divide-y divide-gray-100">
              {results.length === 0 && <li className="py-3 text-center text-sm text-gray-500">No matches</li>}
              {results.map((s) => (
                <li key={s.id}>
                  <button
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-50 ${s.familyId === familyId ? 'bg-brand-50' : ''}`}
                    onClick={() => {
                      setFamilyId(s.familyId);
                      setDone(null);
                      setQ('');
                      setResults(null);
                    }}
                  >
                    <Avatar fileId={s.photoFileId} name={s.fullName} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.fullName}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {className(s.class, s.section)} · Family {s.family.familyNo}
                        {s.family.guardians[0] && ` · ${s.family.guardians[0].fullName}`}
                      </span>
                    </span>
                    <span className={`text-sm font-semibold ${s.familyDue ? 'text-red-600' : 'text-emerald-600'}`}>{s.familyDue ? money(s.familyDue) : 'Clear'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {data && (
          <Card title={`Family ${data.family.familyNo}`}>
            <ul className="space-y-2">
              {data.family.students.map((s) => (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <Avatar fileId={s.photoFileId} name={s.fullName} size={32} />
                  <span className="min-w-0 flex-1">
                    <Link href={`/school/students/${s.id}`} className="block truncate font-medium hover:underline">
                      {s.fullName}
                    </Link>
                    <span className="text-xs text-gray-500">
                      {className(s.class, s.section)}
                      {s.discountType && ` · ${s.discountType}${s.discountPercent ? ` ${s.discountPercent}%` : ''}`}
                    </span>
                  </span>
                  {s.status !== 'ACTIVE' && <Badge>{s.status}</Badge>}
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-600">
              {data.family.guardians.map((g) => (
                <div key={g.fullName}>
                  {g.fullName} {g.phone && `· ${g.phone}`}
                </div>
              ))}
            </div>
            {data.recentPayments.length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="mb-1 text-xs font-semibold uppercase text-gray-500">Recent receipts</div>
                <ul className="space-y-1 text-sm">
                  {data.recentPayments.slice(0, 5).map((p) => (
                    <li key={p.id} className={`flex justify-between ${p.status === 'CANCELLED' ? 'text-gray-400 line-through' : ''}`}>
                      <Link href={`/school/fees/receipt/${p.id}`} className="hover:underline">
                        {p.receiptNo} · {date(p.receivedAt)}
                      </Link>
                      <span>{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="lg:col-span-3">
        {!familyId ? (
          <Empty title="Search for a student to collect fees" />
        ) : loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : data ? (
          <div className="space-y-4">
            {done && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="font-semibold text-emerald-900">Receipt {done.receiptNo} saved</div>
                {done.credit > 0 && <div className="text-sm text-emerald-900">{money(done.credit)} kept as advance for next months.</div>}
                <div className="mt-3 flex gap-2">
                  <Link href={`/school/fees/receipt/${done.paymentId}`}>
                    <Button>Print receipt</Button>
                  </Link>
                  <Button variant="secondary" onClick={() => { setDone(null); setFamilyId(''); }}>
                    Next family
                  </Button>
                </div>
              </div>
            )}
            <Card title="Dues">
              {data.invoices.length === 0 ? (
                <p className="text-sm text-emerald-700">No dues.{data.credit > 0 && ` Advance balance: ${money(data.credit)}.`}</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.invoices.map((i) => (
                    <li key={i.id} className="py-2.5">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selected.has(i.id)}
                          onChange={(e) => {
                            const s = new Set(selected);
                            if (e.target.checked) s.add(i.id);
                            else s.delete(i.id);
                            setSelected(s);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {studentName(i.studentId)} · {i.title}
                            <Badge tone={invTone[i.status]}>{invLabel[i.status]}</Badge>
                            {i.overdue && <Badge tone="red">Overdue</Badge>}
                          </span>
                          <span className="block text-xs text-gray-500">
                            {i.invoiceNo} · due {date(i.dueDate)} · {i.lines.map((l) => `${l.description} ${Math.round(l.amount)}`).join(', ')}
                          </span>
                        </span>
                        <span className="text-right text-sm">
                          <span className="block font-semibold">{money(i.balance)}</span>
                          {i.paidAmount > 0 && <span className="block text-xs text-gray-500">of {money(i.total)}</span>}
                          {i.lateFeeIfPaidToday > 0 && <span className="block text-xs text-red-600">+ late {money(i.lateFeeIfPaidToday)}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Receive payment">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount received" hint={total ? `Selected: ${money(total)}. More than this is kept as advance.` : 'Any amount is kept as advance.'}>
                  <input className="input text-lg font-semibold" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Method">
                  <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {['CASH', 'BANK', 'CHEQUE', 'OTHER'].map((m) => (
                      <option key={m} value={m}>
                        {methodLabel[m]}
                      </option>
                    ))}
                  </select>
                </Field>
                {method !== 'CASH' && (
                  <Field label="Reference" hint="Deposit slip, cheque or transaction no.">
                    <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
                  </Field>
                )}
                {perms.isPrincipal && (
                  <Field label="Date received">
                    <input className="input" type="date" max={localToday()} value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
                  </Field>
                )}
                {data.lateFee > 0 && (
                  <label className={`flex items-center gap-2 text-sm sm:col-span-2 ${perms.manage ? '' : 'opacity-60'}`}>
                    <input type="checkbox" checked={chargeLate} disabled={!perms.manage} onChange={(e) => setChargeLate(e.target.checked)} />
                    Charge late fee ({money(chosen.reduce((a, i) => a + i.lateFeeIfPaidToday, 0))}){!perms.manage && ' — only the principal can waive it'}
                  </label>
                )}
              </div>
              <div className="mt-4 space-y-3">
                <ErrorBox error={formError} />
                <Button onClick={submit} loading={saving} disabled={!Number(amount)} className="w-full sm:w-auto">
                  Save and print receipt
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
