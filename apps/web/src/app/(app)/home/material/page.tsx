'use client';

import { useMemo, useState } from 'react';
import { useData } from '@/components/useData';
import { Button, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { MaterialCard, type Material } from '@/components/lms/Material';

export default function FamilyMaterialPage() {
  const { data, error, loading } = useData<{ children: { student: { id: string; fullName: string; classLabel: string }; material: Material[] }[] }>('/lms/material/my');
  const [idx, setIdx] = useState(0);
  const [subject, setSubject] = useState('');
  const child = data?.children[idx];
  const subjects = useMemo(() => [...new Set((child?.material ?? []).map((m) => m.subject ?? 'General'))].sort(), [child]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!child) return <Empty title="No study material yet" />;
  const list = child.material.filter((m) => !subject || (m.subject ?? 'General') === subject);
  return (
    <>
      <PageHeader title="Study material" subtitle={`${child.student.fullName} · ${child.student.classLabel}`} />
      {data!.children.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data!.children.map((c, i) => (
            <Button key={c.student.id} variant={i === idx ? 'primary' : 'secondary'} onClick={() => { setIdx(i); setSubject(''); }}>
              {c.student.fullName}
            </Button>
          ))}
        </div>
      )}
      {subjects.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {['', ...subjects].map((s) => (
            <button key={s || 'all'} onClick={() => setSubject(s)} className={`rounded-full border px-3 py-1 text-sm ${subject === s ? 'border-brand-500 bg-brand-50 font-medium text-brand-800' : 'border-gray-200 bg-white text-gray-600'}`}>
              {s || 'All subjects'}
            </button>
          ))}
        </div>
      )}
      {!list.length ? (
        <Empty title="No study material yet">Teachers’ notes, worksheets and videos will appear here.</Empty>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {list.map((m) => (
            <MaterialCard key={m.id} m={m} />
          ))}
        </ul>
      )}
    </>
  );
}
