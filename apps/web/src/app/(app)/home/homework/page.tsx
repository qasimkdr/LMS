'use client';

import { useState } from 'react';
import { useData } from '@/components/useData';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { FileList, type FileInfo } from '@/components/lms/Files';
import { dayLabel, shiftDay, todayLocal } from '@/components/lms/shared';
import { date } from '@/lib/format';

interface Child {
  student: { id: string; fullName: string; classLabel: string };
  homework: { id: string; subject: string | null; date: string; dueDate: string | null; text: string; files: FileInfo[]; createdBy: string }[];
  days: { date: string; count: number }[];
}

export default function FamilyHomeworkPage() {
  const [day, setDay] = useState(todayLocal());
  const { data, error, loading } = useData<{ date: string; children: Child[] }>(`/lms/homework/my?date=${day}`);
  const [idx, setIdx] = useState(0);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const child = data?.children[idx];
  if (!child) return <Empty title="No homework" />;
  return (
    <>
      <PageHeader title="Homework / diary" subtitle={`${child.student.fullName} · ${child.student.classLabel}`} />
      {data!.children.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data!.children.map((c, i) => (
            <Button key={c.student.id} variant={i === idx ? 'primary' : 'secondary'} onClick={() => setIdx(i)}>
              {c.student.fullName}
            </Button>
          ))}
        </div>
      )}
      <div className="mb-4 flex items-center gap-1">
        <Button variant="ghost" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day">
          ←
        </Button>
        <input className="input w-auto" type="date" value={day} max={shiftDay(todayLocal(), 7)} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Date" />
        <Button variant="ghost" onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day">
          →
        </Button>
        {day !== todayLocal() && (
          <Button variant="ghost" onClick={() => setDay(todayLocal())}>
            Today
          </Button>
        )}
      </div>
      <Card title={dayLabel(day)}>
        {!child.homework.length ? (
          <p className="text-sm text-gray-500">No homework for this day.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {child.homework.map((h) => (
              <li key={h.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{h.subject ?? 'Diary'}</span>
                  {h.dueDate && h.dueDate !== h.date && <Badge tone="amber">Due {date(h.dueDate)}</Badge>}
                  <span className="text-xs text-gray-500">{h.createdBy}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{h.text}</p>
                <div className="mt-2">
                  <FileList files={h.files} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {child.days.filter((d) => d.date !== day).length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Recent days with homework</div>
          <div className="flex flex-wrap gap-2">
            {child.days
              .filter((d) => d.date !== day)
              .map((d) => (
                <button key={d.date} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm hover:border-brand-300" onClick={() => setDay(d.date)}>
                  {date(d.date)} <span className="text-xs text-gray-400">({d.count})</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
