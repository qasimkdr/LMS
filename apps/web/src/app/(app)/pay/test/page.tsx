'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';

/** Stand-in for a real payment page (only on servers with the test gateway switched on). */
function TestGateway() {
  const params = useSearchParams();
  const router = useRouter();
  const ref = params.get('ref') ?? '';
  const { data, error } = useData<{ ref: string; amount: number; status: string; currency: string }>(ref ? `/pay/test/${ref}` : null);
  const [busy, setBusy] = useState(false);
  async function finish(outcome: 'success' | 'failure') {
    setBusy(true);
    await api.post(`/pay/test/${ref}/complete`, { outcome });
    router.replace(`/home/fees?payment=${outcome === 'success' ? 'success' : 'failed'}&ref=${ref}`);
  }
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="mx-auto max-w-sm pt-10">
      <Card title="Test payment gateway">
        <p className="text-sm text-gray-600">No real money moves. Choose what the bank would answer.</p>
        <div className="my-6 text-center text-3xl font-semibold">
          {data.currency} {Math.round(data.amount).toLocaleString('en-US')}
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" loading={busy} onClick={() => finish('success')}>
            Pay successfully
          </Button>
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => finish('failure')}>
            Decline
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function TestGatewayPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TestGateway />
    </Suspense>
  );
}
