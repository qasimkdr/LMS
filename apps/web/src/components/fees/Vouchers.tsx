'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '../useData';
import { useToast } from '../toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, Table, Td } from '../ui';
import { date, monthLabel } from '@/lib/format';
import { className, type Structure } from '@/lib/types';
import { invLabel, invTone, localToday, thisMonth, useFeePerms, useMoney } from './shared';

interface InvoiceRow {
  id: string;
  invoiceNo: string;
  title: string;
  period: string | null;
  total: number;
  paidAmount: number;
  balance: number;
  status: string;
  dueDate: string;
  familyId: string;
  student?: { id: string; fullName: string; admissionNo: string; class: { name: string; stream: string | null }; section: { name: string } | null };
}

export function Vouchers() {
  const toast = useToast();
  const money = useMoney();
  const perms = useFeePerms();
  const { data: structure } = useData<Structure>('/setup/structure');
  const [period, setPeriod] = useState(thisMonth());
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams({ period, ...(classId && { classId }), ...(status && { status }) });
  const { data, error, loading, reload } = useData<{ invoices: InvoiceRow[]; total: number; sums: { total: number; paid: number } }>(`/fees/invoices?${qs}`);
  const [genOpen, setGenOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const printQs = new URLSearchParams({ period, ...(classId && { classId }) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month">
          <input className="input w-auto" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <Field label="Class">
          <select className="input w-auto" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {structure?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {className(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="OPEN">Not fully paid</option>
            <option value="PAID">Paid</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </Field>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href={`/school/fees/print/vouchers?${printQs}`}>
            <Button variant="secondary">Print vouchers</Button>
          </Link>
          <Link href={`/school/fees/print/vouchers?${printQs}&family=true`}>
            <Button variant="secondary">Print family vouchers</Button>
          </Link>
          {perms.manage && (
            <>
              <Button variant="secondary" onClick={() => setChargeOpen(true)}>
                + One-off charge
              </Button>
              <Button onClick={() => setGenOpen(true)}>Generate {monthLabel(period)}</Button>
            </>
          )}
        </div>
      </div>
      <Card>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.invoices.length ? (
          <Empty title={`No vouchers for ${monthLabel(period)}`}>{perms.manage && 'Press “Generate” to create this month’s vouchers for all students.'}</Empty>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-600">
              <span>
                {data.total} voucher{data.total === 1 ? '' : 's'}
              </span>
              <span>
                Billed <strong>{money(data.sums.total)}</strong>
              </span>
              <span>
                Paid <strong className="text-emerald-700">{money(data.sums.paid)}</strong>
              </span>
              <span>
                Remaining <strong className="text-red-700">{money(data.sums.total - data.sums.paid)}</strong>
              </span>
            </div>
            <Table head={['Voucher', 'Student', 'Class', 'Amount', 'Paid', 'Status', '']}>
              {data.invoices.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <div className="font-mono text-xs">{i.invoiceNo}</div>
                    <div className="text-xs text-gray-500">due {date(i.dueDate)}</div>
                  </Td>
                  <Td>
                    <Link href={`/school/students/${i.student?.id}?tab=fees`} className="font-medium hover:underline">
                      {i.student?.fullName}
                    </Link>
                    <div className="text-xs text-gray-500">{i.title}</div>
                  </Td>
                  <Td>{i.student && className(i.student.class, i.student.section)}</Td>
                  <Td>{money(i.total)}</Td>
                  <Td>{money(i.paidAmount)}</Td>
                  <Td>
                    <Badge tone={invTone[i.status]}>{invLabel[i.status]}</Badge>
                  </Td>
                  <Td className="text-right">
                    {perms.collect && i.status !== 'PAID' && i.status !== 'CANCELLED' && (
                      <Link href={`/school/fees?tab=collect&family=${i.familyId}`} className="text-sm font-medium text-brand-700 hover:underline">
                        Collect
                      </Link>
                    )}
                    {perms.manage && i.status === 'UNPAID' && (
                      <button
                        className="ml-3 text-sm text-gray-500 hover:text-red-600"
                        onClick={async () => {
                          const reason = prompt('Why cancel this voucher?');
                          if (!reason) return;
                          try {
                            await api.post(`/fees/invoices/${i.id}/cancel`, { reason });
                            toast('Voucher cancelled');
                            reload();
                          } catch (e) {
                            toast(e instanceof Error ? e.message : 'Failed', 'error');
                          }
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
      {genOpen && <GenerateModal period={period} structure={structure} onClose={() => setGenOpen(false)} onDone={() => { setGenOpen(false); reload(); }} />}
      {chargeOpen && <ChargeModal structure={structure} onClose={() => setChargeOpen(false)} onDone={() => { setChargeOpen(false); reload(); }} />}
    </div>
  );
}

function GenerateModal({ period, structure, onClose, onDone }: { period: string; structure: Structure | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [classIds, setClassIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open onClose={onClose} title={`Generate vouchers for ${monthLabel(period)}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Creates the monthly voucher for every active student who doesn’t have one yet, using the fee structure and each student’s discount. Advance payments are used automatically.</p>
        <Field label="Classes" hint="Leave all unticked for the whole school">
          <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
            {structure?.classes.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={classIds.includes(c.id)} onChange={(e) => setClassIds(e.target.checked ? [...classIds, c.id] : classIds.filter((x) => x !== c.id))} />
                {className(c)}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Due date" hint="Empty = the due day in fee settings">
          <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Tell parents (WhatsApp if switched on, and in the app)
        </label>
        <ErrorBox error={error} />
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api.post<{ created: number; skipped: number; empty: number; notices: { whatsapp: number; inApp: number } }>('/fees/generate', {
                period,
                classIds: classIds.length ? classIds : undefined,
                dueDate: dueDate || undefined,
                notify,
              });
              toast(`${r.created} voucher(s) created${r.skipped ? `, ${r.skipped} already had one` : ''}${r.notices.whatsapp ? `, ${r.notices.whatsapp} WhatsApp sent` : ''}`);
              onDone();
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          Generate
        </Button>
      </div>
    </Modal>
  );
}

function ChargeModal({ structure, onClose, onDone }: { structure: Structure | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: setup } = useData<{ heads: { id: string; name: string; frequency: string }[] }>('/fees/setup');
  const [classId, setClassId] = useState('');
  const [student, setStudent] = useState<{ id: string; label: string } | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; fullName: string; class: { name: string; stream: string | null }; section: { name: string } | null }[]>([]);
  const [title, setTitle] = useState('');
  const [headId, setHeadId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open onClose={onClose} title="One-off charge">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">For admission fee, books, trips or anything outside the monthly fee.</p>
        <Field label="For a whole class">
          <select className="input" value={classId} onChange={(e) => { setClassId(e.target.value); setStudent(null); }}>
            <option value="">—</option>
            {structure?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {className(c)}
              </option>
            ))}
          </select>
        </Field>
        {!classId && (
          <Field label="Or one student">
            {student ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
                {student.label}
                <button className="text-gray-400" onClick={() => setStudent(null)}>
                  ✕
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="Search student"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    if (e.target.value.length >= 2) api.get<{ students: typeof found }>(`/students?q=${encodeURIComponent(e.target.value)}&pageSize=10`).then((r) => setFound(r.students)).catch(() => undefined);
                  }}
                />
                {q.length >= 2 && (
                  <ul className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-gray-200">
                    {found.map((s) => (
                      <li key={s.id}>
                        <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50" onClick={() => { setStudent({ id: s.id, label: `${s.fullName} (${className(s.class, s.section)})` }); setQ(''); }}>
                          {s.fullName} · {className(s.class, s.section)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Field>
        )}
        <Field label="Fee head (optional)">
          <select
            className="input"
            value={headId}
            onChange={(e) => {
              setHeadId(e.target.value);
              const h = setup?.heads.find((x) => x.id === e.target.value);
              if (h && !title) setTitle(h.name);
            }}
          >
            <option value="">—</option>
            {setup?.heads.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Study trip to museum" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <input className="input" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Due date">
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <ErrorBox error={error} />
        <Button
          loading={busy}
          disabled={!(classId || student) || !title || !Number(amount)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api.post<{ created: number }>('/fees/charges', {
                ...(classId ? { classId } : { studentIds: [student!.id] }),
                title,
                lines: [{ headId: headId || null, description: title, amount: Number(amount) }],
                dueDate,
              });
              toast(`${r.created} voucher(s) created`);
              onDone();
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          Add charge
        </Button>
      </div>
    </Modal>
  );
}
