'use client';

import { useAuth } from '../auth';
import type { Tone } from '../ui';

export const invTone: Record<string, Tone> = { UNPAID: 'red', PARTIAL: 'amber', PAID: 'green', CANCELLED: 'gray', NONE: 'gray' };
export const invLabel: Record<string, string> = { UNPAID: 'Unpaid', PARTIAL: 'Partly paid', PAID: 'Paid', CANCELLED: 'Cancelled', NONE: 'No voucher' };
export const methodLabel: Record<string, string> = { CASH: 'Cash', BANK: 'Bank', CHEQUE: 'Cheque', ONLINE: 'Online', OTHER: 'Other' };

/** Money in the school's currency. */
export function useMoney() {
  const { me } = useAuth();
  const cur = me?.school?.currency ?? 'PKR';
  return (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${cur} ${Math.round(n).toLocaleString('en-US')}`);
}

export function useFeePerms() {
  const { me } = useAuth();
  const p = me?.user.role === 'PRINCIPAL';
  const has = (k: string) => p || Boolean(me?.user.permissions.includes(k));
  return { isPrincipal: p, collect: has('fees.collect'), manage: has('fees.manage'), reports: has('fees.reports') };
}

export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
