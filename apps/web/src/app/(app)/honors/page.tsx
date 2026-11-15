'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Avatar } from '@/components/Avatar';
import { Button, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import type { HonorItem } from '@/components/progress/StudentProgress';

interface Board {
  periods: { period: string; label: string; honors: HonorItem[] }[];
}

export default function HonorBoardPage() {
  const { me } = useAuth();
  const { data, error, loading } = useData<Board>('/honors/board');
  const manager = me?.user.role === 'PRINCIPAL' || me?.user.permissions.includes('honors.manage');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <PageHeader
        title="Honor board"
        subtitle={`Students of ${me?.school?.name ?? 'our school'} who made us proud`}
        actions={
          manager && (
            <Link href="/school/honors">
              <Button variant="secondary">Give honors</Button>
            </Link>
          )
        }
      />
      {!data?.periods.length ? (
        <Empty title="No honors yet">When the principal awards Student of the Month and other honors, they appear here.</Empty>
      ) : (
        <div className="space-y-10">
          {data.periods.map((p) => (
            <section key={p.period}>
              <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold">
                <span>{p.label}</span>
                <span className="h-px flex-1 bg-gray-200" />
              </h2>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {p.honors.map((h) => (
                  <li key={h.id} className="relative flex flex-col items-center rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white px-3 pb-4 pt-5 text-center shadow-sm">
                    <span className="absolute right-3 top-2 text-2xl" aria-hidden>
                      {h.type.icon}
                    </span>
                    <Avatar fileId={h.student.photoFileId} name={h.student.fullName} size={72} />
                    <div className="mt-3 text-sm font-semibold leading-tight">{h.student.fullName}</div>
                    <div className="text-xs text-gray-500">{h.student.classLabel}</div>
                    <div className="mt-2 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">{h.type.name}</div>
                    {h.citation && <p className="mt-2 text-xs text-gray-600">“{h.citation}”</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
