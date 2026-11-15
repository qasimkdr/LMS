'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Avatar } from '@/components/Avatar';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Table, Td } from '@/components/ui';
import { age, genderLabel, studentStatusLabel } from '@/lib/format';
import { className, type StudentListItem, type Structure } from '@/lib/types';

export default function StudentsPage() {
  const { me } = useAuth();
  const canManage = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('students.manage');
  const { data: structure } = useData<Structure>('/setup/structure');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, classId, sectionId, status]);
  const qs = new URLSearchParams({ status, page: String(page), ...(debounced && { q: debounced }), ...(classId && { classId }), ...(sectionId && { sectionId }) });
  const { data, error, loading } = useData<{ students: StudentListItem[]; total: number; pageSize: number }>(`/students?${qs}`);
  const cls = structure?.classes.find((c) => c.id === classId);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Students"
        subtitle={data ? `${data.total} ${status === 'ACTIVE' ? 'active ' : ''}student${data.total === 1 ? '' : 's'}` : undefined}
        actions={
          canManage && (
            <>
              <Link href="/school/students/blank-form">
                <Button variant="secondary">Blank admission form</Button>
              </Link>
              <Link href="/school/students/import">
                <Button variant="secondary">Import from Excel</Button>
              </Link>
              <Link href="/school/students/new">
                <Button>+ New admission</Button>
              </Link>
            </>
          )
        }
      />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input className="input" placeholder="Name, admission no, father, phone, CNIC" value={q} onChange={(e) => setQ(e.target.value)} />
          <select
            className="input"
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setSectionId('');
            }}
          >
            <option value="">All classes</option>
            {structure?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {className(c)} ({c.studentCount})
              </option>
            ))}
          </select>
          <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!cls}>
            <option value="">All sections</option>
            {cls?.sections.map((s) => (
              <option key={s.id} value={s.id}>
                Section {s.name} ({s.studentCount})
              </option>
            ))}
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(studentStatusLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
            <option value="ALL">All statuses</option>
          </select>
        </div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.students.length ? (
          <Empty title="No students found">{canManage && 'Add a new admission or import your existing students from Excel.'}</Empty>
        ) : (
          <>
            <Table head={['Student', 'Adm. no', 'Class', 'Roll', 'Father / guardian', 'Age', '']}>
              {data.students.map((s) => {
                const g = s.family.guardians.find((x) => x.relation === 'FATHER') ?? s.family.guardians[0];
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <Td>
                      <Link href={`/school/students/${s.id}`} className="flex items-center gap-3">
                        <Avatar fileId={s.photoFileId} name={s.fullName} />
                        <span>
                          <span className="block font-medium text-gray-900 hover:text-brand-700">{s.fullName}</span>
                          <span className="text-xs text-gray-500">{genderLabel[s.gender]}</span>
                        </span>
                      </Link>
                    </Td>
                    <Td>{s.admissionNo}</Td>
                    <Td>{className(s.class, s.section)}</Td>
                    <Td>{s.rollNo ?? '—'}</Td>
                    <Td>
                      {g ? (
                        <>
                          <div>{g.fullName}</div>
                          <div className="text-xs text-gray-500">{g.whatsapp ?? g.phone ?? ''}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="text-gray-600">{age(s.dob)}</Td>
                    <Td>{s.status !== 'ACTIVE' && <Badge tone="gray">{studentStatusLabel[s.status]}</Badge>}</Td>
                  </tr>
                );
              })}
            </Table>
            {pages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
                <span>
                  Page {page} of {pages}
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
