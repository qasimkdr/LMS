'use client';

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { api, fileUrl } from '@/lib/api';
import { Button, Modal } from './ui';
import { useToast } from './toast';

const VIEW = 260; // crop viewport (px)
const OUT = 480; // saved photo size (px)

/**
 * Profile photo: upload from device or take with the camera, then crop (drag + zoom) and rotate.
 * Saves a square JPEG as a PROFILE_PHOTO file and returns its id.
 */
export function PhotoPicker({ value, onChange, label = 'Photo', size = 112 }: { value: string | null; onChange: (fileId: string | null) => void; label?: string; size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
        style={{ width: size, height: size }}
        aria-label={value ? 'Change photo' : 'Add photo'}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(value)} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center text-xs text-gray-400">
            <span className="text-2xl">＋</span>
            {label}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-black/50 py-1 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">
          {value ? 'Change' : 'Add'}
        </span>
      </button>
      {value && (
        <button type="button" className="text-xs text-gray-500 hover:text-red-600" onClick={() => onChange(null)}>
          Remove
        </button>
      )}
      {open && (
        <PhotoModal
          onClose={() => setOpen(false)}
          onSaved={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PhotoModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [src, setSrc] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <Modal open onClose={onClose} title="Profile photo">
      {!src && !camera && (
        <div className="space-y-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setSrc(URL.createObjectURL(f));
            }}
          />
          <Button type="button" className="w-full" onClick={() => fileInput.current?.click()}>
            Upload from device
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              if (typeof navigator.mediaDevices?.getUserMedia === 'function') setCamera(true);
              else {
                // Phones without camera API: the file picker offers the camera.
                fileInput.current?.setAttribute('capture', 'user');
                fileInput.current?.click();
              }
            }}
          >
            Take photo with camera
          </Button>
        </div>
      )}
      {camera && !src && (
        <CameraCapture
          onCancel={() => setCamera(false)}
          onCapture={(url) => {
            setSrc(url);
            setCamera(false);
          }}
          onError={(msg) => {
            toast(msg, 'error');
            setCamera(false);
          }}
        />
      )}
      {src && <Cropper src={src} onBack={() => setSrc(null)} onSaved={onSaved} />}
    </Modal>
  );
}

function CameraCapture({ onCapture, onCancel, onError }: { onCapture: (url: string) => void; onCancel: () => void; onError: (m: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => onError('Could not open the camera. Allow camera access or upload a photo instead.'));
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onError]);

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onCapture(URL.createObjectURL(b)), 'image/jpeg', 0.92);
  }

  return (
    <div className="space-y-3">
      <video ref={video} autoPlay playsInline muted className="aspect-[4/3] w-full rounded-lg bg-black object-cover" />
      <div className="flex gap-2">
        <Button type="button" className="flex-1" onClick={capture}>
          Capture
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  );
}

function Cropper({ src, onBack, onSaved }: { src: string; onBack: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => {
      setImg(i);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    i.src = src;
  }, [src]);

  if (!img) return <div className="py-10 text-center text-sm text-gray-500">Loading…</div>;
  const base = VIEW / Math.min(img.width, img.height);
  const scale = base * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  const clamp = (o: { x: number; y: number }) => ({
    x: Math.min((w - VIEW) / 2, Math.max(-(w - VIEW) / 2, o.x)),
    y: Math.min((h - VIEW) / 2, Math.max(-(h - VIEW) / 2, o.y)),
  });
  const pos = clamp(offset);
  const left = (VIEW - w) / 2 + pos.x;
  const top = (VIEW - h) / 2 + pos.y;

  function onDown(e: RPointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
  }
  function onMove(e: RPointerEvent) {
    if (!drag.current) return;
    setOffset(clamp({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }));
  }

  function rotate() {
    const c = document.createElement('canvas');
    c.width = img!.height;
    c.height = img!.width;
    const ctx = c.getContext('2d')!;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img!, -img!.width / 2, -img!.height / 2);
    const i = new Image();
    i.onload = () => {
      setImg(i);
      setOffset({ x: 0, y: 0 });
    };
    i.src = c.toDataURL('image/jpeg', 0.95);
  }

  async function save() {
    setSaving(true);
    try {
      const c = document.createElement('canvas');
      c.width = OUT;
      c.height = OUT;
      const sw = VIEW / scale;
      c.getContext('2d')!.drawImage(img!, -left / scale, -top / scale, sw, sw, 0, 0, OUT, OUT);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.88));
      const form = new FormData();
      form.append('category', 'PROFILE_PHOTO');
      form.append('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
      const r = await api.post<{ file: { id: string } }>('/files', form);
      onSaved(r.file.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'error');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-xl bg-gray-900 active:cursor-grabbing"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ left, top, width: w, height: h }} />
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-white/70" />
      </div>
      <label className="flex items-center gap-3 text-sm text-gray-600">
        Zoom
        <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" />
      </label>
      <p className="text-center text-xs text-gray-500">Drag the photo to position the face in the square.</p>
      <div className="flex gap-2">
        <Button type="button" className="flex-1" onClick={save} loading={saving}>
          Save photo
        </Button>
        <Button type="button" variant="secondary" onClick={rotate}>
          Rotate
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
