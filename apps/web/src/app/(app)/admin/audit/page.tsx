'use client';

import { useState } from 'react';
import { useData } from '@/components/useData';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Table, Td } from '@/components/ui';
import { dateTime, roleLabel } from '@/lib/format';

interface Row {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  reason: string | null;
  ip: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  school: { id: string; name: string } | null;
  actor: { fullName: string; username: string } | null;
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ page: String(page), ...(action && { action }) }).toString();
  const { data, error, loading } = useData<{ rows: Row[]; total: number; pageSize: number }>(`/admin/audit?${qs}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every important change on the platform: who, what, when" />
      <Card>
        <div className="mb-4 flex gap-2">
          <select
            className="input w-auto"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All actions</option>
            <option value="auth">Logins and passwords</option>
            <option value="school">Schools</option>
            <option value="plan">Plans</option>
            <option value="invoice">Invoices</option>
            <option value="user">Users</option>
            <option value="file">Files</option>
          </select>
        </div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.rows.length ? (
          <Empty title="Nothing logged yet" />
        ) : (
          <>
            <Table head={['When', 'Who', 'Action', 'School', 'Details']}>
              {data.rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <Td className="text-gray-600">{dateTime(r.createdAt)}</Td>
                  <Td>
                    {r.actor ? r.actor.fullName : <span className="text-gray-500">System</span>}
                    {r.actorRole && <div className="text-xs text-gray-500">{roleLabel[r.actorRole]}</div>}
                  </Td>
                  <Td>
                    <code className="text-xs">{r.action}</code>
                    {r.reason && <div className="max-w-xs whitespace-normal text-xs text-gray-500">{r.reason}</div>}
                  </Td>
                  <Td>{r.school?.name ?? '—'}</Td>
                  <Td>
                    {(r.before != null || r.after != null) && (
                      <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? 'Hide' : 'Show'}
                      </button>
                    )}
                    {open === r.id && (
                      <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">
                        {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                      </pre>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
              <span>
                Page {page} of {pages} · {data.total} entries
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
