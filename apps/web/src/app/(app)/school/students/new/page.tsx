'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useData } from '@/components/useData';
import { toValues } from '@/components/StudentForm';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { StudentForm } from '@/components/StudentForm';
import { Credentials, type Login } from '@/components/Credentials';
import { Button, Card, Loading, PageHeader } from '@/components/ui';

interface Created {
  studentId: string;
  admissionNo: string;
  familyNo: string;
  logins: Login[];
}

interface Enquiry {
  id: string;
  enquiryNo: number;
  childName: string;
  gender: string | null;
  dob: string | null;
  classId: string | null;
  parentName: string;
  relation: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  previousSchool: string | null;
}

export default function NewStudentPageWrapper() {
  return (
    <Suspense fallback={<Loading />}>
      <NewStudentPage />
    </Suspense>
  );
}

function NewStudentPage() {
  const { me } = useAuth();
  const enquiryId = useSearchParams().get('enquiry');
  const { data: enq } = useData<{ enquiry: Enquiry }>(enquiryId ? `/admissions/enquiries/${enquiryId}` : null);
  const [created, setCreated] = useState<(Created & { name: string }) | null>(null);
  const [formKey, setFormKey] = useState(0);

  if (created) {
    return (
      <>
        <PageHeader title="Admission complete" subtitle={`${created.name} · Admission no ${created.admissionNo} · Family ${created.familyNo}`} />
        <div className="space-y-6">
          <Credentials logins={created.logins.map((l) => ({ ...l, forName: l.role === 'PARENT' ? `parent of ${created.name}` : undefined }))} schoolName={me?.school?.name} />
          <Card title="Next" className="print:hidden">
            <div className="flex flex-wrap gap-2">
              <Link href={`/school/students/${created.studentId}?tab=documents`}>
                <Button>Upload documents</Button>
              </Link>
              <Link href={`/school/students/${created.studentId}/print`}>
                <Button variant="secondary">Print admission form</Button>
              </Link>
              <Button
                variant="secondary"
                onClick={() => {
                  setCreated(null);
                  setFormKey((k) => k + 1);
                  window.scrollTo(0, 0);
                }}
              >
                Admit another student
              </Button>
            </div>
          </Card>
        </div>
      </>
    );
  }

  if (enquiryId && !enq) return <Loading />;
  const e = enq?.enquiry;
  const relation = e?.relation === 'MOTHER' ? 'MOTHER' : e?.relation === 'GUARDIAN' ? 'GUARDIAN' : 'FATHER';
  const initial = e
    ? { ...toValues(), fullName: e.childName, gender: e.gender ?? '', dob: e.dob ?? '', classId: e.classId ?? '', currentAddress: e.address ?? '', previousSchool: { ...toValues().previousSchool, schoolName: e.previousSchool ?? '' } }
    : undefined;

  return (
    <>
      {e && <div className="reveal mb-4 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-100">Admitting from enquiry #{e.enquiryNo}. The details from the enquiry are filled in below; complete the rest.</div>}
      <PageHeader title="New admission" subtitle="Fields marked * are required. The principal chooses which fields are required in Classes & subjects → Admission form." />
      <StudentForm
        key={`${formKey}-${e?.id ?? ''}`}
        mode="create"
        initial={initial}
        initialGuardian={e ? { relation, fullName: e.parentName, phone: e.phone, whatsapp: e.phone, email: e.email ?? '' } : undefined}
        submitLabel="Save admission"
        onSubmit={async (p) => {
          const r = await api.post<Created>('/students', { ...p, enquiryId: e?.id ?? null });
          setCreated({ ...r, name: p.student.fullName });
          window.scrollTo(0, 0);
        }}
      />
    </>
  );
}
