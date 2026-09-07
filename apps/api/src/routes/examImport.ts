import { Router, raw } from 'express';
import mammoth from 'mammoth';
import { z } from 'zod';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('TEACHER', 'PRINCIPAL'));

const TYPES = ['MCQ','MULTI_SELECT','TRUE_FALSE','FILL_BLANK','SHORT_ANSWER','LONG_ANSWER','NUMERIC','MATCHING','ESSAY'] as const;
const questionSchema = z.object({
  type: z.enum(TYPES),
  prompt: z.string().min(2),
  explanation: z.string().optional(),
  marks: z.coerce.number().positive(),
  correctAnswer: z.any().optional(),
  options: z.array(z.object({ label: z.string().min(1), value: z.string().min(1), isCorrect: z.boolean() })).default([]),
});
type Question = z.infer<typeof questionSchema>;
type Issue = { row: number; message: string };

function normalizeType(value?: string): Question['type'] {
  const key = (value || '').trim().toUpperCase().replace(/[ -]+/g, '_');
  if ((TYPES as readonly string[]).includes(key)) return key as Question['type'];
  return 'MCQ';
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let current = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(current.trim()); current = ''; }
    else current += c;
  }
  out.push(current.trim());
  return out;
}

function parseCsv(text: string): unknown[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line), row: Record<string,string> = {};
    headers.forEach((h, i) => row[h] = values[i] ?? '');
    const options = ['a','b','c','d','e','f'].flatMap(letter => {
      const value = row[`option${letter}`] || row[`option_${letter}`];
      if (!value) return [];
      const correct = (row.correctoption || row.correct_option || row.answer || '').toUpperCase().split(/[|;, ]+/).includes(letter.toUpperCase());
      return [{ label: letter.toUpperCase(), value, isCorrect: correct }];
    });
    const type = normalizeType(row.type);
    const answer = row.correctanswer || row.correct_answer || row.answer || undefined;
    if (type === 'MCQ' && options.length && answer && !options.some(o => o.isCorrect)) {
      const byValue = options.find(o => o.value.toLowerCase() === answer.toLowerCase());
      if (byValue) byValue.isCorrect = true;
    }
    return { type, prompt: row.prompt || row.question || row.q, marks: Number(row.marks || 1), explanation: row.explanation || undefined, correctAnswer: answer, options };
  });
}

function parseTxt(text: string): unknown[] {
  const blocks = text.replace(/^\uFEFF/, '').split(/\n\s*\n+/).map(x => x.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const get = (name: string) => lines.find(x => new RegExp(`^${name}:`, 'i').test(x))?.replace(new RegExp(`^${name}:\\s*`, 'i'), '').trim();
    const prompt = get('Q(?:UESTION)?') || lines.find(x => !/^(TYPE|MARKS|ANSWER|EXPLANATION):/i.test(x) && !/^[A-F][).:]/i.test(x)) || '';
    const options = lines.filter(x => /^[A-F][).:]/i.test(x)).map(x => ({ label: x[0].toUpperCase(), value: x.replace(/^[A-F][).:]\s*/i, ''), isCorrect: false }));
    const answer = get('ANSWER');
    if (answer && options.length) {
      const keys = answer.toUpperCase().split(/[|;, ]+/);
      for (const o of options) o.isCorrect = keys.includes(o.label) || o.value.toLowerCase() === answer.toLowerCase();
    }
    const inferred = options.length ? (answer?.includes(',') || answer?.includes('|') ? 'MULTI_SELECT' : 'MCQ') : 'LONG_ANSWER';
    return { type: normalizeType(get('TYPE') || inferred), prompt, marks: Number(get('MARKS') || 1), explanation: get('EXPLANATION'), correctAnswer: answer, options };
  });
}

function validate(rows: unknown[]) {
  const questions: Question[] = [], issues: Issue[] = [];
  rows.forEach((row, i) => {
    const parsed = questionSchema.safeParse(row);
    if (!parsed.success) { issues.push({ row: i + 1, message: parsed.error.issues.map(x => `${x.path.join('.') || 'question'}: ${x.message}`).join('; ') }); return; }
    const q = parsed.data;
    if ((q.type === 'MCQ' || q.type === 'MULTI_SELECT') && q.options.length < 2) { issues.push({ row: i + 1, message: 'Objective questions need at least two options.' }); return; }
    if ((q.type === 'MCQ' || q.type === 'MULTI_SELECT') && !q.options.some(o => o.isCorrect)) { issues.push({ row: i + 1, message: 'Objective question has no correct option.' }); return; }
    questions.push(q);
  });
  return { questions, issues, totalMarks: questions.reduce((n, q) => n + q.marks, 0) };
}

const textSchema = z.object({ format: z.enum(['txt','csv']), text: z.string().min(1).max(2_000_000) });
router.post('/preview', async (req, res) => {
  const parsed = textSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid import payload' });
  const rows = parsed.data.format === 'csv' ? parseCsv(parsed.data.text) : parseTxt(parsed.data.text);
  if (!rows.length) return res.status(400).json({ message: 'No question rows detected' });
  res.json({ format: parsed.data.format, ...validate(rows) });
});

router.post('/preview-docx', raw({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', limit: '8mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: 'Empty DOCX file' });
  try {
    const result = await mammoth.extractRawText({ buffer: req.body });
    const rows = parseTxt(result.value);
    if (!rows.length) return res.status(400).json({ message: 'No supported question blocks detected in DOCX' });
    res.json({ format: 'docx', parserMessages: result.messages.map(m => m.message).slice(0, 20), ...validate(rows) });
  } catch {
    res.status(400).json({ message: 'Could not read DOCX file' });
  }
});

router.get('/template', (_req, res) => {
  res.type('text/plain').send('TYPE: MCQ\nQ: What is 2 + 2?\nA) 3\nB) 4\nC) 5\nANSWER: B\nMARKS: 1\nEXPLANATION: 2 + 2 equals 4.\n\nTYPE: SHORT_ANSWER\nQ: Define photosynthesis.\nANSWER: Process by which plants convert light energy into chemical energy.\nMARKS: 3');
});

export default router;
