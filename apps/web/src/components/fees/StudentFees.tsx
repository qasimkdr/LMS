'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '../useData';
import { useToast } from '../toast';
import { Badge, Button, Card, Empty, Field, Loading, Table, Td } from '../ui';
import { date } from '@/lib/format';
import { invLabel, invTone, useFeePerms, useMoney } from './shared';

/** Fees tab on the student profile: vouchers, discount, links to collect. */
export function StudentFees({ studentId, familyId }: { studentId: string; familyId: string }) {
  const toast = useToast();
  const money = useMoney();
  const perms = useFeePerms();
  const { data, loading, reload } = useData<{ invoices: { id: string; invoiceNo: string; title: string; total: number; paidAmount: number; balance: number; status: string; dueDate: string }[] }>(`/fees/invoices?studentId=${studentId}`);
  const { data: fam } = useData<{ family: { students: { id: string; discountType: string | null; discountPercent: number; discountAmount: number }[] }; due: number; credit: number }>(`/fees/families/${familyId}/dues`);
  const me = fam?.family.students.find((s) => s.id === studentId);
  const [disc, setDisc] = useState<{ type: string; percent: string; amount: string } | null>(null);
  if (loading && !data) return <Loading />;
  const open = data?.invoices.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL') ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Vouchers" className="lg:col-span-2">
        {!data?.invoices.length ? (
          <Empty title="No vouchers yet" />
        ) : (
          <Table head={['Voucher', 'Due', 'Amount', 'Paid', 'Status']}>
            {data.invoices.map((i) => (
              <tr key={i.id}>
                <Td>
                  {i.title}
                  <div className="font-mono text-xs text-gray-500">{i.invoiceNo}</div>
                </Td>
                <Td>{date(i.dueDate)}</Td>
                <Td>{money(i.total)}</Td>
                <Td>{money(i.paidAmount)}</Td>
                <Td>
                  <Badge tone={invTone[i.status]}>{invLabel[i.status]}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <div className="space-y-6">
        <Card title="Balance">
          <div className="text-2xl font-semibold">{money(open.reduce((a, i) => a + i.balance, 0))}</div>
          <div className="text-sm text-gray-500">this student · family total {money(fam?.due ?? 0)}</div>
          {perms.collect && (
            <Link href={`/school/fees?tab=collect&family=${familyId}`}>
              <Button className="mt-4 w-full">Collect fee</Button>
            </Link>
          )}
          <Link href={`/school/fees/print/vouchers?studentId=${studentId}`} className="mt-2 block text-center text-sm text-brand-700 hover:underline">
            Print voucher
          </Link>
        </Card>
        <Card title="Discount">
          {!disc ? (
            <>
              <p className="text-sm">
                {me?.discountType || me?.discountPercent || me?.discountAmount
                  ? `${me.discountType ?? 'Discount'}: ${me.discountPercent ? `${me.discountPercent}%` : ''}${me.discountPercent && me.discountAmount ? ' + ' : ''}${me.discountAmount ? money(me.discountAmount) : ''} a month`
                  : 'No discount'}
              </p>
              {perms.manage && (
                <Button variant="secondary" className="mt-3" onClick={() => setDisc({ type: me?.discountType ?? '', percent: String(me?.discountPercent || ''), amount: String(me?.discountAmount || '') })}>
                  Change discount
                </Button>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <Field label="Type">
                <select className="input" value={disc.type} onChange={(e) => setDisc({ ...disc, type: e.target.value })}>
                  <option value="">None</option>
                  {['Sibling', 'Staff child', 'Scholarship', 'Merit', 'Orphan', 'Other'].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="%">
                  <input className="input" type="number" min={0} max={100} value={disc.percent} onChange={(e) => setDisc({ ...disc, percent: e.target.value })} />
                </Field>
                <Field label="Fixed / month">
                  <input className="input" type="number" min={0} value={disc.amount} onChange={(e) => setDisc({ ...disc, amount: e.target.value })} />
                </Field>
              </div>
              <p className="text-xs text-gray-500">Applies to new vouchers, on fee heads marked “discounts apply”.</p>
              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    try {
                      await api.patch(`/fees/students/${studentId}/discount`, { discountType: disc.type, discountPercent: disc.percent === '' ? null : Number(disc.percent), discountAmount: disc.amount === '' ? null : Number(disc.amount) });
                      toast('Discount saved');
                      setDisc(null);
                      reload();
                      window.location.reload();
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Failed', 'error');
                    }
                  }}
                >
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setDisc(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
