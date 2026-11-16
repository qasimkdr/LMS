'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Colour roles. Each dashboard number has its own hue so the page scans quickly,
 * kept to mid-saturation Tailwind colours so it stays professional.
 */
const tones = {
  blue: { hex: '#2563eb', soft: 'bg-blue-50 text-blue-600 ring-blue-100', value: 'text-blue-700', bar: 'bg-blue-500', top: 'before:bg-blue-500', light: 'bg-blue-100', hoverBar: 'group-hover:bg-blue-400' },
  emerald: { hex: '#059669', soft: 'bg-emerald-50 text-emerald-600 ring-emerald-100', value: 'text-emerald-700', bar: 'bg-emerald-500', top: 'before:bg-emerald-500', light: 'bg-emerald-100', hoverBar: 'group-hover:bg-emerald-400' },
  amber: { hex: '#d97706', soft: 'bg-amber-50 text-amber-600 ring-amber-100', value: 'text-amber-700', bar: 'bg-amber-500', top: 'before:bg-amber-500', light: 'bg-amber-100', hoverBar: 'group-hover:bg-amber-400' },
  rose: { hex: '#e11d48', soft: 'bg-rose-50 text-rose-600 ring-rose-100', value: 'text-rose-700', bar: 'bg-rose-500', top: 'before:bg-rose-500', light: 'bg-rose-100', hoverBar: 'group-hover:bg-rose-400' },
  teal: { hex: '#0d9488', soft: 'bg-teal-50 text-teal-600 ring-teal-100', value: 'text-teal-700', bar: 'bg-teal-500', top: 'before:bg-teal-500', light: 'bg-teal-100', hoverBar: 'group-hover:bg-teal-400' },
  sky: { hex: '#0284c7', soft: 'bg-sky-50 text-sky-600 ring-sky-100', value: 'text-sky-700', bar: 'bg-sky-500', top: 'before:bg-sky-500', light: 'bg-sky-100', hoverBar: 'group-hover:bg-sky-400' },
  slate: { hex: '#475569', soft: 'bg-slate-100 text-slate-600 ring-slate-200', value: 'text-slate-800', bar: 'bg-slate-500', top: 'before:bg-slate-400', light: 'bg-slate-100', hoverBar: 'group-hover:bg-slate-400' },
};
export type FxTone = keyof typeof tones;
export const toneHex = (t: FxTone) => tones[t].hex;
/** Categorical order for charts with several series / categories. */
const CATEGORICAL: FxTone[] = ['blue', 'emerald', 'amber', 'rose', 'sky', 'teal', 'slate'];

/**
 * Gentle 3D tilt toward the pointer with a soft highlight.
 * Mouse only (no effect on touch) and off when the user prefers less motion.
 */
export function Tilt({ children, className, max = 5, glare = true, style }: { children: ReactNode; className?: string; max?: number; glare?: boolean; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, gx: 50, gy: 50, on: false });
  return (
    <div
      ref={ref}
      style={{ perspective: 1000, ...style }}
      className={cx('reveal', className)}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse' || reduced()) return;
        const r = ref.current!.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        setT({ x: (0.5 - py) * max * 2, y: (px - 0.5) * max * 2, gx: px * 100, gy: py * 100, on: true });
      }}
      onPointerLeave={() => setT({ x: 0, y: 0, gx: 50, gy: 50, on: false })}
    >
      <div
        className="relative h-full rounded-[inherit] transition-transform duration-300 ease-[var(--ease-out-soft)] will-change-transform"
        style={{ transform: `rotateX(${t.x}deg) rotateY(${t.y}deg) translateZ(0) ${t.on ? 'scale(1.01)' : ''}`, transformStyle: 'preserve-3d' }}
      >
        {children}
        {glare && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
            style={{ opacity: t.on ? 1 : 0, background: `radial-gradient(380px circle at ${t.gx}% ${t.gy}%, rgb(255 255 255 / 0.5), transparent 45%)`, mixBlendMode: 'soft-light' }}
          />
        )}
      </div>
    </div>
  );
}

/** Number that counts up when it first appears. */
export function CountUp({ value, decimals = 0, prefix = '', suffix = '', duration = 1000 }: { value: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) return setShown(value);
    let raf = 0;
    const start = performance.now();
    const a = from.current;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(a + (value - a) * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <span className="tabular-nums">
      {prefix}
      {shown.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

/** Headline number: coloured top edge, icon chip, coloured value, trend and an optional sparkline. */
export function KpiCard({ label, value, icon, tone = 'blue', hint, trend, spark, href, i = 0, children }: { label: string; value: ReactNode; icon: string; tone?: FxTone; hint?: ReactNode; trend?: number | null; spark?: number[]; href?: string; i?: number; children?: ReactNode }) {
  const t = tones[tone];
  const body = (
    <div
      className={cx(
        'group relative h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.03] transition-shadow duration-300 before:absolute before:inset-x-0 before:top-0 before:h-[3px] hover:shadow-lg hover:shadow-slate-900/[0.06] sm:p-5',
        t.top,
        href && 'cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ring-1 transition-transform duration-500 ease-[var(--ease-spring)] group-hover:-rotate-6 group-hover:scale-110', t.soft)} aria-hidden>
          {icon}
        </span>
      </div>
      <div className={cx('mt-2 text-2xl font-semibold tracking-tight sm:text-[1.7rem]', t.value)}>{value}</div>
      <div className="mt-1 flex min-h-5 items-center gap-2 text-xs">
        {trend !== undefined && trend !== null && <span className={cx('rounded-full px-1.5 py-0.5 font-semibold', trend >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%</span>}
        {hint && <span className="truncate text-slate-500">{hint}</span>}
      </div>
      {spark && spark.length > 1 && (
        <div className="-mb-1 mt-2">
          <Sparkline values={spark} color={t.hex} />
        </div>
      )}
      {children}
    </div>
  );
  return (
    <Tilt className="h-full rounded-2xl" style={{ '--i': i } as CSSProperties}>
      {href ? (
        <Link href={href} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/25">
          {body}
        </Link>
      ) : (
        body
      )}
    </Tilt>
  );
}

function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] ?? pts[i];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[i + 2] ?? pts[i + 1];
    d += ` C ${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6}, ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6}, ${x2} ${y2}`;
  }
  return d;
}

export function Sparkline({ values, color = '#2563eb', height = 34 }: { values: number[]; color?: string; height?: number }) {
  const id = useId();
  const w = 200;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 3 - ((v - min) / (max - min || 1)) * (height - 6)] as [number, number]);
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`s${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.2" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L ${w} ${height} L 0 ${height} Z`} fill={`url(#s${id})`} className="animate-fade-in" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1" className="animate-draw" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Area chart: smooth line, soft fill, hover read-out, drawn-in animation. */
export function AreaChart({ data, color = '#2563eb', height = 200, format = (v: number) => String(v), max: fixedMax }: { data: { label: string; value: number }[]; color?: string; height?: number; format?: (v: number) => string; max?: number }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <p className="py-10 text-center text-sm text-slate-400">Not enough data yet.</p>;
  const w = 600;
  const pad = { t: 16, b: 26, l: 6, r: 6 };
  const max = fixedMax ?? Math.max(...data.map((d) => d.value), 1) * 1.15;
  const x = (i: number) => pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const pts = data.map((d, i) => [x(i), y(d.value)] as [number, number]);
  const line = smoothPath(pts);
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${height}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover(Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="Trend chart"
      >
        <defs>
          <linearGradient id={`a${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={w} y1={pad.t + g * (height - pad.t - pad.b)} y2={pad.t + g * (height - pad.t - pad.b)} stroke="#eef1f5" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${line} L ${x(data.length - 1)} ${height - pad.b} L ${x(0)} ${height - pad.b} Z`} fill={`url(#a${id})`} className="animate-fade-in" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1" className="animate-draw" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke={color} strokeOpacity="0.3" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="pointer-events-none absolute inset-0">
        {pts.map(([px, py], i) => (
          <span key={i} className={cx('absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow transition-all duration-200', hover === i ? 'scale-150' : 'scale-0 sm:scale-75')} style={{ left: `${(px / w) * 100}%`, top: `${(py / height) * 100}%`, background: color }} />
        ))}
        {h && hover !== null && (
          <div className="absolute -translate-x-1/2 animate-scale-in whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg" style={{ left: `${Math.min(88, Math.max(12, (x(hover) / w) * 100))}%`, top: 0 }}>
            {h.label}: {format(h.value)}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex justify-between px-1 text-[10px] text-slate-400">
          {data.map((d, i) => (
            <span key={i} className={i % Math.ceil(data.length / 7) === 0 || i === data.length - 1 ? '' : 'invisible'}>
              {d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Vertical bars that grow in. The latest bar uses the tone colour; earlier bars use its light shade. */
export function BarChart({ data, height = 190, format = (v: number) => String(v), tone = 'emerald' }: { data: { label: string; value: number }[]; height?: number; format?: (v: number) => string; tone?: FxTone }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const t = tones[tone];
  return (
    <div className="flex items-end gap-2 sm:gap-3" style={{ height }}>
      {data.map((d, i) => {
        const last = i === data.length - 1;
        return (
          <div key={d.label} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span className={cx('text-[10px] font-semibold transition-opacity duration-200 sm:text-xs', last ? t.value : 'text-slate-500 opacity-0 group-hover:opacity-100')}>{format(d.value)}</span>
            <div
              className={cx('w-full max-w-12 origin-bottom animate-grow-y rounded-t-lg transition-all duration-300 group-hover:brightness-95', last ? t.bar : `${t.light} ${t.hoverBar}`)}
              style={{ height: `${Math.max((d.value / max) * 100, 2)}%`, animationDelay: `${i * 70}ms` }}
              title={`${d.label}: ${format(d.value)}`}
            />
            <span className={cx('truncate text-[10px] sm:text-xs', last ? 'font-semibold text-slate-800' : 'text-slate-400')}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal bars for categories; each row gets its own colour. */
export function HBars({ data, format = (v: number) => String(v) }: { data: { label: string; value: number }[]; format?: (v: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => (
        <li key={d.label} className="group grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-slate-600">{d.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <span className={cx('block h-full origin-left animate-grow-x rounded-full transition-[filter] group-hover:brightness-110', tones[CATEGORICAL[i % CATEGORICAL.length]].bar)} style={{ width: `${(d.value / max) * 100}%`, animationDelay: `${i * 60}ms` }} />
          </span>
          <span className="text-right font-medium tabular-nums text-slate-800">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Radial gauge (0–100) that sweeps in. */
export function Gauge({ value, size = 120, stroke = 11, color = '#2563eb', track = '#eef1f5', label, sub }: { value: number | null; size?: number; stroke?: number; color?: string; track?: string; label?: ReactNode; sub?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {value !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={reduced() ? c * (1 - v / 100) : c}>
            <animate attributeName="stroke-dashoffset" from={c} to={c * (1 - v / 100)} dur="1.2s" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1" />
          </circle>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl font-semibold tracking-tight text-slate-900">{label ?? (value === null ? '—' : <CountUp value={v} decimals={v % 1 ? 1 : 0} suffix="%" />)}</span>
        {sub && <span className="text-[11px] text-slate-500">{sub}</span>}
      </div>
    </div>
  );
}

/** Light page header card with a soft pattern; actions sit below the title. */
export function Hero({ eyebrow, title, subtitle, children, aside }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="reveal relative isolate mb-6 overflow-hidden rounded-3xl border border-slate-200/80 bg-white px-5 py-6 shadow-sm shadow-slate-900/[0.03] sm:px-8 sm:py-7">
      <div aria-hidden className="absolute inset-0 -z-10 opacity-60 [background-image:radial-gradient(rgb(148_163_184/0.35)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:linear-gradient(to_left,black,transparent_65%)]" />
      <div aria-hidden className="absolute -right-24 -top-24 -z-10 h-64 w-64 rounded-full bg-sky-100/70 blur-3xl" />
      <div aria-hidden className="absolute -bottom-28 right-40 -z-10 h-56 w-56 rounded-full bg-emerald-100/60 blur-3xl" />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 animate-fade-up">
          {eyebrow && <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-xl text-sm text-slate-600">{subtitle}</p>}
          {children && <div className="mt-5 flex flex-wrap gap-2">{children}</div>}
        </div>
        {aside && <div className="shrink-0 animate-fade-up [animation-delay:120ms]">{aside}</div>}
      </div>
    </section>
  );
}

const ACTION_TONES: FxTone[] = ['blue', 'emerald', 'amber', 'rose', 'teal'];
let actionIndex = 0;

/** Quick-action button for the page header: white chip with a coloured icon. */
export function HeroAction({ href, icon, children, tone }: { href: string; icon: string; children: ReactNode; tone?: FxTone }) {
  const [tn] = useState<FxTone>(() => tone ?? ACTION_TONES[actionIndex++ % ACTION_TONES.length]);
  return (
    <Link href={href} className="group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md active:scale-95">
      <span className={cx('flex h-6 w-6 items-center justify-center rounded-lg text-xs ring-1 transition-transform duration-300 group-hover:scale-110', tones[tn].soft)} aria-hidden>
        {icon}
      </span>
      {children}
    </Link>
  );
}

/** Dashboard section card. */
export function Panel({ title, action, children, className, i = 0 }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; i?: number }) {
  return (
    <section className={cx('reveal min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03] transition-shadow duration-300 hover:shadow-md hover:shadow-slate-900/[0.05]', className)} style={{ '--i': i } as CSSProperties}>
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function PanelLink({ href, children = 'View all' }: { href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
      {children}
      <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
    </Link>
  );
}

/** A to-do row with a coloured count. */
export function TodoRow({ href, icon, label, count, tone = 'blue' }: { href: string; icon: string; label: ReactNode; count?: number; tone?: FxTone }) {
  const t = tones[tone];
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl px-2.5 py-2 transition duration-200 hover:bg-slate-50 active:scale-[0.99]">
      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110', t.soft)} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-sm text-slate-700">{label}</span>
      {count !== undefined && <span className={cx('animate-pop rounded-full px-2 py-0.5 text-xs font-semibold text-white', t.bar)}>{count}</span>}
      <span className="text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-slate-500">›</span>
    </Link>
  );
}
