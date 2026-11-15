/** Development data: three plans. Run after create-super-admin. */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { MODULE_KEYS } from '../config/modules';

const core = ['attendance', 'fees', 'exams', 'lms', 'timetable', 'whatsapp', 'honors', 'gallery', 'parent_messaging'];

async function main() {
  const plans = [
    { name: 'Basic', monthlyPrice: 5000, includedStudents: 200, perStudentPrice: 25, maxStudents: 400, maxStaff: 30, maxCampuses: 1, storageLimitMb: 5 * 1024, maxFileSizeMb: 10, modules: core },
    { name: 'Standard', monthlyPrice: 10000, includedStudents: 500, perStudentPrice: 20, maxStudents: 1000, maxStaff: 80, maxCampuses: 2, storageLimitMb: 20 * 1024, maxFileSizeMb: 25, modules: [...core, 'online_exams', 'class_chat', 'online_fee_payment', 'admissions'] },
    { name: 'Premium', monthlyPrice: 20000, includedStudents: 1200, perStudentPrice: 15, maxStudents: null, maxStaff: null, maxCampuses: 5, storageLimitMb: 50 * 1024, maxFileSizeMb: 50, modules: MODULE_KEYS },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({ where: { name: p.name }, update: {}, create: p });
  }
  console.log('Seeded plans: Basic, Standard, Premium');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
