'use client';

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-md shadow-brand-600/25 ring-1 ring-inset ring-white/15 hover:from-brand-500 hover:to-brand-700 hover:shadow-lg hover:shadow-brand-600/30',
  secondary: 'bg-white text-gray-800 border border-gray-200 shadow-sm hover:border-gray-300 hover:bg-gray-50 hover:shadow',
  danger: 'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-md shadow-red-600/25 hover:to-red-700',
  ghost: 'text-gray-700 hover:bg-gray-900/[0.05]',
};

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-px active:translate-y-0 active:scale-[0.97] active:duration-75 disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/25',
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('reveal min-w-0 rounded-2xl border border-gray-200/70 bg-white shadow-sm shadow-gray-900/[0.03] transition-shadow duration-300 hover:shadow-md hover:shadow-gray-900/[0.05]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="reveal mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const badgeTones = {
  gray: 'bg-gray-100 text-gray-700',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  blue: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
};
export type Tone = keyof typeof badgeTones;

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent', badgeTones[tone])}>{children}</span>;
}

export const statusTone: Record<string, Tone> = { TRIAL: 'blue', ACTIVE: 'green', READ_ONLY: 'amber', SUSPENDED: 'red', PAID: 'green', UNPAID: 'amber', VOID: 'gray' };

export function Progress({ percent, label, detail }: { percent: number | null; label?: ReactNode; detail?: ReactNode }) {
  const p = Math.min(100, Math.max(0, percent ?? 0));
  const color = p >= 95 ? 'bg-red-500' : p >= 80 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div>
      {(label || detail) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-gray-800">{label}</span>
          <span className="text-gray-500 tabular-nums">{detail}</span>
        </div>
      )}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx('h-full origin-left animate-grow-x rounded-full transition-all duration-700', color)} style={{ width: `${percent === null ? 0 : Math.max(p, 1)}%` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className="reveal lift rounded-2xl border border-gray-200/70 bg-white p-4 shadow-sm shadow-gray-900/[0.03]">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-gray-900">{value}</div>
      {hint && <div className={cx('mt-1 text-xs', tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-600' : 'text-gray-500')}>{hint}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="reveal rounded-2xl border border-dashed border-gray-300 bg-white/60 px-4 py-12 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-violet-50 text-xl text-brand-500 ring-1 ring-brand-100">✦</div>
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {children && <div className="mt-1 text-sm text-gray-500">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>;
}

export function Loading() {
  return (
    <div className="animate-fade-in space-y-4 py-2" aria-busy aria-label="Loading">
      <div className="skeleton h-8 w-56 rounded-xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24 rounded-2xl" />
        ))}
      </div>
      <div className="skeleton h-56 rounded-2xl" />
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-gray-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className={cx('max-h-[92vh] w-full animate-scale-in overflow-y-auto rounded-t-3xl bg-white shadow-2xl shadow-gray-950/20 ring-1 ring-gray-900/5 sm:rounded-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 transition hover:rotate-90 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-5 py-2.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-brand-50/40">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('whitespace-nowrap px-5 py-3 align-middle', className)}>{children}</td>
);

/** Shows a one-time password with a copy button. */
export function SecretBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="text-xs font-medium text-amber-900">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <code className="text-base font-semibold tracking-wide text-gray-900">{value}</code>
        <Button variant="secondary" type="button" onClick={() => navigator.clipboard?.writeText(value)}>
          Copy
        </Button>
      </div>
      <p className="mt-2 text-xs text-amber-900">Shown only once. They must change it when they first log in.</p>
    </div>
  );
}
