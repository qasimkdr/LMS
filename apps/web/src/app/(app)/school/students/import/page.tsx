'use client';

import { useAuth } from '@/components/auth';
import { ImportWizard } from '@/components/ImportWizard';
import { PageHeader } from '@/components/ui';

export default function ImportStudentsPage() {
  const { me } = useAuth();
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Import students" subtitle="Add many students at once from Excel. Classes and sections must exist first." />
      </div>
      <ImportWizard kind="students" schoolName={me?.school?.name} />
    </>
  );
}
