'use client';

import Link from 'next/link';
import { use } from 'react';
import { useData } from '@/components/useData';
import { Avatar } from '@/components/Avatar';
import { Card, Empty, ErrorBox, Loading, PageHeader, Table, Td } from '@/components/ui';
import { age, genderLabel } from '@/lib/format';
import { className } from '@/lib/types';

interface Data {
  section: { id: string; name: string; class: { name: string; stream: string | null } };
  students: { id: string; fullName: string; admissionNo: string; rollNo: string | null; photoFileId: string | null; gender: string; dob: string | null }[];
}

export default function TeacherSectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useData<Data>(`/my/sections/${id}/students`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <>
      <PageHeader title={className(data.section.class, data.section)} subtitle={`${data.students.length} students`} actions={<Link href="/home" className="text-sm text-brand-700 hover:underline">← My classes</Link>} />
      <Card>
        {data.students.length === 0 ? (
          <Empty title="No students in this section yet" />
        ) : (
          <Table head={['Roll', 'Student', 'Adm. no', 'Gender', 'Age']}>
            {data.students.map((s) => (
              <tr key={s.id}>
                <Td>{s.rollNo ?? '—'}</Td>
                <Td>
                  <Link href={`/school/students/${s.id}`} className="flex items-center gap-3 font-medium hover:text-brand-700">
                    <Avatar fileId={s.photoFileId} name={s.fullName} size={32} />
                    {s.fullName}
                  </Link>
                </Td>
                <Td>{s.admissionNo}</Td>
                <Td>{genderLabel[s.gender]}</Td>
                <Td>{age(s.dob)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
