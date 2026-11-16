'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info' | 'warning';
type Toast = { id: number; message: string; tone: Tone; leaving: boolean };
const Ctx = createContext<(message: string, tone?: Tone) => void>(() => undefined);

const SHOW_MS = 2600;
const FADE_MS = 300;
const MAX = 4;

const STYLE: Record<Tone, { box: string; icon: string; bar: string; glyph: string }> = {
  success: { box: 'border-emerald-200 bg-emerald-50/95 text-emerald-900', icon: 'bg-emerald-500', bar: 'bg-emerald-500', glyph: '✓' },
  error: { box: 'border-rose-200 bg-rose-50/95 text-rose-900', icon: 'bg-rose-500', bar: 'bg-rose-500', glyph: '!' },
  info: { box: 'border-sky-200 bg-sky-50/95 text-sky-900', icon: 'bg-sky-500', bar: 'bg-sky-500', glyph: 'i' },
  warning: { box: 'border-amber-200 bg-amber-50/95 text-amber-900', icon: 'bg-amber-500', bar: 'bg-amber-500', glyph: '!' },
};

/**
 * Small notifications in the top-right corner (top-centre on phones).
 * Each one slides in, stays ~2.5 seconds, then fades out on its own. Hovering pauses it; clicking closes it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), FADE_MS);
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const schedule = useCallback((id: number, ms = SHOW_MS) => timers.current.set(id, setTimeout(() => dismiss(id), ms)), [dismiss]);

  const push = useCallback(
    (message: string, tone: Tone = 'success') => {
      const id = Date.now() + Math.random();
      setToasts((t) => {
        const next = [...t, { id, message, tone, leaving: false }];
        // Keep the corner tidy: the oldest go first.
        next.slice(0, Math.max(0, next.filter((x) => !x.leaving).length - MAX)).forEach((x) => setTimeout(() => dismiss(x.id), 0));
        return next;
      });
      schedule(id, tone === 'error' ? SHOW_MS + 1400 : SHOW_MS);
    },
    [dismiss, schedule],
  );

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end" aria-live="polite">
        {toasts.map((t) => {
          const s = STYLE[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              onMouseEnter={() => {
                const tm = timers.current.get(t.id);
                if (tm) clearTimeout(tm);
              }}
              onMouseLeave={() => !t.leaving && schedule(t.id, 1200)}
              onClick={() => dismiss(t.id)}
              className={`toast pointer-events-auto relative flex w-full max-w-sm cursor-pointer items-start gap-3 overflow-hidden rounded-xl border px-3.5 py-3 text-sm font-medium shadow-lg shadow-slate-900/10 backdrop-blur ${s.box} ${t.leaving ? 'toast-out' : 'toast-in'}`}
            >
              <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${s.icon}`} aria-hidden>
                {s.glyph}
              </span>
              <span className="min-w-0 flex-1 leading-snug">{t.message}</span>
              <span aria-hidden className={`toast-timer absolute bottom-0 left-0 h-0.5 w-full origin-left opacity-40 ${s.bar}`} style={{ animationDuration: `${t.tone === 'error' ? SHOW_MS + 1400 : SHOW_MS}ms` }} />
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
