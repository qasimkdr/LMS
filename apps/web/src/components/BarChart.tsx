import { monthLabel } from '@/lib/format';

/** Simple accessible monthly bar chart (no chart library needed). */
export function BarChart({ series, format }: { series: { month: string; amount: number }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...series.map((s) => s.amount));
  return (
    <div>
      <div className="flex h-44 items-end gap-1.5 sm:gap-2">
        {series.map((s, i) => {
          const h = (s.amount / max) * 100;
          const current = i === series.length - 1;
          return (
            <div key={s.month} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className={`w-full rounded-t-md transition ${current ? 'bg-brand-600' : 'bg-brand-200 group-hover:bg-brand-500'}`}
                style={{ height: `${s.amount ? Math.max(h, 2) : 0}%` }}
                title={`${monthLabel(s.month)}: ${format(s.amount)}`}
              />
              <div className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-0.5 text-xs text-white group-hover:block">
                {format(s.amount)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-2">
        {series.map((s, i) => (
          <div key={s.month} className="flex-1 text-center text-[10px] text-gray-500 sm:text-xs">
            {i % 2 === 0 || series.length <= 7 ? monthLabel(s.month) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
