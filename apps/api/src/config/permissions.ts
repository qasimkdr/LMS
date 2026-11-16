/**
 * Permission keys a principal can grant to STAFF accounts.
 * PRINCIPAL implicitly has every permission inside their school.
 */
export const PERMISSIONS = {
  'students.view': 'View students',
  'students.manage': 'Add and edit students',
  'staff.view': 'View staff',
  'staff.manage': 'Add and edit staff',
  'attendance.manage': 'Mark and edit attendance',
  'fees.collect': 'Collect fees and issue receipts',
  'fees.manage': 'Manage fee structure and vouchers',
  'fees.reports': 'View fee reports',
  'exams.manage': 'Manage exams and results',
  'messages.send': 'Send WhatsApp / announcements',
  'files.manage': 'Upload and delete files',
  'gallery.manage': 'Manage gallery',
  'honors.manage': 'Give honors and awards',
  'lms.manage': 'Manage syllabus, study material, documents and homework',
  'admissions.manage': 'Manage enquiries and admissions',
  'reports.view': 'View reports',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];
