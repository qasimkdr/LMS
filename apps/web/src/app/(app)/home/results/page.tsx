'use client';

import { useState } from 'react';
import { useData } from '@/components/useData';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Table, Td } from '@/components/ui';
import { date } from '@/lib/format';
import { ResultsList, type ResultRow } from '@/components/exams/ResultsList';

interface Data {
  children: {
    student: { id: string; fullName: string };
    rows: ResultRow[];
    testMonths: { month: string; tests: number; average: number }[];
    dateSheets: { id: string; title: string; papers: { subject: string; date: string | null; startTime: string | null; totalMarks: number }[] }[];
  }[];
}

export default function FamilyResultsPage() {
  const { data, error, loading } = useData<Data>('/results/my');
  const [idx, setIdx] = useState(0);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const child = data?.children[idx];
  if (!child) return <Empty title="No results yet" />;
  return (
    <>
      <PageHeader title="Results" subtitle={child.student.fullName} />
      {data!.children.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data!.children.map((c, i) => (
            <Button key={c.student.id} variant={i === idx ? 'primary' : 'secondary'} onClick={() => setIdx(i)}>
              {c.student.fullName}
            </Button>
          ))}
        </div>
      )}
      {child.dateSheets.map((d) => (
        <Card key={d.id} title={`Date sheet · ${d.title}`} className="mb-6">
          <Table head={['Date', 'Subject', 'Time', 'Marks']}>
            {d.papers.map((p) => (
              <tr key={p.subject}>
                <Td>{p.date ? date(p.date) : 'To be announced'}</Td>
                <Td className="font-medium">{p.subject}</Td>
                <Td>{p.startTime ?? '—'}</Td>
                <Td>{p.totalMarks}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      ))}
      <ResultsList rows={child.rows} testMonths={child.testMonths} reportHref={(r) => `/home/results/${r.assessmentId}/${child.student.id}`} />
    </>
  );
}
