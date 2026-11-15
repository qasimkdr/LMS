import type { Request } from 'express';
import { forbidden } from './errors';
import type { PermissionKey } from '../config/permissions';

/** Principal, or staff holding the permission. */
export function can(req: Request, key: PermissionKey): boolean {
  const u = req.user!;
  return u.role === 'PRINCIPAL' || (u.role === 'STAFF' && u.permissions.includes(key));
}

export function assertCan(req: Request, key: PermissionKey) {
  if (!can(req, key)) throw forbidden();
}

export function assertPrincipal(req: Request) {
  if (req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can do this');
}
