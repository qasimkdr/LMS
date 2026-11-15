'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { StudentForm } from '@/components/StudentForm';
import { Credentials, type Login } from '@/components/Credentials';
import { Button, Card, PageHeader } from '@/components/ui';

interface Created {
  studentId: string;
  admissionNo: string;
  familyNo: string;
  logins: Login[];
}

export default function NewStudentPage() {
  const { me } = useAuth();
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

  return (
    <>
      <PageHeader title="New admission" subtitle="Fields marked * are required. The principal chooses which fields are required in Classes & subjects → Admission form." />
      <StudentForm
        key={formKey}
        mode="create"
        submitLabel="Save admission"
        onSubmit={async (p) => {
          const r = await api.post<Created>('/students', p);
          setCreated({ ...r, name: p.student.fullName });
          window.scrollTo(0, 0);
        }}
      />
    </>
  );
}
