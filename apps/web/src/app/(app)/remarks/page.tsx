'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Button, Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { CATEGORY_LABEL, RemarkForm, RemarkList, type Remark, type RemarkCategory } from '@/components/progress/Remarks';
import { className } from '@/lib/types';

interface SectionOpt {
  id: string;
  label: string;
}
interface StudentRow {
  id: string;
  fullName: string;
  rollNo: string | null;
}

export default function RemarksPage() {
  const { me } = useAuth();
  const role = me?.user.role;
  const isTeacher = role === 'TEACHER';
  const canWrite = role === 'PRINCIPAL' || isTeacher || me?.user.permissions.includes('students.manage');
  const overview = useData<{ classTeacherOf: { id: string; name: string; class: { name: string; stream: string | null } }[]; teaching: { section: { id: string; name: string; class: { name: string; stream: string | null } } }[] }>(isTeacher ? '/my/overview' : null);
  const structure = useData<{ classes: { id: string; name: string; stream: string | null; sections: { id: string; name: string }[] }[] }>(isTeacher ? null : '/setup/structure');

  const sections: SectionOpt[] = useMemo(() => {
    if (isTeacher) {
      const m = new Map<string, string>();
      overview.data?.classTeacherOf.forEach((s) => m.set(s.id, className(s.class, s)));
      overview.data?.teaching.forEach((t) => m.set(t.section.id, className(t.section.class, t.section)));
      return [...m].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    }
    return structure.data?.classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, label: className(c, s) }))) ?? [];
  }, [isTeacher, overview.data, structure.data]);

  const [sectionId, setSectionId] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [writing, setWriting] = useState(false);
  const sid = sectionId || sections[0]?.id || '';

  const students = useData<{ students: StudentRow[] }>(sid ? (isTeacher ? `/my/sections/${sid}/students` : `/students?sectionId=${sid}&status=ACTIVE&pageSize=200`) : null);
  const remarks = useData<{ remarks: Remark[] }>(sid ? `/remarks?sectionId=${sid}${category ? `&category=${category}` : ''}` : null);
  const list = students.data?.students ?? [];

  if ((isTeacher ? overview.loading : structure.loading) && !sections.length) return <Loading />;

  return (
    <>
      <PageHeader title="Remarks" subtitle="Notes about students for parents (or for staff only). Shared remarks also appear in the monthly report." />
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          className="input w-auto"
          value={sid}
          onChange={(e) => {
            setSectionId(e.target.value);
            setSelected(new Set());
          }}
          aria-label="Class"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {!sections.length ? (
        <Card>
          <p className="text-sm text-gray-500">You have no classes yet.</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          {canWrite && (
            <Card
              title="Write a remark"
              actions={
                <button className="text-sm text-brand-700 hover:underline" onClick={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((s) => s.id)))}>
                  {selected.size === list.length && list.length ? 'Clear' : 'Select all'}
                </button>
              }
            >
              {students.error ? (
                <ErrorBox error={students.error} />
              ) : (
                <ul className="-mx-2 max-h-[50vh] overflow-y-auto">
                  {list.map((s) => (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={(e) => {
                            const n = new Set(selected);
                            if (e.target.checked) n.add(s.id);
                            else n.delete(s.id);
                            setSelected(n);
                          }}
                        />
                        <span className="w-8 text-gray-400">{s.rollNo ?? ''}</span>
                        {s.fullName}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <Button className="mt-4 w-full" disabled={!selected.size} onClick={() => setWriting(true)}>
                Write remark for {selected.size || ''} student{selected.size === 1 ? '' : 's'}
              </Button>
            </Card>
          )}
          <Card
            title="Recent remarks"
            actions={
              <select className="input w-auto py-1" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {(Object.keys(CATEGORY_LABEL) as RemarkCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            }
          >
            {remarks.loading && !remarks.data ? <Loading /> : <RemarkList remarks={remarks.data?.remarks ?? []} showStudent canEdit={(r) => Boolean(r.mine || role === 'PRINCIPAL')} onChanged={remarks.reload} />}
          </Card>
        </div>
      )}
      {writing && (
        <RemarkForm
          studentIds={[...selected]}
          title={selected.size === 1 ? `Remark about ${list.find((s) => selected.has(s.id))?.fullName}` : `Remark for ${selected.size} students`}
          onClose={() => setWriting(false)}
          onSaved={() => {
            setSelected(new Set());
            remarks.reload();
          }}
        />
      )}
    </>
  );
}
