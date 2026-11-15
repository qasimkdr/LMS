'use client';

import { useAuth } from '@/components/auth';
import { Card, PageHeader } from '@/components/ui';
import { roleLabel } from '@/lib/format';

const byRole: Record<string, string[]> = {
  TEACHER: ['My classes and timetable', 'Attendance', 'Tests and marks entry', 'Online exams', 'Homework and study material', 'Class chat'],
  STUDENT: ['Timetable', 'Homework', 'Online exams', 'Results', 'Attendance', 'Class chat'],
  PARENT: ['Attendance', 'Fee vouchers and online payment', 'Results and report cards', 'Messages to teachers', 'Announcements'],
};

export default function HomePage() {
  const { me } = useAuth();
  if (!me) return null;
  return (
    <>
      <PageHeader title={`Welcome, ${me.user.fullName}`} subtitle={`${roleLabel[me.user.role]} · ${me.school?.name ?? ''}`} />
      <Card title="Your dashboard is being built">
        <p className="text-sm text-gray-600">These features will appear here soon:</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {(byRole[me.user.role] ?? []).map((x) => (
            <li key={x} className="rounded-lg border border-gray-100 px-3 py-2 text-sm">
              {x}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
