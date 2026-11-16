'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { FileAttach, type FileInfo } from '@/components/lms/Files';
import { MaterialCard, type Material } from '@/components/lms/Material';
import { KIND_LABEL, type MyClass } from '@/components/lms/shared';

const KINDS = ['NOTES', 'WORKSHEET', 'BOOK', 'VIDEO', 'LINK', 'OTHER'];

export default function MaterialPage() {
  const classes = useData<{ sections: MyClass[] }>('/lms/my-classes');
  const structure = useData<{ classes: { id: string; name: string; stream: string | null; subjects: { id: string; name: string }[] }[] }>('/setup/structure');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Material> | null>(null);
  const params = new URLSearchParams(Object.entries({ classId, subjectId, kind, q }).filter(([, v]) => v) as [string, string][]);
  const { data, error, loading, reload } = useData<{ material: Material[] }>(`/lms/material?${params}`);
  const cls = structure.data?.classes.find((c) => c.id === classId);
  const canShare = (classes.data?.sections.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Study material"
        subtitle="Notes, worksheets, books, videos and links for students and parents."
        actions={canShare && <Button onClick={() => setEditing({ kind: 'NOTES', files: [] })}>+ Share material</Button>}
      />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select className="input" value={classId} onChange={(e) => { setClassId(e.target.value); setSubjectId(''); }} aria-label="Class">
            <option value="">All classes</option>
            {structure.data?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.stream ? ` ${c.stream}` : ''}
              </option>
            ))}
          </select>
          <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject" disabled={!cls}>
            <option value="">All subjects</option>
            {cls?.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>
      {error ? (
        <ErrorBox error={error} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.material.length ? (
        <Empty title="No material yet">Share notes, worksheets or video links for your classes.</Empty>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {data.material.map((m) => (
            <MaterialCard
              key={m.id}
              m={m}
              onEdit={m.canEdit ? () => setEditing(m) : undefined}
              onDelete={
                m.canEdit
                  ? async () => {
                      if (!confirm('Delete this material?')) return;
                      await api.del(`/lms/material/${m.id}`);
                      reload();
                    }
                  : undefined
              }
            />
          ))}
        </ul>
      )}
      {editing && classes.data && <MaterialForm value={editing} sections={classes.data.sections} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  );
}

function MaterialForm({ value, sections, onClose, onSaved }: { value: Partial<Material>; sections: MyClass[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  // Classes the user can share with, and the subjects they teach in each.
  const classes = useMemo(() => {
    const m = new Map<string, { classId: string; label: string; sections: MyClass[]; subjects: Map<string, string>; anyClassTeacher: boolean }>();
    for (const s of sections) {
      const label = s.label.replace(/ [^ ]+$/, '');
      const c = m.get(s.classId) ?? { classId: s.classId, label, sections: [] as MyClass[], subjects: new Map<string, string>(), anyClassTeacher: false };
      c.sections.push(s);
      s.subjects.forEach((x) => c.subjects.set(x.id, x.name));
      c.anyClassTeacher ||= s.classTeacher;
      m.set(s.classId, c);
    }
    return [...m.values()];
  }, [sections]);
  const [classId, setClassId] = useState(value.classId ?? classes[0]?.classId ?? '');
  const cls = classes.find((c) => c.classId === classId);
  const [subjectId, setSubjectId] = useState<string>(value.subjectId ?? (cls ? ([...cls.subjects.keys()][0] ?? '') : ''));
  const [sectionIds, setSectionIds] = useState<string[]>(value.sectionIds ?? []);
  const [chapterId, setChapterId] = useState(value.chapterId ?? '');
  const [kind, setKind] = useState(value.kind ?? 'NOTES');
  const [title, setTitle] = useState(value.title ?? '');
  const [description, setDescription] = useState(value.description ?? '');
  const [url, setUrl] = useState(value.url ?? '');
  const [files, setFiles] = useState<FileInfo[]>(value.files ?? []);
  const [busy, setBusy] = useState(false);
  const chapters = useData<{ chapters: { id: string; title: string }[] }>(classId && subjectId ? `/lms/syllabus?classId=${classId}&subjectId=${subjectId}` : null);

  async function save() {
    setBusy(true);
    try {
      const body = { classId, subjectId: subjectId || null, sectionIds: sectionIds.length && cls && sectionIds.length < cls.sections.length ? sectionIds : null, chapterId: chapterId || null, kind, title, description: description || null, url: url || null, fileIds: files.map((f) => f.id) };
      if (value.id) await api.put(`/lms/material/${value.id}`, body);
      else await api.post('/lms/material', body);
      toast('Material shared');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={value.id ? 'Edit material' : 'Share study material'} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class">
          <select className="input" value={classId} onChange={(e) => { setClassId(e.target.value); setSubjectId([...(classes.find((c) => c.classId === e.target.value)?.subjects.keys() ?? [])][0] ?? ''); setSectionIds([]); setChapterId(''); }}>
            {classes.map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject">
          <select className="input" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setChapterId(''); }}>
            {cls?.anyClassTeacher && <option value="">General (all subjects)</option>}
            {[...(cls?.subjects ?? [])].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        {cls && cls.sections.length > 1 && (
          <div className="sm:col-span-2">
            <div className="label">Sections</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {cls.sections.map((s) => (
                <label key={s.sectionId} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={!sectionIds.length || sectionIds.includes(s.sectionId)} onChange={(e) => {
                    const cur = sectionIds.length ? sectionIds : cls.sections.map((x) => x.sectionId);
                    setSectionIds(e.target.checked ? [...cur, s.sectionId] : cur.filter((x) => x !== s.sectionId));
                  }} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        )}
        <Field label="Type">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Chapter (optional)">
          <select className="input" value={chapterId} onChange={(e) => setChapterId(e.target.value)} disabled={!chapters.data?.chapters.length}>
            <option value="">{chapters.data?.chapters.length ? 'Not linked to a chapter' : 'No syllabus chapters yet'}</option>
            {chapters.data?.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Title">
            <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chapter 3 notes – Fractions" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description (optional)">
            <textarea className="input min-h-20" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        {(kind === 'VIDEO' || kind === 'LINK' || url) && (
          <div className="sm:col-span-2">
            <Field label={kind === 'VIDEO' ? 'Video link (YouTube etc.)' : 'Link'}>
              <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Files">
            <FileAttach value={files} onChange={setFiles} category="STUDY_MATERIAL" max={10} />
          </Field>
        </div>
      </div>
      <Button className="mt-4" onClick={save} loading={busy} disabled={title.trim().length < 2 || !classId}>
        {value.id ? 'Save' : 'Share'}
      </Button>
    </Modal>
  );
}
