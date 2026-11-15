import type { School, SchoolStatus } from '@prisma/client';

/** A trial that has ended behaves like READ_ONLY until the school is activated. */
export function effectiveSchoolStatus(school: Pick<School, 'status' | 'trialEndsAt'>, now = new Date()): SchoolStatus {
  if (school.status === 'TRIAL' && school.trialEndsAt && school.trialEndsAt < now) return 'READ_ONLY';
  return school.status;
}
