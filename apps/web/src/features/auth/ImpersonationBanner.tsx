import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import { Button } from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export default function ImpersonationBanner(){
  const {user,exitImpersonation}=useAuth();
  const navigate=useNavigate();
  const [busy,setBusy]=useState(false);
  if(!user?.impersonating)return null;
  const exit=async()=>{setBusy(true);try{await exitImpersonation();navigate('/super-admin/schools',{replace:true});}finally{setBusy(false)}};
  return <div className="sticky top-0 z-[1500] flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-amber-300 via-orange-300 to-rose-300 px-4 py-2 text-sm font-black text-slate-900 shadow-lg"><div className="flex items-center gap-2"><SupportAgentRoundedIcon fontSize="small"/><span>Support session · Acting as Principal for {user.school?.name??'school'}</span></div><Button size="small" variant="contained" disabled={busy} onClick={()=>void exit()} sx={{borderRadius:2,fontWeight:900,background:'#0f172a'}}>Exit impersonation</Button></div>;
}
