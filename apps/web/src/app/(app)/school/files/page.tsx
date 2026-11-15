'use client';

import { useRef, useState } from 'react';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Table, Td } from '@/components/ui';
import { StorageAlert } from '@/components/UsageBars';
import { bytes, categoryLabel, dateTime } from '@/lib/format';
import type { StoredFile, Usage } from '@/lib/types';

const uploadable = ['SCHOOL_DOCUMENT', 'SYLLABUS', 'STUDY_MATERIAL', 'GALLERY', 'LOGO', 'OTHER'];

export default function FilesPage() {
  const toast = useToast();
  const { me } = useAuth();
  const readOnly = me?.school?.effectiveStatus === 'READ_ONLY';
  const [category, setCategory] = useState('');
  const [uploadCategory, setUploadCategory] = useState('SCHOOL_DOCUMENT');
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { data, error, loading, reload } = useData<{ files: StoredFile[]; total: number }>(`/files${category ? `?category=${category}` : ''}`);
  const { data: overview, reload: reloadUsage } = useData<{ usage: Usage }>('/school/overview');

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('category', uploadCategory);
      form.append('file', file);
      try {
        await api.post('/files', form);
        ok++;
      } catch (e) {
        toast(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`, 'error');
      }
    }
    if (ok) toast(`${ok} file${ok > 1 ? 's' : ''} uploaded`);
    setUploading(false);
    if (input.current) input.current.value = '';
    reload();
    reloadUsage();
  }

  async function remove(f: StoredFile) {
    if (!confirm(`Delete "${f.originalName}"?`)) return;
    try {
      await api.del(`/files/${f.id}`);
      toast('File deleted');
      reload();
      reloadUsage();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  return (
    <>
      <PageHeader title="Files" subtitle="School documents and uploads. Everything here counts towards your storage." />
      {overview && (
        <div className="mb-4">
          <StorageAlert usage={overview.usage} />
        </div>
      )}
      <Card title="Upload" className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <select className="input w-auto" value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)}>
            {uploadable.map((c) => (
              <option key={c} value={c}>
                {categoryLabel[c]}
              </option>
            ))}
          </select>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" />
          <Button onClick={() => input.current?.click()} loading={uploading} disabled={readOnly || overview?.usage.storage.level === 'full'}>
            Choose files
          </Button>
          {overview && (
            <span className="text-sm text-gray-500">
              Max {bytes(overview.usage.maxFileBytes)} per file · {bytes(Math.max(0, overview.usage.storage.limitBytes - overview.usage.storage.usedBytes))} free
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500">Images, PDF, Word, Excel, PowerPoint, text and CSV files.</p>
      </Card>
      <Card
        title={`All files${data ? ` (${data.total})` : ''}`}
        actions={
          <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(categoryLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        }
      >
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.files.length ? (
          <Empty title="No files yet" />
        ) : (
          <Table head={['Name', 'Type', 'Size', 'Uploaded', '']}>
            {data.files.map((f) => (
              <tr key={f.id}>
                <Td>
                  <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="block max-w-xs truncate font-medium text-gray-900 hover:text-brand-700 hover:underline">
                    {f.originalName}
                  </a>
                </Td>
                <Td>{categoryLabel[f.category] ?? f.category}</Td>
                <Td>{bytes(f.sizeBytes)}</Td>
                <Td className="text-gray-600">{dateTime(f.createdAt)}</Td>
                <Td className="text-right">
                  <Button variant="ghost" onClick={() => remove(f)} disabled={readOnly}>
                    Delete
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
