'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { StudentForm, toValues } from '@/components/StudentForm';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';

export default function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error, loading } = useData<{ student: any }>(`/students/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <>
      <PageHeader title={`Edit ${data.student.fullName}`} subtitle="Parents and guardians are edited on the profile’s Family tab." />
      <StudentForm
        mode="edit"
        initial={toValues(data.student)}
        submitLabel="Save changes"
        onSubmit={async (p) => {
          await api.patch(`/students/${id}`, { ...p.student, reason: p.reason });
          toast('Student updated');
          router.push(`/school/students/${id}`);
        }}
      />
    </>
  );
}
