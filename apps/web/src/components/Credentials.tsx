'use client';

import { Button } from './ui';
import { roleLabel } from '@/lib/format';

export interface Login {
  role: string;
  username: string;
  tempPassword: string;
  fullName: string;
  forName?: string;
}

/** One-time login details with a print button (slips to hand to parents and students). */
export function Credentials({ logins, schoolName }: { logins: Login[]; schoolName?: string }) {
  if (!logins.length) return null;
  const loginUrl = typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login';
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <div className="text-sm font-semibold text-amber-900">Login details (shown only once)</div>
          <div className="text-xs text-amber-900">Print or copy now. Everyone must set their own password at first login.</div>
        </div>
        <Button type="button" variant="secondary" onClick={() => window.print()}>
          Print slips
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 print:mt-0 print:grid-cols-2 print:gap-4">
        {logins.map((l) => (
          <div key={l.username} className="break-inside-avoid rounded-lg border border-dashed border-amber-300 bg-white p-3 text-sm print:border-gray-400">
            {schoolName && <div className="text-xs font-semibold text-gray-500">{schoolName}</div>}
            <div className="font-medium">
              {roleLabel[l.role] ?? l.role} login · {l.fullName}
            </div>
            {l.forName && <div className="text-xs text-gray-500">for {l.forName}</div>}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-gray-500">Website</dt>
              <dd className="break-all">{loginUrl}</dd>
              <dt className="text-gray-500">Username</dt>
              <dd className="font-mono font-semibold">{l.username}</dd>
              <dt className="text-gray-500">Password</dt>
              <dd className="font-mono font-semibold">{l.tempPassword}</dd>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
