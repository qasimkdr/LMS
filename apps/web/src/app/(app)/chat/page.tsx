'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Avatar } from '@/components/Avatar';
import { Badge, Button, Empty, ErrorBox, Loading, Modal, PageHeader } from '@/components/ui';
import { FileList } from '@/components/lms/Files';

interface Room {
  sectionId: string;
  label: string;
  mode: string;
  last: { text: string; at: string; by: string } | null;
  reports: number;
}
interface Msg {
  id: string;
  sender: { id: string; fullName: string; role: string; photoFileId: string | null };
  text: string | null;
  file: { id: string; name: string; mimeType: string; sizeBytes: number } | null;
  replyTo: { id: string; text: string; by: string } | null;
  createdAt: string;
  deleted: boolean;
  mine: boolean;
  reported: boolean;
  reportReason: string | null;
}
interface RoomData {
  room: { sectionId: string; label: string; mode: string; enabled: boolean; days: number };
  moderator: boolean;
  canSend: boolean;
  mutedUntil: string | null;
  messages: Msg[];
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const MODE_LABEL: Record<string, string> = { OPEN: 'Everyone can write', TEACHERS_ONLY: 'Only teachers can write', CLOSED: 'Closed' };

export default function ChatPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Chat />
    </Suspense>
  );
}

function Chat() {
  const params = useSearchParams();
  const router = useRouter();
  const { me } = useAuth();
  const { data, error, loading, reload } = useData<{ enabled: boolean; days: number; rooms: Room[] }>('/chat/rooms');
  const roomId = params.get('room') ?? data?.rooms[0]?.sectionId ?? null;
  const [settings, setSettings] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const multi = data.rooms.length > 1;
  return (
    <>
      <PageHeader
        title="Class chat"
        subtitle={`Messages and files are removed automatically after ${data.days} days.`}
        actions={
          me?.user.role === 'PRINCIPAL' && (
            <Button variant="secondary" onClick={() => setSettings(true)}>
              {data.enabled ? 'Class chat is on' : 'Class chat is off'}
            </Button>
          )
        }
      />
      {!data.rooms.length ? (
        <Empty title="No class chat yet">You will see your class here once you are in a section.</Empty>
      ) : (
        <div className={`grid gap-4 ${multi ? 'lg:grid-cols-[18rem_1fr]' : ''}`}>
          {multi && (
            <aside className={`reveal rounded-2xl border border-gray-200/70 bg-white p-2 shadow-sm ${roomId && params.get('room') ? 'hidden lg:block' : ''}`}>
              <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto">
                {data.rooms.map((r) => (
                  <li key={r.sectionId}>
                    <button onClick={() => router.replace(`/chat?room=${r.sectionId}`)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition duration-200 active:scale-[0.98] ${r.sectionId === roomId ? 'bg-brand-50 ring-1 ring-brand-100' : 'hover:bg-gray-50'}`}>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-sm font-semibold text-white shadow-md shadow-brand-600/20">{r.label.replace(/^Class /, '').slice(0, 3)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{r.label}</span>
                          {r.last && <span className="shrink-0 text-[10px] text-gray-400">{time(r.last.at)}</span>}
                        </span>
                        <span className="block truncate text-xs text-gray-500">{r.last ? `${r.last.by.split(' ')[0]}: ${r.last.text}` : 'No messages yet'}</span>
                      </span>
                      {r.reports > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{r.reports}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
          {roomId && <RoomView key={roomId} sectionId={roomId} onBack={multi ? () => router.replace('/chat') : undefined} onChange={reload} />}
        </div>
      )}
      {settings && <ChatSettings enabled={data.enabled} onClose={() => setSettings(false)} onSaved={reload} />}
    </>
  );
}

function RoomView({ sectionId, onBack, onChange }: { sectionId: string; onBack?: () => void; onChange: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<RoomData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get<RoomData>(`/chat/rooms/${sectionId}`);
      setData(r);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [sectionId]);

  // Near real-time: refresh every 4 seconds while the page is visible.
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (atBottom.current && list.current) list.current.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [data?.messages.length]);

  async function send(fileId?: string) {
    if (!text.trim() && !fileId) return;
    setBusy(true);
    try {
      await api.post(`/chat/rooms/${sectionId}/messages`, { text: text.trim() || null, fileId: fileId ?? null, replyToId: reply?.id ?? null });
      setText('');
      setReply(null);
      atBottom.current = true;
      await load();
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append('category', 'CHAT');
    fd.append('file', file);
    try {
      const r = await api.post<{ file: { id: string } }>('/files', fd);
      await send(r.file.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'error');
    }
  }

  async function act(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      toast(msg);
      load();
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  if (error && !data) return <ErrorBox error={error} />;
  if (!data) return <div className="skeleton h-[60vh] rounded-2xl" />;
  let lastDay = '';

  return (
    <section className="reveal flex h-[calc(100vh-14rem)] min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gradient-to-r from-white to-brand-50/40 px-4 py-3">
        {onBack && (
          <button onClick={onBack} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 lg:hidden" aria-label="Back">
            ←
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{data.room.label}</div>
          <div className="text-xs text-gray-500">{MODE_LABEL[data.room.mode]}</div>
        </div>
        <Button variant="ghost" onClick={() => setMembers(true)}>
          Members
        </Button>
        {data.moderator && (
          <select className="input w-auto py-1.5 text-xs" value={data.room.mode} onChange={(e) => act(() => api.put(`/chat/rooms/${sectionId}/mode`, { mode: e.target.value }), 'Chat setting changed')} aria-label="Who can write">
            <option value="OPEN">Everyone can write</option>
            <option value="TEACHERS_ONLY">Only teachers (announcements)</option>
            <option value="CLOSED">Closed</option>
          </select>
        )}
      </header>
      <div className="bg-amber-50/70 px-4 py-1.5 text-center text-[11px] text-amber-800">Messages are deleted after {data.room.days} days. Be kind – your teachers can see everything here.</div>
      <div
        ref={list}
        className="flex-1 space-y-1 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,rgb(15_23_42/0.05)_1px,transparent_0)] bg-[length:18px_18px] px-3 py-4 sm:px-5"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {!data.messages.length && <p className="py-16 text-center text-sm text-gray-400">No messages yet. Say hello 👋</p>}
        {data.messages.map((m) => {
          const day = dayOf(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          const teacher = m.sender.role !== 'STUDENT';
          return (
            <div key={m.id}>
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-white px-3 py-0.5 text-[11px] text-gray-500 shadow-sm ring-1 ring-gray-100">{day}</span>
                </div>
              )}
              <div className={`group flex animate-fade-up items-end gap-2 ${m.mine ? 'flex-row-reverse' : ''}`}>
                {!m.mine && <Avatar fileId={m.sender.photoFileId} name={m.sender.fullName} size={28} />}
                <div className={`max-w-[78%] sm:max-w-[65%]`}>
                  {!m.mine && (
                    <div className="mb-0.5 ml-1 flex items-center gap-1.5 text-[11px] text-gray-500">
                      {m.sender.fullName}
                      {teacher && <Badge tone="blue">Teacher</Badge>}
                    </div>
                  )}
                  <div className={`relative rounded-2xl px-3.5 py-2 text-sm shadow-sm ${m.deleted ? 'bg-gray-100 italic text-gray-400' : m.mine ? 'rounded-br-md bg-brand-500 text-white' : teacher ? 'rounded-bl-md bg-teal-50 text-gray-900 ring-1 ring-teal-100' : 'rounded-bl-md bg-white text-gray-900 ring-1 ring-gray-100'} ${m.reported ? 'ring-2 ring-rose-400' : ''}`}>
                    {m.replyTo && (
                      <div className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs ${m.mine ? 'border-white/60 bg-white/15 text-white/85' : 'border-brand-400 bg-brand-50 text-gray-600'}`}>
                        <span className="font-semibold">{m.replyTo.by}</span>: {m.replyTo.text.slice(0, 80)}
                      </div>
                    )}
                    {m.deleted ? 'This message was deleted' : <span className="whitespace-pre-wrap break-words">{m.text}</span>}
                    {m.file &&
                      (m.file.mimeType.startsWith('image/') ? (
                        <a href={fileUrl(m.file.id)} target="_blank" rel="noreferrer" className="mt-1 block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={fileUrl(m.file.id)} alt={m.file.name} className="max-h-56 rounded-xl" />
                        </a>
                      ) : (
                        <div className="mt-1">
                          <FileList files={[m.file]} />
                        </div>
                      ))}
                    <span className={`ml-2 inline-block align-bottom text-[10px] ${m.mine ? 'text-white/70' : 'text-gray-400'}`}>{time(m.createdAt)}</span>
                  </div>
                  {m.reported && <div className="mt-0.5 text-[11px] text-rose-600">Reported{m.reportReason ? `: ${m.reportReason}` : ''}</div>}
                  {!m.deleted && (
                    <div className={`mt-0.5 flex gap-3 text-[11px] text-gray-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100 max-sm:opacity-100 ${m.mine ? 'justify-end' : ''}`}>
                      {data.canSend && (
                        <button className="hover:text-brand-600" onClick={() => setReply(m)}>
                          Reply
                        </button>
                      )}
                      {!m.mine && !data.moderator && (
                        <button className="hover:text-rose-600" onClick={() => { const reason = prompt('Why are you reporting this message? (optional)'); if (reason !== null) act(() => api.post(`/chat/messages/${m.id}/report`, { reason: reason || null }), 'Reported to your teacher'); }}>
                          Report
                        </button>
                      )}
                      {m.reported && data.moderator && (
                        <button className="hover:text-emerald-600" onClick={() => act(() => api.post(`/chat/messages/${m.id}/review`), 'Marked as reviewed')}>
                          Reviewed
                        </button>
                      )}
                      {(m.mine || data.moderator) && (
                        <button className="hover:text-rose-600" onClick={() => confirm('Delete this message?') && act(() => api.del(`/chat/messages/${m.id}`), 'Deleted')}>
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {data.canSend ? (
        <footer className="border-t border-gray-100 bg-white p-3">
          {reply && (
            <div className="mb-2 flex animate-fade-up items-center gap-2 rounded-xl bg-brand-50 px-3 py-1.5 text-xs text-brand-800">
              <span className="min-w-0 flex-1 truncate">
                Replying to <b>{reply.sender.fullName}</b>: {reply.text ?? 'attachment'}
              </span>
              <button onClick={() => setReply(null)} aria-label="Cancel reply">
                ✕
              </button>
            </div>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input ref={fileInput} type="file" className="hidden" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
            <button type="button" onClick={() => fileInput.current?.click()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 active:scale-90" aria-label="Attach a file">
              📎
            </button>
            <textarea
              className="input max-h-32 min-h-10 flex-1 resize-none py-2"
              rows={1}
              value={text}
              maxLength={2000}
              placeholder="Write a message…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button type="submit" loading={busy} disabled={!text.trim()} className="h-10">
              Send
            </Button>
          </form>
        </footer>
      ) : (
        <footer className="border-t border-gray-100 bg-gray-50 p-3 text-center text-sm text-gray-500">
          {!data.room.enabled ? 'Class chat is switched off by the school.' : data.mutedUntil ? `You are muted until ${new Date(data.mutedUntil).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}.` : data.room.mode === 'CLOSED' ? 'The chat is closed right now.' : 'Only teachers can send messages right now.'}
        </footer>
      )}
      {members && <Members sectionId={sectionId} moderator={data.moderator} onClose={() => setMembers(false)} />}
    </section>
  );
}

function Members({ sectionId, moderator, onClose }: { sectionId: string; moderator: boolean; onClose: () => void }) {
  const toast = useToast();
  const { data, reload } = useData<{ teachers: { id: string; fullName: string; photoFileId: string | null; classTeacher: boolean }[]; students: { id: string; fullName: string; rollNo: string | null; photoFileId: string | null; mutedUntil: string | null }[] }>(`/chat/rooms/${sectionId}/members`);
  return (
    <Modal open onClose={onClose} title="Members">
      {!data ? (
        <Loading />
      ) : (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Teachers</div>
            {data.teachers.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-1.5 text-sm">
                <Avatar fileId={t.photoFileId} name={t.fullName} size={30} />
                {t.fullName} {t.classTeacher && <Badge tone="blue">Class teacher</Badge>}
              </div>
            ))}
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Students ({data.students.length})</div>
            {data.students.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-1.5 text-sm">
                <Avatar fileId={s.photoFileId} name={s.fullName} size={30} />
                <span className="flex-1">{s.fullName}</span>
                {moderator &&
                  (s.mutedUntil ? (
                    <button className="text-xs text-brand-700 hover:underline" onClick={async () => { await api.post(`/chat/rooms/${sectionId}/mute`, { userId: s.id, minutes: 0 }); toast('Unmuted'); reload(); }}>
                      Unmute
                    </button>
                  ) : (
                    <select className="input w-auto py-1 text-xs" value="" onChange={async (e) => { if (!e.target.value) return; await api.post(`/chat/rooms/${sectionId}/mute`, { userId: s.id, minutes: Number(e.target.value) }); toast(`${s.fullName} muted`); reload(); }} aria-label={`Mute ${s.fullName}`}>
                      <option value="">Mute…</option>
                      <option value="60">1 hour</option>
                      <option value="1440">1 day</option>
                      <option value="10080">1 week</option>
                    </select>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ChatSettings({ enabled, onClose, onSaved }: { enabled: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title="Class chat for the whole school">
      <p className="text-sm text-gray-600">When off, nobody can send messages in any class chat. Messages already sent stay until they are 30 days old.</p>
      <Button
        className="mt-4"
        variant={enabled ? 'danger' : 'primary'}
        onClick={async () => {
          await api.put('/chat/settings', { classChatEnabled: !enabled });
          toast(enabled ? 'Class chat switched off' : 'Class chat switched on');
          onSaved();
          onClose();
        }}
      >
        {enabled ? 'Switch class chat off' : 'Switch class chat on'}
      </Button>
    </Modal>
  );
}
