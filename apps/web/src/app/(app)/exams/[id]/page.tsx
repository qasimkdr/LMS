'use client';

import Link from 'next/link';
import { Suspense, use, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Tabs } from '@/components/Tabs';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Table, Td } from '@/components/ui';
import { date, dateInput } from '@/lib/format';
import { fmt, sheetLabel, sheetTone } from '@/components/exams/shared';

interface Detail {
  assessment: { id: string; kind: 'TEST' | 'EXAM'; type: string; title: string; topic: string | null; status: string; announced: boolean; publishedAt: string | null; createdBy: string | null; class: { id: string; name: string }; classLabel: string };
  sections: { id: string; name: string }[];
  papers: {
    id: string;
    subjectId: string;
    subject: string;
    date: string | null;
    startTime: string | null;
    totalMarks: number;
    passMarks: number;
    marksEntered: number;
    sheets: { sectionId: string; section: string; status: string; returnNote: string | null; teacher: { id: string; fullName: string } | null }[];
  }[];
  canManage: boolean;
}

type Tab = 'marks' | 'datesheet' | 'results' | 'remarks';

function DetailInner({ id }: { id: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const { data, error, loading, reload } = useData<Detail>(`/exams/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const a = data.assessment;
  const published = a.status === 'PUBLISHED';
  const tab = (params.get('tab') as Tab) || 'marks';
  const back = me?.user.role === 'TEACHER' ? '/home/marks' : `/school/exams${a.kind === 'TEST' ? '?tab=tests' : ''}`;

  async function act(key: string, fn: () => Promise<unknown>, msg: string) {
    setBusy(key);
    try {
      await fn();
      toast(msg);
      reload();
    } catch (e) {
      if (key === 'publish' && e instanceof ApiError && (e.details as { pending?: number })?.pending) {
        if (confirm(`${e.message}\n\nStudents without marks in a paper get 0 for it.`)) {
          await api.post(`/exams/${id}/publish`, { force: true });
          toast('Results published');
          reload();
        }
      } else toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={back} className="text-sm text-brand-700 hover:underline">
            ← Back
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold sm:text-2xl">
            {a.title} <Badge tone="blue">{a.type}</Badge> {published ? <Badge tone="green">Published</Badge> : <Badge>Not published</Badge>}
          </h1>
          <div className="text-sm text-gray-600">
            {a.classLabel}
            {a.kind === 'TEST' && a.createdBy && ` · by ${a.createdBy}`}
            {a.topic && ` · ${a.topic}`}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/report-cards/${id}`}>
            <Button variant="secondary">{a.kind === 'EXAM' ? 'Report cards' : 'Result sheet'}</Button>
          </Link>
          {data.canManage && a.kind === 'EXAM' && !published && (
            <Button variant="secondary" loading={busy === 'announce'} onClick={() => act('announce', () => api.patch(`/exams/${id}`, { announced: !a.announced }), a.announced ? 'Date sheet hidden' : 'Date sheet shared with students and parents')}>
              {a.announced ? 'Hide date sheet' : 'Share date sheet'}
            </Button>
          )}
          {data.canManage && !published && (
            <Button loading={busy === 'publish'} onClick={() => confirm('Publish results to students and parents?') && act('publish', () => api.post(`/exams/${id}/publish`, {}), 'Results published')}>
              Publish results
            </Button>
          )}
          {data.canManage && published && (
            <>
              <Button loading={busy === 'send'} onClick={() => act('send', () => api.post(`/exams/${id}/send`, {}), 'Results sent to parents')}>
                Send to parents
              </Button>
              {me?.user.role === 'PRINCIPAL' && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const reason = prompt('Why hide these results from students and parents?');
                    if (reason) act('unpublish', () => api.post(`/exams/${id}/unpublish`, { reason }), 'Results hidden');
                  }}
                >
                  Unpublish
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={(t) => router.replace(`/exams/${id}?tab=${t}`)}
        tabs={[
          { key: 'marks', label: 'Marks entry' },
          ...(a.kind === 'EXAM' || data.canManage ? [{ key: 'datesheet' as Tab, label: a.kind === 'EXAM' ? 'Date sheet' : 'Marks & date' }] : []),
          { key: 'results', label: 'Results' },
          ...(a.kind === 'EXAM' ? [{ key: 'remarks' as Tab, label: 'Report card remarks' }] : []),
        ]}
      />
      {tab === 'marks' && <MarksProgress data={data} />}
      {tab === 'datesheet' && <DateSheet data={data} onSaved={reload} />}
      {tab === 'results' && <Results id={id} sections={data.sections} />}
      {tab === 'remarks' && <Remarks id={id} sections={data.sections} />}
    </>
  );
}

export default function ExamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <DetailInner id={id} />
    </Suspense>
  );
}

function MarksProgress({ data }: { data: Detail }) {
  const { me } = useAuth();
  return (
    <Card title="Marks by subject and section">
      <div className="-mx-5 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-5 py-2">Subject</th>
              {data.sections.map((s) => (
                <th key={s.id} className="px-3 py-2">
                  Section {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.papers.map((p) => (
              <tr key={p.id}>
                <td className="px-5 py-2.5">
                  <div className="font-medium">{p.subject}</div>
                  <div className="text-xs text-gray-500">
                    {p.date ? date(p.date) : 'No date'} · out of {fmt(p.totalMarks)}
                  </div>
                </td>
                {p.sheets.map((sh) => {
                  const mine = data.canManage || sh.teacher?.id === me?.user.id;
                  return (
                    <td key={sh.sectionId} className="px-3 py-2.5 align-top">
                      <Badge tone={data.assessment.status === 'PUBLISHED' ? 'green' : sheetTone[sh.status]}>{data.assessment.status === 'PUBLISHED' ? 'Published' : sheetLabel[sh.status]}</Badge>
                      <div className="mt-1 text-xs text-gray-500">{sh.teacher?.fullName ?? <span className="text-amber-600">No teacher assigned</span>}</div>
                      <Link href={`/marks/${p.id}?section=${sh.sectionId}&back=${encodeURIComponent(`/exams/${data.assessment.id}`)}`} className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">
                        {mine && data.assessment.status !== 'PUBLISHED' && ['DRAFT', 'RETURNED'].includes(sh.status) ? 'Enter marks →' : data.canManage && sh.status === 'SUBMITTED' ? 'Review →' : 'View →'}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DateSheet({ data, onSaved }: { data: Detail; onSaved: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => data.papers.map((p) => ({ id: p.id, subject: p.subject, date: dateInput(p.date), startTime: p.startTime ?? '', totalMarks: String(p.totalMarks), passMarks: String(p.passMarks) })));
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(data.papers.map((p) => ({ id: p.id, subject: p.subject, date: dateInput(p.date), startTime: p.startTime ?? '', totalMarks: String(p.totalMarks), passMarks: String(p.passMarks) }))), [data]);
  const editable = data.canManage;
  return (
    <Card title={data.assessment.kind === 'EXAM' ? 'Date sheet' : 'Test details'}>
      <Table head={['Subject', 'Date', 'Time', 'Total marks', 'Pass marks']}>
        {rows.map((r, i) => (
          <tr key={r.id}>
            <Td className="font-medium">{r.subject}</Td>
            <Td>
              <input className="input w-40 py-1" type="date" disabled={!editable} value={r.date} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
            </Td>
            <Td>
              <input className="input w-28 py-1" type="time" disabled={!editable} value={r.startTime} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />
            </Td>
            <Td>
              <input className="input w-24 py-1" type="number" min={1} disabled={!editable} value={r.totalMarks} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, totalMarks: e.target.value } : x)))} />
            </Td>
            <Td>
              <input className="input w-24 py-1" type="number" min={0} disabled={!editable} value={r.passMarks} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, passMarks: e.target.value } : x)))} />
            </Td>
          </tr>
        ))}
      </Table>
      {editable && (
        <Button
          className="mt-4"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.put(`/exams/${data.assessment.id}/papers`, { papers: rows.map((r) => ({ id: r.id, date: r.date || null, startTime: r.startTime || null, totalMarks: Number(r.totalMarks), passMarks: Number(r.passMarks) })) });
              toast('Saved');
              onSaved();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      )}
    </Card>
  );
}

interface ResultsData {
  status: string;
  papers: { id: string; subject: string; totalMarks: number; average: number | null; highest: number | null; passed: number; appeared: number }[];
  rows: { student: { id: string; fullName: string; rollNo: string | null; section: { name: string } | null }; marks: Record<string, number | 'A' | null>; obtained: number; total: number; percent: number; grade: string; passed: boolean; positionClass: number | null; positionSection: number | null }[];
  summary: { students: number; passed: number; average: number | null; highest: number | null; grades: Record<string, number> };
  showPositions: boolean;
}

function Results({ id, sections }: { id: string; sections: { id: string; name: string }[] }) {
  const toast = useToast();
  const { me } = useAuth();
  const [sectionId, setSectionId] = useState('');
  const { data, error, loading, reload } = useData<ResultsData>(`/exams/${id}/results${sectionId ? `?sectionId=${sectionId}` : ''}`);
  const canManage = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('exams.manage');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {sections.length > 1 && (
          <select className="input w-auto" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">Whole class</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                Section {s.name}
              </option>
            ))}
          </select>
        )}
        {data.status !== 'PUBLISHED' && canManage && (
          <Button
            variant="secondary"
            onClick={async () => {
              await api.post(`/exams/${id}/calculate`);
              toast('Preview calculated from the marks entered so far');
              reload();
            }}
          >
            Calculate preview
          </Button>
        )}
        <Button variant="ghost" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      {data.status !== 'PUBLISHED' && <p className="text-sm text-amber-700">Preview only. Students and parents see results after you publish.</p>}
      {data.rows.length === 0 ? (
        <Empty title="No results yet">Results appear when marks are entered{canManage ? ' (press “Calculate preview”)' : ''}.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Students', data.summary.students],
              ['Passed', `${data.summary.passed} (${Math.round((data.summary.passed / data.summary.students) * 100)}%)`],
              ['Class average', `${data.summary.average}%`],
              ['Highest', `${data.summary.highest}%`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase text-gray-500">{k}</div>
                <div className="mt-1 text-xl font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <Card title="Result sheet">
            <div className="-mx-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
                    {data.showPositions && <th className="px-3 py-2">Pos.</th>}
                    <th className="px-3 py-2">Student</th>
                    {data.papers.map((p) => (
                      <th key={p.id} className="whitespace-nowrap px-2 py-2 text-center">
                        {p.subject}
                        <div className="font-normal normal-case">/{fmt(p.totalMarks)}</div>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center">Total</th>
                    <th className="px-2 py-2 text-center">%</th>
                    <th className="px-2 py-2 text-center">Grade</th>
                    <th className="px-2 py-2">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.map((r) => (
                    <tr key={r.student.id}>
                      {data.showPositions && <td className="px-3 py-1.5 font-semibold">{sectionId ? r.positionSection : r.positionClass}</td>}
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <Link href={`/school/students/${r.student.id}?tab=results`} className="font-medium hover:underline">
                          {r.student.fullName}
                        </Link>
                        <span className="ml-1 text-xs text-gray-400">{r.student.section?.name}</span>
                      </td>
                      {data.papers.map((p) => (
                        <td key={p.id} className="px-2 py-1.5 text-center">
                          {r.marks[p.id] === 'A' ? <span className="text-red-600">A</span> : fmt(r.marks[p.id] as number | null)}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center font-semibold">
                        {fmt(r.obtained)}/{fmt(r.total)}
                      </td>
                      <td className="px-2 py-1.5 text-center">{fmt(r.percent)}</td>
                      <td className="px-2 py-1.5 text-center font-semibold">{r.grade}</td>
                      <td className="px-2 py-1.5">{r.passed ? <Badge tone="green">Pass</Badge> : <Badge tone="red">Fail</Badge>}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 text-xs text-gray-600">
                    {data.showPositions && <td />}
                    <td className="px-3 py-1.5 font-semibold">Average / highest</td>
                    {data.papers.map((p) => (
                      <td key={p.id} className="px-2 py-1.5 text-center">
                        {fmt(p.average)} / {fmt(p.highest)}
                      </td>
                    ))}
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Remarks({ id, sections }: { id: string; sections: { id: string; name: string }[] }) {
  const toast = useToast();
  const { me } = useAuth();
  const isPrincipal = me?.user.role === 'PRINCIPAL';
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const { data, loading } = useData<{ cards: { student: { id: string; fullName: string }; result: { percent: number; grade: string }; remarks: { teacher: string | null; principal: string | null } }[] }>(sectionId ? `/exams/${id}/report-cards?sectionId=${sectionId}` : null);
  const [vals, setVals] = useState<Record<string, { teacher: string; principal: string }>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setVals(Object.fromEntries(data.cards.map((c) => [c.student.id, { teacher: c.remarks.teacher ?? '', principal: c.remarks.principal ?? '' }])));
  }, [data]);
  const suggestions = ['Excellent work, keep it up.', 'Good effort. Can do even better.', 'Needs to work harder in weak subjects.', 'Regular practice at home is needed.', 'Well behaved and attentive in class.'];
  return (
    <Card
      title="Remarks printed on report cards"
      actions={
        sections.length > 1 && (
          <select className="input w-auto py-1" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                Section {s.name}
              </option>
            ))}
          </select>
        )
      }
    >
      {loading && !data ? (
        <Loading />
      ) : !data?.cards.length ? (
        <Empty title="Remarks can be written once marks are entered" />
      ) : (
        <>
          <datalist id="remark-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <ul className="divide-y divide-gray-100">
            {data.cards.map((c) => (
              <li key={c.student.id} className="grid gap-2 py-3 md:grid-cols-[12rem_1fr_1fr] md:items-center">
                <div>
                  <div className="font-medium">{c.student.fullName}</div>
                  <div className="text-xs text-gray-500">
                    {c.result.percent}% · {c.result.grade}
                  </div>
                </div>
                <input className="input" list="remark-suggestions" placeholder="Class teacher’s remark" value={vals[c.student.id]?.teacher ?? ''} onChange={(e) => setVals({ ...vals, [c.student.id]: { ...vals[c.student.id], teacher: e.target.value } })} />
                <input className="input" list="remark-suggestions" placeholder={isPrincipal ? 'Principal’s remark' : 'Principal’s remark (principal only)'} disabled={!isPrincipal} value={vals[c.student.id]?.principal ?? ''} onChange={(e) => setVals({ ...vals, [c.student.id]: { ...vals[c.student.id], principal: e.target.value } })} />
              </li>
            ))}
          </ul>
          <Button
            className="mt-4"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.put(`/exams/${id}/remarks`, { remarks: Object.entries(vals).map(([studentId, v]) => ({ studentId, teacherRemark: v.teacher, ...(isPrincipal ? { principalRemark: v.principal } : {}) })) });
                toast('Remarks saved');
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Failed', 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Save remarks
          </Button>
        </>
      )}
    </Card>
  );
}
