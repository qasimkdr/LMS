import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest } from '../lib/errors';
import { assertCan } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { assertStudentCapacity } from '../services/students';
import { assertStaffCapacity } from './staff';
import { requiredFieldsOf } from './setup';
import {
  buildTemplate,
  commitStaffImport,
  commitStudentImport,
  prepareStaffImport,
  prepareStudentImport,
  readSheet,
} from '../services/importer';

/** Bulk import from Excel/CSV: download template, preview (validation only), then commit. */
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const kindSchema = z.object({ kind: z.enum(['students', 'staff']) });

router.get(
  '/:kind/template',
  ah(async (req, res) => {
    const { kind } = parse(kindSchema, req.params);
    assertCan(req, kind === 'students' ? 'students.manage' : 'staff.manage');
    const classes = await prisma.classLevel.findMany({
      where: { schoolId: tenantId(req), deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { sections: { where: { deletedAt: null }, orderBy: { name: 'asc' } } },
    });
    const buf = await buildTemplate(kind, classes.map((c) => ({ name: c.name, stream: c.stream, sections: c.sections.map((s) => s.name) })));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-import-template.xlsx"`);
    res.send(buf);
  }),
);

router.post(
  '/:kind',
  upload.single('file'),
  ah(async (req, res) => {
    const { kind } = parse(kindSchema, req.params);
    assertCan(req, kind === 'students' ? 'students.manage' : 'staff.manage');
    const opts = parse(z.object({ commit: z.enum(['true', 'false']).default('false'), skipInvalid: z.enum(['true', 'false']).default('false') }), req.query);
    if (!req.file) throw badRequest('Choose a file to import');
    const schoolId = tenantId(req);
    const school = req.user!.school!;
    const { rows } = await readSheet(req.file.buffer, req.file.originalname);
    if (rows.length === 0) throw badRequest('The file has no rows under the header');

    const { results, prepared } =
      kind === 'students'
        ? await prepareStudentImport(schoolId, rows, requiredFieldsOf((await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).settings))
        : await prepareStaffImport(schoolId, rows);
    const invalid = results.filter((r) => r.errors.length).length;
    const summary = { total: results.length, valid: prepared.length, invalid };

    if (opts.commit !== 'true') return res.json({ ...summary, results });
    if (invalid && opts.skipInvalid !== 'true') throw badRequest(`${invalid} row(s) have errors. Fix them or choose to skip them.`, { results });
    if (prepared.length === 0) throw badRequest('No valid rows to import');

    if (kind === 'students') {
      await assertStudentCapacity(schoolId, prepared.length);
      const created = await commitStudentImport(school, prepared as never);
      await audit(req, { action: 'student.import', entityType: 'Student', after: { file: req.file.originalname, created: created.length, skipped: invalid } });
      return res.json({ ...summary, created });
    }
    await assertStaffCapacity(schoolId, prepared.length);
    const created = await commitStaffImport(school, prepared as never);
    await audit(req, { action: 'staff.import', entityType: 'User', after: { file: req.file.originalname, created: created.length, skipped: invalid } });
    res.json({ ...summary, created });
  }),
);

export default router;
