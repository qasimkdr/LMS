'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Tabs } from '@/components/Tabs';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';
import { date } from '@/lib/format';
import { className, type Structure } from '@/lib/types';

type Tab = 'exams' | 'tests' | 'approvals' | 'settings';

interface Row {
  id: string;
  kind: 'TEST' | 'EXAM';
  type: string;
  title: string;
  groupKey: string | null;
  status: string;
  announced: boolean;
  classLabel: string;
  classSort: number;
  subject?: string;
  date: string | null;
  papers: number;
  sheets: { total: number; submitted: number; approved: number; returned: number };
  publishedAt: string | null;
  createdAt: string;
}
interface Settings {
  settings: { gradeBands: { grade: string; min: number; remark?: string }[]; passPercent: number; testsNeedApproval: boolean; showPositions: boolean };
  types: { id: string; name: string; kind: 'TEST' | 'EXAM'; isActive: boolean }[];
}

function Progress({ s, published }: { s: Row['sheets']; published: boolean }) {
  if (published) return <Badge tone="green">Published</Badge>;
  const done = s.submitted + s.approved;
  return (
    <span className="flex items-center gap-2 text-xs text-gray-600">
      <span className="h-1.5 w-20 rounded-full bg-gray-100">
        <span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${s.total ? (done / s.total) * 100 : 0}%` }} />
      </span>
      {done}/{s.total} marks in{s.submitted > 0 && <Badge tone="amber">{s.submitted} to approve</Badge>}
      {s.returned > 0 && <Badge tone="red">{s.returned} sent back</Badge>}
    </span>
  );
}

function ExamsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { me } = useAuth();
  const canManage = me?.user.role === 'PRINCIPAL' || Boolean(me?.user.permissions.includes('exams.manage'));
  const tab = (params.get('tab') as Tab) || 'exams';
  return (
    <>
      <PageHeader title="Exams & results" subtitle="Term exams, class tests, marks approval, results and report cards" />
      <Tabs
        value={tab}
        onChange={(t) => router.replace(`/school/exams?tab=${t}`)}
        tabs={[
          { key: 'exams', label: 'Term exams' },
          { key: 'tests', label: 'Class tests' },
          ...(canManage ? [{ key: 'approvals' as Tab, label: 'Waiting for approval' }, { key: 'settings' as Tab, label: 'Grades & types' }] : []),
        ]}
      />
      {tab === 'exams' && <ExamList canManage={canManage} />}
      {tab === 'tests' && <TestList />}
      {tab === 'approvals' && <Approvals />}
      {tab === 'settings' && <ExamSettings />}
    </>
  );
}

export default function ExamsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ExamsInner />
    </Suspense>
  );
}

function ExamList({ canManage }: { canManage: boolean }) {
  const { data, error, loading, reload } = useData<{ assessments: Row[] }>('/exams?kind=EXAM');
  const [open, setOpen] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  // One card per school-wide exam (same group), one row per class.
  const groups = new Map<string, Row[]>();
  for (const r of data?.assessments ?? []) groups.set(r.groupKey ?? r.id, [...(groups.get(r.groupKey ?? r.id) ?? []), r]);
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>+ New exam</Button>
        </div>
      )}
      {groups.size === 0 ? (
        <Empty title="No exams yet">{canManage && 'Create the mid-term or final exam for one or more classes.'}</Empty>
      ) : (
        [...groups.values()].map((rows) => (
          <Card
            key={rows[0].groupKey ?? rows[0].id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {rows[0].title} <Badge tone="blue">{rows[0].type}</Badge>
              </span>
            }
          >
            <Table head={['Class', 'Starts', 'Papers', 'Marks', 'Date sheet', '']}>
              {rows
                .sort((a, b) => a.classSort - b.classSort)
                .map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.classLabel}</Td>
                    <Td>{r.date ? date(r.date) : '—'}</Td>
                    <Td>{r.papers}</Td>
                    <Td>
                      <Progress s={r.sheets} published={r.status === 'PUBLISHED'} />
                    </Td>
                    <Td>{r.announced ? <Badge tone="green">Shared</Badge> : <span className="text-xs text-gray-400">Not shared</span>}</Td>
                    <Td className="text-right">
                      <Link href={`/exams/${r.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                        Open →
                      </Link>
                    </Td>
                  </tr>
                ))}
            </Table>
          </Card>
        ))
      )}
      {open && <NewExam onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </div>
  );
}

function NewExam({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: structure } = useData<Structure>('/setup/structure');
  const { data: settings, reload } = useData<Settings>('/exams/settings');
  const [typeId, setTypeId] = useState('');
  const [newType, setNewType] = useState('');
  const [title, setTitle] = useState('');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [totalMarks, setTotalMarks] = useState('100');
  const [startDate, setStartDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const examTypes = settings?.types.filter((t) => t.kind === 'EXAM' && t.isActive) ?? [];
  const year = new Date().getFullYear();
  return (
    <Modal open onClose={onClose} title="New exam" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <select
            className="input"
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              const t = examTypes.find((x) => x.id === e.target.value);
              if (t && !title) setTitle(`${t.name} ${year}`);
            }}
          >
            <option value="">Choose…</option>
            {examTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="new">+ Other (type a name)</option>
          </select>
        </Field>
        {typeId === 'new' ? (
          <Field label="New exam type">
            <input className="input" value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="e.g. Pre-board" />
          </Field>
        ) : (
          <span />
        )}
        <div className="sm:col-span-2">
          <Field label="Title (shown on report cards)">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Mid-term ${year}`} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <div className="label">Classes</div>
          <div className="mb-1 flex gap-3 text-xs">
            <button className="text-brand-700 hover:underline" onClick={() => setClassIds(structure?.classes.filter((c) => c.subjects.length).map((c) => c.id) ?? [])}>
              Select all
            </button>
            <button className="text-gray-500 hover:underline" onClick={() => setClassIds([])}>
              Clear
            </button>
          </div>
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-gray-200 p-2 sm:grid-cols-3">
            {structure?.classes.map((c) => (
              <label key={c.id} className={`flex items-center gap-2 text-sm ${c.subjects.length ? '' : 'opacity-50'}`} title={c.subjects.length ? '' : 'No subjects linked'}>
                <input type="checkbox" disabled={!c.subjects.length} checked={classIds.includes(c.id)} onChange={(e) => setClassIds(e.target.checked ? [...classIds, c.id] : classIds.filter((x) => x !== c.id))} />
                {className(c)} <span className="text-xs text-gray-400">({c.subjects.length} subj.)</span>
              </label>
            ))}
          </div>
        </div>
        <Field label="Marks per paper" hint="You can change each paper after">
          <input className="input" type="number" min={1} value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)} />
        </Field>
        <Field label="First paper date (optional)" hint="Papers are placed on following days; edit the date sheet after">
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <div className="space-y-3 sm:col-span-2">
          <ErrorBox error={error} />
          <Button
            loading={busy}
            disabled={!typeId || (typeId === 'new' && newType.trim().length < 2) || !title || !classIds.length}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                let tid = typeId;
                if (tid === 'new') {
                  tid = (await api.post<{ type: { id: string } }>('/exams/types', { name: newType, kind: 'EXAM' })).type.id;
                  reload();
                }
                const r = await api.post<{ ids: string[] }>('/exams', { typeId: tid, title, classIds, totalMarks: Number(totalMarks), startDate: startDate || undefined });
                toast(`Exam created for ${r.ids.length} class(es)`);
                onDone();
              } catch (e) {
                setError(e);
                setBusy(false);
              }
            }}
          >
            Create exam
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TestList() {
  const { data: structure } = useData<Structure>('/setup/structure');
  const [classId, setClassId] = useState('');
  const { data, error, loading } = useData<{ assessments: Row[] }>(`/exams?kind=TEST${classId ? `&classId=${classId}` : ''}`);
  return (
    <Card
      actions={
        <select className="input w-auto py-1" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All classes</option>
          {structure?.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {className(c)}
            </option>
          ))}
        </select>
      }
      title="Class tests by teachers"
    >
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : !data?.assessments.length ? (
        <Empty title="No class tests yet">Teachers create tests from their “Tests & marks” page.</Empty>
      ) : (
        <Table head={['Test', 'Class', 'Subject', 'Date', 'Status', '']}>
          {data.assessments.map((r) => (
            <tr key={r.id}>
              <Td>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-gray-500">{r.type}</div>
              </Td>
              <Td>{r.classLabel}</Td>
              <Td>{r.subject}</Td>
              <Td>{r.date ? date(r.date) : '—'}</Td>
              <Td>
                {r.status === 'PUBLISHED' ? <Badge tone="green">Published</Badge> : r.sheets.submitted ? <Badge tone="amber">Waiting for approval</Badge> : r.sheets.returned ? <Badge tone="red">Sent back</Badge> : <Badge>Marks being entered</Badge>}
              </Td>
              <Td className="text-right">
                <Link href={`/exams/${r.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                  Open →
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Approvals() {
  const { data, error, loading } = useData<{ assessments: Row[] }>('/exams?status=DRAFT');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const rows = (data?.assessments ?? []).filter((r) => r.sheets.submitted > 0);
  return (
    <Card title="Marks waiting for your approval">
      {rows.length === 0 ? (
        <Empty title="Nothing to approve" />
      ) : (
        <Table head={['Test / exam', 'Class', 'Waiting', '']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-gray-500">
                  {r.type}
                  {r.subject && ` · ${r.subject}`}
                </div>
              </Td>
              <Td>{r.classLabel}</Td>
              <Td>
                <Badge tone="amber">{r.sheets.submitted} marks sheet(s)</Badge>
              </Td>
              <Td className="text-right">
                <Link href={`/exams/${r.id}`}>
                  <Button>Review</Button>
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function ExamSettings() {
  const toast = useToast();
  const { data, error, loading, reload } = useData<Settings>('/exams/settings');
  const [bands, setBands] = useState<{ grade: string; min: string; remark: string }[]>([]);
  const [pass, setPass] = useState('33');
  const [approval, setApproval] = useState(true);
  const [positions, setPositions] = useState(true);
  const [newType, setNewType] = useState({ name: '', kind: 'TEST' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setBands(data.settings.gradeBands.map((b) => ({ grade: b.grade, min: String(b.min), remark: b.remark ?? '' })));
    setPass(String(data.settings.passPercent));
    setApproval(data.settings.testsNeedApproval);
    setPositions(data.settings.showPositions);
  }, [data]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Grades and passing">
        <div className="space-y-2">
          {bands.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input w-20 py-1" value={b.grade} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)))} aria-label="Grade" />
              <span className="text-sm text-gray-500">from</span>
              <input className="input w-20 py-1" type="number" min={0} max={100} value={b.min} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} aria-label="Minimum %" />
              <span className="text-sm text-gray-500">%</span>
              <input className="input flex-1 py-1" value={b.remark} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, remark: e.target.value } : x)))} placeholder="Remark" aria-label="Remark" />
              <button className="text-gray-400 hover:text-red-600" onClick={() => setBands(bands.filter((_, j) => j !== i))} aria-label="Remove grade">
                ✕
              </button>
            </div>
          ))}
          <Button variant="ghost" onClick={() => setBands([...bands, { grade: '', min: '0', remark: '' }])}>
            + Grade
          </Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Pass percentage" hint="Also the default pass mark of each paper">
            <input className="input" type="number" min={0} max={100} value={pass} onChange={(e) => setPass(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Class tests need the principal’s approval before parents see them
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={positions} onChange={(e) => setPositions(e.target.checked)} /> Show positions on results and report cards
          </label>
        </div>
        <Button
          className="mt-4"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.put('/exams/settings', { gradeBands: bands.map((b) => ({ grade: b.grade, min: Number(b.min), remark: b.remark })), passPercent: Number(pass), testsNeedApproval: approval, showPositions: positions });
              toast('Saved. Published results were updated with the new grades.');
              reload();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </Card>
      <Card title="Test and exam types">
        <p className="mb-3 text-sm text-gray-600">Teachers can also add their own test names when they create a test.</p>
        {(['TEST', 'EXAM'] as const).map((k) => (
          <div key={k} className="mb-4">
            <div className="mb-1 text-xs font-semibold uppercase text-gray-500">{k === 'TEST' ? 'Class tests' : 'Term exams'}</div>
            <div className="flex flex-wrap gap-1.5">
              {data.types.filter((t) => t.kind === k).map((t) => (
                <button
                  key={t.id}
                  title={t.isActive ? 'Click to hide' : 'Click to use again'}
                  onClick={async () => {
                    await api.patch(`/exams/types/${t.id}`, { isActive: !t.isActive });
                    reload();
                  }}
                  className={`rounded-full border px-3 py-1 text-sm ${t.isActive ? 'border-gray-200 bg-white' : 'border-dashed border-gray-300 text-gray-400 line-through'}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <input className="input flex-1" placeholder="New type, e.g. Unit test" value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} />
          <select className="input w-auto" value={newType.kind} onChange={(e) => setNewType({ ...newType, kind: e.target.value })}>
            <option value="TEST">Class test</option>
            <option value="EXAM">Term exam</option>
          </select>
          <Button
            disabled={newType.name.trim().length < 2}
            onClick={async () => {
              await api.post('/exams/types', newType);
              setNewType({ name: '', kind: newType.kind });
              reload();
            }}
          >
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
