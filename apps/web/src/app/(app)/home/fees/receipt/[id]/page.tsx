'use client';

import { ReceiptPrint } from '@/components/fees/ReceiptPrint';

export default function ParentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReceiptPrint params={params} />;
}
