import { createContext,useContext,useEffect,useMemo,useState,type PropsWithChildren } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';

export type ModuleKey='ATTENDANCE'|'TIMETABLE'|'ANNOUNCEMENTS'|'COURSEWORK'|'EXAMS'|'REPORTS'|'FINANCE'|'LEAVE'|'STORAGE'|'ANALYTICS'|'SUPPORT';
type Subscription={unrestricted:boolean;modules:ModuleKey[];planCode:string|null;planName?:string|null;endsAt?:string|null;schoolStatus?:string;subscriptionEnd?:string|null;graceEndsAt?:string|null;studentLimit?:number;teacherLimit?:number;storageLimitMb?:number};
type Value={subscription:Subscription|null;loading:boolean;hasModule:(module:ModuleKey)=>boolean;refresh:()=>Promise<void>};
const SubscriptionContext=createContext<Value|null>(null);

export function SubscriptionProvider({children}:PropsWithChildren){const{user}=useAuth();const[subscription,setSubscription]=useState<Subscription|null>(null),[loading,setLoading]=useState(false);const refresh=async()=>{if(!user){setSubscription(null);return}if(user.role==='SUPER_ADMIN'){setSubscription({unrestricted:true,modules:[],planCode:'PLATFORM'});return}setLoading(true);try{const{data}=await api.get<Subscription>('/subscription/current');setSubscription(data)}catch{setSubscription({unrestricted:true,modules:[],planCode:null})}finally{setLoading(false)}};useEffect(()=>{void refresh()},[user?.id,user?.schoolId,user?.role]);const hasModule=(module:ModuleKey)=>Boolean(subscription?.unrestricted||subscription?.modules.includes(module));const value=useMemo(()=>({subscription,loading,hasModule,refresh}),[subscription,loading]);return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>}
export function useSubscription(){const value=useContext(SubscriptionContext);if(!value)throw new Error('useSubscription must be used inside SubscriptionProvider');return value}
