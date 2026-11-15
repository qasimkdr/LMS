'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Tabs } from '@/components/Tabs';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Table, Td, type Tone } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { className, type Structure } from '@/lib/types';

type Tab = 'compose' | 'history' | 'log';

const msgTone: Record<string, Tone> = { QUEUED: 'gray', SENDING: 'blue', SENT: 'blue', DELIVERED: 'green', READ: 'green', FAILED: 'red', SKIPPED: 'amber' };
const msgLabel: Record<string, string> = { QUEUED: 'Waiting', SENDING: 'Sending', SENT: 'Sent', DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed', SKIPPED: 'Not sent' };
const typeLabel: Record<string, string> = { ABSENT: 'Absent alert', LATE: 'Late alert', MANUAL: 'Message' };

function MessagesInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') as Tab) || 'compose';
  return (
    <>
      <PageHeader title="Messages" subtitle="Write to parents or staff on WhatsApp and in the app, and see who received them" />
      <Tabs
        value={tab}
        onChange={(t) => router.replace(`/school/messages?tab=${t}`)}
        tabs={[
          { key: 'compose', label: 'New message' },
          { key: 'history', label: 'Sent messages' },
          { key: 'log', label: 'WhatsApp log' },
        ]}
      />
      {tab === 'compose' && <Compose onSent={() => router.replace('/school/messages?tab=history')} />}
      {tab === 'history' && <History />}
      {tab === 'log' && <Log />}
    </>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MessagesInner />
    </Suspense>
  );
}

// ---------- Compose ----------

type Kind = 'school' | 'classes' | 'sections' | 'students' | 'staff';
interface Preview {
  recipients: number;
  whatsappNumbers: number;
  invalidNumbers: number;
  noNumber: number;
  appUsers: number;
  whatsappAvailable: boolean;
  sample: string | null;
}

function Compose({ onSent }: { onSent: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const { data: structure } = useData<Structure>('/setup/structure');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<Kind>('classes');
  const [ids, setIds] = useState<string[]>([]);
  const [students, setStudents] = useState<{ id: string; label: string }[]>([]);
  const [roles, setRoles] = useState<string[]>(['TEACHER']);
  const [channels, setChannels] = useState({ whatsapp: true, inApp: true });
  const [schedule, setSchedule] = useState(false);
  const [sendAt, setSendAt] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const audience =
    kind === 'school' ? { kind } : kind === 'staff' ? { kind, roles } : kind === 'students' ? { kind, ids: students.map((s) => s.id) } : { kind, ids };
  const audienceReady = kind === 'school' || (kind === 'staff' ? roles.length > 0 : kind === 'students' ? students.length > 0 : ids.length > 0);
  const audienceKey = JSON.stringify(audience);

  useEffect(() => {
    if (!audienceReady || message.trim().length < 2) return setPreview(null);
    const t = setTimeout(() => {
      api.post<Preview>('/messaging/compose/preview', { message, audience: JSON.parse(audienceKey) }).then(setPreview).catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(t);
  }, [audienceKey, message, audienceReady]);

  useEffect(() => {
    if (preview && !preview.whatsappAvailable) setChannels((c) => ({ ...c, whatsapp: false }));
  }, [preview]);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const r = await api.post<{ whatsappQueued: number; inAppNotified: number }>('/messaging/compose', {
        title,
        message,
        audience,
        channels,
        ...(schedule && sendAt ? { sendAt: new Date(sendAt).toISOString() } : {}),
      });
      toast(`Sent: ${r.whatsappQueued} on WhatsApp${schedule ? ' (scheduled)' : ''}, ${r.inAppNotified} in the app`);
      onSent();
    } catch (e) {
      setError(e);
      setConfirm(false);
    } finally {
      setSending(false);
    }
  }

  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <Card title="1. Who should get it?">
          <div className="mb-4 flex flex-wrap gap-2">
            {(
              [
                ['school', 'Whole school'],
                ['classes', 'Classes'],
                ['sections', 'Sections'],
                ['students', 'Selected students'],
                ['staff', 'Staff'],
              ] as [Kind, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  setIds([]);
                }}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${kind === k ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {l}
              </button>
            ))}
          </div>
          {kind === 'school' && <p className="text-sm text-gray-600">Parents of every active student.</p>}
          {kind === 'classes' && (
            <div className="grid gap-1.5 sm:grid-cols-3">
              {structure?.classes.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} />
                  {className(c)} <span className="text-xs text-gray-400">({c.studentCount})</span>
                </label>
              ))}
            </div>
          )}
          {kind === 'sections' && (
            <div className="grid gap-1.5 sm:grid-cols-3">
              {structure?.classes.flatMap((c) =>
                c.sections.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} />
                    {className(c, s)} <span className="text-xs text-gray-400">({s.studentCount})</span>
                  </label>
                )),
              )}
            </div>
          )}
          {kind === 'students' && <StudentPicker value={students} onChange={setStudents} />}
          {kind === 'staff' && (
            <div className="flex gap-4 text-sm">
              {[
                ['TEACHER', 'Teachers'],
                ['STAFF', 'Office staff'],
              ].map(([r, l]) => (
                <label key={r} className="flex items-center gap-2">
                  <input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])} />
                  {l}
                </label>
              ))}
            </div>
          )}
        </Card>

        <Card title="2. Message">
          <div className="space-y-4">
            <Field label="Title" hint="Shown in the app notification">
              <input className="input" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Holiday notice" />
            </Field>
            <Field label="Message">
              <textarea className="input min-h-32" maxLength={900} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="School will remain closed tomorrow due to…" />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span>
                Insert:{' '}
                {kind !== 'staff' &&
                  ['{student}', '{class}'].map((p) => (
                    <button key={p} className="mr-1 rounded bg-gray-100 px-1.5 py-0.5 font-mono hover:bg-gray-200" onClick={() => setMessage((m) => `${m}${p}`)}>
                      {p}
                    </button>
                  ))}
                <button className="rounded bg-gray-100 px-1.5 py-0.5 font-mono hover:bg-gray-200" onClick={() => setMessage((m) => `${m}{parent}`)}>
                  {'{parent}'}
                </button>
              </span>
              <span>{message.length}/900</span>
            </div>
            <p className="text-xs text-gray-500">Using {'{student}'} or {'{class}'} sends a separate message for each child. On WhatsApp, line breaks become spaces.</p>
          </div>
        </Card>

        <Card title="3. How and when">
          <div className="space-y-3 text-sm">
            <label className={`flex items-start gap-2 ${preview && !preview.whatsappAvailable ? 'opacity-50' : ''}`}>
              <input type="checkbox" className="mt-0.5" disabled={Boolean(preview && !preview.whatsappAvailable)} checked={channels.whatsapp} onChange={(e) => setChannels({ ...channels, whatsapp: e.target.checked })} />
              <span>
                WhatsApp
                {preview && !preview.whatsappAvailable && (
                  <span className="block text-xs text-gray-500">
                    Not connected or switched off.{' '}
                    {me?.user.role === 'PRINCIPAL' && (
                      <Link href="/school/whatsapp" className="text-brand-700 underline">
                        Set up WhatsApp
                      </Link>
                    )}
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={channels.inApp} onChange={(e) => setChannels({ ...channels, inApp: e.target.checked })} />
              App notification (parents and staff who log in)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} />
              Send WhatsApp later
            </label>
            {schedule && <input className="input w-auto" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />}
          </div>
        </Card>
      </div>

      <div className="lg:col-span-2">
        <div className="space-y-4 lg:sticky lg:top-4">
          <Card title="Preview">
            {!preview ? (
              <p className="text-sm text-gray-500">Choose who gets it and type the message to see a preview.</p>
            ) : (
              <>
                <div className="rounded-2xl rounded-tl-sm bg-[#dcf8c6] p-3 text-sm text-gray-900 shadow-sm">{preview.sample}</div>
                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">WhatsApp numbers</dt>
                    <dd className="font-medium">{preview.whatsappNumbers}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">App notifications</dt>
                    <dd className="font-medium">{preview.appUsers}</dd>
                  </div>
                  {preview.invalidNumbers + preview.noNumber > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <dt>No valid number</dt>
                      <dd className="font-medium">{preview.invalidNumbers + preview.noNumber}</dd>
                    </div>
                  )}
                </dl>
              </>
            )}
          </Card>
          <ErrorBox error={error} />
          <Button className="w-full" disabled={!preview || title.trim().length < 2 || (!channels.whatsapp && !channels.inApp) || (schedule && !sendAt)} onClick={() => setConfirm(true)}>
            {schedule ? 'Schedule message' : 'Send message'}
          </Button>
        </div>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Send this message?">
        <p className="text-sm text-gray-700">
          {channels.whatsapp && preview ? `${preview.whatsappNumbers} WhatsApp message(s)` : ''}
          {channels.whatsapp && channels.inApp ? ' and ' : ''}
          {channels.inApp && preview ? `${preview.appUsers} app notification(s)` : ''} will be sent. WhatsApp messages are charged to your school’s Meta account.
        </p>
        <div className="mt-4 flex gap-2">
          <Button onClick={send} loading={sending}>
            Yes, send
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function StudentPicker({ value, onChange }: { value: { id: string; label: string }[]; onChange: (v: { id: string; label: string }[]) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ id: string; fullName: string; class: { name: string; stream: string | null }; section: { name: string } | null }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(() => api.get<{ students: typeof res }>(`/students?q=${encodeURIComponent(q)}&pageSize=10`).then((r) => setRes(r.students)).catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <input className="input" placeholder="Type a student or father name, admission no…" value={q} onChange={(e) => setQ(e.target.value)} />
      {res.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200">
          {res
            .filter((r) => !value.some((v) => v.id === r.id))
            .map((r) => (
              <li key={r.id}>
                <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50" onClick={() => onChange([...value, { id: r.id, label: `${r.fullName} (${className(r.class, r.section)})` }])}>
                  {r.fullName} <span className="text-gray-500">· {className(r.class, r.section)}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {value.map((v) => (
          <span key={v.id} className="flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-800">
            {v.label}
            <button onClick={() => onChange(value.filter((x) => x.id !== v.id))} aria-label="Remove">
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- History ----------

interface Batch {
  id: string;
  title: string;
  body: string;
  total: number;
  createdAt: string;
  scheduledAt: string | null;
  createdBy: string | null;
  channels: { whatsapp: boolean; inApp: boolean };
  counts: Record<string, number>;
}

function History() {
  const { data, error, loading, reload } = useData<{ batches: Batch[] }>('/messaging/batches');
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <Card>
      {!data?.batches.length ? (
        <Empty title="No messages sent yet" />
      ) : (
        <Table head={['Message', 'Sent', 'WhatsApp', '']}>
          {data.batches.map((b) => {
            const c = b.counts;
            const wa = Object.values(c).reduce((a, n) => a + n, 0);
            return (
              <tr key={b.id} className="align-top">
                <Td className="whitespace-normal">
                  <div className="font-medium">{b.title}</div>
                  <div className="line-clamp-2 max-w-md text-xs text-gray-500">{b.body}</div>
                </Td>
                <Td className="text-gray-600">
                  {dateTime(b.createdAt)}
                  {b.createdBy && <div className="text-xs">by {b.createdBy}</div>}
                  {b.scheduledAt && <div className="text-xs text-brand-700">for {dateTime(b.scheduledAt)}</div>}
                </Td>
                <Td>
                  {wa === 0 ? (
                    <span className="text-xs text-gray-400">App only</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(['READ', 'DELIVERED', 'SENT', 'QUEUED', 'FAILED', 'SKIPPED'] as const).filter((k) => c[k]).map((k) => (
                        <Badge key={k} tone={msgTone[k]}>
                          {msgLabel[k]} {c[k]}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Td>
                <Td className="text-right">
                  <Button variant="ghost" onClick={() => setOpen(b.id)}>
                    Details
                  </Button>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      {open && <BatchModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </Card>
  );
}

function BatchModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, reload } = useData<{
    batch: Batch;
    messages: { id: string; toName: string | null; toPhone: string; status: string; error: string | null; sentAt: string | null; deliveredAt: string | null; readAt: string | null }[];
    notifications: number;
    readNotifications: number;
  }>(`/messaging/batches/${id}`);
  const failed = data?.messages.filter((m) => m.status === 'FAILED').length ?? 0;
  return (
    <Modal open onClose={onClose} title={data?.batch.title ?? 'Message'} wide>
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm">{data.batch.body}</p>
          {data.notifications > 0 && (
            <p className="text-sm text-gray-600">
              App notifications: {data.notifications} sent, {data.readNotifications} opened.
            </p>
          )}
          {failed > 0 && (
            <Button
              variant="secondary"
              onClick={async () => {
                const r = await api.post<{ retried: number }>('/messaging/retry', { batchId: id });
                toast(`${r.retried} message(s) will be tried again`);
                reload();
                onChanged();
              }}
            >
              Retry {failed} failed
            </Button>
          )}
          {data.messages.length > 0 && (
            <div className="max-h-[50vh] overflow-y-auto">
              <Table head={['To', 'Number', 'Status']}>
                {data.messages.map((m) => (
                  <tr key={m.id}>
                    <Td>{m.toName}</Td>
                    <Td className="font-mono text-xs">{m.toPhone}</Td>
                    <Td className="whitespace-normal">
                      <Badge tone={msgTone[m.status]}>{msgLabel[m.status]}</Badge>
                      {m.error && <div className="mt-0.5 max-w-xs text-xs text-red-600">{m.error}</div>}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------- Log ----------

function Log() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(type && { type }), ...(status && { status }) });
  const { data, error, loading } = useData<{ rows: { id: string; type: string; toName: string | null; toPhone: string; status: string; error: string | null; body: string; createdAt: string }[]; total: number; pageSize: number }>(`/messaging/log?${qs}`);
  const { data: stats } = useData<{ rows: { type: string; status: string; count: number }[] }>('/messaging/stats');
  const sentThisMonth = stats?.rows.filter((r) => ['SENT', 'DELIVERED', 'READ'].includes(r.status)).reduce((a, r) => a + r.count, 0) ?? 0;
  const failedThisMonth = stats?.rows.filter((r) => r.status === 'FAILED').reduce((a, r) => a + r.count, 0) ?? 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase text-gray-500">Sent this month</div>
          <div className="mt-1 text-2xl font-semibold">{sentThisMonth}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase text-gray-500">Failed this month</div>
          <div className="mt-1 text-2xl font-semibold">{failedThisMonth}</div>
        </div>
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <select className="input w-auto" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {Object.entries(typeLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {Object.entries(msgLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.rows.length ? (
          <Empty title="No WhatsApp messages yet" />
        ) : (
          <>
            <Table head={['When', 'Type', 'To', 'Message', 'Status']}>
              {data.rows.map((m) => (
                <tr key={m.id} className="align-top">
                  <Td className="text-gray-600">{dateTime(m.createdAt)}</Td>
                  <Td>{typeLabel[m.type] ?? m.type}</Td>
                  <Td>
                    {m.toName}
                    <div className="font-mono text-xs text-gray-500">{m.toPhone}</div>
                  </Td>
                  <Td className="max-w-sm whitespace-normal text-xs text-gray-600">{m.body}</Td>
                  <Td className="whitespace-normal">
                    <Badge tone={msgTone[m.status]}>{msgLabel[m.status]}</Badge>
                    {m.error && <div className="mt-0.5 max-w-[14rem] text-xs text-red-600">{m.error}</div>}
                  </Td>
                </tr>
              ))}
            </Table>
            {pages > 1 && (
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
