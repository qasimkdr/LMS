'use client';

import { useState, type FormEvent } from 'react';
import { useAuth } from './auth';
import { useData } from './useData';
import { PhotoPicker } from './PhotoPicker';
import { Button, Card, ErrorBox, Field } from './ui';
import { dateInput } from '@/lib/format';

/** Permission keys a principal can give office staff, grouped for the form. */
export const PERMISSION_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: 'Students', items: [['students.view', 'View students'], ['students.manage', 'Add and edit students, reset parent/student passwords'], ['admissions.manage', 'Enquiries and admissions']] },
  { title: 'Staff', items: [['staff.view', 'View staff'], ['staff.manage', 'Add and edit staff']] },
  { title: 'Fees', items: [['fees.collect', 'Collect fees and issue receipts'], ['fees.manage', 'Fee structure and vouchers'], ['fees.reports', 'Fee reports']] },
  { title: 'Academics', items: [['attendance.manage', 'Mark and edit attendance'], ['exams.manage', 'Exams and results']] },
  { title: 'Other', items: [['messages.send', 'Send WhatsApp and announcements'], ['files.manage', 'Upload and delete files'], ['gallery.manage', 'Gallery'], ['reports.view', 'View reports']] },
];

export interface StaffValues {
  fullName: string;
  role: 'TEACHER' | 'STAFF';
  username: string;
  email: string;
  phone: string;
  photoFileId: string | null;
  permissions: string[];
  profile: {
    employeeNo: string;
    designation: string;
    cnic: string;
    gender: string;
    dob: string;
    qualification: string;
    joiningDate: string;
    salary: string;
    address: string;
    campusId: string;
    emergency: { name: string; relation: string; phone: string };
    notes: string;
  };
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toStaffValues(u?: any): StaffValues {
  const p = u?.staffProfile;
  return {
    fullName: s(u?.fullName),
    role: u?.role ?? 'TEACHER',
    username: s(u?.username),
    email: s(u?.email),
    phone: s(u?.phone),
    photoFileId: u?.photoFileId ?? null,
    permissions: Array.isArray(u?.permissions) ? u.permissions : [],
    profile: {
      employeeNo: s(p?.employeeNo),
      designation: s(p?.designation),
      cnic: s(p?.cnic),
      gender: s(p?.gender),
      dob: dateInput(p?.dob),
      qualification: s(p?.qualification),
      joiningDate: dateInput(p?.joiningDate),
      salary: s(p?.salary),
      address: s(p?.address),
      campusId: s(p?.campusId),
      emergency: { name: s(p?.emergency?.name), relation: s(p?.emergency?.relation), phone: s(p?.emergency?.phone) },
      notes: s(p?.notes),
    },
  };
}

export function StaffForm({ mode, initial, onSubmit, submitLabel }: { mode: 'create' | 'edit'; initial?: StaffValues; onSubmit: (body: object) => Promise<void>; submitLabel: string }) {
  const { me } = useAuth();
  const isPrincipal = me?.user.role === 'PRINCIPAL';
  const { data: structure } = useData<{ campuses: { id: string; name: string }[] }>('/setup/structure');
  const [v, setV] = useState<StaffValues>(initial ?? toStaffValues());
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof StaffValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const setP = (k: keyof StaffValues['profile']) => (e: { target: { value: string } }) => setV((x) => ({ ...x, profile: { ...x.profile, [k]: e.target.value } }));
  const setE = (k: 'name' | 'relation' | 'phone') => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, profile: { ...x.profile, emergency: { ...x.profile.emergency, [k]: e.target.value } } }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const p = v.profile;
    const emergency = Object.values(p.emergency).some((x) => x.trim()) ? p.emergency : null;
    const profile: Record<string, unknown> = {
      ...p,
      gender: p.gender || null,
      dob: p.dob || null,
      joiningDate: p.joiningDate || null,
      campusId: p.campusId || null,
      emergency,
      salary: p.salary === '' ? null : Number(p.salary),
    };
    if (!isPrincipal) delete profile.salary;
    const body: Record<string, unknown> = { fullName: v.fullName, email: v.email, phone: v.phone, photoFileId: v.photoFileId, profile };
    if (isPrincipal) Object.assign(body, { role: v.role, permissions: v.permissions });
    else if (mode === 'create') body.role = v.role;
    if (mode === 'create' && v.username) body.username = v.username;
    try {
      await onSubmit(body);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card title="Account">
        <div className="flex flex-col gap-6 sm:flex-row">
          <PhotoPicker value={v.photoFileId} onChange={(id) => setV((x) => ({ ...x, photoFileId: id }))} />
          <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Full name *">
              <input className="input" required value={v.fullName} onChange={set('fullName')} />
            </Field>
            <Field label="Role *">
              <select className="input" value={v.role} onChange={set('role')} disabled={mode === 'edit' && !isPrincipal}>
                <option value="TEACHER">Teacher</option>
                <option value="STAFF">Office staff (accountant, clerk…)</option>
              </select>
            </Field>
            {mode === 'create' && (
              <Field label="Username" hint="Leave empty to create one automatically">
                <input className="input" value={v.username} onChange={set('username')} />
              </Field>
            )}
            <Field label="Mobile / WhatsApp">
              <input className="input" inputMode="tel" value={v.phone} onChange={set('phone')} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={v.email} onChange={set('email')} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Profile">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Employee no." hint={mode === 'create' ? 'Leave empty to number automatically' : undefined}>
            <input className="input" value={v.profile.employeeNo} onChange={setP('employeeNo')} />
          </Field>
          <Field label="Designation">
            <input className="input" placeholder="e.g. Senior Teacher" value={v.profile.designation} onChange={setP('designation')} />
          </Field>
          <Field label="CNIC">
            <input className="input" inputMode="numeric" value={v.profile.cnic} onChange={setP('cnic')} />
          </Field>
          <Field label="Gender">
            <select className="input" value={v.profile.gender} onChange={setP('gender')}>
              <option value="">—</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
          </Field>
          <Field label="Date of birth">
            <input className="input" type="date" value={v.profile.dob} onChange={setP('dob')} />
          </Field>
          <Field label="Qualification">
            <input className="input" value={v.profile.qualification} onChange={setP('qualification')} />
          </Field>
          <Field label="Joining date">
            <input className="input" type="date" value={v.profile.joiningDate} onChange={setP('joiningDate')} />
          </Field>
          {isPrincipal && (
            <Field label="Monthly salary" hint="Only the principal sees this">
              <input className="input" type="number" min={0} value={v.profile.salary} onChange={setP('salary')} />
            </Field>
          )}
          {(structure?.campuses.length ?? 0) > 1 && (
            <Field label="Campus">
              <select className="input" value={v.profile.campusId} onChange={setP('campusId')}>
                <option value="">—</option>
                {structure!.campuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Address">
              <input className="input" value={v.profile.address} onChange={setP('address')} />
            </Field>
          </div>
          <Field label="Emergency contact">
            <input className="input" value={v.profile.emergency.name} onChange={setE('name')} />
          </Field>
          <Field label="Relation">
            <input className="input" value={v.profile.emergency.relation} onChange={setE('relation')} />
          </Field>
          <Field label="Emergency phone">
            <input className="input" inputMode="tel" value={v.profile.emergency.phone} onChange={setE('phone')} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Notes">
              <textarea className="input min-h-16" value={v.profile.notes} onChange={setP('notes')} />
            </Field>
          </div>
        </div>
      </Card>

      {isPrincipal && v.role === 'STAFF' && (
        <Card title="What can this staff member do?">
          <div className="grid gap-5 md:grid-cols-2">
            {PERMISSION_GROUPS.map((grp) => (
              <div key={grp.title}>
                <div className="mb-1.5 text-xs font-semibold uppercase text-gray-500">{grp.title}</div>
                {grp.items.map(([k, label]) => (
                  <label key={k} className="flex items-start gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={v.permissions.includes(k)}
                      onChange={(e) => setV((x) => ({ ...x, permissions: e.target.checked ? [...x.permissions, k] : x.permissions.filter((p) => p !== k) }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <ErrorBox error={error} />
        <div>
          <Button type="submit" loading={saving}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
