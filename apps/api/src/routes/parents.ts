import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router=Router();
router.use(requireAuth,requireTenant,requireRoles('PRINCIPAL','STAFF'));

const createSchema=z.object({firstName:z.string().min(2),lastName:z.string().min(1),email:z.string().email(),username:z.string().min(3),password:z.string().min(8),studentIds:z.array(z.string().uuid()).min(1),relation:z.string().max(50).optional()});
router.post('/',async(req,res)=>{const p=createSchema.safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid parent data',issues:p.error.flatten()});const schoolId=req.auth!.schoolId!;const students=await prisma.studentProfile.findMany({where:{id:{in:p.data.studentIds},schoolId}});if(students.length!==p.data.studentIds.length)return res.status(400).json({message:'One or more students are invalid'});const passwordHash=await bcrypt.hash(p.data.password,12);const parent=await prisma.$transaction(async tx=>{const user=await tx.user.create({data:{schoolId,role:'PARENT',firstName:p.data.firstName,lastName:p.data.lastName,email:p.data.email.toLowerCase(),username:p.data.username,passwordHash}});const profile=await tx.parentProfile.create({data:{schoolId,userId:user.id}});await tx.studentParent.createMany({data:p.data.studentIds.map(studentId=>({studentId,parentId:profile.id,relation:p.data.relation}))});await tx.auditLog.create({data:{schoolId,actorId:req.auth!.userId,action:'PARENT_CREATED',entityType:'ParentProfile',entityId:profile.id,afterData:{studentIds:p.data.studentIds}}});return profile;});res.status(201).json(parent);});

const linkSchema=z.object({studentId:z.string().uuid(),relation:z.string().max(50).optional()});
router.post('/:parentId/link',async(req,res)=>{const p=linkSchema.safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid link'});const schoolId=req.auth!.schoolId!;const [parent,student]=await Promise.all([prisma.parentProfile.findFirst({where:{id:req.params.parentId,schoolId}}),prisma.studentProfile.findFirst({where:{id:p.data.studentId,schoolId}})]);if(!parent||!student)return res.status(404).json({message:'Parent or student not found'});await prisma.studentParent.upsert({where:{studentId_parentId:{studentId:student.id,parentId:parent.id}},create:{studentId:student.id,parentId:parent.id,relation:p.data.relation},update:{relation:p.data.relation}});res.json({ok:true});});

router.get('/',async(req,res)=>{const schoolId=req.auth!.schoolId!;const rows=await prisma.parentProfile.findMany({where:{schoolId},include:{user:{select:{id:true,firstName:true,lastName:true,email:true,username:true,isActive:true}},students:{include:{student:{include:{user:{select:{firstName:true,lastName:true}},class:true}}}}},orderBy:{createdAt:'desc'}});res.json(rows);});
export default router;
