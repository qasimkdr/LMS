'use client';

import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { CountUp, KpiCard } from '@/components/fx';
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, PageHeader, type Tone } from '@/components/ui';
import { todayLocal } from '@/components/lms/shared';
import { className } from '@/lib/types';
import { date, dateTime } from '@/lib/format';

interface Enquiry {
  id: string;
  enquiryNo: number;
  childName: string;
  gender: string | null;
  dob: string | null;
  classId: string | null;
  classLabel: string | null;
  parentName: string;
  relation: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  previousSchool: string | null;
  source: string;
  stage: string;
  followUpDate: string | null;
  testAt: string | null;
  testMarks: number | null;
  testTotal: number | null;
  testRemarks: string | null;
  lostReason: string | null;
  studentId: string | null;
  createdAt: string;
}
interface ListData {
  enquiries: Enquiry[];
  counts: Record<string, number>;
  due: number;
  month: { enquiries: number; admitted: number; bySource: Record<string, number> };
}

const STAGE: Record<string, { label: string; tone: Tone; bar: string }> = {
  NEW: { label: 'New', tone: 'blue', bar: 'from-brand-400 to-brand-600' },
  FOLLOW_UP: { label: 'Following up', tone: 'amber', bar: 'from-amber-400 to-orange-500' },
  TEST: { label: 'Test / interview', tone: 'blue', bar: 'from-teal-400 to-teal-500' },
  PASSED: { label: 'Passed', tone: 'green', bar: 'from-emerald-400 to-teal-500' },
  WAITLIST: { label: 'Waiting list', tone: 'gray', bar: 'from-gray-300 to-gray-400' },
  FAILED: { label: 'Not passed', tone: 'red', bar: 'from-rose-400 to-red-500' },
  ADMITTED: { label: 'Admitted', tone: 'green', bar: 'from-emerald-500 to-green-600' },
  LOST: { label: 'Not joining', tone: 'gray', bar: 'from-gray-300 to-gray-400' },
};
const BOARD = ['NEW', 'FOLLOW_UP', 'TEST', 'PASSED', 'WAITLIST'];
const SOURCE: Record<string, string> = { WALK_IN: 'Walk-in', REFERRAL: 'Referral', BANNER: 'Banner / flyer', SOCIAL: 'Social media', WEBSITE: 'Website', NEWSPAPER: 'Newspaper', OTHER: 'Other' };

export default function AdmissionsPage() {
  const [view, setView] = useState<'board' | 'ADMITTED' | 'CLOSED'>('board');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useData<ListData>(`/admissions/enquiries${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const today = todayLocal();
  const conv = data.month.enquiries ? Math.round((data.month.admitted / data.month.enquiries) * 100) : 0;
  const topSource = Object.entries(data.month.bySource).sort((a, b) => b[1] - a[1])[0];
  const card = (e: Enquiry, i: number) => {
    const overdue = e.followUpDate && e.followUpDate <= today && BOARD.includes(e.stage);
    return (
      <button key={e.id} onClick={() => setOpen(e.id)} className="reveal lift group relative w-full overflow-hidden rounded-2xl border border-gray-200/70 bg-white p-3.5 text-left shadow-sm" style={{ '--i': i } as CSSProperties}>
        <span className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${STAGE[e.stage].bar}`} />
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold leading-tight">{e.childName}</span>
          <span className="text-[10px] text-gray-400">#{e.enquiryNo}</span>
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {e.classLabel ?? 'Class not chosen'} · {e.parentName}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{SOURCE[e.source]}</span>
          {e.followUpDate && <span className={`rounded-full px-2 py-0.5 ${overdue ? 'animate-pulse bg-rose-100 font-semibold text-rose-700' : 'bg-amber-50 text-amber-800'}`}>↻ {date(e.followUpDate)}</span>}
          {e.testAt && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-700">✎ {e.testMarks !== null ? `${e.testMarks}/${e.testTotal ?? '?'}` : date(e.testAt)}</span>}
        </div>
      </button>
    );
  };
  return (
    <>
      <PageHeader title="Admissions" subtitle="Every enquiry from first call to admission. Follow up, test, then admit with one click." actions={<Button onClick={() => setCreating(true)}>+ New enquiry</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard i={0} label="Enquiries this month" icon="✦" tone="blue" value={<CountUp value={data.month.enquiries} />} hint={topSource && topSource[1] ? `Most from ${SOURCE[topSource[0]].toLowerCase()}` : undefined} />
        <KpiCard i={1} label="Admitted this month" icon="✓" tone="emerald" value={<CountUp value={data.month.admitted} />} hint={`${conv}% of this month's enquiries`} />
        <KpiCard i={2} label="Follow-ups due" icon="↻" tone="rose" value={<CountUp value={data.due} />} hint="today or overdue" />
        <KpiCard i={3} label="In the pipeline" icon="⇢" tone="teal" value={<CountUp value={BOARD.reduce((s, k) => s + (data.counts[k] ?? 0), 0)} />} hint={`${data.counts.ADMITTED ?? 0} admitted in total`} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ['board', 'Pipeline'],
            ['ADMITTED', `Admitted (${data.counts.ADMITTED ?? 0})`],
            ['CLOSED', `Closed (${(data.counts.LOST ?? 0) + (data.counts.FAILED ?? 0)})`],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${view === k ? 'bg-gray-900 text-white shadow' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {l}
          </button>
        ))}
        <input className="input ml-auto w-full sm:w-64" placeholder="Search child, parent or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {view === 'board' ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="grid min-w-[60rem] grid-cols-5 gap-4">
            {BOARD.map((stage) => {
              const list = data.enquiries.filter((e) => e.stage === stage);
              return (
                <section key={stage} className="rounded-2xl bg-gray-100/70 p-2.5">
                  <header className="mb-2 flex items-center justify-between px-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${STAGE[stage].bar}`} />
                      {STAGE[stage].label}
                    </span>
                    <span className="rounded-full bg-white px-2 text-xs font-medium text-gray-500 shadow-sm">{list.length}</span>
                  </header>
                  <div className="space-y-2.5">{list.length ? list.map(card) : <p className="px-1 py-6 text-center text-xs text-gray-400">Nothing here</p>}</div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        (() => {
          const list = data.enquiries.filter((e) => (view === 'ADMITTED' ? e.stage === 'ADMITTED' : e.stage === 'LOST' || e.stage === 'FAILED'));
          return !list.length ? <Empty title="Nothing here yet" /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map(card)}</div>;
        })()
      )}
      {creating && <EnquiryForm onClose={() => setCreating(false)} onSaved={reload} />}
      {open && <Detail id={open} onClose={() => setOpen(null)} onChange={reload} />}
    </>
  );
}

function EnquiryForm({ value, onClose, onSaved }: { value?: Enquiry; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: structure } = useData<{ classes: { id: string; name: string; stream: string | null }[] }>('/setup/structure');
  const [f, setF] = useState({
    childName: value?.childName ?? '',
    gender: value?.gender ?? '',
    dob: value?.dob ?? '',
    classId: value?.classId ?? '',
    parentName: value?.parentName ?? '',
    relation: value?.relation ?? 'FATHER',
    phone: value?.phone ?? '',
    email: value?.email ?? '',
    address: value?.address ?? '',
    previousSchool: value?.previousSchool ?? '',
    source: value?.source ?? 'WALK_IN',
    followUpDate: value?.followUpDate ?? '',
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={value ? `Edit enquiry #${value.enquiryNo}` : 'New enquiry'} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Child's name *">
          <input className="input" value={f.childName} onChange={set('childName')} autoFocus />
        </Field>
        <Field label="Class wanted">
          <select className="input" value={f.classId} onChange={set('classId')}>
            <option value="">Not sure yet</option>
            {structure?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {className(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gender">
          <select className="input" value={f.gender} onChange={set('gender')}>
            <option value="">—</option>
            <option value="MALE">Boy</option>
            <option value="FEMALE">Girl</option>
          </select>
        </Field>
        <Field label="Date of birth">
          <input className="input" type="date" value={f.dob} onChange={set('dob')} />
        </Field>
        <Field label="Parent's name *">
          <input className="input" value={f.parentName} onChange={set('parentName')} />
        </Field>
        <Field label="Relation">
          <select className="input" value={f.relation} onChange={set('relation')}>
            <option value="FATHER">Father</option>
            <option value="MOTHER">Mother</option>
            <option value="GUARDIAN">Guardian</option>
          </select>
        </Field>
        <Field label="Phone / WhatsApp *">
          <input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Previous school">
          <input className="input" value={f.previousSchool} onChange={set('previousSchool')} />
        </Field>
        <Field label="How did they hear about us?">
          <select className="input" value={f.source} onChange={set('source')}>
            {Object.entries(SOURCE).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address">
            <input className="input" value={f.address} onChange={set('address')} />
          </Field>
        </div>
        <Field label="Next follow-up">
          <input className="input" type="date" value={f.followUpDate} onChange={set('followUpDate')} />
        </Field>
        {!value && (
          <Field label="Note (optional)">
            <input className="input" value={f.note} onChange={set('note')} placeholder="e.g. Wants to visit on Saturday" />
          </Field>
        )}
      </div>
      <Button
        className="mt-4"
        loading={busy}
        disabled={f.childName.trim().length < 2 || f.parentName.trim().length < 2 || f.phone.trim().length < 7}
        onClick={async () => {
          setBusy(true);
          const body = { ...f, gender: f.gender || null, dob: f.dob || null, classId: f.classId || null, email: f.email || null, followUpDate: f.followUpDate || null, note: f.note || null };
          try {
            if (value) {
              const { note: _n, ...rest } = body;
              await api.patch(`/admissions/enquiries/${value.id}`, rest);
            } else await api.post('/admissions/enquiries', body);
            toast('Enquiry saved');
            onSaved();
            onClose();
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Failed', 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        {value ? 'Save' : 'Add enquiry'}
      </Button>
    </Modal>
  );
}

function Detail({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const { data, reload } = useData<{ enquiry: Enquiry; notes: { id: string; text: string; author: string; createdAt: string }[] }>(`/admissions/enquiries/${id}`);
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [editing, setEditing] = useState(false);
  const [test, setTest] = useState<{ at: string; total: string; marks: string; remarks: string } | null>(null);
  const refresh = () => {
    reload();
    onChange();
  };
  const patch = async (body: object, msg = 'Updated') => {
    try {
      await api.patch(`/admissions/enquiries/${id}`, body);
      toast(msg);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };
  if (!data) return null;
  const e = data.enquiry;
  if (editing) return <EnquiryForm value={e} onClose={() => setEditing(false)} onSaved={refresh} />;
  const t = test ?? { at: e.testAt ? new Date(new Date(e.testAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '', total: e.testTotal?.toString() ?? '', marks: e.testMarks?.toString() ?? '', remarks: e.testRemarks ?? '' };
  const closed = e.stage === 'ADMITTED';
  return (
    <Modal open onClose={onClose} title={`${e.childName} · enquiry #${e.enquiryNo}`} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STAGE[e.stage].tone}>{STAGE[e.stage].label}</Badge>
          <span className="text-sm text-gray-500">
            {e.classLabel ?? 'Class not chosen'} · {SOURCE[e.source]} · added {date(e.createdAt)}
          </span>
          {!closed && (
            <button className="ml-auto text-sm text-brand-700 hover:underline" onClick={() => setEditing(true)}>
              Edit details
            </button>
          )}
        </div>
        <div className="grid gap-3 rounded-2xl bg-gray-50 p-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-gray-500">Parent</div>
            {e.parentName} {e.relation && <span className="text-gray-400">({e.relation.toLowerCase()})</span>}
          </div>
          <div>
            <div className="text-xs text-gray-500">Phone</div>
            <a href={`tel:${e.phone}`} className="text-brand-700 hover:underline">
              {e.phone}
            </a>
            {' · '}
            <a href={`https://wa.me/${e.phone.replace(/\D/g, '').replace(/^0/, '92')}`} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
              WhatsApp
            </a>
          </div>
          {e.dob && (
            <div>
              <div className="text-xs text-gray-500">Date of birth</div>
              {date(e.dob)}
            </div>
          )}
          {e.previousSchool && (
            <div>
              <div className="text-xs text-gray-500">Previous school</div>
              {e.previousSchool}
            </div>
          )}
        </div>

        {closed ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-100">
            ✓ Admitted.
            {e.studentId && (
              <Link href={`/school/students/${e.studentId}`} className="font-semibold underline">
                Open student profile
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Link href={`/school/students/new?enquiry=${e.id}`}>
                <Button>✓ Admit now</Button>
              </Link>
              {(['FOLLOW_UP', 'PASSED', 'WAITLIST', 'FAILED'] as const)
                .filter((s) => s !== e.stage)
                .map((s) => (
                  <Button key={s} variant="secondary" onClick={() => patch({ stage: s }, `Moved to ${STAGE[s].label}`)}>
                    {STAGE[s].label}
                  </Button>
                ))}
              <Button variant="ghost" className="text-gray-500" onClick={() => { const reason = prompt('Why are they not joining? (optional)'); if (reason !== null) patch({ stage: 'LOST', lostReason: reason || null }, 'Marked as not joining'); }}>
                Not joining
              </Button>
            </div>
            <div className="rounded-2xl border border-teal-100 bg-teal-50/40 p-4">
              <div className="mb-3 text-sm font-semibold text-teal-900">Admission test / interview</div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Date & time">
                  <input className="input" type="datetime-local" value={t.at} onChange={(x) => setTest({ ...t, at: x.target.value })} />
                </Field>
                <Field label="Total marks">
                  <input className="input" type="number" min={1} value={t.total} onChange={(x) => setTest({ ...t, total: x.target.value })} />
                </Field>
                <Field label="Marks got">
                  <input className="input" type="number" min={0} value={t.marks} onChange={(x) => setTest({ ...t, marks: x.target.value })} />
                </Field>
                <Field label="Remarks">
                  <input className="input" value={t.remarks} onChange={(x) => setTest({ ...t, remarks: x.target.value })} />
                </Field>
              </div>
              {test && (
                <Button
                  className="mt-3"
                  variant="secondary"
                  onClick={async () => {
                    await patch({ testAt: t.at ? new Date(t.at).toISOString() : null, testTotal: t.total ? Number(t.total) : null, testMarks: t.marks ? Number(t.marks) : null, testRemarks: t.remarks || null }, 'Test saved');
                    setTest(null);
                  }}
                >
                  Save test
                </Button>
              )}
            </div>
          </>
        )}

        <div>
          <div className="mb-2 text-sm font-semibold">Follow-up notes</div>
          {!closed && (
            <div className="mb-3 flex flex-wrap gap-2">
              <input className="input min-w-48 flex-1" value={note} onChange={(x) => setNote(x.target.value)} placeholder="e.g. Called, will visit on Monday" />
              <input className="input w-auto" type="date" value={next} onChange={(x) => setNext(x.target.value)} aria-label="Next follow-up" title="Next follow-up" />
              <Button
                disabled={!note.trim()}
                onClick={async () => {
                  await api.post(`/admissions/enquiries/${id}/notes`, { text: note, followUpDate: next || undefined });
                  setNote('');
                  setNext('');
                  toast('Note added');
                  refresh();
                }}
              >
                Add
              </Button>
            </div>
          )}
          {e.followUpDate && !closed && <p className="mb-2 text-xs text-amber-700">Next follow-up: {date(e.followUpDate)}</p>}
          <ol className="relative space-y-3 border-l-2 border-gray-100 pl-5">
            {data.notes.map((n) => (
              <li key={n.id} className="relative animate-fade-up text-sm">
                <span className="absolute -left-[1.6rem] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-amber-500 shadow" />
                <p>{n.text}</p>
                <div className="text-xs text-gray-400">
                  {n.author} · {dateTime(n.createdAt)}
                </div>
              </li>
            ))}
            {!data.notes.length && <li className="text-sm text-gray-400">No notes yet.</li>}
          </ol>
        </div>
        {!closed && !e.studentId && (
          <button
            className="text-xs text-red-600 hover:underline"
            onClick={async () => {
              if (!confirm('Delete this enquiry?')) return;
              await api.del(`/admissions/enquiries/${id}`);
              onChange();
              onClose();
            }}
          >
            Delete enquiry
          </button>
        )}
      </div>
    </Modal>
  );
}
