'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Avatar } from '@/components/Avatar';
import { Badge, Button, ErrorBox, Loading } from '@/components/ui';
import { CATEGORY_LABEL, categoryTone, type RemarkCategory } from '@/components/progress/Remarks';
import { date, money } from '@/lib/format';

interface ReportData {
  student: { fullName: string; classLabel: string; rollNo: string | null; admissionNo: string; photoFileId: string | null };
  schoolName: string;
  periodLabel: string;
  attendance: { present: number; absent: number; late: number; leave: number; halfDay: number; days: number; percent: number } | null;
  tests: { title: string; type: string; kind: string; date: string; obtained: number; total: number; percent: number; grade: string; passed: boolean; positionSection: number | null }[];
  average: number | null;
  previousAverage: number | null;
  sectionAverage: number | null;
  fees: { billed: number; paid: number; balance: number } | null;
  remarks: { date: string; category: RemarkCategory; text: string; by: string }[];
  honors: { name: string; icon: string; period: string }[];
}
interface Detail {
  report: { id: string; period: string; status: string; sentAt: string | null; comment: string | null; commentBy: string | null; data: ReportData };
  canComment: boolean;
}

function Box({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 print:p-2">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : ''}`}>{value}</div>
      {hint && <div className="text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export default function MonthlyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const { data, error, loading, reload } = useData<Detail>(`/monthly-reports/${id}`);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setComment(data?.report.comment ?? ''), [data]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const { report, canComment } = data;
  const d = report.data;
  const currency = me?.school?.currency ?? 'PKR';
  const trend = d.average !== null && d.previousAverage !== null ? Math.round((d.average - d.previousAverage) * 10) / 10 : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={() => router.back()} className="text-sm text-brand-700 hover:underline">
          ← Back
        </button>
        <div className="flex items-center gap-2">
          {report.status === 'SENT' ? <Badge tone="green">Sent {date(report.sentAt)}</Badge> : <Badge tone="amber">Draft – not sent yet</Badge>}
          <Button variant="secondary" onClick={() => window.print()}>
            Print / save PDF
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-[210mm] rounded-xl bg-white p-6 text-gray-900 shadow-sm sm:p-8 print:rounded-none print:p-0 print:shadow-none">
        <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-brand-700">{d.schoolName}</div>
            <h1 className="text-xl font-bold sm:text-2xl">Monthly progress report</h1>
            <div className="text-gray-600">{d.periodLabel}</div>
          </div>
          <div className="flex flex-row-reverse items-center justify-end gap-3 sm:flex-row sm:text-right">
            <div>
              <div className="font-semibold">{d.student.fullName}</div>
              <div className="text-sm text-gray-600">{d.student.classLabel}</div>
              <div className="text-xs text-gray-500">
                {d.student.rollNo && `Roll ${d.student.rollNo} · `}Adm. {d.student.admissionNo}
              </div>
            </div>
            <Avatar fileId={d.student.photoFileId} name={d.student.fullName} size={56} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Box label="Attendance" value={d.attendance?.days ? `${d.attendance.percent}%` : '—'} hint={d.attendance?.days ? `${d.attendance.present + d.attendance.late} of ${d.attendance.days} days` : 'Not marked'} tone={d.attendance?.days ? (d.attendance.percent >= 90 ? 'good' : d.attendance.percent < 75 ? 'bad' : undefined) : undefined} />
          <Box label="Test average" value={d.average === null ? '—' : `${d.average}%`} hint={trend === null ? (d.tests.length ? `${d.tests.length} result(s)` : 'No tests') : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend)} from last month`} tone={trend === null ? undefined : trend >= 0 ? 'good' : 'bad'} />
          <Box label="Class average" value={d.sectionAverage === null ? '—' : `${d.sectionAverage}%`} />
          {d.fees ? <Box label="Fee balance" value={d.fees.balance > 0 ? money(d.fees.balance, currency) : 'Clear'} hint={d.fees.billed ? `This month: ${money(d.fees.paid, currency)} paid of ${money(d.fees.billed, currency)}` : undefined} tone={d.fees.balance > 0 ? 'bad' : 'good'} /> : <Box label="Remarks" value={String(d.remarks.length)} />}
        </div>

        {d.honors.length > 0 && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            {d.honors.map((h, i) => (
              <div key={i} className="flex items-center gap-3 text-amber-900">
                <span className="text-2xl">{h.icon}</span>
                <span>
                  Awarded <b>{h.name}</b> · {h.period}
                </span>
              </div>
            ))}
          </div>
        )}

        {d.attendance && d.attendance.days > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 font-semibold">Attendance</h2>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Present: {d.attendance.present}</span>
              <span>Late: {d.attendance.late}</span>
              <span>Absent: {d.attendance.absent}</span>
              <span>Leave: {d.attendance.leave}</span>
              {d.attendance.halfDay > 0 && <span>Half day: {d.attendance.halfDay}</span>}
            </div>
          </section>
        )}

        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Tests and exams</h2>
          {!d.tests.length ? (
            <p className="text-sm text-gray-500">No results were published this month.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Test</th>
                    <th className="py-2 pr-3 text-right">Marks</th>
                    <th className="py-2 pr-3 text-right">%</th>
                    <th className="py-2 pr-3">Grade</th>
                    <th className="py-2">Position</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {d.tests.map((t, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap py-2 pr-3">{date(t.date)}</td>
                      <td className="py-2 pr-3">
                        {t.title}
                        <span className="block text-xs text-gray-500">{t.type}</span>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {t.obtained} / {t.total}
                      </td>
                      <td className={`py-2 pr-3 text-right ${t.passed ? '' : 'font-semibold text-red-600'}`}>{t.percent}</td>
                      <td className="py-2 pr-3">{t.grade}</td>
                      <td className="py-2">{t.positionSection ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Teachers’ remarks</h2>
          {!d.remarks.length ? (
            <p className="text-sm text-gray-500">No remarks this month.</p>
          ) : (
            <ul className="space-y-2">
              {d.remarks.map((r, i) => (
                <li key={i} className="text-sm">
                  <Badge tone={categoryTone[r.category]}>{CATEGORY_LABEL[r.category]}</Badge> <span className="text-xs text-gray-500">{date(r.date)} · {r.by}</span>
                  <p className="mt-0.5 whitespace-pre-wrap">{r.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 border-t border-gray-200 pt-4">
          <h2 className="mb-2 font-semibold">Class teacher’s comment</h2>
          {canComment ? (
            <div className="print:hidden">
              <textarea className="input min-h-20" value={comment} maxLength={600} onChange={(e) => setComment(e.target.value)} placeholder="A short comment for the parents about this month" />
              <Button
                className="mt-2"
                loading={saving}
                disabled={comment === (report.comment ?? '')}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await api.put(`/monthly-reports/${id}/comment`, { comment });
                    toast('Comment saved');
                    reload();
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Failed', 'error');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Save comment
              </Button>
            </div>
          ) : null}
          <div className={canComment ? 'hidden print:block' : ''}>
            {report.comment ? (
              <p className="whitespace-pre-wrap text-sm">
                {report.comment}
                {report.commentBy && <span className="mt-1 block text-xs text-gray-500">— {report.commentBy}</span>}
              </p>
            ) : (
              <p className="text-sm text-gray-500">—</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
