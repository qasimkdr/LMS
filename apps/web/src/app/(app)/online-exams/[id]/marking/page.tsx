'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, Stat, Table, Td } from '@/components/ui';
import { correctAnswerText, describeAnswer, SHORT_LABEL, type QType } from '@/components/online/Questions';
import { phaseLabel, phaseTone } from '@/components/online/shared';

interface Row {
  student: { id: string; fullName: string; rollNo: string | null; section: { name: string } | null };
  attemptId: string | null;
  status: 'ABSENT' | 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED';
  autoSubmitted: boolean;
  tabSwitches: number;
  score: number | null;
  toCheck: number;
  submittedAt: string | null;
}
interface Overview {
  paper: { id: string; title: string; status: string; phase: string; totalMarks: number; reviewNote: string | null; createdById: string; assessmentId: string | null; endAt: string | null };
  questions: { id: string; type: QType; text: string; marks: number; subjective: boolean }[];
  rows: Row[];
}
interface MarkEntry {
  auto: number | null;
  manual: number | null;
  remark: string | null;
}

const statusTone = { ABSENT: 'red', NOT_STARTED: 'gray', IN_PROGRESS: 'blue', SUBMITTED: 'green' } as const;
const statusText = { ABSENT: 'Absent', NOT_STARTED: 'Not started', IN_PROGRESS: 'Writing now', SUBMITTED: 'Submitted' };

export default function MarkingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { me } = useAuth();
  const isManager = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('exams.manage');
  const { data, error, loading, reload } = useData<Overview>(`/online-exams/${id}/attempts`);
  const [attempt, setAttempt] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [review, setReview] = useState(false);

  // Live exams: refresh the list so the teacher sees who is writing / has submitted.
  useEffect(() => {
    if (data?.paper.phase !== 'LIVE') return;
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [data?.paper.phase, reload]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const p = data.paper;
  const submitted = data.rows.filter((r) => r.status === 'SUBMITTED');
  const toCheck = data.rows.reduce((a, r) => a + r.toCheck, 0);
  const scores = submitted.map((r) => r.score).filter((s): s is number => s !== null);
  const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  const subjective = data.questions.filter((q) => q.subjective);
  const canSubmit = ['ENDED', 'RESULTS_RETURNED'].includes(p.phase) || (p.status === 'RESULTS_RETURNED');

  async function submitResults() {
    try {
      await api.post(`/online-exams/${id}/submit-results`);
      toast('Results sent to the principal');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/online-exams/${id}`} className="text-sm text-brand-700 hover:underline">
            ← Paper
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold sm:text-2xl">
            {p.title} <Badge tone={phaseTone[p.phase]}>{phaseLabel[p.phase] ?? p.phase}</Badge>
          </h1>
          <div className="text-sm text-gray-600">Student papers · out of {p.totalMarks}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSubmit && (
            <Button onClick={submitResults} disabled={toCheck > 0}>
              {toCheck > 0 ? `${toCheck} answers to check` : 'Send results to principal'}
            </Button>
          )}
          {p.status === 'RESULTS_SUBMITTED' && isManager && <Button onClick={() => setReview(true)}>Review & publish</Button>}
          {p.status === 'PUBLISHED' && p.assessmentId && (
            <Link href={`/exams/${p.assessmentId}`}>
              <Button variant="secondary">Open in results</Button>
            </Link>
          )}
        </div>
      </div>

      {p.status === 'RESULTS_RETURNED' && p.reviewNote && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Principal sent the results back: {p.reviewNote}</div>}
      {p.status === 'RESULTS_SUBMITTED' && !isManager && <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">Results are with the principal for approval.</div>}
      {p.status === 'PUBLISHED' && <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">Results are published. Students and parents can see them{isManager ? '; any mark you change here updates the published result' : ''}.</div>}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Submitted" value={`${submitted.length} / ${data.rows.length}`} />
        <Stat label="Writing now" value={data.rows.filter((r) => r.status === 'IN_PROGRESS').length} />
        <Stat label="Answers to check" value={toCheck} />
        <Stat label="Class average" value={avg === null ? '—' : `${avg} / ${p.totalMarks}`} />
      </div>

      {subjective.length > 0 && submitted.length > 0 && (
        <Card title="Check one question for the whole class" className="mb-6">
          <div className="flex flex-wrap gap-2">
            {subjective.map((q, i) => (
              <Button key={q.id} variant="secondary" onClick={() => setQuestion(q.id)}>
                Q{data.questions.indexOf(q) + 1} · {SHORT_LABEL[q.type]} · {q.text.slice(0, 30)}
                {q.text.length > 30 ? '…' : ''}
                <span className="sr-only">{i}</span>
              </Button>
            ))}
          </div>
        </Card>
      )}

      <Card title="Students">
        <Table head={['Roll', 'Student', 'Status', 'Score', 'To check', 'Tab switches', '']}>
          {data.rows.map((r) => (
            <tr key={r.student.id} className={r.attemptId && r.status === 'SUBMITTED' ? 'cursor-pointer hover:bg-gray-50' : ''} onClick={() => r.attemptId && r.status === 'SUBMITTED' && setAttempt(r.attemptId)}>
              <Td>{r.student.rollNo ?? '—'}</Td>
              <Td>
                <div className="font-medium">{r.student.fullName}</div>
                <div className="text-xs text-gray-500">{r.student.section?.name}</div>
              </Td>
              <Td>
                <Badge tone={statusTone[r.status]}>{statusText[r.status]}</Badge>
                {r.autoSubmitted && <span className="ml-1 text-xs text-gray-500">time up</span>}
              </Td>
              <Td>{r.status !== 'SUBMITTED' ? '—' : r.score === null ? <span className="text-amber-700">checking</span> : `${r.score} / ${p.totalMarks}`}</Td>
              <Td>{r.toCheck ? <Badge tone="amber">{r.toCheck}</Badge> : '—'}</Td>
              <Td className={r.tabSwitches >= 3 ? 'font-semibold text-red-600' : ''}>{r.attemptId ? r.tabSwitches : '—'}</Td>
              <Td>
                {r.status === 'SUBMITTED' && <span className="text-brand-700">Open →</span>}
                {r.attemptId && p.phase === 'LIVE' && (
                  <button
                    className="ml-3 text-xs text-red-600 hover:underline"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const reason = prompt(`Let ${r.student.fullName} start again? Their answers will be deleted. Reason:`);
                      if (!reason) return;
                      try {
                        await api.post(`/online-exams/attempts/${r.attemptId}/reset`, { reason });
                        toast('Student can start again');
                        reload();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Failed', 'error');
                      }
                    }}
                  >
                    Allow restart
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {attempt && (
        <AttemptMarking
          attemptId={attempt}
          onClose={() => setAttempt(null)}
          onSaved={reload}
          onNext={() => {
            const list = submitted.filter((r) => r.attemptId);
            const i = list.findIndex((r) => r.attemptId === attempt);
            const next = list[i + 1];
            setAttempt(next ? next.attemptId : null);
          }}
        />
      )}
      {question && <QuestionMarking paperId={id} questionId={question} onClose={() => setQuestion(null)} onSaved={reload} />}
      {review && <ReviewResults paperId={id} onClose={() => setReview(false)} onDone={reload} />}
    </>
  );
}

function MarkInput({ max, value, onChange }: { max: number; value: string; onChange: (v: string) => void }) {
  return (
    <span className="flex items-center gap-1 text-sm">
      <input className="input w-20 py-1" type="number" step="0.25" min={0} max={max} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Marks" />/ {max}
    </span>
  );
}

function GivenAnswer({ type, options, given }: { type: QType; options: unknown; given: unknown }) {
  const files = type === 'LONG' && given && typeof given === 'object' ? ((given as { fileIds?: string[] }).fileIds ?? []) : [];
  return (
    <div>
      <div className="whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-sm">{describeAnswer(type, options, given)}</div>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <a key={f} href={fileUrl(f)} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(f)} alt="Answer photo" className="h-32 rounded border border-gray-200 object-cover" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface AttemptDetail {
  student: { fullName: string; rollNo: string | null };
  attempt: { id: string; submittedAt: string | null; autoSubmitted: boolean; tabSwitches: number; score: number | null; overallRemark: string | null };
  paper: { title: string; status: string; totalMarks: number };
  sections: { id: string; title: string; attemptAny: number | null }[];
  questions: { id: string; sectionId: string; type: QType; text: string; imageFileId: string | null; options: unknown; answer: unknown; marks: number; given: unknown; mark: MarkEntry | null }[];
}

function AttemptMarking({ attemptId, onClose, onSaved, onNext }: { attemptId: string; onClose: () => void; onSaved: () => void; onNext: () => void }) {
  const toast = useToast();
  const { data, loading } = useData<AttemptDetail>(`/online-exams/attempts/${attemptId}`);
  const [marks, setMarks] = useState<Record<string, { marks: string; remark: string }>>({});
  const [overall, setOverall] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setMarks(Object.fromEntries(data.questions.map((q) => [q.id, { marks: q.mark?.manual !== null && q.mark?.manual !== undefined ? String(q.mark.manual) : '', remark: q.mark?.remark ?? '' }])));
    setOverall(data.attempt.overallRemark ?? '');
  }, [data]);

  async function save(next: boolean) {
    if (!data) return;
    setBusy(true);
    try {
      const body: Record<string, { marks: number | null; remark: string | null }> = {};
      for (const q of data.questions) {
        const m = marks[q.id];
        if (!m) continue;
        const old = q.mark;
        const val = m.marks === '' ? null : Number(m.marks);
        if (val !== (old?.manual ?? null) || (m.remark || null) !== (old?.remark ?? null)) body[q.id] = { marks: val, remark: m.remark || null };
      }
      const r = await api.put<{ score: number | null }>(`/online-exams/attempts/${attemptId}/marking`, { marks: body, overallRemark: overall || null });
      toast(r.score === null ? 'Saved – some answers still need marks' : `Saved · ${r.score} / ${data.paper.totalMarks}`);
      onSaved();
      if (next) onNext();
      else onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={data ? `${data.student.fullName}${data.student.rollNo ? ` (Roll ${data.student.rollNo})` : ''}` : 'Paper'} wide>
      {loading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3 text-sm text-gray-600">
            <span>Submitted {data.attempt.submittedAt ? new Date(data.attempt.submittedAt).toLocaleString() : '—'}</span>
            {data.attempt.autoSubmitted && <Badge tone="amber">Submitted automatically when time ended</Badge>}
            {data.attempt.tabSwitches > 0 && <Badge tone={data.attempt.tabSwitches >= 3 ? 'red' : 'gray'}>Left the exam screen {data.attempt.tabSwitches}×</Badge>}
          </div>
          <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
            {data.sections.map((s) => (
              <div key={s.id}>
                <h3 className="mb-2 font-semibold">
                  {s.title} {s.attemptAny && <span className="text-sm font-normal text-gray-500">(best {s.attemptAny} count)</span>}
                </h3>
                <ol className="space-y-4">
                  {data.questions
                    .filter((q) => q.sectionId === s.id)
                    .map((q) => {
                      const subjective = q.type === 'SHORT' || q.type === 'LONG';
                      const m = marks[q.id] ?? { marks: '', remark: '' };
                      return (
                        <li key={q.id} className="rounded-lg border border-gray-200 p-3">
                          <div className="mb-2 flex justify-between gap-3 text-sm font-medium">
                            <span className="whitespace-pre-wrap">{q.text}</span>
                            <span className="shrink-0 text-xs text-gray-500">
                              {SHORT_LABEL[q.type]} · {q.marks}
                            </span>
                          </div>
                          {q.imageFileId && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={fileUrl(q.imageFileId)} alt="" className="mb-2 max-h-40 rounded border border-gray-200" />
                          )}
                          <GivenAnswer type={q.type} options={q.options} given={q.given} />
                          {correctAnswerText(q.type, q.options, q.answer) && (
                            <div className="mt-1 text-xs text-green-700">
                              {subjective ? 'Model answer' : 'Correct'}: {correctAnswerText(q.type, q.options, q.answer)}
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            {!subjective && (
                              <span className="text-sm">
                                Auto: <b>{q.mark?.auto ?? 0}</b>
                              </span>
                            )}
                            <MarkInput max={q.marks} value={m.marks} onChange={(v) => setMarks({ ...marks, [q.id]: { ...m, marks: v } })} />
                            {!subjective && <span className="text-xs text-gray-500">leave empty to keep the auto mark</span>}
                            <input className="input min-w-40 flex-1 py-1" placeholder="Remark for the student (optional)" value={m.remark} onChange={(e) => setMarks({ ...marks, [q.id]: { ...m, remark: e.target.value } })} />
                          </div>
                        </li>
                      );
                    })}
                </ol>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-gray-100 pt-4">
            <Field label="Overall remark">
              <input className="input" value={overall} onChange={(e) => setOverall(e.target.value)} placeholder="e.g. Good effort, revise chapter 3" />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => save(true)} loading={busy}>
                Save & next student
              </Button>
              <Button variant="secondary" onClick={() => save(false)} disabled={busy}>
                Save & close
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

interface QuestionAnswers {
  question: { id: string; type: QType; text: string; options: unknown; answer: unknown; marks: number };
  answers: { attemptId: string; student?: { fullName: string; rollNo: string | null }; given: unknown; mark: MarkEntry | null }[];
}

function QuestionMarking({ paperId, questionId, onClose, onSaved }: { paperId: string; questionId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data, loading } = useData<QuestionAnswers>(`/online-exams/${paperId}/questions/${questionId}/answers`);
  const [vals, setVals] = useState<Record<string, { marks: string; remark: string }>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setVals(Object.fromEntries(data.answers.map((a) => [a.attemptId, { marks: a.mark?.manual === null || a.mark?.manual === undefined ? '' : String(a.mark.manual), remark: a.mark?.remark ?? '' }])));
  }, [data]);

  return (
    <Modal open onClose={onClose} title="Check by question" wide>
      {loading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 rounded-lg bg-gray-50 p-3 text-sm">
            <div className="whitespace-pre-wrap font-medium">{data.question.text}</div>
            {correctAnswerText(data.question.type, data.question.options, data.question.answer) && <div className="mt-1 text-xs text-green-700">Model answer: {correctAnswerText(data.question.type, data.question.options, data.question.answer)}</div>}
          </div>
          <ul className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {data.answers.map((a) => {
              const v = vals[a.attemptId] ?? { marks: '', remark: '' };
              return (
                <li key={a.attemptId} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-1 text-sm font-semibold">
                    {a.student?.rollNo && `${a.student.rollNo}. `}
                    {a.student?.fullName}
                  </div>
                  <GivenAnswer type={data.question.type} options={data.question.options} given={a.given} />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <MarkInput max={data.question.marks} value={v.marks} onChange={(m) => setVals({ ...vals, [a.attemptId]: { ...v, marks: m } })} />
                    <input className="input min-w-40 flex-1 py-1" placeholder="Remark (optional)" value={v.remark} onChange={(e) => setVals({ ...vals, [a.attemptId]: { ...v, remark: e.target.value } })} />
                  </div>
                </li>
              );
            })}
          </ul>
          <Button
            className="mt-4"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.put(`/online-exams/${paperId}/questions/${questionId}/marking`, {
                  marks: Object.entries(vals)
                    .filter(([, v]) => v.marks !== '' || v.remark)
                    .map(([attemptId, v]) => ({ attemptId, marks: v.marks === '' ? null : Number(v.marks), remark: v.remark || null })),
                });
                toast('Marks saved');
                onSaved();
                onClose();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Failed', 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Save marks
          </Button>
        </>
      )}
    </Modal>
  );
}

function ReviewResults({ paperId, onClose, onDone }: { paperId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data } = useData<{ papers: { id: string; title: string; totalMarks: number }[] }>(`/online-exams/${paperId}/linkable-papers`);
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(approve: boolean) {
    setBusy(true);
    try {
      const r = await api.post<{ warning?: string | null }>(`/online-exams/${paperId}/review-results`, { approve, note: note || null, linkPaperId: approve && link ? link : null });
      toast(approve ? 'Results published' : 'Sent back to the teacher');
      if (r.warning) toast(r.warning, 'error');
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Review results">
      <p className="mb-4 text-sm text-gray-600">Check the scores in the list (open any student to see their answers). Publishing adds this as an “Online test” result that students and parents can see, and sends result messages as set in Messaging settings.</p>
      <Field label="Also count these marks in a term exam (optional)" hint="Marks are scaled to that paper’s total. Only unpublished exams are listed.">
        <select className="input" value={link} onChange={(e) => setLink(e.target.value)}>
          <option value="">Don’t copy</option>
          {data?.papers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} (out of {p.totalMarks})
            </option>
          ))}
        </select>
      </Field>
      <div className="mt-3">
        <Field label="Note to the teacher (needed when sending back)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => send(true)} loading={busy}>
          Approve & publish
        </Button>
        <Button variant="secondary" onClick={() => send(false)} disabled={busy || !note}>
          Send back
        </Button>
      </div>
    </Modal>
  );
}
