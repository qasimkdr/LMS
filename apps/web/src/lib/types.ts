export type Role = 'SUPER_ADMIN' | 'PRINCIPAL' | 'STAFF' | 'TEACHER' | 'STUDENT' | 'PARENT';
export type SchoolStatus = 'TRIAL' | 'ACTIVE' | 'READ_ONLY' | 'SUSPENDED';

export interface Me {
  user: { id: string; role: Role; username: string; fullName: string; mustChangePassword: boolean; permissions: string[] };
  school: {
    id: string;
    name: string;
    code: string;
    status: SchoolStatus;
    effectiveStatus: SchoolStatus;
    trialEndsAt: string | null;
    logoFileId: string | null;
    currency: string;
    timezone: string;
    plan: { id: string; name: string; modules: string[] };
  } | null;
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  includedStudents: number;
  perStudentPrice: number;
  maxStudents: number | null;
  maxStaff: number | null;
  maxCampuses: number;
  storageLimitMb: number;
  maxFileSizeMb: number;
  modules: string[];
  isActive: boolean;
  schoolCount: number;
}

export interface Usage {
  storage: { usedBytes: number; limitBytes: number; percent: number; level: 'ok' | 'warning' | 'critical' | 'full' };
  maxFileBytes: number;
  students: { used: number; limit: number | null; percent: number | null };
  staff: { used: number; limit: number | null; percent: number | null };
  campuses: { used: number; limit: number };
  modules: string[];
}

export interface Invoice {
  id: string;
  schoolId: string;
  period: string;
  planName: string;
  basePrice: number;
  includedStudents: number;
  activeStudents: number;
  extraStudents: number;
  perStudentPrice: number;
  amount: number;
  status: 'UNPAID' | 'PAID' | 'VOID';
  dueDate: string;
  paidAmount: number | null;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  notes: string | null;
  overdue: boolean;
  school?: { id: string; name: string; code: string };
}

export interface StoredFile {
  id: string;
  category: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedById: string;
}

// ---------- Step 2 ----------

export interface Section {
  id: string;
  name: string;
  campusId: string | null;
  capacity: number | null;
  room: string | null;
  classTeacher: { id: string; fullName: string } | null;
  studentCount: number;
}

export interface ClassLevel {
  id: string;
  name: string;
  stream: string | null;
  sortOrder: number;
  studentCount: number;
  subjects: { id: string; name: string; code: string | null; isOptional: boolean }[];
  sections: Section[];
}

export interface Structure {
  sessions: { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean }[];
  classes: ClassLevel[];
  subjects: { id: string; name: string; code: string | null }[];
  campuses: { id: string; name: string; address: string | null; isMain: boolean }[];
  teachers: { id: string; fullName: string }[];
}

export interface Guardian {
  id?: string;
  relation: 'FATHER' | 'MOTHER' | 'GUARDIAN';
  relationDetail?: string | null;
  fullName: string;
  cnic?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  occupation?: string | null;
  organization?: string | null;
  education?: string | null;
  monthlyIncome?: number | null;
  officeAddress?: string | null;
  address?: string | null;
  isDeceased?: boolean;
  receivesMessages?: boolean;
}

export interface StudentListItem {
  id: string;
  admissionNo: string;
  rollNo: string | null;
  fullName: string;
  gender: string;
  dob: string | null;
  status: string;
  photoFileId: string | null;
  admissionDate: string;
  class: { id: string; name: string; stream: string | null };
  section: { id: string; name: string } | null;
  family: { id: string; familyNo: string; guardians: Guardian[] };
}

export const className = (c: { name: string; stream?: string | null } | null | undefined, s?: { name: string } | null) =>
  c ? `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` – ${s.name}` : ''}` : '—';

// ---------- Step 3: timetable ----------

export interface TTEntry {
  id: string;
  subject: { id: string; name: string } | null;
  teacher: { id: string; fullName: string } | null;
  section: { id: string; name: string; class: { id: string; name: string; stream: string | null } };
  room: string | null;
  note: string | null;
}
export interface TTPeriod {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  entries: TTEntry[];
}
export interface TTDay {
  day: number;
  dayName: string;
  scheduleName: string | null;
  periods: TTPeriod[];
}
