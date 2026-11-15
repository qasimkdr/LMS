'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/Tabs';
import { Loading, PageHeader } from '@/components/ui';
import { useFeePerms } from '@/components/fees/shared';
import { FeeDashboard } from '@/components/fees/Dashboard';
import { Collect } from '@/components/fees/Collect';
import { Vouchers } from '@/components/fees/Vouchers';
import { Receipts } from '@/components/fees/Receipts';
import { Handover } from '@/components/fees/Handover';
import { FeeReports } from '@/components/fees/Reports';
import { FeeSetup } from '@/components/fees/Setup';

type Tab = 'dashboard' | 'collect' | 'vouchers' | 'receipts' | 'handover' | 'reports' | 'setup';

function FeesInner() {
  const params = useSearchParams();
  const router = useRouter();
  const perms = useFeePerms();
  const tabs: { key: Tab; label: string }[] = [
    ...(perms.reports ? [{ key: 'dashboard' as Tab, label: 'Overview' }] : []),
    ...(perms.collect ? [{ key: 'collect' as Tab, label: 'Collect fee' }] : []),
    ...(perms.collect || perms.manage ? [{ key: 'vouchers' as Tab, label: 'Vouchers' }] : []),
    ...(perms.collect || perms.reports ? [{ key: 'receipts' as Tab, label: 'Receipts' }] : []),
    ...(perms.collect ? [{ key: 'handover' as Tab, label: perms.isPrincipal ? 'Hand-overs' : 'Hand over money' }] : []),
    ...(perms.reports ? [{ key: 'reports' as Tab, label: 'Reports' }] : []),
    ...(perms.manage ? [{ key: 'setup' as Tab, label: 'Fee setup' }] : []),
  ];
  const tab = (params.get('tab') as Tab) || tabs[0]?.key;
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Fees" subtitle="Vouchers, collection, receipts, hand-overs and recovery" />
        <Tabs value={tab} onChange={(t) => router.replace(`/school/fees?tab=${t}`)} tabs={tabs} />
      </div>
      {tab === 'dashboard' && <FeeDashboard />}
      {tab === 'collect' && <Collect initialFamily={params.get('family') ?? undefined} />}
      {tab === 'vouchers' && <Vouchers />}
      {tab === 'receipts' && <Receipts />}
      {tab === 'handover' && <Handover />}
      {tab === 'reports' && <FeeReports />}
      {tab === 'setup' && <FeeSetup />}
    </>
  );
}

export default function FeesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <FeesInner />
    </Suspense>
  );
}
