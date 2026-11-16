'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Avatar } from '@/components/Avatar';
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { FileAttach, FileList, type FileInfo } from '@/components/lms/Files';

interface Conv {
  id: string;
  kind: string;
  parent: { id: string; fullName: string };
  teacher: { id: string; fullName: string; photoFileId: string | null };
  student: { id: string; fullName: string; classLabel: string } | null;
  last: { text: string; at: string; mine: boolean } | null;
  unread: number;
  forwardedAt: string | null;
}
interface Thread {
  conversation: Conv;
  role: 'PARENT' | 'TEACHER' | 'PRINCIPAL';
  messages: { id: string; senderId: string; sender: string; text: string; isAuto: boolean; files: FileInfo[]; readAt: string | null; createdAt: string; mine: boolean }[];
}
const KIND: Record<string, { label: string; tone: 'gray' | 'blue' | 'red' }> = { GENERAL: { label: 'Message', tone: 'gray' }, QUERY: { label: 'Query', tone: 'blue' }, COMPLAINT: { label: 'Complaint', tone: 'red' } };
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export default function ConversationsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Conversations />
    </Suspense>
  );
}

function Conversations() {
  const { me } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const role = me?.user.role;
  const [all, setAll] = useState(true);
  const { data, error, loading, reload } = useData<{ conversations: Conv[] }>(`/conversations${role === 'PRINCIPAL' && all ? '?all=true' : ''}`);
  const [composing, setComposing] = useState(false);
  const [hours, setHours] = useState(false);
  const open = params.get('c');
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 10000);
    return () => clearInterval(t);
  }, [reload]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const list = data?.conversations ?? [];
  const other = (c: Conv) => (role === 'PARENT' ? c.teacher.fullName : c.parent.fullName);
  return (
    <>
      <PageHeader
        title={role === 'PARENT' ? 'Message a teacher' : 'Parent messages'}
        subtitle={role === 'PARENT' ? "Write to your child's class teacher or subject teachers." : role === 'PRINCIPAL' ? 'All conversations between parents and teachers (read-only).' : 'Messages from parents of your students.'}
        actions={
          <>
            {role === 'PARENT' && <Button onClick={() => setComposing(true)}>+ New message</Button>}
            {role === 'TEACHER' && (
              <Button variant="secondary" onClick={() => setHours(true)}>
                Message hours
              </Button>
            )}
            {role === 'PRINCIPAL' && (
              <Button variant="secondary" onClick={() => setAll(!all)}>
                {all ? 'Show forwarded only' : 'Show all'}
              </Button>
            )}
          </>
        }
      />
      {!list.length ? (
        <Empty title="No messages yet">{role === 'PARENT' ? 'Start a conversation with one of your child’s teachers.' : 'Parents’ messages will appear here.'}</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <aside className={`reveal rounded-2xl border border-gray-200/70 bg-white p-2 shadow-sm ${open ? 'hidden lg:block' : ''}`}>
            <ul className="max-h-[72vh] space-y-0.5 overflow-y-auto">
              {list.map((c) => (
                <li key={c.id}>
                  <button onClick={() => router.replace(`/conversations?c=${c.id}`)} className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition duration-200 active:scale-[0.98] ${c.id === open ? 'bg-brand-50 ring-1 ring-brand-100' : 'hover:bg-gray-50'}`}>
                    <Avatar fileId={role === 'PARENT' ? c.teacher.photoFileId : null} name={other(c)} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${c.unread ? 'font-bold' : 'font-semibold'}`}>{role === 'PRINCIPAL' ? `${c.parent.fullName} → ${c.teacher.fullName}` : other(c)}</span>
                        {c.last && <span className="shrink-0 text-[10px] text-gray-400">{when(c.last.at)}</span>}
                      </span>
                      <span className="block truncate text-xs text-gray-500">About {c.student?.fullName}</span>
                      <span className={`block truncate text-xs ${c.unread ? 'font-medium text-gray-800' : 'text-gray-500'}`}>
                        {c.last?.mine ? 'You: ' : ''}
                        {c.last?.text}
                      </span>
                    </span>
                    {c.unread > 0 && <span className="mt-1 animate-pop rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          {open ? <ThreadView key={open} id={open} onBack={() => router.replace('/conversations')} onChange={reload} /> : <div className="hidden items-center justify-center rounded-2xl border border-dashed border-gray-300 text-sm text-gray-400 lg:flex">Choose a conversation</div>}
        </div>
      )}
      {composing && <Compose onClose={() => setComposing(false)} onSent={(id) => { reload(); router.replace(`/conversations?c=${id}`); }} />}
      {hours && <Hours onClose={() => setHours(false)} />}
    </>
  );
}

function ThreadView({ id, onBack, onChange }: { id: string; onBack: () => void; onChange: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [data, setData] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const load = async () => {
    try {
      setData(await api.get<Thread>(`/conversations/${id}`));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };
  useEffect(() => {
    load().then(onChange);
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    // Braces matter: scrollIntoView returns a promise in newer browsers, which React must not get as a cleanup.
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [data?.messages.length]);
  if (!data) return <div className="skeleton h-[60vh] rounded-2xl" />;
  const c = data.conversation;
  return (
    <section className="reveal flex h-[calc(100vh-14rem)] min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gradient-to-r from-white to-brand-50/40 px-4 py-3">
        <button onClick={onBack} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 lg:hidden" aria-label="Back">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{data.role === 'PARENT' ? c.teacher.fullName : data.role === 'TEACHER' ? c.parent.fullName : `${c.parent.fullName} ↔ ${c.teacher.fullName}`}</div>
          <div className="text-xs text-gray-500">
            About {c.student?.fullName} · {c.student?.classLabel} <Badge tone={KIND[c.kind].tone}>{KIND[c.kind].label}</Badge> {c.forwardedAt && <Badge tone="amber">Forwarded to principal</Badge>}
          </div>
        </div>
        {data.role === 'TEACHER' && !c.forwardedAt && (
          <Button variant="secondary" onClick={async () => { const note = prompt('Note for the principal (optional)'); if (note === null) return; await api.post(`/conversations/${id}/forward`, { note: note || undefined }); toast('Forwarded to the principal'); load(); }}>
            Forward to principal
          </Button>
        )}
        {data.role === 'PARENT' && (
          <Button variant="secondary" onClick={() => router.push(`/complaints?new=1&conversation=${id}&student=${c.student?.id ?? ''}`)}>
            Escalate to principal
          </Button>
        )}
        {data.role === 'PRINCIPAL' && (
          <Button variant="ghost" className="text-red-600" onClick={async () => { if (!confirm('Delete this conversation?')) return; await api.del(`/conversations/${id}`); onChange(); onBack(); }}>
            Delete
          </Button>
        )}
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50/60 px-3 py-4 sm:px-5">
        {data.messages.map((m) => (
          <div key={m.id} className={`flex animate-fade-up ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[65%] ${m.isAuto ? 'bg-amber-50 italic text-amber-900 ring-1 ring-amber-100' : m.mine ? 'rounded-br-md bg-brand-500 text-white' : 'rounded-bl-md bg-white ring-1 ring-gray-100'}`}>
              {data.role === 'PRINCIPAL' && <div className="mb-0.5 text-[11px] font-semibold opacity-70">{m.sender}</div>}
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              {m.files.length > 0 && (
                <div className="mt-2">
                  <FileList files={m.files} />
                </div>
              )}
              <div className={`mt-1 text-right text-[10px] ${m.mine ? 'text-white/70' : 'text-gray-400'}`}>
                {when(m.createdAt)}
                {m.mine && <span className="ml-1">{m.readAt ? '✓✓' : '✓'}</span>}
              </div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {data.role !== 'PRINCIPAL' && (
        <footer className="space-y-2 border-t border-gray-100 bg-white p-3">
          {files.length > 0 && <FileList files={files} />}
          <form
            className="flex items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              setBusy(true);
              try {
                await api.post(`/conversations/${id}/messages`, { text, fileIds: files.map((f) => f.id) });
                setText('');
                setFiles([]);
                await load();
                onChange();
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Failed', 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="shrink-0 [&_button]:h-10 [&_ul]:hidden">
              <FileAttach value={files} onChange={setFiles} category="CHAT" max={5} />
            </div>
            <textarea className="input max-h-32 min-h-10 flex-1 resize-none py-2" rows={1} value={text} maxLength={3000} placeholder="Write a reply…" onChange={(e) => setText(e.target.value)} />
            <Button type="submit" loading={busy} disabled={!text.trim()} className="h-10">
              Send
            </Button>
          </form>
        </footer>
      )}
    </section>
  );
}

function Compose({ onClose, onSent }: { onClose: () => void; onSent: (id: string) => void }) {
  const toast = useToast();
  const { data } = useData<{ children: { student: { id: string; fullName: string; classLabel: string }; teachers: { id: string; fullName: string; photoFileId: string | null; classTeacher: boolean; subjects: string[] }[] }[] }>('/conversations/teachers');
  const [childIdx, setChildIdx] = useState(0);
  const [teacherId, setTeacherId] = useState('');
  const [kind, setKind] = useState('GENERAL');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const child = data?.children[childIdx];
  return (
    <Modal open onClose={onClose} title="New message" wide>
      {!data ? (
        <Loading />
      ) : !data.children.length ? (
        <p className="text-sm text-gray-500">No children linked to your account.</p>
      ) : (
        <div className="space-y-4">
          {data.children.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {data.children.map((c, i) => (
                <button key={c.student.id} onClick={() => { setChildIdx(i); setTeacherId(''); }} className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${i === childIdx ? 'bg-brand-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  {c.student.fullName}
                </button>
              ))}
            </div>
          )}
          <div>
            <div className="label">Teacher of {child?.student.fullName}</div>
            {!child?.teachers.length ? (
              <p className="text-sm text-gray-500">No teachers are assigned to this class yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {child.teachers.map((t) => (
                  <button key={t.id} type="button" onClick={() => setTeacherId(t.id)} className={`flex items-center gap-3 rounded-xl border p-2.5 text-left transition duration-200 active:scale-[0.98] ${teacherId === t.id ? 'border-brand-500 bg-brand-50 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
                    <Avatar fileId={t.photoFileId} name={t.fullName} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{t.fullName}</span>
                      <span className="block truncate text-xs text-gray-500">{[t.classTeacher && 'Class teacher', ...t.subjects].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(KIND).map(([k, v]) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-sm transition ${kind === k ? 'border-brand-500 bg-brand-50 font-medium text-brand-800' : 'border-gray-200 text-gray-600'}`}>
                {v.label}
              </button>
            ))}
          </div>
          <Field label="Message">
            <textarea className="input min-h-28" value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} />
          </Field>
          <FileAttach value={files} onChange={setFiles} category="CHAT" />
          <Button
            loading={busy}
            disabled={!teacherId || !text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.post<{ id: string }>('/conversations', { studentId: child!.student.id, teacherId, kind, text, fileIds: files.map((f) => f.id) });
                toast('Message sent');
                onSent(r.id);
                onClose();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Failed', 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Send message
          </Button>
        </div>
      )}
    </Modal>
  );
}

function Hours({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data } = useData<{ hours: { enabled: boolean; start: string; end: string } }>('/conversations/settings/hours');
  const [h, setH] = useState<{ enabled: boolean; start: string; end: string } | null>(null);
  const v = h ?? data?.hours;
  return (
    <Modal open onClose={onClose} title="Message hours">
      {!v ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={v.enabled} onChange={(e) => setH({ ...v, enabled: e.target.checked })} />
            <span>
              Send an automatic reply outside these hours
              <span className="block text-xs text-gray-500">Parents are told you will reply during school hours (Monday–Saturday).</span>
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input className="input" type="time" value={v.start} onChange={(e) => setH({ ...v, start: e.target.value })} />
            </Field>
            <Field label="To">
              <input className="input" type="time" value={v.end} onChange={(e) => setH({ ...v, end: e.target.value })} />
            </Field>
          </div>
          <Button
            onClick={async () => {
              try {
                await api.put('/conversations/settings/hours', v);
                toast('Saved');
                onClose();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Failed', 'error');
              }
            }}
          >
            Save
          </Button>
        </div>
      )}
    </Modal>
  );
}
