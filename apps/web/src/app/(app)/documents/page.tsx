'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { FileAttach, FileList, type FileInfo } from '@/components/lms/Files';
import { date } from '@/lib/format';

interface Doc {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  file: FileInfo | null;
  audience?: string[];
  createdAt: string;
}
const AUD: Record<string, string> = { STAFF: 'Office staff', TEACHER: 'Teachers', PARENT: 'Parents', STUDENT: 'Students' };

export default function DocumentsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useData<{ documents: Doc[]; canManage: boolean }>('/lms/documents');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: '', audience: ['TEACHER', 'STAFF', 'PARENT', 'STUDENT'] as string[] });
  const [files, setFiles] = useState<FileInfo[]>([]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const groups = new Map<string, Doc[]>();
  for (const d of data?.documents ?? []) groups.set(d.category ?? 'General', [...(groups.get(d.category ?? 'General') ?? []), d]);
  return (
    <>
      <PageHeader title="School documents" subtitle="Policies, forms, circulars and other documents from the school." actions={data?.canManage && <Button onClick={() => setAdding(true)}>+ Add document</Button>} />
      {!data?.documents.length ? (
        <Empty title="No documents yet" />
      ) : (
        <div className="space-y-6">
          {[...groups].map(([cat, docs]) => (
            <Card key={cat} title={cat}>
              <ul className="divide-y divide-gray-100">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{d.title}</div>
                      {d.description && <p className="text-sm text-gray-600">{d.description}</p>}
                      <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-500">
                        {date(d.createdAt)}
                        {d.audience?.map((a) => (
                          <Badge key={a} tone="gray">
                            {AUD[a]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    {d.file && <FileList files={[d.file]} />}
                    {data.canManage && (
                      <button
                        className="text-sm text-red-600 hover:underline"
                        onClick={async () => {
                          if (!confirm('Remove this document?')) return;
                          await api.del(`/lms/documents/${d.id}`);
                          reload();
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Add document">
          <div className="space-y-4">
            <Field label="Title">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Uniform policy 2026" />
            </Field>
            <Field label="Category (optional)">
              <input className="input" list="doc-cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <datalist id="doc-cats">
                {['Policies', 'Forms', 'Circulars', 'Calendar', 'Fee', 'Staff'].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Description (optional)">
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div>
              <div className="label">Who can see it</div>
              <div className="flex flex-wrap gap-3 text-sm">
                {Object.entries(AUD).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={form.audience.includes(k)} onChange={(e) => setForm({ ...form, audience: e.target.checked ? [...form.audience, k] : form.audience.filter((x) => x !== k) })} /> {l}
                  </label>
                ))}
              </div>
            </div>
            <FileAttach value={files} onChange={(f) => setFiles(f.slice(-1))} category="SCHOOL_DOCUMENT" max={1} />
            <Button
              disabled={!files.length || form.title.trim().length < 2 || !form.audience.length}
              onClick={async () => {
                try {
                  await api.post('/lms/documents', { ...form, category: form.category || null, description: form.description || null, fileId: files[0].id });
                  toast('Document added');
                  setAdding(false);
                  setFiles([]);
                  setForm({ ...form, title: '', description: '' });
                  reload();
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Failed', 'error');
                }
              }}
            >
              Add document
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
