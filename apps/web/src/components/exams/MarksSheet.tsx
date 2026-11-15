'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '../useData';
import { useToast } from '../toast';
import { Avatar } from '../Avatar';
import { Badge, Button, Card, ErrorBox, Field, Loading } from '../ui';
import { date } from '@/lib/format';
import { sheetLabel, sheetTone } from './shared';

interface Sheet {
  paper: { id: string; subject: string; totalMarks: number; passMarks: number; date: string | null };
  assessment: { id: string; title: string; kind: string; status: string };
  section: { id: string; label: string };
  sheet: { status: string; returnNote: string | null; submittedAt: string | null };
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  students: { id: string; fullName: string; rollNo: string | null; admissionNo: string; photoFileId: string | null; marks: number | null; isAbsent: boolean; remark: string | null }[];
}
type Row = { marks: string; absent: boolean; remark: string };

/** Fast marks entry: type a number and press Enter to go to the next student. */
export function MarksSheet({ paperId, sectionId, backHref }: { paperId: string; sectionId: string; backHref: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useData<Sheet>(`/exams/papers/${paperId}/sheet?sectionId=${sectionId}`);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [notifyCorrection, setNotifyCorrection] = useState(true);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!data) return;
    setRows(Object.fromEntries(data.students.map((s) => [s.id, { marks: s.marks === null ? '' : String(s.marks), absent: s.isAbsent, remark: s.remark ?? '' }])));
    setDirty(false);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const published = data.assessment.status === 'PUBLISHED';
  const total = data.paper.totalMarks;
  const entered = Object.values(rows).filter((r) => r.absent || r.marks !== '').length;
  const values = Object.values(rows).filter((r) => !r.absent && r.marks !== '').map((r) => Number(r.marks));
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const set = (id: string, patch: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
    setDirty(true);
  };

  async function save(silent = false) {
    const bad = Object.values(rows).find((r) => r.marks !== '' && (Number(r.marks) < 0 || Number(r.marks) > total || Number.isNaN(Number(r.marks))));
    if (bad) {
      toast(`Marks must be between 0 and ${total}`, 'error');
      return false;
    }
    setBusy('save');
    try {
      await api.put(`/exams/papers/${paperId}/sheet`, {
        sectionId,
        marks: data!.students.map((s) => ({ studentId: s.id, marks: rows[s.id].absent || rows[s.id].marks === '' ? null : Number(rows[s.id].marks), isAbsent: rows[s.id].absent, remark: rows[s.id].remark || null })),
        ...(published ? { reason, notifyCorrection } : {}),
      });
      if (!silent) toast(published ? 'Correction saved and results recalculated' : 'Marks saved');
      setDirty(false);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (dirty && !(await save(true))) return;
    setBusy('submit');
    try {
      const r = await api.post<{ status: string; published: boolean }>(`/exams/papers/${paperId}/sheet/submit`, { sectionId });
      toast(r.published ? 'Marks published to students and parents' : 'Marks sent to the principal for approval');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function review(approve: boolean) {
    const note = approve ? undefined : prompt('What should the teacher fix?');
    if (!approve && !note) return;
    setBusy('review');
    try {
      await api.post(`/exams/papers/${paperId}/sheet/review`, { sectionId, approve, note });
      toast(approve ? 'Marks approved' : 'Sent back to the teacher');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={backHref} className="text-sm text-brand-700 hover:underline">
            ← Back
          </Link>
          <h1 className="mt-1 text-xl font-semibold">
            {data.paper.subject} · {data.section.label}
          </h1>
          <div className="text-sm text-gray-600">
            {data.assessment.title} · Total {total} · Pass {data.paper.passMarks}
            {data.paper.date && ` · ${date(data.paper.date)}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {published ? <Badge tone="green">Published</Badge> : <Badge tone={sheetTone[data.sheet.status]}>{sheetLabel[data.sheet.status]}</Badge>}
        </div>
      </div>
      {data.sheet.status === 'RETURNED' && data.sheet.returnNote && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Sent back by the principal: {data.sheet.returnNote}</div>}
      {published && data.canEdit && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">These results are published. Changes are recorded with your reason and positions are recalculated.</div>}
      <Card>
        <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-600">
          <span>
            Entered {entered}/{data.students.length}
          </span>
          {avg !== null && <span>Average {avg.toFixed(1)}</span>}
          {values.length > 0 && <span>Highest {Math.max(...values)}</span>}
          <span>Below pass {values.filter((v) => v < data.paper.passMarks).length}</span>
        </div>
        <div className="-mx-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-5 py-2">Roll</th>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Marks / {total}</th>
                <th className="px-3 py-2">Absent</th>
                <th className="px-3 py-2">Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.students.map((s, i) => {
                const r = rows[s.id] ?? { marks: '', absent: false, remark: '' };
                const low = !r.absent && r.marks !== '' && Number(r.marks) < data.paper.passMarks;
                const over = r.marks !== '' && Number(r.marks) > total;
                return (
                  <tr key={s.id}>
                    <td className="px-5 py-1.5 text-gray-500">{s.rollNo}</td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <Avatar fileId={s.photoFileId} name={s.fullName} size={28} />
                        <span className="whitespace-nowrap font-medium">{s.fullName}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        ref={(el) => {
                          inputs.current[i] = el;
                        }}
                        className={`input w-24 py-1 text-right font-semibold ${over ? 'border-red-500 text-red-700' : low ? 'text-red-600' : ''}`}
                        inputMode="decimal"
                        disabled={!data.canEdit || r.absent}
                        value={r.absent ? '' : r.marks}
                        onChange={(e) => set(s.id, { marks: e.target.value.replace(/[^0-9.]/g, '') })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'ArrowDown') {
                            e.preventDefault();
                            inputs.current[i + 1]?.focus();
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            inputs.current[i - 1]?.focus();
                          }
                        }}
                        aria-label={`Marks for ${s.fullName}`}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" disabled={!data.canEdit} checked={r.absent} onChange={(e) => set(s.id, { absent: e.target.checked, marks: e.target.checked ? '' : r.marks })} aria-label={`${s.fullName} absent`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input className="input w-48 py-1 text-xs" disabled={!data.canEdit} value={r.remark} onChange={(e) => set(s.id, { remark: e.target.value })} placeholder="Optional" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="sticky bottom-0 -mx-5 mt-3 flex flex-wrap items-end gap-3 border-t border-gray-100 bg-white/95 px-5 py-3 backdrop-blur">
          {published && data.canEdit && (
            <>
              <Field label="Reason for correction">
                <input className="input w-64" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" checked={notifyCorrection} onChange={(e) => setNotifyCorrection(e.target.checked)} /> Tell parents
              </label>
            </>
          )}
          {data.canEdit && (
            <Button variant={data.canSubmit ? 'secondary' : 'primary'} onClick={() => save()} loading={busy === 'save'} disabled={published && !reason}>
              {published ? 'Save correction' : 'Save'}
            </Button>
          )}
          {data.canSubmit && (
            <Button onClick={submit} loading={busy === 'submit'} disabled={entered < data.students.length}>
              {data.assessment.kind === 'TEST' ? 'Submit' : 'Submit to principal'}
            </Button>
          )}
          {data.canReview && (
            <>
              <Button onClick={() => review(true)} loading={busy === 'review'}>
                Approve marks
              </Button>
              <Button variant="secondary" onClick={() => review(false)}>
                Send back
              </Button>
            </>
          )}
          {data.canSubmit && entered < data.students.length && <span className="pb-2 text-xs text-gray-500">Enter marks or tick absent for every student to submit.</span>}
        </div>
      </Card>
    </div>
  );
}
