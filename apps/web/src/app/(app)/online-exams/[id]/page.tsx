'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal } from '@/components/ui';
import { AnswerInput, blankQuestion, cleanQuestion, newKey, QuestionEditor, SHORT_LABEL, TYPE_LABEL, type EditQuestion, type QType, type StudentQ } from '@/components/online/Questions';
import { localDT, phaseLabel, phaseTone } from '@/components/online/shared';
import { fileUrl } from '@/lib/api';

interface Paper {
  id: string;
  title: string;
  subjectId: string;
  classId: string;
  sectionIds: string[];
  instructions: string | null;
  status: string;
  phase: string;
  startAt: string | null;
  endAt: string | null;
  durationMinutes: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  negativeMarking: number;
  showAnswers: boolean;
  passMarks: number | null;
  reviewNote: string | null;
  totalMarks: number;
  createdById: string;
}
interface Detail {
  paper: Paper;
  sections: { id: string; title: string; instructions: string | null; attemptAny: number | null; questions: (EditQuestion & { id: string })[] }[];
  subject: string;
  classLabel: string;
  classSections: { id: string; name: string }[];
  attempts: number;
  editable: boolean;
}
interface EditSection {
  key: string;
  title: string;
  instructions: string;
  attemptAny: string;
  questions: EditQuestion[];
}

const total = (sections: EditSection[]) =>
  sections.reduce((t, s) => {
    const m = s.questions.map((q) => Number(q.marks) || 0).sort((a, b) => b - a);
    const n = Number(s.attemptAny);
    return t + (n && n < m.length ? m.slice(0, n) : m).reduce((a, b) => a + b, 0);
  }, 0);

export default function PaperBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const isManager = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('exams.manage');
  const { data, error, loading, reload } = useData<Detail>(`/online-exams/${id}`);
  const [settings, setSettings] = useState<Partial<Paper> & { startLocal?: string; endLocal?: string }>({});
  const [sections, setSections] = useState<EditSection[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [bankFor, setBankFor] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!data) return;
    const p = data.paper;
    setSettings({ ...p, startLocal: localDT(p.startAt), endLocal: localDT(p.endAt) });
    setSections(
      data.sections.map((s) => ({
        key: s.id,
        title: s.title,
        instructions: s.instructions ?? '',
        attemptAny: s.attemptAny ? String(s.attemptAny) : '',
        questions: s.questions.map((q) => ({ ...q, key: q.id })),
      })),
    );
    setDirty(false);
  }, [data]);

  const marks = useMemo(() => total(sections), [sections]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const p = data.paper;
  const editable = data.editable;
  const upd = (fn: (s: EditSection[]) => EditSection[]) => {
    setSections(fn);
    setDirty(true);
  };

  async function save(silent = false) {
    setBusy('save');
    try {
      await api.patch(`/online-exams/${id}`, {
        title: settings.title,
        sectionIds: settings.sectionIds,
        instructions: settings.instructions ?? null,
        startAt: settings.startLocal ? new Date(settings.startLocal).toISOString() : null,
        endAt: settings.endLocal ? new Date(settings.endLocal).toISOString() : null,
        durationMinutes: Number(settings.durationMinutes),
        shuffleQuestions: settings.shuffleQuestions,
        shuffleOptions: settings.shuffleOptions,
        negativeMarking: Number(settings.negativeMarking),
        showAnswers: settings.showAnswers,
        passMarks: settings.passMarks === null || settings.passMarks === undefined || String(settings.passMarks) === '' ? null : Number(settings.passMarks),
      });
      await api.put(`/online-exams/${id}/structure`, {
        sections: sections.map((s) => ({
          title: s.title,
          instructions: s.instructions || null,
          attemptAny: s.attemptAny ? Number(s.attemptAny) : null,
          questions: s.questions.map(cleanQuestion).map((q) => ({ bankId: q.bankId ?? null, type: q.type, text: q.text, imageFileId: q.imageFileId ?? null, options: q.options, answer: q.answer, marks: Number(q.marks), chapter: q.chapter ?? null })),
        })),
      });
      if (!silent) toast('Saved');
      setDirty(false);
      await reload();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function action(key: string, fn: () => Promise<unknown>, msg: string) {
    setBusy(key);
    try {
      await fn();
      toast(msg);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  const questionCount = sections.reduce((a, s) => a + s.questions.length, 0);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/online-exams" className="text-sm text-brand-700 hover:underline">
            ← Online exams
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold sm:text-2xl">
            {p.title} <Badge tone={phaseTone[p.phase]}>{phaseLabel[p.phase] ?? p.phase}</Badge>
          </h1>
          <div className="text-sm text-gray-600">
            {data.classLabel} · {data.subject} · {questionCount} questions · {marks} marks
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setPreview(true)}>
            Preview
          </Button>
          {editable && (
            <Button variant="secondary" onClick={() => save()} loading={busy === 'save'} disabled={!dirty}>
              Save
            </Button>
          )}
          {['DRAFT', 'AWAITING_APPROVAL'].includes(p.status) && (p.status === 'DRAFT' || isManager) && (
            <Button
              loading={busy === 'schedule'}
              onClick={async () => {
                if (dirty && !(await save(true))) return;
                action('schedule', () => api.post(`/online-exams/${id}/schedule`), 'Done');
              }}
            >
              {p.status === 'AWAITING_APPROVAL' ? 'Schedule now' : 'Schedule for students'}
            </Button>
          )}
          {p.status === 'SCHEDULED' && data.attempts === 0 && p.phase === 'UPCOMING' && (
            <Button variant="ghost" onClick={() => action('unschedule', () => api.post(`/online-exams/${id}/unschedule`), 'Back to draft')}>
              Unschedule
            </Button>
          )}
          {data.attempts > 0 && (
            <Link href={`/online-exams/${id}/marking`}>
              <Button>Student papers ({data.attempts})</Button>
            </Link>
          )}
          <Button
            variant="ghost"
            onClick={async () => {
              const r = await api.post<{ id: string }>(`/online-exams/${id}/duplicate`);
              toast('Copy made');
              router.push(`/online-exams/${r.id}`);
            }}
          >
            Duplicate
          </Button>
          {(p.status === 'DRAFT' || me?.user.role === 'PRINCIPAL') && (
            <Button
              variant="ghost"
              className="text-red-600"
              onClick={async () => {
                if (!confirm('Delete this online exam?')) return;
                await api.del(`/online-exams/${id}`);
                router.replace('/online-exams');
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {p.reviewNote && p.status === 'DRAFT' && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Principal asked for changes: {p.reviewNote}</div>}
      {p.status === 'AWAITING_APPROVAL' && isManager && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This paper is waiting for your approval.
          <Button onClick={() => action('approve', () => api.post(`/online-exams/${id}/approve-paper`, { approve: true }), 'Approved and scheduled')}>Approve</Button>
          <Button
            variant="secondary"
            onClick={() => {
              const note = prompt('What should the teacher change?');
              if (note) action('approve', () => api.post(`/online-exams/${id}/approve-paper`, { approve: false, note }), 'Sent back');
            }}
          >
            Ask for changes
          </Button>
        </div>
      )}
      {!editable && <div className="mb-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">This paper is locked: it is live or students have already taken it.</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {sections.map((s, si) => (
            <Card
              key={s.key}
              title={<input className="input w-64 py-1 font-semibold" disabled={!editable} value={s.title} onChange={(e) => upd((x) => x.map((y) => (y.key === s.key ? { ...y, title: e.target.value } : y)))} aria-label="Section title" />}
              actions={
                editable &&
                sections.length > 1 && (
                  <Button variant="ghost" onClick={() => confirm('Remove this section and its questions?') && upd((x) => x.filter((y) => y.key !== s.key))}>
                    Remove section
                  </Button>
                )
              }
            >
              <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_10rem]">
                <input className="input" disabled={!editable} placeholder="Instructions for this section (optional)" value={s.instructions} onChange={(e) => upd((x) => x.map((y) => (y.key === s.key ? { ...y, instructions: e.target.value } : y)))} />
                <label className="flex items-center gap-2 text-sm">
                  Attempt any
                  <input className="input w-16 py-1" type="number" min={1} disabled={!editable} value={s.attemptAny} onChange={(e) => upd((x) => x.map((y) => (y.key === s.key ? { ...y, attemptAny: e.target.value } : y)))} placeholder="all" />
                </label>
              </div>
              {s.questions.length === 0 && <p className="mb-3 text-sm text-gray-500">No questions yet.</p>}
              <ol className="space-y-2">
                {s.questions.map((q, qi) => (
                  <li key={q.key} className="rounded-lg border border-gray-200">
                    <div className="flex items-start gap-3 px-3 py-2">
                      <span className="mt-0.5 text-sm font-semibold text-gray-400">{qi + 1}.</span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === q.key ? null : q.key)}>
                        <span className="block truncate text-sm">{q.text || <span className="text-gray-400">New question</span>}</span>
                        <span className="text-xs text-gray-500">
                          {SHORT_LABEL[q.type]} · {q.marks} mark{q.marks === 1 ? '' : 's'}
                          {q.bankId && ' · from bank'}
                        </span>
                      </button>
                      {editable && (
                        <span className="flex shrink-0 gap-1 text-gray-400">
                          <button title="Move up" disabled={qi === 0} onClick={() => upd((x) => x.map((y) => (y.key === s.key ? { ...y, questions: swap(y.questions, qi, qi - 1) } : y)))}>
                            ↑
                          </button>
                          <button title="Move down" disabled={qi === s.questions.length - 1} onClick={() => upd((x) => x.map((y) => (y.key === s.key ? { ...y, questions: swap(y.questions, qi, qi + 1) } : y)))}>
                            ↓
                          </button>
                          <button title="Remove" className="hover:text-red-600" onClick={() => upd((x) => x.map((y) => (y.key === s.key ? { ...y, questions: y.questions.filter((z) => z.key !== q.key) } : y)))}>
                            ✕
                          </button>
                        </span>
                      )}
                    </div>
                    {open === q.key && editable && (
                      <div className="border-t border-gray-100 p-3">
                        <QuestionEditor q={q} onChange={(nq) => upd((x) => x.map((y) => (y.key === s.key ? { ...y, questions: y.questions.map((z) => (z.key === q.key ? { ...nq, bankId: null } : z)) } : y)))} />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {editable && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    className="input w-auto"
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const q = blankQuestion(e.target.value as QType);
                      upd((x) => x.map((y) => (y.key === s.key ? { ...y, questions: [...y.questions, q] } : y)));
                      setOpen(q.key);
                    }}
                  >
                    <option value="">+ Add question…</option>
                    {(Object.keys(TYPE_LABEL) as QType[]).map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" onClick={() => setBankFor(s.key)}>
                    Add from question bank
                  </Button>
                </div>
              )}
              {si === sections.length - 1 && editable && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <Button variant="ghost" onClick={() => upd((x) => [...x, { key: newKey(), title: `Section ${String.fromCharCode(65 + x.length)}`, instructions: '', attemptAny: '', questions: [] }])}>
                    + New section
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <Card title="Settings">
            <div className="space-y-3">
              <Field label="Title">
                <input className="input" disabled={!editable} value={settings.title ?? ''} onChange={(e) => { setSettings({ ...settings, title: e.target.value }); setDirty(true); }} />
              </Field>
              <div>
                <div className="label">Sections</div>
                <div className="flex flex-wrap gap-3">
                  {data.classSections.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={(settings.sectionIds ?? []).includes(s.id)}
                        onChange={(e) => {
                          setSettings({ ...settings, sectionIds: e.target.checked ? [...(settings.sectionIds ?? []), s.id] : (settings.sectionIds ?? []).filter((x) => x !== s.id) });
                          setDirty(true);
                        }}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
              <Field label="Opens at">
                <input className="input" type="datetime-local" disabled={!editable} value={settings.startLocal ?? ''} onChange={(e) => { setSettings({ ...settings, startLocal: e.target.value }); setDirty(true); }} />
              </Field>
              <Field label="Closes at">
                <input className="input" type="datetime-local" disabled={!editable} value={settings.endLocal ?? ''} onChange={(e) => { setSettings({ ...settings, endLocal: e.target.value }); setDirty(true); }} />
              </Field>
              <Field label="Time allowed (minutes)" hint="Counted from when each student starts">
                <input className="input" type="number" min={1} disabled={!editable} value={settings.durationMinutes ?? 30} onChange={(e) => { setSettings({ ...settings, durationMinutes: Number(e.target.value) }); setDirty(true); }} />
              </Field>
              <Field label="Negative marking for wrong MCQ / true-false">
                <select className="input" disabled={!editable} value={String(settings.negativeMarking ?? 0)} onChange={(e) => { setSettings({ ...settings, negativeMarking: Number(e.target.value) }); setDirty(true); }}>
                  <option value="0">None</option>
                  <option value="0.25">¼ of the question’s marks</option>
                  <option value="0.5">½ of the question’s marks</option>
                  <option value="1">Full marks of the question</option>
                </select>
              </Field>
              <Field label="Pass marks" hint={`Empty = school pass % of ${marks}`}>
                <input className="input" type="number" min={0} disabled={!editable} value={settings.passMarks ?? ''} onChange={(e) => { setSettings({ ...settings, passMarks: e.target.value === '' ? null : Number(e.target.value) }); setDirty(true); }} />
              </Field>
              {(
                [
                  ['shuffleQuestions', 'Mix up question order for each student'],
                  ['shuffleOptions', 'Mix up MCQ options for each student'],
                  ['showAnswers', 'Show correct answers with the result'],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={!editable} checked={Boolean(settings[k])} onChange={(e) => { setSettings({ ...settings, [k]: e.target.checked }); setDirty(true); }} /> {l}
                </label>
              ))}
              <Field label="Instructions for students">
                <textarea className="input min-h-20" disabled={!editable} value={settings.instructions ?? ''} onChange={(e) => { setSettings({ ...settings, instructions: e.target.value }); setDirty(true); }} />
              </Field>
            </div>
          </Card>
          {dirty && editable && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              You have unsaved changes.{' '}
              <button className="font-semibold underline" onClick={() => save()}>
                Save now
              </button>
            </div>
          )}
        </div>
      </div>

      {bankFor && (
        <BankPicker
          subjectId={p.subjectId}
          classId={p.classId}
          onClose={() => setBankFor(null)}
          onPick={(qs) => {
            upd((x) => x.map((y) => (y.key === bankFor ? { ...y, questions: [...y.questions, ...qs] } : y)));
            setBankFor(null);
          }}
        />
      )}
      {preview && <PreviewModal title={settings.title ?? ''} instructions={settings.instructions ?? null} sections={sections} onClose={() => setPreview(false)} />}
    </>
  );
}

function swap<T>(arr: T[], i: number, j: number) {
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

function BankPicker({ subjectId, classId, onClose, onPick }: { subjectId: string; classId: string; onClose: () => void; onPick: (q: EditQuestion[]) => void }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const qs = new URLSearchParams({ subjectId, classId, ...(q && { q }), ...(type && { type }) });
  const { data, loading } = useData<{ questions: (EditQuestion & { id: string; createdBy: string | null; usedCount: number; chapter: string | null })[] }>(`/online-exams/bank?${qs}`);
  const [sel, setSel] = useState<Set<string>>(new Set());
  return (
    <Modal open onClose={onClose} title="Question bank" wide>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input flex-1" placeholder="Search question or chapter" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {(Object.keys(TYPE_LABEL) as QType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      {loading && !data ? (
        <Loading />
      ) : !data?.questions.length ? (
        <Empty title="No questions in the bank for this subject yet">Questions you write in papers are saved here automatically.</Empty>
      ) : (
        <ul className="max-h-[55vh] divide-y divide-gray-100 overflow-y-auto">
          {data.questions.map((x) => (
            <li key={x.id}>
              <label className="flex cursor-pointer items-start gap-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={sel.has(x.id)}
                  onChange={(e) => {
                    const n = new Set(sel);
                    if (e.target.checked) n.add(x.id);
                    else n.delete(x.id);
                    setSel(n);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{x.text}</span>
                  <span className="text-xs text-gray-500">
                    {SHORT_LABEL[x.type]} · {x.marks} marks {x.chapter && `· ${x.chapter}`} · by {x.createdBy} · used {x.usedCount}×
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button
        className="mt-4"
        disabled={!sel.size}
        onClick={() => onPick(data!.questions.filter((x) => sel.has(x.id)).map((x) => ({ key: newKey(), bankId: x.id, type: x.type, text: x.text, imageFileId: x.imageFileId, options: x.options, answer: x.answer, marks: Number(x.marks), chapter: x.chapter })))}
      >
        Add {sel.size || ''} question{sel.size === 1 ? '' : 's'}
      </Button>
    </Modal>
  );
}

/** Shows the paper the way students will see it. */
function PreviewModal({ title, instructions, sections, onClose }: { title: string; instructions: string | null; sections: EditSection[]; onClose: () => void }) {
  let n = 0;
  return (
    <Modal open onClose={onClose} title={`Preview · ${title}`} wide>
      {instructions && <p className="mb-4 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm">{instructions}</p>}
      <div className="space-y-6">
        {sections.map((s) => (
          <div key={s.key}>
            <h3 className="font-semibold">{s.title}</h3>
            {(s.instructions || s.attemptAny) && (
              <p className="text-sm text-gray-600">
                {s.instructions} {s.attemptAny && `(Attempt any ${s.attemptAny} of ${s.questions.length})`}
              </p>
            )}
            <ol className="mt-3 space-y-5">
              {s.questions.map((q) => {
                n++;
                const sq: StudentQ = {
                  id: q.key,
                  sectionId: s.key,
                  type: q.type,
                  text: q.text,
                  imageFileId: q.imageFileId ?? null,
                  marks: q.marks,
                  options: q.options as StudentQ['options'],
                  left: q.type === 'MATCH' ? (q.options as { left: string[] }).left : undefined,
                  right: q.type === 'MATCH' ? (q.options as { right: string[] }).right.map((t, i) => ({ index: i, text: t })) : undefined,
                  blanks: q.type === 'FILL' ? (q.text.match(/_{3,}/g) ?? []).length : undefined,
                };
                return (
                  <li key={q.key}>
                    <div className="mb-2 flex justify-between gap-3 text-sm font-medium">
                      <span>
                        {n}. {q.text}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500">[{q.marks}]</span>
                    </div>
                    {q.imageFileId && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(q.imageFileId)} alt="" className="mb-2 max-h-48 rounded border border-gray-200" />
                    )}
                    <AnswerInput q={sq} value={undefined} onChange={() => undefined} disabled />
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </Modal>
  );
}
