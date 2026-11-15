'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Tabs } from '@/components/Tabs';
import { AttendanceSheet, STATUS, StatusLegend, type Status } from '@/components/Attendance';
import { Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, Stat, Table, Td } from '@/components/ui';
import { className, type Structure } from '@/lib/types';

type Tab = 'today' | 'mark' | 'register' | 'low';

interface Today {
  date: string;
  today: string;
  totals: Record<string, number>;
  percent: number | null;
  notMarked: number;
  sections: { id: string; name: string; class: { name: string; stream: string | null }; classTeacher: string | null; students: number; marked: boolean; markedAt: string | null; counts: Record<string, number>; percent: number | null }[];
  absentees: { status: Status; alertSentAt: string | null; student?: { id: string; fullName: string; admissionNo: string; class: { name: string }; section: { name: string } | null } }[];
  alerts: { absent: string; late: string; whatsappReady: boolean; pending: number };
}

function AttendanceInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') as Tab) || 'today';
  const go = (t: Tab, extra = '') => router.replace(`/school/attendance?tab=${t}${extra}`);
  return (
    <>
      <PageHeader title="Attendance" subtitle="Daily attendance, monthly registers and low attendance" />
      <div className="print:hidden">
        <Tabs
          value={tab}
          onChange={(t) => go(t)}
          tabs={[
            { key: 'today', label: 'Today' },
            { key: 'mark', label: 'Mark / edit' },
            { key: 'register', label: 'Monthly register' },
            { key: 'low', label: 'Low attendance' },
          ]}
        />
      </div>
      {tab === 'today' && <TodayTab go={go} />}
      {tab === 'mark' && <MarkTab initialSection={params.get('section') ?? ''} initialDate={params.get('date') ?? ''} />}
      {tab === 'register' && <RegisterTab initialSection={params.get('section') ?? ''} />}
      {tab === 'low' && <LowTab />}
    </>
  );
}

export default function AttendancePage() {
  return (
    <Suspense fallback={<Loading />}>
      <AttendanceInner />
    </Suspense>
  );
}

function useSections() {
  const { data } = useData<Structure>('/setup/structure');
  return data?.classes.flatMap((c) => c.sections.filter((s) => s.studentCount > 0).map((s) => ({ id: s.id, label: className(c, s) }))) ?? null;
}

// ---------- Today ----------

function TodayTab({ go }: { go: (t: Tab, extra?: string) => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const [date, setDate] = useState('');
  const { data, error, loading, reload } = useData<Today>(`/attendance/today${date ? `?date=${date}` : ''}`);
  const [sending, setSending] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const canSend = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('attendance.manage') || me?.user.permissions.includes('messages.send');
  const t = data.totals;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date">
          <input className="input w-auto" type="date" max={data.today} value={date || data.date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Attendance" value={data.percent === null ? '—' : `${data.percent}%`} />
        <Stat label="Present" value={(t.PRESENT ?? 0) + (t.LATE ?? 0)} hint={t.LATE ? `incl. ${t.LATE} late` : undefined} />
        <Stat label="Absent" value={t.ABSENT ?? 0} />
        <Stat label="Leave" value={t.LEAVE ?? 0} />
        <Stat label="Classes not marked" value={data.notMarked} tone={data.notMarked ? 'down' : undefined} hint={data.notMarked ? 'still waiting' : 'all marked'} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Classes" className="lg:col-span-2">
          {data.sections.length === 0 ? (
            <Empty title="No classes with students" />
          ) : (
            <Table head={['Class', 'Class teacher', 'Present', 'Absent', '%', '']}>
              {data.sections.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium">{className(s.class, s)}</Td>
                  <Td className="text-gray-600">{s.classTeacher ?? '—'}</Td>
                  {s.marked ? (
                    <>
                      <Td>
                        {(s.counts.PRESENT ?? 0) + (s.counts.LATE ?? 0)}/{s.students}
                      </Td>
                      <Td className={s.counts.ABSENT ? 'text-red-600' : ''}>{s.counts.ABSENT ?? 0}</Td>
                      <Td>{s.percent}%</Td>
                    </>
                  ) : (
                    <td className="whitespace-nowrap px-5 py-3 text-amber-600" colSpan={3}>
                      Not marked
                    </td>
                  )}
                  <Td className="text-right">
                    <Button variant="ghost" onClick={() => go('mark', `&section=${s.id}&date=${data.date}`)}>
                      {s.marked ? 'View' : 'Mark'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card
          title={`Absent and late (${data.absentees.length})`}
          actions={
            canSend &&
            data.alerts.whatsappReady &&
            data.alerts.pending > 0 && (
              <Button
                variant="secondary"
                loading={sending}
                onClick={async () => {
                  setSending(true);
                  try {
                    const r = await api.post<{ queued: number }>('/attendance/alerts', {});
                    toast(r.queued ? `${r.queued} WhatsApp alert(s) sent` : 'Nothing to send (check alert settings)');
                    reload();
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Failed', 'error');
                  } finally {
                    setSending(false);
                  }
                }}
              >
                Send alerts ({data.alerts.pending})
              </Button>
            )
          }
        >
          {!data.alerts.whatsappReady && (
            <p className="mb-3 text-xs text-gray-500">
              WhatsApp is not connected, so parents are told in the app only.{' '}
              {me?.user.role === 'PRINCIPAL' && (
                <Link href="/school/whatsapp" className="text-brand-700 underline">
                  Connect WhatsApp
                </Link>
              )}
            </p>
          )}
          {data.absentees.length === 0 ? (
            <p className="text-sm text-gray-500">Nobody absent so far.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.absentees.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <Link href={`/school/students/${a.student?.id}`} className="block truncate font-medium hover:underline">
                      {a.student?.fullName}
                    </Link>
                    <span className="text-xs text-gray-500">
                      {a.student?.class.name} {a.student?.section?.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[a.status].cell}`}>{STATUS[a.status].label}</span>
                    {a.alertSentAt && <span className="text-[10px] text-emerald-700">WhatsApp sent</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- Mark ----------

function MarkTab({ initialSection, initialDate }: { initialSection: string; initialDate: string }) {
  const sections = useSections();
  const [sectionId, setSectionId] = useState(initialSection);
  const [date, setDate] = useState(initialDate);
  // Local date is fine here; the server rejects future dates in the school's time zone.
  const today = { today: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) };
  useEffect(() => {
    if (!sectionId && sections?.length) setSectionId(sections[0].id);
  }, [sections, sectionId]);
  useEffect(() => {
    if (!date && today) setDate(today.today);
  }, [today, date]);
  if (!sections || !date) return <Loading />;
  if (sections.length === 0) return <Empty title="No classes with students yet" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Field label="Class">
          <select className="input w-auto" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input className="input w-auto" type="date" max={today?.today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {sectionId && <AttendanceSheet key={`${sectionId}${date}`} sectionId={sectionId} date={date} />}
    </div>
  );
}

// ---------- Register ----------

interface Register {
  section: { name: string; class: { name: string; stream: string | null } };
  month: string;
  days: { date: string; weekday: number; working: boolean; marked: boolean }[];
  students: { id: string; fullName: string; rollNo: string | null; days: Record<string, Status>; counts: Record<string, number>; percent: number | null }[];
}

function RegisterTab({ initialSection }: { initialSection: string }) {
  const sections = useSections();
  const [sectionId, setSectionId] = useState(initialSection);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  useEffect(() => {
    if (!sectionId && sections?.length) setSectionId(sections[0].id);
  }, [sections, sectionId]);
  const { data, error, loading } = useData<Register>(sectionId ? `/attendance/register?sectionId=${sectionId}&month=${month}` : null);
  if (!sections) return <Loading />;
  if (sections.length === 0) return <Empty title="No classes with students yet" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label="Class">
          <select className="input w-auto" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Month">
          <input className="input w-auto" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <Button variant="secondary" onClick={() => window.print()}>
          Print register
        </Button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <Card title={`Attendance register · ${className(data.section.class, data.section)} · ${new Date(`${data.month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`}>
          <div className="mb-3 print:hidden">
            <StatusLegend />
          </div>
          <div className="-mx-5 overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left font-medium text-gray-500">Student</th>
                  {data.days.map((d) => (
                    <th key={d.date} className={`w-7 px-0.5 py-1.5 text-center font-medium ${d.working ? 'text-gray-600' : 'text-gray-300'}`}>
                      {Number(d.date.slice(8))}
                      <div className="text-[9px] font-normal">{['', 'M', 'T', 'W', 'T', 'F', 'S', 'S'][d.weekday]}</div>
                    </th>
                  ))}
                  {['P', 'A', 'L', 'Lv', '%'].map((h) => (
                    <th key={h} className="px-1.5 py-1.5 text-center font-semibold text-gray-600">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.students.map((s) => (
                  <tr key={s.id} className="border-t border-gray-100">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1">
                      <span className="mr-1 text-gray-400">{s.rollNo}</span>
                      {s.fullName}
                    </td>
                    {data.days.map((d) => {
                      const st = s.days[d.date];
                      return (
                        <td key={d.date} className={`px-0.5 py-1 text-center ${d.working ? '' : 'bg-gray-50'}`}>
                          {st && <span className={`inline-block w-6 rounded py-0.5 font-semibold ${STATUS[st].cell}`}>{STATUS[st].short}</span>}
                        </td>
                      );
                    })}
                    <td className="px-1.5 text-center">{s.counts.PRESENT ?? 0}</td>
                    <td className="px-1.5 text-center text-red-700">{s.counts.ABSENT ?? 0}</td>
                    <td className="px-1.5 text-center">{s.counts.LATE ?? 0}</td>
                    <td className="px-1.5 text-center">{s.counts.LEAVE ?? 0}</td>
                    <td className={`px-1.5 text-center font-semibold ${s.percent !== null && s.percent < 75 ? 'text-red-700' : ''}`}>{s.percent ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---------- Low attendance ----------

function LowTab() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [below, setBelow] = useState(75);
  const { data, error, loading } = useData<{
    sections: { id: string; name: string; class: { name: string; stream: string | null }; percent: number | null }[];
    lowAttendance: { id: string; percent: number; counts: Record<string, number>; student: { id: string; fullName: string; admissionNo: string; class: { name: string }; section: { name: string } | null } }[];
  }>(`/attendance/summary?month=${month}&below=${below}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Field label="Month">
          <input className="input w-auto" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <Field label="Below %">
          <input className="input w-24" type="number" min={1} max={100} value={below} onChange={(e) => setBelow(Number(e.target.value) || 75)} />
        </Field>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title={`Students below ${data && below}% (${data.lowAttendance.length})`} className="lg:col-span-2">
            {data.lowAttendance.length === 0 ? (
              <Empty title="No students below this level" />
            ) : (
              <Table head={['Student', 'Class', 'Absent', 'Late', '%']}>
                {data.lowAttendance.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <Link href={`/school/students/${l.student.id}?tab=attendance`} className="font-medium hover:underline">
                        {l.student.fullName}
                      </Link>
                    </Td>
                    <Td>
                      {l.student.class.name} {l.student.section?.name}
                    </Td>
                    <Td className="text-red-700">{l.counts.ABSENT ?? 0}</Td>
                    <Td>{l.counts.LATE ?? 0}</Td>
                    <Td className="font-semibold text-red-700">{l.percent}%</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          <Card title="Class-wise %">
            {data.sections.length === 0 ? (
              <p className="text-sm text-gray-500">No attendance this month.</p>
            ) : (
              <ul className="space-y-2">
                {data.sections.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 truncate">{className(s.class, s)}</span>
                    <span className="h-2 flex-1 rounded-full bg-gray-100">
                      <span className={`block h-2 rounded-full ${(s.percent ?? 0) < below ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${s.percent ?? 0}%` }} />
                    </span>
                    <span className="w-12 text-right text-xs text-gray-600">{s.percent}%</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
      <p className="text-xs text-gray-400">Attendance % counts present, late and half day (as half) out of all marked days.</p>
    </div>
  );
}
