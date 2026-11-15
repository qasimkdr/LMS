'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal } from '@/components/ui';
import { blankQuestion, cleanQuestion, newKey, QuestionEditor, SHORT_LABEL, TYPE_LABEL, type EditQuestion, type QType } from '@/components/online/Questions';

interface BankRow extends EditQuestion {
  id: string;
  subjectId: string;
  classId: string | null;
  chapter: string | null;
  createdBy: string | null;
  usedCount: number;
  mine: boolean;
}
interface Structure {
  classes: { id: string; name: string; stream: string | null; subjects: { id: string; name: string }[] }[];
}

export default function QuestionBankPage() {
  const toast = useToast();
  const { data: structure } = useData<Structure>('/setup/structure');
  const [f, setF] = useState({ subjectId: '', classId: '', type: '', q: '', mine: false });
  const qs = new URLSearchParams(Object.entries({ subjectId: f.subjectId, classId: f.classId, type: f.type, q: f.q, mine: f.mine ? 'true' : '' }).filter(([, v]) => v) as [string, string][]);
  const { data, error, loading, reload } = useData<{ questions: BankRow[] }>(`/online-exams/bank?${qs}`);
  const [edit, setEdit] = useState<(EditQuestion & { subjectId: string; classId: string; chapter: string }) | null>(null);

  const subjects = useMemo(() => {
    const m = new Map<string, string>();
    structure?.classes.forEach((c) => c.subjects.forEach((s) => m.set(s.id, s.name)));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [structure]);
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? '';
  const className = (id: string | null) => {
    const c = structure?.classes.find((x) => x.id === id);
    return c ? `${c.name}${c.stream ? ` ${c.stream}` : ''}` : 'All classes';
  };

  async function save() {
    if (!edit) return;
    const q = cleanQuestion(edit);
    try {
      const body = { subjectId: edit.subjectId, classId: edit.classId || null, chapter: edit.chapter || null, type: q.type, text: q.text, imageFileId: q.imageFileId ?? null, options: q.options, answer: q.answer, marks: Number(q.marks) };
      if (edit.id) await api.patch(`/online-exams/bank/${edit.id}`, body);
      else await api.post('/online-exams/bank', body);
      toast('Question saved');
      setEdit(null);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/online-exams" className="text-sm text-brand-700 hover:underline">
            ← Online exams
          </Link>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Question bank</h1>
          <p className="text-sm text-gray-600">Questions saved by teachers of your school. Every question written in a paper is added here automatically.</p>
        </div>
        <select
          className="input w-auto"
          value=""
          onChange={(e) => e.target.value && setEdit({ ...blankQuestion(e.target.value as QType), subjectId: f.subjectId || subjects[0]?.id || '', classId: f.classId, chapter: '' })}
        >
          <option value="">+ New question…</option>
          {(Object.keys(TYPE_LABEL) as QType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select className="input" value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })} aria-label="Subject">
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="input" value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })} aria-label="Class">
            <option value="">All classes</option>
            {structure?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {className(c.id)}
              </option>
            ))}
          </select>
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Type">
            <option value="">All types</option>
            {(Object.keys(TYPE_LABEL) as QType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Search text or chapter" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} /> Only my questions
          </label>
        </div>
      </Card>

      {error ? (
        <ErrorBox error={error} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.questions.length ? (
        <Empty title="No questions found">Write questions in a paper or add them here.</Empty>
      ) : (
        <Card>
          <ul className="-my-2 divide-y divide-gray-100">
            {data.questions.map((q) => (
              <li key={q.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap text-sm">{q.text}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <Badge tone="blue">{SHORT_LABEL[q.type]}</Badge>
                    {q.marks} marks · {subjectName(q.subjectId)} · {className(q.classId)}
                    {q.chapter && ` · ${q.chapter}`} · by {q.createdBy} · used {q.usedCount}×
                  </div>
                </div>
                {q.mine && (
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => setEdit({ ...q, key: newKey(), classId: q.classId ?? '', chapter: q.chapter ?? '' })}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-red-600"
                      onClick={async () => {
                        if (!confirm('Delete this question from the bank? Papers that used it keep their copy.')) return;
                        await api.del(`/online-exams/bank/${q.id}`);
                        reload();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit question' : 'New question'} wide>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Field label="Subject">
              <select className="input" value={edit.subjectId} onChange={(e) => setEdit({ ...edit, subjectId: e.target.value })}>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Class">
              <select className="input" value={edit.classId} onChange={(e) => setEdit({ ...edit, classId: e.target.value })}>
                <option value="">Any class</option>
                {structure?.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {className(c.id)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Chapter / topic">
              <input className="input" value={edit.chapter} onChange={(e) => setEdit({ ...edit, chapter: e.target.value })} />
            </Field>
          </div>
          <QuestionEditor q={edit} onChange={(q) => setEdit({ ...edit, ...q, chapter: edit.chapter })} />
          <Button className="mt-4" onClick={save}>
            Save question
          </Button>
        </Modal>
      )}
    </>
  );
}
