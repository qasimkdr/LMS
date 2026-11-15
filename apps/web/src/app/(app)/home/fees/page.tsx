'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { date } from '@/lib/format';
import { methodLabel } from '@/components/fees/shared';

interface MyFees {
  family: { id: string; familyNo: string; students: { id: string; fullName: string }[] } | null;
  currency: string;
  invoices: { id: string; invoiceNo: string; title: string; studentId: string; total: number; paidAmount: number; balance: number; dueDate: string; overdue: boolean; lateFeeIfPaidToday: number; lines: { description: string; amount: number }[] }[];
  due: number;
  lateFee: number;
  credit: number;
  payable: number;
  paidInvoices: { id: string; invoiceNo: string; title: string; studentId: string; total: number; dueDate: string }[];
  receipts: { id: string; receiptNo: string; amount: number; method: string; source: string; receivedAt: string }[];
  onlinePayment: boolean;
  allowPartial: boolean;
}

/** Sends the browser to the payment page (form post for real gateways). */
function goToGateway(r: { action: string; method: string; fields: Record<string, string> }) {
  if (r.method === 'GET') {
    window.location.href = `${r.action}?${new URLSearchParams(r.fields)}`;
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = r.action;
  for (const [k, v] of Object.entries(r.fields)) {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = k;
    i.value = v;
    form.appendChild(i);
  }
  document.body.appendChild(form);
  form.submit();
}

function MyFeesInner() {
  const params = useSearchParams();
  const toast = useToast();
  const { data, error, loading, reload } = useData<MyFees>('/fees/my');
  const [paying, setPaying] = useState(false);
  const result = params.get('payment');
  const ref = params.get('ref');
  const [status, setStatus] = useState<{ status: string; receipt: { id: string; receiptNo: string } | null; message: string | null } | null>(null);

  useEffect(() => {
    if (ref) api.get<typeof status>(`/pay/status/${ref}`).then(setStatus).catch(() => undefined);
  }, [ref]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.family) return <Empty title="No fee record" />;
  const cur = data.currency;
  const m = (n: number) => `${cur} ${Math.round(n).toLocaleString('en-US')}`;
  const name = (id: string) => data.family!.students.find((s) => s.id === id)?.fullName ?? '';

  async function pay() {
    setPaying(true);
    try {
      const r = await api.post<{ action: string; method: string; fields: Record<string, string> }>('/pay/start', {});
      goToGateway(r);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start payment', 'error');
      setPaying(false);
    }
  }

  return (
    <>
      <PageHeader title="Fees" subtitle={`Family ${data.family.familyNo}`} />
      {result && (
        <div className={`mb-6 rounded-xl border p-4 text-sm ${result === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : result === 'pending' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
          {result === 'success' ? 'Payment received. Thank you!' : result === 'pending' ? 'Your payment is being processed. The receipt will appear here when it is confirmed.' : 'The payment did not go through. No money was taken by the school. You can try again.'}
          {status?.receipt && (
            <Link href={`/home/fees/receipt/${status.receipt.id}`} className="ml-2 font-semibold underline">
              View receipt {status.receipt.receiptNo}
            </Link>
          )}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Dues">
            {data.invoices.length === 0 ? (
              <p className="text-sm text-emerald-700">All fees are paid.{data.credit > 0 && ` Advance balance: ${m(data.credit)}.`}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.invoices.map((i) => (
                  <li key={i.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">
                          {name(i.studentId)} · {i.title}
                        </div>
                        <div className="text-xs text-gray-500">
                          Due {date(i.dueDate)} · {i.invoiceNo} {i.overdue && <Badge tone="red">Overdue</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-gray-600">{i.lines.map((l) => `${l.description}: ${Math.round(l.amount).toLocaleString('en-US')}`).join(' · ')}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">{m(i.balance)}</div>
                        {i.paidAmount > 0 && <div className="text-xs text-gray-500">paid {m(i.paidAmount)}</div>}
                        {i.lateFeeIfPaidToday > 0 && <div className="text-xs text-red-600">+ late fee {m(i.lateFeeIfPaidToday)}</div>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Receipts">
            {data.receipts.length === 0 ? (
              <p className="text-sm text-gray-500">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/home/fees/receipt/${r.id}`} className="hover:underline">
                      <span className="font-mono">{r.receiptNo}</span> · {date(r.receivedAt)} · {methodLabel[r.method]}
                    </Link>
                    <span className="font-medium">{m(r.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Total to pay">
          <div className="text-3xl font-semibold">{m(data.payable)}</div>
          <div className="mt-2 space-y-0.5 text-sm text-gray-600">
            <div>Dues: {m(data.due)}</div>
            {data.lateFee > 0 && <div className="text-red-600">Late fee: {m(data.lateFee)}</div>}
            {data.credit > 0 && <div className="text-emerald-700">Advance: -{m(data.credit)}</div>}
          </div>
          {data.payable > 0 &&
            (data.onlinePayment ? (
              <Button className="mt-5 w-full" onClick={pay} loading={paying}>
                Pay {m(data.payable)} online
              </Button>
            ) : (
              <p className="mt-5 text-sm text-gray-500">Please pay at the school office or at the bank using your voucher.</p>
            ))}
        </Card>
      </div>
    </>
  );
}

export default function MyFeesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MyFeesInner />
    </Suspense>
  );
}
