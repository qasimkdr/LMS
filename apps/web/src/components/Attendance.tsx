'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from './useData';
import { useToast } from './toast';
import { Avatar } from './Avatar';
import { Badge, Button, Card, Empty, ErrorBox, Loading } from './ui';
import { className } from '@/lib/types';

export const STATUS = {
  PRESENT: { short: 'P', label: 'Present', on: 'bg-emerald-600 text-white border-emerald-600', cell: 'bg-emerald-100 text-emerald-800' },
  ABSENT: { short: 'A', label: 'Absent', on: 'bg-red-600 text-white border-red-600', cell: 'bg-red-100 text-red-800' },
  LATE: { short: 'L', label: 'Late', on: 'bg-amber-500 text-white border-amber-500', cell: 'bg-amber-100 text-amber-800' },
  LEAVE: { short: 'Lv', label: 'Leave', on: 'bg-sky-600 text-white border-sky-600', cell: 'bg-sky-100 text-sky-800' },
  HALF_DAY: { short: 'H', label: 'Half day', on: 'bg-teal-600 text-white border-teal-600', cell: 'bg-teal-100 text-teal-800' },
} as const;
export type Status = keyof typeof STATUS;
const ORDER: Status[] = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY'];

interface SheetData {
  section: { id: string; name: string; class: { name: string; stream: string | null } };
  date: string;
  today: string;
  isWorkingDay: boolean;
  canEdit: boolean;
  marked: boolean;
  markedAt: string | null;
  markedBy: string | null;
  alerts: { absent: string; late: string; whatsappReady: boolean; pending: number };
  students: { id: string; fullName: string; rollNo: string | null; admissionNo: string; photoFileId: string | null; status: Status | null; remark: string | null; alertSent: boolean }[];
}

/** Mark a section's attendance: everyone starts Present, tap to change. */
export function AttendanceSheet({ sectionId, date, onSaved }: { sectionId: string; date: string; onSaved?: () => void }) {
  const toast = useToast();
  const { data, error, loading, reload } = useData<SheetData>(`/attendance/sections/${sectionId}?date=${date}`);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!data) return;
    setMarks(Object.fromEntries(data.students.map((s) => [s.id, s.status ?? 'PRESENT'])));
    setRemarks(Object.fromEntries(data.students.map((s) => [s.id, s.remark ?? ''])));
  }, [data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of Object.values(marks)) c[v] = (c[v] ?? 0) + 1;
    return c;
  }, [marks]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const isPast = data.date < data.today;
  const editable = data.canEdit;

  async function save() {
    setSaving(true);
    try {
      const r = await api.put<{ whatsappQueued: number; notified: number }>(`/attendance/sections/${sectionId}`, {
        date,
        records: data!.students.map((s) => ({ studentId: s.id, status: marks[s.id], remark: remarks[s.id] || null })),
        reason: reason || undefined,
      });
      toast(`Attendance saved${r.whatsappQueued ? ` · ${r.whatsappQueued} WhatsApp alert(s) sent to parents` : r.notified ? ` · ${r.notified} parent(s) notified in the app` : ''}`);
      reload();
      onSaved?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function sendAlerts() {
    setSending(true);
    try {
      const r = await api.post<{ queued: number }>('/attendance/alerts', { sectionId });
      toast(r.queued ? `${r.queued} WhatsApp alert(s) sent` : 'No alerts to send');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {className(data.section.class, data.section)}
          {data.marked ? <Badge tone="green">Marked{data.markedBy ? ` by ${data.markedBy}` : ''}</Badge> : <Badge tone="amber">Not marked yet</Badge>}
        </span>
      }
    >
      {!data.isWorkingDay && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is not a working day.</div>}
      {!editable && <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{isPast ? 'Only the principal can change attendance of past days.' : 'You can view this attendance but not change it.'}</div>}
      {data.students.length === 0 ? (
        <Empty title="No students in this section" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {ORDER.map((s) => (
              <span key={s} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[s].cell}`}>
                {STATUS[s].label}: {counts[s] ?? 0}
              </span>
            ))}
            {editable && (
              <Button variant="ghost" className="ml-auto" onClick={() => setMarks(Object.fromEntries(data.students.map((s) => [s.id, 'PRESENT'])))}>
                Mark all present
              </Button>
            )}
          </div>
          <ul className="divide-y divide-gray-100">
            {data.students.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="w-8 shrink-0 text-right text-xs text-gray-400">{s.rollNo ?? ''}</span>
                  <Avatar fileId={s.photoFileId} name={s.fullName} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.fullName}</span>
                    {s.alertSent && <span className="text-[11px] text-emerald-700">Parents alerted on WhatsApp</span>}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1 pl-11 sm:pl-0">
                  {ORDER.map((st) => (
                    <button
                      key={st}
                      type="button"
                      disabled={!editable}
                      onClick={() => setMarks({ ...marks, [s.id]: st })}
                      title={STATUS[st].label}
                      className={`h-9 min-w-9 rounded-lg border px-2 text-sm font-semibold transition disabled:cursor-default ${marks[s.id] === st ? STATUS[st].on : 'border-gray-200 bg-white text-gray-500 hover:border-gray-400'}`}
                    >
                      {STATUS[st].short}
                    </button>
                  ))}
                  {editable && marks[s.id] !== 'PRESENT' && (
                    <input className="input ml-1 w-36 py-1.5 text-xs" placeholder="Remark (optional)" value={remarks[s.id] ?? ''} onChange={(e) => setRemarks({ ...remarks, [s.id]: e.target.value })} />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {editable && (
            <div className="sticky bottom-0 -mx-5 mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 bg-white/95 px-5 py-3 backdrop-blur">
              {isPast && <input className="input max-w-xs" placeholder="Reason for changing a past day" value={reason} onChange={(e) => setReason(e.target.value)} />}
              <Button onClick={save} loading={saving}>
                {data.marked ? 'Save changes' : 'Save attendance'}
              </Button>
              {data.date === data.today && (
                <span className="text-xs text-gray-500">
                  {!data.alerts.whatsappReady
                    ? 'Parents of absent students are notified in the app.'
                    : data.alerts.absent === 'auto'
                      ? 'Parents of absent students get a WhatsApp message when you save.'
                      : data.alerts.absent === 'manual'
                        ? 'WhatsApp alerts are sent when you press "Send alerts".'
                        : 'WhatsApp absent alerts are switched off.'}
                </span>
              )}
              {data.alerts.whatsappReady && data.alerts.pending > 0 && data.alerts.absent === 'manual' && (
                <Button variant="secondary" onClick={sendAlerts} loading={sending}>
                  Send alerts ({data.alerts.pending})
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Month calendar with a coloured status per day (student profile, parent view). */
export function AttendanceCalendar({ month, days, onMonth }: { month: string; days: { date: string; status: Status }[]; onMonth?: (m: string) => void }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const map = new Map(days.map((d) => [d.date, d.status]));
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        {onMonth ? (
          <button className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100" onClick={() => onMonth(shift(-1))} aria-label="Previous month">
            ‹
          </button>
        ) : (
          <span />
        )}
        <span className="text-sm font-semibold">{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
        {onMonth ? (
          <button className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100" onClick={() => onMonth(shift(1))} aria-label="Next month">
            ›
          </button>
        ) : (
          <span />
        )}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="py-1 font-medium text-gray-400">
            {d}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`e${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          const st = map.get(date);
          return (
            <div key={date} title={st ? STATUS[st].label : undefined} className={`flex aspect-square flex-col items-center justify-center rounded-lg ${st ? STATUS[st].cell : 'text-gray-400'}`}>
              <span className="font-medium">{i + 1}</span>
              {st && <span className="text-[10px] font-semibold">{STATUS[st].short}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {ORDER.map((s) => (
        <span key={s} className={`rounded px-2 py-0.5 font-medium ${STATUS[s].cell}`}>
          {STATUS[s].short} = {STATUS[s].label}
        </span>
      ))}
    </div>
  );
}
