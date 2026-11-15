'use client';

import { useState } from 'react';
import { useData } from '@/components/useData';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { RemarkList, type Remark } from '@/components/progress/Remarks';

export default function FamilyRemarksPage() {
  const { data, error, loading } = useData<{ children: { student: { id: string; fullName: string }; remarks: Remark[] }[] }>('/remarks/my');
  const [idx, setIdx] = useState(0);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const child = data?.children[idx];
  if (!child) return <Empty title="No remarks yet" />;
  return (
    <>
      <PageHeader title="Remarks" subtitle={`What teachers have written about ${child.student.fullName}`} />
      {data!.children.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data!.children.map((c, i) => (
            <Button key={c.student.id} variant={i === idx ? 'primary' : 'secondary'} onClick={() => setIdx(i)}>
              {c.student.fullName}
            </Button>
          ))}
        </div>
      )}
      <Card>
        <RemarkList remarks={child.remarks} />
      </Card>
    </>
  );
}
