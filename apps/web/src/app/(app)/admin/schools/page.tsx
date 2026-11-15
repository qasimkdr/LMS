'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useData } from '@/components/useData';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Table, Td, statusTone } from '@/components/ui';
import { bytes, date, statusLabel } from '@/lib/format';

interface Row {
  id: string;
  name: string;
  code: string;
  city: string | null;
  effectiveStatus: string;
  trialEndsAt: string | null;
  plan: { id: string; name: string };
  principal: { fullName: string; username: string; phone: string | null } | null;
  storage: { usedBytes: number; limitBytes: number; percent: number };
  students: { used: number; limit: number | null; percent: number | null };
  createdAt: string;
}

const pctTone = (p: number | null) => (p === null ? 'text-gray-500' : p >= 95 ? 'text-red-600' : p >= 80 ? 'text-amber-600' : 'text-gray-700');

export default function SchoolsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [nearLimit, setNearLimit] = useState(false);
  const qs = new URLSearchParams({ ...(search && { search }), ...(status && { status }), ...(nearLimit && { nearLimit: 'true' }) }).toString();
  const { data, error, loading } = useData<{ schools: Row[] }>(`/admin/schools${qs ? `?${qs}` : ''}`);

  return (
    <>
      <PageHeader
        title="Schools"
        subtitle="Create schools, their principal accounts, and manage plans and status"
        actions={
          <Link href="/admin/schools/new">
            <Button>+ New school</Button>
          </Link>
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Search name, code, city" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(statusLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={nearLimit} onChange={(e) => setNearLimit(e.target.checked)} /> Near plan limits
          </label>
        </div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.schools.length ? (
          <Empty title="No schools found">Create your first school to give a principal access.</Empty>
        ) : (
          <Table head={['School', 'Principal', 'Plan', 'Status', 'Students', 'Storage', 'Created']}>
            {data.schools.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <Td>
                  <Link href={`/admin/schools/${s.id}`} className="font-medium text-gray-900 hover:text-brand-700 hover:underline">
                    {s.name}
                  </Link>
                  <div className="text-xs text-gray-500">
                    {s.code}
                    {s.city ? ` · ${s.city}` : ''}
                  </div>
                </Td>
                <Td>
                  {s.principal ? (
                    <>
                      <div>{s.principal.fullName}</div>
                      <div className="text-xs text-gray-500">@{s.principal.username}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>{s.plan.name}</Td>
                <Td>
                  <Badge tone={statusTone[s.effectiveStatus]}>{statusLabel[s.effectiveStatus]}</Badge>
                  {s.effectiveStatus === 'TRIAL' && <div className="mt-0.5 text-xs text-gray-500">ends {date(s.trialEndsAt)}</div>}
                </Td>
                <Td className={pctTone(s.students.percent)}>
                  {s.students.used}
                  {s.students.limit !== null && ` / ${s.students.limit}`}
                </Td>
                <Td className={pctTone(s.storage.percent)}>
                  {bytes(s.storage.usedBytes)} / {bytes(s.storage.limitBytes)}
                  <div className="text-xs">{s.storage.percent}%</div>
                </Td>
                <Td className="text-gray-500">{date(s.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
