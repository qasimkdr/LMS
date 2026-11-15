'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Avatar } from '@/components/Avatar';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Table, Td } from '@/components/ui';
import { dateTime, roleLabel } from '@/lib/format';

interface Row {
  id: string;
  fullName: string;
  username: string;
  role: string;
  phone: string | null;
  isActive: boolean;
  photoFileId: string | null;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  staffProfile: { employeeNo: string; designation: string | null } | null;
  _count: { classTeacherOf: number; teachingSubjects: number };
}

export default function StaffPage() {
  const { me } = useAuth();
  const canManage = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('staff.manage');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('true');
  const qs = new URLSearchParams({ active, ...(q && { q }), ...(role && { role }) });
  const { data, error, loading } = useData<{ staff: Row[] }>(`/staff?${qs}`);

  return (
    <>
      <PageHeader
        title="Staff & teachers"
        subtitle={data ? `${data.staff.length} account${data.staff.length === 1 ? '' : 's'}` : undefined}
        actions={
          canManage && (
            <>
              <Link href="/school/staff/import">
                <Button variant="secondary">Import from Excel</Button>
              </Link>
              <Link href="/school/staff/new">
                <Button>+ Add staff</Button>
              </Link>
            </>
          )
        }
      />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <input className="input" placeholder="Name, username, phone, employee no" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Teachers and staff</option>
            <option value="TEACHER">Teachers</option>
            <option value="STAFF">Office staff</option>
          </select>
          <select className="input" value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="true">Active</option>
            <option value="false">Disabled</option>
            <option value="all">All</option>
          </select>
        </div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.staff.length ? (
          <Empty title="No staff yet">{canManage && 'Add teachers one by one or import them from Excel.'}</Empty>
        ) : (
          <Table head={['Name', 'Role', 'Emp. no', 'Mobile', 'Classes', 'Last login', '']}>
            {data.staff.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <Td>
                  <Link href={`/school/staff/${s.id}`} className="flex items-center gap-3">
                    <Avatar fileId={s.photoFileId} name={s.fullName} />
                    <span>
                      <span className="block font-medium hover:text-brand-700">{s.fullName}</span>
                      <span className="text-xs text-gray-500">@{s.username}</span>
                    </span>
                  </Link>
                </Td>
                <Td>
                  {roleLabel[s.role]}
                  {s.staffProfile?.designation && <div className="text-xs text-gray-500">{s.staffProfile.designation}</div>}
                </Td>
                <Td>{s.staffProfile?.employeeNo ?? '—'}</Td>
                <Td>{s.phone ?? '—'}</Td>
                <Td className="text-gray-600">
                  {s.role === 'TEACHER' ? `${s._count.classTeacherOf ? `Class teacher ×${s._count.classTeacherOf}, ` : ''}${s._count.teachingSubjects} subject-classes` : '—'}
                </Td>
                <Td className="text-gray-600">{s.lastLoginAt ? dateTime(s.lastLoginAt) : 'Never'}</Td>
                <Td>{!s.isActive ? <Badge tone="red">Disabled</Badge> : s.mustChangePassword ? <Badge tone="amber">Not logged in</Badge> : null}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
