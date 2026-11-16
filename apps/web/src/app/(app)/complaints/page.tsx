'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, PageHeader, type Tone } from '@/components/ui';
import { CountUp } from '@/components/fx';
import { FileAttach, FileList, type FileInfo } from '@/components/lms/Files';
import { date, dateTime } from '@/lib/format';

interface Summary {
  id: string;
  ticketNo: number;
  category: string;
  subject: string;
  status: string;
  privateFromTeachers: boolean;
  parent: string;
  student: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
}
const CATEGORY: Record<string, string> = { TEACHER: 'About a teacher', STAFF: 'About staff', STUDENT: 'About a student', FEES: 'Fees', ACADEMICS: 'Studies', FACILITIES: 'Facilities', TRANSPORT: 'Transport', SAFETY: 'Safety', OTHER: 'Other' };
const STATUS: Record<string, { label: string; tone: Tone }> = { NEW: { label: 'New', tone: 'blue' }, IN_PROGRESS: { label: 'In progress', tone: 'amber' }, RESOLVED: { label: 'Resolved', tone: 'green' }, CLOSED: { label: 'Closed', tone: 'gray' } };

export default function ComplaintsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Complaints />
    </Suspense>
  );
}

function Complaints() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useData<{ complaints: Summary[]; counts: Record<string, number>; manager: boolean }>(`/complaints${status ? `?status=${status}` : ''}`);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const open = params.get('id');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const isParent = !data.manager && !data.complaints.some((c) => c.assignedTo);
  return (
    <>
      <PageHeader
        title="Complaints"
        subtitle={data.manager ? 'Complaints from parents, as tickets. Assign, reply and resolve.' : 'Raise a complaint with the principal and follow its progress.'}
        actions={!data.manager && <Button onClick={() => setCreating(true)}>+ New complaint</Button>}
      />
      {data.manager && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(STATUS).map(([k, v], i) => (
            <button key={k} onClick={() => setStatus(status === k ? '' : k)} className={`reveal lift rounded-2xl border bg-white p-4 text-left shadow-sm ${status === k ? 'border-brand-400 ring-4 ring-brand-500/10' : 'border-gray-200/70'}`} style={{ ['--i' as string]: i }}>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{v.label}</div>
              <div className="mt-1 text-2xl font-semibold">
                <CountUp value={data.counts[k] ?? 0} />
              </div>
            </button>
          ))}
        </div>
      )}
      {!data.complaints.length ? (
        <Empty title={status ? 'No complaints with this status' : 'No complaints'}>{isParent ? 'If something is wrong, tell the principal here. You will be told at each step.' : null}</Empty>
      ) : (
        <ul className="space-y-3">
          {data.complaints.map((c, i) => (
            <li key={c.id} className="reveal" style={{ ['--i' as string]: i }}>
              <button onClick={() => router.replace(`/complaints?id=${c.id}`)} className="lift flex w-full flex-wrap items-center gap-3 rounded-2xl border border-gray-200/70 bg-white p-4 text-left shadow-sm">
                <span className="rounded-xl bg-rose-50 px-2.5 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-100">#{c.ticketNo}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.subject}</span>
                  <span className="block truncate text-xs text-gray-500">
                    {CATEGORY[c.category]}
                    {data.manager && ` · ${c.parent}`}
                    {c.student && ` · ${c.student}`}
                    {c.assignedTo && ` · assigned to ${c.assignedTo}`} · {date(c.createdAt)}
                  </span>
                </span>
                {c.privateFromTeachers && <Badge tone="gray">Private</Badge>}
                <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewComplaint conversationId={params.get('conversation')} studentId={params.get('student')} onClose={() => { setCreating(false); router.replace('/complaints'); }} onDone={reload} />}
      {open && <Detail id={open} onClose={() => router.replace('/complaints')} onChange={reload} />}
    </>
  );
}

function NewComplaint({ conversationId, studentId, onClose, onDone }: { conversationId: string | null; studentId: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: kids } = useData<{ children: { student: { id: string; fullName: string } }[] }>('/conversations/teachers');
  const [form, setForm] = useState({ studentId: studentId ?? '', category: conversationId ? 'TEACHER' : 'OTHER', subject: '', description: '', privateFromTeachers: false });
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={conversationId ? 'Escalate to the principal' : 'New complaint'} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="About which child (optional)">
          <select className="input" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
            <option value="">General</option>
            {kids?.children.map((k) => (
              <option key={k.student.id} value={k.student.id}>
                {k.student.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Subject">
            <input className="input" value={form.subject} maxLength={200} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="A short title" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="What happened?">
            <textarea className="input min-h-32" value={form.description} maxLength={4000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5" checked={form.privateFromTeachers} onChange={(e) => setForm({ ...form, privateFromTeachers: e.target.checked })} />
          <span>
            Keep private from teachers
            <span className="block text-xs text-gray-500">Only the principal and office staff will see it.</span>
          </span>
        </label>
        <div className="sm:col-span-2">
          <FileAttach value={files} onChange={setFiles} category="CHAT" />
        </div>
      </div>
      <Button
        className="mt-4"
        loading={busy}
        disabled={form.subject.trim().length < 3 || form.description.trim().length < 5}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api.post<{ ticketNo: number }>('/complaints', { ...form, studentId: form.studentId || null, fileIds: files.map((f) => f.id), conversationId });
            toast(`Complaint #${r.ticketNo} sent to the principal`);
            onDone();
            onClose();
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Failed', 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        Send complaint
      </Button>
    </Modal>
  );
}

interface DetailData {
  complaint: Summary & { description: string; files: FileInfo[] };
  role: 'PARENT' | 'MANAGER' | 'ASSIGNEE';
  entries: { id: string; kind: string; text: string; files: FileInfo[]; author: string; authorRole: string | null; mine: boolean; createdAt: string }[];
  staff: { id: string; fullName: string; role: string }[];
}

function Detail({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const { data, reload } = useData<DetailData>(`/complaints/${id}`);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'REPLY' | 'NOTE'>('REPLY');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const refresh = () => {
    reload();
    onChange();
  };
  const patch = async (body: object) => {
    try {
      await api.patch(`/complaints/${id}`, body);
      toast('Updated');
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };
  return (
    <Modal open onClose={onClose} title={data ? `Complaint #${data.complaint.ticketNo}` : 'Complaint'} wide>
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">{data.complaint.subject}</h3>
              <Badge tone={STATUS[data.complaint.status].tone}>{STATUS[data.complaint.status].label}</Badge>
              {data.complaint.privateFromTeachers && <Badge tone="gray">Private from teachers</Badge>}
            </div>
            <div className="text-xs text-gray-500">
              {CATEGORY[data.complaint.category]} · {data.complaint.parent}
              {data.complaint.student && ` · ${data.complaint.student}`} · {dateTime(data.complaint.createdAt)}
            </div>
            <p className="mt-3 whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-sm">{data.complaint.description}</p>
            {data.complaint.files.length > 0 && (
              <div className="mt-2">
                <FileList files={data.complaint.files} />
              </div>
            )}
          </div>
          {data.role !== 'PARENT' && (
            <div className="grid gap-3 rounded-2xl bg-brand-50/60 p-3 sm:grid-cols-2">
              <Field label="Status">
                <select className="input" value={data.complaint.status} onChange={(e) => patch({ status: e.target.value })}>
                  {Object.entries(STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
              {data.role === 'MANAGER' && (
                <Field label="Assigned to">
                  <select className="input" value={data.staff.find((s) => s.fullName === data.complaint.assignedTo)?.id ?? ''} onChange={(e) => patch({ assignedToId: e.target.value || null })}>
                    <option value="">Nobody</option>
                    {data.staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} ({s.role === 'TEACHER' ? 'teacher' : 'staff'})
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          )}
          <ol className="relative space-y-3 border-l-2 border-gray-100 pl-5">
            {data.entries.map((e) => (
              <li key={e.id} className="relative animate-fade-up">
                <span className={`absolute -left-[1.6rem] top-1.5 h-3 w-3 rounded-full border-2 border-white shadow ${e.kind === 'NOTE' ? 'bg-amber-400' : e.kind === 'REPLY' ? 'bg-brand-500' : 'bg-gray-300'}`} />
                {e.kind === 'STATUS' || e.kind === 'ASSIGN' ? (
                  <div className="text-xs text-gray-500">
                    {e.kind === 'STATUS' ? `Status changed to ${e.text}` : e.text} · {e.author} · {dateTime(e.createdAt)}
                  </div>
                ) : (
                  <div className={`rounded-xl p-3 text-sm ${e.kind === 'NOTE' ? 'bg-amber-50 ring-1 ring-amber-100' : e.mine ? 'bg-brand-50' : 'bg-white ring-1 ring-gray-100'}`}>
                    <div className="mb-1 text-xs text-gray-500">
                      <b className="text-gray-800">{e.author}</b> {e.kind === 'NOTE' && '· internal note'} · {dateTime(e.createdAt)}
                    </div>
                    <p className="whitespace-pre-wrap">{e.text}</p>
                    {e.files.length > 0 && (
                      <div className="mt-2">
                        <FileList files={e.files} />
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
            {!data.entries.length && <li className="text-sm text-gray-400">No replies yet.</li>}
          </ol>
          {!(data.role === 'PARENT' && data.complaint.status === 'CLOSED') && (
            <div className="space-y-2 border-t border-gray-100 pt-4">
              {data.role !== 'PARENT' && (
                <div className="flex gap-2">
                  {(['REPLY', 'NOTE'] as const).map((k) => (
                    <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-xs font-medium transition ${kind === k ? (k === 'NOTE' ? 'bg-amber-100 text-amber-900' : 'bg-brand-100 text-brand-800') : 'bg-gray-100 text-gray-600'}`}>
                      {k === 'REPLY' ? 'Reply to parent' : 'Internal note'}
                    </button>
                  ))}
                </div>
              )}
              <textarea className="input min-h-20" value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} placeholder={kind === 'NOTE' ? 'Only school staff see this' : 'Write a reply'} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FileAttach value={files} onChange={setFiles} category="CHAT" max={3} />
                <Button
                  disabled={!text.trim()}
                  onClick={async () => {
                    try {
                      await api.post(`/complaints/${id}/entries`, { kind, text, fileIds: files.map((f) => f.id) });
                      setText('');
                      setFiles([]);
                      toast(kind === 'NOTE' ? 'Note added' : 'Reply sent');
                      refresh();
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Failed', 'error');
                    }
                  }}
                >
                  {kind === 'NOTE' ? 'Add note' : 'Send reply'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
