'use client';

import { use } from 'react';
import { fileUrl } from '@/lib/api';
import { useData } from '../useData';
import { Button, ErrorBox, Loading } from '../ui';
import { dateTime } from '@/lib/format';
import { className } from '@/lib/types';
import { methodLabel } from './shared';

interface Receipt {
  receipt: {
    receiptNo: string;
    amount: number;
    method: string;
    reference: string | null;
    source: string;
    receivedAt: string;
    status: string;
    cancelReason: string | null;
    collectedBy: string | null;
    credit: number;
    allocations: { amount: number; invoice: { invoiceNo: string; title: string; total: number; paidAmount: number; student?: { fullName: string; class: { name: string; stream: string | null }; section: { name: string } | null } } }[];
  };
  family: { familyNo: string; fatherName: string | null };
  familyBalance: number;
  school: { name: string; address: string | null; city: string | null; phone: string | null; logoFileId: string | null; currency: string };
}

export function ReceiptPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useData<Receipt>(`/fees/payments/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const r = data.receipt;
  const cur = data.school.currency;
  const m = (n: number) => `${cur} ${Math.round(n).toLocaleString('en-US')}`;
  return (
    <div>
      <div className="mb-4 flex justify-end print:hidden">
        <Button onClick={() => window.print()}>Print receipt</Button>
      </div>
      <div className="relative mx-auto max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white p-6 text-sm shadow-sm print:max-w-none print:border-0 print:p-0 print:shadow-none">
        {r.status === 'CANCELLED' && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl font-black uppercase text-red-500/20 [transform:rotate(-20deg)]">Cancelled</div>}
        <div className="flex items-center gap-3 border-b border-gray-200 pb-3">
          {data.school.logoFileId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(data.school.logoFileId)} alt="" className="h-12 w-12 object-contain" />
          )}
          <div>
            <div className="text-base font-bold">{data.school.name}</div>
            <div className="text-xs text-gray-600">{[data.school.address, data.school.city, data.school.phone].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <div className="text-lg font-semibold">Fee receipt</div>
          <div className="font-mono font-semibold">{r.receiptNo}</div>
        </div>
        <div className="mt-1 text-xs text-gray-600">
          {dateTime(r.receivedAt)} · Family {data.family.familyNo}
          {data.family.fatherName && ` · ${data.family.fatherName}`}
        </div>
        <table className="mt-4 w-full">
          <tbody className="divide-y divide-gray-100">
            {r.allocations.map((a, i) => (
              <tr key={i}>
                <td className="py-1.5">
                  {a.invoice.student?.fullName}
                  <div className="text-xs text-gray-500">
                    {a.invoice.title} · {a.invoice.invoiceNo}
                    {a.invoice.student && ` · ${className(a.invoice.student.class, a.invoice.student.section)}`}
                  </div>
                </td>
                <td className="py-1.5 text-right">{m(a.amount)}</td>
              </tr>
            ))}
            {r.credit > 0 && (
              <tr>
                <td className="py-1.5">Advance (kept for next vouchers)</td>
                <td className="py-1.5 text-right">{m(r.credit)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 text-base font-bold">
              <td className="pt-2">Total received</td>
              <td className="pt-2 text-right">{m(r.amount)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="mt-3 text-xs text-gray-600">
          Paid by {methodLabel[r.method]}
          {r.reference && ` (${r.reference})`} · {r.source === 'ONLINE' ? 'Online payment' : `Received by ${r.collectedBy ?? '—'}`}
        </div>
        <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm print:bg-white">
          Remaining family balance: <strong>{m(data.familyBalance)}</strong>
        </div>
        {r.status === 'CANCELLED' && <div className="mt-2 text-sm text-red-700">Cancelled: {r.cancelReason}</div>}
        <div className="mt-8 flex justify-between text-xs text-gray-500">
          <span className="border-t border-gray-400 px-3 pt-1">Signature</span>
          <span className="border-t border-gray-400 px-3 pt-1">Stamp</span>
        </div>
      </div>
    </div>
  );
}
