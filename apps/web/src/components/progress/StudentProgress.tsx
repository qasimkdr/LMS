'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Badge, Button, Card, Table, Td } from '@/components/ui';
import { RemarkForm, RemarkList, type Remark } from './Remarks';

export interface HonorItem {
  id: string;
  type: { id: string; name: string; icon: string; scope: string };
  student: { id: string; fullName: string; classLabel: string; photoFileId: string | null };
  period: string;
  periodLabel: string;
  citation: string | null;
  isPublic: boolean;
  createdAt: string;
}

export interface ReportSummary {
  id: string;
  period?: string;
  status: string;
  attendance: number | null;
  tests: number;
  average: number | null;
  balance: number | null;
  remarks: number;
  honors: number;
  sentAt: string | null;
}

export const monthName = (p: string) => (/^\d{4}-\d{2}$/.test(p) ? new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : p);

/** "Remarks & progress" tab of the student profile. */
export function StudentProgress({ studentId, studentName }: { studentId: string; studentName: string }) {
  const { me } = useAuth();
  const mods = me?.school?.plan.modules ?? [];
  const remarks = useData<{ remarks: Remark[] }>(`/remarks?studentId=${studentId}`);
  const honors = useData<{ honors: HonorItem[] }>(mods.includes('honors') ? `/honors/students/${studentId}` : null);
  const reports = useData<{ reports: ReportSummary[] }>(`/monthly-reports/students/${studentId}`);
  const [writing, setWriting] = useState(false);
  const role = me?.user.role;
  const canWrite = role === 'PRINCIPAL' || role === 'TEACHER' || me?.user.permissions.includes('students.manage');
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card
        className="lg:col-span-2"
        title="Remarks"
        actions={
          canWrite && (
            <Button variant="secondary" onClick={() => setWriting(true)}>
              + Add remark
            </Button>
          )
        }
      >
        <RemarkList remarks={remarks.data?.remarks ?? []} canEdit={(r) => Boolean(r.mine || role === 'PRINCIPAL')} onChanged={remarks.reload} />
      </Card>
      <div className="space-y-6">
        {mods.includes('honors') && (
          <Card title="Honors">
            {!honors.data?.honors.length ? (
              <p className="text-sm text-gray-500">No honors yet.</p>
            ) : (
              <ul className="space-y-2">
                {honors.data.honors.map((h) => (
                  <li key={h.id} className="flex items-start gap-3">
                    <span className="text-2xl leading-none">{h.type.icon}</span>
                    <span className="text-sm">
                      <span className="font-medium">{h.type.name}</span> · {h.periodLabel}
                      {!h.isPublic && (
                        <span className="ml-1">
                          <Badge tone="gray">not on board</Badge>
                        </span>
                      )}
                      {h.citation && <span className="block text-xs text-gray-500">{h.citation}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card title="Monthly reports">
          {!reports.data?.reports.length ? (
            <p className="text-sm text-gray-500">No monthly reports yet.</p>
          ) : (
            <Table head={['Month', 'Attendance', 'Average', '']}>
              {reports.data.reports.map((r) => (
                <tr key={r.id}>
                  <Td>{monthName(r.period ?? '')}</Td>
                  <Td>{r.attendance === null ? '—' : `${r.attendance}%`}</Td>
                  <Td>{r.average === null ? '—' : `${r.average}%`}</Td>
                  <Td>
                    <Link href={`/monthly-reports/${r.id}`} className="text-brand-700 hover:underline">
                      Open
                    </Link>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      {writing && <RemarkForm studentIds={[studentId]} title={`Remark about ${studentName}`} onClose={() => setWriting(false)} onSaved={remarks.reload} />}
    </div>
  );
}
