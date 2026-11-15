import Link from 'next/link';
import { Progress } from './ui';
import { bytes } from '@/lib/format';
import type { Usage } from '@/lib/types';

export function StorageAlert({ usage }: { usage: Usage }) {
  const s = usage.storage;
  if (s.level === 'ok') return null;
  const full = s.level === 'full';
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${full || s.level === 'critical' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      {full
        ? 'Storage is full. New uploads are blocked until you delete files or upgrade your plan. Everything else keeps working.'
        : `Storage is ${s.percent}% used. Delete old files or upgrade your plan before it fills up.`}{' '}
      <Link href="/school/usage" className="font-medium underline">
        Manage storage
      </Link>
    </div>
  );
}

export function UsageBars({ usage }: { usage: Usage }) {
  return (
    <div className="space-y-5">
      <Progress
        label="Storage"
        percent={usage.storage.percent}
        detail={`${bytes(usage.storage.usedBytes)} of ${bytes(usage.storage.limitBytes)} (${usage.storage.percent}%)`}
      />
      <Progress
        label="Students"
        percent={usage.students.percent}
        detail={usage.students.limit ? `${usage.students.used} of ${usage.students.limit}` : `${usage.students.used} · no limit`}
      />
      <Progress
        label="Staff & teachers"
        percent={usage.staff.percent}
        detail={usage.staff.limit ? `${usage.staff.used} of ${usage.staff.limit}` : `${usage.staff.used} · no limit`}
      />
    </div>
  );
}
