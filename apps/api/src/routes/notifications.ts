import { Router } from 'express';
import { prisma } from '@nexora/database';
import { requireAuth, requireTenant } from '../middleware/auth.js';

const router=Router();
router.use(requireAuth,requireTenant);
router.get('/',async(req,res)=>{const rows=await prisma.notification.findMany({where:{schoolId:req.auth!.schoolId!,userId:req.auth!.userId},orderBy:{createdAt:'desc'},take:100});res.json(rows);});
router.patch('/:id/read',async(req,res)=>{const row=await prisma.notification.findFirst({where:{id:req.params.id,schoolId:req.auth!.schoolId!,userId:req.auth!.userId}});if(!row)return res.status(404).json({message:'Notification not found'});res.json(await prisma.notification.update({where:{id:row.id},data:{readAt:new Date()}}));});
router.patch('/read-all',async(req,res)=>{await prisma.notification.updateMany({where:{schoolId:req.auth!.schoolId!,userId:req.auth!.userId,readAt:null},data:{readAt:new Date()}});res.json({ok:true});});
export default router;
