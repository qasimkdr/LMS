'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Field, Loading, Modal } from '@/components/ui';
import { Gauge } from '@/components/fx';
import { todayLocal } from '@/components/lms/shared';
import { date, money } from '@/lib/format';

/** Start the leaving process for a student. */
export function LeaveSchool({ studentId, name, onClose }: { studentId: string; name: string; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [day, setDay] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`${name} is leaving the school`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Next, all fee dues must be paid (or waived by the principal). Then the School Leaving Certificate is issued and the student is marked as Left.</p>
        <Field label="Reason for leaving">
          <input className="input" list="leave-reasons" value={reason} onChange={(e) => setReason(e.target.value)} />
          <datalist id="leave-reasons">
            {['Family moving to another city', 'Admission in another school', 'Completed studies', 'Financial reasons', 'Health reasons'].map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        <Field label="Leaving date">
          <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Button
          loading={busy}
          disabled={reason.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ id: string }>('/withdrawals', { studentId, reason, leavingDate: day });
              toast('Leaving process started');
              router.push(`/withdrawals?id=${r.id}`);
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed', 'error');
              setBusy(false);
            }
          }}
        >
          Start leaving process
        </Button>
      </div>
    </Modal>
  );
}

interface History {
  student: { admissionDate: string | null; status: string; statusDate: string | null; statusReason: string | null };
  sessions: {
    session: { id: string; name: string; current: boolean };
    classLabel: string;
    outcome: string | null;
    attendance: { percent: number | null; days: number };
    exams: { id: string; title: string; percent: number; grade: string; position: number | null; passed: boolean }[];
    testAverage: number | null;
    feesPaid: number;
    honors: { name: string; icon: string; period: string }[];
  }[];
  remarks: number;
  leaving: { id: string; certificateNo: number | null; leavingDate: string | null } | null;
}
const OUTCOME: Record<string, { label: string; tone: 'green' | 'amber' | 'blue' }> = { PROMOTE: { label: 'Promoted', tone: 'green' }, RETAIN: { label: 'Stayed in class', tone: 'amber' }, GRADUATE: { label: 'Graduated', tone: 'blue' } };

/** "History" tab: the student's years at the school. */
export function StudentHistory({ studentId }: { studentId: string }) {
  const { me } = useAuth();
  const { data } = useData<History>(`/history/students/${studentId}`);
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 text-sm text-gray-600">
        <span>Admitted {data.student.admissionDate ? date(data.student.admissionDate) : '—'}</span>
        <span>· {data.remarks} remark(s) in total</span>
        {data.leaving && (
          <Link href={`/withdrawals/${data.leaving.id}/certificate`} className="font-medium text-brand-700 hover:underline">
            · Leaving certificate no. {data.leaving.certificateNo}
          </Link>
        )}
      </div>
      {!data.sessions.length ? (
        <p className="text-sm text-gray-500">No session history yet.</p>
      ) : (
        <ol className="relative space-y-5 border-l-2 border-dashed border-gray-200 pl-6">
          {data.sessions.map((s, i) => (
            <li key={s.session.id} className="reveal relative" style={{ '--i': i } as CSSProperties}>
              <span className={`absolute -left-[2.05rem] top-4 h-4 w-4 rounded-full border-4 border-white shadow ${s.session.current ? 'bg-brand-500' : 'bg-gray-300'}`} />
              <div className="lift rounded-2xl border border-gray-200/70 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{s.session.name}</span>
                  {s.session.current && <Badge tone="blue">Current</Badge>}
                  <span className="text-sm text-gray-600">· {s.classLabel}</span>
                  {s.outcome && <Badge tone={OUTCOME[s.outcome].tone}>{OUTCOME[s.outcome].label}</Badge>}
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-[auto_1fr]">
                  <div className="flex items-center gap-3">
                    <Gauge value={s.attendance.percent} size={68} stroke={7} color="#10b981" />
                    <div className="text-xs text-gray-500">
                      Attendance
                      <br />
                      {s.attendance.days} days marked
                    </div>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    {s.exams.map((e) => (
                      <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5">
                        <span>{e.title}</span>
                        <span className={e.passed ? 'font-semibold' : 'font-semibold text-rose-600'}>
                          {e.percent}% · {e.grade}
                          {e.position ? ` · pos. ${e.position}` : ''}
                        </span>
                      </div>
                    ))}
                    {!s.exams.length && <div className="text-gray-400">No term exams published</div>}
                    <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
                      {s.testAverage !== null && <span>Test average {s.testAverage}%</span>}
                      <span>Fees paid {money(s.feesPaid, me?.school?.currency)}</span>
                    </div>
                    {s.honors.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {s.honors.map((h, j) => (
                          <span key={j} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900 ring-1 ring-amber-200">
                            {h.icon} {h.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
