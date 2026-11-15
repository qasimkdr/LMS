'use client';

import { fileUrl } from '@/lib/api';
import { Button, Empty } from '../ui';
import { date } from '@/lib/format';
import { fmt } from './shared';

export interface ReportCards {
  school: { name: string; address: string | null; city: string | null; phone: string | null; logoFileId: string | null };
  assessment: { id: string; title: string; type: string; kind: string; status: string; session: string | null };
  gradeBands: { grade: string; min: number; remark?: string }[];
  showPositions: boolean;
  cards: {
    student: { id: string; fullName: string; admissionNo: string; rollNo: string | null; photoFileId: string | null; dob: string | null; fatherName: string | null; classLabel: string; classTeacher: string | null };
    subjects: { subject: string; totalMarks: number; passMarks: number; obtained: number | null; absent: boolean; grade: string; passed: boolean; remark: string | null }[];
    result: { obtained: number; total: number; percent: number; grade: string; gradeRemark: string | null; passed: boolean; positionClass: number | null; positionSection: number | null; classSize: number };
    attendance: { counts: Record<string, number>; percent: number | null };
    remarks: { teacher: string | null; principal: string | null };
  }[];
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

/** A4 report cards, one per page. */
export function ReportCardPrint({ data }: { data: ReportCards }) {
  if (!data.cards.length) return <Empty title="No results to show yet" />;
  return (
    <div>
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm; } }`}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <span className="text-sm text-gray-600">
          {data.cards.length} report card{data.cards.length > 1 ? 's' : ''}
          {data.assessment.status !== 'PUBLISHED' && ' · DRAFT (results not published yet)'}
        </span>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <div className="space-y-8 print:space-y-0">
        {data.cards.map((c) => {
          const att = c.attendance.counts;
          const days = Object.values(att).reduce((a, b) => a + b, 0);
          return (
            <div key={c.student.id} className="relative mx-auto max-w-[210mm] bg-white p-8 text-gray-900 shadow-sm print:break-after-page print:p-0 print:shadow-none">
              {data.assessment.status !== 'PUBLISHED' && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-black uppercase text-gray-300/40 [transform:rotate(-25deg)]">Draft</div>}
              <header className="flex items-center gap-4 border-b-2 border-gray-800 pb-3">
                {data.school.logoFileId && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(data.school.logoFileId)} alt="" className="h-16 w-16 object-contain" />
                )}
                <div className="flex-1 text-center">
                  <div className="text-xl font-bold uppercase">{data.school.name}</div>
                  <div className="text-xs text-gray-600">{[data.school.address, data.school.city, data.school.phone].filter(Boolean).join(' · ')}</div>
                  <div className="mt-1 text-sm font-semibold uppercase tracking-wide">
                    Report card · {data.assessment.title}
                    {data.assessment.session && ` · ${data.assessment.session}`}
                  </div>
                </div>
                <div className="h-24 w-20 overflow-hidden border border-gray-300">
                  {c.student.photoFileId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(c.student.photoFileId)} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
              </header>
              <section className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                <div>
                  <span className="text-gray-500">Name:</span> <strong>{c.student.fullName}</strong>
                </div>
                <div>
                  <span className="text-gray-500">Class:</span> {c.student.classLabel}
                </div>
                <div>
                  <span className="text-gray-500">Father:</span> {c.student.fatherName ?? '—'}
                </div>
                <div>
                  <span className="text-gray-500">Roll no. / Adm. no.:</span> {c.student.rollNo ?? '—'} / {c.student.admissionNo}
                </div>
                <div>
                  <span className="text-gray-500">Date of birth:</span> {c.student.dob ? date(c.student.dob) : '—'}
                </div>
                <div>
                  <span className="text-gray-500">Class teacher:</span> {c.student.classTeacher ?? '—'}
                </div>
              </section>
              <table className="mt-4 w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100 print:bg-gray-200">
                    {['Subject', 'Total', 'Pass', 'Obtained', 'Grade', 'Remarks'].map((h) => (
                      <th key={h} className="border border-gray-300 px-2 py-1.5 text-left font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.subjects.map((s) => (
                    <tr key={s.subject}>
                      <td className="border border-gray-300 px-2 py-1.5">{s.subject}</td>
                      <td className="border border-gray-300 px-2 py-1.5">{fmt(s.totalMarks)}</td>
                      <td className="border border-gray-300 px-2 py-1.5">{fmt(s.passMarks)}</td>
                      <td className={`border border-gray-300 px-2 py-1.5 font-semibold ${s.passed ? '' : 'text-red-700'}`}>{s.absent ? 'Absent' : fmt(s.obtained)}</td>
                      <td className="border border-gray-300 px-2 py-1.5">{s.grade}</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-xs">{s.remark ?? ''}</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="border border-gray-300 px-2 py-1.5">Total</td>
                    <td className="border border-gray-300 px-2 py-1.5">{fmt(c.result.total)}</td>
                    <td className="border border-gray-300 px-2 py-1.5" />
                    <td className="border border-gray-300 px-2 py-1.5">{fmt(c.result.obtained)}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{c.result.grade}</td>
                    <td className="border border-gray-300 px-2 py-1.5" />
                  </tr>
                </tbody>
              </table>
              <section className="mt-4 grid grid-cols-4 gap-3 text-center text-sm">
                {[
                  ['Percentage', `${fmt(c.result.percent)}%`],
                  ['Grade', `${c.result.grade}${c.result.gradeRemark ? ` · ${c.result.gradeRemark}` : ''}`],
                  ['Result', c.result.passed ? 'Pass' : 'Not passed'],
                  data.showPositions && c.result.positionSection ? ['Position', `${ordinal(c.result.positionSection)} in section`] : ['Attendance', c.attendance.percent === null ? '—' : `${c.attendance.percent}%`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded border border-gray-300 px-2 py-2">
                    <div className="text-xs text-gray-500">{k}</div>
                    <div className={`font-semibold ${k === 'Result' && !c.result.passed ? 'text-red-700' : ''}`}>{v}</div>
                  </div>
                ))}
              </section>
              <section className="mt-3 text-sm">
                <span className="text-gray-500">Attendance:</span>{' '}
                {days ? `${(att.PRESENT ?? 0) + (att.LATE ?? 0)} present out of ${days} days${c.attendance.percent !== null ? ` (${c.attendance.percent}%)` : ''}, ${att.ABSENT ?? 0} absent, ${att.LEAVE ?? 0} leave` : 'Not recorded'}
                {data.showPositions && c.result.positionClass && ` · Class position: ${ordinal(c.result.positionClass)} of ${c.result.classSize}`}
              </section>
              <section className="mt-4 space-y-3 text-sm">
                <div>
                  <div className="text-xs font-semibold uppercase text-gray-500">Class teacher’s remarks</div>
                  <div className="min-h-[2rem] border-b border-gray-300 pb-1">{c.remarks.teacher ?? ''}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-gray-500">Principal’s remarks</div>
                  <div className="min-h-[2rem] border-b border-gray-300 pb-1">{c.remarks.principal ?? ''}</div>
                </div>
              </section>
              <section className="mt-4 text-[10px] text-gray-500">Grading: {data.gradeBands.map((b) => `${b.grade} ${b.min}%+`).join(' · ')}</section>
              <footer className="mt-10 grid grid-cols-3 gap-8 text-center text-xs">
                <div className="border-t border-gray-500 pt-1">Class teacher</div>
                <div className="border-t border-gray-500 pt-1">Principal</div>
                <div className="border-t border-gray-500 pt-1">Parent / guardian</div>
              </footer>
            </div>
          );
        })}
      </div>
    </div>
  );
}
