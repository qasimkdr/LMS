'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';
import { date } from '@/lib/format';
import { className } from '@/lib/types';
import { sheetLabel, sheetTone } from '@/components/exams/shared';

interface Row {
  assessmentId: string;
  paperId: string;
  sectionId: string;
  kind: 'TEST' | 'EXAM';
  type: string;
  title: string;
  subject: string;
  classLabel: string;
  date: string | null;
  totalMarks: number;
  sheetStatus: string;
  returnNote: string | null;
  published: boolean;
}

export default function TeacherMarksPage() {
  const { data, error, loading } = useData<{ rows: Row[] }>('/exams/mine');
  const { data: overview } = useData<{ classTeacherOf?: { id: string }[] }>('/my/overview');
  const [open, setOpen] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const rows = data?.rows ?? [];
  const todo = rows.filter((r) => !r.published && ['DRAFT', 'RETURNED'].includes(r.sheetStatus));
  const done = rows.filter((r) => !todo.includes(r));
  const table = (list: Row[]) => (
    <Table head={['Test / exam', 'Class', 'Subject', 'Date', 'Status', '']}>
      {list.map((r) => (
        <tr key={`${r.paperId}${r.sectionId}`}>
          <Td>
            <div className="font-medium">{r.title}</div>
            <div className="text-xs text-gray-500">{r.type}</div>
          </Td>
          <Td>{r.classLabel}</Td>
          <Td>{r.subject}</Td>
          <Td>{r.date ? date(r.date) : '—'}</Td>
          <Td className="whitespace-normal">
            {r.published ? <Badge tone="green">Published</Badge> : <Badge tone={sheetTone[r.sheetStatus]}>{sheetLabel[r.sheetStatus]}</Badge>}
            {r.sheetStatus === 'RETURNED' && r.returnNote && <div className="mt-0.5 max-w-xs text-xs text-red-700">{r.returnNote}</div>}
          </Td>
          <Td className="text-right">
            <Link href={`/marks/${r.paperId}?section=${r.sectionId}&back=/home/marks`} className="text-sm font-medium text-brand-700 hover:underline">
              {['DRAFT', 'RETURNED'].includes(r.sheetStatus) && !r.published ? 'Enter marks →' : 'View →'}
            </Link>
            {r.kind === 'TEST' && (
              <Link href={`/exams/${r.assessmentId}?tab=results`} className="ml-3 text-sm text-gray-500 hover:underline">
                Results
              </Link>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
  return (
    <>
      <PageHeader title="Tests & marks" subtitle="Create class tests and enter marks for your subjects" actions={<Button onClick={() => setOpen(true)}>+ New test</Button>} />
      <div className="space-y-6">
        <Card title={`To do (${todo.length})`}>{todo.length ? table(todo) : <Empty title="Nothing waiting for marks" />}</Card>
        {done.length > 0 && <Card title="Submitted and published">{table(done)}</Card>}
        {(overview?.classTeacherOf?.length ?? 0) > 0 && <ClassTeacherExams />}
      </div>
      {open && <NewTest onClose={() => setOpen(false)} />}
    </>
  );
}

/** Class teachers see their class's exams to check results and write report card remarks. */
function ClassTeacherExams() {
  const { data } = useData<{ classTeacherOf: { id: string; name: string; class: { name: string; stream: string | null } }[] }>('/my/overview');
  const { data: exams } = useData<{ children?: never; rows: Row[] }>('/exams/mine');
  if (!data) return null;
  const examIds = [...new Set((exams?.rows ?? []).filter((r) => r.kind === 'EXAM').map((r) => r.assessmentId))];
  return (
    <Card title="My class: results and report card remarks">
      <p className="mb-2 text-sm text-gray-600">As class teacher of {data.classTeacherOf.map((s) => className(s.class, s)).join(', ')}, you write the remarks printed on report cards.</p>
      {examIds.length === 0 ? (
        <p className="text-sm text-gray-500">No exams yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {examIds.map((id) => {
            const r = exams!.rows.find((x) => x.assessmentId === id)!;
            return (
              <li key={id}>
                <Link href={`/exams/${id}?tab=remarks`} className="font-medium text-brand-700 hover:underline">
                  {r.title} · {r.classLabel}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

interface Overview {
  classTeacherOf: { id: string; name: string; class: { name: string; stream: string | null } }[];
  teaching: { id: string; subject: { name: string }; section: { id: string; name: string; class: { name: string; stream: string | null } } }[];
}

function NewTest({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { data: overview } = useData<Overview>('/my/overview');
  const { data: settings } = useData<{ types: { id: string; name: string; kind: string; isActive: boolean }[]; settings: { passPercent: number } }>('/exams/settings');
  const { data: structure } = useData<{ classes: { id: string; sections: { id: string }[]; subjects: { id: string; name: string }[] }[]; subjects: { id: string; name: string }[] }>('/setup/structure');
  const [typeId, setTypeId] = useState('');
  const [newType, setNewType] = useState('');
  const [choice, setChoice] = useState('');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [d, setD] = useState(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const [total, setTotal] = useState('25');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const testTypes = settings?.types.filter((t) => t.kind === 'TEST' && t.isActive) ?? [];

  // Subjects I teach; as class teacher, every subject of my class.
  const options: { key: string; sectionId: string; subjectId: string; label: string }[] = [];
  for (const t of overview?.teaching ?? []) {
    const subjectId = structure?.subjects.find((s) => s.name === t.subject.name)?.id;
    if (subjectId) options.push({ key: `${t.section.id}:${subjectId}`, sectionId: t.section.id, subjectId, label: `${className(t.section.class, t.section)} · ${t.subject.name}` });
  }
  for (const s of overview?.classTeacherOf ?? []) {
    const cls = structure?.classes.find((c) => c.sections.some((x) => x.id === s.id));
    for (const sub of cls?.subjects ?? []) {
      const key = `${s.id}:${sub.id}`;
      if (!options.some((o) => o.key === key)) options.push({ key, sectionId: s.id, subjectId: sub.id, label: `${className(s.class, s)} · ${sub.name}` });
    }
  }
  const chosen = options.find((o) => o.key === choice);
  const typeName = typeId === 'new' ? newType : testTypes.find((t) => t.id === typeId)?.name;

  return (
    <Modal open onClose={onClose} title="New class test">
      <div className="space-y-4">
        <Field label="Type of test">
          <select
            className="input"
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              setTitle('');
            }}
          >
            <option value="">Choose…</option>
            {testTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="new">+ Other (type your own name)</option>
          </select>
        </Field>
        {typeId === 'new' && (
          <Field label="Name of the test type" hint="Saved for next time, e.g. Unit test, Quiz, Dictation">
            <input className="input" value={newType} onChange={(e) => setNewType(e.target.value)} />
          </Field>
        )}
        <Field label="Class and subject">
          <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {options.length === 0 && <p className="mt-1 text-xs text-amber-700">You have no subjects assigned yet. Ask the principal.</p>}
        </Field>
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={typeName ? `${typeName} – ${new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'e.g. Weekly test 3'} />
        </Field>
        <Field label="Topic / chapters (optional)">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} />
          </Field>
          <Field label="Total marks">
            <input className="input" type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} />
          </Field>
          <Field label="Pass marks" hint={settings ? `Default ${settings.settings.passPercent}%` : undefined}>
            <input className="input" type="number" min={0} value={pass} onChange={(e) => setPass(e.target.value)} />
          </Field>
        </div>
        <ErrorBox error={error} />
        <Button
          loading={busy}
          disabled={!typeId || (typeId === 'new' && newType.trim().length < 2) || !chosen || !Number(total)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api.post<{ id: string; paperId: string }>('/exams/tests', {
                ...(typeId === 'new' ? { newTypeName: newType } : { typeId }),
                sectionId: chosen!.sectionId,
                subjectId: chosen!.subjectId,
                title: title || `${typeName} – ${new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
                topic: topic || null,
                date: d,
                totalMarks: Number(total),
                ...(pass ? { passMarks: Number(pass) } : {}),
              });
              toast('Test created. Enter the marks now or later.');
              router.push(`/marks/${r.paperId}?section=${chosen!.sectionId}&back=/home/marks`);
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          Create test and enter marks
        </Button>
      </div>
    </Modal>
  );
}
