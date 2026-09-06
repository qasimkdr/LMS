import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import { Alert, Button, Skeleton } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

type Notification={id:string;type:string;title:string;message:string;link?:string|null;isRead:boolean;createdAt:string};
export default function NotificationCenter(){
 const [items,setItems]=useState<Notification[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const load=async()=>{setLoading(true);try{const {data}=await api.get<Notification[]>('/notifications');setItems(data);}catch{setError('Could not load notifications.');}finally{setLoading(false);}};
 useEffect(()=>{void load();},[]);
 const mark=async(id:string)=>{await api.patch(`/notifications/${id}/read`);setItems(v=>v.map(n=>n.id===id?{...n,isRead:true}:n));};
 const markAll=async()=>{await api.patch('/notifications/read-all');setItems(v=>v.map(n=>({...n,isRead:true})));};
 return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eaf3ff,#fff_48%,#fff8ed)] px-4 py-6 sm:px-8"><section className="mx-auto max-w-4xl"><header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><span className="text-xs font-black uppercase tracking-[.22em] text-blue-600">Nexora alerts</span><h1 className="mt-2 text-3xl font-black text-slate-950">Notification center</h1><p className="mt-2 text-sm text-slate-500">Assignments, grades, announcements and account activity in one place.</p></div><Button startIcon={<DoneAllRoundedIcon/>} onClick={()=>void markAll()} sx={{borderRadius:3,fontWeight:900}}>Mark all read</Button></header>{error&&<Alert severity="error" className="mb-4" onClose={()=>setError('')}>{error}</Alert>}{loading?<div className="space-y-3">{[1,2,3,4].map(i=><Skeleton key={i} variant="rounded" height={100} sx={{borderRadius:4}}/>)}</div>:<div className="space-y-3">{items.map(n=><article key={n.id} className={`rounded-[24px] border p-4 shadow-sm transition ${n.isRead?'border-white bg-white/70':'border-blue-100 bg-blue-50/80'}`}><div className="flex gap-3"><div className="mt-1 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 p-2 text-white"><NotificationsActiveRoundedIcon fontSize="small"/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-black text-slate-900">{n.title}</h2><span className="text-xs font-bold text-slate-400">{new Date(n.createdAt).toLocaleString()}</span></div><p className="mt-1 text-sm text-slate-600">{n.message}</p><div className="mt-3 flex gap-3">{n.link&&<Link onClick={()=>void mark(n.id)} to={n.link} className="text-sm font-black text-blue-600">Open</Link>}{!n.isRead&&<button onClick={()=>void mark(n.id)} className="text-sm font-bold text-slate-500">Mark read</button>}</div></div></div></article>)}{!items.length&&<div className="rounded-[24px] border border-dashed border-slate-300 py-16 text-center text-slate-500">No notifications yet.</div>}</div>}</section></main>;
}
