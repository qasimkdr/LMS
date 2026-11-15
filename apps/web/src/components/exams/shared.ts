import type { Tone } from '../ui';

export const sheetTone: Record<string, Tone> = { DRAFT: 'gray', SUBMITTED: 'amber', RETURNED: 'red', APPROVED: 'green' };
export const sheetLabel: Record<string, string> = { DRAFT: 'Not submitted', SUBMITTED: 'Waiting for approval', RETURNED: 'Sent back', APPROVED: 'Approved' };
export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));
