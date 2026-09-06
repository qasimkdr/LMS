import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const data = [
  { month: 'Apr', score: 68, attendance: 86 },
  { month: 'May', score: 71, attendance: 88 },
  { month: 'Jun', score: 73, attendance: 87 },
  { month: 'Jul', score: 76, attendance: 90 },
  { month: 'Aug', score: 79, attendance: 91 },
  { month: 'Sep', score: 82, attendance: 93 },
];

export default function AcademicPerformanceChart() {
  return (
    <section className="glass-panel rounded-[30px] p-5 md:p-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-violet-600">Academic pulse</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">Performance & attendance</h2>
        </div>
        <p className="text-sm text-slate-500">Live API metrics will replace these seed values.</p>
      </div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c3aed" stopOpacity={0.38}/><stop offset="100%" stopColor="#7c3aed" stopOpacity={0.02}/></linearGradient>
              <linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.28}/><stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02}/></linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
            <YAxis domain={[50,100]} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
            <Tooltip contentStyle={{ borderRadius: 18, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15,23,42,.12)' }} />
            <Area type="monotone" dataKey="score" name="Average score" stroke="#7c3aed" strokeWidth={3} fill="url(#scoreFill)" animationDuration={1200} />
            <Area type="monotone" dataKey="attendance" name="Attendance" stroke="#0ea5e9" strokeWidth={3} fill="url(#attendanceFill)" animationDuration={1450} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
