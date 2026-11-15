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
