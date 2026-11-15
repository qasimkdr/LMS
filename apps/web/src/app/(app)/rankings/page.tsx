'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Avatar } from '@/components/Avatar';
import { Tabs } from '@/components/Tabs';
import { Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';

interface Lite {
  id: string;
  fullName: string;
  classLabel: string;
  photoFileId: string | null;
}
interface RankRow {
  student: Lite;
  percent: number;
  count: number;
  position: number;
}
interface Data {
  title: string;
  school: RankRow[];
  byClass: { classId: string; label: string; rows: RankRow[] }[];
  subjectToppers: { classLabel: string; subject: string; rows: { student: Lite; marks: number; total: number; percent: number }[] }[];
  mostImproved: { student: Lite; percent: number; before: number; change: number }[];
  perfectAttendance: { student: Lite; percent: number; days: number }[];
  attendanceTop: { student: Lite; percent: number; days: number; absent: number }[];
  counted: number;
}
type Scope = 'month' | 'exam' | 'session';

const medal = (p: number) => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : String(p));
const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

function Who({ s, staff }: { s: Lite; staff: boolean }) {
  const name = staff ? (
    <Link href={`/school/students/${s.id}`} className="font-medium hover:underline">
      {s.fullName}
    </Link>
  ) : (
    <span className="font-medium">{s.fullName}</span>
  );
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar fileId={s.photoFileId} name={s.fullName} size={32} />
      <span className="min-w-0">
        <span className="block truncate text-sm">{name}</span>
        <span className="block truncate text-xs text-gray-500">{s.classLabel}</span>
      </span>
    </span>
  );
}

export default function RankingsPage() {
  const { me } = useAuth();
  const staff = true; // teachers may also open profiles of their own students
  const [scope, setScope] = useState<Scope>('month');
  const [period, setPeriod] = useState(lastMonth());
  const [exam, setExam] = useState('');
  const exams = useData<{ exams: { key: string; title: string; classes: number }[] }>(scope === 'exam' ? '/rankings/exams' : null);
  const examKey = exam || exams.data?.exams[0]?.key || '';
  const path = scope === 'month' ? `/rankings?scope=month&period=${period}` : scope === 'session' ? '/rankings?scope=session' : examKey ? `/rankings?scope=exam&exam=${examKey}` : null;
  const { data, error, loading } = useData<Data>(path);

  return (
    <>
      <PageHeader title="Rankings" subtitle={me?.user.role === 'TEACHER' ? 'Top students in the classes you teach' : 'Top performers, subject toppers, most improved and attendance'} />
      <Tabs
        tabs={[
          { key: 'month', label: 'By month' },
          { key: 'exam', label: 'By exam' },
          { key: 'session', label: 'Whole session' },
        ]}
        value={scope}
        onChange={setScope}
      />
      <div className="mb-5 flex flex-wrap gap-3">
        {scope === 'month' && <input className="input w-auto" type="month" value={period} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && setPeriod(e.target.value)} aria-label="Month" />}
        {scope === 'exam' && (
          <select className="input w-auto" value={examKey} onChange={(e) => setExam(e.target.value)} aria-label="Exam">
            {!exams.data?.exams.length && <option value="">No published exams yet</option>}
            {exams.data?.exams.map((x) => (
              <option key={x.key} value={x.key}>
                {x.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {error ? (
        <ErrorBox error={error} />
      ) : !path ? (
        <Empty title="No published term exams yet" />
      ) : loading && !data ? (
        <Loading />
      ) : !data || (!data.counted && !data.attendanceTop.length) ? (
        <Empty title="Nothing to rank yet">Rankings use published test and exam results{scope !== 'exam' ? ' and attendance' : ''}.</Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={`Top of the ${me?.user.role === 'TEACHER' ? 'list' : 'school'} · ${data.title}`}>
            {!data.school.length ? (
              <p className="text-sm text-gray-500">No results.</p>
            ) : (
              <ol className="space-y-2.5">
                {data.school.map((r) => (
                  <li key={r.student.id} className="flex items-center gap-3">
                    <span className="w-7 text-center text-lg">{medal(r.position)}</span>
                    <span className="min-w-0 flex-1">
                      <Who s={r.student} staff={staff} />
                    </span>
                    <span className="text-right text-sm font-semibold">
                      {r.percent}%<span className="block text-xs font-normal text-gray-500">{r.count} result{r.count === 1 ? '' : 's'}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Top 3 in each class">
            <div className="space-y-4">
              {data.byClass.map((c) => (
                <div key={c.classId}>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{c.label}</div>
                  <ol className="space-y-2">
                    {c.rows.map((r) => (
                      <li key={r.student.id} className="flex items-center gap-3">
                        <span className="w-7 text-center">{medal(r.position)}</span>
                        <span className="min-w-0 flex-1">
                          <Who s={r.student} staff={staff} />
                        </span>
                        <span className="text-sm font-semibold">{r.percent}%</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </Card>

          {data.subjectToppers.length > 0 && (
            <Card title="Subject toppers">
              <ul className="divide-y divide-gray-100">
                {data.subjectToppers.map((t, i) => (
                  <li key={i} className="flex items-center gap-3 py-2">
                    <span className="w-28 shrink-0 text-xs text-gray-500">
                      <span className="block font-semibold text-gray-700">{t.subject}</span>
                      {t.classLabel}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      {t.rows.map((r) => (
                        <Who key={r.student.id} s={r.student} staff={staff} />
                      ))}
                    </span>
                    <span className="text-sm font-semibold">
                      {t.rows[0].marks}/{t.rows[0].total}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {scope !== 'session' && (
            <Card title={scope === 'exam' ? 'Most improved since the last exam' : 'Most improved since last month'}>
              {!data.mostImproved.length ? (
                <p className="text-sm text-gray-500">No comparison available yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.mostImproved.map((r) => (
                    <li key={r.student.id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <Who s={r.student} staff={staff} />
                      </span>
                      <span className="text-right text-sm">
                        <span className="font-semibold text-green-700">+{r.change}</span>
                        <span className="block text-xs text-gray-500">
                          {r.before}% → {r.percent}%
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {scope !== 'exam' && (
            <Card title={`100% attendance (${data.perfectAttendance.length})`}>
              {!data.perfectAttendance.length ? (
                <p className="text-sm text-gray-500">No student had full attendance{data.attendanceTop.length ? '' : ' (attendance not marked)'}.</p>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {data.perfectAttendance.map((r) => (
                    <Who key={r.student.id} s={r.student} staff={staff} />
                  ))}
                </div>
              )}
              {data.perfectAttendance.length === 0 && data.attendanceTop.length > 0 && (
                <>
                  <div className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Best attendance</div>
                  <ul className="space-y-2">
                    {data.attendanceTop.slice(0, 5).map((r) => (
                      <li key={r.student.id} className="flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <Who s={r.student} staff={staff} />
                        </span>
                        <span className="text-sm font-semibold">{r.percent}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
