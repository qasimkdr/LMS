'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties } from 'react';
import { fileUrl } from '@/lib/api';
import { useData } from '@/components/useData';
import { Tilt } from '@/components/fx';
import { Badge, Button, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { AlbumForm, VIS } from '@/components/AlbumForm';
import { date } from '@/lib/format';

interface Album {
  id: string;
  title: string;
  description: string | null;
  eventDate: string | null;
  visibility: string;
  photos: number;
  cover: string | null;
  previews: string[];
}

export default function GalleryPage() {
  const router = useRouter();
  const { data, error, loading } = useData<{ albums: Album[]; canManage: boolean }>('/gallery/albums');
  const [creating, setCreating] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <>
      <PageHeader title="Gallery" subtitle="Photos from events, sports day, functions and trips." actions={data.canManage && <Button onClick={() => setCreating(true)}>+ New album</Button>} />
      {!data.albums.length ? (
        <Empty title="No albums yet">{data.canManage ? 'Create an album and upload photos from your phone or computer.' : 'Photos from school events will appear here.'}</Empty>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.albums.map((a, i) => (
            <li key={a.id}>
              <Tilt max={6} className="rounded-3xl" style={{ '--i': i } as CSSProperties}>
                <Link href={`/gallery/${a.id}`} className="group block overflow-hidden rounded-3xl border border-gray-200/70 bg-white shadow-sm transition-shadow duration-500 hover:shadow-2xl hover:shadow-brand-900/10">
                  <div className="relative aspect-[4/3] overflow-hidden bg-brand-100">
                    {a.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(a.cover)} alt="" className="h-full w-full object-cover transition duration-700 ease-[var(--ease-out-soft)] group-hover:scale-110" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-5xl text-brand-300">▣</div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    {a.previews.length > 1 && (
                      <div className="absolute right-3 top-3 flex -space-x-3 opacity-0 transition duration-500 group-hover:opacity-100">
                        {a.previews.slice(1, 4).map((p, j) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={p} src={fileUrl(p)} alt="" className="h-10 w-10 rounded-xl border-2 border-white object-cover shadow-lg transition-transform duration-500 group-hover:translate-y-0" style={{ transform: `translateY(${8 + j * 4}px) rotate(${(j - 1) * 6}deg)` }} />
                        ))}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                      <div className="text-lg font-semibold tracking-tight drop-shadow">{a.title}</div>
                      <div className="text-xs text-white/80">
                        {a.photos} photo{a.photos === 1 ? '' : 's'}
                        {a.eventDate && ` · ${date(a.eventDate)}`}
                      </div>
                    </div>
                  </div>
                  {(a.description || data.canManage) && (
                    <div className="flex items-center justify-between gap-2 px-4 py-3">
                      <span className="line-clamp-1 text-sm text-gray-600">{a.description}</span>
                      {data.canManage && <Badge tone={a.visibility === 'SCHOOL' ? 'green' : a.visibility === 'STAFF' ? 'gray' : 'blue'}>{VIS[a.visibility]}</Badge>}
                    </div>
                  )}
                </Link>
              </Tilt>
            </li>
          ))}
        </ul>
      )}
      {creating && <AlbumForm onClose={() => setCreating(false)} onSaved={(id) => router.push(`/gallery/${id}`)} />}
    </>
  );
}
