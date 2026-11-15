'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';
import { phaseLabel, phaseTone } from '@/components/online/shared';
import { dateTime } from '@/lib/format';
import { className } from '@/lib/types';

interface Row {
  id: string;
  title: string;
  subject: string;
  classLabel: string;
  createdBy: string;
  phase: string;
  startAt: string | null;
  endAt: string | null;
  durationMinutes: number;
  questions: number;
  totalMarks: number;
  attempts: number;
  submitted: number;
}

export default function OnlineExamsPage() {
  const { me } = useAuth();
  const isManager = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('exams.manage');
  const { data, error, loading } = useData<{ papers: Row[] }>('/online-exams');
  const [open, setOpen] = useState(false);
  const waiting = data?.papers.filter((p) => p.phase === 'AWAITING_APPROVAL' || p.phase === 'RESULTS_SUBMITTED') ?? [];
  return (
    <>
      <PageHeader
        title="Online exams"
        subtitle={isManager ? 'All online exams in the school' : 'Papers you made for your classes'}
        actions={
          <>
            <Link href="/online-exams/bank">
              <Button variant="secondary">Question bank</Button>
            </Link>
            {me?.user.role !== 'STAFF' && <Button onClick={() => setOpen(true)}>+ New online exam</Button>}
          </>
        }
      />
      <ErrorBox error={error} />
      {isManager && waiting.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{waiting.length} online exam(s) need your approval (paper or results).</div>
      )}
      {loading && !data ? (
        <Loading />
      ) : !data?.papers.length ? (
        <Empty title="No online exams yet">Make a paper with MCQs, true/false, fill in the blanks, matching, short and long questions.</Empty>
      ) : (
        <Card>
          <Table head={['Paper', 'Class', 'When', 'Questions', 'Students', 'Status', '']}>
            {data.papers.map((p) => (
              <tr key={p.id}>
                <Td>
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs text-gray-500">
                    {p.subject}
                    {isManager && ` · ${p.createdBy}`}
                  </div>
                </Td>
                <Td>{p.classLabel}</Td>
                <Td className="text-xs text-gray-600">
                  {p.startAt ? dateTime(p.startAt) : 'Not set'}
                  <div>{p.durationMinutes} min</div>
                </Td>
                <Td>
                  {p.questions} · {p.totalMarks} marks
                </Td>
                <Td>{p.attempts ? `${p.submitted}/${p.attempts} submitted` : '—'}</Td>
                <Td>
                  <Badge tone={phaseTone[p.phase]}>{phaseLabel[p.phase] ?? p.phase}</Badge>
                </Td>
                <Td className="text-right">
                  <Link href={p.attempts ? `/online-exams/${p.id}/marking` : `/online-exams/${p.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                    {p.attempts ? 'Papers →' : 'Open →'}
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {open && <NewPaper onClose={() => setOpen(false)} />}
    </>
  );
}

function NewPaper({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { me } = useAuth();
  const isManager = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('exams.manage');
  const { data: overview } = useData<{ classTeacherOf?: { id: string; name: string; class: { name: string; stream: string | null } }[]; teaching?: { subject: { name: string }; section: { id: string; name: string; class: { name: string; stream: string | null } } }[] }>(isManager ? null : '/my/overview');
  const { data: structure } = useData<{ classes: { id: string; name: string; stream: string | null; sections: { id: string; name: string }[]; subjects: { id: string; name: string }[] }[] }>('/setup/structure');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [sections, setSections] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Classes/subjects this teacher can use (managers: all).
  const allowed = (cid: string, sid: string, secId: string) => {
    if (isManager) return true;
    const cls = structure?.classes.find((c) => c.id === cid);
    const subName = cls?.subjects.find((s) => s.id === sid)?.name;
    return Boolean(overview?.teaching?.some((t) => t.section.id === secId && t.subject.name === subName) || overview?.classTeacherOf?.some((s) => s.id === secId));
  };
  const classes = structure?.classes.filter((c) => isManager || c.sections.some((s) => c.subjects.some((sub) => allowed(c.id, sub.id, s.id)))) ?? [];
  const cls = structure?.classes.find((c) => c.id === classId);
  const subjects = cls?.subjects.filter((sub) => cls.sections.some((s) => allowed(cls.id, sub.id, s.id))) ?? [];
  const secs = cls?.sections.filter((s) => !subjectId || allowed(cls.id, subjectId, s.id)) ?? [];

  return (
    <Modal open onClose={onClose} title="New online exam">
      <div className="space-y-4">
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chapter 3 quiz" />
        </Field>
        <Field label="Class">
          <select className="input" value={classId} onChange={(e) => { setClassId(e.target.value); setSubjectId(''); setSections([]); }}>
            <option value="">Choose…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {className(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject">
          <select className="input" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setSections([]); }} disabled={!cls}>
            <option value="">Choose…</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {subjectId && (
          <div>
            <div className="label">Sections</div>
            <div className="flex flex-wrap gap-3">
              {secs.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sections.includes(s.id)} onChange={(e) => setSections(e.target.checked ? [...sections, s.id] : sections.filter((x) => x !== s.id))} /> Section {s.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <ErrorBox error={error} />
        <Button
          loading={busy}
          disabled={title.trim().length < 2 || !subjectId || !sections.length}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api.post<{ id: string }>('/online-exams', { title, classId, subjectId, sectionIds: sections });
              router.push(`/online-exams/${r.id}`);
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          Create and add questions
        </Button>
      </div>
    </Modal>
  );
}
