'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Table, Td, statusTone } from '@/components/ui';
import { date, money } from '@/lib/format';
import type { Invoice } from '@/lib/types';

const thisPeriod = () => new Date().toISOString().slice(0, 7);

function InvoicesInner() {
  const params = useSearchParams();
  const toast = useToast();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [period, setPeriod] = useState('');
  const schoolId = params.get('schoolId') ?? '';
  const qs = new URLSearchParams({ ...(status && { status }), ...(period && { period }), ...(schoolId && { schoolId }) }).toString();
  const { data, error, loading, reload } = useData<{ invoices: Invoice[] }>(`/admin/invoices${qs ? `?${qs}` : ''}`);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [genPeriod, setGenPeriod] = useState(thisPeriod());
  const [generating, setGenerating] = useState(false);

  async function generateAll() {
    setGenerating(true);
    try {
      const r = await api.post<{ created: number; skipped: number }>('/admin/invoices/generate', { period: genPeriod });
      toast(`${r.created} invoice(s) created, ${r.skipped} already existed`);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function voidInvoice(inv: Invoice) {
    const reason = prompt('Reason for voiding this invoice?');
    if (!reason) return;
    try {
      await api.post(`/admin/invoices/${inv.id}/void`, { reason });
      toast('Invoice voided');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  const totalUnpaid = data?.invoices.filter((i) => i.status === 'UNPAID').reduce((a, i) => a + i.amount, 0) ?? 0;

  return (
    <>
      <PageHeader title="Subscription invoices" subtitle="Monthly bills to schools. Overdue invoices make a school read-only after 7 days and suspended after 30." />
      <Card title="Generate monthly invoices" className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Month">
            <input className="input" type="month" value={genPeriod} onChange={(e) => setGenPeriod(e.target.value)} />
          </Field>
          <Button onClick={generateAll} loading={generating}>
            Generate for all active schools
          </Button>
          <p className="text-xs text-gray-500">Skips schools already invoiced for that month, trials and suspended schools.</p>
        </div>
      </Card>
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PAID">Paid</option>
            <option value="VOID">Void</option>
          </select>
          <input className="input w-auto" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          {schoolId && (
            <Link href="/admin/invoices" className="text-sm text-brand-700 hover:underline">
              Showing one school · show all
            </Link>
          )}
          <span className="ml-auto text-sm text-gray-600">
            Unpaid in list: <strong>{money(totalUnpaid)}</strong>
          </span>
        </div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.invoices.length ? (
          <Empty title="No invoices" />
        ) : (
          <Table head={['School', 'Month', 'Students', 'Amount', 'Due', 'Status', 'Payment', '']}>
            {data.invoices.map((i) => (
              <tr key={i.id}>
                <Td>
                  <Link href={`/admin/schools/${i.schoolId}`} className="font-medium hover:underline">
                    {i.school?.name}
                  </Link>
                </Td>
                <Td>{i.period}</Td>
                <Td>
                  {i.activeStudents}
                  {i.extraStudents > 0 && <span className="text-xs text-gray-500"> (+{i.extraStudents} extra)</span>}
                </Td>
                <Td className="font-medium">{money(i.amount)}</Td>
                <Td>{date(i.dueDate)}</Td>
                <Td>
                  <Badge tone={i.overdue ? 'red' : statusTone[i.status]}>{i.overdue ? 'Overdue' : i.status}</Badge>
                </Td>
                <Td className="text-gray-600">
                  {i.paidAt ? `${money(i.paidAmount)} · ${i.paymentMethod} · ${date(i.paidAt)}` : i.status === 'VOID' ? i.notes : '—'}
                </Td>
                <Td className="text-right">
                  {i.status === 'UNPAID' && (
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" onClick={() => setPaying(i)}>
                        Record payment
                      </Button>
                      <Button variant="ghost" onClick={() => voidInvoice(i)}>
                        Void
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {paying && (
        <PayModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onDone={(restored) => {
            setPaying(null);
            toast(restored ? 'Payment recorded. School is active again.' : 'Payment recorded');
            reload();
          }}
        />
      )}
    </>
  );
}

function PayModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: (restored: boolean) => void }) {
  const [f, setF] = useState({ amount: String(invoice.amount), method: 'Bank transfer', reference: '', paidAt: new Date().toISOString().slice(0, 10), notes: '' });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post<{ schoolRestored: boolean }>(`/admin/invoices/${invoice.id}/pay`, { ...f, amount: Number(f.amount) });
      onDone(r.schoolRestored);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Payment: ${invoice.school?.name} · ${invoice.period}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Amount received">
          <input className="input" type="number" step="0.01" min={0.01} required value={f.amount} onChange={set('amount')} />
        </Field>
        <Field label="Method">
          <select className="input" value={f.method} onChange={set('method')}>
            {['Bank transfer', 'Cash', 'JazzCash', 'Easypaisa', 'Cheque', 'Other'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Reference / transaction ID (optional)">
          <input className="input" value={f.reference} onChange={set('reference')} />
        </Field>
        <Field label="Date received">
          <input className="input" type="date" required value={f.paidAt} onChange={set('paidAt')} />
        </Field>
        <Field label="Notes (optional)">
          <input className="input" value={f.notes} onChange={set('notes')} />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" loading={saving}>
          Mark as paid
        </Button>
      </form>
    </Modal>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <InvoicesInner />
    </Suspense>
  );
}
