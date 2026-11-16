'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useData } from './useData';
import { PhotoPicker } from './PhotoPicker';
import { Button, Card, ErrorBox, Field } from './ui';
import { dateInput } from '@/lib/format';
import { className, type Guardian, type Structure } from '@/lib/types';

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export interface StudentValues {
  fullName: string;
  nameUrdu: string;
  gender: string;
  dob: string;
  placeOfBirth: string;
  bForm: string;
  religion: string;
  nationality: string;
  motherTongue: string;
  bloodGroup: string;
  currentAddress: string;
  permanentAddress: string;
  city: string;
  area: string;
  phone: string;
  email: string;
  photoFileId: string | null;
  emergencyContact: { name: string; relation: string; phone: string };
  previousSchool: { schoolName: string; lastClass: string; year: string; marks: string; reasonForLeaving: string; slcNo: string };
  health: { allergies: string; conditions: string; medicines: string; specialNeeds: string; doctorName: string; doctorPhone: string };
  feeCategory: string;
  discountType: string;
  discountPercent: string;
  transportRequired: boolean;
  notes: string;
  admissionNo: string;
  admissionDate: string;
  admissionType: string;
  sessionId: string;
  classId: string;
  sectionId: string;
  rollNo: string;
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toValues(st?: any): StudentValues {
  return {
    fullName: s(st?.fullName),
    nameUrdu: s(st?.nameUrdu),
    gender: s(st?.gender),
    dob: dateInput(st?.dob),
    placeOfBirth: s(st?.placeOfBirth),
    bForm: s(st?.bForm),
    religion: st ? s(st.religion) : 'Islam',
    nationality: st ? s(st.nationality) : 'Pakistani',
    motherTongue: s(st?.motherTongue),
    bloodGroup: s(st?.bloodGroup),
    currentAddress: s(st?.currentAddress),
    permanentAddress: s(st?.permanentAddress),
    city: s(st?.city),
    area: s(st?.area),
    phone: s(st?.phone),
    email: s(st?.email),
    photoFileId: st?.photoFileId ?? null,
    emergencyContact: { name: s(st?.emergencyContact?.name), relation: s(st?.emergencyContact?.relation), phone: s(st?.emergencyContact?.phone) },
    previousSchool: {
      schoolName: s(st?.previousSchool?.schoolName),
      lastClass: s(st?.previousSchool?.lastClass),
      year: s(st?.previousSchool?.year),
      marks: s(st?.previousSchool?.marks),
      reasonForLeaving: s(st?.previousSchool?.reasonForLeaving),
      slcNo: s(st?.previousSchool?.slcNo),
    },
    health: {
      allergies: s(st?.health?.allergies),
      conditions: s(st?.health?.conditions),
      medicines: s(st?.health?.medicines),
      specialNeeds: s(st?.health?.specialNeeds),
      doctorName: s(st?.health?.doctorName),
      doctorPhone: s(st?.health?.doctorPhone),
    },
    feeCategory: s(st?.feeCategory),
    discountType: s(st?.discountType),
    discountPercent: s(st?.discountPercent),
    transportRequired: Boolean(st?.transportRequired),
    notes: s(st?.notes),
    admissionNo: s(st?.admissionNo),
    admissionDate: dateInput(st?.admissionDate ?? new Date()),
    admissionType: st?.admissionType ?? 'NEW',
    sessionId: s(st?.sessionId),
    classId: s(st?.classId),
    sectionId: s(st?.sectionId),
    rollNo: s(st?.rollNo),
  };
}

export function toPayload(v: StudentValues) {
  const nullIfEmpty = <T extends Record<string, string>>(o: T) => (Object.values(o).some((x) => x.trim()) ? o : null);
  return {
    ...v,
    sessionId: v.sessionId || null,
    sectionId: v.sectionId || null,
    dob: v.dob || null,
    gender: v.gender || undefined,
    discountPercent: v.discountPercent === '' ? null : Number(v.discountPercent),
    emergencyContact: nullIfEmpty(v.emergencyContact),
    previousSchool: nullIfEmpty(v.previousSchool),
    health: nullIfEmpty(v.health),
    admissionNo: v.admissionNo || null,
  };
}

export const emptyGuardian = (relation: Guardian['relation']): Guardian => ({
  relation,
  fullName: '',
  cnic: '',
  phone: '',
  whatsapp: '',
  email: '',
  occupation: '',
  organization: '',
  education: '',
  monthlyIncome: null,
  officeAddress: '',
  isDeceased: false,
  receivesMessages: relation === 'FATHER',
  relationDetail: '',
});

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <Card title={title}>
      {hint && <p className="-mt-1 mb-4 text-xs text-gray-500">{hint}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </Card>
  );
}

function Wide({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2 lg:col-span-3">{children}</div>;
}

/** Father / mother / guardian block (also used on the profile's Family tab). */
export function GuardianFields({ g, onChange, req }: { g: Guardian; onChange: (g: Guardian) => void; req: (k: string) => boolean }) {
  const set = (k: keyof Guardian) => (e: { target: { value: string } }) => onChange({ ...g, [k]: e.target.value });
  const isF = g.relation === 'FATHER';
  const isM = g.relation === 'MOTHER';
  const star = (k: string) => (req(k) ? ' *' : '');
  return (
    <>
      {g.relation === 'GUARDIAN' && (
        <Field label="Relation to student" hint="e.g. Uncle, Grandmother">
          <input className="input" value={s(g.relationDetail)} onChange={set('relationDetail')} />
        </Field>
      )}
      <Field label={`Full name${star(isF ? 'fatherName' : isM ? 'motherName' : '')}`}>
        <input className="input" value={g.fullName} onChange={set('fullName')} />
      </Field>
      <Field label={`CNIC${isF ? star('fatherCnic') : ''}`} hint="13 digits">
        <input className="input" inputMode="numeric" placeholder="35202-1234567-1" value={s(g.cnic)} onChange={set('cnic')} />
      </Field>
      <Field label={`Mobile${star(isF ? 'fatherPhone' : isM ? 'motherPhone' : '')}`}>
        <input className="input" inputMode="tel" placeholder="03001234567" value={s(g.phone)} onChange={set('phone')} />
      </Field>
      <Field label="WhatsApp number" hint="Leave empty if same as mobile">
        <input className="input" inputMode="tel" value={s(g.whatsapp)} onChange={set('whatsapp')} />
      </Field>
      <Field label="Email">
        <input className="input" type="email" value={s(g.email)} onChange={set('email')} />
      </Field>
      <Field label="Occupation">
        <input className="input" value={s(g.occupation)} onChange={set('occupation')} />
      </Field>
      {!isM && (
        <Field label="Organization / employer">
          <input className="input" value={s(g.organization)} onChange={set('organization')} />
        </Field>
      )}
      <Field label="Education">
        <input className="input" value={s(g.education)} onChange={set('education')} />
      </Field>
      {isF && (
        <>
          <Field label="Monthly income (optional)">
            <input className="input" type="number" min={0} value={s(g.monthlyIncome)} onChange={(e) => onChange({ ...g, monthlyIncome: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Office address">
            <input className="input" value={s(g.officeAddress)} onChange={set('officeAddress')} />
          </Field>
        </>
      )}
      <Wide>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(g.receivesMessages)} onChange={(e) => onChange({ ...g, receivesMessages: e.target.checked })} />
            Send WhatsApp messages and alerts to this person
          </label>
          <label className="flex items-center gap-2 text-gray-600">
            <input type="checkbox" checked={Boolean(g.isDeceased)} onChange={(e) => onChange({ ...g, isDeceased: e.target.checked, receivesMessages: e.target.checked ? false : g.receivesMessages })} />
            Deceased
          </label>
        </div>
      </Wide>
    </>
  );
}

interface FamilyMatch {
  id: string;
  familyNo: string;
  guardians: { relation: string; fullName: string; phone: string | null; cnic: string | null }[];
  students: { id: string; fullName: string; admissionNo: string; class: { name: string }; section: { name: string } | null }[];
}

/**
 * The admission / enrollment form. In "create" mode it also collects parents (or links to a sibling's family);
 * in "edit" mode only the student's own details (parents are edited on the profile).
 */
export function StudentForm({
  mode,
  initial,
  initialGuardian,
  onSubmit,
  submitLabel,
}: {
  mode: 'create' | 'edit';
  initial?: StudentValues;
  /** Prefill (e.g. from an admission enquiry): goes to father, mother or guardian by relation. */
  initialGuardian?: Partial<Guardian> & { relation: Guardian['relation'] };
  onSubmit: (payload: { student: ReturnType<typeof toPayload>; guardians: Guardian[]; familyId: string | null; createStudentLogin: boolean; createParentLogin: boolean; reason?: string }) => Promise<void>;
  submitLabel: string;
}) {
  const { data: structure } = useData<Structure>('/setup/structure');
  const { data: meta } = useData<{ requiredStudentFields: string[] }>('/setup/meta');
  const [v, setV] = useState<StudentValues>(initial ?? toValues());
  const pre = (r: Guardian['relation']) => ({ ...emptyGuardian(r), ...(initialGuardian?.relation === r ? initialGuardian : {}) });
  const [father, setFather] = useState<Guardian>(pre('FATHER'));
  const [mother, setMother] = useState<Guardian>(pre('MOTHER'));
  const [guardian, setGuardian] = useState<Guardian>(pre('GUARDIAN'));
  const [hasGuardian, setHasGuardian] = useState(initialGuardian?.relation === 'GUARDIAN');
  const [sibling, setSibling] = useState<FamilyMatch | null>(null);
  const [matches, setMatches] = useState<FamilyMatch[]>([]);
  const [logins, setLogins] = useState({ student: true, parent: true });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const required = new Set(meta?.requiredStudentFields ?? []);
  const req = (k: string) => required.has(k);
  const star = (k: string) => (req(k) ? ' *' : '');
  const set = (k: keyof StudentValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const setNested = <K extends 'emergencyContact' | 'previousSchool' | 'health'>(k: K, f: keyof StudentValues[K]) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: { ...x[k], [f]: e.target.value } }));

  // Default session = current one.
  useEffect(() => {
    if (structure && !v.sessionId && mode === 'create') {
      const cur = structure.sessions.find((x) => x.isCurrent);
      if (cur) setV((x) => ({ ...x, sessionId: cur.id }));
    }
  }, [structure, v.sessionId, mode]);

  // Sibling detection from father's CNIC or mobile.
  useEffect(() => {
    if (mode !== 'create' || sibling) return;
    const cnic = (father.cnic ?? '').replace(/\D/g, '');
    const phone = (father.phone ?? '').replace(/\D/g, '');
    if (cnic.length !== 13 && phone.length < 10) return setMatches([]);
    const t = setTimeout(() => {
      const q = cnic.length === 13 ? `cnic=${cnic}` : `phone=${phone}`;
      api.get<{ families: FamilyMatch[] }>(`/students/sibling-lookup?${q}`).then((r) => setMatches(r.families)).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [father.cnic, father.phone, mode, sibling]);

  const cls = structure?.classes.find((c) => c.id === v.classId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const guardians = sibling ? [] : [father, mother, ...(hasGuardian ? [guardian] : [])].filter((g) => g.fullName.trim());
      await onSubmit({
        student: toPayload(v),
        guardians,
        familyId: sibling?.id ?? null,
        createStudentLogin: logins.student,
        createParentLogin: logins.parent,
        reason: reason || undefined,
      });
    } catch (err) {
      setError(err);
      setSaving(false);
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Section title="Admission">
        <Field label="Session">
          <select className="input" value={v.sessionId} onChange={set('sessionId')}>
            <option value="">—</option>
            {structure?.sessions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {x.isCurrent ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Class *">
          <select className="input" required value={v.classId} onChange={(e) => setV((x) => ({ ...x, classId: e.target.value, sectionId: '' }))}>
            <option value="">Choose class</option>
            {structure?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {className(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Section${star('section')}`}>
          <select className="input" value={v.sectionId} onChange={set('sectionId')} disabled={!cls}>
            <option value="">—</option>
            {cls?.sections.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sec.name} ({sec.studentCount}
                {sec.capacity ? `/${sec.capacity}` : ''} students)
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Roll number${star('rollNo')}`}>
          <input className="input" value={v.rollNo} onChange={set('rollNo')} />
        </Field>
        <Field label="Admission number" hint={mode === 'create' ? 'Leave empty to number automatically' : undefined}>
          <input className="input" value={v.admissionNo} onChange={set('admissionNo')} />
        </Field>
        <Field label="Admission date">
          <input className="input" type="date" value={v.admissionDate} onChange={set('admissionDate')} />
        </Field>
        <Field label="Admission type">
          <select className="input" value={v.admissionType} onChange={set('admissionType')}>
            <option value="NEW">New admission</option>
            <option value="TRANSFER">Transfer from another school</option>
            <option value="READMISSION">Re-admission</option>
          </select>
        </Field>
      </Section>

      <Card title="Student">
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="shrink-0">
            <PhotoPicker value={v.photoFileId} onChange={(id) => setV((x) => ({ ...x, photoFileId: id }))} label={`Photo${star('photo')}`} />
          </div>
          <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Full name *">
              <input className="input" required value={v.fullName} onChange={set('fullName')} />
            </Field>
            <Field label="Name in Urdu">
              <input className="input" dir="rtl" value={v.nameUrdu} onChange={set('nameUrdu')} />
            </Field>
            <Field label="Gender *">
              <select className="input" required value={v.gender} onChange={set('gender')}>
                <option value="">Choose</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            </Field>
            <Field label={`Date of birth${star('dob')}`}>
              <input className="input" type="date" value={v.dob} onChange={set('dob')} />
            </Field>
            <Field label="Place of birth">
              <input className="input" value={v.placeOfBirth} onChange={set('placeOfBirth')} />
            </Field>
            <Field label={`B-Form / CRC number${star('bForm')}`}>
              <input className="input" inputMode="numeric" placeholder="35202-1234567-1" value={v.bForm} onChange={set('bForm')} />
            </Field>
            <Field label={`Religion${star('religion')}`}>
              <input className="input" value={v.religion} onChange={set('religion')} />
            </Field>
            <Field label="Nationality">
              <input className="input" value={v.nationality} onChange={set('nationality')} />
            </Field>
            <Field label="Mother tongue">
              <input className="input" value={v.motherTongue} onChange={set('motherTongue')} />
            </Field>
            <Field label={`Blood group${star('bloodGroup')}`}>
              <select className="input" value={v.bloodGroup} onChange={set('bloodGroup')}>
                <option value="">—</option>
                {BLOOD.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
            <Field label="Student mobile (optional)">
              <input className="input" inputMode="tel" value={v.phone} onChange={set('phone')} />
            </Field>
            <Field label="Student email (optional)">
              <input className="input" type="email" value={v.email} onChange={set('email')} />
            </Field>
          </div>
        </div>
      </Card>

      <Section title="Address">
        <Wide>
          <Field label={`Current address${star('currentAddress')}`}>
            <input className="input" value={v.currentAddress} onChange={set('currentAddress')} />
          </Field>
        </Wide>
        <Wide>
          <Field label="Permanent address" hint="Leave empty if same as current">
            <input className="input" value={v.permanentAddress} onChange={set('permanentAddress')} />
          </Field>
        </Wide>
        <Field label={`City${star('city')}`}>
          <input className="input" value={v.city} onChange={set('city')} />
        </Field>
        <Field label="Area / sector">
          <input className="input" value={v.area} onChange={set('area')} />
        </Field>
      </Section>

      {mode === 'create' && (
        <>
          {sibling ? (
            <Card title="Family">
              <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm">
                <div className="font-medium text-brand-900">Linked to family {sibling.familyNo} as a brother/sister of:</div>
                <ul className="mt-1 text-brand-900">
                  {sibling.students.map((x) => (
                    <li key={x.id}>
                      {x.fullName} ({x.admissionNo}, {x.class.name}
                      {x.section ? ` ${x.section.name}` : ''})
                    </li>
                  ))}
                </ul>
                <div className="mt-1 text-brand-900">Parents: {sibling.guardians.map((g) => g.fullName).join(', ')}. The same parent login will show this child too.</div>
                <button type="button" className="mt-2 text-sm font-medium text-brand-700 underline" onClick={() => setSibling(null)}>
                  Not a sibling, enter parents separately
                </button>
              </div>
            </Card>
          ) : (
            <>
              {matches.length > 0 && (
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm">
                  <div className="font-medium text-brand-900">This father already has children in the school:</div>
                  {matches.map((m) => (
                    <div key={m.id} className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-brand-900">
                        Family {m.familyNo}: {m.students.map((x) => `${x.fullName} (${x.class.name})`).join(', ')}
                      </span>
                      <Button type="button" variant="secondary" onClick={() => setSibling(m)}>
                        Link as sibling
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Section title="Father" hint="Typing the father's CNIC or mobile checks for brothers and sisters already in the school.">
                <GuardianFields g={father} onChange={setFather} req={req} />
              </Section>
              <Section title="Mother">
                <GuardianFields g={mother} onChange={setMother} req={req} />
              </Section>
              <Card
                title="Guardian (if the student does not live with parents)"
                actions={
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={hasGuardian} onChange={(e) => setHasGuardian(e.target.checked)} /> Add guardian
                  </label>
                }
              >
                {hasGuardian ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <GuardianFields g={guardian} onChange={setGuardian} req={() => false} />
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Not needed when the student lives with a parent.</p>
                )}
              </Card>
            </>
          )}
        </>
      )}

      <Section title="Emergency contact" hint="Someone other than the parents.">
        <Field label={`Name${star('emergencyContact')}`}>
          <input className="input" value={v.emergencyContact.name} onChange={setNested('emergencyContact', 'name')} />
        </Field>
        <Field label="Relation">
          <input className="input" value={v.emergencyContact.relation} onChange={setNested('emergencyContact', 'relation')} />
        </Field>
        <Field label="Phone">
          <input className="input" inputMode="tel" value={v.emergencyContact.phone} onChange={setNested('emergencyContact', 'phone')} />
        </Field>
      </Section>

      <Section title={`Previous school${req('previousSchool') ? ' (required for transfers)' : ''}`}>
        <Field label="School name">
          <input className="input" value={v.previousSchool.schoolName} onChange={setNested('previousSchool', 'schoolName')} />
        </Field>
        <Field label="Last class passed">
          <input className="input" value={v.previousSchool.lastClass} onChange={setNested('previousSchool', 'lastClass')} />
        </Field>
        <Field label="Year">
          <input className="input" value={v.previousSchool.year} onChange={setNested('previousSchool', 'year')} />
        </Field>
        <Field label="Marks / grade">
          <input className="input" value={v.previousSchool.marks} onChange={setNested('previousSchool', 'marks')} />
        </Field>
        <Field label="Leaving certificate no.">
          <input className="input" value={v.previousSchool.slcNo} onChange={setNested('previousSchool', 'slcNo')} />
        </Field>
        <Field label="Reason for leaving">
          <input className="input" value={v.previousSchool.reasonForLeaving} onChange={setNested('previousSchool', 'reasonForLeaving')} />
        </Field>
      </Section>

      <Section title="Health">
        <Field label="Allergies">
          <input className="input" value={v.health.allergies} onChange={setNested('health', 'allergies')} />
        </Field>
        <Field label="Medical conditions" hint="Asthma, diabetes, epilepsy…">
          <input className="input" value={v.health.conditions} onChange={setNested('health', 'conditions')} />
        </Field>
        <Field label="Regular medicines">
          <input className="input" value={v.health.medicines} onChange={setNested('health', 'medicines')} />
        </Field>
        <Field label="Disability / special needs">
          <input className="input" value={v.health.specialNeeds} onChange={setNested('health', 'specialNeeds')} />
        </Field>
        <Field label="Family doctor">
          <input className="input" value={v.health.doctorName} onChange={setNested('health', 'doctorName')} />
        </Field>
        <Field label="Doctor's phone">
          <input className="input" inputMode="tel" value={v.health.doctorPhone} onChange={setNested('health', 'doctorPhone')} />
        </Field>
      </Section>

      <Section title="Fee details" hint="Used when fees are set up (step 5).">
        <Field label="Fee category">
          <input className="input" placeholder="e.g. Regular" value={v.feeCategory} onChange={set('feeCategory')} />
        </Field>
        <Field label="Discount / concession type">
          <select className="input" value={v.discountType} onChange={set('discountType')}>
            <option value="">None</option>
            {['Sibling', 'Staff child', 'Scholarship', 'Merit', 'Orphan', 'Other'].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Discount %">
          <input className="input" type="number" min={0} max={100} step="0.5" value={v.discountPercent} onChange={set('discountPercent')} />
        </Field>
        <Wide>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.transportRequired} onChange={(e) => setV((x) => ({ ...x, transportRequired: e.target.checked }))} />
            Needs school transport
          </label>
        </Wide>
        <Wide>
          <Field label="Notes">
            <textarea className="input min-h-20" value={v.notes} onChange={set('notes')} />
          </Field>
        </Wide>
      </Section>

      {mode === 'create' ? (
        <Card title="Logins">
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={logins.student} onChange={(e) => setLogins({ ...logins, student: e.target.checked })} /> Create a student login
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={logins.parent} onChange={(e) => setLogins({ ...logins, parent: e.target.checked })} /> Create a parent login (if the family does not have one yet)
            </label>
          </div>
        </Card>
      ) : (
        <Card title="Reason for change (saved in the audit log)">
          <input className="input" placeholder="Optional" value={reason} onChange={(e) => setReason(e.target.value)} />
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
