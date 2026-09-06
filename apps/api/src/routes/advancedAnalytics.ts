import { Router } from 'express';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router=Router();
router.use(requireAuth,requireTenant,requireRoles('PRINCIPAL'));

router.get('/rankings',async(req,res)=>{
 const schoolId=req.auth!.schoolId!;
 const classId=typeof req.query.classId==='string'?req.query.classId:undefined;
 const students=await prisma.studentProfile.findMany({where:{schoolId,...(classId?{classId}: {})},include:{user:true,class:true}});
 const rows=[] as any[];
 for(const s of students){
  const [exams,subs,att]=await Promise.all([
   prisma.examAttempt.findMany({where:{schoolId,studentUserId:s.userId,status:'GRADED'},select:{percentage:true}}),
   prisma.assignmentSubmission.findMany({where:{studentUserId:s.userId,status:'GRADED',assignment:{schoolId}},include:{assignment:{select:{maxMarks:true}}}}),
   prisma.attendanceRecord.findMany({where:{studentProfileId:s.id,attendance:{schoolId}},select:{status:true}})
  ]);
  const examAvg=exams.length?exams.reduce((n,x)=>n+Number(x.percentage??0),0)/exams.length:0;
  const assignmentAvg=subs.length?subs.reduce((n,x)=>n+(Number(x.assignment.maxMarks)?Number(x.score??0)/Number(x.assignment.maxMarks)*100:0),0)/subs.length:0;
  const present=att.filter(x=>x.status==='PRESENT'||x.status==='LATE').length;
  const attendance=att.length?present/att.length*100:0;
  const academicPieces=[...(exams.length?[examAvg]:[]),...(subs.length?[assignmentAvg]:[])];
  const academic=academicPieces.length?academicPieces.reduce((a,b)=>a+b,0)/academicPieces.length:0;
  const composite=Math.round((academic*0.85+attendance*0.15)*10)/10;
  rows.push({studentId:s.id,name:`${s.user.firstName} ${s.user.lastName}`,admissionNo:s.admissionNo,class:s.class?`${s.class.name}${s.class.section?` - ${s.class.section}`:''}`:'Unassigned',examAverage:Math.round(examAvg*10)/10,assignmentAverage:Math.round(assignmentAvg*10)/10,attendance:Math.round(attendance*10)/10,composite,needsAttention:composite<60||attendance<75});
 }
 rows.sort((a,b)=>b.composite-a.composite); rows.forEach((r,i)=>r.rank=i+1);
 res.json({top:rows.slice(0,10),weak:rows.filter(x=>x.needsAttention).sort((a,b)=>a.composite-b.composite).slice(0,20),all:rows});
});

router.get('/teacher-performance',async(req,res)=>{
 const schoolId=req.auth!.schoolId!;
 const teachers=await prisma.user.findMany({where:{schoolId,role:'TEACHER',isActive:true},select:{id:true,firstName:true,lastName:true}});
 const rows=[] as any[];
 for(const t of teachers){
  const assignments=await prisma.teacherAssignment.findMany({where:{schoolId,teacherId:t.id},select:{classId:true}});
  const classIds=[...new Set(assignments.map(x=>x.classId))];
  const [sessions,exams,coursework]=await Promise.all([
   prisma.attendanceSession.count({where:{schoolId,markedById:t.id}}),
   prisma.exam.findMany({where:{schoolId,createdById:t.id},include:{attempts:{where:{status:'GRADED'},select:{percentage:true}}}}),
   prisma.assignment.findMany({where:{schoolId,createdById:t.id},include:{submissions:{where:{status:'GRADED'},select:{id:true}}}})
  ]);
  const percentages=exams.flatMap(e=>e.attempts.map(a=>Number(a.percentage??0)));
  rows.push({teacherId:t.id,name:`${t.firstName} ${t.lastName}`,classes:classIds.length,attendanceSessions:sessions,examsCreated:exams.length,assignmentsCreated:coursework.length,gradedExamAverage:percentages.length?Math.round((percentages.reduce((a,b)=>a+b,0)/percentages.length)*10)/10:0,gradedAssignmentSubmissions:coursework.reduce((n,a)=>n+a.submissions.length,0)});
 }
 res.json(rows.sort((a,b)=>(b.attendanceSessions+b.examsCreated+b.assignmentsCreated)-(a.attendanceSessions+a.examsCreated+a.assignmentsCreated)));
});

export default router;