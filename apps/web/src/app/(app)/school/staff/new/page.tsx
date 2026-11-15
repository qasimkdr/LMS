'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { StaffForm } from '@/components/StaffForm';
import { Credentials } from '@/components/Credentials';
import { Button, PageHeader } from '@/components/ui';

export default function NewStaffPage() {
  const { me } = useAuth();
  const [created, setCreated] = useState<{ userId: string; username: string; tempPassword: string; fullName: string; role: string } | null>(null);
  const [key, setKey] = useState(0);
  if (created) {
    return (
      <>
        <PageHeader title="Account created" subtitle={created.fullName} />
        <Credentials logins={[{ role: created.role, username: created.username, tempPassword: created.tempPassword, fullName: created.fullName }]} schoolName={me?.school?.name} />
        <div className="mt-6 flex gap-2 print:hidden">
          <Link href={`/school/staff/${created.userId}`}>
            <Button>Open profile</Button>
          </Link>
          <Button variant="secondary" onClick={() => { setCreated(null); setKey((k) => k + 1); }}>
            Add another
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Add staff member" subtitle="Teachers get a teacher login. Office staff only see what you allow below." />
      <StaffForm
        key={key}
        mode="create"
        submitLabel="Create account"
        onSubmit={async (body) => {
          const r = await api.post<{ userId: string; username: string; tempPassword: string }>('/staff', body);
          const b = body as { fullName: string; role?: string };
          setCreated({ ...r, fullName: b.fullName, role: b.role ?? 'TEACHER' });
          window.scrollTo(0, 0);
        }}
      />
    </>
  );
}
