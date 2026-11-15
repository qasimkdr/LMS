'use client';

import { use } from 'react';
import { useData } from '@/components/useData';
import { AdmissionPrint } from '@/components/AdmissionPrint';
import { ErrorBox, Loading } from '@/components/ui';

export default function PrintStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error, loading } = useData<{ student: any }>(`/students/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return <AdmissionPrint student={data?.student} />;
}
