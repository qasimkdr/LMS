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
      text: 'Dear Parent, {{1}} of {{2}} is absent from school today ({{3}}). Please contact {{4}} if you were not aware. Thank you.',
    },
    params: ['Student name', 'Class', 'Date', 'School name'],
    available: true,
  },
  LATE: {
    label: 'Late arrival alert',
    description: 'When a student is marked late.',
    rules: ['auto', 'manual', 'off'],
    defaultRule: 'off',
    suggestedTemplate: { name: 'late_alert', language: 'en', category: 'UTILITY', text: 'Dear Parent, {{1}} of {{2}} arrived late at {{4}} today ({{3}}). Thank you.' },
    params: ['Student name', 'Class', 'Date', 'School name'],
    available: true,
  },
  MANUAL: {
    label: 'Messages typed by the school',
    description: 'Notices and messages you write and send to parents or staff.',
    rules: ['manual', 'off'],
    defaultRule: 'manual',
    // Meta rejects templates that start or end with a variable, so the message sits between fixed text.
    suggestedTemplate: { name: 'school_notice', language: 'en', category: 'UTILITY', text: 'Message from {{2}}: {{1}} Thank you.' },
    params: ['Message', 'School name'],
    available: true,
  },
  // Coming in later steps; listed so schools can see what will be possible.
  FEE_VOUCHER: {
    label: 'Fee vouchers and reminders',
    description: 'Automatic: when monthly vouchers are generated. Reminders to defaulters are always sent by pressing Send.',
    rules: ['auto', 'manual', 'off'],
    defaultRule: 'manual',
    suggestedTemplate: {
      name: 'fee_reminder',
      language: 'en',
      category: 'UTILITY',
      text: 'Dear Parent, the fee for {{1}} ({{2}}) is due by {{3}}. Total amount due: {{4}}. Please pay at the school or online. Thank you, {{5}}.',
    },
    params: ['Student name(s)', 'Month or details', 'Due date', 'Amount due', 'School name'],
    available: true,
  },
  RECEIPT: {
    label: 'Payment receipt',
    description: 'When a fee payment is received at the counter or online.',
    rules: ['auto', 'off'],
    defaultRule: 'auto',
    suggestedTemplate: {
      name: 'fee_receipt',
      language: 'en',
      category: 'UTILITY',
      text: 'Dear Parent, we have received {{1}} for {{2}} on {{3}} (receipt {{4}}). Remaining balance: {{5}}. Thank you, {{6}}.',
    },
    params: ['Amount', 'Student name(s)', 'Date', 'Receipt number', 'Balance', 'School name'],
    available: true,
  },
  RESULT: { label: 'Test results and report cards', description: 'Step 6', rules: ['auto', 'manual', 'off'], defaultRule: 'manual', suggestedTemplate: { name: 'result_card', language: 'en', category: 'UTILITY', text: '' }, params: [], available: false },
  MONTHLY_REPORT: { label: 'Monthly progress report', description: 'Step 8', rules: ['manual', 'off'], defaultRule: 'manual', suggestedTemplate: { name: 'monthly_report', language: 'en', category: 'UTILITY', text: '' }, params: [], available: false },
  REMARK: { label: 'Teacher remarks', description: 'Step 8', rules: ['manual', 'off'], defaultRule: 'manual', suggestedTemplate: { name: 'student_remark', language: 'en', category: 'UTILITY', text: '' }, params: [], available: false },
};

/** "{{1}} of {{2}}" + ["Ali", "Class 5"] -> "Ali of Class 5" */
export function renderTemplate(text: string, params: string[]) {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
}
