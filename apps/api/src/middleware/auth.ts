import type { NextFunction,Request,Response } from 'express';import jwt from 'jsonwebtoken';
export type AuthContext={userId:string;role:'SUPER_ADMIN'|'PRINCIPAL'|'STAFF'|'TEACHER'|'STUDENT'|'PARENT';schoolId?:string;impersonatedById?:string};
declare global{namespace Express{interface Request{auth?:AuthContext}}}
export function requireAuth(req:Request,res:Response,next:NextFunction){const header=req.headers.authorization,token=header?.startsWith('Bearer ')?header.slice(7):undefined;if(!token)return res.status(401).json({message:'Authentication required'});try{req.auth=jwt.verify(token,process.env.JWT_ACCESS_SECRET!) as AuthContext;next()}catch{return res.status(401).json({message:'Invalid or expired session'})}}
export function requireRoles(...roles:AuthContext['role'][]){return(req:Request,res:Response,next:NextFunction)=>{if(!req.auth||!roles.includes(req.auth.role))return res.status(403).json({message:'Insufficient permissions'});next()}}
export function requireTenant(req:Request,res:Response,next:NextFunction){if(req.auth?.role==='SUPER_ADMIN')return next();if(!req.auth?.schoolId)return res.status(403).json({message:'School scope required'});next()}
