'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '../useData';
import { useToast } from '../toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Table, Td } from '../ui';
import { Tabs } from '../Tabs';
import { date, monthLabel } from '@/lib/format';
import { className, type Structure } from '@/lib/types';
import { invLabel, invTone, localToday, methodLabel, thisMonth, useMoney } from './shared';

type R = 'month' | 'defaulters' | 'recovery' | 'daily';

export function FeeReports() {
  const [r, setR] = useState<R>('defaulters');
  return (
    <>
      <div className="print:hidden">
        <Tabs
          value={r}
          onChange={setR}
          tabs={[
            { key: 'defaulters', label: 'Defaulters' },
            { key: 'month', label: 'Paid / unpaid by month' },
            { key: 'recovery', label: 'Recovery' },
            { key: 'daily', label: 'Day sheet' },
          ]}
        />
      </div>
      {r === 'month' && <MonthReport />}
      {r === 'defaulters' && <Defaulters />}
      {r === 'recovery' && <Recovery />}
      {r === 'daily' && <Daily />}
    </>
  );
}

function ClassSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useData<Structure>('/setup/structure');
  return (
    <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All classes</option>
      {data?.classes.map((c) => (
        <option key={c.id} value={c.id}>
          {className(c)}
        </option>
      ))}
    </select>
  );
}

function MonthReport() {
  const money = useMoney();
  const [period, setPeriod] = useState(thisMonth());
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams({ period, ...(classId && { classId }), ...(status && { status }) });
  const { data, error, loading } = useData<{ counts: Record<string, number>; total: number; paid: number; recovery: number | null; rows: { student: { id: string; fullName: string; admissionNo: string; rollNo: string | null; familyId: string; classLabel: string }; total: number; paid: number; balance: number; status: string }[] }>(`/fees/reports/month?${qs}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label="Month">
          <input className="input w-auto" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <Field label="Class">
          <ClassSelect value={classId} onChange={setClassId} />
        </Field>
        <Field label="Show">
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Everyone</option>
            <option value="PAID">Paid</option>
            <option value="PARTIAL">Partly paid</option>
            <option value="UNPAID">Not paid</option>
            <option value="NONE">No voucher</option>
          </select>
        </Field>
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <Card title={`${monthLabel(period)} · ${data.recovery ?? 0}% recovered (${money(data.paid)} of ${money(data.total)})`}>
          <div className="mb-3 flex flex-wrap gap-2">
            {(['PAID', 'PARTIAL', 'UNPAID', 'NONE'] as const).map((k) => (
              <Badge key={k} tone={invTone[k]}>
                {invLabel[k]}: {data.counts[k]}
              </Badge>
            ))}
          </div>
          {data.rows.length === 0 ? (
            <Empty title="No students" />
          ) : (
            <Table head={['Student', 'Class', 'Fee', 'Paid', 'Balance', 'Status']}>
              {data.rows.map((r) => (
                <tr key={r.student.id}>
                  <Td>
                    <Link href={`/school/students/${r.student.id}?tab=fees`} className="font-medium hover:underline">
                      {r.student.fullName}
                    </Link>
                    <div className="text-xs text-gray-500">{r.student.admissionNo}</div>
                  </Td>
                  <Td>{r.student.classLabel}</Td>
                  <Td>{money(r.total)}</Td>
                  <Td>{money(r.paid)}</Td>
                  <Td className={r.balance > 0 ? 'font-semibold text-red-700' : ''}>{money(r.balance)}</Td>
                  <Td>
                    <Badge tone={invTone[r.status]}>{invLabel[r.status]}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Defaulters() {
  const toast = useToast();
  const money = useMoney();
  const [classId, setClassId] = useState('');
  const [minMonths, setMinMonths] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const qs = new URLSearchParams({ minMonths: String(minMonths), ...(classId && { classId }) });
  const { data, error, loading } = useData<{ totalDue: number; rows: { rank: number; student: { id: string; fullName: string; admissionNo: string; classLabel: string; status: string }; familyId: string; familyNo: string; contact: { fullName: string; phone: string | null; whatsapp: string | null } | null; monthsUnpaid: number; vouchers: number; due: number; oldestDue: string }[] }>(`/fees/reports/defaulters?${qs}`);

  async function remind(body: object) {
    setSending(true);
    try {
      const r = await api.post<{ families: number; whatsapp: number; inApp: number }>('/fees/reports/reminders', body);
      toast(`Reminders sent to ${r.families} famil${r.families === 1 ? 'y' : 'ies'} (${r.whatsapp} WhatsApp, ${r.inApp} in the app)`);
      setSelected(new Set());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label="Class">
          <ClassSelect value={classId} onChange={setClassId} />
        </Field>
        <Field label="Unpaid for at least">
          <select className="input w-auto" value={minMonths} onChange={(e) => setMinMonths(Number(e.target.value))}>
            {[1, 2, 3, 4, 6].map((n) => (
              <option key={n} value={n}>
                {n} month{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </Field>
        <div className="ml-auto flex flex-wrap gap-2">
          {selected.size > 0 && (
            <Button variant="secondary" loading={sending} onClick={() => remind({ familyIds: [...selected] })}>
              Remind selected ({selected.size})
            </Button>
          )}
          <Button loading={sending} onClick={() => confirm('Send a fee reminder to every family with overdue fees?') && remind({ allDefaulters: true })}>
            Remind all defaulters
          </Button>
          <Button variant="ghost" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <Card title={`${data.rows.length} student(s) · ${money(data.totalDue)} overdue`}>
          {data.rows.length === 0 ? (
            <Empty title="No defaulters" />
          ) : (
            <Table head={['', '#', 'Student', 'Class', 'Months unpaid', 'Due since', 'Amount due', 'Contact']}>
              {data.rows.map((r) => (
                <tr key={r.student.id}>
                  <Td>
                    <input
                      type="checkbox"
                      className="print:hidden"
                      checked={selected.has(r.familyId)}
                      onChange={(e) => {
                        const s = new Set(selected);
                        if (e.target.checked) s.add(r.familyId);
                        else s.delete(r.familyId);
                        setSelected(s);
                      }}
                    />
                  </Td>
                  <Td className="text-gray-500">{r.rank}</Td>
                  <Td>
                    <Link href={`/school/fees?tab=collect&family=${r.familyId}`} className="font-medium hover:underline">
                      {r.student.fullName}
                    </Link>
                    <div className="text-xs text-gray-500">
                      {r.student.admissionNo} · Family {r.familyNo}
                    </div>
                  </Td>
                  <Td>{r.student.classLabel}</Td>
                  <Td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.monthsUnpaid >= 3 ? 'bg-red-100 text-red-800' : r.monthsUnpaid === 2 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>
                      {r.monthsUnpaid || r.vouchers}
                    </span>
                  </Td>
                  <Td>{date(r.oldestDue)}</Td>
                  <Td className="font-semibold text-red-700">{money(r.due)}</Td>
                  <Td className="text-xs text-gray-600">
                    {r.contact?.fullName}
                    <div>{r.contact?.whatsapp ?? r.contact?.phone}</div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Recovery() {
  const money = useMoney();
  const [period, setPeriod] = useState('');
  const { data, error, loading } = useData<{ byPeriod: { period: string; expected: number; collected: number; recovery: number | null }[]; period: string; byClass: { id: string; name: string; expected: number; collected: number; recovery: number | null }[] }>(`/fees/reports/recovery?months=12${period ? `&period=${period}` : ''}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Billed vs collected (last 12 months)">
        <ul className="space-y-2.5">
          {data.byPeriod.map((p) => (
            <li key={p.period}>
              <button className={`w-full text-left ${p.period === data.period ? 'font-semibold' : ''}`} onClick={() => setPeriod(p.period)}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{monthLabel(p.period)}</span>
                  <span className="text-gray-600">
                    {money(p.collected)} / {money(p.expected)} {p.recovery !== null && `· ${p.recovery}%`}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div className={`h-2 rounded-full ${(p.recovery ?? 0) >= 90 ? 'bg-emerald-500' : (p.recovery ?? 0) >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, p.recovery ?? 0)}%` }} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`By class · ${monthLabel(data.period)}`}>
        {data.byClass.length === 0 ? (
          <Empty title="No vouchers that month" />
        ) : (
          <Table head={['Class', 'Billed', 'Collected', '%']}>
            {data.byClass.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td>{money(c.expected)}</Td>
                <Td>{money(c.collected)}</Td>
                <Td className={(c.recovery ?? 0) < 70 ? 'font-semibold text-red-700' : ''}>{c.recovery}%</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function Daily() {
  const money = useMoney();
  const [d, setD] = useState(localToday());
  const { data, error, loading } = useData<{ date: string; total: number; receipts: number; cancelled: number; byMethod: Record<string, number>; byCollector: { name: string; amount: number }[] }>(`/fees/reports/daily?date=${d}`);
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 print:hidden">
        <Field label="Date">
          <input className="input w-auto" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </Field>
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
        <Link href={`/school/fees?tab=receipts`} className="text-sm text-brand-700 hover:underline">
          See receipts →
        </Link>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="grid gap-6 md:grid-cols-3">
          <Card title={`Day sheet · ${date(data.date)}`}>
            <div className="text-3xl font-semibold">{money(data.total)}</div>
            <div className="mt-1 text-sm text-gray-500">
              {data.receipts} receipt(s){data.cancelled ? `, ${data.cancelled} cancelled` : ''}
            </div>
          </Card>
          <Card title="By method">
            <ul className="space-y-1 text-sm">
              {Object.entries(data.byMethod).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{methodLabel[k]}</span>
                  <span className="font-medium">{money(v)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="By collector">
            <ul className="space-y-1 text-sm">
              {data.byCollector.map((c) => (
                <li key={c.name} className="flex justify-between">
                  <span>{c.name}</span>
                  <span className="font-medium">{money(c.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
