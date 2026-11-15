'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Avatar } from '@/components/Avatar';
import { Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { TodayList } from '@/components/TimetableGrid';
import type { MyTimetable } from './timetable/page';
import { age, roleLabel } from '@/lib/format';
import { className } from '@/lib/types';

interface Child {
  id: string;
  fullName: string;
  admissionNo: string;
  rollNo: string | null;
  photoFileId: string | null;
  dob: string | null;
  class: { name: string; stream: string | null };
  section: { name: string; classTeacher: { fullName: string } | null } | null;
}
interface SectionRow {
  id: string;
  name: string;
  class: { name: string; stream: string | null };
  _count: { students: number };
}
interface Overview {
  role: string;
  classTeacherOf?: (SectionRow & { room: string | null })[];
  teaching?: { id: string; subject: { name: string }; section: SectionRow }[];
  children?: Child[];
  familyNo?: string | null;
  student?: Child | null;
}

const soon: Record<string, string[]> = {
  TEACHER: ['Online exams', 'Homework', 'Class chat'],
  STUDENT: ['Homework', 'Online exams', 'Class chat'],
  PARENT: ['Messages to teachers', 'Announcements'],
};

function ChildCard({ c }: { c: Child }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Avatar fileId={c.photoFileId} name={c.fullName} size={56} />
      <div className="min-w-0">
        <div className="font-semibold">{c.fullName}</div>
        <div className="text-sm text-gray-600">{className(c.class, c.section)}</div>
        <div className="text-xs text-gray-500">
          Adm. {c.admissionNo}
          {c.rollNo && ` · Roll ${c.rollNo}`} · {age(c.dob)}
          {c.section?.classTeacher && ` · Class teacher: ${c.section.classTeacher.fullName}`}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { me } = useAuth();
  const { data, error, loading } = useData<Overview>('/my/overview');
  const hasTT = (me?.school?.plan.modules ?? []).includes('timetable');
  const { data: tt } = useData<MyTimetable>(hasTT ? '/timetable/my' : null);
  if (!me) return null;
  const todayCard = (title: string, node: React.ReactNode) => (
    <Card
      title={title}
      actions={
        <Link href="/home/timetable" className="text-sm font-medium text-brand-700 hover:underline">
          Full week →
        </Link>
      }
    >
      {node}
    </Card>
  );
  return (
    <>
      <PageHeader title={`Welcome, ${me.user.fullName}`} subtitle={`${roleLabel[me.user.role]} · ${me.school?.name ?? ''}`} />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="space-y-6">
          {data.role === 'TEACHER' && (data.classTeacherOf?.length ?? 0) > 0 && (me.school?.plan.modules ?? []).includes('attendance') && (
            <Link href="/home/attendance" className="flex items-center justify-between rounded-xl border-2 border-brand-200 bg-brand-50 p-4 hover:border-brand-500">
              <span>
                <span className="block font-semibold text-brand-900">Mark today’s attendance</span>
                <span className="text-sm text-brand-800">{data.classTeacherOf!.map((s) => className(s.class, s)).join(', ')}</span>
              </span>
              <span className="text-brand-700">→</span>
            </Link>
          )}
          {data.role === 'TEACHER' && tt?.week && todayCard('Today', <TodayList week={tt.week} mode="teacher" now={tt.now} />)}
          {data.role !== 'TEACHER' &&
            tt?.children?.map((c) => (
              <div key={c.student.id}>{todayCard(`Today${tt.children!.length > 1 ? ` · ${c.student.fullName}` : ''}`, c.hasSection ? <TodayList week={c.week} mode="class" now={tt.now} /> : <p className="text-sm text-gray-500">No section assigned yet.</p>)}</div>
            ))}
          {data.role === 'TEACHER' && (
            <>
              <Card title="My classes">
                {!data.classTeacherOf?.length && !data.teaching?.length ? (
                  <Empty title="No classes assigned yet">The principal assigns classes in Teacher assignments.</Empty>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.classTeacherOf?.map((s) => (
                      <Link key={s.id} href={`/home/sections/${s.id}`} className="rounded-xl border-2 border-brand-200 bg-brand-50 p-4 hover:border-brand-500">
                        <div className="text-xs font-semibold uppercase text-brand-700">Class teacher</div>
                        <div className="mt-1 font-semibold">{className(s.class, s)}</div>
                        <div className="text-sm text-gray-600">{s._count.students} students</div>
                      </Link>
                    ))}
                    {data.teaching?.map((t) => (
                      <Link key={t.id} href={`/home/sections/${t.section.id}`} className="rounded-xl border border-gray-200 p-4 hover:border-brand-500">
                        <div className="text-xs font-semibold uppercase text-gray-500">{t.subject.name}</div>
                        <div className="mt-1 font-semibold">{className(t.section.class, t.section)}</div>
                        <div className="text-sm text-gray-600">{t.section._count.students} students</div>
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
          {data.role === 'PARENT' && (
            <Card title={`My children${data.familyNo ? ` · Family ${data.familyNo}` : ''}`}>
              {data.children?.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {data.children.map((c) => (
                    <ChildCard key={c.id} c={c} />
                  ))}
                </div>
              ) : (
                <Empty title="No children linked" />
              )}
            </Card>
          )}
          {data.role === 'STUDENT' && data.student && <ChildCard c={data.student} />}
          <Card title="Coming soon">
            <ul className="grid gap-2 sm:grid-cols-2">
              {(soon[data.role] ?? []).map((x) => (
                <li key={x} className="rounded-lg border border-gray-100 px-3 py-2 text-sm text-gray-600">
                  {x}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </>
  );
}
