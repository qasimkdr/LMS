import type { Plan, Role, School, SchoolStatus } from '@prisma/client';

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      role: Role;
      schoolId: string | null;
      username: string;
      fullName: string;
      mustChangePassword: boolean;
      permissions: string[];
      school: (School & { plan: Plan; effectiveStatus: SchoolStatus }) | null;
    }
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
