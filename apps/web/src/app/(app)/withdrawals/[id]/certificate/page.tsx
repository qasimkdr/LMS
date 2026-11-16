'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { fileUrl } from '@/lib/api';
import { useData } from '@/components/useData';
import { Button, ErrorBox, Loading } from '@/components/ui';
import { date } from '@/lib/format';

interface Cert {
  school: { name: string; address: string | null; city: string | null; phone: string | null; logoFileId: string | null };
  certificate: {
    no: number;
    issuedOn: string;
    studentName: string;
    fatherName: string;
    gender: string | null;
    dob: string | null;
    bForm: string | null;
    admissionNo: string;
    admissionDate: string | null;
    classAtLeaving: string;
    leavingDate: string;
    reason: string;
    conduct: string | null;
    remarks: string | null;
    lastExam: { title: string; percent: number; grade: string; passed: boolean } | null;
  };
}

/** Day-month-year in words for the date of birth, as certificates usually show it. */
function inWords(iso: string | null) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  const ones = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth'];
  const day = d.getUTCDate();
  const dayWord = day <= 20 ? ones[day] : day === 30 ? 'Thirtieth' : day === 31 ? 'Thirty-first' : `${day < 30 ? 'Twenty' : 'Thirty'}-${ones[day % 10].toLowerCase()}`;
  return `${dayWord} ${d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

export default function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, loading } = useData<Cert>(`/withdrawals/${id}/certificate`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const c = data.certificate;
  const he = c.gender === 'FEMALE' ? 'She' : 'He';
  const son = c.gender === 'FEMALE' ? 'daughter' : 'son';
  const rows: [string, string][] = [
    ['Name of student', c.studentName],
    ['Father’s name', c.fatherName],
    ['Date of birth (figures)', c.dob ? date(c.dob) : '—'],
    ['Date of birth (words)', inWords(c.dob) || '—'],
    ['B-Form no.', c.bForm ?? '—'],
    ['Admission no.', c.admissionNo],
    ['Date of admission', c.admissionDate ? date(c.admissionDate) : '—'],
    ['Class at the time of leaving', c.classAtLeaving],
    ['Date of leaving', date(c.leavingDate)],
    ['Reason for leaving', c.reason],
    ['Last examination', c.lastExam ? `${c.lastExam.title} – ${c.lastExam.percent}% (grade ${c.lastExam.grade}), ${c.lastExam.passed ? 'passed' : 'not passed'}` : '—'],
    ['Conduct', c.conduct ?? 'Good'],
    ['School dues', 'All dues cleared'],
  ];
  return (
    <>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <button onClick={() => router.back()} className="text-sm text-brand-700 hover:underline">
          ← Back
        </button>
        <Button onClick={() => window.print()}>Print / save PDF</Button>
      </div>
      <div className="mx-auto max-w-[210mm] bg-white p-3 shadow-xl print:p-0 print:shadow-none">
        <div className="relative border-[6px] border-double border-brand-900/80 p-8 sm:p-10">
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9rem] font-black text-brand-900/[0.03]">SLC</div>
          <header className="relative text-center">
            {data.school.logoFileId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(data.school.logoFileId)} alt="" className="mx-auto mb-2 h-16 w-16 object-contain" />
            )}
            <h1 className="text-2xl font-bold uppercase tracking-wide text-gray-900">{data.school.name}</h1>
            <p className="text-sm text-gray-600">{[data.school.address, data.school.city].filter(Boolean).join(', ')}</p>
            {data.school.phone && <p className="text-xs text-gray-500">Phone: {data.school.phone}</p>}
            <div className="mx-auto mt-4 inline-block rounded-full bg-brand-900 px-6 py-1.5 text-sm font-semibold uppercase tracking-[0.2em] text-white print:bg-gray-900">School Leaving Certificate</div>
            <div className="mt-3 flex justify-between text-sm text-gray-700">
              <span>
                Certificate no. <b>{c.no}</b>
              </span>
              <span>
                Date of issue: <b>{date(c.issuedOn)}</b>
              </span>
            </div>
          </header>
          <table className="relative mt-6 w-full text-sm">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="border-b border-dotted border-gray-300">
                  <td className="w-[42%] py-2 pr-3 text-gray-600">{k}</td>
                  <td className="py-2 font-semibold text-gray-900">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="relative mt-6 text-sm leading-relaxed text-gray-800">
            Certified that <b>{c.studentName}</b>, {son} of <b>{c.fatherName || '—'}</b>, was a bona fide student of this school. {he} left the school on <b>{date(c.leavingDate)}</b> from class <b>{c.classAtLeaving}</b>. {he} has cleared all school dues. {c.remarks ? `${c.remarks} ` : ''}We wish {c.gender === 'FEMALE' ? 'her' : 'him'} every success in the future.
          </p>
          <div className="relative mt-16 grid grid-cols-3 gap-6 text-center text-xs text-gray-600">
            <div className="border-t border-gray-500 pt-1">Prepared by</div>
            <div className="border-t border-gray-500 pt-1">School stamp</div>
            <div className="border-t border-gray-500 pt-1">Principal</div>
          </div>
        </div>
      </div>
    </>
  );
}
