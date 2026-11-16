'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { Gauge } from '@/components/fx';
import { FileAttach, FileList, type FileInfo } from '@/components/lms/Files';
import { className } from '@/lib/types';
import { date, dateTime } from '@/lib/format';

interface Item {
  id: string;
  title: string;
  preview: string;
  audience: string;
  createdAt: string;
  by: string;
  files: number;
  read: boolean;
  recipients?: number;
  reads?: number;
}
const AUD: Record<string, string> = { SCHOOL: 'All parents', CLASSES: 'Selected classes', SECTIONS: 'Selected sections', STAFF: 'Staff only' };

export default function CircularsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Circulars />
    </Suspense>
  );
}

function Circulars() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, error, loading, reload } = useData<{ manager: boolean; circulars: Item[] }>('/circulars');
  const [composing, setComposing] = useState(false);
  const open = params.get('id');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <>
      <PageHeader title="Circulars" subtitle={data.manager ? 'Announcements to parents and staff, with read receipts.' : 'Announcements from the school.'} actions={data.manager && <Button onClick={() => setComposing(true)}>+ New circular</Button>} />
      {!data.circulars.length ? (
        <Empty title="No circulars yet" />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.circulars.map((c, i) => {
            const pct = c.recipients ? Math.round(((c.reads ?? 0) / c.recipients) * 100) : null;
            return (
              <li key={c.id} className="reveal" style={{ ['--i' as string]: i }}>
                <button onClick={() => router.replace(`/circulars?id=${c.id}`)} className="lift group flex h-full w-full items-start gap-4 rounded-2xl border border-gray-200/70 bg-white p-5 text-left shadow-sm">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg text-white shadow-lg transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110 ${c.read || data.manager ? 'bg-brand-500 shadow-brand-600/20' : 'bg-rose-500 shadow-rose-600/25'}`}>✦</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`truncate ${c.read || data.manager ? 'font-semibold' : 'font-bold'}`}>{c.title}</span>
                      {!c.read && !data.manager && <Badge tone="red">New</Badge>}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm text-gray-600">{c.preview}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      {date(c.createdAt)} · {c.by}
                      {c.files > 0 && ` · 📎 ${c.files}`}
                      {data.manager && <Badge tone="gray">{AUD[c.audience]}</Badge>}
                    </span>
                  </span>
                  {pct !== null && (
                    <span className="shrink-0 text-center">
                      <Gauge value={pct} size={56} stroke={6} color="#10b981" />
                      <span className="block text-[10px] text-gray-500">read</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {composing && <Compose onClose={() => setComposing(false)} onSent={reload} />}
      {open && <View id={open} manager={data.manager} onClose={() => { router.replace('/circulars'); reload(); }} />}
    </>
  );
}

function Compose({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const { data: structure } = useData<{ classes: { id: string; name: string; stream: string | null; sections: { id: string; name: string }[] }[] }>('/setup/structure');
  const [f, setF] = useState({ title: '', body: '', audience: 'SCHOOL', classIds: [] as string[], sectionIds: [] as string[], includeStaff: false, whatsapp: false });
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (key: 'classIds' | 'sectionIds', id: string) => setF({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] });
  return (
    <Modal open onClose={onClose} title="New circular" wide>
      <div className="space-y-4">
        <Field label="Title">
          <input className="input" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Winter vacation from 20 December" />
        </Field>
        <Field label="Message">
          <textarea className="input min-h-40" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
        <div>
          <div className="label">Send to</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(AUD).map(([k, v]) => (
              <button key={k} type="button" onClick={() => setF({ ...f, audience: k })} className={`rounded-full border px-3 py-1 text-sm transition ${f.audience === k ? 'border-brand-500 bg-brand-50 font-medium text-brand-800' : 'border-gray-200 text-gray-600'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        {f.audience === 'CLASSES' && (
          <div className="flex animate-fade-up flex-wrap gap-2">
            {structure?.classes.map((c) => (
              <label key={c.id} className={`cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition ${f.classIds.includes(c.id) ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}>
                <input type="checkbox" className="sr-only" checked={f.classIds.includes(c.id)} onChange={() => toggle('classIds', c.id)} />
                {className(c)}
              </label>
            ))}
          </div>
        )}
        {f.audience === 'SECTIONS' && (
          <div className="flex max-h-48 animate-fade-up flex-wrap gap-2 overflow-y-auto">
            {structure?.classes.flatMap((c) =>
              c.sections.map((s) => (
                <label key={s.id} className={`cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition ${f.sectionIds.includes(s.id) ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}>
                  <input type="checkbox" className="sr-only" checked={f.sectionIds.includes(s.id)} onChange={() => toggle('sectionIds', s.id)} />
                  {className(c, s)}
                </label>
              )),
            )}
          </div>
        )}
        {f.audience !== 'STAFF' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.includeStaff} onChange={(e) => setF({ ...f, includeStaff: e.target.checked })} /> Also send to teachers and staff
          </label>
        )}
        {f.audience !== 'STAFF' && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.checked })} />
            <span>
              Also tell parents on WhatsApp
              <span className="block text-xs text-gray-500">One short message per family asking them to read it in the app.</span>
            </span>
          </label>
        )}
        <FileAttach value={files} onChange={setFiles} category="SCHOOL_DOCUMENT" />
        <Button
          loading={busy}
          disabled={f.title.trim().length < 3 || f.body.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ recipients: number; whatsapp: number }>('/circulars', { ...f, fileIds: files.map((x) => x.id) });
              toast(`Sent to ${r.recipients} people${r.whatsapp ? ` · ${r.whatsapp} WhatsApp message(s) queued` : ''}`);
              onSent();
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Send circular
        </Button>
      </div>
    </Modal>
  );
}

function View({ id, manager, onClose }: { id: string; manager: boolean; onClose: () => void }) {
  const { data } = useData<{ circular: { title: string; body: string; createdAt: string; by: string; files: FileInfo[] }; stats?: { recipients: number; reads: number } }>(`/circulars/${id}`);
  const [tab, setTab] = useState<'read' | 'receipts'>('read');
  const [filter, setFilter] = useState<'all' | 'read' | 'unread'>('all');
  const receipts = useData<{ total: number; read: number; rows: { userId: string; name: string; role: string; children: string[]; readAt: string | null }[] }>(manager && tab === 'receipts' ? `/circulars/${id}/receipts` : null);
  return (
    <Modal open onClose={onClose} title={data?.circular.title ?? 'Circular'} wide>
      {!data ? (
        <Loading />
      ) : (
        <>
          {manager && data.stats && (
            <div className="mb-4 flex gap-2">
              {(['read', 'receipts'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-sm font-medium transition ${tab === t ? 'bg-brand-600 text-white shadow' : 'bg-gray-100 text-gray-600'}`}>
                  {t === 'read' ? 'Circular' : `Read receipts (${data.stats!.reads}/${data.stats!.recipients})`}
                </button>
              ))}
            </div>
          )}
          {tab === 'read' ? (
            <div className="animate-fade-in">
              <div className="mb-3 text-xs text-gray-500">
                {dateTime(data.circular.createdAt)} · {data.circular.by}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{data.circular.body}</div>
              {data.circular.files.length > 0 && (
                <div className="mt-4">
                  <FileList files={data.circular.files} />
                </div>
              )}
            </div>
          ) : !receipts.data ? (
            <Loading />
          ) : (
            <div className="animate-fade-in">
              <div className="mb-3 flex items-center gap-4">
                <Gauge value={receipts.data.total ? Math.round((receipts.data.read / receipts.data.total) * 100) : 0} size={72} stroke={7} color="#10b981" />
                <div className="text-sm">
                  <div className="font-semibold">
                    {receipts.data.read} of {receipts.data.total} have read it
                  </div>
                  <div className="mt-1 flex gap-1">
                    {(['all', 'unread', 'read'] as const).map((x) => (
                      <button key={x} onClick={() => setFilter(x)} className={`rounded-full px-2.5 py-0.5 text-xs ${filter === x ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                        {x === 'all' ? 'All' : x === 'read' ? 'Read' : 'Not read'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <ul className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto">
                {receipts.data.rows
                  .filter((r) => filter === 'all' || (filter === 'read' ? r.readAt : !r.readAt))
                  .map((r) => (
                    <li key={r.userId} className="flex items-center gap-3 py-2 text-sm">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${r.readAt ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.children.length ? r.children.join(', ') : r.name}</span>
                        <span className="block truncate text-xs text-gray-500">{r.children.length ? `Parent: ${r.name}` : r.role === 'TEACHER' ? 'Teacher' : 'Staff'}</span>
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">{r.readAt ? dateTime(r.readAt) : 'Not read'}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
