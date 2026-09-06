import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { z } from 'zod';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router=Router();
router.use(requireAuth,requireTenant);

const monthPattern=/^\d{4}-\d{2}$/;
function previousMonths(count:number){const out:string[]=[];const d=new Date();for(let i=0;i<count;i++){const x=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-i,1));out.push(x.toISOString().slice(0,7));}return out;}

router.get('/recovery-dashboard',requireRoles('PRINCIPAL','STAFF'),async(req,res)=>{
 const schoolId=req.auth!.schoolId!,month=typeof req.query.month==='string'&&monthPattern.test(req.query.month)?req.query.month:new Date().toISOString().slice(0,7);
 const [students,structures,payments,batches]=await Promise.all([
  prisma.studentProfile.findMany({where:{schoolId},include:{user:{select:{firstName:true,lastName:true}},class:true}}),
  prisma.$queryRaw<any[]>(Prisma.sql`SELECT fs.*,c.name as "className",c.section FROM "FeeStructure" fs JOIN "Class" c ON c.id=fs."classId" WHERE fs."schoolId"=${schoolId}`),
  prisma.$queryRaw<any[]>(Prisma.sql`SELECT fp.*,sp."classId",u."firstName",u."lastName",c.name as "className",c.section,mb."firstName" as "markerFirstName",mb."lastName" as "markerLastName" FROM "FeePayment" fp JOIN "StudentProfile" sp ON sp.id=fp."studentProfileId" JOIN "User" u ON u.id=sp."userId" LEFT JOIN "Class" c ON c.id=sp."classId" JOIN "User" mb ON mb.id=fp."markedById" WHERE fp."schoolId"=${schoolId} AND fp."month"=${month}`),
  prisma.$queryRaw<any[]>(Prisma.sql`SELECT b.*,u."firstName",u."lastName" FROM "FeeRecoveryBatch" b JOIN "User" u ON u.id=b."staffId" WHERE b."schoolId"=${schoolId} AND b."status" IN ('OPEN','SUBMITTED') ORDER BY b."createdAt" DESC`)
 ]);
 const structureMap=new Map(structures.map(x=>[x.classId,Number(x.monthlyAmount)]));
 const paidMap=new Map(payments.filter(x=>x.approvalStatus!=='REJECTED').map(x=>[x.studentProfileId,Number(x.amount)]));
 const expected=students.reduce((n,s)=>n+(s.classId?structureMap.get(s.classId)??0:0),0);
 const received=payments.filter(x=>x.approvalStatus!=='REJECTED').reduce((n,p)=>n+Number(p.amount),0);
 const principalCollected=payments.filter(x=>x.approvalStatus==='APPROVED').reduce((n,p)=>n+Number(p.amount),0);
 const classRows=structures.map(fs=>{const classStudents=students.filter(s=>s.classId===fs.classId);const classPayments=payments.filter(p=>p.classId===fs.classId&&p.approvalStatus!=='REJECTED');const exp=classStudents.length*Number(fs.monthlyAmount),got=classPayments.reduce((n,p)=>n+Number(p.amount),0);return{classId:fs.classId,className:`${fs.className}${fs.section?` - ${fs.section}`:''}`,monthlyAmount:Number(fs.monthlyAmount),students:classStudents.length,paid:classPayments.length,remaining:Math.max(0,classStudents.length-classPayments.length),expected:exp,collected:got,pending:Math.max(0,exp-got),recoveryRate:exp?Math.round(got/exp*1000)/10:0};});
 const studentCards=students.map(s=>({studentProfileId:s.id,name:`${s.user.firstName} ${s.user.lastName}`,admissionNo:s.admissionNo,className:s.class?`${s.class.name}${s.class.section?` - ${s.class.section}`:''}`:'No class',monthlyFee:s.classId?structureMap.get(s.classId)??0:0,paidAmount:paidMap.get(s.id)??0,status:paidMap.has(s.id)?'PAID':'UNPAID'}));
 res.json({month,expected,received,principalCollected,cashPendingWithStaff:Math.max(0,received-principalCollected),remaining:Math.max(0,expected-received),paidStudents:studentCards.filter(x=>x.status==='PAID').length,totalStudents:studentCards.length,classRows,studentCards,batches});
});

router.get('/student-dues',requireRoles('PRINCIPAL','STAFF','STUDENT','PARENT'),async(req,res)=>{
 const schoolId=req.auth!.schoolId!,months=Math.min(24,Math.max(1,Number(req.query.months??12))),monthList=previousMonths(months);let targetId=typeof req.query.studentProfileId==='string'?req.query.studentProfileId:undefined;
 if(req.auth!.role==='STUDENT'){const p=await prisma.studentProfile.findFirst({where:{schoolId,userId:req.auth!.userId}});targetId=p?.id;}
 if(req.auth!.role==='PARENT'){const parent=await prisma.parentProfile.findFirst({where:{schoolId,userId:req.auth!.userId}});if(!parent||!targetId)return res.status(404).json({message:'Student not found'});const link=await prisma.studentParent.findFirst({where:{parentId:parent.id,studentId:targetId}});if(!link)return res.status(403).json({message:'Student is not linked to this parent'});}
 const students=await prisma.studentProfile.findMany({where:{schoolId,...(targetId?{id:targetId}:{})},include:{user:{select:{firstName:true,lastName:true}},class:true}});
 const structures=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeStructure" WHERE "schoolId"=${schoolId}`);const sm=new Map(structures.map(x=>[x.classId,Number(x.monthlyAmount)]));
 const payments=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeePayment" WHERE "schoolId"=${schoolId} AND "month" IN (${Prisma.join(monthList)}) AND "approvalStatus" <> 'REJECTED'`);const paid=new Set(payments.map(p=>`${p.studentProfileId}:${p.month}`));
 const rows=students.map(s=>{const fee=s.classId?sm.get(s.classId)??0:0;const missing=monthList.filter(m=>!paid.has(`${s.id}:${m}`));return{studentProfileId:s.id,name:`${s.user.firstName} ${s.user.lastName}`,admissionNo:s.admissionNo,className:s.class?`${s.class.name}${s.class.section?` - ${s.class.section}`:''}`:'No class',monthlyFee:fee,monthsChecked:monthList.length,unpaidMonths:missing.length,dueAmount:missing.length*fee,missingMonths:missing};}).sort((a,b)=>b.dueAmount-a.dueAmount||b.unpaidMonths-a.unpaidMonths);
 res.json(rows);
});

const paymentSchema=z.object({studentProfileId:z.string().uuid(),month:z.string().regex(monthPattern),amount:z.coerce.number().positive(),method:z.string().max(50).optional(),reference:z.string().max(120).optional()});
router.post('/receive',requireRoles('PRINCIPAL','STAFF'),async(req,res)=>{
 const p=paymentSchema.safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid fee payment'});const d=p.data,schoolId=req.auth!.schoolId!;const student=await prisma.studentProfile.findFirst({where:{id:d.studentProfileId,schoolId}});if(!student)return res.status(404).json({message:'Student not found'});
 const now=new Date();let batchId:string|null=null;const approvalStatus=req.auth!.role==='PRINCIPAL'?'APPROVED':'PENDING';
 if(req.auth!.role==='STAFF'){
  const open=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeRecoveryBatch" WHERE "schoolId"=${schoolId} AND "staffId"=${req.auth!.userId} AND "status"='OPEN' ORDER BY "createdAt" DESC LIMIT 1`);batchId=open[0]?.id??crypto.randomUUID();if(!open[0])await prisma.$executeRaw(Prisma.sql`INSERT INTO "FeeRecoveryBatch" ("id","schoolId","staffId","status","createdAt","updatedAt") VALUES (${batchId},${schoolId},${req.auth!.userId},'OPEN',${now},${now})`);
 }
 const id=crypto.randomUUID();
 await prisma.$transaction(async tx=>{
  await tx.$executeRaw(Prisma.sql`INSERT INTO "FeePayment" ("id","schoolId","studentProfileId","month","amount","status","method","reference","markedById","paidAt","createdAt","approvalStatus","approvedById","approvedAt","recoveryBatchId") VALUES (${id},${schoolId},${d.studentProfileId},${d.month},${d.amount},'PAID',${d.method??null},${d.reference??null},${req.auth!.userId},${now},${now},${approvalStatus},${req.auth!.role==='PRINCIPAL'?req.auth!.userId:null},${req.auth!.role==='PRINCIPAL'?now:null},${batchId}) ON CONFLICT ("schoolId","studentProfileId","month") DO UPDATE SET "amount"=EXCLUDED."amount","method"=EXCLUDED."method","reference"=EXCLUDED."reference","markedById"=${req.auth!.userId},"paidAt"=${now},"approvalStatus"=${approvalStatus},"approvedById"=${req.auth!.role==='PRINCIPAL'?req.auth!.userId:null},"approvedAt"=${req.auth!.role==='PRINCIPAL'?now:null},"recoveryBatchId"=${batchId}`);
  if(batchId)await tx.$executeRaw(Prisma.sql`UPDATE "FeeRecoveryBatch" b SET "totalAmount"=(SELECT COALESCE(SUM("amount"),0) FROM "FeePayment" WHERE "recoveryBatchId"=b.id AND "approvalStatus"='PENDING'),"studentCount"=(SELECT COUNT(*) FROM "FeePayment" WHERE "recoveryBatchId"=b.id AND "approvalStatus"='PENDING'),"updatedAt"=${now} WHERE b.id=${batchId}`);
  await tx.auditLog.create({data:{schoolId,actorId:req.auth!.userId,action:'FEE_RECEIVED',entityType:'FeePayment',entityId:id,afterData:{studentProfileId:d.studentProfileId,month:d.month,amount:d.amount,approvalStatus,batchId}}});
 });res.status(201).json({id,approvalStatus,batchId});
});

router.post('/batches/:id/submit',requireRoles('STAFF'),async(req,res)=>{const schoolId=req.auth!.schoolId!,now=new Date();const changed=await prisma.$executeRaw(Prisma.sql`UPDATE "FeeRecoveryBatch" SET "status"='SUBMITTED',"submittedAt"=${now},"updatedAt"=${now} WHERE "id"=${req.params.id} AND "schoolId"=${schoolId} AND "staffId"=${req.auth!.userId} AND "status"='OPEN'`);if(!changed)return res.status(404).json({message:'Open recovery batch not found'});res.json({ok:true});});

router.get('/batches',requireRoles('PRINCIPAL','STAFF'),async(req,res)=>{const schoolId=req.auth!.schoolId!;const rows=req.auth!.role==='STAFF'?await prisma.$queryRaw<any[]>(Prisma.sql`SELECT b.*,u."firstName",u."lastName" FROM "FeeRecoveryBatch" b JOIN "User" u ON u.id=b."staffId" WHERE b."schoolId"=${schoolId} AND b."staffId"=${req.auth!.userId} ORDER BY b."createdAt" DESC`):await prisma.$queryRaw<any[]>(Prisma.sql`SELECT b.*,u."firstName",u."lastName" FROM "FeeRecoveryBatch" b JOIN "User" u ON u.id=b."staffId" WHERE b."schoolId"=${schoolId} ORDER BY CASE WHEN b.status='SUBMITTED' THEN 0 WHEN b.status='OPEN' THEN 1 ELSE 2 END,b."createdAt" DESC`);res.json(rows);});
router.get('/batches/:id',requireRoles('PRINCIPAL','STAFF'),async(req,res)=>{const schoolId=req.auth!.schoolId!;const batches=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT b.*,u."firstName",u."lastName" FROM "FeeRecoveryBatch" b JOIN "User" u ON u.id=b."staffId" WHERE b.id=${req.params.id} AND b."schoolId"=${schoolId}`);const batch=batches[0];if(!batch)return res.status(404).json({message:'Batch not found'});if(req.auth!.role==='STAFF'&&batch.staffId!==req.auth!.userId)return res.status(403).json({message:'Not your batch'});const payments=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT fp.*,sp."admissionNo",u."firstName",u."lastName",c.name as "className",c.section FROM "FeePayment" fp JOIN "StudentProfile" sp ON sp.id=fp."studentProfileId" JOIN "User" u ON u.id=sp."userId" LEFT JOIN "Class" c ON c.id=sp."classId" WHERE fp."recoveryBatchId"=${batch.id} ORDER BY fp."paidAt" DESC`);res.json({...batch,payments});});

router.patch('/batches/:id/collect',requireRoles('PRINCIPAL'),async(req,res)=>{const p=z.object({remark:z.string().max(1000).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid collection'});const schoolId=req.auth!.schoolId!,now=new Date();const batches=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeRecoveryBatch" WHERE id=${req.params.id} AND "schoolId"=${schoolId} AND status='SUBMITTED'`);if(!batches[0])return res.status(404).json({message:'Submitted recovery batch not found'});await prisma.$transaction(async tx=>{await tx.$executeRaw(Prisma.sql`UPDATE "FeePayment" SET "approvalStatus"='APPROVED',"approvedById"=${req.auth!.userId},"approvedAt"=${now} WHERE "recoveryBatchId"=${req.params.id} AND "schoolId"=${schoolId} AND "approvalStatus"='PENDING'`);await tx.$executeRaw(Prisma.sql`UPDATE "FeeRecoveryBatch" SET "status"='COLLECTED',"collectedByPrincipalId"=${req.auth!.userId},"collectedAt"=${now},"principalRemark"=${p.data.remark??null},"updatedAt"=${now} WHERE id=${req.params.id}`);await tx.auditLog.create({data:{schoolId,actorId:req.auth!.userId,action:'FEE_RECOVERY_BATCH_COLLECTED',entityType:'FeeRecoveryBatch',entityId:req.params.id,afterData:{amount:Number(batches[0].totalAmount),studentCount:batches[0].studentCount}}});});res.json({ok:true});});

export default router;