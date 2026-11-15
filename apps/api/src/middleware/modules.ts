import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../lib/errors';
import type { ModuleKey } from '../config/modules';

/** Blocks a feature when the school's plan does not include its module. */
export const requireModule = (key: ModuleKey) => (req: Request, _res: Response, next: NextFunction) => {
  const modules = (req.user?.school?.plan.modules as string[] | undefined) ?? [];
  if (!modules.includes(key)) return next(forbidden('Your plan does not include this feature. Ask the platform admin to upgrade.', 'MODULE_DISABLED'));
  next();
};
