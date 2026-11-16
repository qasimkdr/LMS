'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Avatar } from '@/components/Avatar';
import { Button, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { todayLocal } from '@/components/lms/shared';
import { className } from '@/lib/types';
import { dateTime } from '@/lib/format';

interface Pass {
  id: string;
  passNo: number;
  student: { id: string; fullName: string; admissionNo: string; photoFileId: string | null; classLabel: string } | null;
  reason: string;
  pickedUpBy: string;
  relation: string;
  pickerPhone: string | null;
  leftAt: string;
  issuedBy: string;
  notifiedAt: string | null;
}

export default function GatePassPage() {
  const { me } = useAuth();
  const family = me?.user.role === 'PARENT' || me?.user.role === 'STUDENT';
  const [day, setDay] = useState(todayLocal());
  const { data, error, loading, reload } = useData<{ passes: Pass[]; canIssue: boolean }>(`/gate-passes${family ? '' : `?date=${day}`}`);
  const [issuing, setIssuing] = useState(false);
  const [slip, setSlip] = useState<Pass | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <PageHeader title={family ? 'Gate passes' : 'Gate pass'} subtitle={family ? 'Times your child left school early, and who picked them up.' : 'Record students leaving early. Parents are told at once.'} actions={data?.canIssue && <Button onClick={() => setIssuing(true)}>+ Issue gate pass</Button>} />
      {!family && (
        <div className="mb-4">
          <input className="input w-auto" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Date" />
        </div>
      )}
      {!data?.passes.length ? (
        <Empty title={family ? 'No early leaves' : 'No gate passes on this day'} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.passes.map((p, i) => (
            <li key={p.id} className="reveal" style={{ ['--i' as string]: i }}>
              <div className="lift relative overflow-hidden rounded-2xl border border-gray-200/70 bg-white p-4 shadow-sm">
                <div aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-amber-500" />
                <div className="flex items-start gap-3">
                  <Avatar fileId={p.student?.photoFileId ?? null} name={p.student?.fullName ?? '?'} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{p.student?.fullName}</span>
                      <span className="rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">#{p.passNo}</span>
                    </div>
                    <div className="text-xs text-gray-500">{p.student?.classLabel}</div>
                    <div className="mt-2 text-sm">
                      Left at <b>{new Date(p.leftAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</b> with <b>{p.pickedUpBy}</b> ({p.relation})
                    </div>
                    <div className="text-sm text-gray-600">Reason: {p.reason}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                      <span>
                        {dateTime(p.leftAt)} · {p.issuedBy}
                        {p.notifiedAt && ' · parents told ✓'}
                      </span>
                      <button className="font-medium text-brand-600 hover:underline" onClick={() => setSlip(p)}>
                        Print slip
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {issuing && <Issue onClose={() => setIssuing(false)} onDone={reload} />}
      {slip && (
        <Modal open onClose={() => setSlip(null)} title={`Gate pass #${slip.passNo}`}>
          <div className="rounded-2xl border-2 border-dashed border-gray-300 p-5 text-sm print:border-gray-800">
            <div className="text-center">
              <div className="text-base font-bold">{me?.school?.name}</div>
              <div className="text-xs uppercase tracking-widest text-gray-500">Gate pass · early leave</div>
            </div>
            <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1.5">
              <dt className="text-gray-500">Pass no</dt>
              <dd className="font-semibold">#{slip.passNo}</dd>
              <dt className="text-gray-500">Student</dt>
              <dd className="font-semibold">{slip.student?.fullName}</dd>
              <dt className="text-gray-500">Class</dt>
              <dd>{slip.student?.classLabel}</dd>
              <dt className="text-gray-500">Adm. no</dt>
              <dd>{slip.student?.admissionNo}</dd>
              <dt className="text-gray-500">Left at</dt>
              <dd>{dateTime(slip.leftAt)}</dd>
              <dt className="text-gray-500">Picked up by</dt>
              <dd>
                {slip.pickedUpBy} ({slip.relation}) {slip.pickerPhone}
              </dd>
              <dt className="text-gray-500">Reason</dt>
              <dd>{slip.reason}</dd>
              <dt className="text-gray-500">Issued by</dt>
              <dd>{slip.issuedBy}</dd>
            </dl>
            <div className="mt-8 grid grid-cols-2 gap-6 text-center text-xs text-gray-500">
              <div className="border-t border-gray-400 pt-1">Gate keeper</div>
              <div className="border-t border-gray-400 pt-1">Received by</div>
            </div>
          </div>
          <Button className="mt-4 print:hidden" onClick={() => window.print()}>
            Print
          </Button>
        </Modal>
      )}
    </>
  );
}

function Issue({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const staffSearch = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('students.view');
  const [q, setQ] = useState('');
  const search = useData<{ students: { id: string; fullName: string; status: string; photoFileId: string | null; class: { name: string; stream: string | null }; section: { name: string } | null }[] }>(staffSearch && q.trim().length >= 2 ? `/search?q=${encodeURIComponent(q.trim())}` : null);
  const overview = useData<{ classTeacherOf: { id: string; name: string; class: { name: string; stream: string | null } }[] }>(!staffSearch ? '/my/overview' : null);
  const sectionId = overview.data?.classTeacherOf[0]?.id;
  const classList = useData<{ students: { id: string; fullName: string; rollNo: string | null; photoFileId: string | null }[] }>(!staffSearch && sectionId ? `/my/sections/${sectionId}/students` : null);
  const [student, setStudent] = useState<{ id: string; fullName: string } | null>(null);
  const [f, setF] = useState({ reason: '', pickedUpBy: '', relation: 'Father', pickerPhone: '' });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Issue gate pass" wide>
      <div className="space-y-4">
        {student ? (
          <div className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2 text-sm">
            <span className="font-medium">{student.fullName}</span>
            <button className="text-brand-700 hover:underline" onClick={() => setStudent(null)}>
              Change
            </button>
          </div>
        ) : staffSearch ? (
          <div>
            <Field label="Student">
              <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, admission or roll number" />
            </Field>
            <ul className="mt-1 max-h-48 overflow-y-auto">
              {search.data?.students
                .filter((s) => s.status === 'ACTIVE')
                .map((s) => (
                  <li key={s.id}>
                    <button className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-gray-50" onClick={() => setStudent(s)}>
                      <Avatar fileId={s.photoFileId} name={s.fullName} size={28} />
                      {s.fullName} <span className="text-xs text-gray-500">{className(s.class, s.section)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ) : !sectionId ? (
          <p className="text-sm text-gray-500">Only class teachers and office staff can issue gate passes.</p>
        ) : (
          <Field label="Student">
            <select className="input" value="" onChange={(e) => setStudent(classList.data?.students.find((s) => s.id === e.target.value) ?? null)}>
              <option value="">Choose…</option>
              {classList.data?.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.rollNo ? `${s.rollNo}. ` : ''}
                  {s.fullName}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Picked up by">
            <input className="input" value={f.pickedUpBy} onChange={(e) => setF({ ...f, pickedUpBy: e.target.value })} />
          </Field>
          <Field label="Relation">
            <input className="input" list="relations" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} />
            <datalist id="relations">
              {['Father', 'Mother', 'Brother', 'Sister', 'Uncle', 'Aunt', 'Grandfather', 'Grandmother', 'Driver'].map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
          <Field label="Phone (optional)">
            <input className="input" value={f.pickerPhone} onChange={(e) => setF({ ...f, pickerPhone: e.target.value })} />
          </Field>
        </div>
        <Field label="Reason">
          <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Fever, family function" />
        </Field>
        <Button
          loading={busy}
          disabled={!student || f.pickedUpBy.trim().length < 2 || f.reason.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ passNo: number; whatsapp: number }>('/gate-passes', { studentId: student!.id, ...f, pickerPhone: f.pickerPhone || null });
              toast(`Gate pass #${r.passNo} issued${r.whatsapp ? ' · parents told on WhatsApp' : ' · parents told in the app'}`);
              onDone();
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Issue and tell parents
        </Button>
      </div>
    </Modal>
  );
}
