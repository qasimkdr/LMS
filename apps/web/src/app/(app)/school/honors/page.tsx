'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Avatar } from '@/components/Avatar';
import { Tabs } from '@/components/Tabs';
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader } from '@/components/ui';
import type { HonorItem } from '@/components/progress/StudentProgress';
import { monthName } from '@/components/progress/StudentProgress';

interface HonorType {
  id: string;
  name: string;
  icon: string;
  scope: 'CLASS' | 'SCHOOL';
  rule: string | null;
  publicDefault: boolean;
  isActive: boolean;
}
interface Pick {
  id: string;
  fullName: string;
  classLabel: string;
  photoFileId: string | null;
  reason?: string;
}

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export default function HonorsPage() {
  const [tab, setTab] = useState<'give' | 'given' | 'types'>('give');
  const types = useData<{ types: HonorType[] }>('/honors/types');
  return (
    <>
      <PageHeader
        title="Honors and awards"
        subtitle="Choose winners (the system suggests them from results and attendance) and decide which honors appear on the honor board."
        actions={
          <Link href="/honors">
            <Button variant="secondary">Open honor board</Button>
          </Link>
        }
      />
      <Tabs
        tabs={[
          { key: 'give', label: 'Give honors' },
          { key: 'given', label: 'Given honors' },
          { key: 'types', label: 'Honor types' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {!types.data ? <Loading /> : tab === 'give' ? <Give types={types.data.types.filter((t) => t.isActive)} onDone={() => setTab('given')} /> : tab === 'given' ? <Given /> : <Types types={types.data.types} reload={types.reload} />}
    </>
  );
}

function Give({ types, onDone }: { types: HonorType[]; onDone: () => void }) {
  const toast = useToast();
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [period, setPeriod] = useState(lastMonth());
  const [freePeriod, setFreePeriod] = useState('');
  const [monthly, setMonthly] = useState(true);
  const [picked, setPicked] = useState<Map<string, Pick>>(new Map());
  const [citation, setCitation] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [notify, setNotify] = useState(true);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const type = types.find((t) => t.id === typeId);
  useEffect(() => setIsPublic(type?.publicDefault ?? true), [type]);
  const sug = useData<{ suggestions: Record<string, { student: Pick; reason: string }[]> }>(monthly ? `/honors/suggestions?period=${period}` : null);
  const suggestions = type?.rule ? (sug.data?.suggestions[type.rule] ?? []) : [];
  const search = useData<{ students: { id: string; fullName: string; status: string; photoFileId: string | null; class: { name: string; stream: string | null }; section: { name: string } | null }[] }>(q.trim().length >= 2 ? `/search?q=${encodeURIComponent(q.trim())}` : null);
  const finalPeriod = monthly ? period : freePeriod.trim();

  const toggle = (p: Pick) => {
    const n = new Map(picked);
    if (n.has(p.id)) n.delete(p.id);
    else n.set(p.id, p);
    setPicked(n);
  };

  async function give() {
    setBusy(true);
    try {
      const r = await api.post<{ created: number; skipped: number; whatsapp: number }>('/honors', { typeId, studentIds: [...picked.keys()], period: finalPeriod, citation: citation || null, isPublic, notify, whatsapp: notify });
      toast(`${type?.name} given to ${r.created} student(s)${r.skipped ? ` · ${r.skipped} already had it` : ''}${r.whatsapp ? ` · ${r.whatsapp} WhatsApp message(s) queued` : ''}`);
      setPicked(new Map());
      setCitation('');
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <Card title="1. Honor and period">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Honor">
              <select
                className="input"
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  setPicked(new Map());
                }}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icon} {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <div className="label flex items-center justify-between">
                <span>Period</span>
                <button type="button" className="text-xs font-normal text-brand-700 hover:underline" onClick={() => setMonthly(!monthly)}>
                  {monthly ? 'Use another period' : 'Use a month'}
                </button>
              </div>
              {monthly ? (
                <input className="input" type="month" value={period} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
              ) : (
                <input className="input" value={freePeriod} onChange={(e) => setFreePeriod(e.target.value)} placeholder="e.g. 2026-27, Sports Day 2026" maxLength={30} />
              )}
            </div>
          </div>
          {type && <p className="mt-2 text-xs text-gray-500">{type.scope === 'CLASS' ? 'Usually one winner in each class.' : 'Usually a few winners from the whole school.'}</p>}
        </Card>

        <Card title="2. Choose winners">
          {type?.rule && monthly && (
            <div className="mb-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Suggested for {monthName(period)}</div>
              {sug.loading && !sug.data ? (
                <Loading />
              ) : !suggestions.length ? (
                <p className="text-sm text-gray-500">No student qualifies for this month (based on published results and attendance). You can still choose any student below.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {suggestions.map((s) => {
                    const on = picked.has(s.student.id);
                    return (
                      <li key={s.student.id}>
                        <button type="button" onClick={() => toggle({ ...s.student, reason: s.reason })} className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${on ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <input type="checkbox" readOnly checked={on} tabIndex={-1} />
                          <Avatar fileId={s.student.photoFileId} name={s.student.fullName} size={36} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{s.student.fullName}</span>
                            <span className="block truncate text-xs text-gray-500">
                              {s.student.classLabel} · {s.reason}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          <Field label="Find any student">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, admission number or roll number" />
          </Field>
          {q.trim().length >= 2 && (
            <ul className="mt-2 divide-y divide-gray-100">
              {search.data?.students
                .filter((s) => s.status === 'ACTIVE')
                .map((s) => {
                  const p: Pick = { id: s.id, fullName: s.fullName, photoFileId: s.photoFileId, classLabel: `${s.class.name}${s.class.stream ? ` ${s.class.stream}` : ''}${s.section ? ` ${s.section.name}` : ''}` };
                  return (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-center gap-3 py-2 text-sm">
                        <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(p)} />
                        <Avatar fileId={s.photoFileId} name={s.fullName} size={28} />
                        {s.fullName} <span className="text-xs text-gray-500">{p.classLabel}</span>
                      </label>
                    </li>
                  );
                })}
              {search.data && !search.data.students.length && <li className="py-2 text-sm text-gray-500">No student found.</li>}
            </ul>
          )}
        </Card>
      </div>

      <Card title="3. Give">
        {!picked.size ? (
          <p className="text-sm text-gray-500">Choose at least one student.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {[...picked.values()].map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span className="text-lg">{type?.icon}</span>
                <span className="min-w-0 flex-1 truncate">
                  {p.fullName} <span className="text-xs text-gray-500">{p.classLabel}</span>
                </span>
                <button className="text-gray-400 hover:text-red-600" onClick={() => toggle(p)} aria-label={`Remove ${p.fullName}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3">
          <Field label="Citation (optional)">
            <input className="input" value={citation} maxLength={300} onChange={(e) => setCitation(e.target.value)} placeholder="e.g. For excellent results and helping classmates" />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            <span>
              Show on the honor board
              <span className="block text-xs text-gray-500">Everyone in the school can see it. Untick to keep it on the student’s profile only.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span>
              Congratulate parents
              <span className="block text-xs text-gray-500">In the app, and on WhatsApp if honors messages are on.</span>
            </span>
          </label>
          <Button className="w-full" disabled={!picked.size || finalPeriod.length < 2} loading={busy} onClick={give}>
            Give {type?.name ?? 'honor'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Given() {
  const toast = useToast();
  const [period, setPeriod] = useState('');
  const { data, loading, reload } = useData<{ honors: HonorItem[] }>(`/honors${period ? `?period=${period}` : ''}`);
  const periods = useMemo(() => [...new Set((data?.honors ?? []).map((h) => h.period))], [data]);
  const [removing, setRemoving] = useState<HonorItem | null>(null);
  return (
    <Card
      title="Given honors"
      actions={
        <select className="input w-auto py-1" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
          <option value="">All periods</option>
          {periods.map((p) => (
            <option key={p} value={p}>
              {monthName(p)}
            </option>
          ))}
        </select>
      }
    >
      {loading && !data ? (
        <Loading />
      ) : !data?.honors.length ? (
        <Empty title="No honors given yet" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.honors.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="text-2xl">{h.type.icon}</span>
              <Avatar fileId={h.student.photoFileId} name={h.student.fullName} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {h.student.fullName} <span className="font-normal text-gray-500">· {h.student.classLabel}</span>
                </span>
                <span className="block text-xs text-gray-500">
                  {h.type.name} · {h.periodLabel}
                  {h.citation && ` · ${h.citation}`}
                </span>
              </span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={h.isPublic}
                  onChange={async (e) => {
                    await api.patch(`/honors/${h.id}`, { isPublic: e.target.checked });
                    toast(e.target.checked ? 'Shown on the honor board' : 'Hidden from the honor board');
                    reload();
                  }}
                />
                On board
              </label>
              <button className="text-sm text-red-600 hover:underline" onClick={() => setRemoving(h)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <Modal open onClose={() => setRemoving(null)} title="Remove honor?">
          <p className="text-sm text-gray-700">
            Remove {removing.type.name} ({removing.periodLabel}) from {removing.student.fullName}? Parents who were already congratulated are not told.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              onClick={async () => {
                await api.del(`/honors/${removing.id}`);
                setRemoving(null);
                reload();
              }}
            >
              Remove
            </Button>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function Types({ types, reload }: { types: HonorType[]; reload: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', icon: '🏅', scope: 'CLASS', publicDefault: true });
  const patch = async (id: string, body: Partial<HonorType>) => {
    try {
      await api.patch(`/honors/types/${id}`, body);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };
  return (
    <Card
      title="Honor types"
      actions={
        <Button variant="secondary" onClick={() => setAdding(true)}>
          + New honor
        </Button>
      }
    >
      <ul className="divide-y divide-gray-100">
        {types.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="text-2xl">{t.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {t.name} {!t.isActive && <Badge tone="gray">hidden</Badge>}
              </span>
              <span className="block text-xs text-gray-500">
                {t.scope === 'CLASS' ? 'Per class' : 'Whole school'}
                {t.rule && ' · suggestions from results/attendance'}
              </span>
            </span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={t.publicDefault} onChange={(e) => patch(t.id, { publicDefault: e.target.checked })} /> On board by default
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={t.isActive} onChange={(e) => patch(t.id, { isActive: e.target.checked })} /> In use
            </label>
          </li>
        ))}
      </ul>
      {adding && (
        <Modal open onClose={() => setAdding(false)} title="New honor">
          <div className="space-y-4">
            <div className="grid grid-cols-[5rem_1fr] gap-3">
              <Field label="Icon">
                <input className="input text-center text-xl" value={form.icon} maxLength={4} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
              </Field>
              <Field label="Name">
                <input className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Best Speaker" />
              </Field>
            </div>
            <Field label="Given">
              <select className="input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                <option value="CLASS">Per class</option>
                <option value="SCHOOL">Whole school</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.publicDefault} onChange={(e) => setForm({ ...form, publicDefault: e.target.checked })} /> Show on the honor board by default
            </label>
            <Button
              disabled={form.name.trim().length < 2}
              onClick={async () => {
                try {
                  await api.post('/honors/types', form);
                  toast('Honor added');
                  setAdding(false);
                  setForm({ name: '', icon: '🏅', scope: 'CLASS', publicDefault: true });
                  reload();
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Failed', 'error');
                }
              }}
            >
              Add honor
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
