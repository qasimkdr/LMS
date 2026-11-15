'use client';

import { use } from 'react';
import { useData } from '@/components/useData';
import { ErrorBox, Loading } from '@/components/ui';
import { ReportCardPrint, type ReportCards } from '@/components/exams/ReportCard';

export default function FamilyReportCardPage({ params }: { params: Promise<{ assessmentId: string; studentId: string }> }) {
  const { assessmentId, studentId } = use(params);
  const { data, error, loading } = useData<ReportCards>(`/results/my/${assessmentId}/${studentId}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return data ? <ReportCardPrint data={data} /> : null;
}
