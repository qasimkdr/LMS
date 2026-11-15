'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Tabs } from '@/components/Tabs';
import { TimetableGrid, t12 } from '@/components/TimetableGrid';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';
import { className, type Structure, type TTDay, type TTPeriod } from '@/lib/types';

type Tab = 'overview' | 'bells' | 'classes' | 'teachers';

interface Overview {
  configured: boolean;
  slotsPerWeek: number;
  sections: { id: string; name: string; class: { name: string; stream: string | null }; filled: number }[];
  teachers: { id: string; fullName: string; periodsPerWeek: number }[];
}

function TimetableInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { me } = useAuth();
  const isPrincipal = me?.user.role === 'PRINCIPAL';
  const tab = (params.get('tab') as Tab) || 'overview';
  const go = (t: Tab, extra = '') => router.replace(`/school/timetable?tab=${t}${extra}`);
  return (
    <>
      <PageHeader title="Timetable" subtitle="Period timings, class timetables and teacher schedules" />
      <div className="print:hidden">
        <Tabs
          value={tab}
          onChange={(t) => go(t)}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'classes', label: 'Class timetables' },
            { key: 'teachers', label: 'Teacher timetables' },
            ...(isPrincipal ? [{ key: 'bells' as Tab, label: 'Period timings' }] : []),
          ]}
        />
      </div>
      {tab === 'overview' && <OverviewTab go={go} />}
      {tab === 'bells' && isPrincipal && <BellsTab />}
      {tab === 'classes' && <ClassTab initial={params.get('section') ?? ''} editable={Boolean(isPrincipal)} />}
      {tab === 'teachers' && <TeacherTab initial={params.get('teacher') ?? ''} />}
    </>
  );
}

export default function TimetablePage() {
  return (
    <Suspense fallback={<Loading />}>
      <TimetableInner />
    </Suspense>
  );
}

// ---------- Overview ----------

function OverviewTab({ go }: { go: (t: Tab, extra?: string) => void }) {
  const { me } = useAuth();
  const { data, error, loading } = useData<Overview>('/timetable/overview');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  if (!data.configured) {
    return (
      <Empty title="Set the period timings first">
        {me?.user.role === 'PRINCIPAL' ? (
          <Button className="mt-3" onClick={() => go('bells')}>
            Set period timings
          </Button>
        ) : (
          'The principal sets the school timings.'
        )}
      </Empty>
    );
  }
  const maxLoad = Math.max(1, ...data.teachers.map((t) => t.periodsPerWeek));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={`Class timetables · ${data.slotsPerWeek} periods a week`}>
        {data.sections.length === 0 ? (
          <Empty title="No classes yet" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.sections.map((s) => {
              const pct = Math.round((s.filled / Math.max(1, data.slotsPerWeek)) * 100);
              return (
                <li key={s.id}>
                  <button onClick={() => go('classes', `&section=${s.id}`)} className="flex w-full items-center gap-3 py-2 text-left text-sm hover:text-brand-700">
                    <span className="w-40 shrink-0 truncate font-medium">{className(s.class, s)}</span>
                    <span className="h-2 flex-1 rounded-full bg-gray-100">
                      <span className={`block h-2 rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </span>
                    <span className="w-16 text-right text-xs text-gray-500">
                      {s.filled}/{data.slotsPerWeek}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Teacher load (periods a week)">
        {data.teachers.length === 0 ? (
          <Empty title="No teachers yet" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {[...data.teachers]
              .sort((a, b) => b.periodsPerWeek - a.periodsPerWeek)
              .map((t) => (
                <li key={t.id}>
                  <button onClick={() => go('teachers', `&teacher=${t.id}`)} className="flex w-full items-center gap-3 py-2 text-left text-sm hover:text-brand-700">
                    <span className="w-40 shrink-0 truncate font-medium">{t.fullName}</span>
                    <span className="h-2 flex-1 rounded-full bg-gray-100">
                      <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(t.periodsPerWeek / maxLoad) * 100}%` }} />
                    </span>
                    <span className="w-16 text-right text-xs text-gray-500">{t.periodsPerWeek}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- Period timings ----------

interface EditPeriod {
  id?: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}
interface EditSchedule {
  id?: string;
  name: string;
  days: number[];
  periods: EditPeriod[];
}
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const addMinutes = (t: string, m: number) => {
  const total = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + m;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

function makePeriods(start: string, count: number, minutes: number, breakAfter: number, breakMinutes: number): EditPeriod[] {
  const list: EditPeriod[] = [];
  let t = start;
  for (let i = 1; i <= count; i++) {
    list.push({ name: `Period ${i}`, startTime: t, endTime: addMinutes(t, minutes), isBreak: false });
    t = addMinutes(t, minutes);
    if (i === breakAfter && breakMinutes > 0) {
      list.push({ name: 'Break', startTime: t, endTime: addMinutes(t, breakMinutes), isBreak: true });
      t = addMinutes(t, breakMinutes);
    }
  }
  return list;
}

function BellsTab() {
  const toast = useToast();
  const { data, loading, reload } = useData<{ workingDays: number[]; schedules: EditSchedule[] }>('/timetable/setup');
  const [working, setWorking] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [schedules, setSchedules] = useState<EditSchedule[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!data) return;
    setWorking(data.workingDays);
    setSchedules(
      data.schedules.length
        ? data.schedules.map((s) => ({ id: s.id, name: s.name, days: s.days, periods: s.periods.map((p) => ({ id: p.id, name: p.name, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak })) }))
        : [
            { name: 'Regular days', days: [1, 2, 3, 4, 6], periods: makePeriods('08:00', 8, 40, 4, 20) },
            { name: 'Friday', days: [5], periods: makePeriods('08:00', 6, 35, 3, 15) },
          ],
    );
  }, [data]);

  if (loading && !data) return <Loading />;
  const update = (i: number, s: EditSchedule) => setSchedules(schedules.map((x, j) => (j === i ? s : x)));
  const unassigned = working.filter((d) => !schedules.some((s) => s.days.includes(d)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await api.put<{ removedEntries: number }>('/timetable/setup', { workingDays: working, schedules });
      toast(r.removedEntries ? `Timings saved. ${r.removedEntries} timetable cells in removed periods were cleared.` : 'Timings saved');
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {!data?.schedules.length && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
          A typical setup is filled in below: 8 periods of 40 minutes on regular days and 6 shorter periods on Friday. Change anything, then save.
        </div>
      )}
      <Card title="Working days">
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label key={d} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${working.includes(d) ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}>
              <input
                type="checkbox"
                checked={working.includes(d)}
                onChange={(e) => {
                  const w = e.target.checked ? [...working, d].sort() : working.filter((x) => x !== d);
                  setWorking(w);
                  if (!e.target.checked) setSchedules(schedules.map((s) => ({ ...s, days: s.days.filter((x) => x !== d) })));
                }}
              />
              {DAYS[d]}
            </label>
          ))}
        </div>
      </Card>

      {schedules.map((s, i) => (
        <Card
          key={i}
          title={<input className="input w-56 py-1 font-semibold" value={s.name} onChange={(e) => update(i, { ...s, name: e.target.value })} aria-label="Timing name" />}
          actions={
            schedules.length > 1 && (
              <Button variant="ghost" onClick={() => setSchedules(schedules.filter((_, j) => j !== i))}>
                Remove
              </Button>
            )
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-600">Used on:</span>
            {working.map((d) => {
              const owner = schedules.findIndex((x) => x.days.includes(d));
              const mine = owner === i;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    setSchedules(schedules.map((x, j) => (j === i ? { ...x, days: mine ? x.days.filter((y) => y !== d) : [...x.days, d].sort() } : { ...x, days: x.days.filter((y) => y !== d) })))
                  }
                  className={`rounded-full px-3 py-1 text-xs font-medium ${mine ? 'bg-brand-600 text-white' : owner >= 0 ? 'bg-gray-100 text-gray-400' : 'bg-amber-100 text-amber-800'}`}
                >
                  {DAYS[d]}
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            {s.periods.map((p, k) => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <input className="input w-32 py-1" value={p.name} onChange={(e) => update(i, { ...s, periods: s.periods.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} aria-label="Period name" />
                <input
                  type="time"
                  className="input w-32 py-1"
                  value={p.startTime}
                  onChange={(e) => update(i, { ...s, periods: s.periods.map((x, j) => (j === k ? { ...x, startTime: e.target.value } : x)) })}
                  aria-label="Start"
                />
                <span className="text-gray-400">to</span>
                <input
                  type="time"
                  className="input w-32 py-1"
                  value={p.endTime}
                  onChange={(e) => update(i, { ...s, periods: s.periods.map((x, j) => (j === k ? { ...x, endTime: e.target.value } : x)) })}
                  aria-label="End"
                />
                <label className="flex items-center gap-1.5 text-sm text-gray-600">
                  <input type="checkbox" checked={p.isBreak} onChange={(e) => update(i, { ...s, periods: s.periods.map((x, j) => (j === k ? { ...x, isBreak: e.target.checked } : x)) })} />
                  Break
                </label>
                <button className="text-sm text-gray-400 hover:text-red-600" onClick={() => update(i, { ...s, periods: s.periods.filter((_, j) => j !== k) })} aria-label="Remove period">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const last = s.periods[s.periods.length - 1];
                const start = last?.endTime ?? '08:00';
                const n = s.periods.filter((x) => !x.isBreak).length + 1;
                update(i, { ...s, periods: [...s.periods, { name: `Period ${n}`, startTime: start, endTime: addMinutes(start, 40), isBreak: false }] });
              }}
            >
              + Period
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const last = s.periods[s.periods.length - 1];
                const start = last?.endTime ?? '10:00';
                update(i, { ...s, periods: [...s.periods, { name: 'Break', startTime: start, endTime: addMinutes(start, 20), isBreak: true }] });
              }}
            >
              + Break
            </Button>
          </div>
        </Card>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setSchedules([...schedules, { name: 'Other timings', days: [], periods: makePeriods('08:00', 6, 35, 3, 15) }])}>
          + Different timings for some days
        </Button>
        {unassigned.length > 0 && <Badge tone="amber">No timings chosen for {unassigned.map((d) => DAYS[d]).join(', ')}</Badge>}
      </div>
      <ErrorBox error={error} />
      <Button onClick={save} loading={saving}>
        Save timings
      </Button>
    </div>
  );
}

// ---------- Class timetable ----------

interface SectionTT {
  section: { id: string; name: string; room: string | null; class: { id: string; name: string; stream: string | null }; classTeacher: { fullName: string } | null };
  subjects: { id: string; name: string; isOptional: boolean; teacher: { id: string; fullName: string } | null; periodsPerWeek: number }[];
  week: TTDay[];
  busy: { day: number; periodId: string; teacherId: string; where: string }[];
}

function ClassTab({ initial, editable }: { initial: string; editable: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const { data: structure } = useData<Structure>('/setup/structure');
  const [sectionId, setSectionId] = useState(initial);
  const { data, error, loading, reload } = useData<SectionTT>(sectionId ? `/timetable/sections/${sectionId}` : null);
  const [cell, setCell] = useState<{ day: number; p: TTPeriod } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const sections = structure?.classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, label: className(c, s) }))) ?? [];

  useEffect(() => {
    if (!sectionId && sections.length) setSectionId(sections[0].id);
  }, [sections, sectionId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select
          className="input w-auto"
          value={sectionId}
          onChange={(e) => {
            setSectionId(e.target.value);
            router.replace(`/school/timetable?tab=classes&section=${e.target.value}`);
          }}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {editable && data && (
          <>
            <Button variant="secondary" onClick={() => setCopyOpen(true)}>
              Copy from another class
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                if (!confirm('Clear the whole timetable of this class?')) return;
                await api.post(`/timetable/sections/${sectionId}/clear`);
                toast('Cleared');
                reload();
              }}
            >
              Clear all
            </Button>
          </>
        )}
        {data && (
          <Button variant="ghost" onClick={() => window.print()}>
            Print
          </Button>
        )}
      </div>
      {sections.length === 0 && <Empty title="No classes yet" />}
      <ErrorBox error={error} />
      {loading && !data && sectionId ? <Loading /> : null}
      {data && (
        <>
          <Card title={`${className(data.section.class, data.section)}${data.section.classTeacher ? ` · Class teacher: ${data.section.classTeacher.fullName}` : ''}`}>
            <TimetableGrid week={data.week} mode="class" onCellClick={editable ? (day, p) => setCell({ day, p }) : undefined} />
            {editable && <p className="mt-3 text-xs text-gray-500 print:hidden">Click a cell to choose the subject and teacher. A teacher cannot be in two classes at the same time.</p>}
          </Card>
          <Card title="Periods a week by subject" className="print:hidden">
            {data.subjects.length === 0 ? (
              <p className="text-sm text-gray-500">
                No subjects are linked to this class.{' '}
                <Link href="/school/setup?tab=subjects" className="text-brand-700 underline">
                  Choose subjects
                </Link>
              </p>
            ) : (
              <Table head={['Subject', 'Teacher', 'Periods a week']}>
                {data.subjects.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">
                      {s.name}
                      {s.isOptional && <span className="ml-1 text-xs text-gray-400">(optional)</span>}
                    </Td>
                    <Td className={s.teacher ? '' : 'text-amber-600'}>{s.teacher?.fullName ?? 'Not assigned'}</Td>
                    <Td>{s.periodsPerWeek}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          {cell && (
            <CellModal
              data={data}
              structureTeachers={structure?.teachers ?? []}
              day={cell.day}
              period={cell.p}
              onClose={() => setCell(null)}
              onSaved={(warning) => {
                setCell(null);
                if (warning) toast(warning, 'error');
                reload();
              }}
            />
          )}
          {copyOpen && (
            <CopyModal
              targetId={sectionId}
              sections={sections.filter((s) => s.id !== sectionId)}
              onClose={() => setCopyOpen(false)}
              onDone={() => {
                setCopyOpen(false);
                reload();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

const DAY_FULL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function CellModal({
  data,
  structureTeachers,
  day,
  period,
  onClose,
  onSaved,
}: {
  data: SectionTT;
  structureTeachers: { id: string; fullName: string }[];
  day: number;
  period: TTPeriod;
  onClose: () => void;
  onSaved: (warning: string | null) => void;
}) {
  const e = period.entries[0];
  const [subjectId, setSubjectId] = useState(e?.subject?.id ?? '');
  const [teacherId, setTeacherId] = useState(e?.teacher?.id ?? '');
  const [room, setRoom] = useState(e?.room ?? data.section.room ?? '');
  const [note, setNote] = useState(e?.note ?? '');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const busyHere = new Map(data.busy.filter((b) => b.day === day && b.periodId === period.id).map((b) => [b.teacherId, b.where]));

  async function save(clear = false) {
    setSaving(true);
    setError(null);
    try {
      const body = clear ? { day, periodId: period.id } : { day, periodId: period.id, subjectId: subjectId || null, teacherId: teacherId || null, room, note };
      const r = await api.put<{ warning: string | null }>(`/timetable/sections/${data.section.id}/slot`, body);
      onSaved(r.warning);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${DAY_FULL[day]} · ${period.name} (${t12(period.startTime)}–${t12(period.endTime)})`}>
      <div className="space-y-4">
        <Field label="Subject">
          <select
            className="input"
            value={subjectId}
            onChange={(ev) => {
              setSubjectId(ev.target.value);
              const assigned = data.subjects.find((s) => s.id === ev.target.value)?.teacher;
              if (assigned) setTeacherId(assigned.id);
            }}
          >
            <option value="">— No subject —</option>
            {data.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.periodsPerWeek}/week)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Teacher">
          <select className="input" value={teacherId} onChange={(ev) => setTeacherId(ev.target.value)}>
            <option value="">— No teacher —</option>
            {structureTeachers.map((t) => (
              <option key={t.id} value={t.id} disabled={busyHere.has(t.id)}>
                {t.fullName}
                {busyHere.has(t.id) ? ` — busy in ${busyHere.get(t.id)}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Room">
            <input className="input" value={room} onChange={(ev) => setRoom(ev.target.value)} />
          </Field>
          <Field label="Note" hint="e.g. Assembly, Library">
            <input className="input" value={note} onChange={(ev) => setNote(ev.target.value)} />
          </Field>
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-between">
          <Button onClick={() => save()} loading={saving}>
            Save
          </Button>
          {e && (
            <Button variant="ghost" className="text-red-600" onClick={() => save(true)}>
              Clear cell
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CopyModal({ targetId, sections, onClose, onDone }: { targetId: string; sections: { id: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState(sections[0]?.id ?? '');
  const [withTeachers, setWithTeachers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<string[] | null>(null);
  return (
    <Modal open onClose={onClose} title="Copy timetable from another class">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">This replaces the current timetable of this class. Subjects not taught in this class are left empty.</p>
        <Field label="Copy from">
          <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={withTeachers} onChange={(e) => setWithTeachers(e.target.checked)} />
          <span>
            Keep the same teachers
            <span className="block text-xs text-gray-500">Usually off: each subject gets this class’s own subject teacher.</span>
          </span>
        </label>
        {skipped && skipped.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            {skipped.length} cell(s) skipped:
            <ul className="mt-1 list-disc pl-4">
              {skipped.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        <Button
          loading={busy}
          disabled={!from}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ copied: number; skipped: string[] }>(`/timetable/sections/${targetId}/copy`, { fromSectionId: from, withTeachers });
              toast(`${r.copied} cell(s) copied`);
              if (r.skipped.length) setSkipped(r.skipped);
              else onDone();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Copy
        </Button>
        {skipped && (
          <Button variant="secondary" className="ml-2" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </Modal>
  );
}

// ---------- Teacher timetable ----------

function TeacherTab({ initial }: { initial: string }) {
  const router = useRouter();
  const { data: structure } = useData<Structure>('/setup/structure');
  const [teacherId, setTeacherId] = useState(initial);
  const { data, error, loading } = useData<{ teacher: { fullName: string }; week: TTDay[]; periodsPerWeek: number }>(teacherId ? `/timetable/teachers/${teacherId}` : null);
  useEffect(() => {
    if (!teacherId && structure?.teachers.length) setTeacherId(structure.teachers[0].id);
  }, [structure, teacherId]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <select
          className="input w-auto"
          value={teacherId}
          onChange={(e) => {
            setTeacherId(e.target.value);
            router.replace(`/school/timetable?tab=teachers&teacher=${e.target.value}`);
          }}
        >
          {structure?.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.fullName}
            </option>
          ))}
        </select>
        {data && (
          <Button variant="ghost" onClick={() => window.print()}>
            Print
          </Button>
        )}
      </div>
      {structure && structure.teachers.length === 0 && <Empty title="No teachers yet" />}
      <ErrorBox error={error} />
      {loading && !data && teacherId ? <Loading /> : null}
      {data && (
        <Card title={`${data.teacher.fullName} · ${data.periodsPerWeek} periods a week`}>
          <TimetableGrid week={data.week} mode="teacher" />
          <p className="mt-3 text-xs text-gray-500 print:hidden">Built automatically from the class timetables.</p>
        </Card>
      )}
    </div>
  );
}
