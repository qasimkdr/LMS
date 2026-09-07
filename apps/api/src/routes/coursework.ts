import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';
import { routeParam } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requireTenant);
const fileReference=z.string().refine(v=>/^https?:\/\//i.test(v)||/^storage:\/\/[0-9a-f-]+$/i.test(v),'Invalid file reference');

async function canManage(userId:string, role:string, schoolId:string, classId:string, subjectId:string){
  const [klass, subject] = await Promise.all([
    prisma.class.findFirst({where:{id:classId,schoolId},select:{id:true}}),
    prisma.subject.findFirst({where:{id:subjectId,schoolId},select:{id:true}}),
  ]);
  if(!klass || !subject) return false;
  if(role==='PRINCIPAL') return true;
  if(role==='TEACHER') return Boolean(await prisma.teacherAssignment.findFirst({where:{schoolId,teacherId:userId,classId,subjectId}}));
  return false;
}

const assignmentSchema=z.object({classId:z.string().uuid(),subjectId:z.string().uuid(),title:z.string().min(2),instructions:z.string().min(2),attachmentUrl:fileReference.optional(),dueAt:z.coerce.date().optional(),maxMarks:z.coerce.number().positive().optional()});
router.get('/assignments', requireRoles('PRINCIPAL','TEACHER','STUDENT','PARENT'), async(req,res)=>{
  const schoolId=req.auth!.schoolId!;
  if(req.auth!.role==='STUDENT'){
    const profile=await prisma.studentProfile.findFirst({where:{schoolId,userId:req.auth!.userId}}); if(!profile?.classId)return res.json([]);
    return res.json(await prisma.assignment.findMany({where:{schoolId,classId:profile.classId},orderBy:{publishedAt:'desc'},include:{subject:true,submissions:{where:{studentUserId:req.auth!.userId}}}}));
  }
  if(req.auth!.role==='PARENT') return res.status(400).json({message:'Use parent child coursework endpoint'});
  if(req.auth!.role==='TEACHER'){
    const assigned=await prisma.teacherAssignment.findMany({where:{schoolId,teacherId:req.auth!.userId},select:{classId:true,subjectId:true}});
    const OR=assigned.map(a=>({classId:a.classId,subjectId:a.subjectId}));
    return res.json(OR.length?await prisma.assignment.findMany({where:{schoolId,OR},orderBy:{publishedAt:'desc'},include:{class:true,subject:true,_count:{select:{submissions:true}}}}):[]);
  }
  res.json(await prisma.assignment.findMany({where:{schoolId},orderBy:{publishedAt:'desc'},include:{class:true,subject:true,_count:{select:{submissions:true}}}}));
});
router.post('/assignments', requireRoles('PRINCIPAL','TEACHER'), async(req,res)=>{
 const p=assignmentSchema.safeParse(req.body); if(!p.success)return res.status(400).json({message:'Invalid assignment',issues:p.error.flatten()}); const d=p.data, schoolId=req.auth!.schoolId!;
 if(!(await canManage(req.auth!.userId,req.auth!.role,schoolId,d.classId,d.subjectId))) return res.status(403).json({message:'Class or subject is outside your school, or you are not assigned to it'});
 const row=await prisma.assignment.create({data:{schoolId,createdById:req.auth!.userId,...d}});
 const students=await prisma.studentProfile.findMany({where:{schoolId,classId:d.classId},select:{userId:true}});
 if(students.length) await prisma.notification.createMany({data:students.map(s=>({schoolId,userId:s.userId,title:'New assignment',body:d.title,link:'/student/coursework'}))});
 await prisma.auditLog.create({data:{schoolId,actorId:req.auth!.userId,action:'ASSIGNMENT_CREATED',entityType:'Assignment',entityId:row.id,afterData:{title:row.title,classId:row.classId,subjectId:row.subjectId}}}); res.status(201).json(row);
});
const submitSchema=z.object({textAnswer:z.string().max(10000).optional(),attachmentUrl:fileReference.optional(),submit:z.boolean().default(true)});
router.put('/assignments/:id/submission', requireRoles('STUDENT'), async(req,res)=>{
 const p=submitSchema.safeParse(req.body); if(!p.success)return res.status(400).json({message:'Invalid submission'}); const schoolId=req.auth!.schoolId!, id=routeParam(req.params.id); const profile=await prisma.studentProfile.findFirst({where:{schoolId,userId:req.auth!.userId}}); const assignment=await prisma.assignment.findFirst({where:{id,schoolId,classId:profile?.classId??'none'}}); if(!assignment)return res.status(404).json({message:'Assignment not found'});
 const now=new Date(); const status=p.data.submit?(assignment.dueAt&&now>assignment.dueAt?'LATE':'SUBMITTED'):'DRAFT'; const row=await prisma.assignmentSubmission.upsert({where:{assignmentId_studentUserId:{assignmentId:assignment.id,studentUserId:req.auth!.userId}},create:{assignmentId:assignment.id,studentUserId:req.auth!.userId,textAnswer:p.data.textAnswer,attachmentUrl:p.data.attachmentUrl,status,submittedAt:p.data.submit?now:null},update:{textAnswer:p.data.textAnswer,attachmentUrl:p.data.attachmentUrl,status,submittedAt:p.data.submit?now:null}}); res.json(row);
});
router.get('/submissions', requireRoles('PRINCIPAL','TEACHER'), async(req,res)=>{
 const schoolId=req.auth!.schoolId!;
 if(req.auth!.role==='TEACHER'){
  const assigned=await prisma.teacherAssignment.findMany({where:{schoolId,teacherId:req.auth!.userId},select:{classId:true,subjectId:true}});const OR=assigned.map(a=>({classId:a.classId,subjectId:a.subjectId}));
  return res.json(OR.length?await prisma.assignmentSubmission.findMany({where:{assignment:{schoolId,OR}},orderBy:{submittedAt:'desc'},include:{student:{select:{id:true,firstName:true,lastName:true}},assignment:{include:{class:true,subject:true}}}}):[]);
 }
 res.json(await prisma.assignmentSubmission.findMany({where:{assignment:{schoolId}},orderBy:{submittedAt:'desc'},include:{student:{select:{id:true,firstName:true,lastName:true}},assignment:{include:{class:true,subject:true}}}}));
});
const grade=z.object({score:z.coerce.number().min(0),feedback:z.string().max(2000).optional()});
router.patch('/submissions/:id/grade', requireRoles('PRINCIPAL','TEACHER'), async(req,res)=>{
 const p=grade.safeParse(req.body); if(!p.success)return res.status(400).json({message:'Invalid grade'}); const id=routeParam(req.params.id); const sub=await prisma.assignmentSubmission.findFirst({where:{id},include:{assignment:true}}); if(!sub||sub.assignment.schoolId!==req.auth!.schoolId)return res.status(404).json({message:'Submission not found'}); if(req.auth!.role==='TEACHER' && !(await canManage(req.auth!.userId,'TEACHER',req.auth!.schoolId!,sub.assignment.classId,sub.assignment.subjectId))) return res.status(403).json({message:'Not allowed'}); if(sub.assignment.maxMarks&&p.data.score>Number(sub.assignment.maxMarks))return res.status(400).json({message:'Score exceeds maximum marks'}); const row=await prisma.assignmentSubmission.update({where:{id:sub.id},data:{score:p.data.score,feedback:p.data.feedback,status:'GRADED',gradedAt:new Date()}}); await prisma.notification.create({data:{schoolId:req.auth!.schoolId!,userId:sub.studentUserId,title:'Assignment graded',body:sub.assignment.title,link:'/student/coursework'}}); res.json(row);
});

const materialSchema=z.object({classId:z.string().uuid(),subjectId:z.string().uuid(),title:z.string().min(2),description:z.string().optional(),fileUrl:fileReference.optional(),externalUrl:z.string().url().optional()});
router.get('/materials', requireRoles('PRINCIPAL','TEACHER','STUDENT'), async(req,res)=>{const schoolId=req.auth!.schoolId!; if(req.auth!.role==='STUDENT'){const p=await prisma.studentProfile.findFirst({where:{schoolId,userId:req.auth!.userId}});if(!p?.classId)return res.json([]);return res.json(await prisma.courseMaterial.findMany({where:{schoolId,classId:p.classId},include:{subject:true},orderBy:{createdAt:'desc'}}));} if(req.auth!.role==='TEACHER'){const assigned=await prisma.teacherAssignment.findMany({where:{schoolId,teacherId:req.auth!.userId},select:{classId:true,subjectId:true}});const OR=assigned.map(a=>({classId:a.classId,subjectId:a.subjectId}));return res.json(OR.length?await prisma.courseMaterial.findMany({where:{schoolId,OR},include:{class:true,subject:true},orderBy:{createdAt:'desc'}}):[]);}res.json(await prisma.courseMaterial.findMany({where:{schoolId},include:{class:true,subject:true},orderBy:{createdAt:'desc'}}));});
router.post('/materials', requireRoles('PRINCIPAL','TEACHER'), async(req,res)=>{const p=materialSchema.safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid material'});const d=p.data,schoolId=req.auth!.schoolId!;if(!(await canManage(req.auth!.userId,req.auth!.role,schoolId,d.classId,d.subjectId)))return res.status(403).json({message:'Class or subject is outside your school, or you are not assigned to it'});res.status(201).json(await prisma.courseMaterial.create({data:{schoolId,createdById:req.auth!.userId,...d}}));});

const syllabusSchema=z.object({classId:z.string().uuid(),subjectId:z.string().uuid(),title:z.string().min(2),description:z.string().optional(),sortOrder:z.coerce.number().int().default(0)});
router.get('/syllabus', requireRoles('PRINCIPAL','TEACHER','STUDENT'), async(req,res)=>{const schoolId=req.auth!.schoolId!;if(req.auth!.role==='STUDENT'){const p=await prisma.studentProfile.findFirst({where:{schoolId,userId:req.auth!.userId}});if(!p?.classId)return res.json([]);return res.json(await prisma.syllabusItem.findMany({where:{schoolId,classId:p.classId},include:{subject:true},orderBy:[{subjectId:'asc'},{sortOrder:'asc'}]}));}if(req.auth!.role==='TEACHER'){const assigned=await prisma.teacherAssignment.findMany({where:{schoolId,teacherId:req.auth!.userId},select:{classId:true,subjectId:true}});const OR=assigned.map(a=>({classId:a.classId,subjectId:a.subjectId}));return res.json(OR.length?await prisma.syllabusItem.findMany({where:{schoolId,OR},include:{class:true,subject:true},orderBy:[{classId:'asc'},{subjectId:'asc'},{sortOrder:'asc'}]}):[]);}res.json(await prisma.syllabusItem.findMany({where:{schoolId},include:{class:true,subject:true},orderBy:[{classId:'asc'},{subjectId:'asc'},{sortOrder:'asc'}]}));});
router.post('/syllabus', requireRoles('PRINCIPAL','TEACHER'), async(req,res)=>{const p=syllabusSchema.safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid syllabus item'});const d=p.data,schoolId=req.auth!.schoolId!;if(!(await canManage(req.auth!.userId,req.auth!.role,schoolId,d.classId,d.subjectId)))return res.status(403).json({message:'Class or subject is outside your school, or you are not assigned to it'});res.status(201).json(await prisma.syllabusItem.create({data:{schoolId,createdById:req.auth!.userId,...d}}));});
router.patch('/syllabus/:id/toggle', requireRoles('PRINCIPAL','TEACHER'), async(req,res)=>{const id=routeParam(req.params.id);const item=await prisma.syllabusItem.findFirst({where:{id,schoolId:req.auth!.schoolId!}});if(!item)return res.status(404).json({message:'Item not found'});if(req.auth!.role==='TEACHER'&&!(await canManage(req.auth!.userId,'TEACHER',req.auth!.schoolId!,item.classId,item.subjectId)))return res.status(403).json({message:'Not allowed'});res.json(await prisma.syllabusItem.update({where:{id:item.id},data:{isCompleted:!item.isCompleted,completedAt:!item.isCompleted?new Date():null}}));});

export default router;
