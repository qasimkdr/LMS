import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { prepareSecrets } from '../lib/password';
import {
  checkRequiredFields,
  createStudent,
  createStudentSchema,
  findFamilies,
  type CreateStudentInput,
  type GuardianInput,
  type NewLogin,
} from './students';
import { createStaff, staffSchema } from '../routes/staff';

// ---------- Reading spreadsheets ----------

export type Row = Record<string, string>;

const norm = (h: string) => h.toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Excel dates come as UTC midnight.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('hyperlink' in v) return String((v as { text?: string }).text ?? '').trim();
    return '';
  }
  return String(v).trim();
}

/** Reads the first sheet of an .xlsx or .csv file into rows keyed by normalized header. */
export async function readSheet(buffer: Buffer, filename: string): Promise<{ rows: { line: number; data: Row }[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(filename)) await wb.csv.read(Readable.from(buffer.toString('utf8').replace(/^﻿/, '')));
    else await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest('Could not read the file. Upload an Excel (.xlsx) or CSV file made from the template.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('The file has no sheets');
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (headers[col] = norm(cellText(cell.value))));
  const rows: { line: number; data: Row }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, line) => {
    if (line === 1) return;
    const data: Row = {};
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (headers[col]) data[headers[col]] = cellText(cell.value);
    });
    if (Object.values(data).some((v) => v !== '')) rows.push({ line, data });
  });
  if (rows.length > 2000) throw badRequest('Import at most 2000 rows at a time');
  return { rows };
}

/** Accepts 2015-03-15, 15/03/2015, 15-03-2015. */
export function parseDate(v: string): Date | null | 'invalid' {
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return d.getUTCDate() === +m[1] ? d : 'invalid';
  }
  return 'invalid';
}

// ---------- Templates ----------

export const STUDENT_COLUMNS = [
  'Student name*', 'Gender*', 'Class*', 'Section', 'Roll no', 'Admission no', 'Admission date', 'Date of birth', 'B-Form', 'Blood group',
  'Religion', 'Address', 'City', 'Father name', 'Father CNIC', 'Father mobile', 'Father WhatsApp', 'Father occupation', 'Mother name',
  'Mother mobile', 'Guardian name', 'Guardian relation', 'Guardian mobile', 'Previous school', 'Notes',
];

export const STAFF_COLUMNS = ['Full name*', 'Role*', 'Username', 'Mobile', 'Email', 'CNIC', 'Designation', 'Qualification', 'Joining date', 'Gender', 'Salary', 'Employee no'];

export async function buildTemplate(kind: 'students' | 'staff', classes: { name: string; stream: string | null; sections: string[] }[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === 'students' ? 'Students' : 'Staff');
  const cols = kind === 'students' ? STUDENT_COLUMNS : STAFF_COLUMNS;
  ws.addRow(cols);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 18));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (kind === 'students') {
    const first = classes[0];
    ws.addRow([
      'Ali Raza', 'Male', first ? [first.name, first.stream].filter(Boolean).join(' ') : 'Class 1', first?.sections[0] ?? 'A', '1', '', '01/04/2026', '15/03/2018',
      '35202-1234567-1', 'B+', 'Islam', 'House 12, Street 4', 'Lahore', 'Raza Ahmed', '35202-7654321-3', '03001234567', '03001234567', 'Business',
      'Sana Raza', '03011234567', '', '', '', '', 'Example row: delete before importing',
    ]);
    const ref = wb.addWorksheet('Classes (reference)');
    ref.addRow(['Write the class exactly like this', 'Sections']);
    ref.getRow(1).font = { bold: true };
    for (const c of classes) ref.addRow([[c.name, c.stream].filter(Boolean).join(' '), c.sections.join(', ')]);
    ref.columns.forEach((c) => (c.width = 32));
    const help = wb.addWorksheet('Help');
    for (const line of [
      'Columns with * are required. Gender: Male or Female.',
      'Dates: DD/MM/YYYY (15/03/2018) or YYYY-MM-DD.',
      'Admission no: leave empty to number students automatically.',
      'Brothers and sisters: give them the same Father CNIC (or Father mobile) and they are linked as one family with one parent login.',
      'If the father is already in the school, new children are added to the existing family.',
    ]) help.addRow([line]);
    help.getColumn(1).width = 110;
  } else {
    ws.addRow(['Fatima Noor', 'Teacher', '', '03001112233', '', '35202-1112223-4', 'Senior Teacher', 'M.Sc Mathematics', '01/08/2024', 'Female', '45000', '']);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- Student import ----------

export interface RowResult {
  line: number;
  name: string;
  className: string;
  errors: string[];
  family: string;
}

interface PreparedStudent {
  line: number;
  input: CreateStudentInput;
  familyKey: string;
  existingFamilyId: string | null;
  label: string;
}

export async function prepareStudentImport(schoolId: string, rows: { line: number; data: Row }[], required: string[]) {
  const classes = await prisma.classLevel.findMany({ where: { schoolId, deletedAt: null }, include: { sections: { where: { deletedAt: null } } } });
  const classByName = new Map<string, (typeof classes)[number]>();
  for (const c of classes) {
    classByName.set(norm([c.name, c.stream].filter(Boolean).join(' ')), c);
    if (!c.stream) classByName.set(norm(c.name), c);
  }
  const usedAdmission = new Set(
    (await prisma.student.findMany({ where: { schoolId }, select: { admissionNo: true } })).map((s) => s.admissionNo.toLowerCase()),
  );
  const seenAdmission = new Set<string>();
  const prepared: PreparedStudent[] = [];
  const results: RowResult[] = [];
  const familyCache = new Map<string, { id: string; familyNo: string } | null>();
  const requiredForImport = required.filter((r) => r !== 'photo');

  for (const { line, data: r } of rows) {
    const errors: string[] = [];
    const get = (k: string) => r[norm(k)] ?? '';
    const name = get('Student name');
    const cls = classByName.get(norm(get('Class')));
    if (!get('Class')) errors.push('Class is required');
    else if (!cls) errors.push(`Unknown class "${get('Class')}"`);
    let sectionId: string | null = null;
    if (get('Section') && cls) {
      const sec = cls.sections.find((s) => s.name.toLowerCase() === get('Section').toLowerCase());
      if (!sec) errors.push(`Class ${cls.name} has no section "${get('Section')}"`);
      else sectionId = sec.id;
    } else if (cls && cls.sections.length === 1) sectionId = cls.sections[0].id;

    const genderRaw = get('Gender').toLowerCase();
    const gender = ['m', 'male', 'boy'].includes(genderRaw) ? 'MALE' : ['f', 'female', 'girl'].includes(genderRaw) ? 'FEMALE' : null;
    if (!gender) errors.push('Gender must be Male or Female');

    const dob = parseDate(get('Date of birth'));
    if (dob === 'invalid') errors.push('Date of birth: use DD/MM/YYYY');
    const admissionDate = parseDate(get('Admission date'));
    if (admissionDate === 'invalid') errors.push('Admission date: use DD/MM/YYYY');

    const admissionNo = get('Admission no');
    if (admissionNo) {
      const k = admissionNo.toLowerCase();
      if (usedAdmission.has(k)) errors.push(`Admission no ${admissionNo} already exists`);
      if (seenAdmission.has(k)) errors.push(`Admission no ${admissionNo} repeats in this file`);
      seenAdmission.add(k);
    }

    const guardians: GuardianInput[] = [];
    const g = (relation: GuardianInput['relation'], fullName: string, extra: Partial<GuardianInput>) =>
      fullName && guardians.push({ relation, fullName, isDeceased: false, receivesMessages: false, ...extra } as GuardianInput);
    g('FATHER', get('Father name'), { cnic: get('Father CNIC'), phone: get('Father mobile'), whatsapp: get('Father WhatsApp') || get('Father mobile'), occupation: get('Father occupation') } as Partial<GuardianInput>);
    g('MOTHER', get('Mother name'), { phone: get('Mother mobile') } as Partial<GuardianInput>);
    g('GUARDIAN', get('Guardian name'), { relationDetail: get('Guardian relation'), phone: get('Guardian mobile'), whatsapp: get('Guardian mobile') } as Partial<GuardianInput>);

    const raw = {
      student: {
        fullName: name,
        gender: gender ?? 'MALE',
        dob: dob instanceof Date ? dob : null,
        bForm: get('B-Form'),
        bloodGroup: get('Blood group').toUpperCase().replace(/\s/g, ''),
        religion: get('Religion'),
        currentAddress: get('Address'),
        city: get('City'),
        notes: get('Notes'),
        admissionNo,
        admissionDate: admissionDate instanceof Date ? admissionDate : new Date(),
        admissionType: get('Previous school') ? 'TRANSFER' : 'NEW',
        previousSchool: get('Previous school') ? { schoolName: get('Previous school') } : null,
        classId: cls?.id ?? 'missing',
        sectionId,
        rollNo: get('Roll no'),
      },
      guardians,
    };
    const parsed = createStudentSchema.safeParse(raw);
    let input: CreateStudentInput | null = null;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path.slice(-1)[0];
        const where = issue.path[0] === 'guardians' ? `${guardians[Number(issue.path[1])]?.relation.toLowerCase()} ${String(field)}` : String(field);
        if (field !== 'classId' && field !== 'gender') errors.push(`${where}: ${issue.message}`);
      }
    } else input = parsed.data;

    // Family: same father CNIC, else same father/guardian mobile, groups siblings.
    const father = input?.guardians.find((x) => x.relation === 'FATHER');
    const contact = input?.guardians.find((x) => x.phone)?.phone ?? null;
    const familyKey = father?.cnic ? `cnic:${father.cnic}` : contact ? `phone:${contact}` : `row:${line}`;
    let existing = familyCache.get(familyKey);
    if (existing === undefined && !familyKey.startsWith('row:')) {
      const found = await findFamilies(schoolId, father?.cnic ? { cnic: father.cnic } : { phone: contact });
      existing = found[0] ? { id: found[0].id, familyNo: found[0].familyNo } : null;
      familyCache.set(familyKey, existing);
    }
    if (!existing && input && guardians.length === 0) errors.push('Add the father, mother or guardian name');
    if (input && errors.length === 0) {
      try {
        checkRequiredFields(requiredForImport, input.student, input.guardians, Boolean(existing));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    const label = existing ? `Existing family ${existing.familyNo}` : familyKey.startsWith('row:') ? 'New family' : `New family (${familyKey.split(':')[1]})`;
    results.push({ line, name: name || '(no name)', className: cls ? [cls.name, cls.stream].filter(Boolean).join(' ') : get('Class'), errors, family: label });
    if (input && errors.length === 0) prepared.push({ line, input, familyKey, existingFamilyId: existing?.id ?? null, label });
  }
  return { results, prepared };
}

export async function commitStudentImport(school: { id: string; code: string }, prepared: PreparedStudent[]) {
  // Hash all temporary passwords first, in parallel; each student needs at most two logins.
  const secrets = await prepareSecrets(prepared.length * 2);
  const familyIds = new Map<string, string>();
  const created: { line: number; studentId: string; admissionNo: string; fullName: string; familyNo: string; logins: NewLogin[] }[] = [];
  for (const p of prepared) {
    const familyId = p.existingFamilyId ?? familyIds.get(p.familyKey) ?? null;
    const input = { ...p.input, familyId };
    const r = await prisma.$transaction((tx) => createStudent(tx, school, input, secrets), { timeout: 20000 });
    if (!familyId && !p.familyKey.startsWith('row:')) familyIds.set(p.familyKey, r.familyId);
    created.push({ line: p.line, studentId: r.studentId, admissionNo: r.admissionNo, fullName: p.input.student.fullName, familyNo: r.familyNo, logins: r.logins });
  }
  return created;
}

// ---------- Staff import ----------

export async function prepareStaffImport(schoolId: string, rows: { line: number; data: Row }[]) {
  const results: RowResult[] = [];
  const prepared: { line: number; input: ReturnType<typeof staffSchema.parse> }[] = [];
  const seenUsernames = new Set<string>();
  for (const { line, data: r } of rows) {
    const get = (k: string) => r[norm(k)] ?? '';
    const errors: string[] = [];
    const roleRaw = get('Role').toLowerCase();
    const role = roleRaw.startsWith('teach') ? 'TEACHER' : ['staff', 'office', 'accountant', 'clerk'].some((x) => roleRaw.startsWith(x)) ? 'STAFF' : null;
    if (!role) errors.push('Role must be Teacher or Staff');
    const joining = parseDate(get('Joining date'));
    if (joining === 'invalid') errors.push('Joining date: use DD/MM/YYYY');
    const genderRaw = get('Gender').toLowerCase();
    const username = get('Username').toLowerCase();
    if (username) {
      if (seenUsernames.has(username)) errors.push('Username repeats in this file');
      else if (await prisma.user.findUnique({ where: { username } })) errors.push(`Username ${username} is taken`);
      seenUsernames.add(username);
    }
    const parsed = staffSchema.safeParse({
      fullName: get('Full name'),
      role: role ?? 'TEACHER',
      username: username || undefined,
      phone: get('Mobile'),
      email: get('Email'),
      profile: {
        employeeNo: get('Employee no'),
        cnic: get('CNIC'),
        designation: get('Designation'),
        qualification: get('Qualification'),
        joiningDate: joining instanceof Date ? joining : null,
        gender: genderRaw.startsWith('m') ? 'MALE' : genderRaw.startsWith('f') ? 'FEMALE' : null,
        salary: get('Salary') ? Number(get('Salary').replace(/,/g, '')) : null,
      },
    });
    if (!parsed.success) for (const i of parsed.error.issues) errors.push(`${String(i.path.slice(-1)[0])}: ${i.message}`);
    if (parsed.success && parsed.data.profile.employeeNo) {
      const dup = await prisma.staffProfile.findUnique({ where: { schoolId_employeeNo: { schoolId, employeeNo: parsed.data.profile.employeeNo } } });
      if (dup) errors.push(`Employee no ${parsed.data.profile.employeeNo} already exists`);
    }
    results.push({ line, name: get('Full name') || '(no name)', className: role === 'TEACHER' ? 'Teacher' : role === 'STAFF' ? 'Staff' : get('Role'), errors, family: '' });
    if (parsed.success && errors.length === 0) prepared.push({ line, input: parsed.data });
  }
  return { results, prepared };
}

export async function commitStaffImport(school: { id: string; code: string }, prepared: { line: number; input: ReturnType<typeof staffSchema.parse> }[]) {
  const secrets = await prepareSecrets(prepared.length);
  const created = [];
  for (const p of prepared) {
    const r = await prisma.$transaction((tx) => createStaff(tx, school, p.input, secrets.pop()));
    created.push({ line: p.line, fullName: p.input.fullName, role: p.input.role, ...r });
  }
  return created;
}
