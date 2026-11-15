'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Avatar } from '@/components/Avatar';
import { StaffForm, PERMISSION_GROUPS, toStaffValues } from '@/components/StaffForm';
import { Badge, Button, Card, ErrorBox, Loading, SecretBox } from '@/components/ui';
import { date, dateTime, money, roleLabel } from '@/lib/format';
import { className } from '@/lib/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Staff = any;

export default function StaffProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const isPrincipal = me?.user.role === 'PRINCIPAL';
  const canManage = isPrincipal || me?.user.permissions.includes('staff.manage');
  const { data, error, loading, reload } = useData<{ staff: Staff }>(`/staff/${id}`);
  const [editing, setEditing] = useState(false);
  const [secret, setSecret] = useState<{ username: string; tempPassword: string } | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const s = data.staff;
  const p = s.staffProfile ?? {};

  if (editing) {
    return (
      <>
        <h1 className="mb-6 text-xl font-semibold">Edit {s.fullName}</h1>
        <StaffForm
          mode="edit"
          initial={toStaffValues(s)}
          submitLabel="Save changes"
          onSubmit={async (body) => {
            await api.patch(`/staff/${id}`, body);
            toast('Saved');
            setEditing(false);
            reload();
          }}
        />
        <Button variant="ghost" className="mt-2" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </>
    );
  }

  async function act(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      toast(msg);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  const permLabels = new Map(PERMISSION_GROUPS.flatMap((g) => g.items));

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar fileId={s.photoFileId} name={s.fullName} size={80} />
        <div className="flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold sm:text-2xl">
            {s.fullName} {!s.isActive && <Badge tone="red">Disabled</Badge>}
          </h1>
          <div className="text-sm text-gray-600">
            {p.designation ?? roleLabel[s.role]} · {p.employeeNo} · @{s.username}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {isPrincipal && (
              <>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (!confirm('Create a new temporary password?')) return;
                    try {
                      setSecret(await api.post(`/users/${id}/reset-password`));
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Failed', 'error');
                    }
                  }}
                >
                  Reset password
                </Button>
                <Button variant="ghost" onClick={() => act(() => api.post(`/users/${id}/active`, { isActive: !s.isActive }), s.isActive ? 'Login disabled' : 'Login enabled')}>
                  {s.isActive ? 'Disable login' : 'Enable login'}
                </Button>
                <Button
                  variant="ghost"
                  className="text-red-600"
                  onClick={async () => {
                    const reason = prompt(`Delete ${s.fullName}? They lose access and are removed from their classes. You can restore within 30 days.\n\nReason:`);
                    if (reason === null) return;
                    await api.del(`/staff/${id}`, { reason });
                    toast('Moved to the recycle bin');
                    router.replace('/school/staff');
                  }}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {secret && (
        <div className="mb-6 max-w-md">
          <SecretBox label={`New password for ${secret.username}`} value={secret.tempPassword} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            {[
              ['Mobile', s.phone],
              ['Email', s.email],
              ['CNIC', p.cnic],
              ['Gender', p.gender ? { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' }[p.gender as string] : null],
              ['Date of birth', p.dob ? date(p.dob) : null],
              ['Qualification', p.qualification],
              ['Joining date', p.joiningDate ? date(p.joiningDate) : null],
              ...(isPrincipal ? [['Salary', p.salary != null ? money(p.salary, me?.school?.currency) : null]] : []),
              ['Address', p.address],
              ['Emergency', p.emergency?.name ? `${p.emergency.name} (${p.emergency.relation ?? ''}) ${p.emergency.phone ?? ''}` : null],
              ['Last login', s.lastLoginAt ? dateTime(s.lastLoginAt) : 'Never'],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-gray-500">{k}</dt>
                <dd className="mt-0.5">{v || <span className="text-gray-400">—</span>}</dd>
              </div>
            ))}
          </dl>
        </Card>
        {s.role === 'TEACHER' ? (
          <Card
            title="Classes"
            actions={
              isPrincipal && (
                <Link href="/school/assignments" className="text-sm font-medium text-brand-700 hover:underline">
                  Change →
                </Link>
              )
            }
          >
            <div className="text-xs font-semibold uppercase text-gray-500">Class teacher of</div>
            <div className="mt-1 text-sm">{s.classTeacherOf.length ? s.classTeacherOf.map((x: Staff) => className(x.class, x)).join(', ') : 'None'}</div>
            <div className="mt-4 text-xs font-semibold uppercase text-gray-500">Teaches</div>
            <ul className="mt-1 space-y-1 text-sm">
              {s.teachingSubjects.length ? s.teachingSubjects.map((t: Staff) => <li key={t.id}>{t.subject.name} — {className(t.section.class, t.section)}</li>) : <li>None yet</li>}
            </ul>
          </Card>
        ) : (
          <Card title="Permissions">
            {(s.permissions ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No permissions yet. Edit to choose what this person can do.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {(s.permissions as string[]).map((k) => (
                  <li key={k}>✓ {permLabels.get(k) ?? k}</li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
