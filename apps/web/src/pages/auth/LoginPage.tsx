import { useState } from 'react';
import { Alert, CircularProgress } from '@mui/material';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import AutoGraphRoundedIcon from '@mui/icons-material/AutoGraphRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import { Link, Navigate, useNavigate } from 'react-router-dom';
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
    <main className="relative min-h-screen overflow-x-hidden bg-[#050816] px-4 py-6 text-white sm:px-6 sm:py-8 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-blue-600/20 blur-[100px]" />
        <div className="absolute right-[-6rem] top-1/3 h-80 w-80 rounded-full bg-violet-600/20 blur-[110px]" />
      </div>

      <section className="relative mx-auto grid min-h-[calc(100vh-3rem)] max-w-7xl items-center gap-10 lg:grid-cols-[1.05fr_.95fr]">
        <div className="hidden lg:block">
          <Link to="/" className="mb-7 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.06] px-4 py-3 backdrop-blur-xl">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-blue-500 to-cyan-400 shadow-lg shadow-violet-500/25"><SchoolRoundedIcon /></div>
            <div><p className="text-xs font-bold uppercase tracking-[.22em] text-violet-300">Nexora LMS</p><p className="text-sm font-semibold text-slate-300">Intelligent school operating system</p></div>
          </Link>
          <h1 className="max-w-3xl text-5xl font-black leading-[1.02] tracking-[-.04em] xl:text-7xl">One platform to <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-300 bg-clip-text text-transparent">run, teach and grow</span> every school.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-400">Secure multi-school controls, principal approvals, teacher workflows, student and parent access, analytics and modern learning tools.</p>
          <div className="mt-8 grid max-w-2xl gap-4 sm:grid-cols-2">
            {[[<VerifiedUserRoundedIcon key="secure" />, 'Secure by design', 'Tenant-isolated access with role-based permissions.'],[<AutoGraphRoundedIcon key="analytics" />, 'Live intelligence', 'Analytics for attendance, results and school operations.']].map(([icon, title, copy]) => (
              <div key={String(title)} className="rounded-3xl border border-white/10 bg-white/[.05] p-5 backdrop-blur-xl"><div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-cyan-400/20 text-cyan-300">{icon}</div><h2 className="font-extrabold">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{copy}</p></div>
            ))}
          </div>
        </div>

        <div className="mx-auto w-full max-w-md min-w-0">
          <div className="w-full rounded-[2rem] border border-white/10 bg-white/[.07] p-5 shadow-[0_30px_100px_rgba(88,62,255,.2)] backdrop-blur-2xl sm:p-8">
            <div className="mb-7 min-w-0">
              <Link to="/" className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-blue-500 to-cyan-400 text-white shadow-xl shadow-violet-500/20 lg:hidden"><SchoolRoundedIcon /></Link>
              <p className="text-sm font-extrabold uppercase tracking-[.18em] text-violet-300">Welcome back</p>
              <h2 className="mt-2 break-words text-3xl font-black tracking-tight">Sign in to Nexora</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Use your email or username and your secure account password.</p>
            </div>

            {error && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 3 }}>{error}</Alert>}

            <form className="flex w-full min-w-0 flex-col gap-5" onSubmit={handleSubmit}>
              <label className="block w-full min-w-0">
                <span className="mb-2 block text-sm font-bold text-slate-300">Email or username</span>
                <span className="flex h-14 w-full min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[.05] px-4 transition focus-within:border-violet-400/60 focus-within:bg-white/[.07]">
                  <MailRoundedIcon fontSize="small" className="shrink-0 text-slate-500" />
                  <input className="h-full min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-600" value={loginValue} onChange={(e) => setLoginValue(e.target.value)} autoComplete="username" inputMode="email" placeholder="you@school.com" required />
                </span>
              </label>

              <label className="block w-full min-w-0">
                <span className="mb-2 block text-sm font-bold text-slate-300">Password</span>
                <span className="flex h-14 w-full min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[.05] px-4 transition focus-within:border-violet-400/60 focus-within:bg-white/[.07]">
                  <LockRoundedIcon fontSize="small" className="shrink-0 text-slate-500" />
                  <input className="h-full min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-600" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Enter your password" required />
                  <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-white">{showPassword ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}</button>
                </span>
              </label>

              <button disabled={submitting} className="group relative mt-1 flex h-14 w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-violet-500 via-purple-500 to-blue-500 px-5 font-extrabold text-white shadow-xl shadow-violet-500/20 transition duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70" type="submit">
                <span className="absolute inset-0 translate-x-[-120%] bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-[120%]" />
                <span className="relative">{submitting ? <CircularProgress size={22} thickness={5} sx={{ color: 'white' }} /> : 'Enter Nexora LMS'}</span>
              </button>
            </form>

            <p className="mt-6 text-center text-xs leading-5 text-slate-500">Sessions stay active for up to 3 days and can be revoked when a school account is suspended.</p>
            <Link to="/" className="mt-4 block text-center text-sm font-bold text-violet-300 hover:text-violet-200">← Back to homepage</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
