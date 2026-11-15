'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '../useData';
import { useToast } from '../toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, Table, Td } from '../ui';
import { dateTime } from '@/lib/format';
import { methodLabel, useFeePerms, useMoney } from './shared';

interface Mine {
  isPrincipal: boolean;
  inHand: { payments: { id: string; receiptNo: string; amount: number; method: string; receivedAt: string; status: string }[]; byMethod: Record<string, number>; total: number };
  history: { id: string; expectedAmount: number; declaredAmount: number; status: string; createdAt: string; reviewNote: string | null; _count: { payments: number } }[];
}
interface Review {
  handovers: { id: string; staff: string | null; expectedAmount: number; declaredAmount: number; difference: number; byMethod: Record<string, number>; note: string | null; status: string; createdAt: string; reviewedBy: string | null; reviewNote: string | null; _count: { payments: number } }[];
  notHandedOver: { user: { id: string; fullName: string }; amount: number; receipts: number }[];
  pendingCancellations: number;
}

const hTone = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red' } as const;

export function Handover() {
  const perms = useFeePerms();
  return perms.isPrincipal ? <PrincipalHandovers /> : <MyHandover />;
}

function MyHandover() {
  const toast = useToast();
  const money = useMoney();
  const { data, error, loading, reload } = useData<Mine>('/fees/handover/mine');
  const [declared, setDeclared] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const diff = declared === '' ? 0 : Number(declared) - data.inHand.total;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Money with you">
        <div className="text-3xl font-semibold">{money(data.inHand.total)}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(data.inHand.byMethod).map(([k, v]) => (
            <Badge key={k}>
              {methodLabel[k]}: {money(v)}
            </Badge>
          ))}
        </div>
        <div className="mt-1 text-sm text-gray-500">{data.inHand.payments.length} receipt(s) not handed over yet</div>
        {data.inHand.payments.length > 0 && (
          <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
            <Field label="Amount you are handing to the principal">
              <input className="input text-lg font-semibold" type="number" min={0} value={declared} onChange={(e) => setDeclared(e.target.value)} placeholder={String(data.inHand.total)} />
            </Field>
            {declared !== '' && diff !== 0 && <p className={`text-sm ${diff < 0 ? 'text-red-600' : 'text-amber-700'}`}>{diff < 0 ? `Short by ${money(-diff)}` : `More by ${money(diff)}`} compared to receipts.</p>}
            <Field label="Note (optional)">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.post('/fees/handover', { declaredAmount: declared === '' ? data.inHand.total : Number(declared), note });
                  toast('Hand-over sent to the principal');
                  setDeclared('');
                  setNote('');
                  reload();
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Failed', 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Hand over
            </Button>
          </div>
        )}
      </Card>
      <Card title="Your hand-overs">
        {data.history.length === 0 ? (
          <Empty title="No hand-overs yet" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.history.map((h) => (
              <li key={h.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{money(h.declaredAmount)}</span> · {h._count.payments} receipts
                  <span className="block text-xs text-gray-500">{dateTime(h.createdAt)}</span>
                  {h.reviewNote && <span className="block text-xs text-gray-600">“{h.reviewNote}”</span>}
                </span>
                <Badge tone={hTone[h.status as keyof typeof hTone]}>{h.status === 'PENDING' ? 'Waiting' : h.status === 'APPROVED' ? 'Approved' : 'Rejected'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PrincipalHandovers() {
  const toast = useToast();
  const money = useMoney();
  const [status, setStatus] = useState('PENDING');
  const { data, error, loading, reload } = useData<Review>(`/fees/handovers${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState<string | null>(null);
  async function review(id: string, approve: boolean) {
    const note = approve ? undefined : prompt('Why are you rejecting it?');
    if (!approve && !note) return;
    try {
      await api.post(`/fees/handovers/${id}/review`, { approve, note });
      toast(approve ? 'Approved' : 'Rejected');
      setOpen(null);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <div className="space-y-6">
      {data.pendingCancellations > 0 && (
        <Link href="/school/fees?tab=receipts" className="block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {data.pendingCancellations} receipt cancellation request(s) need your decision. Open receipts and filter “Cancellation requested” →
        </Link>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Hand-overs" className="lg:col-span-2" actions={
          <select className="input w-auto py-1" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="PENDING">Waiting</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All</option>
          </select>
        }>
          {data.handovers.length === 0 ? (
            <Empty title="Nothing here" />
          ) : (
            <Table head={['Staff', 'Receipts', 'Declared', 'Difference', 'Status', '']}>
              {data.handovers.map((h) => (
                <tr key={h.id}>
                  <Td>
                    <div className="font-medium">{h.staff}</div>
                    <div className="text-xs text-gray-500">{dateTime(h.createdAt)}</div>
                  </Td>
                  <Td>
                    {h._count.payments} · {money(h.expectedAmount)}
                  </Td>
                  <Td className="font-semibold">{money(h.declaredAmount)}</Td>
                  <Td className={h.difference < 0 ? 'text-red-600' : h.difference > 0 ? 'text-amber-700' : 'text-emerald-700'}>{h.difference === 0 ? 'Matches' : money(h.difference)}</Td>
                  <Td>
                    <Badge tone={hTone[h.status as keyof typeof hTone]}>{h.status === 'PENDING' ? 'Waiting' : h.status === 'APPROVED' ? 'Approved' : 'Rejected'}</Badge>
                  </Td>
                  <Td className="text-right">
                    <Button variant={h.status === 'PENDING' ? 'primary' : 'ghost'} onClick={() => setOpen(h.id)}>
                      {h.status === 'PENDING' ? 'Review' : 'View'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Still with staff">
          {data.notHandedOver.length === 0 ? (
            <p className="text-sm text-gray-500">All collected money has been handed over.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.notHandedOver.map((h) => (
                <li key={h.user.id} className="flex justify-between">
                  <span>
                    {h.user.fullName} <span className="text-xs text-gray-500">({h.receipts})</span>
                  </span>
                  <span className="font-semibold">{money(h.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {open && <HandoverModal id={open} onClose={() => setOpen(null)} onReview={review} />}
    </div>
  );
}

function HandoverModal({ id, onClose, onReview }: { id: string; onClose: () => void; onReview: (id: string, approve: boolean) => void }) {
  const money = useMoney();
  const { data } = useData<{ handover: Review['handovers'][number]; payments: { id: string; receiptNo: string; amount: number; method: string; receivedAt: string; status: string; family?: { familyNo: string; students: { fullName: string }[] } }[] }>(`/fees/handovers/${id}`);
  return (
    <Modal open onClose={onClose} title="Hand-over" wide>
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500">Receipts total</div>
              <div className="text-lg font-semibold">{money(data.handover.expectedAmount)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Handed over</div>
              <div className="text-lg font-semibold">{money(data.handover.declaredAmount)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">By method</div>
              <div>{Object.entries(data.handover.byMethod as Record<string, number>).map(([k, v]) => `${methodLabel[k]} ${money(v)}`).join(', ')}</div>
            </div>
          </div>
          {data.handover.note && <p className="rounded-lg bg-gray-50 p-2 text-sm">Note: {data.handover.note}</p>}
          <div className="max-h-[45vh] overflow-y-auto">
            <Table head={['Receipt', 'Students', 'Method', 'Amount']}>
              {data.payments.map((p) => (
                <tr key={p.id} className={p.status === 'CANCELLED' ? 'text-gray-400 line-through' : ''}>
                  <Td>
                    <Link href={`/school/fees/receipt/${p.id}`} className="font-mono text-xs hover:underline">
                      {p.receiptNo}
                    </Link>
                  </Td>
                  <Td className="max-w-[12rem] truncate">{p.family?.students.map((s) => s.fullName).join(', ')}</Td>
                  <Td>{methodLabel[p.method]}</Td>
                  <Td>{money(p.amount)}</Td>
                </tr>
              ))}
            </Table>
          </div>
          {data.handover.status === 'PENDING' && (
            <div className="flex gap-2">
              <Button onClick={() => onReview(id, true)}>Approve — money received</Button>
              <Button variant="secondary" onClick={() => onReview(id, false)}>
                Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
