'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { Button, Card, ErrorBox, Field, PageHeader, SecretBox } from '@/components/ui';
import { money } from '@/lib/format';
import type { Plan } from '@/lib/types';

interface Created {
  school: { id: string; name: string; code: string };
  principal: { username: string; fullName: string };
  tempPassword: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export default function NewSchoolPage() {
  const { data: plans } = useData<{ plans: Plan[] }>('/admin/plans');
  const [f, setF] = useState({
    name: '',
    code: '',
    city: '',
    address: '',
    phone: '',
    email: '',
    planId: '',
    status: 'TRIAL',
    trialDays: '14',
    billingDay: '10',
    mainCampusName: 'Main Campus',
    pFullName: '',
    pUsername: '',
    pEmail: '',
    pPhone: '',
  });
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const activePlans = plans?.plans.filter((p) => p.isActive) ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await api.post<Created>('/admin/schools', {
        school: {
          name: f.name,
          code: f.code,
          city: f.city,
          address: f.address,
          phone: f.phone,
          email: f.email,
          planId: f.planId || activePlans[0]?.id,
          status: f.status,
          trialDays: Number(f.trialDays),
          billingDay: Number(f.billingDay),
          mainCampusName: f.mainCampusName,
        },
        principal: { fullName: f.pFullName, username: f.pUsername, email: f.pEmail, phone: f.pPhone },
      });
      setCreated(res);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <>
        <PageHeader title="School created" />
        <Card className="max-w-lg">
          <p className="text-sm text-gray-700">
            <strong>{created.school.name}</strong> is ready. Share these login details with <strong>{created.principal.fullName}</strong>.
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-gray-500">Login page</dt>
              <dd className="font-medium">{typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Username</dt>
              <dd className="font-medium">{created.principal.username}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <SecretBox label="Temporary password" value={created.tempPassword} />
          </div>
          <div className="mt-5 flex gap-2">
            <Link href={`/admin/schools/${created.school.id}`}>
              <Button>Open school</Button>
            </Link>
            <Link href="/admin/schools">
              <Button variant="secondary">Back to schools</Button>
            </Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="New school" subtitle="Creates the school, its main campus and the principal's login" />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <Card title="School">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="School name">
                <input
                  className="input"
                  required
                  value={f.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setF((x) => ({ ...x, name, code: codeTouched ? x.code : slug(name) }));
                  }}
                />
              </Field>
            </div>
            <Field label="School code" hint="Short unique ID, e.g. city-grammar">
              <input
                className="input"
                required
                pattern="[a-z0-9\-]+"
                value={f.code}
                onChange={(e) => {
                  setCodeTouched(true);
                  setF((x) => ({ ...x, code: slug(e.target.value) }));
                }}
              />
            </Field>
            <Field label="City">
              <input className="input" value={f.city} onChange={set('city')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                <input className="input" value={f.address} onChange={set('address')} />
              </Field>
            </div>
            <Field label="Phone">
              <input className="input" value={f.phone} onChange={set('phone')} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={f.email} onChange={set('email')} />
            </Field>
            <Field label="Main campus name">
              <input className="input" value={f.mainCampusName} onChange={set('mainCampusName')} />
            </Field>
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Plan and billing">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Plan">
                  <select className="input" required value={f.planId || activePlans[0]?.id || ''} onChange={set('planId')}>
                    {activePlans.length === 0 && <option value="">Create a plan first</option>}
                    {activePlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {money(p.monthlyPrice)}/month, {p.includedStudents} students included, then {money(p.perStudentPrice)}/student
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Start as">
                <select className="input" value={f.status} onChange={set('status')}>
                  <option value="TRIAL">Free trial</option>
                  <option value="ACTIVE">Active (paid)</option>
                </select>
              </Field>
              {f.status === 'TRIAL' ? (
                <Field label="Trial days">
                  <input className="input" type="number" min={1} max={90} value={f.trialDays} onChange={set('trialDays')} />
                </Field>
              ) : (
                <span />
              )}
              <Field label="Invoice due day of month" hint="1–28">
                <input className="input" type="number" min={1} max={28} value={f.billingDay} onChange={set('billingDay')} />
              </Field>
            </div>
          </Card>
          <Card title="Principal account">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name">
                <input className="input" required value={f.pFullName} onChange={set('pFullName')} />
              </Field>
              <Field label="Username" hint="Used to log in">
                <input className="input" required pattern="[a-zA-Z0-9._\-]{3,80}" value={f.pUsername} onChange={set('pUsername')} />
              </Field>
              <Field label="Email (optional)">
                <input className="input" type="email" value={f.pEmail} onChange={set('pEmail')} />
              </Field>
              <Field label="Phone / WhatsApp (optional)">
                <input className="input" value={f.pPhone} onChange={set('pPhone')} />
              </Field>
            </div>
            <p className="mt-3 text-xs text-gray-500">A temporary password is generated. The principal must change it at first login.</p>
          </Card>
          <ErrorBox error={error} />
          <div className="flex gap-2">
            <Button type="submit" loading={saving} disabled={activePlans.length === 0}>
              Create school
            </Button>
            <Link href="/admin/schools">
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}
