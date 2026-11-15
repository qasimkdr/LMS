'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { Avatar } from './Avatar';
import { className } from '@/lib/types';
import { roleLabel, studentStatusLabel } from '@/lib/format';

interface Results {
  students: { id: string; fullName: string; admissionNo: string; status: string; photoFileId: string | null; class: { name: string; stream: string | null }; section: { name: string } | null; family: { guardians: { fullName: string }[] } }[];
  staff: { id: string; fullName: string; role: string; photoFileId: string | null; isActive: boolean; staffProfile: { designation: string | null; employeeNo: string } | null }[];
}

/** Type a name, admission no, roll no, CNIC or phone to jump to a student or staff member. */
export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    const t = setTimeout(() => {
      api.get<Results>(`/search?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes(null));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setOpen(false);
    setQ('');
  }, [pathname]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const empty = res && res.students.length === 0 && res.staff.length === 0;
  return (
    <div ref={box} className="relative w-full max-w-md">
      <input
        className="input pl-9"
        placeholder="Search students, parents, staff…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Search"
      />
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400" aria-hidden>
        ⌕
      </span>
      {open && res && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
          {empty && <div className="px-3 py-4 text-center text-sm text-gray-500">No matches</div>}
          {res.students.length > 0 && <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase text-gray-400">Students</div>}
          {res.students.map((s) => (
            <Link key={s.id} href={`/school/students/${s.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-50">
              <Avatar fileId={s.photoFileId} name={s.fullName} size={32} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {s.fullName}
                  {s.status !== 'ACTIVE' && <span className="ml-1 text-xs text-gray-400">({studentStatusLabel[s.status]})</span>}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {s.admissionNo} · {className(s.class, s.section)}
                  {s.family.guardians[0] && ` · s/o ${s.family.guardians[0].fullName}`}
                </span>
              </span>
            </Link>
          ))}
          {res.staff.length > 0 && <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase text-gray-400">Staff</div>}
          {res.staff.map((s) => (
            <Link key={s.id} href={`/school/staff/${s.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-50">
              <Avatar fileId={s.photoFileId} name={s.fullName} size={32} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{s.fullName}</span>
                <span className="block truncate text-xs text-gray-500">
                  {s.staffProfile?.designation ?? roleLabel[s.role]} · {s.staffProfile?.employeeNo}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
