import crypto from 'node:crypto';
import { z } from 'zod';
import type { OnlinePaperQuestion, OnlinePaperSection, QuestionType } from '@prisma/client';
import { badRequest } from '../lib/errors';
import { round2 } from '../lib/money';

export const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
export const OBJECTIVE: QuestionType[] = ['MCQ', 'MULTI', 'TRUE_FALSE', 'FILL', 'MATCH'];

// ---------- Question content ----------

const option = z.object({ id: z.string().min(1).max(20), text: z.string().trim().max(500) });

export const questionSchema = z.object({
  type: z.enum(['MCQ', 'MULTI', 'TRUE_FALSE', 'FILL', 'MATCH', 'SHORT', 'LONG']),
  text: z.string().trim().min(1).max(5000),
  imageFileId: z.string().nullish(),
  options: z.unknown().optional(),
  answer: z.unknown().optional(),
  marks: z.coerce.number().min(0.25).max(100),
});
export type QuestionInput = z.infer<typeof questionSchema>;

/** Count of blanks in a fill-in question: "___" (3+ underscores) marks a blank. */
export const blanksIn = (text: string) => (text.match(/_{3,}/g) ?? []).length;

/** Validates options/answer for each question type and returns them cleaned. */
export function normalizeQuestion(q: QuestionInput): { options: unknown; answer: unknown } {
  const where = q.text.slice(0, 40);
  switch (q.type) {
    case 'MCQ':
    case 'MULTI': {
      const opts = z.array(option).min(2).max(8).safeParse(q.options);
      if (!opts.success || opts.data.some((o) => !o.text)) throw badRequest(`"${where}": give at least 2 options with text`);
      const ids = new Set(opts.data.map((o) => o.id));
      if (q.type === 'MCQ') {
        if (typeof q.answer !== 'string' || !ids.has(q.answer)) throw badRequest(`"${where}": choose the correct option`);
        return { options: opts.data, answer: q.answer };
      }
      const ans = z.array(z.string()).min(1).safeParse(q.answer);
      if (!ans.success || ans.data.some((a) => !ids.has(a))) throw badRequest(`"${where}": choose the correct options`);
      return { options: opts.data, answer: [...new Set(ans.data)] };
    }
    case 'TRUE_FALSE':
      if (typeof q.answer !== 'boolean') throw badRequest(`"${where}": choose True or False`);
      return { options: null, answer: q.answer };
    case 'FILL': {
      const n = blanksIn(q.text);
      if (!n) throw badRequest(`"${where}": put ___ (three underscores) where each blank goes`);
      const ans = z.array(z.array(z.string().trim().min(1).max(200)).min(1)).length(n).safeParse(q.answer);
      if (!ans.success) throw badRequest(`"${where}": give the accepted answer(s) for each of the ${n} blank(s)`);
      return { options: null, answer: ans.data };
    }
    case 'MATCH': {
      const opts = z.object({ left: z.array(z.string().trim().min(1).max(200)).min(2).max(10), right: z.array(z.string().trim().min(1).max(200)).min(2).max(10) }).safeParse(q.options);
      if (!opts.success || opts.data.left.length !== opts.data.right.length) throw badRequest(`"${where}": give the same number of items in both columns`);
      // Stored in the correct order; answer[i] = index in `right` that matches left[i].
      return { options: opts.data, answer: opts.data.left.map((_, i) => i) };
    }
    default:
      return { options: null, answer: typeof q.answer === 'string' ? q.answer.slice(0, 5000) : null };
  }
}

// ---------- Marking ----------

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Automatic marks for objective questions (null for short/long answers, which the teacher marks). */
export function autoMark(q: Pick<OnlinePaperQuestion, 'type' | 'answer' | 'marks'>, given: unknown, negative: number): number | null {
  const marks = num(q.marks);
  const blank = given === undefined || given === null || given === '' || (Array.isArray(given) && given.every((g) => g === '' || g === null || g === undefined));
  switch (q.type) {
    case 'MCQ':
    case 'TRUE_FALSE':
      if (blank) return 0;
      return given === q.answer ? marks : negative > 0 ? round2(-marks * negative) : 0;
    case 'MULTI': {
      if (blank || !Array.isArray(given)) return 0;
      const want = new Set(q.answer as string[]);
      const got = new Set(given as string[]);
      return want.size === got.size && [...want].every((x) => got.has(x)) ? marks : 0;
    }
    case 'FILL': {
      const accepted = (q.answer as string[][]) ?? [];
      if (blank || !Array.isArray(given) || !accepted.length) return 0;
      const right = accepted.filter((alts, i) => alts.some((a) => norm(a) === norm((given as unknown[])[i]))).length;
      return round2((marks * right) / accepted.length);
    }
    case 'MATCH': {
      const want = (q.answer as number[]) ?? [];
      if (blank || !Array.isArray(given) || !want.length) return 0;
      const right = want.filter((r, i) => (given as unknown[])[i] === r).length;
      return round2((marks * right) / want.length);
    }
    default:
      return null;
  }
}

export interface MarkEntry {
  auto: number | null;
  manual: number | null;
  remark: string | null;
}

/** Final marks of one question: the teacher's mark if given, otherwise the automatic one. */
export const finalMark = (m: MarkEntry | undefined) => (m ? (m.manual ?? m.auto) : null);

/**
 * Total score. In "attempt any N" sections only the best N questions count.
 * Returns null while any counted short/long answer still needs marking.
 */
export function scoreAttempt(sections: Pick<OnlinePaperSection, 'id' | 'attemptAny'>[], questions: Pick<OnlinePaperQuestion, 'id' | 'sectionId' | 'type'>[], marking: Record<string, MarkEntry>, answers: Record<string, unknown>) {
  let total = 0;
  let pending = 0;
  for (const s of sections) {
    const qs = questions.filter((q) => q.sectionId === s.id);
    const vals = qs.map((q) => {
      const m = finalMark(marking[q.id]);
      const answered = answers[q.id] !== undefined && answers[q.id] !== null && answers[q.id] !== '';
      // Unanswered short/long answers simply get 0; answered ones wait for the teacher.
      if (m === null && !OBJECTIVE.includes(q.type) && answered) pending++;
      return m ?? 0;
    });
    const counted = s.attemptAny && s.attemptAny < vals.length ? [...vals].sort((a, b) => b - a).slice(0, s.attemptAny) : vals;
    total += counted.reduce((a, b) => a + b, 0);
  }
  return { score: round2(Math.max(0, total)), pending };
}

/** Maximum marks of the paper ("attempt any N" counts the N highest-mark questions). */
export function paperTotal(sections: Pick<OnlinePaperSection, 'id' | 'attemptAny'>[], questions: Pick<OnlinePaperQuestion, 'sectionId' | 'marks'>[]) {
  let t = 0;
  for (const s of sections) {
    const m = questions.filter((q) => q.sectionId === s.id).map((q) => num(q.marks)).sort((a, b) => b - a);
    t += (s.attemptAny && s.attemptAny < m.length ? m.slice(0, s.attemptAny) : m).reduce((a, b) => a + b, 0);
  }
  return round2(t);
}

// ---------- Student view ----------

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Order of questions (shuffled within each section) and of options, fixed per student at start. */
export function makeOrder(sections: { id: string }[], questions: OnlinePaperQuestion[], shuffleQ: boolean, shuffleO: boolean) {
  const order: string[] = [];
  for (const s of sections) {
    const qs = questions.filter((q) => q.sectionId === s.id).sort((a, b) => a.sortOrder - b.sortOrder);
    order.push(...(shuffleQ ? shuffle(qs) : qs).map((q) => q.id));
  }
  const optionOrder: Record<string, (string | number)[]> = {};
  for (const q of questions) {
    if ((q.type === 'MCQ' || q.type === 'MULTI') && Array.isArray(q.options)) {
      const ids = (q.options as { id: string }[]).map((o) => o.id);
      optionOrder[q.id] = shuffleO ? shuffle(ids) : ids;
    }
    // Matching: the right-hand column is always mixed up, otherwise the answer is obvious.
    if (q.type === 'MATCH' && q.options) optionOrder[q.id] = shuffle((q.options as { right: string[] }).right.map((_, i) => i));
  }
  return { order, optionOrder };
}

/** A question as the student sees it: no answers, options in the student's order. */
export function studentQuestion(q: OnlinePaperQuestion, optionOrder: Record<string, (string | number)[]>) {
  const base = { id: q.id, sectionId: q.sectionId, type: q.type, text: q.text, imageFileId: q.imageFileId, marks: num(q.marks) };
  if (q.type === 'MCQ' || q.type === 'MULTI') {
    const opts = q.options as { id: string; text: string }[];
    const ord = (optionOrder[q.id] as string[]) ?? opts.map((o) => o.id);
    return { ...base, options: ord.map((id) => opts.find((o) => o.id === id)).filter(Boolean) };
  }
  if (q.type === 'MATCH') {
    const o = q.options as { left: string[]; right: string[] };
    const ord = (optionOrder[q.id] as number[]) ?? o.right.map((_, i) => i);
    // Right items carry their real index so the answer can be checked.
    return { ...base, left: o.left, right: ord.map((i) => ({ index: i, text: o.right[i] })) };
  }
  if (q.type === 'FILL') return { ...base, blanks: blanksIn(q.text) };
  return base;
}
