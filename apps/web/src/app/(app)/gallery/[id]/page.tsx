'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { AlbumForm } from '@/components/AlbumForm';
import { Button, Empty, ErrorBox, Loading } from '@/components/ui';
import { date } from '@/lib/format';

interface Photo {
  id: string;
  fileId: string;
  thumbFileId: string;
  caption: string | null;
  width: number | null;
  height: number | null;
}
interface Data {
  album: { id: string; title: string; description: string | null; eventDate: string | null; visibility: string; classIds: string[] | null; coverFileId: string | null };
  photos: Photo[];
  canManage: boolean;
}

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useData<Data>(`/gallery/albums/${id}`);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: File[]) {
    // Send in small batches so a phone on a slow connection shows progress.
    let added = 0;
    const failed: string[] = [];
    for (let i = 0; i < files.length; i += 5) {
      setProgress(`Uploading ${Math.min(i + 5, files.length)} of ${files.length}…`);
      const fd = new FormData();
      files.slice(i, i + 5).forEach((f) => fd.append('files', f));
      try {
        const r = await api.post<{ added: number; failed: string[] }>(`/gallery/albums/${id}/photos`, fd);
        added += r.added;
        failed.push(...r.failed);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Upload failed', 'error');
        break;
      }
    }
    setProgress(null);
    toast(`${added} photo(s) added${failed.length ? ` · ${failed.length} could not be read` : ''}`);
    reload();
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const { album, photos } = data;

  return (
    <>
      <div className="reveal mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/gallery" className="text-sm text-brand-700 hover:underline">
            ← Gallery
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{album.title}</h1>
          <p className="text-sm text-gray-500">
            {photos.length} photo{photos.length === 1 ? '' : 's'}
            {album.eventDate && ` · ${date(album.eventDate)}`}
            {album.description && ` · ${album.description}`}
          </p>
        </div>
        {data.canManage && (
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) upload(f); }} />
            <Button onClick={() => input.current?.click()} loading={Boolean(progress)}>
              {progress ?? '+ Add photos'}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              className="text-red-600"
              onClick={async () => {
                if (!confirm('Delete this album and all its photos?')) return;
                await api.del(`/gallery/albums/${id}`);
                router.replace('/gallery');
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </div>
      {!photos.length ? (
        <Empty title="No photos yet">{data.canManage ? 'Photos are resized and compressed automatically to save storage.' : null}</Empty>
      ) : (
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
          {photos.map((p, i) => (
            <button key={p.id} onClick={() => setOpen(i)} className="reveal group relative mb-3 block w-full overflow-hidden rounded-2xl bg-gray-100 shadow-sm ring-1 ring-gray-900/5 [break-inside:avoid]" style={{ ['--i' as string]: Math.min(i, 12), aspectRatio: p.width && p.height ? `${p.width}/${p.height}` : '4/3' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(p.thumbFileId)} alt={p.caption ?? ''} loading="lazy" className="h-full w-full object-cover transition duration-700 ease-[var(--ease-out-soft)] group-hover:scale-110" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
              {p.caption && <span className="absolute inset-x-0 bottom-0 translate-y-2 p-2 text-left text-xs text-white opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">{p.caption}</span>}
              {album.coverFileId === p.fileId && <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-gray-800 shadow">Cover</span>}
            </button>
          ))}
        </div>
      )}
      {open !== null && <Lightbox photos={photos} index={open} onIndex={setOpen} canManage={data.canManage} coverFileId={album.coverFileId} albumId={id} onChange={reload} />}
      {editing && <AlbumForm value={{ ...album }} onClose={() => setEditing(false)} onSaved={() => reload()} />}
    </>
  );
}

function Lightbox({ photos, index, onIndex, canManage, coverFileId, albumId, onChange }: { photos: Photo[]; index: number; onIndex: (i: number | null) => void; canManage: boolean; coverFileId: string | null; albumId: string; onChange: () => void }) {
  const toast = useToast();
  const p = photos[index];
  const touch = useRef<number | null>(null);
  const go = useCallback((d: number) => onIndex((index + d + photos.length) % photos.length), [index, photos.length, onIndex]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onIndex(null);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onIndex]);
  if (!p) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-gray-950/95 backdrop-blur"
      onClick={() => onIndex(null)}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touch.current = null;
      }}
      role="dialog"
      aria-label="Photo viewer"
    >
      <div className="flex items-center justify-between p-3 text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
        <span>
          {index + 1} / {photos.length}
        </span>
        <div className="flex items-center gap-2">
          <a href={fileUrl(p.fileId)} download className="rounded-lg px-3 py-1.5 transition hover:bg-white/10">
            Download
          </a>
          {canManage && (
            <>
              {coverFileId !== p.fileId && (
                <button className="rounded-lg px-3 py-1.5 transition hover:bg-white/10" onClick={async () => { await api.patch(`/gallery/albums/${albumId}`, { coverFileId: p.fileId }); toast('Album cover set'); onChange(); }}>
                  Set as cover
                </button>
              )}
              <button className="rounded-lg px-3 py-1.5 transition hover:bg-white/10" onClick={async () => { const caption = prompt('Caption', p.caption ?? ''); if (caption === null) return; await api.patch(`/gallery/photos/${p.id}`, { caption }); onChange(); }}>
                Caption
              </button>
              <button
                className="rounded-lg px-3 py-1.5 text-rose-300 transition hover:bg-white/10"
                onClick={async () => {
                  if (!confirm('Delete this photo?')) return;
                  await api.del(`/gallery/photos/${p.id}`);
                  onIndex(photos.length > 1 ? Math.min(index, photos.length - 2) : null);
                  onChange();
                }}
              >
                Delete
              </button>
            </>
          )}
          <button className="rounded-lg px-3 py-1.5 text-lg transition hover:rotate-90 hover:bg-white/10" onClick={() => onIndex(null)} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={p.id} src={fileUrl(p.fileId)} alt={p.caption ?? ''} className="max-h-full max-w-full animate-scale-in rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        {photos.length > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); go(-1); }} className="absolute left-2 hidden h-12 w-12 items-center justify-center rounded-full bg-white/10 text-2xl text-white transition hover:scale-110 hover:bg-white/20 sm:flex" aria-label="Previous photo">
              ‹
            </button>
            <button onClick={(e) => { e.stopPropagation(); go(1); }} className="absolute right-2 hidden h-12 w-12 items-center justify-center rounded-full bg-white/10 text-2xl text-white transition hover:scale-110 hover:bg-white/20 sm:flex" aria-label="Next photo">
              ›
            </button>
          </>
        )}
      </div>
      {p.caption && <div className="p-4 text-center text-sm text-white/85">{p.caption}</div>}
      <div className="flex gap-2 overflow-x-auto p-3" onClick={(e) => e.stopPropagation()}>
        {photos.map((x, i) => (
          <button key={x.id} onClick={() => onIndex(i)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg transition duration-300 ${i === index ? 'scale-105 ring-2 ring-white' : 'opacity-50 hover:opacity-100'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(x.thumbFileId)} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
