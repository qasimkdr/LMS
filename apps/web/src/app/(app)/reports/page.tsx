'use client';

import { useState, type CSSProperties } from 'react';
import { useData } from '@/components/useData';
import { Tilt } from '@/components/fx';
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { todayLocal } from '@/components/lms/shared';
import { className } from '@/lib/types';

interface Report {
  key: string;
  group: string;
  title: string;
}
const ICON: Record<string, string> = { Students: '☺', Attendance: '✓', Fees: '₨', Academics: '✎', Communication: '✉' };
const TONE: Record<string, string> = { Students: 'from-brand-500 to-brand-600', Attendance: 'from-emerald-500 to-teal-600', Fees: 'from-amber-400 to-orange-500', Academics: 'from-teal-500 to-teal-600', Communication: 'from-rose-500 to-pink-600' };
const DESC: Record<string, string> = {
  students: 'Admission no, class, roll, date of birth, guardian and phone of every active student.',
  strength: 'Boys, girls and total in every section, with school totals.',
  'attendance-register': 'Day-by-day register (P / A / L / LV / H) for a section and month, with totals and %.',
  'low-attendance': 'Students below an attendance % in a date range.',
  'fee-collection': 'Every receipt in a date range with amount, method and collector.',
  'fee-defaulters': 'Students with overdue fees: months unpaid, amount due and phone.',
  results: 'Marks of every subject, total, %, grade and position for one test or exam.',
  syllabus: 'Topics covered for every section and subject.',
  messages: 'Every WhatsApp message of a month with its delivery status.',
};
const month0 = () => todayLocal().slice(0, 7);
const firstOfMonth = () => `${todayLocal().slice(0, 7)}-01`;

export default function ReportsPage() {
  const { data, error, loading } = useData<{ reports: Report[] }>('/reports');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const groups = [...new Set((data?.reports ?? []).map((r) => r.group))];
  return (
    <>
      <PageHeader title="Reports & exports" subtitle="Download school reports as Excel files. Open them in Excel or Google Sheets, or print to PDF." />
      {!data?.reports.length ? (
        <Empty title="No reports available for your account" />
      ) : (
        <div className="space-y-8">
          {groups.map((g, gi) => (
            <section key={g}>
              <h2 className="reveal mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500" style={{ '--i': gi } as CSSProperties}>
                <span className={`flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br text-xs text-white ${TONE[g]}`}>{ICON[g]}</span>
                {g}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.reports
                  .filter((r) => r.group === g)
                  .map((r, i) => (
                    <ReportCard key={r.key} r={r} i={i} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function ReportCard({ r, i }: { r: Report; i: number }) {
  const [p, setP] = useState<Record<string, string>>({ month: month0(), from: firstOfMonth(), to: todayLocal(), below: '75' });
  const needsSection = r.key === 'attendance-register';
  const needsAssessment = r.key === 'results';
  const structure = useData<{ classes: { id: string; name: string; stream: string | null; sections: { id: string; name: string }[] }[] }>(needsSection ? '/setup/structure' : null);
  const exams = useData<{ assessments: { id: string; title: string; kind: string; classLabel: string; status: string }[] }>(needsAssessment ? '/exams' : null);
  const params: Record<string, string> = {};
  if (needsSection) Object.assign(params, { sectionId: p.sectionId ?? structure.data?.classes.flatMap((c) => c.sections)[0]?.id ?? '', month: p.month });
  if (r.key === 'low-attendance') Object.assign(params, { from: p.from, to: p.to, below: p.below });
  if (r.key === 'fee-collection') Object.assign(params, { from: p.from, to: p.to });
  if (needsAssessment) params.assessmentId = p.assessmentId ?? exams.data?.assessments[0]?.id ?? '';
  if (r.key === 'messages') params.month = p.month;
  const ready = Object.values(params).every(Boolean);
  const href = `/api/reports/${r.key}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
  return (
    <Tilt max={4} className="rounded-2xl" style={{ '--i': i } as CSSProperties}>
      <div className="flex h-full flex-col rounded-2xl border border-gray-200/70 bg-white p-5 shadow-sm transition-shadow duration-300 hover:shadow-xl">
        <div className="font-semibold tracking-tight">{r.title}</div>
        <p className="mt-1 flex-1 text-sm text-gray-500">{DESC[r.key]}</p>
        <div className="mt-4 space-y-2">
          {needsSection && (
            <select className="input" value={params.sectionId} onChange={(e) => setP({ ...p, sectionId: e.target.value })} aria-label="Section">
              {structure.data?.classes.flatMap((c) =>
                c.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {className(c, s)}
                  </option>
                )),
              )}
            </select>
          )}
          {needsAssessment && (
            <select className="input" value={params.assessmentId} onChange={(e) => setP({ ...p, assessmentId: e.target.value })} aria-label="Test or exam">
              {!exams.data?.assessments.length && <option value="">No tests or exams yet</option>}
              {exams.data?.assessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} · {a.classLabel}
                  {a.status === 'PUBLISHED' ? '' : ' (draft)'}
                </option>
              ))}
            </select>
          )}
          {(needsSection || r.key === 'messages') && <input className="input" type="month" value={p.month} onChange={(e) => setP({ ...p, month: e.target.value })} aria-label="Month" />}
          {(r.key === 'low-attendance' || r.key === 'fee-collection') && (
            <div className="grid grid-cols-2 gap-2">
              <input className="input" type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} aria-label="From" />
              <input className="input" type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} aria-label="To" />
            </div>
          )}
          {r.key === 'low-attendance' && (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Below
              <input className="input w-20" type="number" min={1} max={100} value={p.below} onChange={(e) => setP({ ...p, below: e.target.value })} />%
            </label>
          )}
          <a
            href={ready ? href : undefined}
            aria-disabled={!ready}
            className={`group flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-md transition duration-200 active:scale-[0.97] ${ready ? 'bg-brand-500 shadow-brand-600/25 hover:-translate-y-px hover:shadow-lg' : 'pointer-events-none bg-gray-300'}`}
          >
            <span className="transition-transform duration-300 group-hover:translate-y-0.5">⇩</span> Download Excel
          </a>
        </div>
      </div>
    </Tilt>
  );
}
