import { useState } from 'react';
import { Alert, CircularProgress, IconButton, InputAdornment, TextField } from '@mui/material';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import AutoGraphRoundedIcon from '@mui/icons-material/AutoGraphRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthProvider';

function dashboardFor(role: string) {
  switch (role) {
    case 'SUPER_ADMIN': return '/super-admin';
    case 'PRINCIPAL': return '/principal';
    case 'STAFF': return '/staff';
    case 'TEACHER': return '/teacher';
    case 'STUDENT': return '/student';
    case 'PARENT': return '/parent';
    default: return '/login';
  }
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to={dashboardFor(user.role)} replace />;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const signedIn = await login(loginValue.trim(), password);
      navigate(dashboardFor(signedIn.role), { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Unable to sign in. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f9ff] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-14 h-72 w-72 rounded-full bg-blue-200/50 blur-3xl" />
        <div className="absolute right-0 top-1/4 h-80 w-80 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-amber-200/35 blur-3xl" />
      </div>

      <section className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <div className="hidden lg:block">
          <div className="mb-7 inline-flex items-center gap-3 rounded-2xl border border-white/70 bg-white/65 px-4 py-3 shadow-xl shadow-blue-100/40 backdrop-blur-xl">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-500 to-cyan-400 text-white shadow-lg shadow-blue-200"><SchoolRoundedIcon /></div>
            <div><p className="text-xs font-bold uppercase tracking-[.22em] text-blue-600">Nexora LMS</p><p className="text-sm font-semibold text-slate-700">Intelligent school operating system</p></div>
          </div>

          <h1 className="max-w-3xl text-5xl font-black leading-[1.02] tracking-[-.04em] xl:text-7xl">One platform to <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-cyan-500 bg-clip-text text-transparent">run, teach and grow</span> every school.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">Multi-school SaaS controls, principal approvals, teacher workflows, student and parent access, live analytics and modern learning tools in one connected system.</p>

          <div className="mt-8 grid max-w-2xl gap-4 sm:grid-cols-2">
            {[[<VerifiedUserRoundedIcon key="secure" />, 'Secure by design', 'Tenant-isolated access with role-based permissions.'],[<AutoGraphRoundedIcon key="analytics" />, 'Live intelligence', 'Animated analytics for attendance, results and growth.']].map(([icon, title, copy]) => (
              <div key={String(title)} className="rounded-3xl border border-white/70 bg-white/65 p-5 shadow-xl shadow-slate-200/40 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-2xl"><div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 text-white">{icon}</div><h2 className="font-extrabold">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{copy}</p></div>
            ))}
          </div>
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="rounded-[2rem] border border-white/80 bg-white/80 p-6 shadow-[0_30px_80px_rgba(80,95,140,.18)] backdrop-blur-2xl sm:p-8">
            <div className="mb-7"><div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-500 to-cyan-400 text-white shadow-xl shadow-blue-200 lg:hidden"><SchoolRoundedIcon /></div><p className="text-sm font-extrabold uppercase tracking-[.18em] text-blue-600">Welcome back</p><h2 className="mt-2 text-3xl font-black tracking-tight">Sign in to Nexora</h2><p className="mt-2 text-sm leading-6 text-slate-500">Use your email or username and your secure account password.</p></div>
            {error && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 3 }}>{error}</Alert>}
            <form className="space-y-5" onSubmit={handleSubmit}>
              <TextField fullWidth label="Email or username" value={loginValue} onChange={(e) => setLoginValue(e.target.value)} autoComplete="username" required InputProps={{ startAdornment: <InputAdornment position="start"><MailRoundedIcon fontSize="small" /></InputAdornment> }} />
              <TextField fullWidth label="Password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required InputProps={{ startAdornment: <InputAdornment position="start"><LockRoundedIcon fontSize="small" /></InputAdornment>, endAdornment: <InputAdornment position="end"><IconButton onClick={() => setShowPassword((value) => !value)} edge="end">{showPassword ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}</IconButton></InputAdornment> }} />
              <button disabled={submitting} className="group relative flex min-h-13 w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 px-5 py-3.5 font-extrabold text-white shadow-xl shadow-blue-200 transition duration-300 hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-70" type="submit"><span className="absolute inset-0 translate-x-[-120%] bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-[120%]" />{submitting ? <CircularProgress size={22} thickness={5} sx={{ color: 'white' }} /> : 'Enter Nexora LMS'}</button>
            </form>
            <p className="mt-6 text-center text-xs leading-5 text-slate-400">Sessions stay active for up to 3 days and can be revoked when a school account is suspended.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
