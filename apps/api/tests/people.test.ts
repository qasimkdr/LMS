import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createUser, login, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';

beforeEach(resetDb);

async function setupClasses(principal: Awaited<ReturnType<typeof setupSchool>>['principal']) {
  await principal.post('/api/setup/sessions', { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
  await principal.post('/api/setup/classes', { name: 'Class 5', sortOrder: 50, sections: ['A', 'B'] });
  await principal.post('/api/setup/subjects', { names: ['English', 'Maths', 'Urdu'] });
  const s = (await principal.get('/api/setup/structure')).body;
  const cls = s.classes[0];
  return { s, cls, secA: cls.sections.find((x: { name: string }) => x.name === 'A'), secB: cls.sections.find((x: { name: string }) => x.name === 'B') };
}

const father = { relation: 'FATHER', fullName: 'Raza Ahmed', cnic: '3520212345671', phone: '0300 1234567' };

describe('school setup', () => {
  it('creates sessions, classes with sections, subjects and the preset class list', async () => {
    const { principal } = await setupSchool();
    const { s, cls } = await setupClasses(principal);
    expect(s.sessions[0].isCurrent).toBe(true);
    expect(cls.sections.map((x: { name: string }) => x.name)).toEqual(['A', 'B']);
    expect(s.subjects).toHaveLength(3);

    const preset = await principal.post('/api/setup/classes/presets', { upTo: 'intermediate' });
    // 13 school classes + 10 intermediate groups, minus the existing "Class 5".
    expect(preset.body).toEqual({ created: 22, skipped: 1 });
    const again = await principal.post('/api/setup/classes/presets', { upTo: 'intermediate' });
    expect(again.body.created).toBe(0);
  });

  it('links subjects to a class and assigns class and subject teachers', async () => {
    const { principal, schoolId } = await setupSchool();
    const { s, cls, secA } = await setupClasses(principal);
    const teacher = await createUser({ role: 'TEACHER', username: 't1', schoolId });
    const english = s.subjects.find((x: { name: string }) => x.name === 'English');
    expect((await principal.put(`/api/setup/classes/${cls.id}/subjects`, { subjects: [{ subjectId: english.id }] })).status).toBe(200);

    expect((await principal.patch(`/api/setup/sections/${secA.id}`, { classTeacherId: teacher.id })).status).toBe(200);
    const maths = s.subjects.find((x: { name: string }) => x.name === 'Maths');
    const bad = await principal.put('/api/setup/assignments', { sectionId: secA.id, subjectId: maths.id, teacherId: teacher.id });
    expect(bad.status).toBe(400); // Maths is not taught in Class 5
    expect((await principal.put('/api/setup/assignments', { sectionId: secA.id, subjectId: english.id, teacherId: teacher.id })).status).toBe(200);

    const t = await login('t1');
    const my = await t.get('/api/my/overview');
    expect(my.body.classTeacherOf).toHaveLength(1);
    expect(my.body.teaching[0].subject.name).toBe('English');
  });

  it('only the principal can change setup; campuses respect the plan limit', async () => {
    const { principal, schoolId } = await setupSchool();
    await createUser({ role: 'STAFF', username: 'clerk', schoolId, permissions: ['students.manage'] });
    const clerk = await login('clerk');
    expect((await clerk.post('/api/setup/classes', { name: 'Class 1' })).status).toBe(403);
    // Plan in helpers allows 1 campus and the main campus exists.
    const c = await principal.post('/api/setup/campuses', { name: 'Branch 2' });
    expect(c.status).toBe(403);
    expect(c.body.error.code).toBe('PLAN_LIMIT');
  });
});

describe('students', () => {
  it('enrolls a student with family, guardians and logins; siblings share the family and parent login', async () => {
    const { principal } = await setupSchool();
    const { cls, secA } = await setupClasses(principal);
    const res = await principal.post('/api/students', {
      student: { fullName: 'Ali Raza', gender: 'MALE', dob: '2016-03-15', classId: cls.id, sectionId: secA.id, rollNo: '1', bForm: '35202-1234567-1' },
      guardians: [father, { relation: 'MOTHER', fullName: 'Sana Raza', phone: '03011234567' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.admissionNo).toMatch(/^\d{4}0001$/);
    expect(res.body.logins.map((l: { role: string }) => l.role).sort()).toEqual(['PARENT', 'STUDENT']);
    const parentLogin = res.body.logins.find((l: { role: string }) => l.role === 'PARENT');
    expect(parentLogin.username).toBe('alpha.p0001');

    const guardian = await prisma.guardian.findFirst({ where: { relation: 'FATHER' } });
    expect(guardian?.cnic).toBe('35202-1234567-1');
    expect(guardian?.phone).toBe('03001234567');
    expect(guardian?.receivesMessages).toBe(true);

    const lookup = await principal.get('/api/students/sibling-lookup?cnic=35202-1234567-1');
    expect(lookup.body.families).toHaveLength(1);
    const sib = await principal.post('/api/students', {
      student: { fullName: 'Hira Raza', gender: 'FEMALE', dob: '2018-01-02', classId: cls.id, sectionId: secA.id },
      familyId: lookup.body.families[0].id,
    });
    expect(sib.status).toBe(201);
    expect(sib.body.admissionNo).toMatch(/0002$/);
    expect(sib.body.logins.map((l: { role: string }) => l.role)).toEqual(['STUDENT']);

    // Parent sees both children.
    const parent = await login(parentLogin.username, parentLogin.tempPassword);
    await parent.post('/api/auth/change-password', { currentPassword: parentLogin.tempPassword, newPassword: 'Parent1234' });
    const kids = await parent.get('/api/my/overview');
    expect(kids.body.children.map((c: { fullName: string }) => c.fullName).sort()).toEqual(['Ali Raza', 'Hira Raza']);
  });

  it('enforces required fields chosen by the principal', async () => {
    const { principal } = await setupSchool();
    const { cls } = await setupClasses(principal);
    await principal.put('/api/setup/required-fields', { fields: ['bForm', 'fatherCnic'] });
    const res = await principal.post('/api/students', {
      student: { fullName: 'No Bform', gender: 'MALE', classId: cls.id },
      guardians: [{ relation: 'FATHER', fullName: 'Dad' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/B-Form.*Father's CNIC/);
  });

  it('validates CNIC format and section/class mismatch', async () => {
    const { principal } = await setupSchool();
    const { cls } = await setupClasses(principal);
    await principal.post('/api/setup/classes', { name: 'Class 6', sections: ['A'] });
    const s = (await principal.get('/api/setup/structure')).body;
    const other = s.classes.find((c: { name: string }) => c.name === 'Class 6').sections[0];
    const badCnic = await principal.post('/api/students', { student: { fullName: 'X Y', gender: 'MALE', classId: cls.id, dob: '2015-01-01' }, guardians: [{ ...father, cnic: '123' }] });
    expect(badCnic.status).toBe(400);
    const mismatch = await principal.post('/api/students', { student: { fullName: 'X Y', gender: 'MALE', classId: cls.id, sectionId: other.id, dob: '2015-01-01' }, guardians: [father] });
    expect(mismatch.status).toBe(400);
  });

  it('respects the plan student limit', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls } = await setupClasses(principal);
    await prisma.school.update({ where: { id: schoolId }, data: { customMaxStudents: 1 } });
    const body = (n: string) => ({ student: { fullName: n, gender: 'MALE', classId: cls.id, dob: '2015-01-01' }, guardians: [father] });
    expect((await principal.post('/api/students', body('One One'))).status).toBe(201);
    const second = await principal.post('/api/students', body('Two Two'));
    expect(second.status).toBe(403);
    expect(second.body.error.code).toBe('PLAN_LIMIT');
  });

  it('status change deactivates logins; delete goes to the recycle bin and can be restored', async () => {
    const { principal } = await setupSchool();
    const { cls } = await setupClasses(principal);
    const r = await principal.post('/api/students', { student: { fullName: 'Ali Raza', gender: 'MALE', classId: cls.id, dob: '2015-01-01' }, guardians: [father] });
    const id = r.body.studentId;
    const studentUser = r.body.logins.find((l: { role: string }) => l.role === 'STUDENT');

    await principal.post(`/api/students/${id}/status`, { status: 'LEFT', reason: 'Moved city' });
    const u = await prisma.user.findUniqueOrThrow({ where: { username: studentUser.username } });
    expect(u.isActive).toBe(false);
    const parent = await prisma.family.findFirstOrThrow({ include: { parentUser: true } });
    expect(parent.parentUser?.isActive).toBe(false);

    await principal.post(`/api/students/${id}/status`, { status: 'ACTIVE' });
    expect((await prisma.user.findUniqueOrThrow({ where: { username: studentUser.username } })).isActive).toBe(true);

    await principal.del(`/api/students/${id}`, { reason: 'duplicate' });
    expect((await principal.get('/api/students')).body.total).toBe(0);
    const bin = await principal.get('/api/recycle-bin');
    expect(bin.body.students).toHaveLength(1);
    expect((await principal.post(`/api/students/${id}/restore`)).status).toBe(200);
    expect((await principal.get('/api/students')).body.total).toBe(1);
  });

  it('principal edits are audited with before and after values', async () => {
    const { principal } = await setupSchool();
    const { cls, secA, secB } = await setupClasses(principal);
    const r = await principal.post('/api/students', { student: { fullName: 'Ali Raza', gender: 'MALE', classId: cls.id, sectionId: secA.id, dob: '2015-01-01' }, guardians: [father] });
    const upd = await principal.patch(`/api/students/${r.body.studentId}`, { sectionId: secB.id, reason: 'Section change' });
    expect(upd.status).toBe(200);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'student.update' } });
    expect(log.reason).toBe('Section change');
    expect((log.before as { sectionId: string }).sectionId).toBe(secA.id);
  });

  it('teachers only see students of their own sections, without documents or logins', async () => {
    const { principal, schoolId } = await setupSchool();
    const { cls, secA, secB } = await setupClasses(principal);
    const teacher = await createUser({ role: 'TEACHER', username: 't1', schoolId });
    await principal.patch(`/api/setup/sections/${secA.id}`, { classTeacherId: teacher.id });
    const a = await principal.post('/api/students', { student: { fullName: 'In A', gender: 'MALE', classId: cls.id, sectionId: secA.id, dob: '2015-01-01' }, guardians: [father] });
    const b = await principal.post('/api/students', { student: { fullName: 'In B', gender: 'MALE', classId: cls.id, sectionId: secB.id, dob: '2015-01-01' }, guardians: [{ ...father, cnic: '35202-0000000-1', phone: '03009999999' }] });
    const t = await login('t1');
    const list = await t.get('/api/students');
    expect(list.body.students.map((s: { fullName: string }) => s.fullName)).toEqual(['In A']);
    expect((await t.get(`/api/students/${b.body.studentId}`)).status).toBe(404);
    const detail = await t.get(`/api/students/${a.body.studentId}`);
    expect(detail.body.student.user).toBeNull();
    expect((await t.post('/api/students', { student: { fullName: 'X Y', gender: 'MALE', classId: cls.id }, guardians: [father] })).status).toBe(403);
  });

  it('student documents are hidden from teachers and other schools', async () => {
    const a = await setupSchool('alpha');
    const { cls } = await setupClasses(a.principal);
    const st = await a.principal.post('/api/students', { student: { fullName: 'Ali Raza', gender: 'MALE', classId: cls.id, dob: '2015-01-01' }, guardians: [father] });
    const up = await a.principal.upload('/api/files', { category: 'STUDENT_DOCUMENT' }, { name: 'bform.pdf', content: Buffer.from('%PDF-1.4'), type: 'application/pdf' });
    expect((await a.principal.post(`/api/students/${st.body.studentId}/documents`, { fileId: up.body.file.id, docType: 'B_FORM' })).status).toBe(201);
    const detail = await a.principal.get(`/api/students/${st.body.studentId}`);
    expect(detail.body.student.documents).toHaveLength(1);
    expect(detail.body.missingDocuments.map((d: { type: string }) => d.type)).not.toContain('B_FORM');

    await createUser({ role: 'TEACHER', username: 'tt', schoolId: a.schoolId });
    expect((await (await login('tt')).get(`/api/files/${up.body.file.id}/download`)).status).toBe(404);
    const b = await setupSchool('beta');
    expect((await b.principal.get(`/api/students/${st.body.studentId}`)).status).toBe(404);
  });
});

describe('staff', () => {
  it('creates teachers and staff with permissions, and the principal can reset passwords', async () => {
    const { principal } = await setupSchool();
    const t = await principal.post('/api/staff', { fullName: 'Fatima Noor', role: 'TEACHER', profile: { designation: 'Teacher', salary: 45000, cnic: '3520211122234' } });
    expect(t.status).toBe(201);
    expect(t.body.username).toBe('alpha.e001');
    const s = await principal.post('/api/staff', { fullName: 'Office Clerk', role: 'STAFF', username: 'clerk', permissions: ['students.view', 'fees.collect'] });
    expect(s.status).toBe(201);

    const reset = await principal.post(`/api/users/${s.body.userId}/reset-password`);
    expect(reset.status).toBe(200);
    const clerk = await login('clerk', reset.body.tempPassword);
    await clerk.post('/api/auth/change-password', { currentPassword: reset.body.tempPassword, newPassword: 'Clerk12345' });
    expect((await clerk.get('/api/students')).status).toBe(200);
    expect((await clerk.get('/api/staff')).status).toBe(403);
    // Staff can't see salary even with view permission; principal can.
    const detail = await principal.get(`/api/staff/${t.body.userId}`);
    expect(detail.body.staff.staffProfile.salary).toBe(45000);
  });

  it('respects the plan staff limit (5 in the test plan)', async () => {
    const { principal } = await setupSchool();
    for (let i = 0; i < 5; i++) expect((await principal.post('/api/staff', { fullName: `Teacher ${i}`, role: 'TEACHER' })).status).toBe(201);
    const over = await principal.post('/api/staff', { fullName: 'Teacher 6', role: 'TEACHER' });
    expect(over.body.error.code).toBe('PLAN_LIMIT');
  });

  it('cannot reset a principal password or accounts in other schools', async () => {
    const a = await setupSchool('alpha');
    const b = await setupSchool('beta');
    const pa = await prisma.user.findFirstOrThrow({ where: { username: 'principal-alpha' } });
    const t = await b.principal.post('/api/staff', { fullName: 'Beta Teacher', role: 'TEACHER' });
    expect((await a.principal.post(`/api/users/${t.body.userId}/reset-password`)).status).toBe(404);
    await createUser({ role: 'STAFF', username: 'clerk', schoolId: a.schoolId, permissions: ['students.manage'] });
    const clerk = await login('clerk');
    expect((await clerk.post(`/api/users/${pa.id}/reset-password`)).status).toBe(403);
  });
});

describe('search and import', () => {
  it('finds students by name, admission no and father phone', async () => {
    const { principal } = await setupSchool();
    const { cls } = await setupClasses(principal);
    const r = await principal.post('/api/students', { student: { fullName: 'Ali Raza', gender: 'MALE', classId: cls.id, dob: '2015-01-01' }, guardians: [father] });
    for (const q of ['Ali', r.body.admissionNo, '0300-1234567', 'Raza Ahmed']) {
      const res = await principal.get(`/api/search?q=${encodeURIComponent(q)}`);
      expect(res.body.students.length, q).toBe(1);
    }
  });

  it('imports students from Excel with sibling grouping, preview first, then commit', async () => {
    const { principal } = await setupSchool();
    await setupClasses(principal);
    const tpl = await principal.get('/api/import/students/template').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(tpl.status).toBe(200);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    const ws = wb.worksheets[0];
    ws.spliceRows(2, 1); // remove example row
    const header = (ws.getRow(1).values as string[]).slice(1);
    const row = (o: Record<string, string>) => header.map((h) => o[h.replace('*', '')] ?? '');
    ws.addRow(row({ 'Student name': 'Ayan Khan', Gender: 'Male', Class: 'Class 5', Section: 'A', 'Date of birth': '12/05/2016', 'Father name': 'Imran Khan', 'Father CNIC': '35202-5555555-1', 'Father mobile': '03005555555' }));
    ws.addRow(row({ 'Student name': 'Zoya Khan', Gender: 'F', Class: 'class 5', Section: 'b', 'Date of birth': '2018-02-01', 'Father name': 'Imran Khan', 'Father CNIC': '35202-5555555-1', 'Father mobile': '03005555555' }));
    ws.addRow(row({ 'Student name': 'Bad Row', Gender: 'x', Class: 'Class 9', 'Date of birth': '31/02/2016', 'Father name': 'Someone', 'Father mobile': '03001231231' }));
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const f = { name: 'students.xlsx', content: file, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

    const preview = await principal.upload('/api/import/students', {}, f);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ total: 3, valid: 2, invalid: 1 });
    const bad = preview.body.results.find((r: { name: string }) => r.name === 'Bad Row');
    expect(bad.errors.join(' ')).toMatch(/Unknown class/);
    expect(bad.errors.join(' ')).toMatch(/Gender/);
    expect(bad.errors.join(' ')).toMatch(/Date of birth/);

    const blocked = await principal.upload('/api/import/students?commit=true', {}, f);
    expect(blocked.status).toBe(400);
    const done = await principal.upload('/api/import/students?commit=true&skipInvalid=true', {}, f);
    expect(done.status).toBe(200);
    expect(done.body.created).toHaveLength(2);
    const families = await prisma.family.findMany({ include: { students: true } });
    expect(families).toHaveLength(1);
    expect(families[0].students).toHaveLength(2);
    // One parent login for the two siblings.
    expect(done.body.created.flatMap((c: { logins: { role: string }[] }) => c.logins).filter((l: { role: string }) => l.role === 'PARENT')).toHaveLength(1);
  });

  it('imports staff from CSV', async () => {
    const { principal } = await setupSchool();
    const csv = 'Full name*,Role*,Username,Mobile,Joining date,Salary\nFatima Noor,Teacher,,03001112233,01/08/2024,"45,000"\nAhmed Ali,Accountant,ahmed.acc,03002223344,,\n';
    const f = { name: 'staff.csv', content: Buffer.from(csv), type: 'text/csv' };
    const preview = await principal.upload('/api/import/staff', {}, f);
    expect(preview.body).toMatchObject({ total: 2, valid: 2, invalid: 0 });
    const done = await principal.upload('/api/import/staff?commit=true', {}, f);
    expect(done.body.created.map((c: { username: string }) => c.username)).toEqual(['alpha.e001', 'ahmed.acc']);
    const p = await prisma.staffProfile.findFirstOrThrow({ where: { employeeNo: 'E001' } });
    expect(Number(p.salary)).toBe(45000);
  });
});
