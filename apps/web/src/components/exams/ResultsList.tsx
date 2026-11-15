'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, Empty } from '../ui';
import { date, monthLabel } from '@/lib/format';
import { fmt } from './shared';

export interface ResultRow {
  assessmentId: string;
  kind: 'TEST' | 'EXAM';
  type: string;
  title: string;
  status: string;
  date: string;
  obtained: number;
  total: number;
  percent: number;
  grade: string;
  passed: boolean;
  positionSection: number | null;
  subjects: { subject: string; totalMarks: number; obtained: number | null; absent: boolean; remark: string | null }[];
}

/** Results of one student: exams with report-card links, tests, and monthly test averages. */
export function ResultsList({ rows, testMonths, reportHref }: { rows: ResultRow[]; testMonths: { month: string; tests: number; average: number }[]; reportHref: (r: ResultRow) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  const exams = rows.filter((r) => r.kind === 'EXAM');
  const tests = rows.filter((r) => r.kind === 'TEST');
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="Exams">
          {exams.length === 0 ? (
            <p className="text-sm text-gray-500">No exam results yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {exams.map((r) => (
                <li key={r.assessmentId} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {r.title} {r.status !== 'PUBLISHED' && <Badge>Not published</Badge>}
                      </div>
                      <div className="text-xs text-gray-500">{r.type}</div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="font-semibold">
                        {fmt(r.obtained)}/{fmt(r.total)} · {fmt(r.percent)}%
                      </span>
                      <Badge tone={r.passed ? 'green' : 'red'}>{r.grade}</Badge>
                      {r.positionSection && <span className="text-xs text-gray-500">Position {r.positionSection}</span>}
                      <Link href={reportHref(r)} className="text-sm font-medium text-brand-700 hover:underline">
                        Report card →
                      </Link>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.subjects.map((s) => (
                      <span key={s.subject} className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                        {s.subject}: {s.absent ? 'Absent' : `${fmt(s.obtained)}/${fmt(s.totalMarks)}`}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Class tests">
          {tests.length === 0 ? (
            <Empty title="No test results yet" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {tests.map((r) => {
                const s = r.subjects[0];
                return (
                  <li key={r.assessmentId} className="py-2.5">
                    <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(open === r.assessmentId ? null : r.assessmentId)}>
                      <span>
                        <span className="block text-sm font-medium">
                          {s?.subject} · {r.title}
                        </span>
                        <span className="text-xs text-gray-500">
                          {r.type} · {date(r.date)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 text-sm">
                        <span className="font-semibold">{s?.absent ? 'Absent' : `${fmt(r.obtained)}/${fmt(r.total)}`}</span>
                        <Badge tone={r.passed ? 'green' : 'red'}>{r.grade}</Badge>
                      </span>
                    </button>
                    {open === r.assessmentId && (
                      <div className="mt-1 text-xs text-gray-600">
                        {fmt(r.percent)}%{r.positionSection ? ` · position ${r.positionSection} in class` : ''}
                        {s?.remark && ` · Teacher: ${s.remark}`}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Monthly test average">
        {testMonths.length === 0 ? (
          <p className="text-sm text-gray-500">No tests yet.</p>
        ) : (
          <ul className="space-y-3">
            {testMonths.map((m) => (
              <li key={m.month}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{monthLabel(m.month)}</span>
                  <span className="text-gray-600">
                    {m.average}% · {m.tests} test{m.tests > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div className={`h-2 rounded-full ${m.average >= 70 ? 'bg-emerald-500' : m.average >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${m.average}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
