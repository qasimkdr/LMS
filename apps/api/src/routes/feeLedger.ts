import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router=Router();
router.use(requireAuth,requireTenant);
const monthPattern=/^\d{4}-\d{2}$/;
function monthsBack(count:number){const out:string[]=[];const now=new Date();for(let i=0;i<count;i++){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1));out.push(d.toISOString().slice(0,7));}return out;}

async function authorizedStudent(req:any,requested?:string){
 const schoolId=req.auth.schoolId as string;
 if(req.auth.role==='STUDENT')return prisma.studentProfile.findFirst({where:{schoolId,userId:req.auth.userId}});
 if(req.auth.role==='PARENT'){
  if(!requested)return null;const parent=await prisma.parentProfile.findFirst({where:{schoolId,userId:req.auth.userId}});if(!parent)return null;
  const link=await prisma.studentParent.findFirst({where:{parentId:parent.id,studentId:requested}});if(!link)return null;
  return prisma.studentProfile.findFirst({where:{schoolId,id:requested}});
 }
 if(!requested)return null;return prisma.studentProfile.findFirst({where:{schoolId,id:requested}});
}

router.get('/ledger',requireRoles('PRINCIPAL','STAFF','STUDENT','PARENT'),async(req,res)=>{
 const schoolId=req.auth!.schoolId!,requested=typeof req.query.studentProfileId==='string'?req.query.studentProfileId:undefined;
 const student=await authorizedStudent(req,requested);if(!student)return res.status(req.auth!.role==='PARENT'?403:404).json({message:'Student not found or not accessible'});
 const months=Math.min(36,Math.max(1,Number(req.query.months??12))),list=monthsBack(months);
 const [profile,structure,payments]=await Promise.all([
  prisma.studentProfile.findFirst({where:{id:student.id,schoolId},include:{user:{select:{firstName:true,lastName:true}},class:true}}),
  student.classId?prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeStructure" WHERE "schoolId"=${schoolId} AND "classId"=${student.classId} LIMIT 1`):Promise.resolve([]),
  prisma.$queryRaw<any[]>(Prisma.sql`SELECT fp.*,mb."firstName" as "markerFirstName",mb."lastName" as "markerLastName",ab."firstName" as "approverFirstName",ab."lastName" as "approverLastName" FROM "FeePayment" fp JOIN "User" mb ON mb.id=fp."markedById" LEFT JOIN "User" ab ON ab.id=fp."approvedById" WHERE fp."schoolId"=${schoolId} AND fp."studentProfileId"=${student.id} AND fp."month" IN (${Prisma.join(list)}) ORDER BY fp."month" DESC`)
 ]);
 const monthlyFee=Number(structure[0]?.monthlyAmount??0),map=new Map(payments.map(p=>[p.month,p]));
 const ledger=list.map(month=>{const p=map.get(month);return{month,expected:monthlyFee,paid:p?Number(p.amount):0,balance:Math.max(0,monthlyFee-(p?Number(p.amount):0)),status:p?.approvalStatus==='APPROVED'?'PAID':p?.approvalStatus==='PENDING'?'PENDING_HANDOVER':p?.approvalStatus==='REJECTED'?'REJECTED':'UNPAID',payment:p?{id:p.id,method:p.method,reference:p.reference,paidAt:p.paidAt,approvalStatus:p.approvalStatus,receivedBy:`${p.markerFirstName} ${p.markerLastName}`,approvedBy:p.approverFirstName?`${p.approverFirstName} ${p.approverLastName}`:null,approvedAt:p.approvedAt}:null};});
 const expected=ledger.reduce((n,x)=>n+x.expected,0),paid=ledger.filter(x=>x.status!=='REJECTED'&&x.status!=='UNPAID').reduce((n,x)=>n+x.paid,0),approved=ledger.filter(x=>x.status==='PAID').reduce((n,x)=>n+x.paid,0);
 res.json({student:{studentProfileId:profile!.id,name:`${profile!.user.firstName} ${profile!.user.lastName}`,admissionNo:profile!.admissionNo,className:profile!.class?`${profile!.class.name}${profile!.class.section?` - ${profile!.class.section}`:''}`:'No class'},monthlyFee,summary:{expected,received:paid,approved,outstanding:Math.max(0,expected-paid),unpaidMonths:ledger.filter(x=>x.status==='UNPAID'||x.status==='REJECTED').length},ledger});
});

router.get('/receipt/:paymentId',requireRoles('PRINCIPAL','STAFF','STUDENT','PARENT'),async(req,res)=>{
 const schoolId=req.auth!.schoolId!;const rows=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT fp.*,sp.id as "profileId",sp."userId",sp."admissionNo",u."firstName",u."lastName",c.name as "className",c.section,s.name as "schoolName",s.address as "schoolAddress",s.phone as "schoolPhone",mb."firstName" as "markerFirstName",mb."lastName" as "markerLastName" FROM "FeePayment" fp JOIN "StudentProfile" sp ON sp.id=fp."studentProfileId" JOIN "User" u ON u.id=sp."userId" LEFT JOIN "Class" c ON c.id=sp."classId" JOIN "School" s ON s.id=fp."schoolId" JOIN "User" mb ON mb.id=fp."markedById" WHERE fp.id=${req.params.paymentId} AND fp."schoolId"=${schoolId} LIMIT 1`);const p=rows[0];if(!p)return res.status(404).json({message:'Payment not found'});
 if(req.auth!.role==='STUDENT'&&p.userId!==req.auth!.userId)return res.status(403).json({message:'Not your payment'});
 if(req.auth!.role==='PARENT'){const parent=await prisma.parentProfile.findFirst({where:{schoolId,userId:req.auth!.userId}});const link=parent?await prisma.studentParent.findFirst({where:{parentId:parent.id,studentId:p.profileId}}):null;if(!link)return res.status(403).json({message:'Student is not linked to this parent'});}
 res.json({receiptNo:`FEE-${p.id.slice(0,8).toUpperCase()}`,school:{name:p.schoolName,address:p.schoolAddress,phone:p.schoolPhone},student:{name:`${p.firstName} ${p.lastName}`,admissionNo:p.admissionNo,className:p.className?`${p.className}${p.section?` - ${p.section}`:''}`:'No class'},payment:{id:p.id,month:p.month,amount:Number(p.amount),method:p.method,reference:p.reference,status:p.approvalStatus,paidAt:p.paidAt,receivedBy:`${p.markerFirstName} ${p.markerLastName}`}});
});

router.get('/collection-trends',requireRoles('PRINCIPAL'),async(req,res)=>{
 const schoolId=req.auth!.schoolId!,months=monthsBack(Math.min(24,Math.max(3,Number(req.query.months??12))));
 const rows=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT "month",COALESCE(SUM("amount") FILTER (WHERE "approvalStatus" <> 'REJECTED'),0) as received,COALESCE(SUM("amount") FILTER (WHERE "approvalStatus"='APPROVED'),0) as approved,COUNT(*) FILTER (WHERE "approvalStatus" <> 'REJECTED') as payments FROM "FeePayment" WHERE "schoolId"=${schoolId} AND "month" IN (${Prisma.join(months)}) GROUP BY "month" ORDER BY "month"`);
 const map=new Map(rows.map(x=>[x.month,x]));res.json([...months].reverse().map(month=>({month,received:Number(map.get(month)?.received??0),principalCollected:Number(map.get(month)?.approved??0),payments:Number(map.get(month)?.payments??0)})));
});

router.get('/staff-ranking',requireRoles('PRINCIPAL'),async(req,res)=>{
 const schoolId=req.auth!.schoolId!,month=typeof req.query.month==='string'&&monthPattern.test(req.query.month)?req.query.month:new Date().toISOString().slice(0,7);
 const rows=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT u.id,u."firstName",u."lastName",COUNT(fp.id) FILTER (WHERE fp."approvalStatus" <> 'REJECTED') as "studentPayments",COALESCE(SUM(fp.amount) FILTER (WHERE fp."approvalStatus" <> 'REJECTED'),0) as "recovered",COALESCE(SUM(fp.amount) FILTER (WHERE fp."approvalStatus"='APPROVED'),0) as "handedOver" FROM "User" u LEFT JOIN "FeePayment" fp ON fp."markedById"=u.id AND fp."schoolId"=${schoolId} AND fp.month=${month} WHERE u."schoolId"=${schoolId} AND u.role='STAFF' GROUP BY u.id,u."firstName",u."lastName" ORDER BY "recovered" DESC`);res.json(rows.map((x,i)=>({rank:i+1,staffId:x.id,name:`${x.firstName} ${x.lastName}`,studentPayments:Number(x.studentPayments),recovered:Number(x.recovered),handedOver:Number(x.handedOver),cashPending:Number(x.recovered)-Number(x.handedOver)})));
});

export default router;