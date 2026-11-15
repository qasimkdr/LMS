'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import type { Structure } from '@/lib/types';

interface Assignment {
  id: string;
  sectionId: string;
  subjectId: string;
  teacher: { id: string; fullName: string };
}

export default function AssignmentsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useData<Structure>('/setup/structure');
  const { data: asg, reload: reloadAsg } = useData<{ assignments: Assignment[] }>('/setup/assignments');
  const [classId, setClassId] = useState('');
  const map = useMemo(() => new Map((asg?.assignments ?? []).map((a) => [`${a.sectionId}:${a.subjectId}`, a.teacher.id])), [asg]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const classes = classId ? data.classes.filter((c) => c.id === classId) : data.classes;

  // Load per teacher: number of subject-sections they teach.
  const load = new Map<string, number>();
  for (const a of asg?.assignments ?? []) load.set(a.teacher.id, (load.get(a.teacher.id) ?? 0) + 1);

  async function setClassTeacher(sectionId: string, teacherId: string) {
    try {
      await api.patch(`/setup/sections/${sectionId}`, { classTeacherId: teacherId || null });
      toast('Class teacher saved');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }
  async function setTeacher(sectionId: string, subjectId: string, teacherId: string) {
    try {
      await api.put('/setup/assignments', { sectionId, subjectId, teacherId: teacherId || null });
      toast('Saved');
      reloadAsg();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  const teacherOptions = (
    <>
      <option value="">— Not assigned —</option>
      {data.teachers.map((t) => (
        <option key={t.id} value={t.id}>
          {t.fullName}
          {load.get(t.id) ? ` (${load.get(t.id)})` : ''}
        </option>
      ))}
    </>
  );

  return (
    <>
      <PageHeader title="Teacher assignments" subtitle="Choose the class teacher of each section and who teaches each subject. Teachers then see these classes on their dashboard." />
      {data.teachers.length === 0 ? (
        <Empty title="No teachers yet">
          <Link href="/school/staff" className="text-brand-700 hover:underline">
            Add teachers
          </Link>{' '}
          first.
        </Empty>
      ) : data.classes.length === 0 ? (
        <Empty title="No classes yet">
          <Link href="/school/setup" className="text-brand-700 hover:underline">
            Add classes
          </Link>{' '}
          first.
        </Empty>
      ) : (
        <>
          <div className="mb-4">
            <select className="input w-auto" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">All classes</option>
              {data.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.stream ?? ''}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-4">
            {classes.map((c) => (
              <Card key={c.id} title={`${c.name}${c.stream ? ` ${c.stream}` : ''}`}>
                {c.subjects.length === 0 && (
                  <p className="mb-3 text-sm text-amber-700">
                    No subjects linked to this class.{' '}
                    <Link href="/school/setup?tab=subjects" className="underline">
                      Choose subjects
                    </Link>
                  </p>
                )}
                <div className="-mx-5 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
                        <th className="px-5 py-2">Section</th>
                        <th className="px-3 py-2">Class teacher</th>
                        {c.subjects.map((s) => (
                          <th key={s.id} className="whitespace-nowrap px-3 py-2">
                            {s.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {c.sections.map((sec) => (
                        <tr key={sec.id}>
                          <td className="px-5 py-2 font-semibold">{sec.name}</td>
                          <td className="px-3 py-2">
                            <select className="input min-w-40 py-1" value={sec.classTeacher?.id ?? ''} onChange={(e) => setClassTeacher(sec.id, e.target.value)}>
                              {teacherOptions}
                            </select>
                          </td>
                          {c.subjects.map((s) => (
                            <td key={s.id} className="px-3 py-2">
                              <select className="input min-w-40 py-1" value={map.get(`${sec.id}:${s.id}`) ?? ''} onChange={(e) => setTeacher(sec.id, s.id, e.target.value)}>
                                {teacherOptions}
                              </select>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500">The number after a teacher’s name is how many subject-classes they already teach.</p>
        </>
      )}
    </>
  );
}
