'use client';

import { Badge } from '@/components/ui';
import { FileList, type FileInfo } from '@/components/lms/Files';
import { KIND_ICON, KIND_LABEL } from '@/components/lms/shared';
import { date } from '@/lib/format';

export interface Material {
  id: string;
  classId: string;
  classLabel: string;
  subjectId: string | null;
  subject: string | null;
  sectionIds?: string[] | null;
  chapterId: string | null;
  chapter: string | null;
  kind: string;
  title: string;
  description: string | null;
  url: string | null;
  files: FileInfo[];
  createdBy: string;
  createdAt: string;
  canEdit?: boolean;
}

export function MaterialCard({ m, onEdit, onDelete }: { m: Material; onEdit?: () => void; onDelete?: () => void }) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden>
          {KIND_ICON[m.kind] ?? '📎'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{m.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            <Badge tone="blue">{KIND_LABEL[m.kind]}</Badge>
            <span>
              {m.subject ?? 'All subjects'} · {m.classLabel}
              {m.chapter && ` · ${m.chapter}`}
            </span>
            <span>
              {m.createdBy} · {date(m.createdAt)}
            </span>
          </div>
          {m.description && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{m.description}</p>}
          {m.url && (
            <a href={m.url} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block break-all text-sm text-brand-700 hover:underline">
              {m.kind === 'VIDEO' ? '▶ Watch video' : '🔗 Open link'}
            </a>
          )}
          {m.files.length > 0 && (
            <div className="mt-2">
              <FileList files={m.files} />
            </div>
          )}
        </div>
        {(onEdit || onDelete) && (
          <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
            {onEdit && (
              <button className="text-brand-700 hover:underline" onClick={onEdit}>
                Edit
              </button>
            )}
            {onDelete && (
              <button className="text-red-600 hover:underline" onClick={onDelete}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

