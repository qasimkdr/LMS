'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { AttendanceCalendar, AttendanceSheet, STATUS, type Status } from '@/components/Attendance';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { className } from '@/lib/types';

export default function MyAttendancePage() {
  const { me } = useAuth();
  if (!me) return null;
  return me.user.role === 'TEACHER' ? <TeacherAttendance /> : <FamilyAttendance />;
}

function TeacherAttendance() {
  const { data, error, loading, reload } = useData<{ today: string; sections: { id: string; name: string; class: { name: string; stream: string | null }; markedToday: boolean }[] }>('/attendance/my-sections');
  const [sectionId, setSectionId] = useState('');
  useEffect(() => {
    if (!sectionId && data?.sections.length) setSectionId((data.sections.find((s) => !s.markedToday) ?? data.sections[0]).id);
  }, [data, sectionId]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <>
      <PageHeader title="Attendance" subtitle={new Date(`${data.today}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} />
      {data.sections.length === 0 ? (
        <Empty title="You are not a class teacher">Only the class teacher marks a section’s attendance.</Empty>
      ) : (
        <>
          {data.sections.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {data.sections.map((s) => (
                <Button key={s.id} variant={s.id === sectionId ? 'primary' : 'secondary'} onClick={() => setSectionId(s.id)}>
                  {className(s.class, s)} {s.markedToday ? '✓' : ''}
                </Button>
              ))}
            </div>
          )}
          {sectionId && <AttendanceSheet key={sectionId} sectionId={sectionId} date={data.today} onSaved={reload} />}
        </>
      )}
    </>
  );
}

interface Family {
  month: string;
  today: string;
  children: { student: { id: string; fullName: string }; counts: Record<string, number>; percent: number | null; days: { date: string; status: Status; remark: string | null }[] }[];
}

function FamilyAttendance() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, error, loading } = useData<Family>(`/attendance/my?month=${month}`);
  const [idx, setIdx] = useState(0);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const child = data.children[idx];
  const todayStatus = child?.days.find((d) => d.date === data.today)?.status;
  return (
    <>
      <PageHeader title="Attendance" subtitle={child?.student.fullName} />
      {data.children.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data.children.map((c, i) => (
            <Button key={c.student.id} variant={i === idx ? 'primary' : 'secondary'} onClick={() => setIdx(i)}>
              {c.student.fullName}
            </Button>
          ))}
        </div>
      )}
      {!child ? (
        <Empty title="No attendance yet" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="This month" className="lg:col-span-2">
            <AttendanceCalendar month={data.month} days={child.days} onMonth={setMonth} />
          </Card>
          <div className="space-y-6">
            <Card title="Today">
              {todayStatus ? <span className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${STATUS[todayStatus].cell}`}>{STATUS[todayStatus].label}</span> : <span className="text-sm text-gray-500">Not marked yet</span>}
            </Card>
            <Card title="Summary">
              <div className="text-3xl font-semibold">{child.percent === null ? '—' : `${child.percent}%`}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(Object.keys(STATUS) as Status[]).filter((s) => child.counts[s]).map((s) => (
                  <Badge key={s}>
                    {STATUS[s].label}: {child.counts[s]}
                  </Badge>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
