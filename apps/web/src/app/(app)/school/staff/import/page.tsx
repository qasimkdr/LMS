'use client';

import { useAuth } from '@/components/auth';
import { ImportWizard } from '@/components/ImportWizard';
import { PageHeader } from '@/components/ui';

export default function ImportStaffPage() {
  const { me } = useAuth();
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Import staff" subtitle="Add teachers and office staff from Excel. Give office staff their permissions afterwards on each profile." />
      </div>
      <ImportWizard kind="staff" schoolName={me?.school?.name} />
    </>
  );
}
