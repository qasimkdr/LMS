import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { z } from 'zod';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant);

type Term = { id:string; schoolId:string; name:string; academicYear:string; startsAt:Date; endsAt:Date; isCurrent:boolean; createdAt:Date; updatedAt:Date };

const termSchema = z.object({
  name: z.string().min(2).max(80),
  academicYear: z.string().min(4).max(30),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isCurrent: z.boolean().default(false),
});

router.get('/terms', requireRoles('PRINCIPAL','TEACHER','STUDENT','PARENT'), async (req,res) => {
  const schoolId=req.auth!.schoolId!;
  const rows=await prisma.$queryRaw<Term[]>(Prisma.sql`SELECT * FROM "AcademicTerm" WHERE "schoolId"=${schoolId} ORDER BY "startsAt" DESC`);
  res.json(rows);
});

router.post('/terms', requireRoles('PRINCIPAL'), async (req,res) => {
  const p=termSchema.safeParse(req.body); if(!p.success)return res.status(400).json({message:'Invalid term',issues:p.error.flatten()});
  if(p.data.endsAt<=p.data.startsAt)return res.status(400).json({message:'Term end must be after start'});
  const schoolId=req.auth!.schoolId!, id=crypto.randomUUID(), now=new Date();
  await prisma.$transaction(async tx=>{
    if(p.data.isCurrent) await tx.$executeRaw(Prisma.sql`UPDATE "AcademicTerm" SET "isCurrent"=false,"updatedAt"=${now} WHERE "schoolId"=${schoolId}`);
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AcademicTerm" ("id","schoolId","name","academicYear","startsAt","endsAt","isCurrent","createdAt","updatedAt") VALUES (${id},${schoolId},${p.data.name},${p.data.academicYear},${p.data.startsAt},${p.data.endsAt},${p.data.isCurrent},${now},${now})`);
    await tx.auditLog.create({data:{schoolId,actorId:req.auth!.userId,action:'ACADEMIC_TERM_CREATED',entityType:'AcademicTerm',entityId:id,afterData:{name:p.data.name,academicYear:p.data.academicYear}}});
  });
  const [row]=await prisma.$queryRaw<Term[]>(Prisma.sql`SELECT * FROM "AcademicTerm" WHERE "id"=${id}`);
  res.status(201).json(row);
});

async function getTerm(schoolId:string, termId?:string){
  const rows=termId
    ? await prisma.$queryRaw<Term[]>(Prisma.sql`SELECT * FROM "AcademicTerm" WHERE "id"=${termId} AND "schoolId"=${schoolId} LIMIT 1`)
    : await prisma.$queryRaw<Term[]>(Prisma.sql`SELECT * FROM "AcademicTerm" WHERE "schoolId"=${schoolId} ORDER BY "isCurrent" DESC,"startsAt" DESC LIMIT 1`);
  return rows[0]??null;
}

async function resolveStudent(req:any, requestedId?:string){
  const schoolId=req.auth.schoolId as string;
  if(req.auth.role==='STUDENT') return prisma.studentProfile.findFirst({where:{schoolId,userId:req.auth.userId},include:{user:true,class:true}});
  if(req.auth.role==='PARENT'){
    if(!requestedId)return null;
    const parent=await prisma.parentProfile.findFirst({where:{schoolId,userId:req.auth.userId}}); if(!parent)return null;
    const link=await prisma.studentParent.findFirst({where:{parentId:parent.id,studentId:requestedId},include:{student:{include:{user:true,class:true}}}});
    return link?.student??null;
  }
  if(!requestedId)return null;
  return prisma.studentProfile.findFirst({where:{id:requestedId,schoolId},include:{user:true,class:true}});
}

router.get('/report-card', requireRoles('PRINCIPAL','TEACHER','STUDENT','PARENT'), async(req,res)=>{
  const schoolId=req.auth!.schoolId!;
  const term=await getTerm(schoolId,typeof req.query.termId==='string'?req.query.termId:undefined); if(!term)return res.status(404).json({message:'No academic term configured'});
  const student=await resolveStudent(req,typeof req.query.studentId==='string'?req.query.studentId:undefined); if(!student)return res.status(404).json({message:'Student not found or not accessible'});

  if(req.auth!.role==='TEACHER'){
    const allowed=student.classId && await prisma.teacherAssignment.findFirst({where:{schoolId,teacherId:req.auth!.userId,classId:student.classId}});
    if(!allowed)return res.status(403).json({message:'Student is outside your assigned classes'});
  }

  const [examAttempts, assignmentSubs, attendance]=await Promise.all([
    prisma.examAttempt.findMany({where:{schoolId,studentUserId:student.userId,status:'GRADED',gradedAt:{gte:term.startsAt,lte:term.endsAt}},include:{exam:{include:{subject:true}}}}),
    prisma.assignmentSubmission.findMany({where:{studentUserId:student.userId,status:'GRADED',gradedAt:{gte:term.startsAt,lte:term.endsAt},assignment:{schoolId}},include:{assignment:{include:{subject:true}}}}),
    prisma.attendanceRecord.findMany({where:{studentProfileId:student.id,attendance:{schoolId,date:{gte:term.startsAt,lte:term.endsAt}}},include:{attendance:{select:{date:true}}}}),
  ]);

  const subjects=new Map<string,{subjectId:string;subject:string;examEarned:number;examTotal:number;assignmentEarned:number;assignmentTotal:number}>();
  for(const a of examAttempts){const key=a.exam.subjectId;const row=subjects.get(key)??{subjectId:key,subject:a.exam.subject.name,examEarned:0,examTotal:0,assignmentEarned:0,assignmentTotal:0};row.examEarned+=Number(a.score??0);row.examTotal+=Number(a.exam.totalMarks);subjects.set(key,row);}
  for(const s of assignmentSubs){const key=s.assignment.subjectId;const row=subjects.get(key)??{subjectId:key,subject:s.assignment.subject.name,examEarned:0,examTotal:0,assignmentEarned:0,assignmentTotal:0};row.assignmentEarned+=Number(s.score??0);row.assignmentTotal+=Number(s.assignment.maxMarks??0);subjects.set(key,row);}
  const subjectResults=[...subjects.values()].map(x=>{const earned=x.examEarned+x.assignmentEarned,total=x.examTotal+x.assignmentTotal,percentage=total?Math.round((earned/total)*1000)/10:0;return{...x,earned,total,percentage,grade:percentage>=90?'A+':percentage>=80?'A':percentage>=70?'B':percentage>=60?'C':percentage>=50?'D':'F'};}).sort((a,b)=>a.subject.localeCompare(b.subject));
  const present=attendance.filter(x=>x.status==='PRESENT'||x.status==='LATE').length;
  const attendanceRate=attendance.length?Math.round((present/attendance.length)*1000)/10:0;
  const earned=subjectResults.reduce((n,x)=>n+x.earned,0),total=subjectResults.reduce((n,x)=>n+x.total,0),overallPercentage=total?Math.round((earned/total)*1000)/10:0;
  res.json({term,student:{id:student.id,admissionNo:student.admissionNo,name:`${student.user.firstName} ${student.user.lastName}`,class:student.class},attendance:{rate:attendanceRate,present,total:attendance.length},overall:{earned,total,percentage:overallPercentage,grade:overallPercentage>=90?'A+':overallPercentage>=80?'A':overallPercentage>=70?'B':overallPercentage>=60?'C':overallPercentage>=50?'D':'F'},subjects:subjectResults});
});

router.get('/principal-analytics', requireRoles('PRINCIPAL'), async(req,res)=>{
  const schoolId=req.auth!.schoolId!; const term=await getTerm(schoolId,typeof req.query.termId==='string'?req.query.termId:undefined); if(!term)return res.status(404).json({message:'No academic term configured'});
  const [students, gradedExams, gradedAssignments, attendance, syllabus]=await Promise.all([
    prisma.studentProfile.count({where:{schoolId}}),
    prisma.examAttempt.findMany({where:{schoolId,status:'GRADED',gradedAt:{gte:term.startsAt,lte:term.endsAt}},select:{percentage:true}}),
    prisma.assignmentSubmission.findMany({where:{status:'GRADED',gradedAt:{gte:term.startsAt,lte:term.endsAt},assignment:{schoolId}},include:{assignment:{select:{maxMarks:true}}}}),
    prisma.attendanceRecord.findMany({where:{attendance:{schoolId,date:{gte:term.startsAt,lte:term.endsAt}}},select:{status:true}}),
    prisma.syllabusItem.findMany({where:{schoolId,createdAt:{lte:term.endsAt}},select:{isCompleted:true}}),
  ]);
  const examAverage=gradedExams.length?gradedExams.reduce((n,x)=>n+Number(x.percentage??0),0)/gradedExams.length:0;
  const assignmentAverage=gradedAssignments.length?gradedAssignments.reduce((n,x)=>n+(Number(x.assignment.maxMarks)?Number(x.score??0)/Number(x.assignment.maxMarks)*100:0),0)/gradedAssignments.length:0;
  const present=attendance.filter(x=>x.status==='PRESENT'||x.status==='LATE').length;
  res.json({term,students,examAverage:Math.round(examAverage*10)/10,assignmentAverage:Math.round(assignmentAverage*10)/10,attendanceRate:attendance.length?Math.round((present/attendance.length)*1000)/10:0,syllabusProgress:syllabus.length?Math.round((syllabus.filter(x=>x.isCompleted).length/syllabus.length)*1000)/10:0,gradedExamCount:gradedExams.length,gradedAssignmentCount:gradedAssignments.length});
});

export default router;
