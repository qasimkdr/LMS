'use client';

import { Suspense, use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useData } from '@/components/useData';
import { ErrorBox, Loading } from '@/components/ui';
import { ReportCardPrint, type ReportCards } from '@/components/exams/ReportCard';

function Inner({ id }: { id: string }) {
  const params = useSearchParams();
  const { data: detail } = useData<{ sections: { id: string; name: string }[] }>(`/exams/${id}`);
  const [sectionId, setSectionId] = useState(params.get('sectionId') ?? '');
  const studentId = params.get('studentId');
  const qs = new URLSearchParams({ ...(sectionId && { sectionId }), ...(studentId && { studentId }) });
  const { data, error, loading } = useData<ReportCards>(`/exams/${id}/report-cards?${qs}`);
  return (
    <>
      {!studentId && (detail?.sections.length ?? 0) > 1 && (
        <div className="mb-3 print:hidden">
          <select className="input w-auto" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">All sections</option>
            {detail!.sections.map((s) => (
              <option key={s.id} value={s.id}>
                Section {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} /> : data ? <ReportCardPrint data={data} /> : null}
    </>
  );
}

export default function ReportCardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <Inner id={id} />
    </Suspense>
  );
}
