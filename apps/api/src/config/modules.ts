/** Feature modules a plan can switch on or off. Keys are stored in Plan.modules. */
export const MODULES = {
  attendance: 'Attendance',
  fees: 'Fees and finance',
  online_fee_payment: 'Online fee payment',
  exams: 'Tests, exams and report cards',
  online_exams: 'Online exams',
  lms: 'Syllabus, study material and homework',
  timetable: 'Timetable',
  whatsapp: 'WhatsApp messaging',
  class_chat: 'Class chat',
  parent_messaging: 'Parent messaging and complaints',
  honors: 'Rankings and honors',
  gallery: 'Gallery',
  admissions: 'Admissions pipeline',
  payroll: 'Payroll',
  expenses: 'Expenses and income',
} as const;

export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];
