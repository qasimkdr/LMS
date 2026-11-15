'use client';

import { useState } from 'react';
import { useData } from '@/components/useData';
import { TimetableGrid } from '@/components/TimetableGrid';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import type { TTDay } from '@/lib/types';

export interface MyTimetable {
  role: string;
  now: { day: number; minutes: number };
  week?: TTDay[];
  periodsPerWeek?: number;
  children?: { student: { id: string; fullName: string }; hasSection: boolean; week: TTDay[] }[];
}

export default function MyTimetablePage() {
  const { data, error, loading } = useData<MyTimetable>('/timetable/my');
  const [childIdx, setChildIdx] = useState(0);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const print = (
    <Button variant="secondary" onClick={() => window.print()} className="print:hidden">
      Print
    </Button>
  );

  if (data.role === 'TEACHER') {
    return (
      <>
        <PageHeader title="My timetable" subtitle={`${data.periodsPerWeek} periods a week`} actions={print} />
        <Card>
          <TimetableGrid week={data.week ?? []} mode="teacher" now={data.now} />
        </Card>
      </>
    );
  }
  const kids = data.children ?? [];
  const child = kids[childIdx];
  return (
    <>
      <PageHeader title="Timetable" subtitle={child?.student.fullName} actions={print} />
      {kids.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2 print:hidden">
          {kids.map((k, i) => (
            <Button key={k.student.id} variant={i === childIdx ? 'primary' : 'secondary'} onClick={() => setChildIdx(i)}>
              {k.student.fullName}
            </Button>
          ))}
        </div>
      )}
      {!child ? (
        <Empty title="No timetable" />
      ) : !child.hasSection ? (
        <Empty title="No section assigned yet">The school will add the section soon.</Empty>
      ) : (
        <Card>
          <TimetableGrid week={child.week} mode="class" now={data.now} />
        </Card>
      )}
    </>
  );
}
