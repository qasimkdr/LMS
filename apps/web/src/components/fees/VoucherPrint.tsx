'use client';

import { fileUrl } from '@/lib/api';
import { Button, Empty } from '../ui';
import { date } from '@/lib/format';
import { className } from '@/lib/types';

export interface VoucherData {
  school: { name: string; address: string | null; city: string | null; phone: string | null; logoFileId: string | null; currency: string };
  settings: { bankDetails: Record<string, string | null> | null; voucherNote: string | null; lateFeeType: string; lateFeeAmount: number; lateFeeMax: number };
  period: string | null;
  vouchers: {
    students: { id: string; fullName: string; admissionNo: string; rollNo: string | null; class: { name: string; stream: string | null }; section: { name: string } | null }[];
    familyNo: string;
    fatherName: string | null;
    invoiceNos: string[];
    lines: { description: string; amount: number }[];
    alreadyPaid: number;
    currentTotal: number;
    arrears: number;
    total: number;
    dueDate: string | null;
    lateFee: number;
  }[];
}

/** Fee vouchers with three copies each (bank, school, parent). Prints on A4 landscape. */
export function VoucherPrint({ data }: { data: VoucherData }) {
  const cur = data.school.currency;
  const m = (n: number) => `${Math.round(n).toLocaleString('en-US')}`;
  const bank = data.settings.bankDetails ?? {};
  const lateText = data.settings.lateFeeType === 'FIXED' ? `${cur} ${m(data.settings.lateFeeAmount)}` : data.settings.lateFeeType === 'PER_DAY' ? `${cur} ${m(data.settings.lateFeeAmount)} per day` : null;
  if (!data.vouchers.length) return <Empty title="No unpaid vouchers to print" />;
  return (
    <div>
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <span className="text-sm text-gray-600">{data.vouchers.length} voucher(s)</span>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <div className="space-y-6 print:space-y-0">
        {data.vouchers.map((v, idx) => (
          <div key={idx} className="grid grid-cols-3 gap-3 bg-white p-2 print:break-after-page print:p-0">
            {['Bank copy', 'School copy', 'Parent copy'].map((copy) => (
              <div key={copy} className="border border-dashed border-gray-400 p-3 text-[11px] leading-tight text-gray-900">
                <div className="flex items-center gap-2 border-b border-gray-300 pb-2">
                  {data.school.logoFileId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(data.school.logoFileId)} alt="" className="h-9 w-9 object-contain" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{data.school.name}</div>
                    <div className="truncate text-[10px] text-gray-600">{[data.school.address, data.school.city, data.school.phone].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="text-right text-[10px] font-semibold uppercase">{copy}</div>
                </div>
                {bank.bankName && (
                  <div className="mt-1.5 rounded bg-gray-100 px-1.5 py-1 text-[10px] print:bg-gray-100">
                    {bank.bankName} {bank.branch && `· ${bank.branch}`}
                    <br />
                    {bank.accountTitle} · A/C {bank.accountNumber} {bank.iban && `· ${bank.iban}`}
                  </div>
                )}
                <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <span className="text-gray-600">Family no.</span>
                  <span className="font-semibold">{v.familyNo}</span>
                  <span className="text-gray-600">Voucher</span>
                  <span className="font-mono">{v.invoiceNos.join(', ') || '—'}</span>
                  {v.fatherName && (
                    <>
                      <span className="text-gray-600">Father</span>
                      <span>{v.fatherName}</span>
                    </>
                  )}
                  <span className="text-gray-600">Due date</span>
                  <span className="font-semibold">{v.dueDate ? date(v.dueDate) : '—'}</span>
                </div>
                <div className="mt-2 border-t border-gray-200 pt-1.5">
                  {v.students.map((s) => (
                    <div key={s.id} className="flex justify-between">
                      <span className="font-semibold">{s.fullName}</span>
                      <span className="text-gray-600">
                        {className(s.class, s.section)} · {s.admissionNo}
                      </span>
                    </div>
                  ))}
                </div>
                <table className="mt-2 w-full">
                  <tbody>
                    {v.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-0.5">{l.description}</td>
                        <td className="py-0.5 text-right">{m(l.amount)}</td>
                      </tr>
                    ))}
                    {v.alreadyPaid > 0 && (
                      <tr>
                        <td className="py-0.5 text-gray-600">Already paid</td>
                        <td className="py-0.5 text-right">-{m(v.alreadyPaid)}</td>
                      </tr>
                    )}
                    {v.arrears > 0 && (
                      <tr>
                        <td className="py-0.5 font-semibold">Previous dues</td>
                        <td className="py-0.5 text-right font-semibold">{m(v.arrears)}</td>
                      </tr>
                    )}
                    <tr className="border-t border-gray-800 text-[12px] font-bold">
                      <td className="pt-1">Payable by due date</td>
                      <td className="pt-1 text-right">
                        {cur} {m(v.total)}
                      </td>
                    </tr>
                    {lateText && v.lateFee > 0 && (
                      <tr className="text-red-700">
                        <td className="py-0.5">After due date</td>
                        <td className="py-0.5 text-right">
                          {cur} {m(v.total + v.lateFee)}
                          {data.settings.lateFeeType === 'PER_DAY' && '+'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {lateText && <div className="mt-1 text-[9px] text-gray-600">Late fee: {lateText}{data.settings.lateFeeMax ? ` (max ${cur} ${m(data.settings.lateFeeMax)})` : ''}</div>}
                {data.settings.voucherNote && <div className="mt-1 text-[9px] text-gray-600">{data.settings.voucherNote}</div>}
                <div className="mt-6 flex justify-between text-[9px] text-gray-500">
                  <span className="border-t border-gray-400 px-2 pt-0.5">Cashier</span>
                  <span className="border-t border-gray-400 px-2 pt-0.5">Stamp</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
