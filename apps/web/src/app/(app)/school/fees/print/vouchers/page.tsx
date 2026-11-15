'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useData } from '@/components/useData';
import { ErrorBox, Loading } from '@/components/ui';
import { VoucherPrint, type VoucherData } from '@/components/fees/VoucherPrint';

function Inner() {
  const params = useSearchParams();
  const { data, error, loading } = useData<VoucherData>(`/fees/vouchers/print?${params.toString()}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return data ? <VoucherPrint data={data} /> : null;
}

export default function PrintVouchersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Inner />
    </Suspense>
  );
}
