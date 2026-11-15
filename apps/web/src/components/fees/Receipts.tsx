'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '../useData';
import { useToast } from '../toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Table, Td } from '../ui';
import { dateTime } from '@/lib/format';
import { localToday, methodLabel, useFeePerms, useMoney } from './shared';

interface Payment {
  id: string;
  receiptNo: string;
  amount: number;
  method: string;
  reference: string | null;
  source: string;
  receivedAt: string;
  status: string;
  cancelReason: string | null;
  handoverId: string | null;
  familyNo?: string;
  students?: { id: string; fullName: string }[];
  collectedBy: string | null;
}

export function Receipts() {
  const toast = useToast();
  const money = useMoney();
  const perms = useFeePerms();
  const [from, setFrom] = useState(localToday());
  const [to, setTo] = useState(localToday());
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams({ from, to, ...(method && { method }), ...(status && { status }) });
  const { data, error, loading, reload } = useData<{ payments: Payment[]; total: number; sum: number }>(`/fees/payments?${qs}`);

  async function cancel(p: Payment) {
    const reason = prompt(perms.isPrincipal ? `Cancel receipt ${p.receiptNo}? The vouchers become unpaid again.\n\nReason:` : `Ask the principal to cancel receipt ${p.receiptNo}.\n\nReason:`);
    if (!reason) return;
    try {
      const r = await api.post<{ status: string }>(`/fees/payments/${p.id}/cancel`, { reason });
      toast(r.status === 'CANCELLED' ? 'Receipt cancelled' : 'Cancellation requested');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }
  async function decide(p: Payment, approve: boolean) {
    try {
      await api.post(`/fees/payments/${p.id}/cancel-decision`, { approve });
      toast(approve ? 'Receipt cancelled' : 'Request rejected');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From">
          <input className="input w-auto" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input className="input w-auto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Method">
          <select className="input w-auto" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">All</option>
            {Object.entries(methodLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="VALID">Valid</option>
            <option value="CANCEL_REQUESTED">Cancellation requested</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </Field>
      </div>
      <Card>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.payments.length ? (
          <Empty title="No receipts in this period" />
        ) : (
          <>
            <div className="mb-3 text-sm text-gray-600">
              {data.total} receipt(s) · total <strong>{money(data.sum)}</strong>
              {!perms.reports && ' (your receipts)'}
            </div>
            <Table head={['Receipt', 'Family', 'Amount', 'Method', 'By', 'Status', '']}>
              {data.payments.map((p) => (
                <tr key={p.id} className={p.status === 'CANCELLED' ? 'text-gray-400' : ''}>
                  <Td>
                    <Link href={`/school/fees/receipt/${p.id}`} className="font-mono text-xs font-semibold hover:underline">
                      {p.receiptNo}
                    </Link>
                    <div className="text-xs text-gray-500">{dateTime(p.receivedAt)}</div>
                  </Td>
                  <Td className="whitespace-normal">
                    <div className="max-w-[14rem] truncate">{p.students?.map((s) => s.fullName).join(', ')}</div>
                    <div className="text-xs text-gray-500">Family {p.familyNo}</div>
                  </Td>
                  <Td className={p.status === 'CANCELLED' ? 'line-through' : 'font-semibold'}>{money(p.amount)}</Td>
                  <Td>
                    {methodLabel[p.method]}
                    {p.reference && <div className="text-xs text-gray-500">{p.reference}</div>}
                  </Td>
                  <Td className="text-gray-600">{p.collectedBy ?? '—'}</Td>
                  <Td className="whitespace-normal">
                    {p.status === 'VALID' ? (
                      p.source === 'ONLINE' ? <Badge tone="blue">Online</Badge> : p.handoverId ? <Badge tone="green">Handed over</Badge> : <Badge>With collector</Badge>
                    ) : p.status === 'CANCEL_REQUESTED' ? (
                      <>
                        <Badge tone="amber">Cancel requested</Badge>
                        <div className="max-w-[12rem] text-xs text-gray-500">{p.cancelReason}</div>
                      </>
                    ) : (
                      <>
                        <Badge tone="red">Cancelled</Badge>
                        <div className="max-w-[12rem] text-xs">{p.cancelReason}</div>
                      </>
                    )}
                  </Td>
                  <Td className="text-right">
                    {p.status === 'CANCEL_REQUESTED' && perms.isPrincipal ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="danger" onClick={() => decide(p, true)}>
                          Cancel it
                        </Button>
                        <Button variant="secondary" onClick={() => decide(p, false)}>
                          Keep
                        </Button>
                      </div>
                    ) : (
                      p.status === 'VALID' && (
                        <Button variant="ghost" onClick={() => cancel(p)}>
                          {perms.isPrincipal ? 'Cancel' : 'Request cancel'}
                        </Button>
                      )
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
