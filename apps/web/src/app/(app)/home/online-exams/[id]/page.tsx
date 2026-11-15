'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Button, Card, ErrorBox, Loading, Modal } from '@/components/ui';
import { AnswerInput, type StudentQ } from '@/components/online/Questions';

interface View {
  attempt: { id: string; startedAt: string; deadline: string; submitted: boolean; answers: Record<string, unknown>; serverNow: string };
  paper: { id: string; title: string; instructions: string | null; totalMarks: number; negativeMarking: number };
  sections: { id: string; title: string; instructions: string | null; attemptAny: number | null }[];
  questions: StudentQ[];
}
interface ListItem {
  id: string;
  title: string;
  subject: string;
  durationMinutes: number;
  totalMarks: number;
  questions: number;
  phase: string;
  attempt: { id: string; submitted: boolean } | null;
}

const answered = (v: unknown) => {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.some((x) => x !== '' && x !== null && x !== undefined);
  if (typeof v === 'object') return Boolean((v as { text?: string }).text || (v as { fileIds?: string[] }).fileIds?.length);
  return true;
};

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export default function TakeExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data: list, error: listError } = useData<{ papers: ListItem[] }>('/online-exams/student/list');
  const [view, setView] = useState<View | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [idx, setIdx] = useState(0);
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [left, setLeft] = useState<number>(0);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<null | 'manual' | 'time'>(null);
  const [starting, setStarting] = useState(false);

  const offset = useRef(0); // server time − device time
  const pending = useRef<Record<string, unknown>>({});
  const tabSwitches = useRef(0);
  const finished = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  const item = list?.papers.find((p) => p.id === id);

  async function start() {
    setStarting(true);
    try {
      const v = await api.post<View>(`/online-exams/${id}/start`);
      offset.current = new Date(v.attempt.serverNow).getTime() - Date.now();
      setView(v);
      setAnswers(v.attempt.answers ?? {});
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start', 'error');
    } finally {
      setStarting(false);
    }
  }

  const flush = useCallback(
    async (force = false) => {
      if (!view || finished.current) return;
      const body = pending.current;
      if (!force && !Object.keys(body).length) return;
      pending.current = {};
      setSaveState('saving');
      try {
        await api.put(`/online-exams/attempts/${view.attempt.id}/answers`, { answers: body, tabSwitches: tabSwitches.current });
        setSaveState(Object.keys(pending.current).length ? 'saving' : 'saved');
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (/time is up|already submitted/i.test(msg)) {
          finished.current = true;
          setDone('time');
          return;
        }
        pending.current = { ...body, ...pending.current }; // keep for the next try
        setSaveState('offline');
      }
    },
    [view],
  );

  // Autosave shortly after each change, and every 15 seconds as a safety net.
  useEffect(() => {
    if (!view) return;
    const t = setInterval(() => flush(), 15000);
    return () => clearInterval(t);
  }, [view, flush]);

  // Count each time the student leaves the exam screen.
  useEffect(() => {
    if (!view) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden' && !finished.current) {
        tabSwitches.current++;
        flush(true);
      } else if (document.visibilityState === 'visible' && !finished.current && tabSwitches.current) {
        toast(`You left the exam screen (${tabSwitches.current}×). Your teacher can see this.`, 'error');
      }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!finished.current) e.preventDefault();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [view, flush, toast]);

  const submit = useCallback(
    async (auto: boolean) => {
      if (!view || finished.current) return;
      try {
        await flush(true);
        await api.post(`/online-exams/attempts/${view.attempt.id}/submit`);
      } catch {
        /* the server submits automatically when time runs out */
      }
      finished.current = true;
      setConfirm(false);
      setDone(auto ? 'time' : 'manual');
    },
    [view, flush],
  );

  // Timer from the server's deadline (device clock corrected).
  useEffect(() => {
    if (!view) return;
    const deadline = new Date(view.attempt.deadline).getTime();
    const tick = () => {
      const ms = deadline - (Date.now() + offset.current);
      setLeft(ms);
      if (ms <= 0) submit(true);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [view, submit]);

  function setAnswer(qid: string, v: unknown) {
    setAnswers((a) => ({ ...a, [qid]: v }));
    pending.current[qid] = v;
    setSaveState('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flush(), 1500);
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await api.post<{ fileId: string }>(`/online-exams/attempts/${view!.attempt.id}/upload`, fd);
    return r.fileId;
  }

  if (done) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <div className="py-6">
          <div className="mb-2 text-4xl">✓</div>
          <h1 className="text-xl font-semibold">{done === 'time' ? 'Time is up – your answers were submitted' : 'Exam submitted'}</h1>
          <p className="mt-2 text-sm text-gray-600">Your teacher will check the paper. You will see your result here when the principal publishes it.</p>
          <Link href="/home/online-exams">
            <Button className="mt-5">Back to online exams</Button>
          </Link>
        </div>
      </Card>
    );
  }

  if (!view) {
    if (listError) return <ErrorBox error={listError} />;
    if (!list) return <Loading />;
    if (!item) return <ErrorBox error={new Error('This exam is not available.')} />;
    if (item.attempt?.submitted) return <ErrorBox error={new Error('You have already finished this exam.')} />;
    return (
      <Card className="mx-auto max-w-xl">
        <h1 className="text-xl font-semibold">{item.title}</h1>
        <p className="text-sm text-gray-600">
          {item.subject} · {item.questions} questions · {item.totalMarks} marks
        </p>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-gray-700">
          <li>
            You have <b>{item.durationMinutes} minutes</b> once you start. The clock keeps running even if you close the page.
          </li>
          <li>Your answers are saved automatically. If the internet stops, keep going – they will be saved when it returns.</li>
          <li>Do not leave this screen or open other apps. Your teacher is told each time you do.</li>
          <li>Copy and paste are turned off.</li>
          <li>When time is up the paper is submitted automatically.</li>
        </ul>
        <Button className="mt-6 w-full sm:w-auto" onClick={start} loading={starting} disabled={item.phase !== 'LIVE'}>
          {item.attempt ? 'Continue exam' : item.phase === 'LIVE' ? 'Start exam now' : 'Not open yet'}
        </Button>
      </Card>
    );
  }

  const qs = view.questions;
  const q = qs[idx];
  const section = view.sections.find((s) => s.id === q?.sectionId);
  const firstOfSection = idx === 0 || qs[idx - 1].sectionId !== q.sectionId;
  const unanswered = qs.filter((x) => !answered(answers[x.id])).length;
  const low = left < 60_000;

  return (
    <div className="mx-auto max-w-3xl select-none" onContextMenu={(e) => e.preventDefault()}>
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <div className="min-w-0">
          <div className="truncate font-semibold">{view.paper.title}</div>
          <div className="text-xs text-gray-500">
            {saveState === 'saved' ? 'All answers saved' : saveState === 'saving' ? 'Saving…' : 'No internet – answers will save when it returns'}
          </div>
        </div>
        <div className={`shrink-0 rounded-lg px-3 py-1.5 font-mono text-lg font-semibold tabular-nums ${low ? 'animate-pulse bg-red-100 text-red-700' : left < 300_000 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100'}`} aria-label="Time left">
          {fmt(left)}
        </div>
      </div>

      {idx === 0 && view.paper.instructions && <div className="mb-4 whitespace-pre-wrap rounded-xl bg-brand-50 p-4 text-sm text-brand-900">{view.paper.instructions}</div>}
      {firstOfSection && section && (
        <div className="mb-3">
          <h2 className="font-semibold">{section.title}</h2>
          {(section.instructions || section.attemptAny) && (
            <p className="text-sm text-gray-600">
              {section.instructions} {section.attemptAny && `Attempt any ${section.attemptAny} — your best ${section.attemptAny} answers count.`}
            </p>
          )}
        </div>
      )}

      <Card>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="text-sm font-semibold text-gray-500">
            Question {idx + 1} of {qs.length}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>
              {q.marks} mark{q.marks === 1 ? '' : 's'}
              {view.paper.negativeMarking > 0 && (q.type === 'MCQ' || q.type === 'TRUE_FALSE') && ' · wrong answers lose marks'}
            </span>
            <button
              className={flags.has(q.id) ? 'font-semibold text-amber-600' : 'hover:text-amber-600'}
              onClick={() => {
                const n = new Set(flags);
                if (n.has(q.id)) n.delete(q.id);
                else n.add(q.id);
                setFlags(n);
              }}
            >
              ⚑ {flags.has(q.id) ? 'Marked for review' : 'Mark for review'}
            </button>
          </div>
        </div>
        <p className="mb-4 whitespace-pre-wrap text-base">{q.text}</p>
        {q.imageFileId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(q.imageFileId)} alt="" className="mb-4 max-h-72 rounded-lg border border-gray-200" />
        )}
        <AnswerInput key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} onUpload={upload} />
        <div className="mt-6 flex justify-between gap-3">
          <Button variant="secondary" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
            ← Previous
          </Button>
          {idx < qs.length - 1 ? (
            <Button onClick={() => setIdx(idx + 1)}>Next →</Button>
          ) : (
            <Button onClick={() => setConfirm(true)}>Finish exam</Button>
          )}
        </div>
      </Card>

      <Card title="Questions" className="mt-4">
        <div className="flex flex-wrap gap-2">
          {qs.map((x, i) => (
            <button
              key={x.id}
              onClick={() => setIdx(i)}
              className={`h-9 w-9 rounded-lg border text-sm font-medium ${i === idx ? 'ring-2 ring-brand-500 ring-offset-1' : ''} ${flags.has(x.id) ? 'border-amber-400 bg-amber-100 text-amber-900' : answered(answers[x.id]) ? 'border-brand-500 bg-brand-600 text-white' : 'border-gray-300 bg-white text-gray-700'}`}
              aria-label={`Question ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
          <span>
            <span className="mr-1 inline-block h-3 w-3 rounded bg-brand-600 align-middle" /> answered
          </span>
          <span>
            <span className="mr-1 inline-block h-3 w-3 rounded border border-amber-400 bg-amber-100 align-middle" /> marked for review
          </span>
          <span>
            <span className="mr-1 inline-block h-3 w-3 rounded border border-gray-300 align-middle" /> not answered
          </span>
        </div>
        <Button variant="secondary" className="mt-4" onClick={() => setConfirm(true)}>
          Finish exam
        </Button>
      </Card>

      {confirm && (
        <Modal open onClose={() => setConfirm(false)} title="Finish the exam?">
          <p className="text-sm text-gray-700">
            {unanswered ? (
              <>
                You have <b>{unanswered}</b> unanswered question{unanswered === 1 ? '' : 's'}
                {flags.size ? ` and ${flags.size} marked for review` : ''}.{' '}
              </>
            ) : (
              'All questions are answered. '
            )}
            You cannot change your answers after finishing.
          </p>
          <div className="mt-5 flex gap-2">
            <Button onClick={() => submit(false)}>Yes, submit</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Keep working
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
