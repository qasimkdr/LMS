'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { bytes, money } from '@/lib/format';
import type { Plan } from '@/lib/types';

export default function PlansPage() {
  const { data, error, loading, reload } = useData<{ plans: Plan[] }>('/admin/plans');
  const { data: meta } = useData<{ modules: Record<string, string> }>('/admin/meta');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="Monthly price + per-student charge above the included students. Limits apply to every school on the plan."
        actions={<Button onClick={() => setEditing('new')}>+ New plan</Button>}
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : !data?.plans.length ? (
        <Empty title="No plans yet">Create at least one plan before adding schools.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.plans.map((p) => (
            <Card
              key={p.id}
              title={
                <span className="flex items-center gap-2">
                  {p.name} {!p.isActive && <Badge>Inactive</Badge>}
                </span>
              }
              actions={
                <Button variant="ghost" onClick={() => setEditing(p)}>
                  Edit
                </Button>
              }
            >
              <div className="text-2xl font-semibold">
                {money(p.monthlyPrice)}
                <span className="text-sm font-normal text-gray-500">/month</span>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                Includes {p.includedStudents} students, then {money(p.perStudentPrice)} per extra student
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-gray-500">Storage</dt>
                <dd className="text-right font-medium">{bytes(p.storageLimitMb * 1024 * 1024)}</dd>
                <dt className="text-gray-500">Max file size</dt>
                <dd className="text-right font-medium">{p.maxFileSizeMb} MB</dd>
                <dt className="text-gray-500">Student cap</dt>
                <dd className="text-right font-medium">{p.maxStudents ?? 'No cap'}</dd>
                <dt className="text-gray-500">Staff cap</dt>
                <dd className="text-right font-medium">{p.maxStaff ?? 'No cap'}</dd>
                <dt className="text-gray-500">Campuses</dt>
                <dd className="text-right font-medium">{p.maxCampuses}</dd>
                <dt className="text-gray-500">Schools on plan</dt>
                <dd className="text-right font-medium">{p.schoolCount}</dd>
              </dl>
              <div className="mt-4 flex flex-wrap gap-1">
                {p.modules.map((m) => (
                  <Badge key={m} tone="blue">
                    {meta?.modules[m] ?? m}
                  </Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <PlanForm
          plan={editing === 'new' ? null : editing}
          modules={meta?.modules ?? {}}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function PlanForm({ plan, modules, onClose, onSaved }: { plan: Plan | null; modules: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    monthlyPrice: String(plan?.monthlyPrice ?? ''),
    includedStudents: String(plan?.includedStudents ?? ''),
    perStudentPrice: String(plan?.perStudentPrice ?? ''),
    maxStudents: plan?.maxStudents?.toString() ?? '',
    maxStaff: plan?.maxStaff?.toString() ?? '',
    maxCampuses: String(plan?.maxCampuses ?? 1),
    storageGb: plan ? String(plan.storageLimitMb / 1024) : '5',
    maxFileSizeMb: String(plan?.maxFileSizeMb ?? 10),
    isActive: plan?.isActive ?? true,
    modules: new Set(plan?.modules ?? Object.keys(modules)),
  });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: f.name,
      description: f.description,
      monthlyPrice: Number(f.monthlyPrice),
      includedStudents: Number(f.includedStudents),
      perStudentPrice: Number(f.perStudentPrice),
      maxStudents: num(f.maxStudents),
      maxStaff: num(f.maxStaff),
      maxCampuses: Number(f.maxCampuses),
      storageLimitMb: Math.round(Number(f.storageGb) * 1024),
      maxFileSizeMb: Number(f.maxFileSizeMb),
      isActive: f.isActive,
      modules: [...f.modules],
    };
    try {
      if (plan) await api.patch(`/admin/plans/${plan.id}`, body);
      else await api.post('/admin/plans', body);
      toast(plan ? 'Plan updated' : 'Plan created');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={plan ? `Edit ${plan.name}` : 'New plan'} wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Field label="Plan name">
            <input className="input" required value={f.name} onChange={set('name')} />
          </Field>
        </div>
        <div className="sm:col-span-3">
          <Field label="Description (optional)">
            <input className="input" value={f.description} onChange={set('description')} />
          </Field>
        </div>
        <Field label="Monthly price">
          <input className="input" type="number" min={0} step="0.01" required value={f.monthlyPrice} onChange={set('monthlyPrice')} />
        </Field>
        <Field label="Students included">
          <input className="input" type="number" min={0} required value={f.includedStudents} onChange={set('includedStudents')} />
        </Field>
        <Field label="Price per extra student">
          <input className="input" type="number" min={0} step="0.01" required value={f.perStudentPrice} onChange={set('perStudentPrice')} />
        </Field>
        <Field label="Storage (GB)">
          <input className="input" type="number" min={0.01} step="0.5" required value={f.storageGb} onChange={set('storageGb')} />
        </Field>
        <Field label="Max file size (MB)">
          <input className="input" type="number" min={1} max={500} required value={f.maxFileSizeMb} onChange={set('maxFileSizeMb')} />
        </Field>
        <Field label="Campuses">
          <input className="input" type="number" min={1} required value={f.maxCampuses} onChange={set('maxCampuses')} />
        </Field>
        <Field label="Student cap" hint="Empty = no cap">
          <input className="input" type="number" min={0} value={f.maxStudents} onChange={set('maxStudents')} />
        </Field>
        <Field label="Staff cap" hint="Empty = no cap">
          <input className="input" type="number" min={0} value={f.maxStaff} onChange={set('maxStaff')} />
        </Field>
        <label className="flex items-center gap-2 self-center text-sm">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF((x) => ({ ...x, isActive: e.target.checked }))} /> Available for new schools
        </label>
        <div className="sm:col-span-3">
          <div className="label">Modules included</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(modules).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.modules.has(k)}
                  onChange={(e) =>
                    setF((x) => {
                      const m = new Set(x.modules);
                      if (e.target.checked) m.add(k);
                      else m.delete(k);
                      return { ...x, modules: m };
                    })
                  }
                />
                {v}
              </label>
            ))}
          </div>
        </div>
        <div className="sm:col-span-3 space-y-3">
          <ErrorBox error={error} />
          <Button type="submit" loading={saving}>
            {plan ? 'Save plan' : 'Create plan'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
