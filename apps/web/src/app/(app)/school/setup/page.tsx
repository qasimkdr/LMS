'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Tabs } from '@/components/Tabs';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';
import { date, dateInput } from '@/lib/format';
import type { ClassLevel, Structure } from '@/lib/types';

type Tab = 'sessions' | 'classes' | 'subjects' | 'campuses' | 'form';

function useAction(reload: () => void) {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done);
      reload();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
      return false;
    }
  };
}

function SetupInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') as Tab) || 'classes';
  const { data, error, loading, reload } = useData<Structure>('/setup/structure');

  return (
    <>
      <PageHeader title="Classes & subjects" subtitle="Academic sessions, classes, sections, subjects, campuses and the admission form" />
      <Tabs
        value={tab}
        onChange={(t) => router.replace(`/school/setup?tab=${t}`)}
        tabs={[
          { key: 'classes', label: 'Classes & sections', count: data?.classes.length },
          { key: 'subjects', label: 'Subjects', count: data?.subjects.length },
          { key: 'sessions', label: 'Sessions', count: data?.sessions.length },
          { key: 'campuses', label: 'Campuses', count: data?.campuses.length },
          { key: 'form', label: 'Admission form' },
        ]}
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          {tab === 'classes' && <ClassesTab data={data} reload={reload} />}
          {tab === 'subjects' && <SubjectsTab data={data} reload={reload} />}
          {tab === 'sessions' && <SessionsTab data={data} reload={reload} />}
          {tab === 'campuses' && <CampusesTab data={data} reload={reload} />}
          {tab === 'form' && <FormTab />}
        </>
      ) : null}
    </>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SetupInner />
    </Suspense>
  );
}

// ---------- Classes ----------

function ClassesTab({ data, reload }: { data: Structure; reload: () => void }) {
  const act = useAction(reload);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClassLevel | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const campusName = (id: string | null) => data.campuses.find((c) => c.id === id)?.name;

  async function preset(upTo: 'matric' | 'intermediate') {
    setPresetBusy(true);
    await act(() => api.post('/setup/classes/presets', { upTo }), 'Classes added');
    setPresetBusy(false);
  }

  return (
    <div className="space-y-4">
      {data.classes.length === 0 && (
        <Card title="Quick start">
          <p className="text-sm text-gray-600">Add the usual class list in one click (each with section A). You can rename, add or remove classes after.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => preset('matric')} loading={presetBusy}>
              Playgroup to Class 10
            </Button>
            <Button variant="secondary" onClick={() => preset('intermediate')} loading={presetBusy}>
              Playgroup to Intermediate (with FSc/ICS/I.Com/FA groups)
            </Button>
          </div>
        </Card>
      )}
      <div className="flex justify-end gap-2">
        {data.classes.length > 0 && (
          <Button variant="secondary" onClick={() => preset('intermediate')} loading={presetBusy}>
            Add missing standard classes
          </Button>
        )}
        <Button onClick={() => setAdding(true)}>+ Add class</Button>
      </div>
      {data.classes.map((c) => (
        <Card
          key={c.id}
          title={
            <span className="flex items-center gap-2">
              {c.name}
              {c.stream && <Badge tone="blue">{c.stream}</Badge>}
              <span className="text-xs font-normal text-gray-500">{c.studentCount} students</span>
            </span>
          }
          actions={
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => setEditing(c)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  const name = prompt(`New section name for ${c.name} (e.g. B)`);
                  if (name) act(() => api.post(`/setup/classes/${c.id}/sections`, { name: name.trim().toUpperCase() }), `Section ${name} added`);
                }}
              >
                + Section
              </Button>
            </div>
          }
        >
          <div className="flex flex-wrap gap-2">
            {c.sections.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
                <span className="font-semibold">{s.name}</span>
                <span className="text-gray-500">
                  {s.studentCount}
                  {s.capacity ? `/${s.capacity}` : ''} students
                </span>
                {s.classTeacher ? <span className="text-gray-600">· {s.classTeacher.fullName}</span> : <span className="text-amber-600">· no class teacher</span>}
                {data.campuses.length > 1 && <span className="text-gray-400">· {campusName(s.campusId)}</span>}
                <button
                  className="ml-1 text-gray-400 hover:text-red-600"
                  title="Delete section"
                  onClick={() => confirm(`Delete section ${c.name} ${s.name}?`) && act(() => api.del(`/setup/sections/${s.id}`), 'Section deleted')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-500">
            Subjects: {c.subjects.length ? c.subjects.map((s) => s.name + (s.isOptional ? ' (optional)' : '')).join(', ') : 'none yet (set them in the Subjects tab)'}
          </div>
        </Card>
      ))}
      {(adding || editing) && (
        <ClassModal
          cls={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            reload();
          }}
          onDelete={
            editing
              ? async () => {
                  if (confirm(`Delete ${editing.name}?`) && (await act(() => api.del(`/setup/classes/${editing.id}`), 'Class deleted'))) setEditing(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function ClassModal({ cls, onClose, onSaved, onDelete }: { cls: ClassLevel | null; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: cls?.name ?? '', stream: cls?.stream ?? '', sortOrder: String(cls?.sortOrder ?? 0), sections: 'A' });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: f.name, stream: f.stream, sortOrder: Number(f.sortOrder) };
      if (cls) await api.patch(`/setup/classes/${cls.id}`, body);
      else await api.post('/setup/classes', { ...body, sections: f.sections.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) });
      toast(cls ? 'Class updated' : 'Class added');
      onSaved();
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={cls ? `Edit ${cls.name}` : 'Add class'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Class name" hint="e.g. Class 5, Nursery, 1st Year">
          <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Group / stream (optional)" hint="For Intermediate: Pre-Medical, ICS…">
          <input className="input" value={f.stream} onChange={(e) => setF({ ...f, stream: e.target.value })} />
        </Field>
        <Field label="Order" hint="Lower numbers come first in lists">
          <input className="input" type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />
        </Field>
        {!cls && (
          <Field label="Sections" hint="Comma separated, e.g. A, B, C">
            <input className="input" value={f.sections} onChange={(e) => setF({ ...f, sections: e.target.value })} />
          </Field>
        )}
        <ErrorBox error={error} />
        <div className="flex justify-between">
          <Button type="submit" loading={saving}>
            Save
          </Button>
          {onDelete && (
            <Button type="button" variant="ghost" className="text-red-600" onClick={onDelete}>
              Delete class
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------- Subjects ----------

function SubjectsTab({ data, reload }: { data: Structure; reload: () => void }) {
  const act = useAction(reload);
  const [names, setNames] = useState('');
  const [editingClass, setEditingClass] = useState<ClassLevel | null>(null);
  const common = ['English', 'Urdu', 'Mathematics', 'Science', 'Islamiat', 'Social Studies', 'Computer', 'General Knowledge', 'Physics', 'Chemistry', 'Biology', 'Pakistan Studies', 'Arts', 'Nazra Quran'];
  const missing = common.filter((c) => !data.subjects.some((s) => s.name.toLowerCase() === c.toLowerCase()));

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card title="All subjects" className="lg:col-span-2">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const list = names.split(',').map((n) => n.trim()).filter(Boolean);
            if (list.length && (await act(() => api.post('/setup/subjects', { names: list }), 'Subjects added'))) setNames('');
          }}
          className="flex gap-2"
        >
          <input className="input" placeholder="e.g. English, Urdu, Maths" value={names} onChange={(e) => setNames(e.target.value)} />
          <Button type="submit">Add</Button>
        </form>
        {missing.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-gray-500">Common subjects (click to add):</div>
            <div className="flex flex-wrap gap-1">
              {missing.map((m) => (
                <button key={m} className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:border-brand-500 hover:text-brand-700" onClick={() => act(() => api.post('/setup/subjects', { names: [m] }), `${m} added`)}>
                  + {m}
                </button>
              ))}
            </div>
          </div>
        )}
        <ul className="mt-4 divide-y divide-gray-100">
          {data.subjects.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {s.name}
                {s.code && <span className="ml-2 text-xs text-gray-400">{s.code}</span>}
              </span>
              <span className="flex gap-1">
                <button
                  className="text-xs text-gray-500 hover:text-brand-700"
                  onClick={() => {
                    const name = prompt('Subject name', s.name);
                    if (name && name !== s.name) act(() => api.patch(`/setup/subjects/${s.id}`, { name }), 'Renamed');
                  }}
                >
                  Rename
                </button>
                <button className="ml-2 text-xs text-gray-500 hover:text-red-600" onClick={() => confirm(`Delete ${s.name}? It will be removed from all classes.`) && act(() => api.del(`/setup/subjects/${s.id}`), 'Subject deleted')}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Subjects taught in each class" className="lg:col-span-3">
        {data.classes.length === 0 ? (
          <Empty title="Add classes first" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.classes.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {c.name} {c.stream && <span className="text-gray-500">{c.stream}</span>}
                  </div>
                  <div className="text-xs text-gray-500">{c.subjects.length ? c.subjects.map((s) => s.name + (s.isOptional ? '*' : '')).join(', ') : 'No subjects'}</div>
                </div>
                <Button variant="secondary" onClick={() => setEditingClass(c)} disabled={data.subjects.length === 0}>
                  Choose
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-400">* optional / elective subject</p>
      </Card>
      {editingClass && <ClassSubjectsModal cls={editingClass} data={data} onClose={() => setEditingClass(null)} onSaved={() => { setEditingClass(null); reload(); }} />}
    </div>
  );
}

function ClassSubjectsModal({ cls, data, onClose, onSaved }: { cls: ClassLevel; data: Structure; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [sel, setSel] = useState<Record<string, 'off' | 'core' | 'optional'>>(() =>
    Object.fromEntries(data.subjects.map((s) => {
      const has = cls.subjects.find((x) => x.id === s.id);
      return [s.id, has ? (has.isOptional ? 'optional' : 'core') : 'off'];
    })),
  );
  const [copyFrom, setCopyFrom] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api.put(`/setup/classes/${cls.id}/subjects`, {
        subjects: Object.entries(sel).filter(([, v]) => v !== 'off').map(([subjectId, v]) => ({ subjectId, isOptional: v === 'optional' })),
      });
      toast('Subjects saved');
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
      setSaving(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Subjects for ${cls.name}${cls.stream ? ` ${cls.stream}` : ''}`}>
      <div className="mb-3 flex gap-2">
        <select className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
          <option value="">Copy from another class…</option>
          {data.classes.filter((c) => c.id !== cls.id && c.subjects.length).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.stream ?? ''}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="secondary"
          disabled={!copyFrom}
          onClick={() => {
            const src = data.classes.find((c) => c.id === copyFrom)!;
            setSel(Object.fromEntries(data.subjects.map((s) => {
              const has = src.subjects.find((x) => x.id === s.id);
              return [s.id, has ? (has.isOptional ? 'optional' : 'core') : 'off'];
            })));
          }}
        >
          Copy
        </Button>
      </div>
      <ul className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto">
        {data.subjects.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-2 text-sm">
            <span>{s.name}</span>
            <select className="input w-auto py-1" value={sel[s.id]} onChange={(e) => setSel({ ...sel, [s.id]: e.target.value as 'off' })}>
              <option value="off">Not taught</option>
              <option value="core">Compulsory</option>
              <option value="optional">Optional</option>
            </select>
          </li>
        ))}
      </ul>
      <Button className="mt-4" onClick={save} loading={saving}>
        Save
      </Button>
    </Modal>
  );
}

// ---------- Sessions ----------

function SessionsTab({ data, reload }: { data: Structure; reload: () => void }) {
  const act = useAction(reload);
  const y = new Date().getFullYear();
  const startYear = new Date().getMonth() >= 3 ? y : y - 1;
  const [f, setF] = useState({ name: `${startYear}-${String(startYear + 1).slice(2)}`, startDate: `${startYear}-04-01`, endDate: `${startYear + 1}-03-31` });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Academic sessions">
        {data.sessions.length === 0 ? (
          <Empty title="No session yet">Create the current academic year.</Empty>
        ) : (
          <Table head={['Session', 'From', 'To', '']}>
            {data.sessions.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium">
                  {s.name} {s.isCurrent && <Badge tone="green">Current</Badge>}
                </Td>
                <Td>{date(s.startDate)}</Td>
                <Td>{date(s.endDate)}</Td>
                <Td className="text-right">
                  {!s.isCurrent && (
                    <Button variant="ghost" onClick={() => act(() => api.patch(`/setup/sessions/${s.id}`, { isCurrent: true }), `${s.name} is now current`)}>
                      Make current
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="New session">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api.post('/setup/sessions', { ...f, isCurrent: data.sessions.length === 0 }), 'Session created');
          }}
        >
          <Field label="Name">
            <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <input className="input" type="date" required value={dateInput(f.startDate)} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
            </Field>
            <Field label="Ends">
              <input className="input" type="date" required value={dateInput(f.endDate)} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
            </Field>
          </div>
          <Button type="submit">Create session</Button>
        </form>
      </Card>
    </div>
  );
}

// ---------- Campuses ----------

function CampusesTab({ data, reload }: { data: Structure; reload: () => void }) {
  const act = useAction(reload);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Campuses">
        <ul className="divide-y divide-gray-100">
          {data.campuses.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
              <span>
                <span className="font-medium">{c.name}</span> {c.isMain && <Badge tone="blue">Main</Badge>}
                {c.address && <span className="block text-xs text-gray-500">{c.address}</span>}
              </span>
              <button
                className="text-xs text-gray-500 hover:text-brand-700"
                onClick={() => {
                  const n = prompt('Campus name', c.name);
                  if (n && n !== c.name) act(() => api.patch(`/setup/campuses/${c.id}`, { name: n }), 'Renamed');
                }}
              >
                Rename
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Add campus">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => api.post('/setup/campuses', { name, address }), 'Campus added')) {
              setName('');
              setAddress('');
            }
          }}
        >
          <Field label="Name">
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Address">
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Button type="submit">Add campus</Button>
          <p className="text-xs text-gray-500">The number of campuses depends on your plan.</p>
        </form>
      </Card>
    </div>
  );
}

// ---------- Admission form settings ----------

function FormTab() {
  const toast = useToast();
  const { data, reload } = useData<{ optionalStudentFields: Record<string, string>; requiredStudentFields: string[] }>('/setup/meta');
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  if (!data) return <Loading />;
  const current = sel ?? new Set(data.requiredStudentFields);
  return (
    <Card title="Required fields on the admission form">
      <p className="text-sm text-gray-600">Student name, gender, class and at least one parent are always required. Tick anything else your school needs for every admission.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(data.optionalStudentFields).map(([k, v]) => (
          <label key={k} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={current.has(k)}
              onChange={(e) => {
                const n = new Set(current);
                if (e.target.checked) n.add(k);
                else n.delete(k);
                setSel(n);
              }}
            />
            {v}
          </label>
        ))}
      </div>
      <Button
        className="mt-4"
        loading={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await api.put('/setup/required-fields', { fields: [...current] });
            toast('Saved');
            reload();
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Failed', 'error');
          } finally {
            setSaving(false);
          }
        }}
      >
        Save
      </Button>
    </Card>
  );
}
