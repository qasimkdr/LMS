/**
 * Message types a school can send on WhatsApp. Messages a parent did not start must use a template
 * the school has had approved by Meta; the texts below are suggestions to submit.
 * Template variables are {{1}}, {{2}}, … in Meta; params are filled in that order.
 */
export type Rule = 'auto' | 'manual' | 'off';

export interface MessageTypeDef {
  label: string;
  description: string;
  rules: Rule[];
  defaultRule: Rule;
  suggestedTemplate: { name: string; language: string; category: 'UTILITY' | 'MARKETING'; text: string };
  params: string[];
  available: boolean;
}

export const MESSAGE_TYPES: Record<string, MessageTypeDef> = {
  ABSENT: {
    label: 'Absent alert',
    description: 'When a student is marked absent.',
    rules: ['auto', 'manual', 'off'],
    defaultRule: 'auto',
    suggestedTemplate: {
      name: 'absent_alert',
      language: 'en',
      category: 'UTILITY',
      text: 'Dear Parent, {{1}} of {{2}} is absent from school today ({{3}}). Please contact the school if you were not aware. - {{4}}',
    },
    params: ['Student name', 'Class', 'Date', 'School name'],
    available: true,
  },
  LATE: {
    label: 'Late arrival alert',
    description: 'When a student is marked late.',
    rules: ['auto', 'manual', 'off'],
    defaultRule: 'off',
    suggestedTemplate: { name: 'late_alert', language: 'en', category: 'UTILITY', text: 'Dear Parent, {{1}} of {{2}} arrived late to school today ({{3}}). - {{4}}' },
    params: ['Student name', 'Class', 'Date', 'School name'],
    available: true,
  },
  MANUAL: {
    label: 'Messages typed by the school',
    description: 'Notices and messages you write and send to parents or staff.',
    rules: ['manual', 'off'],
    defaultRule: 'manual',
    suggestedTemplate: { name: 'school_notice', language: 'en', category: 'UTILITY', text: '{{1}} - {{2}}' },
    params: ['Message', 'School name'],
    available: true,
  },
  // Coming in later steps; listed so schools can see what will be possible.
  FEE_VOUCHER: { label: 'Fee voucher and reminders', description: 'Step 5', rules: ['auto', 'manual', 'off'], defaultRule: 'manual', suggestedTemplate: { name: 'fee_reminder', language: 'en', category: 'UTILITY', text: '' }, params: [], available: false },
  RECEIPT: { label: 'Payment receipt', description: 'Step 5', rules: ['auto', 'manual', 'off'], defaultRule: 'auto', suggestedTemplate: { name: 'fee_receipt', language: 'en', category: 'UTILITY', text: '' }, params: [], available: false },
  RESULT: { label: 'Test results and report cards', description: 'Step 6', rules: ['auto', 'manual', 'off'], defaultRule: 'manual', suggestedTemplate: { name: 'result_card', language: 'en', category: 'UTILITY', text: '' }, params: [], available: false },
  MONTHLY_REPORT: { label: 'Monthly progress report', description: 'Step 8', rules: ['manual', 'off'], defaultRule: 'manual', suggestedTemplate: { name: 'monthly_report', language: 'en', category: 'UTILITY', text: '' }, params: [], available: false },
  REMARK: { label: 'Teacher remarks', description: 'Step 8', rules: ['manual', 'off'], defaultRule: 'manual', suggestedTemplate: { name: 'student_remark', language: 'en', category: 'UTILITY', text: '' }, params: [], available: false },
};

/** "{{1}} of {{2}}" + ["Ali", "Class 5"] -> "Ali of Class 5" */
export function renderTemplate(text: string, params: string[]) {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
}
