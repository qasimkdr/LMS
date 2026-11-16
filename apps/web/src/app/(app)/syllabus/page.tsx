'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Tabs } from '@/components/Tabs';
import { Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Progress, Table, Td } from '@/components/ui';
import { FileAttach, FileList, type FileInfo } from '@/components/lms/Files';
import type { MyClass } from '@/components/lms/shared';
import { date } from '@/lib/format';

interface Done {
  completedOn: string;
  by?: string;
}
interface Chapter {
  id: string;
  title: string;
  term: string | null;
  topics: { id: string; title: string; done: Done | null }[];
  done: Done | null;
  total: number;
  completed: number;
}
interface Syllabus {
  chapters: Chapter[];
  total: number;
  completed: number;
  percent: number;
  documents: { id: string; title: string; files: FileInfo[] }[];
  canEdit: boolean;
  canMark: boolean;
}
interface CoverageRow {
  sectionId: string;
  classLabel: string;
  subjectId: string;
  subject: string;
  teacher: string | null;
  total: number;
  completed: number;
  percent: number | null;
  lastOn: string | null;
}

export default function SyllabusPage() {
  const [tab, setTab] = useState<'syllabus' | 'coverage'>('syllabus');
  const [pick, setPick] = useState<{ sectionId: string; subjectId: string } | null>(null);
  return (
    <>
      <PageHeader title="Syllabus" subtitle="Chapters and topics for each class and subject, and how much each section has covered." />
      <Tabs
        tabs={[
          { key: 'syllabus', label: 'Syllabus & progress' },
          { key: 'coverage', label: 'Coverage report' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'syllabus' ? (
        <SyllabusTab pick={pick} setPick={setPick} />
      ) : (
        <Coverage
          onOpen={(p) => {
            setPick(p);
            setTab('syllabus');
          }}
        />
      )}
    </>
  );
}

function Coverage({ onOpen }: { onOpen: (p: { sectionId: string; subjectId: string }) => void }) {
  const { data, error, loading } = useData<{ rows: CoverageRow[] }>('/lms/syllabus/coverage');
  const [cls, setCls] = useState('');
  const classes = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.classLabel))], [data]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const rows = (data?.rows ?? []).filter((r) => !cls || r.classLabel === cls);
  const withSyl = rows.filter((r) => r.percent !== null);
  const avg = withSyl.length ? Math.round(withSyl.reduce((s, r) => s + r.percent!, 0) / withSyl.length) : null;
  return (
    <Card
      title={avg === null ? 'Coverage' : `Coverage · average ${avg}%`}
      actions={
        classes.length > 1 && (
          <select className="input w-auto py-1" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class">
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )
      }
    >
      {!rows.length ? (
        <Empty title="No classes yet" />
      ) : (
        <Table head={['Class', 'Subject', 'Teacher', 'Covered', 'Last update', '']}>
          {rows.map((r) => (
            <tr key={`${r.sectionId}-${r.subjectId}`}>
              <Td>{r.classLabel}</Td>
              <Td className="font-medium">{r.subject}</Td>
              <Td>{r.teacher ?? <span className="text-gray-400">—</span>}</Td>
              <Td className="min-w-48">
                {r.percent === null ? (
                  <span className="text-sm text-gray-400">No syllabus yet</span>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full rounded-full ${r.percent >= 75 ? 'bg-green-500' : r.percent >= 40 ? 'bg-brand-500' : 'bg-amber-500'}`} style={{ width: `${r.percent}%` }} />
                    </div>
                    <span className="text-sm">
                      {r.percent}% <span className="text-xs text-gray-500">({r.completed}/{r.total})</span>
                    </span>
                  </div>
                )}
              </Td>
              <Td>{r.lastOn ? date(r.lastOn) : '—'}</Td>
              <Td>
                <button className="text-sm text-brand-700 hover:underline" onClick={() => onOpen({ sectionId: r.sectionId, subjectId: r.subjectId })}>
                  Open
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function SyllabusTab({ pick, setPick }: { pick: { sectionId: string; subjectId: string } | null; setPick: (p: { sectionId: string; subjectId: string }) => void }) {
  const toast = useToast();
  const classes = useData<{ sections: MyClass[] }>('/lms/my-classes');
  const list = classes.data?.sections ?? [];
  const sec = list.find((s) => s.sectionId === pick?.sectionId) ?? list[0];
  // Subjects: managers/class teachers see all class subjects here, too.
  const subjects = sec?.subjects ?? [];
  const subjectId = subjects.some((s) => s.id === pick?.subjectId) ? pick!.subjectId : subjects[0]?.id;
  const { data, error, loading, reload } = useData<Syllabus>(sec && subjectId ? `/lms/syllabus?classId=${sec.classId}&subjectId=${subjectId}&sectionId=${sec.sectionId}` : null);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Ticks show at once; the server's answer replaces them when it arrives.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  useEffect(() => setOptimistic({}), [data]);
  const isDone = (id: string, done: Done | null) => optimistic[id] ?? Boolean(done);

  async function mark(itemIds: string[], done: boolean) {
    setOptimistic((o) => ({ ...o, ...Object.fromEntries(itemIds.map((id) => [id, done])) }));
    try {
      await api.put('/lms/syllabus/progress', { sectionId: sec!.sectionId, subjectId, itemIds, done });
      reload();
    } catch (e) {
      setOptimistic({});
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  if (classes.loading && !classes.data) return <Loading />;
  if (!list.length) return <Empty title="You have no classes yet" />;
  const subjectName = subjects.find((s) => s.id === subjectId)?.name ?? '';
  const terms = [...new Set((data?.chapters ?? []).map((c) => c.term ?? ''))];

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input w-auto" value={sec?.sectionId} onChange={(e) => setPick({ sectionId: e.target.value, subjectId: subjectId ?? '' })} aria-label="Class">
          {list.map((s) => (
            <option key={s.sectionId} value={s.sectionId}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={subjectId} onChange={(e) => setPick({ sectionId: sec!.sectionId, subjectId: e.target.value })} aria-label="Subject">
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {!subjectId ? (
        <Empty title="No subjects for this class" />
      ) : error ? (
        <ErrorBox error={error} />
      ) : loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card
            title={`${subjectName} · ${sec?.label}`}
            actions={
              data.canEdit && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {data.chapters.length ? 'Edit chapters' : '+ Write syllabus'}
                </Button>
              )
            }
          >
            {!data.chapters.length ? (
              <p className="text-sm text-gray-500">No chapters yet.{data.canEdit ? ' Press "Write syllabus" to add them.' : ''}</p>
            ) : (
              <div className="space-y-5">
                {terms.map((term) => (
                  <div key={term}>
                    {term && <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{term}</div>}
                    <ol className="space-y-2">
                      {data.chapters
                        .filter((c) => (c.term ?? '') === term)
                        .map((c) => (
                          <li key={c.id} className="rounded-lg border border-gray-200 p-3">
                            <div className="flex items-start gap-3">
                              {!c.topics.length && <input type="checkbox" className="mt-1" disabled={!data.canMark} checked={isDone(c.id, c.done)} onChange={(e) => mark([c.id], e.target.checked)} aria-label={`${c.title} done`} />}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`font-medium ${c.completed === c.total ? 'text-green-700' : ''}`}>{c.title}</span>
                                  {c.topics.length > 0 && (
                                    <span className="text-xs text-gray-500">
                                      {c.completed}/{c.total} topics
                                    </span>
                                  )}
                                  {c.done && (
                                    <span className="text-xs text-gray-500">
                                      done {date(c.done.completedOn)}
                                      {c.done.by && ` · ${c.done.by}`}
                                    </span>
                                  )}
                                  {data.canMark && c.topics.length > 0 && c.completed < c.total && (
                                    <button className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => mark(c.topics.filter((t) => !t.done).map((t) => t.id), true)}>
                                      Mark chapter done
                                    </button>
                                  )}
                                </div>
                                {c.topics.length > 0 && (
                                  <ul className="mt-2 space-y-1">
                                    {c.topics.map((t) => (
                                      <li key={t.id}>
                                        <label className="flex items-center gap-2 text-sm">
                                          <input type="checkbox" disabled={!data.canMark} checked={isDone(t.id, t.done)} onChange={(e) => mark([t.id], e.target.checked)} />
                                          <span className={isDone(t.id, t.done) ? 'text-gray-500 line-through' : ''}>{t.title}</span>
                                          {t.done && (
                                            <span className="text-xs text-gray-400">
                                              {date(t.done.completedOn)}
                                              {t.done.by && ` · ${t.done.by}`}
                                            </span>
                                          )}
                                        </label>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div className="space-y-6">
            <Card title="Progress">
              <Progress percent={data.total ? data.percent : null} label={`${data.completed} of ${data.total} done`} />
              {!data.canMark && data.total > 0 && <p className="mt-3 text-xs text-gray-500">Only the teacher of this subject marks progress.</p>}
            </Card>
            <Card
              title="Syllabus files"
              actions={
                data.canEdit && (
                  <Button variant="ghost" onClick={() => setUploading(true)}>
                    + Upload
                  </Button>
                )
              }
            >
              {!data.documents.length ? (
                <p className="text-sm text-gray-500">No PDF or document uploaded.</p>
              ) : (
                <ul className="space-y-3">
                  {data.documents.map((d) => (
                    <li key={d.id}>
                      <div className="mb-1 flex items-center justify-between text-sm font-medium">
                        {d.title}
                        {data.canEdit && (
                          <button
                            className="text-xs font-normal text-red-600 hover:underline"
                            onClick={async () => {
                              if (!confirm('Remove this file?')) return;
                              await api.del(`/lms/material/${d.id}`);
                              reload();
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <FileList files={d.files} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      ) : null}
      {editing && data && sec && subjectId && <ChapterEditor classId={sec.classId} subjectId={subjectId} title={`${subjectName} syllabus · ${sec.label.replace(/ [^ ]+$/, '')}`} chapters={data.chapters} onClose={() => setEditing(false)} onSaved={reload} />}
      {uploading && sec && subjectId && <SyllabusUpload classId={sec.classId} subjectId={subjectId} onClose={() => setUploading(false)} onSaved={reload} />}
    </>
  );
}

interface EditCh {
  key: string;
  id?: string;
  title: string;
  term: string;
  topics: { key: string; id?: string; title: string }[];
}
let k = 0;
const key = () => `n${++k}`;

function ChapterEditor({ classId, subjectId, title, chapters, onClose, onSaved }: { classId: string; subjectId: string; title: string; chapters: Chapter[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<EditCh[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setList(chapters.length ? chapters.map((c) => ({ key: c.id, id: c.id, title: c.title, term: c.term ?? '', topics: c.topics.map((t) => ({ key: t.id, id: t.id, title: t.title })) })) : [{ key: key(), title: '', term: '', topics: [] }]);
  }, [chapters]);
  const set = (i: number, c: Partial<EditCh>) => setList(list.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    setList(n);
  };
  async function save() {
    setBusy(true);
    try {
      await api.put('/lms/syllabus', {
        classId,
        subjectId,
        chapters: list.filter((c) => c.title.trim()).map((c) => ({ id: c.id, title: c.title, term: c.term || null, topics: c.topics.filter((t) => t.title.trim()).map((t) => ({ id: t.id, title: t.title })) })),
      });
      toast('Syllabus saved');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={title} wide>
      <p className="mb-3 text-xs text-gray-500">The same syllabus is used by every section of the class. Topics are optional; a chapter without topics is ticked as a whole. Removing a chapter or topic also removes its progress.</p>
      <ol className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {list.map((c, i) => (
          <li key={c.key} className="rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-sm font-semibold text-gray-400">{i + 1}.</span>
              <input className="input min-w-40 flex-1 py-1.5" placeholder="Chapter title" value={c.title} onChange={(e) => set(i, { title: e.target.value })} />
              <input className="input w-32 py-1.5" placeholder="Term (optional)" value={c.term} list="terms" onChange={(e) => set(i, { term: e.target.value })} />
              <span className="flex gap-1 text-gray-400">
                <button type="button" onClick={() => move(i, -1)} aria-label="Move up">
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} aria-label="Move down">
                  ↓
                </button>
                <button type="button" className="hover:text-red-600" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Remove chapter">
                  ✕
                </button>
              </span>
            </div>
            <ul className="ml-8 mt-2 space-y-1.5">
              {c.topics.map((t, ti) => (
                <li key={t.key} className="flex items-center gap-2">
                  <span className="text-gray-300">•</span>
                  <input className="input flex-1 py-1" placeholder="Topic" value={t.title} onChange={(e) => set(i, { topics: c.topics.map((x, j) => (j === ti ? { ...x, title: e.target.value } : x)) })} />
                  <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => set(i, { topics: c.topics.filter((_, j) => j !== ti) })} aria-label="Remove topic">
                    ✕
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => set(i, { topics: [...c.topics, { key: key(), title: '' }] })}>
                  + Topic
                </button>
              </li>
            </ul>
          </li>
        ))}
      </ol>
      <datalist id="terms">
        <option value="First term" />
        <option value="Mid-term" />
        <option value="Second term" />
        <option value="Final" />
      </datalist>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setList([...list, { key: key(), title: '', term: list[list.length - 1]?.term ?? '', topics: [] }])}>
          + Chapter
        </Button>
        <Button onClick={save} loading={busy}>
          Save syllabus
        </Button>
      </div>
    </Modal>
  );
}

function SyllabusUpload({ classId, subjectId, onClose, onSaved }: { classId: string; subjectId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const [title, setTitle] = useState('Syllabus');
  const [files, setFiles] = useState<FileInfo[]>([]);
  return (
    <Modal open onClose={onClose} title="Upload syllabus file">
      <div className="space-y-4">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <FileAttach value={files} onChange={setFiles} category="SYLLABUS" max={3} />
        <Button
          disabled={!files.length || title.trim().length < 2}
          onClick={async () => {
            try {
              await api.post('/lms/material', { classId, subjectId, kind: 'SYLLABUS', title, fileIds: files.map((f) => f.id) });
              toast('Uploaded');
              onSaved();
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed', 'error');
            }
          }}
        >
          Save
        </Button>
        {me?.school && <p className="text-xs text-gray-500">Files count towards your school’s storage.</p>}
      </div>
    </Modal>
  );
}
