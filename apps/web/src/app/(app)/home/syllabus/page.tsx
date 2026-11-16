'use client';

import { useState } from 'react';
import { useData } from '@/components/useData';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Progress } from '@/components/ui';
import { FileList, type FileInfo } from '@/components/lms/Files';

interface Subject {
  subject: { id: string; name: string };
  chapters: { id: string; title: string; term: string | null; topics: { id: string; title: string; done: { completedOn: string } | null }[]; done: { completedOn: string } | null; total: number; completed: number }[];
  total: number;
  completed: number;
  percent: number;
  documents: { id: string; title: string; files: FileInfo[] }[];
}

export default function FamilySyllabusPage() {
  const { data, error, loading } = useData<{ children: { student: { id: string; fullName: string; classLabel: string }; subjects: Subject[] }[] }>('/lms/syllabus/my');
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const child = data?.children[idx];
  if (!child) return <Empty title="No syllabus yet" />;
  return (
    <>
      <PageHeader title="Syllabus" subtitle={`${child.student.fullName} · ${child.student.classLabel} — what has been taught so far`} />
      {data!.children.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data!.children.map((c, i) => (
            <Button key={c.student.id} variant={i === idx ? 'primary' : 'secondary'} onClick={() => setIdx(i)}>
              {c.student.fullName}
            </Button>
          ))}
        </div>
      )}
      {!child.subjects.length ? (
        <Empty title="The syllabus has not been added yet" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {child.subjects.map((s) => (
            <Card key={s.subject.id}>
              <button className="w-full text-left" onClick={() => setOpen(open === s.subject.id ? null : s.subject.id)}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold">{s.subject.name}</span>
                  <span className="text-xs text-brand-700">{open === s.subject.id ? 'Hide' : 'Chapters'}</span>
                </div>
                <Progress percent={s.total ? s.percent : null} label={s.total ? `${s.completed} of ${s.total} covered` : 'Chapters not listed'} />
              </button>
              {open === s.subject.id && (
                <ol className="mt-4 space-y-2 text-sm">
                  {s.chapters.map((c) => (
                    <li key={c.id}>
                      <div className={`font-medium ${c.completed === c.total ? 'text-green-700' : ''}`}>
                        {c.completed === c.total ? '✓ ' : ''}
                        {c.title}
                        {c.term && <span className="ml-2 text-xs font-normal text-gray-400">{c.term}</span>}
                      </div>
                      {c.topics.length > 0 && (
                        <ul className="ml-4 mt-1 space-y-0.5 text-gray-600">
                          {c.topics.map((t) => (
                            <li key={t.id} className={t.done ? 'text-green-700' : ''}>
                              {t.done ? '✓' : '○'} {t.title}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {s.documents.length > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  {s.documents.map((d) => (
                    <FileList key={d.id} files={d.files} />
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
