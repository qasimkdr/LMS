'use client';

import Link from 'next/link';
import { Suspense, use, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Tabs } from '@/components/Tabs';
import { StudentProgress } from '@/components/progress/StudentProgress';
import { LeaveSchool, StudentHistory } from '@/components/progress/Lifecycle';
import { Avatar } from '@/components/Avatar';
import { PhotoPicker } from '@/components/PhotoPicker';
import { GuardianFields, emptyGuardian } from '@/components/StudentForm';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, SecretBox } from '@/components/ui';
import { AttendanceCalendar, STATUS, type Status } from '@/components/Attendance';
import { StudentFees } from '@/components/fees/StudentFees';
import { ResultsList, type ResultRow } from '@/components/exams/ResultsList';
import { age, bytes, date, dateTime, genderLabel, relationLabel, studentStatusLabel } from '@/lib/format';
import { className, type Guardian } from '@/lib/types';

type Tab = 'overview' | 'family' | 'attendance' | 'results' | 'progress' | 'history' | 'fees' | 'documents' | 'account';

interface LoginInfo {
  id: string;
  username: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}
interface Detail {
  student: {
    id: string;
    fullName: string;
    nameUrdu: string | null;
    admissionNo: string;
    admissionDate: string;
    admissionType: string;
    rollNo: string | null;
    status: string;
    statusDate: string | null;
    statusReason: string | null;
    gender: string;
    dob: string | null;
    placeOfBirth: string | null;
    bForm: string | null;
    religion: string | null;
    nationality: string | null;
    motherTongue: string | null;
    bloodGroup: string | null;
    currentAddress: string | null;
    permanentAddress: string | null;
    city: string | null;
    area: string | null;
    phone: string | null;
    email: string | null;
    photoFileId: string | null;
    emergencyContact: Record<string, string | null> | null;
    previousSchool: Record<string, string | null> | null;
    health: Record<string, string | null> | null;
    feeCategory: string | null;
    discountType: string | null;
    discountPercent: number | null;
    transportRequired: boolean;
    notes: string | null;
    class: { id: string; name: string; stream: string | null };
    section: { id: string; name: string; classTeacher: { fullName: string } | null } | null;
    session: { name: string } | null;
    user: LoginInfo | null;
    family: {
      id: string;
      familyNo: string;
      guardians: (Guardian & { id: string })[];
      parentUser: LoginInfo | null;
      students: { id: string; fullName: string; admissionNo: string; status: string; class: { name: string }; section: { name: string } | null }[];
    };
    documents: { id: string; docType: string; createdAt: string; file: { id: string; originalName: string; mimeType: string; sizeBytes: number } | null }[];
  };
  missingDocuments: { type: string; label: string }[];
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children || <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

function ProfileInner({ id }: { id: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const canManage = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('students.manage');
  const isTeacher = me?.user.role === 'TEACHER';
  const tab = (params.get('tab') as Tab) || 'overview';
  const { data, error, loading, reload } = useData<Detail>(`/students/${id}`);
  const [modal, setModal] = useState<null | 'status' | 'delete' | 'leave'>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const st = data.student;

  async function setPhoto(fileId: string | null) {
    try {
      await api.patch(`/students/${id}`, { photoFileId: fileId });
      toast('Photo updated');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'family', label: 'Family' },
  ];
  if ((me?.school?.plan.modules ?? []).includes('attendance')) tabs.push({ key: 'attendance', label: 'Attendance' });
  if ((me?.school?.plan.modules ?? []).includes('exams')) tabs.push({ key: 'results', label: 'Results' });
  tabs.push({ key: 'progress', label: 'Remarks & progress' }, { key: 'history', label: 'History' });
  const feePerm = me?.user.role === 'PRINCIPAL' || ['fees.collect', 'fees.manage', 'fees.reports'].some((k) => me?.user.permissions.includes(k));
  if ((me?.school?.plan.modules ?? []).includes('fees') && feePerm) tabs.push({ key: 'fees', label: 'Fees' });
  if (!isTeacher) tabs.push({ key: 'documents', label: 'Documents', count: st.documents.length }, { key: 'account', label: 'Logins' });

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start">
        {canManage ? <PhotoPicker value={st.photoFileId} onChange={setPhoto} size={96} /> : <Avatar fileId={st.photoFileId} name={st.fullName} size={96} />}
        <div className="flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-gray-900 sm:text-2xl">
            {st.fullName}
            {st.status !== 'ACTIVE' && <Badge tone="gray">{studentStatusLabel[st.status]}</Badge>}
          </h1>
          {st.nameUrdu && (
            <div className="text-gray-600" dir="rtl">
              {st.nameUrdu}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
            <span>Adm. no {st.admissionNo}</span>
            <span>{className(st.class, st.section)}</span>
            {st.rollNo && <span>Roll {st.rollNo}</span>}
            <span>Family {st.family.familyNo}</span>
            {st.section?.classTeacher && <span>Class teacher: {st.section.classTeacher.fullName}</span>}
          </div>
          {st.status !== 'ACTIVE' && st.statusDate && (
            <div className="mt-1 text-sm text-gray-500">
              {studentStatusLabel[st.status]} on {date(st.statusDate)}
              {st.statusReason && ` — ${st.statusReason}`}
            </div>
          )}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/school/students/${id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
            <Link href={`/school/students/${id}/print`}>
              <Button variant="secondary">Print form</Button>
            </Link>
            {st.status === 'ACTIVE' && (
              <Button variant="secondary" onClick={() => setModal('leave')}>
                Leave school
              </Button>
            )}
            <Button variant="ghost" onClick={() => setModal('status')}>
              Status
            </Button>
            <Button variant="ghost" className="text-red-600" onClick={() => setModal('delete')}>
              Delete
            </Button>
          </div>
        )}
      </div>

      <Tabs tabs={tabs} value={tab} onChange={(t) => router.replace(`/school/students/${id}?tab=${t}`)} />

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Personal">
            <dl className="grid grid-cols-2 gap-4">
              <Info label="Gender">{genderLabel[st.gender]}</Info>
              <Info label="Date of birth">{st.dob ? `${date(st.dob)} (${age(st.dob)})` : null}</Info>
              <Info label="Place of birth">{st.placeOfBirth}</Info>
              <Info label="B-Form">{st.bForm}</Info>
              <Info label="Religion">{st.religion}</Info>
              <Info label="Nationality">{st.nationality}</Info>
              <Info label="Mother tongue">{st.motherTongue}</Info>
              <Info label="Blood group">{st.bloodGroup}</Info>
              <Info label="Student mobile">{st.phone}</Info>
              <Info label="Student email">{st.email}</Info>
            </dl>
          </Card>
          <Card title="Admission">
            <dl className="grid grid-cols-2 gap-4">
              <Info label="Session">{st.session?.name}</Info>
              <Info label="Admission date">{date(st.admissionDate)}</Info>
              <Info label="Type">{{ NEW: 'New', TRANSFER: 'Transfer', READMISSION: 'Re-admission' }[st.admissionType]}</Info>
              <Info label="Fee category">{st.feeCategory}</Info>
              <Info label="Discount">{st.discountType ? `${st.discountType}${st.discountPercent ? ` (${st.discountPercent}%)` : ''}` : null}</Info>
              <Info label="Transport">{st.transportRequired ? 'Needed' : 'No'}</Info>
            </dl>
          </Card>
          <Card title="Address">
            <dl className="grid gap-4">
              <Info label="Current address">{st.currentAddress}</Info>
              <Info label="Permanent address">{st.permanentAddress || (st.currentAddress ? 'Same as current' : null)}</Info>
              <div className="grid grid-cols-2 gap-4">
                <Info label="City">{st.city}</Info>
                <Info label="Area">{st.area}</Info>
              </div>
            </dl>
          </Card>
          <Card title="Health">
            {st.health && Object.values(st.health).some(Boolean) ? (
              <dl className="grid grid-cols-2 gap-4">
                <Info label="Allergies">{st.health.allergies}</Info>
                <Info label="Conditions">{st.health.conditions}</Info>
                <Info label="Medicines">{st.health.medicines}</Info>
                <Info label="Special needs">{st.health.specialNeeds}</Info>
                <Info label="Doctor">{[st.health.doctorName, st.health.doctorPhone].filter(Boolean).join(' · ')}</Info>
              </dl>
            ) : (
              <p className="text-sm text-gray-500">Nothing recorded.</p>
            )}
          </Card>
          <Card title="Emergency contact">
            {st.emergencyContact?.name ? (
              <dl className="grid grid-cols-3 gap-4">
                <Info label="Name">{st.emergencyContact.name}</Info>
                <Info label="Relation">{st.emergencyContact.relation}</Info>
                <Info label="Phone">{st.emergencyContact.phone}</Info>
              </dl>
            ) : (
              <p className="text-sm text-gray-500">Not added.</p>
            )}
          </Card>
          <Card title="Previous school">
            {st.previousSchool?.schoolName ? (
              <dl className="grid grid-cols-2 gap-4">
                <Info label="School">{st.previousSchool.schoolName}</Info>
                <Info label="Last class">{st.previousSchool.lastClass}</Info>
                <Info label="Year">{st.previousSchool.year}</Info>
                <Info label="Marks">{st.previousSchool.marks}</Info>
                <Info label="SLC no.">{st.previousSchool.slcNo}</Info>
                <Info label="Reason for leaving">{st.previousSchool.reasonForLeaving}</Info>
              </dl>
            ) : (
              <p className="text-sm text-gray-500">None.</p>
            )}
          </Card>
          {st.notes && (
            <Card title="Notes" className="lg:col-span-2">
              <p className="whitespace-pre-wrap text-sm">{st.notes}</p>
            </Card>
          )}
        </div>
      )}

      {tab === 'family' && <FamilyTab data={data} canManage={Boolean(canManage)} reload={reload} />}
      {tab === 'attendance' && <AttendanceTab id={id} />}
      {tab === 'results' && <StudentResults id={id} />}
      {tab === 'progress' && <StudentProgress studentId={id} studentName={st.fullName} />}
      {tab === 'history' && <StudentHistory studentId={id} />}
      {tab === 'fees' && <StudentFees studentId={id} familyId={st.family.id} />}
      {tab === 'documents' && <DocumentsTab data={data} canManage={Boolean(canManage)} reload={reload} />}
      {tab === 'account' && <AccountTab data={data} reload={reload} />}

      {modal === 'leave' && <LeaveSchool studentId={id} name={st.fullName} onClose={() => setModal(null)} />}
      {modal === 'status' && <StatusModal id={id} current={st.status} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'delete' && (
        <DeleteModal
          name={st.fullName}
          onClose={() => setModal(null)}
          onDelete={async (reason) => {
            await api.del(`/students/${id}`, { reason });
            toast('Moved to the recycle bin');
            router.replace('/school/students');
          }}
        />
      )}
    </>
  );
}

export default function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <ProfileInner id={id} />
    </Suspense>
  );
}

// ---------- Results ----------

function StudentResults({ id }: { id: string }) {
  const { data, loading } = useData<{ rows: ResultRow[]; testMonths: { month: string; tests: number; average: number }[] }>(`/results/students/${id}`);
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return <ResultsList rows={data.rows} testMonths={data.testMonths} reportHref={(r) => `/report-cards/${r.assessmentId}?studentId=${id}`} />;
}

// ---------- Attendance ----------

function AttendanceTab({ id }: { id: string }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, loading } = useData<{
    month: { counts: Record<string, number>; percent: number | null; days: { date: string; status: Status }[] };
    year: { from: string; counts: Record<string, number>; percent: number | null };
  }>(`/attendance/students/${id}?month=${month}`);
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const summary = (c: Record<string, number>) =>
    (Object.keys(STATUS) as Status[])
      .filter((s) => c[s])
      .map((s) => (
        <span key={s} className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS[s].cell}`}>
          {STATUS[s].label}: {c[s]}
        </span>
      ));
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Calendar" className="lg:col-span-2">
        <AttendanceCalendar month={month} days={data.month.days} onMonth={setMonth} />
      </Card>
      <div className="space-y-6">
        <Card title="This month">
          <div className="text-3xl font-semibold">{data.month.percent === null ? '—' : `${data.month.percent}%`}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">{summary(data.month.counts)}</div>
        </Card>
        <Card title={`This session (since ${date(data.year.from)})`}>
          <div className="text-3xl font-semibold">{data.year.percent === null ? '—' : `${data.year.percent}%`}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">{summary(data.year.counts)}</div>
        </Card>
      </div>
    </div>
  );
}

// ---------- Family ----------

function FamilyTab({ data, canManage, reload }: { data: Detail; canManage: boolean; reload: () => void }) {
  const st = data.student;
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-6">
      <Card
        title={`Parents and guardians · Family ${st.family.familyNo}`}
        actions={
          canManage && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {st.family.guardians.map((g) => (
            <div key={g.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase text-gray-500">
                  {relationLabel[g.relation]}
                  {g.relationDetail && ` (${g.relationDetail})`}
                </div>
                <div className="flex gap-1">
                  {g.receivesMessages && <Badge tone="green">Gets messages</Badge>}
                  {g.isDeceased && <Badge>Deceased</Badge>}
                </div>
              </div>
              <div className="mt-1 font-medium">{g.fullName}</div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <Info label="CNIC">{g.cnic}</Info>
                <Info label="Mobile">{g.phone}</Info>
                <Info label="WhatsApp">{g.whatsapp}</Info>
                <Info label="Occupation">{g.occupation}</Info>
                {g.email && <Info label="Email">{g.email}</Info>}
                {g.organization && <Info label="Organization">{g.organization}</Info>}
              </dl>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Brothers and sisters in this school">
        {st.family.students.length === 0 ? (
          <p className="text-sm text-gray-500">None. Siblings are linked automatically when you enter the same father’s CNIC or mobile during admission.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {st.family.students.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/school/students/${s.id}`} className="font-medium hover:text-brand-700 hover:underline">
                  {s.fullName}
                </Link>
                <span className="text-gray-500">
                  {s.admissionNo} · {s.class.name}
                  {s.section ? ` ${s.section.name}` : ''} {s.status !== 'ACTIVE' && `· ${studentStatusLabel[s.status]}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <GuardiansModal studentId={st.id} guardians={st.family.guardians} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

function GuardiansModal({ studentId, guardians, onClose, onSaved }: { studentId: string; guardians: Guardian[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<Guardian[]>(guardians.length ? guardians : [emptyGuardian('FATHER')]);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const missing = (['FATHER', 'MOTHER', 'GUARDIAN'] as const).filter((r) => !list.some((g) => g.relation === r));
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/students/${studentId}/guardians`, { guardians: list.filter((g) => g.fullName.trim()) });
      toast('Family details saved (also updated for brothers and sisters)');
      onSaved();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Edit parents and guardians" wide>
      <div className="space-y-6">
        {list.map((g, i) => (
          <div key={i}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">{relationLabel[g.relation]}</div>
              <button className="text-xs text-gray-500 hover:text-red-600" onClick={() => setList(list.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <GuardianFields g={g} onChange={(ng) => setList(list.map((x, j) => (j === i ? ng : x)))} req={() => false} />
            </div>
          </div>
        ))}
        {missing.length > 0 && (
          <div className="flex gap-2">
            {missing.map((r) => (
              <Button key={r} variant="secondary" onClick={() => setList([...list, emptyGuardian(r)])}>
                + {relationLabel[r]}
              </Button>
            ))}
          </div>
        )}
        <ErrorBox error={error} />
        <Button onClick={save} loading={saving}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

// ---------- Documents ----------

function DocumentsTab({ data, canManage, reload }: { data: Detail; canManage: boolean; reload: () => void }) {
  const toast = useToast();
  const { data: meta } = useData<{ documentTypes: Record<string, string> }>('/setup/meta');
  const [docType, setDocType] = useState('B_FORM');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const st = data.student;

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('category', 'STUDENT_DOCUMENT');
      form.append('file', file);
      const r = await api.post<{ file: { id: string } }>('/files', form);
      await api.post(`/students/${st.id}/documents`, { fileId: r.file.id, docType });
      toast('Document uploaded');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Checklist">
        {data.missingDocuments.length === 0 ? (
          <p className="text-sm text-emerald-700">All checklist documents uploaded.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.missingDocuments.map((d) => (
              <li key={d.type} className="flex items-center gap-2 text-amber-700">
                <span>○</span>
                <button className="hover:underline" onClick={() => setDocType(d.type)}>
                  {d.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
            <Field label="Document type">
              <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
                {Object.entries(meta?.documentTypes ?? {}).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <input ref={input} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            <Button onClick={() => input.current?.click()} loading={busy} className="w-full">
              Upload photo or PDF
            </Button>
            <p className="text-xs text-gray-500">On a phone you can take a picture of the document.</p>
          </div>
        )}
      </Card>
      <Card title="Uploaded" className="lg:col-span-2">
        {st.documents.length === 0 ? (
          <Empty title="No documents yet" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {st.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{meta?.documentTypes[d.docType] ?? d.docType}</div>
                  {d.file && (
                    <a href={fileUrl(d.file.id)} target="_blank" rel="noreferrer" className="block truncate text-xs text-brand-700 hover:underline">
                      {d.file.originalName} · {bytes(d.file.sizeBytes)} · {date(d.createdAt)}
                    </a>
                  )}
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm('Delete this document?')) return;
                      await api.del(`/students/${st.id}/documents/${d.id}`);
                      toast('Deleted');
                      reload();
                    }}
                  >
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- Logins ----------

function AccountTab({ data, reload }: { data: Detail; reload: () => void }) {
  const toast = useToast();
  const [secret, setSecret] = useState<{ username: string; tempPassword: string } | null>(null);
  const st = data.student;
  const rows: { label: string; login: LoginInfo | null }[] = [
    { label: 'Student login', login: st.user },
    { label: 'Parent login (shared by brothers and sisters)', login: st.family.parentUser },
  ];
  async function reset(userId: string) {
    if (!confirm('Create a new temporary password? The old one stops working.')) return;
    try {
      setSecret(await api.post(`/users/${userId}/reset-password`));
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }
  async function toggle(userId: string, isActive: boolean) {
    try {
      await api.post(`/users/${userId}/active`, { isActive });
      toast(isActive ? 'Login enabled' : 'Login disabled');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }
  return (
    <div className="space-y-4">
      {secret && (
        <div className="max-w-md">
          <p className="mb-2 text-sm">
            New password for <strong>{secret.username}</strong>:
          </p>
          <SecretBox label="Temporary password" value={secret.tempPassword} />
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(({ label, login }) => (
          <Card key={label} title={label}>
            {!login ? (
              <p className="text-sm text-gray-500">No login created.</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3">
                  <Info label="Username">
                    <span className="font-mono">{login.username}</span>
                  </Info>
                  <Info label="Status">
                    {!login.isActive ? <Badge tone="red">Disabled</Badge> : login.mustChangePassword ? <Badge tone="amber">Not logged in yet</Badge> : <Badge tone="green">Active</Badge>}
                  </Info>
                  <Info label="Last login">{login.lastLoginAt ? dateTime(login.lastLoginAt) : 'Never'}</Info>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => reset(login.id)}>
                    Reset password
                  </Button>
                  <Button variant="ghost" onClick={() => toggle(login.id, !login.isActive)}>
                    {login.isActive ? 'Disable login' : 'Enable login'}
                  </Button>
                </div>
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------- Modals ----------

function StatusModal({ id, current, onClose, onDone }: { id: string; current: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState(current === 'ACTIVE' ? 'LEFT' : 'ACTIVE');
  const [dateVal, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Modal open onClose={onClose} title="Change student status">
      <div className="space-y-4">
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(studentStatusLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {status !== 'ACTIVE' && (
          <>
            <Field label="Date">
              <input className="input" type="date" value={dateVal} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Reason">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <p className="text-xs text-gray-500">The student’s login is disabled. The parent login stays on while a brother or sister is still active.</p>
          </>
        )}
        <ErrorBox error={error} />
        <Button
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api.post(`/students/${id}/status`, { status, date: dateVal, reason });
              toast('Status updated');
              onDone();
            } catch (e) {
              setError(e);
              setSaving(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

function DeleteModal({ name, onClose, onDelete }: { name: string; onClose: () => void; onDelete: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Delete ${name}?`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Use this for mistakes and duplicates. For students who left, change the status instead. The principal can restore deleted students from the recycle bin for 30 days.
        </p>
        <Field label="Reason">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onDelete(reason);
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          Delete
        </Button>
      </div>
    </Modal>
  );
}
