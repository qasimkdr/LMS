'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { FileAttach, FileList, type FileInfo } from '@/components/lms/Files';
import { dayLabel, shiftDay, todayLocal, type MyClass } from '@/components/lms/shared';
import { date, dateTime } from '@/lib/format';

interface Hw {
  id: string;
  subjectId: string | null;
  subject: string | null;
  date: string;
  dueDate: string | null;
  text: string;
  files: FileInfo[];
  createdBy: string;
  canEdit: boolean;
}
interface DayData {
  date: string;
  homework: Hw[];
  digest: { sentAt: string; items: number } | null;
  digestTime: string;
  canSend: boolean;
}

export default function HomeworkPage() {
  const toast = useToast();
  const { me } = useAuth();
  const classes = useData<{ sections: MyClass[] }>('/lms/my-classes');
  const [sectionId, setSectionId] = useState('');
  const [day, setDay] = useState(todayLocal());
  const [editing, setEditing] = useState<Partial<Hw> | null>(null);
  const [settings, setSettings] = useState(false);
  const list = classes.data?.sections ?? [];
  const sec = list.find((s) => s.sectionId === sectionId) ?? list[0];
  const { data, error, loading, reload } = useData<DayData>(sec ? `/lms/homework?sectionId=${sec.sectionId}&date=${day}` : null);
  const manager = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('lms.manage');
  const canPost = sec && (sec.subjects.length > 0 || sec.classTeacher);

  async function sendNow() {
    try {
      const r = await api.post<{ students: number; whatsapp: number }>('/lms/homework/send', { sectionId: sec!.sectionId, date: day });
      toast(`Diary sent to ${r.students} student(s)' families${r.whatsapp ? ` · ${r.whatsapp} WhatsApp message(s) queued` : ''}`);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  if (classes.loading && !classes.data) return <Loading />;
  if (classes.error) return <ErrorBox error={classes.error} />;

  return (
    <>
      <PageHeader
        title="Homework / diary"
        subtitle="Daily homework for each class. Parents see it in the app and get one diary message a day."
        actions={
          manager && (
            <Button variant="secondary" onClick={() => setSettings(true)}>
              Diary settings
            </Button>
          )
        }
      />
      {!list.length ? (
        <Empty title="You have no classes yet" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={sec?.sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Class">
              {list.map((s) => (
                <option key={s.sectionId} value={s.sectionId}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <Button variant="ghost" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day">
                ←
              </Button>
              <input className="input w-auto" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Date" />
              <Button variant="ghost" onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day">
                →
              </Button>
              {day !== todayLocal() && (
                <Button variant="ghost" onClick={() => setDay(todayLocal())}>
                  Today
                </Button>
              )}
            </div>
          </div>

          <Card
            title={`${sec?.label} · ${dayLabel(day)}`}
            actions={
              canPost && (
                <Button onClick={() => setEditing({ date: day, subjectId: sec!.subjects[0]?.id ?? null, text: '', files: [] })}>
                  + Add homework
                </Button>
              )
            }
          >
            {error ? (
              <ErrorBox error={error} />
            ) : loading && !data ? (
              <Loading />
            ) : !data?.homework.length ? (
              <p className="text-sm text-gray-500">No homework for this day yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.homework.map((h) => (
                  <li key={h.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{h.subject ?? 'General diary'}</span>
                      {h.dueDate && h.dueDate !== h.date && <Badge tone="amber">Due {date(h.dueDate)}</Badge>}
                      <span className="text-xs text-gray-500">by {h.createdBy}</span>
                      {h.canEdit && (
                        <span className="ml-auto flex gap-3 text-sm">
                          <button className="text-brand-700 hover:underline" onClick={() => setEditing(h)}>
                            Edit
                          </button>
                          <button
                            className="text-red-600 hover:underline"
                            onClick={async () => {
                              if (!confirm('Delete this homework?')) return;
                              await api.del(`/lms/homework/${h.id}`);
                              reload();
                            }}
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{h.text}</p>
                    <div className="mt-2">
                      <FileList files={h.files} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data && data.homework.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4 text-sm">
                {data.digest ? (
                  <span className="text-green-700">✓ Diary sent to parents {dateTime(data.digest.sentAt)} ({data.digest.items} item(s))</span>
                ) : (
                  <span className="text-gray-600">The diary goes to parents automatically at {data.digestTime}{day !== todayLocal() ? ' (only for today’s homework)' : ''}.</span>
                )}
                {data.canSend && (
                  <Button variant="secondary" onClick={sendNow}>
                    {data.digest ? 'Send again' : 'Send to parents now'}
                  </Button>
                )}
                {data.digest && data.homework.length > data.digest.items && <span className="text-amber-700">Homework was added after the diary was sent.</span>}
              </div>
            )}
          </Card>
        </>
      )}
      {editing && sec && <HomeworkForm sec={sec} value={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {settings && <DiarySettings onClose={() => setSettings(false)} />}
    </>
  );
}

function HomeworkForm({ sec, value, onClose, onSaved }: { sec: MyClass; value: Partial<Hw>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [subjectId, setSubjectId] = useState<string>(value.subjectId ?? '');
  const [day, setDay] = useState(value.date ?? todayLocal());
  const [due, setDue] = useState(value.dueDate ?? '');
  const [text, setText] = useState(value.text ?? '');
  const [files, setFiles] = useState<FileInfo[]>(value.files ?? []);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const body = { sectionId: sec.sectionId, subjectId: subjectId || null, date: day, dueDate: due || null, text, fileIds: files.map((f) => f.id) };
      if (value.id) await api.put(`/lms/homework/${value.id}`, body);
      else await api.post('/lms/homework', body);
      toast('Homework saved');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={value.id ? 'Edit homework' : `Homework for ${sec.label}`}>
      <div className="space-y-4">
        <Field label="Subject">
          <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {sec.classTeacher && <option value="">General diary (no subject)</option>}
            {sec.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Homework">
          <textarea className="input min-h-32" value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} placeholder="e.g. Exercise 3.2, questions 1 to 5. Learn the table of 7." />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Due (optional)">
            <input className="input" type="date" value={due} min={day} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Attachments (optional)">
          <FileAttach value={files} onChange={setFiles} category="HOMEWORK" />
        </Field>
        <Button onClick={save} loading={busy} disabled={text.trim().length < 2}>
          Save homework
        </Button>
      </div>
    </Modal>
  );
}

function DiarySettings({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data } = useData<{ settings: { digestTime: string; classTeacherAllSubjects: boolean } }>('/lms/settings');
  const [time, setTime] = useState<string | null>(null);
  const [all, setAll] = useState<boolean | null>(null);
  const t = time ?? data?.settings.digestTime ?? '16:00';
  const a = all ?? data?.settings.classTeacherAllSubjects ?? true;
  return (
    <Modal open onClose={onClose} title="Diary settings">
      <div className="space-y-4">
        <Field label="Send the day's diary to parents at" hint="One message per student with all subjects. WhatsApp follows the Daily diary switch in WhatsApp settings; the app notice is always sent.">
          <input className="input w-auto" type="time" value={t} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={a} onChange={(e) => setAll(e.target.checked)} />
          <span>
            Class teachers can post homework for every subject of their class
            <span className="block text-xs text-gray-500">Useful in junior classes where the class teacher writes the whole diary.</span>
          </span>
        </label>
        <Button
          onClick={async () => {
            try {
              await api.put('/lms/settings', { digestTime: t, classTeacherAllSubjects: a });
              toast('Settings saved');
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed', 'error');
            }
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
