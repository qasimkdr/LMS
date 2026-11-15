'use client';

import { useRef, useState } from 'react';
import { api, fileUrl } from '@/lib/api';
import { useToast } from '../toast';
import { Button, Field } from '../ui';

export type QType = 'MCQ' | 'MULTI' | 'TRUE_FALSE' | 'FILL' | 'MATCH' | 'SHORT' | 'LONG';
export const TYPE_LABEL: Record<QType, string> = {
  MCQ: 'MCQ (one answer)',
  MULTI: 'MCQ (more than one answer)',
  TRUE_FALSE: 'True / False',
  FILL: 'Fill in the blanks',
  MATCH: 'Match the columns',
  SHORT: 'Short answer',
  LONG: 'Long answer',
};
export const SHORT_LABEL: Record<QType, string> = { MCQ: 'MCQ', MULTI: 'Multi MCQ', TRUE_FALSE: 'True/False', FILL: 'Fill blanks', MATCH: 'Matching', SHORT: 'Short', LONG: 'Long' };

export interface EditQuestion {
  key: string;
  id?: string;
  bankId?: string | null;
  type: QType;
  text: string;
  imageFileId?: string | null;
  options?: unknown;
  answer?: unknown;
  marks: number;
  chapter?: string | null;
}

let seq = 0;
export const newKey = () => `k${Date.now()}${seq++}`;

export function blankQuestion(type: QType): EditQuestion {
  const base = { key: newKey(), type, text: '', marks: type === 'LONG' ? 5 : type === 'SHORT' ? 2 : 1 };
  if (type === 'MCQ' || type === 'MULTI') return { ...base, options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: '' })), answer: type === 'MCQ' ? '' : [] };
  if (type === 'TRUE_FALSE') return { ...base, answer: true };
  if (type === 'FILL') return { ...base, text: '', answer: [] };
  if (type === 'MATCH') return { ...base, options: { left: ['', '', ''], right: ['', '', ''] } };
  return base;
}

/** Drops empty extra options / matching pairs before saving, so unused blank rows don't block saving. */
export function cleanQuestion<T extends EditQuestion>(q: T): T {
  if ((q.type === 'MCQ' || q.type === 'MULTI') && Array.isArray(q.options)) {
    const options = (q.options as { id: string; text: string }[]).filter((o) => o.text.trim());
    return { ...q, options };
  }
  if (q.type === 'MATCH' && q.options) {
    const o = q.options as { left: string[]; right: string[] };
    const keep = o.left.map((l, i) => Boolean(l.trim() || (o.right[i] ?? '').trim()));
    return { ...q, options: { left: o.left.filter((_, i) => keep[i]), right: o.right.filter((_, i) => keep[i]) } };
  }
  return q;
}

const blanks = (t: string) => (t.match(/_{3,}/g) ?? []).length;

function ImagePicker({ value, onChange }: { value?: string | null; onChange: (id: string | null) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3">
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl(value)} alt="" className="h-16 rounded border border-gray-200 object-contain" />
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            const form = new FormData();
            form.append('category', 'EXAM');
            form.append('file', f);
            const r = await api.post<{ file: { id: string } }>('/files', form);
            onChange(r.file.id);
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Upload failed', 'error');
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button type="button" variant="ghost" onClick={() => input.current?.click()} loading={busy}>
        {value ? 'Change picture' : '+ Picture'}
      </Button>
      {value && (
        <button type="button" className="text-xs text-gray-500 hover:text-red-600" onClick={() => onChange(null)}>
          Remove
        </button>
      )}
    </div>
  );
}

/** Edits one question of any type. */
export function QuestionEditor({ q, onChange }: { q: EditQuestion; onChange: (q: EditQuestion) => void }) {
  const set = (patch: Partial<EditQuestion>) => onChange({ ...q, ...patch });
  const opts = (q.options as { id: string; text: string }[]) ?? [];
  const match = (q.options as { left: string[]; right: string[] }) ?? { left: [], right: [] };
  const fill = (q.answer as string[][]) ?? [];
  const nBlanks = blanks(q.text);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
        <Field label="Question" hint={q.type === 'FILL' ? 'Type ___ (three underscores) where each blank goes' : undefined}>
          <textarea className="input min-h-16" value={q.text} onChange={(e) => set({ text: e.target.value })} placeholder={q.type === 'FILL' ? 'The capital of Pakistan is ___.' : ''} />
        </Field>
        <Field label="Marks">
          <input className="input" type="number" min={0.25} step="0.25" value={q.marks} onChange={(e) => set({ marks: Number(e.target.value) })} />
        </Field>
      </div>
      <ImagePicker value={q.imageFileId} onChange={(imageFileId) => set({ imageFileId })} />

      {(q.type === 'MCQ' || q.type === 'MULTI') && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-500">Options — tick the correct {q.type === 'MCQ' ? 'one' : 'ones'}</div>
          {opts.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <input
                type={q.type === 'MCQ' ? 'radio' : 'checkbox'}
                name={`ans-${q.key}`}
                checked={q.type === 'MCQ' ? q.answer === o.id : ((q.answer as string[]) ?? []).includes(o.id)}
                onChange={(e) => {
                  if (q.type === 'MCQ') set({ answer: o.id });
                  else {
                    const cur = new Set((q.answer as string[]) ?? []);
                    if (e.target.checked) cur.add(o.id);
                    else cur.delete(o.id);
                    set({ answer: [...cur] });
                  }
                }}
                aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
              />
              <span className="w-5 text-sm font-semibold text-gray-500">{String.fromCharCode(65 + i)}</span>
              <input className="input flex-1 py-1.5" value={o.text} onChange={(e) => set({ options: opts.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })} />
              {opts.length > 2 && (
                <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => set({ options: opts.filter((x) => x.id !== o.id), answer: q.type === 'MCQ' ? (q.answer === o.id ? '' : q.answer) : ((q.answer as string[]) ?? []).filter((a) => a !== o.id) })} aria-label="Remove option">
                  ✕
                </button>
              )}
            </div>
          ))}
          {opts.length < 8 && (
            <Button type="button" variant="ghost" onClick={() => set({ options: [...opts, { id: newKey(), text: '' }] })}>
              + Option
            </Button>
          )}
        </div>
      )}

      {q.type === 'TRUE_FALSE' && (
        <div className="flex gap-4 text-sm">
          {[true, false].map((v) => (
            <label key={String(v)} className="flex items-center gap-2">
              <input type="radio" name={`tf-${q.key}`} checked={q.answer === v} onChange={() => set({ answer: v })} /> {v ? 'True' : 'False'} is correct
            </label>
          ))}
        </div>
      )}

      {q.type === 'FILL' && (
        <div className="space-y-2">
          {nBlanks === 0 ? (
            <p className="text-xs text-amber-700">Add ___ in the question for each blank.</p>
          ) : (
            Array.from({ length: nBlanks }, (_, i) => (
              <Field key={i} label={`Blank ${i + 1}: accepted answers`} hint="Separate different correct answers with commas. Capital letters and extra spaces don’t matter.">
                <input
                  className="input"
                  value={(fill[i] ?? []).join(', ')}
                  onChange={(e) => {
                    const next = Array.from({ length: nBlanks }, (_, j) => fill[j] ?? []);
                    next[i] = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                    set({ answer: next });
                  }}
                />
              </Field>
            ))
          )}
        </div>
      )}

      {q.type === 'MATCH' && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-500">Type matching pairs. Students see the right column mixed up.</div>
          {match.left.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input flex-1 py-1.5" placeholder="Left" value={l} onChange={(e) => set({ options: { ...match, left: match.left.map((x, j) => (j === i ? e.target.value : x)) } })} />
              <span className="text-gray-400">↔</span>
              <input className="input flex-1 py-1.5" placeholder="Matches" value={match.right[i] ?? ''} onChange={(e) => set({ options: { ...match, right: match.right.map((x, j) => (j === i ? e.target.value : x)) } })} />
              {match.left.length > 2 && (
                <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => set({ options: { left: match.left.filter((_, j) => j !== i), right: match.right.filter((_, j) => j !== i) } })} aria-label="Remove pair">
                  ✕
                </button>
              )}
            </div>
          ))}
          {match.left.length < 10 && (
            <Button type="button" variant="ghost" onClick={() => set({ options: { left: [...match.left, ''], right: [...match.right, ''] } })}>
              + Pair
            </Button>
          )}
        </div>
      )}

      {(q.type === 'SHORT' || q.type === 'LONG') && (
        <Field label="Model answer (optional, only you see it while checking)">
          <textarea className="input min-h-14" value={(q.answer as string) ?? ''} onChange={(e) => set({ answer: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

// ---------- Showing questions ----------

export interface StudentQ {
  id: string;
  sectionId: string;
  type: QType;
  text: string;
  imageFileId: string | null;
  marks: number;
  options?: { id: string; text: string }[];
  left?: string[];
  right?: { index: number; text: string }[];
  blanks?: number;
}

/** Interactive question for a student taking the exam. */
export function AnswerInput({ q, value, onChange, onUpload, disabled }: { q: StudentQ; value: unknown; onChange: (v: unknown) => void; onUpload?: (file: File) => Promise<string>; disabled?: boolean }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const noCopy = { onCopy: (e: React.ClipboardEvent) => e.preventDefault(), onPaste: (e: React.ClipboardEvent) => e.preventDefault(), onCut: (e: React.ClipboardEvent) => e.preventDefault() };

  if (q.type === 'MCQ' || q.type === 'TRUE_FALSE') {
    const opts = q.type === 'MCQ' ? q.options! : [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }];
    const cur = q.type === 'TRUE_FALSE' ? (value === true ? 'true' : value === false ? 'false' : '') : value;
    return (
      <div className="space-y-2">
        {opts.map((o, i) => (
          <label key={o.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition ${cur === o.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input type="radio" disabled={disabled} name={q.id} checked={cur === o.id} onChange={() => onChange(q.type === 'TRUE_FALSE' ? o.id === 'true' : o.id)} />
            {q.type === 'MCQ' && <span className="font-semibold text-gray-500">{String.fromCharCode(65 + i)}.</span>}
            <span>{o.text}</span>
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'MULTI') {
    const cur = new Set((value as string[]) ?? []);
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500">Choose all correct answers.</p>
        {q.options!.map((o, i) => (
          <label key={o.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm ${cur.has(o.id) ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={cur.has(o.id)}
              onChange={(e) => {
                const n = new Set(cur);
                if (e.target.checked) n.add(o.id);
                else n.delete(o.id);
                onChange([...n]);
              }}
            />
            <span className="font-semibold text-gray-500">{String.fromCharCode(65 + i)}.</span>
            <span>{o.text}</span>
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'FILL') {
    const cur = (value as string[]) ?? [];
    return (
      <div className="space-y-2">
        {Array.from({ length: q.blanks ?? 1 }, (_, i) => (
          <label key={i} className="flex items-center gap-3 text-sm">
            <span className="w-16 text-gray-500">Blank {i + 1}</span>
            <input
              className="input flex-1"
              disabled={disabled}
              autoComplete="off"
              value={cur[i] ?? ''}
              onChange={(e) => {
                const n = [...cur];
                n[i] = e.target.value;
                onChange(n);
              }}
              {...noCopy}
            />
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'MATCH') {
    const cur = (value as (number | null)[]) ?? [];
    return (
      <div className="space-y-2">
        {q.left!.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
            <span className="rounded-lg bg-gray-50 px-3 py-2">{l}</span>
            <span className="text-gray-400">→</span>
            <select
              className="input"
              disabled={disabled}
              value={cur[i] ?? ''}
              onChange={(e) => {
                const n = [...cur];
                n[i] = e.target.value === '' ? null : Number(e.target.value);
                onChange(n);
              }}
            >
              <option value="">Choose…</option>
              {q.right!.map((r) => (
                <option key={r.index} value={r.index}>
                  {r.text}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    );
  }
  // SHORT / LONG
  const isLong = q.type === 'LONG';
  const v = isLong ? ((value as { text?: string; fileIds?: string[] }) ?? {}) : null;
  const text = isLong ? (v!.text ?? '') : ((value as string) ?? '');
  return (
    <div className="space-y-2">
      <textarea
        className={`input ${isLong ? 'min-h-48' : 'min-h-24'}`}
        disabled={disabled}
        value={text}
        onChange={(e) => onChange(isLong ? { ...v, text: e.target.value } : e.target.value)}
        placeholder="Type your answer"
        {...noCopy}
      />
      {isLong && onUpload && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(v!.fileIds ?? []).map((id) => (
              <span key={id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(id)} alt="Answer page" className="h-20 rounded border border-gray-200 object-cover" />
                {!disabled && (
                  <button className="absolute -right-1 -top-1 rounded-full bg-white px-1 text-xs shadow" onClick={() => onChange({ ...v, fileIds: (v!.fileIds ?? []).filter((x) => x !== id) })} aria-label="Remove photo">
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              try {
                const id = await onUpload(f);
                onChange({ ...v, fileIds: [...(v!.fileIds ?? []), id] });
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Upload failed', 'error');
              } finally {
                setUploading(false);
                if (fileInput.current) fileInput.current.value = '';
              }
            }}
          />
          {!disabled && (
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()} loading={uploading}>
              📷 Add photo of written answer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Readable answer text for marking and result pages. */
export function describeAnswer(type: QType, options: unknown, value: unknown): string {
  if (value === null || value === undefined || value === '') return '— (not answered)';
  if (type === 'MCQ') return (options as { id: string; text: string }[])?.find((o) => o.id === value)?.text ?? String(value);
  if (type === 'MULTI') return ((value as string[]) ?? []).map((id) => (options as { id: string; text: string }[])?.find((o) => o.id === id)?.text ?? id).join(', ') || '—';
  if (type === 'TRUE_FALSE') return value ? 'True' : 'False';
  if (type === 'FILL') return ((value as string[]) ?? []).map((x, i) => `${i + 1}: ${x || '—'}`).join('   ');
  if (type === 'MATCH') {
    const o = options as { left: string[]; right: string[] };
    return ((value as (number | null)[]) ?? []).map((r, i) => `${o.left[i]} → ${r === null || r === undefined ? '—' : o.right[r]}`).join(' · ');
  }
  if (type === 'LONG') return (value as { text?: string }).text || '(photo only)';
  return String(value);
}

export function correctAnswerText(type: QType, options: unknown, answer: unknown): string {
  if (type === 'FILL') return ((answer as string[][]) ?? []).map((alts, i) => `${i + 1}: ${alts.join(' / ')}`).join('   ');
  if (type === 'MATCH') {
    const o = options as { left: string[]; right: string[] };
    return o.left.map((l, i) => `${l} → ${o.right[i]}`).join(' · ');
  }
  if (type === 'SHORT' || type === 'LONG') return (answer as string) || '';
  return describeAnswer(type, options, answer);
}
