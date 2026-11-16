/**
 * Fills the dev school "City Grammar School" with realistic demo data for screenshots and sales demos:
 * ~400 students in 22 sections, teachers, 12 months of fee vouchers and payments, 5 weeks of attendance,
 * a published first-term exam, November monthly tests, an announced second-term date sheet and syllabus progress.
 *
 * Dev only. Run once: `npx tsx src/scripts/seedDemoData.ts` (skips itself if the school already has 100+ students).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();
const SCHOOL = 'City Grammar School';

// Deterministic random numbers so the demo looks the same every time.
let seed = 20261117;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; };

const BOYS = ['Ahmed', 'Ali', 'Hamza', 'Hassan', 'Hussain', 'Usman', 'Umar', 'Bilal', 'Saad', 'Zain', 'Abdullah', 'Ibrahim', 'Muhammad', 'Rayyan', 'Arham', 'Ayaan', 'Daniyal', 'Fahad', 'Haris', 'Talha', 'Shayan', 'Moiz', 'Rehan', 'Faizan', 'Huzaifa', 'Taha', 'Mustafa', 'Areeb', 'Arsalan', 'Waleed'];
const GIRLS = ['Ayesha', 'Fatima', 'Zainab', 'Maryam', 'Hira', 'Alishba', 'Eman', 'Hafsa', 'Iqra', 'Laiba', 'Mahnoor', 'Noor', 'Areeba', 'Anaya', 'Zoya', 'Sana', 'Hania', 'Minahil', 'Rida', 'Khadija', 'Amna', 'Aleena', 'Dua', 'Inaya', 'Javeria', 'Kinza', 'Mehwish', 'Rabia', 'Sara', 'Wajiha'];
const SURNAMES = ['Khan', 'Ahmed', 'Raza', 'Malik', 'Butt', 'Sheikh', 'Qureshi', 'Chaudhry', 'Hussain', 'Iqbal', 'Siddiqui', 'Mirza', 'Abbasi', 'Javed', 'Aslam', 'Tariq', 'Rana', 'Shah', 'Farooq', 'Nawaz', 'Akhtar', 'Haider', 'Saleem', 'Anwar'];
const FATHERS = ['Imran', 'Kashif', 'Asif', 'Naveed', 'Shahid', 'Tariq', 'Khalid', 'Waseem', 'Zubair', 'Adnan', 'Faisal', 'Junaid', 'Nadeem', 'Rizwan', 'Sajid', 'Tahir', 'Yasir', 'Amir', 'Babar', 'Irfan'];
const AREAS = ['Gulberg', 'Model Town', 'Johar Town', 'DHA Phase 5', 'Garden Town', 'Faisal Town', 'Township', 'Iqbal Town', 'Cantt', 'Wapda Town'];
const JOBS = ['Businessman', 'Engineer', 'Doctor', 'Banker', 'Government servant', 'Shopkeeper', 'Teacher', 'Accountant', 'Lawyer', 'IT professional'];
const TEACHERS: [string, 'MALE' | 'FEMALE', string][] = [
  ['Mariam Javed', 'FEMALE', 'M.A. English'], ['Kamran Haider', 'MALE', 'M.Sc. Mathematics'], ['Nida Farooq', 'FEMALE', 'M.Sc. Chemistry'],
  ['Saima Akhtar', 'FEMALE', 'M.A. Urdu'], ['Usman Ghani', 'MALE', 'M.Sc. Physics'], ['Rabia Saleem', 'FEMALE', 'B.Ed., B.A.'],
  ['Hina Tariq', 'FEMALE', 'M.A. Education'], ['Adeel Anwar', 'MALE', 'M.Sc. Computer Science'], ['Sadia Nawaz', 'FEMALE', 'M.Sc. Biology'],
  ['Farah Shah', 'FEMALE', 'B.Ed., M.A.'], ['Zeeshan Mirza', 'MALE', 'M.Sc. Mathematics'], ['Amna Rana', 'FEMALE', 'M.A. English'],
  ['Tahira Butt', 'FEMALE', 'B.Ed.'], ['Naeem Abbasi', 'MALE', 'M.A. Islamiat'], ['Sobia Malik', 'FEMALE', 'M.Ed.'], ['Rashid Iqbal', 'MALE', 'M.Sc. Statistics'],
];
const CHAPTERS: Record<string, string[]> = {
  English: ['Reading comprehension', 'Nouns and pronouns', 'Verbs and tenses', 'Adjectives and adverbs', 'Sentence structure', 'Punctuation', 'Letter writing', 'Story writing', 'Poetry', 'Essay writing'],
  Urdu: ['Hamd o Naat', 'Mazmoon nigari', 'Qawaid', 'Kahani', 'Nazm', 'Khat nawesi', 'Muhavare', 'Tafheem', 'Dastaan', 'Insha pardazi'],
  Mathematics: ['Numbers and place value', 'Addition and subtraction', 'Multiplication', 'Division', 'Fractions', 'Decimals', 'Measurement', 'Geometry', 'Data handling', 'Algebra basics'],
  Science: ['Living things', 'Plants', 'Human body', 'Food and health', 'Matter', 'Forces and motion', 'Energy', 'Light and sound', 'Earth and space', 'Environment'],
};

const day = (s: string) => new Date(s + 'T00:00:00.000Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

async function main() {
  const school = await prisma.school.findFirstOrThrow({ where: { name: SCHOOL } });
  const schoolId = school.id;
  if ((await prisma.student.count({ where: { schoolId } })) >= 100) { console.log('Demo data already present — nothing to do.'); return; }

  const principal = await prisma.user.findFirstOrThrow({ where: { schoolId, role: 'PRINCIPAL' } });
  const accountant = await prisma.user.findFirst({ where: { schoolId, username: 'bilal.acc' } });
  const anyTeacher = await prisma.user.findFirstOrThrow({ where: { schoolId, role: 'TEACHER' } });
  const session = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
  const subjects = await prisma.subject.findMany({ where: { schoolId } });
  const subj = (n: string) => subjects.find((s) => s.name === n)!;
  const types = await prisma.assessmentType.findMany({ where: { schoolId } });
  const typeId = (n: string) => types.find((t) => t.name === n)!.id;
  const bands = ((await prisma.examSettings.findUnique({ where: { schoolId } }))?.gradeBands as { min: number; grade: string }[]) ?? [{ min: 0, grade: '-' }];
  const gradeOf = (p: number) => bands.find((b) => p >= b.min)?.grade ?? 'F';

  // "Today" in the school's time zone.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: school.timezone ?? 'Asia/Karachi' }).format(new Date());
  const todayD = day(today);
  const thisPeriod = today.slice(0, 7);

  // Counters
  const counters = Object.fromEntries((await prisma.schoolCounter.findMany({ where: { schoolId } })).map((c) => [c.key, c.value]));
  const next = (k: string) => (counters[k] = (counters[k] ?? 0) + 1);

  // ---- Classes, sections, subjects ----------------------------------------------------------
  const classes = await prisma.classLevel.findMany({ where: { schoolId, deletedAt: null }, include: { sections: { where: { deletedAt: null } } }, orderBy: { sortOrder: 'asc' } });
  const twoSections = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9'];
  for (const c of classes) {
    if (twoSections.includes(c.name) && !c.sections.some((s) => s.name === 'B')) {
      c.sections.push(await prisma.section.create({ data: { schoolId, classId: c.id, name: 'B', capacity: 30 } }));
    }
  }
  const gradedClasses = classes.filter((c) => c.name.startsWith('Class'));
  await prisma.classSubject.createMany({ data: gradedClasses.flatMap((c) => subjects.map((s) => ({ classId: c.id, subjectId: s.id }))), skipDuplicates: true });

  // ---- Teachers ------------------------------------------------------------------------------
  const teacherIds: string[] = [anyTeacher.id];
  const existingTeachers = await prisma.user.findMany({ where: { schoolId, role: 'TEACHER' } });
  teacherIds.splice(0, 1, ...existingTeachers.map((t) => t.id));
  const slug = principal.username.includes('.') ? principal.username.split('.')[0] : 'city-grammar-school';
  for (const [name, gender, qual] of TEACHERS) {
    const n = next('employee');
    const empNo = 'E' + String(n).padStart(3, '0');
    const u = await prisma.user.create({
      data: {
        schoolId, role: 'TEACHER', username: `${slug === 'ayesha' ? 'city-grammar-school' : slug}.${empNo.toLowerCase()}`, fullName: name,
        phone: '03' + between(0, 4) + String(between(10000000, 99999999)), passwordHash: anyTeacher.passwordHash, mustChangePassword: true,
        staffProfile: { create: { schoolId, employeeNo: empNo, designation: pick(['Teacher', 'Senior Teacher', 'Teacher', 'Subject Specialist']), gender, qualification: qual, joiningDate: day(`20${between(15, 25)}-0${between(1, 8)}-01`), experienceYears: between(2, 15) } },
      },
    });
    teacherIds.push(u.id);
  }

  // Class teachers + subject teachers
  const allSections = classes.flatMap((c) => c.sections.map((s) => ({ ...s, className: c.name, classId: c.id })));
  let ti = 0;
  for (const s of allSections) {
    if (!s.classTeacherId) await prisma.section.update({ where: { id: s.id }, data: { classTeacherId: teacherIds[ti++ % teacherIds.length] } });
  }
  const gradedSections = allSections.filter((s) => s.className.startsWith('Class'));
  await prisma.teachingAssignment.createMany({
    data: gradedSections.flatMap((s, i) => subjects.map((sub, j) => ({ schoolId, sectionId: s.id, subjectId: sub.id, teacherId: teacherIds[(i + j * 3) % teacherIds.length] }))),
    skipDuplicates: true,
  });

  // ---- Families and students -----------------------------------------------------------------
  const existing = await prisma.student.findMany({ where: { schoolId, deletedAt: null } });
  const perSection = new Map<string, number>();
  for (const s of existing) if (s.sectionId) perSection.set(s.sectionId, (perSection.get(s.sectionId) ?? 0) + 1);

  type NewStudent = { id: string; familyId: string; classId: string; sectionId: string; fullName: string; ability: number; attend: number; sibling: boolean; payer: number };
  const students: NewStudent[] = [];
  const families: { id: string; surname: string; father: string; payer: number }[] = [];
  const guardianRows: Prisma.GuardianCreateManyInput[] = [];
  const studentRows: Prisma.StudentCreateManyInput[] = [];
  const familyRows: Prisma.FamilyCreateManyInput[] = [];

  for (const s of allSections) {
    const target = (s.className.match(/Class (9|10)/) ? between(16, 20) : between(17, 22)) - (perSection.get(s.id) ?? 0);
    for (let i = 0; i < target; i++) {
      // ~22% of children join an existing family (siblings), otherwise a new family.
      let fam = families.length > 20 && rnd() < 0.22 ? pick(families) : null;
      let sibling = !!fam;
      if (!fam) {
        fam = { id: randomUUID().replace(/-/g, '').slice(0, 25), surname: pick(SURNAMES), father: pick(FATHERS), payer: rnd() };
        families.push(fam);
        familyRows.push({ id: fam.id, schoolId, familyNo: String(next('family')).padStart(4, '0') });
        const area = pick(AREAS);
        guardianRows.push({ schoolId, familyId: fam.id, relation: 'FATHER', fullName: `${fam.father} ${fam.surname}`, phone: '03' + between(0, 4) + String(between(10000000, 99999999)), occupation: pick(JOBS), address: `House ${between(1, 400)}, ${area}, Lahore`, receivesMessages: true });
        guardianRows.push({ schoolId, familyId: fam.id, relation: 'MOTHER', fullName: `${pick(GIRLS)} ${fam.surname}`, phone: '03' + between(0, 4) + String(between(10000000, 99999999)) });
      }
      const gender = rnd() < 0.5 ? 'MALE' : 'FEMALE';
      const fullName = `${pick(gender === 'MALE' ? BOYS : GIRLS)} ${fam.surname}`;
      const id = randomUUID().replace(/-/g, '').slice(0, 25);
      const classIdx = classes.findIndex((c) => c.id === s.classId);
      const year = 2026 - between(0, Math.min(6, classIdx));
      studentRows.push({
        id, schoolId, familyId: fam.id, admissionNo: `${year}${String(next('admission')).padStart(4, '0')}`, admissionDate: day(`${year}-04-0${between(1, 9)}`),
        sessionId: session?.id, classId: s.classId, sectionId: s.id, fullName, gender, dob: day(`${2021 - classIdx}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`),
        religion: 'Islam', nationality: 'Pakistani', city: 'Lahore', area: pick(AREAS), bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'B-', 'O-']),
        discountType: sibling ? 'Sibling discount' : null, discountPercent: sibling ? dec(10) : null,
      });
      students.push({ id, familyId: fam.id, classId: s.classId, sectionId: s.id, fullName, ability: Math.max(35, Math.min(98, 72 + gauss() * 12)), attend: Math.min(0.995, 0.9 + rnd() * 0.095), sibling, payer: fam.payer });
    }
  }
  await prisma.family.createMany({ data: familyRows });
  await prisma.guardian.createMany({ data: guardianRows });
  for (let i = 0; i < studentRows.length; i += 200) await prisma.student.createMany({ data: studentRows.slice(i, i + 200) });
  // Roll numbers by name within each section.
  const everyone = await prisma.student.findMany({ where: { schoolId, deletedAt: null, status: 'ACTIVE' }, orderBy: { fullName: 'asc' } });
  const rollBySection = new Map<string, number>();
  for (const st of everyone) {
    if (!st.sectionId || st.rollNo) continue;
    const r = (rollBySection.get(st.sectionId) ?? 0) + 1; rollBySection.set(st.sectionId, r);
    await prisma.student.update({ where: { id: st.id }, data: { rollNo: String(r + 2) } });
  }
  // Existing (hand-made) students take part in attendance and results too.
  const allStudents = [
    ...students,
    ...existing.filter((e) => e.sectionId).map((e) => ({ id: e.id, familyId: e.familyId, classId: e.classId, sectionId: e.sectionId!, fullName: e.fullName, ability: 82, attend: 0.98, sibling: false, payer: 0.1 })),
  ];
  console.log('students', allStudents.length, 'families', families.length, 'teachers', teacherIds.length);

  // ---- Attendance: last 25 school days (Mon–Sat) ----------------------------------------------
  const days: Date[] = [];
  for (let d = todayD; days.length < 25; d = addDays(d, -1)) if (d.getUTCDay() !== 0) days.push(d);
  const unmarkedToday = new Set(gradedSections.slice(-2).map((s) => s.id));
  const sessionRows: Prisma.AttendanceSessionCreateManyInput[] = [];
  const recordRows: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (const d of days) {
    const isToday = iso(d) === today;
    for (const s of allSections) {
      if (isToday && unmarkedToday.has(s.id)) continue;
      sessionRows.push({ schoolId, sectionId: s.id, date: d, markedById: s.classTeacherId ?? principal.id });
      for (const st of allStudents.filter((x) => x.sectionId === s.id)) {
        const r = rnd();
        const status = r < st.attend ? (rnd() < 0.03 ? 'LATE' : 'PRESENT') : rnd() < 0.25 ? 'LEAVE' : 'ABSENT';
        recordRows.push({ schoolId, studentId: st.id, sectionId: s.id, date: d, status, alertSentAt: status === 'ABSENT' || status === 'LATE' ? new Date() : null });
      }
    }
  }
  await prisma.attendanceSession.createMany({ data: sessionRows, skipDuplicates: true });
  for (let i = 0; i < recordRows.length; i += 1000) await prisma.attendanceRecord.createMany({ data: recordRows.slice(i, i + 1000), skipDuplicates: true });
  console.log('attendance records', recordRows.length);

  // ---- Fees: 12 months of vouchers and payments -----------------------------------------------
  const heads = await prisma.feeHead.findMany({ where: { schoolId, isActive: true }, include: { classFees: true } });
  const periods: string[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 - i, 1)); periods.push(iso(d).slice(0, 7)); }
  const already = new Set((await prisma.feeInvoice.findMany({ where: { schoolId }, select: { studentId: true, period: true } })).map((r) => `${r.studentId}|${r.period}`));
  const newIds = new Set(students.map((s) => s.id));
  type Inv = { id: string; studentId: string; familyId: string; period: string; total: number; paid: number };
  const invoices: Inv[] = [];
  const invRows: Prisma.FeeInvoiceCreateManyInput[] = [];
  const lineRows: Prisma.FeeInvoiceLineCreateManyInput[] = [];
  for (const period of periods) {
    const m = +period.slice(5, 7);
    const issue = day(period + '-01');
    for (const st of students) {
      if (already.has(`${st.id}|${period}`)) continue;
      const id = randomUUID().replace(/-/g, '').slice(0, 25);
      let total = 0;
      const lines: Prisma.FeeInvoiceLineCreateManyInput[] = [];
      for (const h of heads) {
        const cf = h.classFees.find((c) => c.classId === st.classId);
        if (!cf) continue;
        const due = h.frequency === 'MONTHLY' || (h.frequency === 'SELECTED_MONTHS' && ((h.months as number[]) ?? []).includes(m));
        if (!due) continue;
        const amt = Number(cf.amount);
        lines.push({ invoiceId: id, headId: h.id, kind: 'MONTHLY', description: h.name, amount: dec(amt) }); total += amt;
        if (st.sibling && h.discountable) { const d = Math.round(amt * 0.1); lines.push({ invoiceId: id, kind: 'DISCOUNT', description: 'Sibling discount (10%)', amount: dec(-d) }); total -= d; }
      }
      if (!lines.length) continue;
      const monthName = new Date(issue).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      invRows.push({ id, schoolId, studentId: st.id, familyId: st.familyId, invoiceNo: `INV-${String(next('invoice')).padStart(6, '0')}`, period, title: `Monthly fee – ${monthName}`, issueDate: issue, dueDate: day(period + '-10'), total: dec(total), createdById: principal.id });
      lineRows.push(...lines);
      invoices.push({ id, studentId: st.id, familyId: st.familyId, period, total, paid: 0 });
    }
  }

  // Payments: one receipt per family per month. Older months are almost fully recovered; this month is in progress.
  const nowMs = Date.now();
  const midnightToday = new Date(`${today}T00:00:00+05:00`).getTime();
  const payRows: Prisma.FeePaymentCreateManyInput[] = [];
  const allocRows: Prisma.FeePaymentAllocationCreateManyInput[] = [];
  const byFamilyPeriod = new Map<string, Inv[]>();
  for (const inv of invoices) { const k = `${inv.familyId}|${inv.period}`; (byFamilyPeriod.get(k) ?? byFamilyPeriod.set(k, []).get(k)!).push(inv); }
  const todayDay = +today.slice(8, 10);
  const familyPayer = new Map(families.map((f) => [f.id, f.payer]));
  const todaysCounter: string[] = [];
  const monthlyCounter = new Map<string, { ids: string[]; total: number; byMethod: Record<string, number> }>();
  for (const [k, invs] of byFamilyPeriod) {
    const [famId, period] = k.split('|');
    const payer = familyPayer.get(famId) ?? 0.5;
    const ageMonths = periods.length - 1 - periods.indexOf(period);
    const payProb = ageMonths === 0 ? 0.64 : ageMonths === 1 ? 0.9 : ageMonths <= 3 ? 0.95 : 0.975;
    if (payer > payProb) continue; // the habitual late payers stay behind
    const total = invs.reduce((s, i) => s + i.total, 0);
    const partial = rnd() < 0.04;
    const amount = partial ? Math.round(total * 0.5 / 100) * 100 : total;
    let when: Date;
    if (ageMonths === 0) {
      const d = between(1, todayDay);
      if (d === todayDay) when = new Date(midnightToday + Math.floor(rnd() * Math.max(60000, nowMs - midnightToday - 60000)));
      else when = new Date(`${period}-${String(d).padStart(2, '0')}T${String(between(8, 13)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:00+05:00`);
    } else {
      when = new Date(`${period}-${String(between(1, 18)).padStart(2, '0')}T${String(between(8, 13)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:00+05:00`);
    }
    const r = rnd();
    const method = r < 0.68 ? 'CASH' : r < 0.88 ? 'BANK' : 'ONLINE';
    const counter = method !== 'ONLINE';
    const collector = counter ? (rnd() < 0.75 && accountant ? accountant.id : principal.id) : null;
    const id = randomUUID().replace(/-/g, '').slice(0, 25);
    payRows.push({ id, schoolId, receiptNo: `R-${String(next('receipt')).padStart(6, '0')}`, familyId: famId, amount: dec(amount), method, source: counter ? 'COUNTER' : 'ONLINE', reference: method === 'BANK' ? `TRX${between(100000, 999999)}` : null, receivedAt: when, collectedById: collector });
    let left = amount;
    for (const inv of invs) {
      const a = Math.min(left, inv.total); if (a <= 0) break;
      allocRows.push({ paymentId: id, invoiceId: inv.id, amount: dec(a) }); inv.paid += a; left -= a;
    }
    if (counter) {
      if (when.getTime() >= midnightToday) { if (collector === accountant?.id) todaysCounter.push(id); }
      else {
        const key = iso(new Date(when.getTime() + 5 * 3600000)); // hand over daily
        const h = monthlyCounter.get(key) ?? { ids: [], total: 0, byMethod: {} };
        h.ids.push(id); h.total += amount; h.byMethod[method] = (h.byMethod[method] ?? 0) + amount; monthlyCounter.set(key, h);
      }
    }
  }
  for (const r of invRows) {
    const inv = invoices.find((i) => i.id === r.id)!;
    r.paidAmount = dec(inv.paid);
    r.status = inv.paid >= inv.total - 0.001 ? 'PAID' : inv.paid > 0 ? 'PARTIAL' : 'UNPAID';
  }
  for (let i = 0; i < invRows.length; i += 500) await prisma.feeInvoice.createMany({ data: invRows.slice(i, i + 500) });
  for (let i = 0; i < lineRows.length; i += 1000) await prisma.feeInvoiceLine.createMany({ data: lineRows.slice(i, i + 1000) });
  for (let i = 0; i < payRows.length; i += 500) await prisma.feePayment.createMany({ data: payRows.slice(i, i + 500) });
  for (let i = 0; i < allocRows.length; i += 1000) await prisma.feePaymentAllocation.createMany({ data: allocRows.slice(i, i + 1000) });
  // Daily hand-overs, approved by the principal; today's cash from the accountant is waiting for approval.
  for (const [d, h] of monthlyCounter) {
    const ho = await prisma.feeHandover.create({ data: { schoolId, staffId: accountant?.id ?? principal.id, expectedAmount: dec(h.total), declaredAmount: dec(h.total), byMethod: h.byMethod, status: 'APPROVED', reviewedById: principal.id, reviewedAt: new Date(`${d}T14:30:00+05:00`), createdAt: new Date(`${d}T14:00:00+05:00`) } });
    await prisma.feePayment.updateMany({ where: { id: { in: h.ids } }, data: { handoverId: ho.id } });
  }
  if (todaysCounter.length && accountant) {
    const pays = payRows.filter((p) => todaysCounter.includes(p.id!));
    const tot = pays.reduce((s, p) => s + Number(p.amount), 0);
    const ho = await prisma.feeHandover.create({ data: { schoolId, staffId: accountant.id, expectedAmount: dec(tot), declaredAmount: dec(tot), byMethod: { CASH: tot }, status: 'PENDING', note: 'Today’s counter collection' } });
    await prisma.feePayment.updateMany({ where: { id: { in: todaysCounter } }, data: { handoverId: ho.id } });
  }
  console.log('invoices', invRows.length, 'payments', payRows.length);

  // ---- Exams and tests -----------------------------------------------------------------------
  const studentsOfClass = (classId: string) => allStudents.filter((s) => s.classId === classId);
  async function publish(opts: { kind: 'EXAM' | 'TEST'; type: string; title: string; classId: string; sectionId?: string; groupKey?: string; papers: { subjectId: string; date: string; total: number }[]; publishedAt: Date; who: { id: string; ability: number; sectionId: string }[] }) {
    const a = await prisma.assessment.create({ data: { schoolId, kind: opts.kind, typeId: typeId(opts.type), title: opts.title, groupKey: opts.groupKey, sessionId: session?.id, classId: opts.classId, sectionId: opts.sectionId, announced: true, status: 'PUBLISHED', publishedAt: opts.publishedAt, publishedById: principal.id, createdById: principal.id } });
    const sectionIds = [...new Set(opts.who.map((w) => w.sectionId))];
    const totals = new Map<string, { o: number; t: number; abs: number }>();
    for (const [i, p] of opts.papers.entries()) {
      const paper = await prisma.assessmentPaper.create({ data: { assessmentId: a.id, subjectId: p.subjectId, date: day(p.date), startTime: '08:30', totalMarks: dec(p.total), passMarks: dec(Math.round(p.total * 0.33)), sortOrder: i } });
      await prisma.markSheet.createMany({ data: sectionIds.map((sid) => ({ paperId: paper.id, sectionId: sid, status: 'APPROVED', submittedById: principal.id, submittedAt: opts.publishedAt, reviewedById: principal.id, reviewedAt: opts.publishedAt })) });
      const rows = opts.who.map((w) => {
        const absent = rnd() < 0.015;
        const pct = Math.max(18, Math.min(100, w.ability + gauss() * 7));
        const marks = absent ? null : Math.round((pct / 100) * p.total * 2) / 2;
        const t = totals.get(w.id) ?? { o: 0, t: 0, abs: 0 };
        t.t += p.total; t.o += marks ?? 0; t.abs += absent ? 1 : 0; totals.set(w.id, t);
        return { paperId: paper.id, studentId: w.id, marks: marks === null ? null : dec(marks), isAbsent: absent, updatedById: principal.id };
      });
      await prisma.mark.createMany({ data: rows });
    }
    const res = opts.who.map((w) => { const t = totals.get(w.id)!; const percent = (t.o / t.t) * 100; return { w, t, percent }; });
    const rank = (list: typeof res) => { const sorted = [...list].sort((x, y) => y.percent - x.percent); const pos = new Map<string, number>(); sorted.forEach((r, i) => pos.set(r.w.id, i > 0 && sorted[i - 1].percent === r.percent ? pos.get(sorted[i - 1].w.id)! : i + 1)); return pos; };
    const classPos = rank(res);
    const secPos = new Map<string, number>();
    for (const sid of sectionIds) for (const [k, v] of rank(res.filter((r) => r.w.sectionId === sid))) secPos.set(k, v);
    await prisma.studentResult.createMany({
      data: res.map((r) => ({ schoolId, assessmentId: a.id, studentId: r.w.id, sectionId: r.w.sectionId, obtained: dec(r.t.o), total: dec(r.t.t), percent: dec(r.percent), grade: gradeOf(r.percent), passed: r.percent >= 33, positionClass: classPos.get(r.w.id), positionSection: secPos.get(r.w.id), absentPapers: r.t.abs })),
    });
  }

  const year = today.slice(0, 4);
  const firstTermKey = randomUUID().slice(0, 12);
  for (const c of gradedClasses) {
    const who = studentsOfClass(c.id);
    if (!who.length) continue;
    await publish({ kind: 'EXAM', type: 'First term', title: `First term ${year}`, classId: c.id, groupKey: firstTermKey, papers: subjects.map((s, i) => ({ subjectId: s.id, date: `${year}-09-${21 + i}`, total: 100 })), publishedAt: new Date(`${year}-10-03T10:00:00+05:00`), who });
  }
  // November monthly tests (Mathematics and English) for every section — these drive this month's rankings.
  for (const s of gradedSections) {
    const who = allStudents.filter((x) => x.sectionId === s.id);
    if (!who.length) continue;
    await publish({ kind: 'TEST', type: 'Monthly test', title: 'Monthly test – Mathematics', classId: s.classId, sectionId: s.id, papers: [{ subjectId: subj('Mathematics').id, date: `${thisPeriod}-06`, total: 25 }], publishedAt: new Date(`${thisPeriod}-07T12:00:00+05:00`), who });
    await publish({ kind: 'TEST', type: 'Monthly test', title: 'Monthly test – English', classId: s.classId, sectionId: s.id, papers: [{ subjectId: subj('English').id, date: `${thisPeriod}-11`, total: 25 }], publishedAt: new Date(`${thisPeriod}-12T12:00:00+05:00`), who });
  }
  // Second-term date sheet, announced but not yet held.
  const secondKey = randomUUID().slice(0, 12);
  for (const c of gradedClasses) {
    const a = await prisma.assessment.create({ data: { schoolId, kind: 'EXAM', typeId: typeId('Second term'), title: `Second term ${year}`, groupKey: secondKey, sessionId: session?.id, classId: c.id, announced: true, status: 'DRAFT', createdById: principal.id } });
    await prisma.assessmentPaper.createMany({ data: subjects.map((s, i) => ({ assessmentId: a.id, subjectId: s.id, date: day(`${year}-12-${String(7 + i).padStart(2, '0')}`), startTime: '08:30', totalMarks: dec(100), passMarks: dec(33), sortOrder: i })) });
  }
  console.log('exams done');

  // ---- Syllabus ------------------------------------------------------------------------------
  for (const c of gradedClasses) {
    for (const s of subjects) {
      if (await prisma.syllabusItem.count({ where: { schoolId, classId: c.id, subjectId: s.id } })) continue;
      const titles = CHAPTERS[s.name] ?? CHAPTERS.English;
      await prisma.syllabusItem.createMany({ data: titles.map((t, i) => ({ schoolId, classId: c.id, subjectId: s.id, title: `Chapter ${i + 1}: ${t}`, term: i < 5 ? 'First term' : 'Second term', sortOrder: i })) });
    }
  }
  for (const s of gradedSections) {
    const items = await prisma.syllabusItem.findMany({ where: { schoolId, classId: s.classId, parentId: null }, orderBy: { sortOrder: 'asc' } });
    const bySubject = new Map<string, typeof items>();
    for (const it of items) (bySubject.get(it.subjectId) ?? bySubject.set(it.subjectId, []).get(it.subjectId)!).push(it);
    const rows: Prisma.SyllabusProgressCreateManyInput[] = [];
    for (const list of bySubject.values()) {
      const done = Math.round(list.length * (0.45 + rnd() * 0.3));
      list.slice(0, done).forEach((it, i) => rows.push({ schoolId, sectionId: s.id, itemId: it.id, completedOn: addDays(todayD, -(done - i) * 9), completedById: s.classTeacherId ?? principal.id }));
    }
    await prisma.syllabusProgress.createMany({ data: rows, skipDuplicates: true });
  }

  // ---- Admission enquiries -------------------------------------------------------------------
  const maxEnq = (await prisma.enquiry.aggregate({ where: { schoolId }, _max: { enquiryNo: true } }))._max.enquiryNo ?? 0;
  const stages = ['NEW', 'NEW', 'NEW', 'FOLLOW_UP', 'FOLLOW_UP', 'FOLLOW_UP', 'TEST', 'TEST', 'PASSED', 'PASSED', 'WAITLIST', 'ADMITTED', 'ADMITTED', 'ADMITTED', 'LOST'];
  await prisma.enquiry.createMany({
    data: stages.map((stage, i) => {
      const g = rnd() < 0.5 ? 'MALE' : 'FEMALE'; const sur = pick(SURNAMES);
      return { schoolId, enquiryNo: maxEnq + i + 1, childName: `${pick(g === 'MALE' ? BOYS : GIRLS)} ${sur}`, gender: g, classId: pick(classes).id, parentName: `${pick(FATHERS)} ${sur}`, relation: 'Father', phone: '03' + between(0, 4) + String(between(10000000, 99999999)), source: pick(['WALK_IN', 'REFERRAL', 'SOCIAL', 'BANNER', 'WEBSITE']), stage, followUpDate: stage === 'FOLLOW_UP' ? addDays(todayD, between(0, 4)) : null, testAt: stage === 'TEST' ? new Date(`${iso(addDays(todayD, between(1, 5)))}T10:00:00+05:00`) : null, createdById: principal.id, createdAt: addDays(todayD, -between(0, 25)) };
    }),
  });
  counters.enquiry = Math.max(counters.enquiry ?? 0, maxEnq + stages.length);

  // ---- Save counters -------------------------------------------------------------------------
  for (const [key, value] of Object.entries(counters)) {
    await prisma.schoolCounter.upsert({ where: { schoolId_key: { schoolId, key } }, create: { schoolId, key, value }, update: { value } });
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
