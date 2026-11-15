export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export const money = (n: number | null | undefined, currency = 'PKR') =>
  n === null || n === undefined ? '—' : `${currency} ${Math.round(n).toLocaleString('en-US')}`;

export const date = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const dateTime = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

export const monthLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
};

export const roleLabel: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  PRINCIPAL: 'Principal',
  STAFF: 'Staff',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  PARENT: 'Parent',
};

export const statusLabel: Record<string, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  READ_ONLY: 'Read-only',
  SUSPENDED: 'Suspended',
};

export const categoryLabel: Record<string, string> = {
  LOGO: 'Logo',
  PROFILE_PHOTO: 'Profile photos',
  STUDENT_DOCUMENT: 'Student documents',
  STAFF_DOCUMENT: 'Staff documents',
  SYLLABUS: 'Syllabus',
  STUDY_MATERIAL: 'Study material',
  SCHOOL_DOCUMENT: 'School documents',
  GALLERY: 'Gallery',
  CHAT: 'Chat',
  HOMEWORK: 'Homework',
  EXAM: 'Exams',
  OTHER: 'Other',
};
