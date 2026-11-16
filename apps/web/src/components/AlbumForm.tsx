'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Button, Field, Modal } from '@/components/ui';
import { className } from '@/lib/types';

export const VIS: Record<string, string> = { SCHOOL: 'Whole school', CLASSES: 'Some classes', STAFF: 'Staff only' };

export function AlbumForm({ value, onClose, onSaved }: { value?: { id: string; title: string; description: string | null; eventDate: string | null; visibility: string; classIds: string[] | null }; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const { data: structure } = useData<{ classes: { id: string; name: string; stream: string | null }[] }>('/setup/structure');
  const [f, setF] = useState({ title: value?.title ?? '', description: value?.description ?? '', eventDate: value?.eventDate?.slice(0, 10) ?? '', visibility: value?.visibility ?? 'SCHOOL', classIds: value?.classIds ?? [] });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={value ? 'Edit album' : 'New album'}>
      <div className="space-y-4">
        <Field label="Title">
          <input className="input" value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Sports Day 2026" />
        </Field>
        <Field label="Description (optional)">
          <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Event date (optional)">
          <input className="input" type="date" value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} />
        </Field>
        <div>
          <div className="label">Who can see it</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(VIS).map(([k, v]) => (
              <button key={k} type="button" onClick={() => setF({ ...f, visibility: k })} className={`rounded-full border px-3 py-1 text-sm transition ${f.visibility === k ? 'border-brand-500 bg-brand-50 font-medium text-brand-800' : 'border-gray-200 text-gray-600'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        {f.visibility === 'CLASSES' && (
          <div className="flex animate-fade-up flex-wrap gap-2">
            {structure?.classes.map((c) => (
              <label key={c.id} className={`cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition ${f.classIds.includes(c.id) ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}>
                <input type="checkbox" className="sr-only" checked={f.classIds.includes(c.id)} onChange={() => setF({ ...f, classIds: f.classIds.includes(c.id) ? f.classIds.filter((x) => x !== c.id) : [...f.classIds, c.id] })} />
                {className(c)}
              </label>
            ))}
          </div>
        )}
        <Button
          loading={busy}
          disabled={f.title.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            try {
              const body = { ...f, description: f.description || null, eventDate: f.eventDate || null };
              if (value) {
                await api.patch(`/gallery/albums/${value.id}`, body);
                onSaved(value.id);
              } else {
                const r = await api.post<{ id: string }>('/gallery/albums', body);
                onSaved(r.id);
              }
              toast('Album saved');
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          {value ? 'Save' : 'Create album'}
        </Button>
      </div>
    </Modal>
  );
}
