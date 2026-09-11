import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded';
import FamilyRestroomRoundedIcon from '@mui/icons-material/FamilyRestroomRounded';
import ClassRoundedIcon from '@mui/icons-material/ClassRounded';
import AssignmentIndRoundedIcon from '@mui/icons-material/AssignmentIndRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import QuizRoundedIcon from '@mui/icons-material/QuizRounded';
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import ApprovalRoundedIcon from '@mui/icons-material/ApprovalRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import BeachAccessRoundedIcon from '@mui/icons-material/BeachAccessRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded';
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthProvider';

type NavItem = { to:string; label:string; icon:any };

type Role = 'SUPER_ADMIN'|'PRINCIPAL'|'STAFF'|'TEACHER'|'STUDENT'|'PARENT';

const nav:Record<Role,NavItem[]> = {
  SUPER_ADMIN:[
    {to:'/super-admin',label:'Dashboard',icon:DashboardRoundedIcon},
    {to:'/super-admin/schools',label:'Schools',icon:BusinessRoundedIcon},
    {to:'/super-admin/plans',label:'Plans',icon:WorkspacePremiumRoundedIcon},
    {to:'/notifications',label:'Notifications',icon:NotificationsRoundedIcon},
    {to:'/support',label:'Support',icon:SupportAgentRoundedIcon},
  ],
  PRINCIPAL:[
    {to:'/principal',label:'Dashboard',icon:DashboardRoundedIcon},
    {to:'/principal/operations',label:'Students · Teachers · Staff',icon:GroupsRoundedIcon},
    {to:'/principal/operations',label:'Classes & Subjects',icon:ClassRoundedIcon},
    {to:'/principal/assignments',label:'Teacher Assignments',icon:AssignmentIndRoundedIcon},
    {to:'/principal/timetable',label:'Timetable',icon:CalendarMonthRoundedIcon},
    {to:'/principal/attendance',label:'Attendance',icon:FactCheckRoundedIcon},
    {to:'/principal/coursework',label:'Coursework',icon:MenuBookRoundedIcon},
    {to:'/principal/manual-tests',label:'Manual Tests',icon:AssessmentRoundedIcon},
    {to:'/teacher/exams/new',label:'Exam Studio',icon:QuizRoundedIcon},
    {to:'/principal/report-card',label:'Report Cards',icon:AssessmentRoundedIcon},
    {to:'/principal/finance',label:'Finance',icon:PaymentsRoundedIcon},
    {to:'/principal/fees',label:'Fee Recovery',icon:PaymentsRoundedIcon},
    {to:'/principal/approvals',label:'Approvals',icon:ApprovalRoundedIcon},
    {to:'/principal/announcements',label:'Announcements',icon:CampaignRoundedIcon},
    {to:'/principal/calendar',label:'Calendar',icon:EventRoundedIcon},
    {to:'/principal/leave',label:'Leave Center',icon:BeachAccessRoundedIcon},
    {to:'/principal/analytics',label:'Analytics',icon:InsightsRoundedIcon},
    {to:'/principal/advanced-analytics',label:'Advanced Analytics',icon:InsightsRoundedIcon},
    {to:'/notifications',label:'Notifications',icon:NotificationsRoundedIcon},
    {to:'/principal/settings',label:'School Settings',icon:SettingsRoundedIcon},
    {to:'/support',label:'Support',icon:SupportAgentRoundedIcon},
  ],
  STAFF:[
    {to:'/staff',label:'Dashboard',icon:DashboardRoundedIcon},
    {to:'/staff/requests',label:'Requests',icon:ApprovalRoundedIcon},
    {to:'/staff/fees',label:'Fee Recovery',icon:PaymentsRoundedIcon},
    {to:'/staff/student-fees',label:'Student Fees',icon:PaymentsRoundedIcon},
    {to:'/staff/timetable',label:'Timetable',icon:CalendarMonthRoundedIcon},
    {to:'/staff/announcements',label:'Announcements',icon:CampaignRoundedIcon},
    {to:'/staff/calendar',label:'Calendar',icon:EventRoundedIcon},
    {to:'/staff/leave',label:'Leave Center',icon:BeachAccessRoundedIcon},
    {to:'/notifications',label:'Notifications',icon:NotificationsRoundedIcon},
    {to:'/support',label:'Support',icon:SupportAgentRoundedIcon},
  ],
  TEACHER:[
    {to:'/teacher',label:'Dashboard',icon:DashboardRoundedIcon},
    {to:'/teacher/timetable',label:'Timetable',icon:CalendarMonthRoundedIcon},
    {to:'/teacher/attendance',label:'Attendance',icon:FactCheckRoundedIcon},
    {to:'/teacher/coursework',label:'Coursework',icon:MenuBookRoundedIcon},
    {to:'/teacher/manual-tests',label:'Manual Tests',icon:AssessmentRoundedIcon},
    {to:'/teacher/exams/new',label:'Exam Studio',icon:QuizRoundedIcon},
    {to:'/teacher/grading',label:'Grading',icon:AssessmentRoundedIcon},
    {to:'/teacher/submissions',label:'Submissions',icon:FactCheckRoundedIcon},
    {to:'/teacher/report-card',label:'Report Cards',icon:AssessmentRoundedIcon},
    {to:'/teacher/calendar',label:'Calendar',icon:EventRoundedIcon},
    {to:'/teacher/leave',label:'Leave',icon:BeachAccessRoundedIcon},
    {to:'/notifications',label:'Notifications',icon:NotificationsRoundedIcon},
  ],
  STUDENT:[
    {to:'/student',label:'Dashboard',icon:DashboardRoundedIcon},
    {to:'/student/timetable',label:'Timetable',icon:CalendarMonthRoundedIcon},
    {to:'/student/coursework',label:'Coursework',icon:MenuBookRoundedIcon},
    {to:'/student/assignments',label:'Assignments',icon:FactCheckRoundedIcon},
    {to:'/student/manual-tests',label:'Test Results',icon:AssessmentRoundedIcon},
    {to:'/student/exams',label:'Exams',icon:QuizRoundedIcon},
    {to:'/student/report-card',label:'Report Card',icon:AssessmentRoundedIcon},
    {to:'/student/fees',label:'Fees',icon:PaymentsRoundedIcon},
    {to:'/student/calendar',label:'Calendar',icon:EventRoundedIcon},
    {to:'/student/leave',label:'Leave',icon:BeachAccessRoundedIcon},
    {to:'/notifications',label:'Notifications',icon:NotificationsRoundedIcon},
  ],
  PARENT:[
    {to:'/parent',label:'Dashboard',icon:DashboardRoundedIcon},
    {to:'/parent/coursework',label:'Coursework',icon:MenuBookRoundedIcon},
    {to:'/parent/report-card',label:'Report Card',icon:AssessmentRoundedIcon},
    {to:'/parent/fees',label:'Fees',icon:PaymentsRoundedIcon},
    {to:'/parent/timetable',label:'Timetable',icon:CalendarMonthRoundedIcon},
    {to:'/parent/calendar',label:'Calendar',icon:EventRoundedIcon},
    {to:'/notifications',label:'Notifications',icon:NotificationsRoundedIcon},
  ],
};

const roleTitle:Record<Role,string>={SUPER_ADMIN:'Platform Control',PRINCIPAL:'Principal Portal',STAFF:'Staff Workspace',TEACHER:'Teacher Studio',STUDENT:'Student Hub',PARENT:'Parent Portal'};

export default function AppShell({children}:{children:ReactNode}){
  const {user,logout}=useAuth();
  const location=useLocation();
  const navigate=useNavigate();
  const [open,setOpen]=useState(false);
  useEffect(()=>setOpen(false),[location.pathname]);
  const items=useMemo(()=>user?nav[user.role]:[],[user]);
  if(!user)return <>{children}</>;
  const schoolName=user.school?.name??'Nexora LMS';
  const initials=`${user.firstName?.[0]??''}${user.lastName?.[0]??''}`.toUpperCase();
  const doLogout=async()=>{await logout();navigate('/login',{replace:true})};
  return <div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,#e8f1ff_0,#f8fbff_33%,#fff7ed_72%,#f8f5ff_100%)] text-slate-900 lg:grid lg:grid-cols-[290px_minmax(0,1fr)]">
    <button onClick={()=>setOpen(true)} className="fixed left-4 top-4 z-[70] grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-500 text-white shadow-[0_16px_40px_rgba(79,70,229,.35)] transition hover:-translate-y-1 hover:rotate-3 hover:scale-105 lg:hidden"><MenuRoundedIcon/></button>
    {open&&<button aria-label="Close navigation" className="fixed inset-0 z-[80] bg-slate-950/45 backdrop-blur-sm lg:hidden" onClick={()=>setOpen(false)}/>} 
    <aside className={`fixed inset-y-0 left-0 z-[90] flex w-[290px] flex-col overflow-hidden border-r border-white/70 bg-white/80 p-4 shadow-[24px_0_80px_rgba(30,41,59,.15)] backdrop-blur-2xl transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open?'translate-x-0':'-translate-x-full'}`}>
      <div className="pointer-events-none absolute -left-24 -top-20 h-56 w-56 rounded-full bg-blue-400/25 blur-3xl"/><div className="pointer-events-none absolute -right-24 top-40 h-56 w-56 rounded-full bg-fuchsia-400/20 blur-3xl"/>
      <div className="relative rounded-[26px] bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-500 p-[1px] shadow-[0_20px_55px_rgba(79,70,229,.30)]">
        <div className="rounded-[25px] bg-slate-950/92 p-4 text-white">
          <div className="flex items-start justify-between"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-500 shadow-lg"><SchoolRoundedIcon/></div><button onClick={()=>setOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 transition hover:rotate-90 hover:bg-white/20 lg:hidden"><CloseRoundedIcon fontSize="small"/></button></div>
          <p className="mt-4 text-[10px] font-black uppercase tracking-[.24em] text-cyan-300">Nexora LMS</p><h2 className="mt-1 truncate text-xl font-black">{schoolName}</h2><div className="mt-2 flex items-center gap-2 text-xs font-bold text-white/60"><AutoAwesomeRoundedIcon sx={{fontSize:15}}/><span>{roleTitle[user.role]}</span></div>
        </div>
      </div>
      <nav className="relative mt-4 flex-1 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">{items.map(({to,label,icon:Icon},index)=><NavLink key={`${to}-${label}`} to={to} end={to==='/'||to==='/principal'||to==='/staff'||to==='/teacher'||to==='/student'||to==='/parent'||to==='/super-admin'} className={({isActive})=>`group relative flex items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-sm font-extrabold transition-all duration-300 ${isActive?'translate-x-1 bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-500 text-white shadow-[0_12px_32px_rgba(79,70,229,.28)]':'text-slate-600 hover:translate-x-1 hover:-translate-y-[1px] hover:bg-white hover:text-slate-950 hover:shadow-[0_12px_35px_rgba(15,23,42,.10)]'}`} style={{animationDelay:`${index*18}ms`}}><span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full"/><span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100/80 text-slate-600 transition duration-300 group-hover:rotate-3 group-hover:scale-110 group-[.active]:text-white"><Icon sx={{fontSize:20}}/></span><span className="relative min-w-0 flex-1 truncate">{label}</span><ChevronRightRoundedIcon className="relative opacity-0 transition group-hover:translate-x-1 group-hover:opacity-100" sx={{fontSize:18}}/></NavLink>)}</nav>
      <div className="relative mt-3 rounded-[24px] border border-white bg-white/80 p-3 shadow-[0_14px_40px_rgba(15,23,42,.08)]">
        <div className="flex items-center gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 via-cyan-500 to-blue-600 font-black text-white shadow-lg">{initials}</div><div className="min-w-0"><div className="truncate text-sm font-black">{user.firstName} {user.lastName}</div><div className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">{user.role.replaceAll('_',' ')}</div></div></div>
        <button onClick={()=>void doLogout()} className="group mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 via-red-500 to-orange-500 px-4 py-2.5 text-sm font-black text-white shadow-[0_10px_28px_rgba(244,63,94,.24)] transition hover:-translate-y-1 hover:shadow-[0_15px_38px_rgba(244,63,94,.34)]"><LogoutRoundedIcon fontSize="small" className="transition group-hover:-translate-x-1"/>Logout</button>
      </div>
    </aside>
    <section className="min-w-0 pt-16 lg:pt-0">
      <header className="sticky top-0 z-[60] border-b border-white/70 bg-white/75 px-4 py-3 shadow-[0_12px_40px_rgba(15,23,42,.08)] backdrop-blur-2xl sm:px-7">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500 text-white shadow-lg">
            {user.school?.logoUrl ? <img src={user.school.logoUrl} alt={`${schoolName} logo`} className="h-full w-full object-cover" /> : <SchoolRoundedIcon />}
          </div>
          <div className="min-w-0 flex-1"><p className="truncate text-lg font-black text-slate-950">{schoolName}</p><p className="truncate text-xs font-semibold text-slate-500">{user.school?.description || (user.role === 'SUPER_ADMIN' ? 'Secure multi-school administration' : 'Learning, progress and school operations')}</p></div>
          <div className="hidden rounded-2xl bg-gradient-to-r from-blue-50 to-violet-50 px-4 py-2 text-right sm:block"><p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-500">Current workspace</p><p className="text-sm font-black text-slate-700">{roleTitle[user.role]}</p></div>
        </div>
      </header>
      {children}
    </section>
  </div>
}
