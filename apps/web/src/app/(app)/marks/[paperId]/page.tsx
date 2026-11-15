'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { MarksSheet } from '@/components/exams/MarksSheet';
import { Loading } from '@/components/ui';

function Inner({ paperId }: { paperId: string }) {
  const params = useSearchParams();
  return <MarksSheet paperId={paperId} sectionId={params.get('section') ?? ''} backHref={params.get('back') ?? '/home/marks'} />;
}

export default function MarksPage({ params }: { params: Promise<{ paperId: string }> }) {
  const { paperId } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <Inner paperId={paperId} />
    </Suspense>
  );
}
