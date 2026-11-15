import type { Tone } from '../ui';

export const phaseTone: Record<string, Tone> = { DRAFT: 'gray', AWAITING_APPROVAL: 'amber', UPCOMING: 'blue', LIVE: 'green', ENDED: 'amber', RESULTS_SUBMITTED: 'amber', RESULTS_RETURNED: 'red', PUBLISHED: 'green' };
export const phaseLabel: Record<string, string> = {
  DRAFT: 'Draft',
  AWAITING_APPROVAL: 'Waiting for approval',
  UPCOMING: 'Scheduled',
  LIVE: 'Live now',
  ENDED: 'Ended – check papers',
  RESULTS_SUBMITTED: 'Results with principal',
  RESULTS_RETURNED: 'Results sent back',
  PUBLISHED: 'Published',
};

/** Value for <input type="datetime-local"> in the browser's time zone. */
export const localDT = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
