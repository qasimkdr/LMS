'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Stat, Table, Td } from '@/components/ui';
import { monthName } from '@/components/progress/StudentProgress';
import { money } from '@/lib/format';

interface Row {
  id: string;
  student: { fullName: string; rollNo: string | null; classLabel: string };
  status: string;
  comment: string | null;
  sentAt: string | null;
  attendance: number | null;
  tests: number;
  average: number | null;
  balance: number | null;
  remarks: number;
  honors: number;
}

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export default function MonthlyReportsPage() {
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const [period, setPeriod] = useState(lastMonth());
  const [cls, setCls] = useState('');
  const [confirmSend, setConfirmSend] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, loading, reload } = useData<{ reports: Row[]; canManage: boolean }>(`/monthly-reports?period=${period}`);
  const rows = data?.reports ?? [];
  const classes = useMemo(() => [...new Set(rows.map((r) => r.student.classLabel))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [rows]);
  const shown = cls ? rows.filter((r) => r.student.classLabel === cls) : rows;
  const drafts = shown.filter((r) => r.status === 'DRAFT');
  const att = shown.filter((r) => r.attendance !== null);
  const avg = shown.filter((r) => r.average !== null);
  const currentMonth = new Date().toISOString().slice(0, 7);

  async function generate() {
    setBusy('gen');
    try {
      const r = await api.post<{ generated: number; skipped: number }>('/monthly-reports/generate', { period });
      toast(`${r.generated} report(s) ready${r.skipped ? ` · ${r.skipped} already sent were kept` : ''}`);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy('send');
    try {
      const r = await api.post<{ sent: number; whatsapp: number }>('/monthly-reports/send', { period, ids: drafts.map((d) => d.id) });
      toast(`${r.sent} report(s) sent to parents${r.whatsapp ? ` · ${r.whatsapp} WhatsApp message(s) queued` : ''}`);
      setConfirmSend(false);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Monthly reports"
        subtitle="Attendance, tests, fee status, remarks and honors for every student, sent to parents once a month."
        actions={
          data?.canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={generate} loading={busy === 'gen'}>
                {rows.length ? 'Refresh drafts' : 'Prepare reports'}
              </Button>
              <Button disabled={!drafts.length} onClick={() => setConfirmSend(true)}>
                Send {drafts.length || ''} to parents
              </Button>
            </div>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input w-auto" type="month" value={period} max={currentMonth} onChange={(e) => e.target.value && setPeriod(e.target.value)} aria-label="Month" />
        {classes.length > 1 && (
          <select className="input w-auto" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class">
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </div>
      {error ? (
        <ErrorBox error={error} />
      ) : loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title={`No reports for ${monthName(period)} yet`}>
          {data?.canManage ? 'Press "Prepare reports" to make them. Last month’s reports are also prepared automatically on the 1st.' : 'The principal prepares them at the start of each month.'}
        </Empty>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Students" value={shown.length} />
            <Stat label="Waiting to send" value={drafts.length} />
            <Stat label="Average attendance" value={att.length ? `${Math.round((att.reduce((s, r) => s + r.attendance!, 0) / att.length) * 10) / 10}%` : '—'} />
            <Stat label="Average test score" value={avg.length ? `${Math.round((avg.reduce((s, r) => s + r.average!, 0) / avg.length) * 10) / 10}%` : '—'} />
          </div>
          <Card>
            <Table head={['Student', 'Class', 'Attendance', 'Tests', 'Average', 'Fee balance', 'Remarks', 'Comment', 'Status']}>
              {shown.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/monthly-reports/${r.id}`)}>
                  <Td>
                    <span className="font-medium">{r.student.fullName}</span>
                    {r.honors > 0 && <span className="ml-1" title="Honor this month">🏅</span>}
                  </Td>
                  <Td>{r.student.classLabel}</Td>
                  <Td className={r.attendance !== null && r.attendance < 75 ? 'font-semibold text-red-600' : ''}>{r.attendance === null ? '—' : `${r.attendance}%`}</Td>
                  <Td>{r.tests}</Td>
                  <Td>{r.average === null ? '—' : `${r.average}%`}</Td>
                  <Td>{r.balance === null ? '—' : r.balance > 0 ? <span className="text-red-600">{money(r.balance, me?.school?.currency)}</span> : 'Clear'}</Td>
                  <Td>{r.remarks || '—'}</Td>
                  <Td>{r.comment ? '✓' : <span className="text-gray-400">—</span>}</Td>
                  <Td>{r.status === 'SENT' ? <Badge tone="green">Sent</Badge> : <Badge tone="amber">Draft</Badge>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
      {confirmSend && (
        <Modal open onClose={() => setConfirmSend(false)} title={`Send ${drafts.length} report(s)?`}>
          <p className="text-sm text-gray-700">
            Parents of {drafts.length} student(s){cls ? ` in ${cls}` : ''} will get the {monthName(period)} report in the app, and on WhatsApp if monthly reports are switched on in WhatsApp settings. Class teachers’ comments
            ({drafts.filter((d) => d.comment).length} of {drafts.length} written) are included. Sent reports cannot be changed.
          </p>
          <div className="mt-5 flex gap-2">
            <Button onClick={send} loading={busy === 'send'}>
              Send now
            </Button>
            <Button variant="secondary" onClick={() => setConfirmSend(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
