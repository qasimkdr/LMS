'use client';

import Link from 'next/link';
import { use } from 'react';
import { fileUrl } from '@/lib/api';
import { useData } from '@/components/useData';
import { Card, ErrorBox, Loading } from '@/components/ui';
import { correctAnswerText, describeAnswer, SHORT_LABEL, type QType } from '@/components/online/Questions';

interface Result {
  paper: { title: string; totalMarks: number; showAnswers: boolean };
  score: number;
  overallRemark: string | null;
  sections: { id: string; title: string; attemptAny: number | null }[];
  questions: { id: string; sectionId: string; type: QType; text: string; imageFileId: string | null; options: unknown; marks: number; yourAnswer: unknown; awarded: number | null; remark: string | null; correctAnswer?: unknown }[];
}

export default function OnlineResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const { data, error, loading } = useData<Result>(`/online-exams/attempts/${attemptId}/result`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const pct = data.paper.totalMarks ? Math.round((data.score / data.paper.totalMarks) * 100) : 0;
  let n = 0;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/home/online-exams" className="text-sm text-brand-700 hover:underline">
        ← Online exams
      </Link>
      <Card className="mt-2 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{data.paper.title}</h1>
            {data.overallRemark && <p className="mt-1 text-sm text-gray-700">Teacher’s remark: {data.overallRemark}</p>}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">
              {data.score}
              <span className="text-lg font-medium text-gray-500"> / {data.paper.totalMarks}</span>
            </div>
            <div className="text-sm text-gray-500">{pct}%</div>
          </div>
        </div>
      </Card>
      {data.sections.map((s) => (
        <div key={s.id} className="mb-6">
          <h2 className="mb-2 font-semibold">
            {s.title} {s.attemptAny && <span className="text-sm font-normal text-gray-500">(best {s.attemptAny} counted)</span>}
          </h2>
          <ol className="space-y-3">
            {data.questions
              .filter((q) => q.sectionId === s.id)
              .map((q) => {
                n++;
                const full = q.awarded !== null && q.awarded >= q.marks;
                const zero = !q.awarded || q.awarded <= 0;
                return (
                  <li key={q.id} className={`rounded-xl border bg-white p-4 ${full ? 'border-green-200' : zero ? 'border-red-200' : 'border-amber-200'}`}>
                    <div className="mb-2 flex justify-between gap-3 text-sm font-medium">
                      <span className="whitespace-pre-wrap">
                        {n}. {q.text}
                      </span>
                      <span className={`shrink-0 font-semibold ${full ? 'text-green-700' : zero ? 'text-red-600' : 'text-amber-700'}`}>
                        {q.awarded ?? 0} / {q.marks}
                      </span>
                    </div>
                    {q.imageFileId && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(q.imageFileId)} alt="" className="mb-2 max-h-48 rounded border border-gray-200" />
                    )}
                    <div className="text-xs text-gray-500">{SHORT_LABEL[q.type]} · your answer</div>
                    <div className="whitespace-pre-wrap text-sm">{describeAnswer(q.type, q.options, q.yourAnswer)}</div>
                    {data.paper.showAnswers && q.correctAnswer !== undefined && correctAnswerText(q.type, q.options, q.correctAnswer) && (
                      <div className="mt-1 text-sm text-green-700">
                        {q.type === 'SHORT' || q.type === 'LONG' ? 'Model answer' : 'Correct answer'}: {correctAnswerText(q.type, q.options, q.correctAnswer)}
                      </div>
                    )}
                    {q.remark && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Teacher: {q.remark}</div>}
                  </li>
                );
              })}
          </ol>
        </div>
      ))}
    </div>
  );
}
