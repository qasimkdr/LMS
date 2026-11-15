'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { StorageAlert, UsageBars } from '@/components/UsageBars';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';
import { bytes, categoryLabel, date, money } from '@/lib/format';
import type { Usage } from '@/lib/types';

interface UsageResponse {
  plan: { name: string; monthlyPrice: number; includedStudents: number; perStudentPrice: number; modules: { key: string; name: string }[] };
  currency: string;
  estimatedMonthlyBill: number;
  usage: Usage;
  byCategory: { category: string; bytes: number; files: number }[];
  largest: { id: string; originalName: string; category: string; sizeBytes: number; createdAt: string }[];
}

export default function UsagePage() {
  const { me } = useAuth();
  const toast = useToast();
  const isPrincipal = me?.user.role === 'PRINCIPAL';
  const { data, error, loading, reload } = useData<UsageResponse>('/school/usage');
  const { data: inv } = useData<{ invoices: { id: string; period: string; amount: number; status: string; dueDate: string; overdue: boolean }[] }>(
    isPrincipal ? '/school/invoices' : null,
  );
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function deleteFile(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/files/${id}`);
      toast('File deleted, space freed');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  async function requestUpgrade() {
    setSending(true);
    try {
      await api.post('/school/upgrade-request', { message });
      toast('Request sent. We will contact you soon.');
      setUpgradeOpen(false);
      setMessage('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setSending(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const cur = data.currency;
  const maxCat = Math.max(1, ...data.byCategory.map((c) => c.bytes));

  return (
    <>
      <PageHeader
        title="Plan & usage"
        subtitle="How much of your plan you are using"
        actions={isPrincipal && <Button onClick={() => setUpgradeOpen(true)}>Request upgrade</Button>}
      />
      <div className="space-y-6">
        <StorageAlert usage={data.usage} />
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Usage" className="lg:col-span-2">
            <UsageBars usage={data.usage} />
            <p className="mt-4 text-xs text-gray-500">
              Largest file you can upload: {bytes(data.usage.maxFileBytes)}. Warnings appear at 80% and 95%. At 100% only new uploads stop.
            </p>
          </Card>
          <Card title={`${data.plan.name} plan`}>
            <div className="text-2xl font-semibold">
              {money(data.plan.monthlyPrice, cur)}
              <span className="text-sm font-normal text-gray-500">/month</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Includes {data.plan.includedStudents} students, then {money(data.plan.perStudentPrice, cur)} per extra student.
            </p>
            <div className="mt-4 rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Estimated bill this month</div>
              <div className="text-lg font-semibold">{money(data.estimatedMonthlyBill, cur)}</div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1">
              {data.plan.modules.map((m) => (
                <Badge key={m.key} tone="blue">
                  {m.name}
                </Badge>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Storage by type">
            {data.byCategory.length === 0 ? (
              <Empty title="No files uploaded yet" />
            ) : (
              <ul className="space-y-3">
                {[...data.byCategory]
                  .sort((a, b) => b.bytes - a.bytes)
                  .map((c) => (
                    <li key={c.category}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{categoryLabel[c.category] ?? c.category}</span>
                        <span className="text-gray-500">
                          {bytes(c.bytes)} · {c.files} file{c.files === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100">
                        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(2, (c.bytes / maxCat) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
          <Card title="Largest files">
            {data.largest.length === 0 ? (
              <Empty title="No files yet" />
            ) : (
              <Table head={['File', 'Size', '']}>
                {data.largest.map((f) => (
                  <tr key={f.id}>
                    <Td>
                      <div className="max-w-[16rem] truncate font-medium">{f.originalName}</div>
                      <div className="text-xs text-gray-500">
                        {categoryLabel[f.category]} · {date(f.createdAt)}
                      </div>
                    </Td>
                    <Td>{bytes(f.sizeBytes)}</Td>
                    <Td className="text-right">
                      {isPrincipal && (
                        <Button variant="ghost" onClick={() => deleteFile(f.id, f.originalName)}>
                          Delete
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        {isPrincipal && (
          <Card title="Subscription invoices">
            {!inv?.invoices.length ? (
              <Empty title="No invoices yet" />
            ) : (
              <Table head={['Month', 'Amount', 'Due', 'Status']}>
                {inv.invoices.map((i) => (
                  <tr key={i.id}>
                    <Td>{i.period}</Td>
                    <Td>{money(i.amount, cur)}</Td>
                    <Td>{date(i.dueDate)}</Td>
                    <Td>
                      <Badge tone={i.overdue ? 'red' : i.status === 'PAID' ? 'green' : i.status === 'VOID' ? 'gray' : 'amber'}>
                        {i.overdue ? 'Overdue' : i.status === 'PAID' ? 'Paid' : i.status === 'VOID' ? 'Cancelled' : 'Unpaid'}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>

      <Modal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} title="Request a plan upgrade">
        <div className="space-y-4">
          <Field label="What do you need?" hint="e.g. more storage, more students, online exams">
            <textarea className="input min-h-24" value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Button onClick={requestUpgrade} loading={sending} disabled={message.trim().length < 2}>
            Send request
          </Button>
        </div>
      </Modal>
    </>
  );
}
