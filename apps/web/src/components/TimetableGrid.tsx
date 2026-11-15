'use client';

import { useState, type ReactNode } from 'react';
import type { TTDay, TTEntry, TTPeriod } from '@/lib/types';

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
/** 08:40 -> 8:40 */
export const t12 = (t: string) => {
  const h = Number(t.slice(0, 2));
  return `${h % 12 || 12}:${t.slice(3)}${h < 12 ? 'am' : 'pm'}`;
};

/** 13:40 -> 1:40 (compact, for grid headers) */
const tShort = (t: string) => `${Number(t.slice(0, 2)) % 12 || 12}:${t.slice(3)}`;

export type CellMode = 'class' | 'teacher';

/** What a cell shows: in a class timetable the teacher, in a teacher timetable the class. */
export function CellContent({ e, mode }: { e: TTEntry; mode: CellMode }) {
  return (
    <>
      <div className="truncate font-medium text-gray-900">{e.subject?.name ?? e.note ?? '—'}</div>
      <div className="truncate text-[11px] text-gray-600">
        {mode === 'class' ? (e.teacher?.fullName ?? (e.subject ? 'No teacher' : '')) : `${e.section.class.name}${e.section.class.stream ? ` ${e.section.class.stream}` : ''} ${e.section.name}`}
        {e.room ? ` · Rm ${e.room}` : ''}
      </div>
    </>
  );
}

export function isNow(day: number, p: TTPeriod, now?: { day: number; minutes: number } | null) {
  return Boolean(now && now.day === day && now.minutes >= toMin(p.startTime) && now.minutes < toMin(p.endTime));
}

/**
 * Weekly timetable: a table on wide screens (one row per day, since Friday can have different timings)
 * and a day-by-day list on phones.
 */
export function TimetableGrid({
  week,
  mode,
  now,
  onCellClick,
  renderExtra,
}: {
  week: TTDay[];
  mode: CellMode;
  now?: { day: number; minutes: number } | null;
  onCellClick?: (day: number, p: TTPeriod) => void;
  renderExtra?: (day: number, p: TTPeriod) => ReactNode;
}) {
  const [mobileDay, setMobileDay] = useState(() => week.find((d) => d.day === now?.day)?.day ?? week[0]?.day ?? 1);
  const maxCols = Math.max(0, ...week.map((d) => d.periods.length));
  const clickable = Boolean(onCellClick);

  const cell = (day: number, p: TTPeriod) => {
    const live = isNow(day, p, now);
    const base = `rounded-lg border px-2 py-1.5 text-left text-xs transition ${live ? 'border-brand-500 ring-2 ring-brand-200' : 'border-gray-200'}`;
    if (p.isBreak) return <div className={`${base} border-dashed bg-gray-50 text-center text-gray-400`}>{p.name}</div>;
    const e = p.entries[0];
    const content = (
      <>
        {e ? <CellContent e={e} mode={mode} /> : <div className="text-gray-300">{clickable ? '+ Add' : 'Free'}</div>}
        {renderExtra?.(day, p)}
      </>
    );
    return clickable ? (
      <button type="button" onClick={() => onCellClick!(day, p)} className={`${base} block w-full bg-white hover:border-brand-500 hover:bg-brand-50`}>
        {content}
      </button>
    ) : (
      <div className={`${base} ${e ? 'bg-white' : 'bg-gray-50/60'}`}>{content}</div>
    );
  };

  if (week.length === 0 || maxCols === 0) {
    return <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Period timings are not set up yet.</div>;
  }

  return (
    <>
      {/* Wide screens and print */}
      <div className="-mx-5 hidden overflow-x-auto md:block print:block">
        <table className="w-full border-separate border-spacing-1 px-4 text-sm">
          <tbody>
            {week.map((d) => (
              <tr key={d.day}>
                <th className={`w-24 whitespace-nowrap px-2 text-left align-top text-xs font-semibold ${now?.day === d.day ? 'text-brand-700' : 'text-gray-600'}`}>
                  {d.dayName}
                  {d.scheduleName && <div className="font-normal text-gray-400">{d.scheduleName}</div>}
                </th>
                {Array.from({ length: maxCols }, (_, i) => {
                  const p = d.periods[i];
                  return (
                    <td key={i} className="min-w-24 align-top">
                      {p && (
                        <>
                          <div className="mb-0.5 px-1 text-[10px] text-gray-400">
                            {p.isBreak ? 'Break · ' : `${p.name.replace(/^Period\s*/i, 'P')} · `}
                            {tShort(p.startTime)}–{tShort(p.endTime)}
                          </div>
                          {cell(d.day, p)}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones */}
      <div className="md:hidden print:hidden">
        <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1">
          {week.map((d) => (
            <button
              key={d.day}
              onClick={() => setMobileDay(d.day)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${mobileDay === d.day ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              {d.dayName.slice(0, 3)}
            </button>
          ))}
        </div>
        <ul className="space-y-2">
          {week
            .find((d) => d.day === mobileDay)
            ?.periods.map((p) => (
              <li key={p.id} className="flex items-stretch gap-3">
                <div className="w-16 shrink-0 pt-1.5 text-right text-xs text-gray-500">
                  {t12(p.startTime)}
                  <div className="text-gray-400">{t12(p.endTime)}</div>
                </div>
                <div className="flex-1">{cell(mobileDay, p)}</div>
              </li>
            ))}
        </ul>
      </div>
    </>
  );
}

/** Today's periods with the current one highlighted and the next one marked (dashboards). */
export function TodayList({ week, mode, now }: { week: TTDay[]; mode: CellMode; now: { day: number; minutes: number } }) {
  const today = week.find((d) => d.day === now.day);
  if (!today) return <p className="text-sm text-gray-500">No classes today.</p>;
  const teaching = today.periods.filter((p) => !p.isBreak && (mode === 'class' || p.entries.length));
  if (teaching.length === 0) return <p className="text-sm text-gray-500">{mode === 'teacher' ? 'No periods today.' : 'Timetable not set yet.'}</p>;
  const nextIdx = teaching.findIndex((p) => toMin(p.startTime) > now.minutes);
  return (
    <ul className="space-y-1.5">
      {teaching.map((p, i) => {
        const live = isNow(now.day, p, now);
        const past = toMin(p.endTime) <= now.minutes;
        const e = p.entries[0];
        return (
          <li key={p.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${live ? 'border-brand-500 bg-brand-50' : 'border-gray-100'} ${past ? 'opacity-50' : ''}`}>
            <span className="w-24 shrink-0 text-xs text-gray-500">
              {t12(p.startTime)}–{t12(p.endTime)}
            </span>
            <span className="min-w-0 flex-1">{e ? <CellContent e={e} mode={mode} /> : <span className="text-gray-400">Free</span>}</span>
            {live && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white">NOW</span>}
            {!live && i === nextIdx && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700">NEXT</span>}
          </li>
        );
      })}
    </ul>
  );
}
