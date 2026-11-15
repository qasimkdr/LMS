import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';
import { applyOverduePolicy, calculateAmount } from '../src/services/billing';

beforeEach(resetDb);

describe('subscription billing', () => {
  it('charges the fixed price plus per-student price above the included students', () => {
    const plan = { monthlyPrice: 5000 as never, includedStudents: 200, perStudentPrice: 25 as never };
    expect(calculateAmount(plan, 150).amount).toBe(5000);
    expect(calculateAmount(plan, 200).amount).toBe(5000);
    expect(calculateAmount(plan, 260)).toMatchObject({ extraStudents: 60, amount: 6500 });
  });

  it('generates invoices once per month using active students', async () => {
    const { sa, schoolId } = await setupSchool();
    for (let i = 0; i < 5; i++) await createUser({ role: 'STUDENT', username: `s${i}`, schoolId });
    // Plan from helpers: 5000 + 100 per student above 2.
    const gen = await sa.post('/api/admin/invoices/generate', { period: '2026-10' });
    expect(gen.body).toMatchObject({ created: 1, skipped: 0 });
    const again = await sa.post('/api/admin/invoices/generate', { period: '2026-10' });
    expect(again.body).toMatchObject({ created: 0, skipped: 1 });

    const inv = await prisma.schoolInvoice.findFirstOrThrow({ where: { schoolId } });
    expect(Number(inv.amount)).toBe(5300);
    expect(inv.activeStudents).toBe(5);
    expect(inv.extraStudents).toBe(3);
  });

  it('overdue invoices move the school to read-only, then suspended; payment restores read-only schools', async () => {
    const { sa, schoolId } = await setupSchool();
    await sa.post('/api/admin/invoices/generate', { period: '2026-01' });
    const inv = await prisma.schoolInvoice.findFirstOrThrow({ where: { schoolId } });

    const tenDaysLate = new Date(inv.dueDate.getTime() + 10 * 86400000);
    expect(await applyOverduePolicy(tenDaysLate)).toEqual([{ schoolId, from: 'ACTIVE', to: 'READ_ONLY' }]);

    const pay = await sa.post(`/api/admin/invoices/${inv.id}/pay`, { amount: 5000, method: 'bank' });
    expect(pay.status).toBe(200);
    expect(pay.body.schoolRestored).toBe(true);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).status).toBe('ACTIVE');

    await sa.post('/api/admin/invoices/generate', { period: '2026-02' });
    const feb = await prisma.schoolInvoice.findFirstOrThrow({ where: { schoolId, period: '2026-02' } });
    const fortyDaysLate = new Date(feb.dueDate.getTime() + 40 * 86400000);
    expect(await applyOverduePolicy(fortyDaysLate)).toEqual([{ schoolId, from: 'ACTIVE', to: 'SUSPENDED' }]);
  });

  it('dashboard compares revenue by month', async () => {
    const { sa, schoolId } = await setupSchool();
    await sa.post('/api/admin/invoices/generate', { schoolId });
    const inv = await prisma.schoolInvoice.findFirstOrThrow({ where: { schoolId } });
    await sa.post(`/api/admin/invoices/${inv.id}/pay`, { amount: 5000, method: 'cash' });
    const d = await sa.get('/api/admin/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.revenue.thisMonth).toBe(5000);
    expect(d.body.revenue.last6Months).toBe(5000);
    expect(d.body.revenue.series).toHaveLength(13);
    expect(d.body.schools.byStatus.ACTIVE).toBe(1);
  });
});
