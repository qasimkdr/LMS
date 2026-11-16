'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Avatar } from '@/components/Avatar';
import { CountUp, Hero, KpiCard } from '@/components/fx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal } from '@/components/ui';
import { money } from '@/lib/format';

type Action = 'PROMOTE' | 'RETAIN' | 'GRADUATE';
interface PlanStudent {
  id: string;
  fullName: string;
  rollNo: string | null;
  photoFileId: string | null;
  section: string | null;
  result: { title: string; percent: number; passed: boolean } | null;
  suggested: Action;
}
interface Plan {
  current: { id: string; name: string; startDate: string; endDate: string } | null;
  alreadyPromoted: boolean;
  classes: { id: string; label: string; sections: { id: string; name: string }[]; suggestedTargetClassId: string | null; students: PlanStudent[] }[];
}
const ACTION: Record<Action, { label: string; on: string }> = {
  PROMOTE: { label: 'Promote', on: 'bg-emerald-500 text-white shadow' },
  RETAIN: { label: 'Stay', on: 'bg-amber-500 text-white shadow' },
  GRADUATE: { label: 'Graduate', on: 'bg-brand-600 text-white shadow' },
};

/** "2025-26" → "2026-27"; dates move one year forward. */
function nextSession(cur: Plan['current']) {
  const y = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
  if (!cur) {
    const t = new Date().getUTCFullYear();
    return { name: `${t}-${String(t + 1).slice(2)}`, startDate: `${t}-04-01`, endDate: `${t + 1}-03-31` };
  }
  const m = cur.name.match(/(\d{4})\D+(\d{2,4})/);
  const name = m ? `${Number(m[1]) + 1}-${String(Number(m[2].slice(-2)) + 1).padStart(2, '0')}` : `${cur.name} (next)`;
  return { name, startDate: y(cur.startDate, 1), endDate: y(cur.endDate, 1) };
}

export default function SessionClosePage() {
  const toast = useToast();
  const { me } = useAuth();
  const { data, error, loading, reload } = useData<Plan>('/promotion/plan');
  const history = useData<{ batches: { batchId: string; from: string | null; to: string; at: string; counts: Record<string, number> }[] }>('/promotion/history');
  const [session, setSession] = useState({ name: '', startDate: '', endDate: '' });
  const [targets, setTargets] = useState<Record<string, string | null>>({});
  const [actions, setActions] = useState<Record<string, Action>>({});
  const [fee, setFee] = useState('0');
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ counts: Record<string, number>; feesChanged: number; arrearsCarried: number; name: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setSession(nextSession(data.current));
    setTargets(Object.fromEntries(data.classes.map((c) => [c.id, c.suggestedTargetClassId])));
    setActions(Object.fromEntries(data.classes.flatMap((c) => c.students.map((s) => [s.id, s.suggested]))));
  }, [data]);

  const counts = useMemo(() => {
    const r = { PROMOTE: 0, RETAIN: 0, GRADUATE: 0 } as Record<Action, number>;
    Object.values(actions).forEach((a) => r[a]++);
    return r;
  }, [actions]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  if (done) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 animate-pop items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 text-3xl text-white shadow-xl shadow-emerald-600/30">✓</div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to session {done.name}</h1>
            <p className="mt-1 text-sm text-gray-600">
              {done.counts.PROMOTE} promoted · {done.counts.RETAIN} stayed in their class · {done.counts.GRADUATE} graduated
            </p>
            <p className="mt-3 text-sm text-gray-600">
              {done.feesChanged ? `Class fees were raised (${done.feesChanged} fee amounts updated). ` : ''}
              {done.arrearsCarried > 0 ? `Unpaid fees of ${money(done.arrearsCarried, me?.school?.currency)} are carried forward and still show on each family's account.` : 'No unpaid fees were carried forward.'}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link href="/school/assignments">
                <Button>Check teacher assignments</Button>
              </Link>
              <Link href="/school/fees">
                <Button variant="secondary">Review the fee structure</Button>
              </Link>
              <Link href="/school/students">
                <Button variant="secondary">See students</Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const total = Object.keys(actions).length;
  const missingTarget = data.classes.some((c) => c.students.some((s) => actions[s.id] === 'PROMOTE') && !targets[c.id]);

  return (
    <>
      <Hero eyebrow="End of the academic year" title={data.current ? `Close session ${data.current.name}` : 'Start a new session'} subtitle="Move every student to their next class, start the new session and set new fees. Past results, attendance and fees stay viewable.">
        <span className="glass rounded-xl px-3 py-1.5 text-sm">
          {total} students · {data.classes.length} classes
        </span>
      </Hero>
      {data.alreadyPromoted ? (
        <Empty title="This session has already been closed">The next session is now current.</Empty>
      ) : !total ? (
        <Empty title="There are no active students to promote" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <KpiCard i={0} label="Promote" icon="↑" tone="emerald" value={<CountUp value={counts.PROMOTE} />} hint="to the next class" />
            <KpiCard i={1} label="Stay in class" icon="↺" tone="amber" value={<CountUp value={counts.RETAIN} />} hint="repeat the year" />
            <KpiCard i={2} label="Graduate" icon="🎓" tone="blue" value={<CountUp value={counts.GRADUATE} />} hint="leave as passed out" />
          </div>

          <Card title="1. New session">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name">
                <input className="input" value={session.name} onChange={(e) => setSession({ ...session, name: e.target.value })} />
              </Field>
              <Field label="Starts">
                <input className="input" type="date" value={session.startDate} onChange={(e) => setSession({ ...session, startDate: e.target.value })} />
              </Field>
              <Field label="Ends">
                <input className="input" type="date" value={session.endDate} onChange={(e) => setSession({ ...session, endDate: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card title="2. Where does each student go?">
            <p className="mb-4 text-sm text-gray-600">Suggestions come from the final exam of this session: students who did not pass stay in their class. Change any decision before you confirm. Students keep the same section name in the next class when it exists.</p>
            <div className="space-y-4">
              {data.classes
                .filter((c) => c.students.length)
                .map((c, ci) => {
                  const others = data.classes.filter((x) => x.id !== c.id);
                  return (
                    <section key={c.id} className="reveal rounded-2xl border border-gray-200/70 p-4" style={{ '--i': ci } as CSSProperties}>
                      <header className="mb-3 flex flex-wrap items-center gap-3">
                        <span className="text-base font-semibold">{c.label}</span>
                        <span className="text-sm text-gray-500">→</span>
                        <select className="input w-auto py-1.5" value={targets[c.id] ?? ''} onChange={(e) => setTargets({ ...targets, [c.id]: e.target.value || null })} aria-label={`Next class for ${c.label}`}>
                          <option value="">No next class (graduate)</option>
                          {others.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <span className="ml-auto flex gap-1 text-xs">
                          {(Object.keys(ACTION) as Action[])
                            .filter((a) => a !== 'PROMOTE' || targets[c.id])
                            .map((a) => (
                              <button key={a} className="rounded-full px-2.5 py-1 text-gray-600 ring-1 ring-gray-200 transition hover:bg-gray-50" onClick={() => setActions({ ...actions, ...Object.fromEntries(c.students.map((s) => [s.id, a])) })}>
                                All: {ACTION[a].label}
                              </button>
                            ))}
                        </span>
                      </header>
                      <ul className="grid gap-2 md:grid-cols-2">
                        {c.students.map((s) => (
                          <li key={s.id} className={`flex items-center gap-3 rounded-xl px-2.5 py-2 transition ${s.result && !s.result.passed ? 'bg-rose-50/60' : 'bg-gray-50'}`}>
                            <Avatar fileId={s.photoFileId} name={s.fullName} size={32} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{s.fullName}</span>
                              <span className="block truncate text-xs text-gray-500">
                                {s.section && `Section ${s.section} · `}
                                {s.result ? `${s.result.title}: ${s.result.percent}%${s.result.passed ? '' : ' (not passed)'}` : 'No final exam result'}
                              </span>
                            </span>
                            <span className="flex shrink-0 rounded-full bg-white p-0.5 ring-1 ring-gray-200">
                              {(Object.keys(ACTION) as Action[])
                                .filter((a) => a !== 'PROMOTE' || targets[c.id])
                                .map((a) => (
                                  <button key={a} onClick={() => setActions({ ...actions, [s.id]: a })} className={`rounded-full px-2.5 py-1 text-xs font-medium transition duration-200 active:scale-95 ${actions[s.id] === a ? ACTION[a].on : 'text-gray-500 hover:text-gray-800'}`}>
                                    {ACTION[a].label}
                                  </button>
                                ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
            </div>
          </Card>

          <Card title="3. Fees for the new session">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Raise every class fee by (%)">
                <input className="input w-32" type="number" min={0} max={100} value={fee} onChange={(e) => setFee(e.target.value)} />
              </Field>
              <p className="max-w-lg text-sm text-gray-500">Leave 0 to keep fees as they are. You can still change any class fee in Fees → Setup. Unpaid vouchers stay open and are carried into the new session automatically.</p>
            </div>
          </Card>

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-gray-200/70 bg-white/80 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
            <span className="text-sm text-gray-600">
              {counts.PROMOTE} promote · {counts.RETAIN} stay · {counts.GRADUATE} graduate
            </span>
            {missingTarget && <Badge tone="red">Choose the next class where students are promoted</Badge>}
            <Button className="ml-auto" disabled={missingTarget || !session.name.trim()} onClick={() => setConfirm(true)}>
              Review & close session
            </Button>
          </div>
        </div>
      )}

      {history.data && history.data.batches.length > 0 && (
        <Card title="Past session closings" className="mt-6">
          <ul className="divide-y divide-gray-100 text-sm">
            {history.data.batches.map((b) => (
              <li key={b.batchId} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {b.from ?? 'Start'} → <b>{b.to}</b>
                </span>
                <span className="text-gray-500">
                  {b.counts.PROMOTE ?? 0} promoted · {b.counts.RETAIN ?? 0} stayed · {b.counts.GRADUATE ?? 0} graduated
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {confirm && (
        <Modal open onClose={() => setConfirm(false)} title="Close the session?">
          <div className="space-y-3 text-sm text-gray-700">
            <p>
              <b>{data.current?.name ?? 'The current session'}</b> will be closed and <b>{session.name}</b> will start. {counts.PROMOTE} students move up, {counts.RETAIN} stay, {counts.GRADUATE} graduate (their logins are switched off).
              {Number(fee) > 0 && ` All class fees go up by ${fee}%.`}
            </p>
            <p className="rounded-xl bg-amber-50 p-3 text-amber-900">This cannot be undone automatically. Type the new session name to confirm.</p>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={session.name} />
            <Button
              loading={busy}
              disabled={typed.trim() !== session.name.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.post<{ counts: Record<string, number>; feesChanged: number; arrearsCarried: number }>('/promotion/run', {
                    newSession: session,
                    feeIncreasePercent: Number(fee) || 0,
                    classes: data.classes
                      .filter((c) => c.students.length)
                      .map((c) => ({ classId: c.id, targetClassId: targets[c.id] ?? null, students: c.students.map((s) => ({ studentId: s.id, action: actions[s.id] })) })),
                  });
                  setDone({ ...r, name: session.name });
                  toast('Session closed');
                  reload();
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Failed', 'error');
                } finally {
                  setBusy(false);
                  setConfirm(false);
                }
              }}
            >
              Close session and promote
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
