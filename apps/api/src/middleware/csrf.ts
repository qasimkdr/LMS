import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../lib/errors';

/**
 * State-changing requests must carry `X-Requested-With: fetch`.
 * Browsers cannot add custom headers to cross-site requests without a CORS preflight,
 * and the API allows no cross-origin requests, so this blocks CSRF.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'fetch') return next(forbidden('Missing request header', 'CSRF'));
  next();
}
