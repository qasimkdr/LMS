'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Badge, Button, Field, Modal, type Tone } from '@/components/ui';
import { date } from '@/lib/format';

export type RemarkCategory = 'ACADEMIC' | 'BEHAVIOR' | 'DISCIPLINE' | 'APPRECIATION' | 'HEALTH' | 'OTHER';
export const CATEGORY_LABEL: Record<RemarkCategory, string> = { ACADEMIC: 'Academic', BEHAVIOR: 'Behavior', DISCIPLINE: 'Discipline', APPRECIATION: 'Appreciation', HEALTH: 'Health', OTHER: 'Other' };
export const categoryTone: Record<RemarkCategory, Tone> = { ACADEMIC: 'blue', BEHAVIOR: 'amber', DISCIPLINE: 'red', APPRECIATION: 'green', HEALTH: 'gray', OTHER: 'gray' };

export interface Remark {
  id: string;
  studentId: string;
  student: { id: string; fullName: string; rollNo: string | null; classLabel: string } | null;
  category: RemarkCategory;
  text: string;
  date: string;
  shared: boolean;
  sentAt: string | null;
  by: { id: string; fullName: string; role: string } | null;
  mine?: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Write one remark for one or many students. */
export function RemarkForm({ studentIds, title, onClose, onSaved }: { studentIds: string[]; title: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [category, setCategory] = useState<RemarkCategory>('ACADEMIC');
  const [text, setText] = useState('');
  const [day, setDay] = useState(today());
  const [shared, setShared] = useState(true);
  const [whatsapp, setWhatsapp] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api.post<{ created: number; whatsapp: number }>('/remarks', { studentIds, category, text, date: day, shared, whatsapp: shared && whatsapp });
      toast(`Remark saved for ${r.created} student${r.created === 1 ? '' : 's'}${r.whatsapp ? ` · ${r.whatsapp} WhatsApp message(s) queued` : ''}`);
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CATEGORY_LABEL) as RemarkCategory[]).map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={`rounded-full border px-3 py-1 text-sm ${category === c ? 'border-brand-500 bg-brand-50 font-medium text-brand-800' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <Field label="Remark">
          <textarea className="input min-h-28" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="e.g. Ali answered every question in class today. Well done!" />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          <span>
            Share with parents
            <span className="block text-xs text-gray-500">Parents and the student see it in the app and in the monthly report. Untick for a staff-only note.</span>
          </span>
        </label>
        {shared && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
            <span>
              Also send on WhatsApp
              <span className="block text-xs text-gray-500">If the school sends remarks automatically, they go on WhatsApp anyway.</span>
            </span>
          </label>
        )}
        <Button onClick={save} loading={busy} disabled={text.trim().length < 2}>
          Save remark
        </Button>
      </div>
    </Modal>
  );
}

/** List of remarks with edit/delete for the writer (and principal). */
export function RemarkList({ remarks, showStudent, canEdit, onChanged }: { remarks: Remark[]; showStudent?: boolean; canEdit?: (r: Remark) => boolean; onChanged?: () => void }) {
  const toast = useToast();
  if (!remarks.length) return <p className="text-sm text-gray-500">No remarks yet.</p>;
  return (
    <ul className="divide-y divide-gray-100">
      {remarks.map((r) => (
        <li key={r.id} className="py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <Badge tone={categoryTone[r.category]}>{CATEGORY_LABEL[r.category]}</Badge>
            {!r.shared && <Badge tone="gray">Staff only</Badge>}
            {showStudent && r.student && (
              <span className="font-medium text-gray-800">
                {r.student.fullName} · {r.student.classLabel}
              </span>
            )}
            <span>
              {date(r.date)}
              {r.by && ` · ${r.by.fullName}`}
              {r.sentAt && ' · sent on WhatsApp'}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{r.text}</p>
          {canEdit?.(r) && (
            <div className="mt-1 flex gap-3 text-xs">
              {r.shared && !r.sentAt && (
                <button
                  className="text-brand-700 hover:underline"
                  onClick={async () => {
                    try {
                      const x = await api.post<{ whatsapp: number }>(`/remarks/${r.id}/send`);
                      toast(x.whatsapp ? 'Sent on WhatsApp' : 'WhatsApp is off or not connected; parents see it in the app');
                      onChanged?.();
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Failed', 'error');
                    }
                  }}
                >
                  Send on WhatsApp
                </button>
              )}
              <button
                className="text-gray-600 hover:underline"
                onClick={async () => {
                  await api.patch(`/remarks/${r.id}`, { shared: !r.shared });
                  onChanged?.();
                }}
              >
                {r.shared ? 'Make staff-only' : 'Share with parents'}
              </button>
              <button
                className="text-red-600 hover:underline"
                onClick={async () => {
                  if (!confirm('Delete this remark?')) return;
                  await api.del(`/remarks/${r.id}`);
                  onChanged?.();
                }}
              >
                Delete
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
