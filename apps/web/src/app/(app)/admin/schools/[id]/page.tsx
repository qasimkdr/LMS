'use client';

import Link from 'next/link';
import { use, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Progress, SecretBox, Table, Td, statusTone } from '@/components/ui';
import { bytes, date, dateTime, money, statusLabel } from '@/lib/format';
import type { Invoice, Plan, Usage } from '@/lib/types';

interface Detail {
  school: {
    id: string;
    name: string;
    code: string;
    address: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    status: string;
    effectiveStatus: string;
    trialEndsAt: string | null;
    planId: string;
    billingDay: number;
    currency: string;
    customStorageLimitMb: number | null;
    customMaxStudents: number | null;
    customMaxStaff: number | null;
    createdAt: string;
    plan: Plan;
  };
  principals: { id: string; fullName: string; username: string; email: string | null; phone: string | null; isActive: boolean; lastLoginAt: string | null; mustChangePassword: boolean }[];
  campuses: { id: string; name: string; isMain: boolean }[];
  usage: Usage;
  nextInvoicePreview: { activeStudents: number; base: number; per: number; extraStudents: number; amount: number };
  invoices: Invoice[];
  recentAudit: { id: string; action: string; createdAt: string; reason: string | null }[];
}

export default function SchoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useData<Detail>(`/admin/schools/${id}`);
  const { data: plans } = useData<{ plans: Plan[] }>('/admin/plans');
  const [modal, setModal] = useState<null | 'edit' | 'status' | 'delete' | 'principal'>(null);
  const [secret, setSecret] = useState<{ username: string; tempPassword: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const s = data.school;
  const cur = s.currency;

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      toast(done);
      setModal(null);
      await reload();
    } catch (e) {
      setFormError(e);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(userId: string) {
    if (!confirm('Reset this principal’s password? They will be logged out everywhere.')) return;
    try {
      const res = await api.post<{ username: string; tempPassword: string }>(`/admin/schools/${id}/principal/reset-password`, { userId });
      setSecret(res);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  async function toggleActive(userId: string, isActive: boolean) {
    try {
      await api.post(`/admin/schools/${id}/principals/${userId}/active`, { isActive });
      toast(isActive ? 'Account activated' : 'Account deactivated');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  async function generateInvoice() {
    try {
      await api.post('/admin/invoices/generate', { schoolId: id });
      toast('Invoice created for this month');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.name} <Badge tone={statusTone[s.effectiveStatus]}>{statusLabel[s.effectiveStatus]}</Badge>
          </span>
        }
        subtitle={`${s.code}${s.city ? ` · ${s.city}` : ''} · created ${date(s.createdAt)}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal('edit')}>
              Edit
            </Button>
            <Button variant="secondary" onClick={() => setModal('status')}>
              Change status
            </Button>
            <Button variant="danger" onClick={() => setModal('delete')}>
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Usage" className="lg:col-span-2">
          <div className="space-y-5">
            <Progress
              label="Storage"
              percent={data.usage.storage.percent}
              detail={`${bytes(data.usage.storage.usedBytes)} of ${bytes(data.usage.storage.limitBytes)} (${data.usage.storage.percent}%)`}
            />
            <Progress
              label="Students"
              percent={data.usage.students.percent}
              detail={data.usage.students.limit ? `${data.usage.students.used} of ${data.usage.students.limit}` : `${data.usage.students.used} (no cap)`}
            />
            <Progress
              label="Staff & teachers"
              percent={data.usage.staff.percent}
              detail={data.usage.staff.limit ? `${data.usage.staff.used} of ${data.usage.staff.limit}` : `${data.usage.staff.used} (no cap)`}
            />
            <div className="text-sm text-gray-600">
              Campuses: {data.usage.campuses.used} of {data.usage.campuses.limit} · Max file size: {bytes(data.usage.maxFileBytes)}
            </div>
          </div>
        </Card>
        <Card title="Plan">
          <div className="text-lg font-semibold">{s.plan.name}</div>
          <div className="mt-1 text-sm text-gray-600">
            {money(s.plan.monthlyPrice, cur)}/month incl. {s.plan.includedStudents} students, then {money(s.plan.perStudentPrice, cur)} per student
          </div>
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
            <div className="text-xs font-medium text-gray-500">This month’s bill if invoiced now</div>
            <div className="mt-0.5 text-xl font-semibold">{money(data.nextInvoicePreview.amount, cur)}</div>
            <div className="text-xs text-gray-500">
              {data.nextInvoicePreview.activeStudents} active students
              {data.nextInvoicePreview.extraStudents > 0 && ` (${data.nextInvoicePreview.extraStudents} above plan)`}
            </div>
          </div>
          {(s.customStorageLimitMb || s.customMaxStudents || s.customMaxStaff) && (
            <p className="mt-3 text-xs text-amber-700">This school has custom limits that override the plan.</p>
          )}
        </Card>
      </div>

      <Card
        title="Principal accounts"
        className="mt-6"
        actions={
          <Button variant="secondary" onClick={() => setModal('principal')}>
            + Add principal
          </Button>
        }
      >
        {secret && (
          <div className="mb-4">
            <p className="mb-2 text-sm">
              New password for <strong>{secret.username}</strong>:
            </p>
            <SecretBox label="Temporary password" value={secret.tempPassword} />
          </div>
        )}
        <Table head={['Name', 'Username', 'Contact', 'Last login', 'Status', '']}>
          {data.principals.map((p) => (
            <tr key={p.id}>
              <Td className="font-medium">{p.fullName}</Td>
              <Td>@{p.username}</Td>
              <Td className="text-gray-600">{[p.phone, p.email].filter(Boolean).join(' · ') || '—'}</Td>
              <Td className="text-gray-600">{p.lastLoginAt ? dateTime(p.lastLoginAt) : 'Never'}</Td>
              <Td>
                {!p.isActive ? <Badge tone="red">Deactivated</Badge> : p.mustChangePassword ? <Badge tone="amber">Temp password</Badge> : <Badge tone="green">Active</Badge>}
              </Td>
              <Td className="text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" onClick={() => resetPassword(p.id)}>
                    Reset password
                  </Button>
                  <Button variant="ghost" onClick={() => toggleActive(p.id, !p.isActive)}>
                    {p.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card
        title="Subscription invoices"
        className="mt-6"
        actions={
          <Button variant="secondary" onClick={generateInvoice}>
            Invoice this month
          </Button>
        }
      >
        {data.invoices.length === 0 ? (
          <Empty title="No invoices yet" />
        ) : (
          <Table head={['Month', 'Students', 'Amount', 'Due', 'Status', 'Paid']}>
            {data.invoices.map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.period}</Td>
                <Td>
                  {i.activeStudents}
                  {i.extraStudents > 0 && <span className="text-xs text-gray-500"> (+{i.extraStudents})</span>}
                </Td>
                <Td>{money(i.amount, cur)}</Td>
                <Td>{date(i.dueDate)}</Td>
                <Td>
                  <Badge tone={i.overdue ? 'red' : statusTone[i.status]}>{i.overdue ? 'Overdue' : i.status}</Badge>
                </Td>
                <Td className="text-gray-600">{i.paidAt ? `${money(i.paidAmount, cur)} on ${date(i.paidAt)}` : '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
        <Link href={`/admin/invoices?schoolId=${id}`} className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
          Record payments on the Invoices page →
        </Link>
      </Card>

      <Card title="Recent activity" className="mt-6">
        {data.recentAudit.length === 0 ? (
          <Empty title="No activity yet" />
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.recentAudit.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-2">
                <span>
                  <code className="text-xs text-gray-700">{a.action}</code>
                  {a.reason && <span className="text-gray-500"> — {a.reason}</span>}
                </span>
                <span className="shrink-0 text-xs text-gray-500">{dateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <EditModal open={modal === 'edit'} detail={data} plans={plans?.plans ?? []} busy={busy} error={formError} onClose={() => setModal(null)} onSave={(body) => run(() => api.patch(`/admin/schools/${id}`, body), 'School updated')} />
      <StatusModal open={modal === 'status'} current={s.status} busy={busy} error={formError} onClose={() => setModal(null)} onSave={(body) => run(() => api.post(`/admin/schools/${id}/status`, body), 'Status changed')} />
      <PrincipalModal
        open={modal === 'principal'}
        busy={busy}
        error={formError}
        onClose={() => setModal(null)}
        onSave={(body) =>
          run(async () => {
            const res = await api.post<{ principal: { username: string }; tempPassword: string }>(`/admin/schools/${id}/principals`, body);
            setSecret({ username: res.principal.username, tempPassword: res.tempPassword });
          }, 'Principal added')
        }
      />
      <Modal open={modal === 'delete'} onClose={() => setModal(null)} title="Delete school">
        <DeleteForm
          code={s.code}
          busy={busy}
          error={formError}
          onDelete={(body) =>
            run(async () => {
              await api.del(`/admin/schools/${id}`, body);
              router.replace('/admin/schools');
            }, 'School deleted')
          }
        />
      </Modal>
    </>
  );
}

function EditModal({ open, detail, plans, busy, error, onClose, onSave }: { open: boolean; detail: Detail; plans: Plan[]; busy: boolean; error: unknown; onClose: () => void; onSave: (b: object) => void }) {
  const s = detail.school;
  const [f, setF] = useState({
    name: s.name,
    code: s.code,
    city: s.city ?? '',
    address: s.address ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    planId: s.planId,
    billingDay: String(s.billingDay),
    customStorageLimitMb: s.customStorageLimitMb?.toString() ?? '',
    customMaxStudents: s.customMaxStudents?.toString() ?? '',
    customMaxStaff: s.customMaxStaff?.toString() ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  function submit(e: FormEvent) {
    e.preventDefault();
    onSave({
      ...f,
      billingDay: Number(f.billingDay),
      customStorageLimitMb: num(f.customStorageLimitMb),
      customMaxStudents: num(f.customMaxStudents),
      customMaxStaff: num(f.customMaxStaff),
    });
  }
  return (
    <Modal open={open} onClose={onClose} title="Edit school" wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input className="input" required value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Code">
          <input className="input" required value={f.code} onChange={set('code')} />
        </Field>
        <Field label="City">
          <input className="input" value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Phone">
          <input className="input" value={f.phone} onChange={set('phone')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address">
            <input className="input" value={f.address} onChange={set('address')} />
          </Field>
        </div>
        <Field label="Email">
          <input className="input" type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Plan">
          <select className="input" value={f.planId} onChange={set('planId')}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {!p.isActive ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Invoice due day">
          <input className="input" type="number" min={1} max={28} value={f.billingDay} onChange={set('billingDay')} />
        </Field>
        <div className="sm:col-span-2 mt-2 text-sm font-medium text-gray-800">Custom limits (leave empty to use the plan)</div>
        <Field label="Storage (MB)">
          <input className="input" type="number" min={0} value={f.customStorageLimitMb} onChange={set('customStorageLimitMb')} />
        </Field>
        <Field label="Max students">
          <input className="input" type="number" min={0} value={f.customMaxStudents} onChange={set('customMaxStudents')} />
        </Field>
        <Field label="Max staff">
          <input className="input" type="number" min={0} value={f.customMaxStaff} onChange={set('customMaxStaff')} />
        </Field>
        <div className="sm:col-span-2 space-y-3">
          <ErrorBox error={error} />
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StatusModal({ open, current, busy, error, onClose, onSave }: { open: boolean; current: string; busy: boolean; error: unknown; onClose: () => void; onSave: (b: object) => void }) {
  const [status, setStatus] = useState(current);
  const [reason, setReason] = useState('');
  const [trialDays, setTrialDays] = useState('14');
  const help: Record<string, string> = {
    TRIAL: 'Full access until the trial ends, then read-only.',
    ACTIVE: 'Full access.',
    READ_ONLY: 'Can view everything, cannot change anything.',
    SUSPENDED: 'Cannot use the system at all.',
  };
  return (
    <Modal open={open} onClose={onClose} title="Change school status">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ status, reason, ...(status === 'TRIAL' ? { trialDays: Number(trialDays) } : {}) });
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          {Object.entries(statusLabel).map(([k, v]) => (
            <label key={k} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${status === k ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}>
              <input type="radio" name="status" checked={status === k} onChange={() => setStatus(k)} />
              <span>
                <span className="block text-sm font-medium">{v}</span>
                <span className="block text-xs text-gray-500">{help[k]}</span>
              </span>
            </label>
          ))}
        </div>
        {status === 'TRIAL' && (
          <Field label="Trial days from today">
            <input className="input" type="number" min={1} max={90} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
          </Field>
        )}
        <Field label="Reason (saved in audit log)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" loading={busy}>
          Save status
        </Button>
      </form>
    </Modal>
  );
}

function PrincipalModal({ open, busy, error, onClose, onSave }: { open: boolean; busy: boolean; error: unknown; onClose: () => void; onSave: (b: object) => void }) {
  const [f, setF] = useState({ fullName: '', username: '', email: '', phone: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} title="Add principal account">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(f);
        }}
        className="space-y-4"
      >
        <Field label="Full name">
          <input className="input" required value={f.fullName} onChange={set('fullName')} />
        </Field>
        <Field label="Username">
          <input className="input" required value={f.username} onChange={set('username')} />
        </Field>
        <Field label="Email (optional)">
          <input className="input" type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Phone (optional)">
          <input className="input" value={f.phone} onChange={set('phone')} />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" loading={busy}>
          Create account
        </Button>
      </form>
    </Modal>
  );
}

function DeleteForm({ code, busy, error, onDelete }: { code: string; busy: boolean; error: unknown; onDelete: (b: object) => void }) {
  const [confirmCode, setConfirmCode] = useState('');
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onDelete({ confirmCode, reason });
      }}
      className="space-y-4"
    >
      <p className="text-sm text-gray-700">
        Everyone in this school will be logged out and lose access. The data is kept (soft delete) and can be restored from the database if needed.
      </p>
      <Field label={`Type the school code "${code}" to confirm`}>
        <input className="input" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} />
      </Field>
      <Field label="Reason">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorBox error={error} />
      <Button type="submit" variant="danger" loading={busy} disabled={confirmCode !== code}>
        Delete school
      </Button>
    </form>
  );
}
