'use client';

import Link from 'next/link';
import { useData } from '@/components/useData';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';

interface Item {
  id: string;
  title: string;
  subject: string;
  startAt: string | null;
  endAt: string | null;
  durationMinutes: number;
  totalMarks: number;
  questions: number;
  phase: string;
  attempt: { id: string; submitted: boolean; deadline: string } | null;
  published: boolean;
  score: number | null;
}

function state(p: Item): { tone: 'green' | 'blue' | 'amber' | 'gray' | 'red'; text: string } {
  if (p.published) return p.attempt ? { tone: 'green', text: 'Result ready' } : { tone: 'red', text: 'Missed' };
  if (p.attempt?.submitted) return { tone: 'gray', text: 'Submitted – waiting for result' };
  if (p.phase === 'LIVE') return p.attempt ? { tone: 'amber', text: 'In progress' } : { tone: 'green', text: 'Open now' };
  if (p.phase === 'UPCOMING') return { tone: 'blue', text: 'Coming up' };
  return p.attempt ? { tone: 'gray', text: 'Submitted – waiting for result' } : { tone: 'red', text: 'Missed' };
}

export default function StudentOnlineExamsPage() {
  const { data, error, loading } = useData<{ papers: Item[] }>('/online-exams/student/list');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const papers = data?.papers ?? [];
  return (
    <>
      <PageHeader title="Online exams" subtitle="Tests your teachers have set for you to take online" />
      {!papers.length ? (
        <Empty title="No online exams yet">When a teacher schedules one, it will appear here.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {papers.map((p) => {
            const s = state(p);
            const canTake = p.phase === 'LIVE' && !p.attempt?.submitted;
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{p.title}</div>
                    <div className="text-sm text-gray-600">
                      {p.subject} · {p.questions} questions · {p.totalMarks} marks · {p.durationMinutes} min
                    </div>
                  </div>
                  <Badge tone={s.tone}>{s.text}</Badge>
                </div>
                <div className="mt-3 text-sm text-gray-600">
                  Opens {dateTime(p.startAt)} · closes {dateTime(p.endAt)}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  {canTake && (
                    <Link href={`/home/online-exams/${p.id}`}>
                      <Button>{p.attempt ? 'Continue exam' : 'Start exam'}</Button>
                    </Link>
                  )}
                  {p.published && p.attempt && (
                    <>
                      <span className="text-lg font-semibold">
                        {p.score} / {p.totalMarks}
                      </span>
                      <Link href={`/home/online-exams/result/${p.attempt.id}`}>
                        <Button variant="secondary">See answers & remarks</Button>
                      </Link>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
