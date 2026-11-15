'use client';

import type { ReactNode } from 'react';
import { fileUrl } from '@/lib/api';
import { useData } from './useData';
import { Button } from './ui';
import { date, genderLabel, relationLabel } from '@/lib/format';
import { className } from '@/lib/types';

interface School {
  school: { name: string; address: string | null; city: string | null; phone: string | null; email: string | null; logoFileId: string | null };
}

function Row({ label, value, wide }: { label: string; value?: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex items-end gap-2 ${wide ? 'col-span-2' : ''}`}>
      <span className="shrink-0 text-[11px] text-gray-600">{label}</span>
      <span className="min-h-[1.25rem] flex-1 border-b border-gray-400 pb-0.5 text-[12px] font-medium">{value ?? ''}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 break-inside-avoid">
      <h3 className="mb-2 bg-gray-100 px-2 py-1 text-[12px] font-bold uppercase tracking-wide print:bg-gray-200">{title}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 px-1">{children}</div>
    </section>
  );
}

/** A4 admission form. Pass a student to print it filled in, or nothing for a blank form. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AdmissionPrint({ student }: { student?: any }) {
  const { data } = useData<School>('/school/overview');
  const s = student;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (rel: string) => s?.family?.guardians?.find((x: any) => x.relation === rel);
  const father = g('FATHER');
  const mother = g('MOTHER');
  const guardian = g('GUARDIAN');
  const school = data?.school;

  return (
    <div>
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <div className="mx-auto max-w-[210mm] bg-white p-6 text-gray-900 shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-center gap-4 border-b-2 border-gray-800 pb-3">
          {school?.logoFileId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(school.logoFileId)} alt="" className="h-16 w-16 object-contain" />
          )}
          <div className="flex-1 text-center">
            <div className="text-xl font-bold uppercase">{school?.name}</div>
            <div className="text-[11px] text-gray-600">{[school?.address, school?.city].filter(Boolean).join(', ')}</div>
            <div className="text-[11px] text-gray-600">{[school?.phone, school?.email].filter(Boolean).join(' · ')}</div>
            <div className="mt-1 text-sm font-semibold tracking-wide">ADMISSION FORM</div>
          </div>
          <div className="flex h-28 w-24 items-center justify-center overflow-hidden border border-gray-400 text-[10px] text-gray-400">
            {s?.photoFileId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(s.photoFileId)} alt="" className="h-full w-full object-cover" />
            ) : (
              'Paste photo'
            )}
          </div>
        </header>

        <Block title="Admission">
          <Row label="Admission no." value={s?.admissionNo} />
          <Row label="Admission date" value={s ? date(s.admissionDate) : ''} />
          <Row label="Class" value={s ? className(s.class) : ''} />
          <Row label="Section / Roll no." value={s ? [s.section?.name, s.rollNo].filter(Boolean).join(' / ') : ''} />
          <Row label="Session" value={s?.session?.name} />
          <Row label="Family no." value={s?.family?.familyNo} />
        </Block>

        <Block title="Student">
          <Row label="Full name" value={s?.fullName} wide />
          <Row label="Gender" value={s ? genderLabel[s.gender] : ''} />
          <Row label="Date of birth" value={s?.dob ? date(s.dob) : ''} />
          <Row label="B-Form no." value={s?.bForm} />
          <Row label="Place of birth" value={s?.placeOfBirth} />
          <Row label="Religion" value={s?.religion} />
          <Row label="Nationality" value={s?.nationality} />
          <Row label="Blood group" value={s?.bloodGroup} />
          <Row label="Mother tongue" value={s?.motherTongue} />
          <Row label="Current address" value={s?.currentAddress} wide />
          <Row label="Permanent address" value={s?.permanentAddress} wide />
          <Row label="City" value={s?.city} />
          <Row label="Area" value={s?.area} />
        </Block>

        {[
          { title: relationLabel.FATHER, x: father },
          { title: relationLabel.MOTHER, x: mother },
        ].map(({ title, x }) => (
          <Block key={title} title={title}>
            <Row label="Name" value={x?.fullName} />
            <Row label="CNIC" value={x?.cnic} />
            <Row label="Mobile" value={x?.phone} />
            <Row label="WhatsApp" value={x?.whatsapp} />
            <Row label="Occupation" value={x?.occupation} />
            <Row label="Education" value={x?.education} />
          </Block>
        ))}

        <Block title="Guardian (if not living with parents)">
          <Row label="Name" value={guardian?.fullName} />
          <Row label="Relation" value={guardian?.relationDetail} />
          <Row label="CNIC" value={guardian?.cnic} />
          <Row label="Mobile" value={guardian?.phone} />
        </Block>

        <Block title="Emergency contact & health">
          <Row label="Emergency contact" value={s?.emergencyContact?.name} />
          <Row label="Relation / phone" value={s ? [s.emergencyContact?.relation, s.emergencyContact?.phone].filter(Boolean).join(' · ') : ''} />
          <Row label="Allergies" value={s?.health?.allergies} />
          <Row label="Medical conditions" value={s?.health?.conditions} />
          <Row label="Medicines" value={s?.health?.medicines} />
          <Row label="Special needs" value={s?.health?.specialNeeds} />
        </Block>

        <Block title="Previous school">
          <Row label="School" value={s?.previousSchool?.schoolName} wide />
          <Row label="Last class" value={s?.previousSchool?.lastClass} />
          <Row label="Year / marks" value={s ? [s.previousSchool?.year, s.previousSchool?.marks].filter(Boolean).join(' · ') : ''} />
          <Row label="Leaving certificate no." value={s?.previousSchool?.slcNo} />
          <Row label="Reason for leaving" value={s?.previousSchool?.reasonForLeaving} />
        </Block>

        <section className="mt-5 break-inside-avoid text-[11px]">
          <p className="text-gray-700">
            I declare that the information given above is correct and I agree to follow the rules and regulations of the school.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-8 text-center">
            <div className="border-t border-gray-500 pt-1">Parent / guardian signature</div>
            <div className="border-t border-gray-500 pt-1">Date</div>
            <div className="border-t border-gray-500 pt-1">Principal</div>
          </div>
        </section>
      </div>
    </div>
  );
}
