'use client';

import { useRef, useState } from 'react';
import { api, fileUrl } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui';
import { bytes } from '@/lib/format';

export interface FileInfo {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

const icon = (m: string) => (m.startsWith('image/') ? '🖼' : m === 'application/pdf' ? '📕' : m.includes('word') ? '📘' : m.includes('sheet') || m.includes('excel') || m === 'text/csv' ? '📗' : m.includes('presentation') || m.includes('powerpoint') ? '📙' : '📄');

/** Downloadable attachments; images show a small preview. */
export function FileList({ files }: { files: FileInfo[] }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((f) =>
        f.mimeType.startsWith('image/') ? (
          <li key={f.id}>
            <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" title={f.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(f.id)} alt={f.name} className="h-20 w-20 rounded-lg border border-gray-200 object-cover" />
            </a>
          </li>
        ) : (
          <li key={f.id}>
            <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="flex max-w-[16rem] items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-brand-300 hover:bg-brand-50">
              <span aria-hidden>{icon(f.mimeType)}</span>
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-gray-400">{bytes(f.sizeBytes)}</span>
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

/** Upload one or more files (PDF, Word, Excel, PowerPoint, images) and keep their ids. */
export function FileAttach({ value, onChange, category, max = 5 }: { value: FileInfo[]; onChange: (files: FileInfo[]) => void; category: string; max?: number }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 space-y-1">
          {value.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <span aria-hidden>{icon(f.mimeType)}</span>
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-gray-400">{bytes(f.sizeBytes)}</span>
              <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => onChange(value.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
        onChange={async (e) => {
          const list = [...(e.target.files ?? [])].slice(0, max - value.length);
          e.target.value = '';
          if (!list.length) return;
          setBusy(true);
          const added: FileInfo[] = [];
          for (const file of list) {
            try {
              const fd = new FormData();
              fd.append('category', category);
              fd.append('file', file);
              const r = await api.post<{ file: { id: string; originalName: string; mimeType: string; sizeBytes: number } }>('/files', fd);
              added.push({ id: r.file.id, name: r.file.originalName, mimeType: r.file.mimeType, sizeBytes: r.file.sizeBytes });
            } catch (err) {
              toast(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`, 'error');
            }
          }
          onChange([...value, ...added]);
          setBusy(false);
        }}
      />
      {value.length < max && (
        <Button type="button" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
          📎 Attach files
        </Button>
      )}
    </div>
  );
}
