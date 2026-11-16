'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { homeFor } from '@/components/auth';
import { Button, ErrorBox, Field } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  // Already logged in? Go straight to the dashboard.
  useEffect(() => {
    api
      .get<Me>('/auth/me')
      .then((me) => router.replace(me.user.mustChangePassword ? '/change-password' : homeFor(me.user.role)))
      .catch(() => undefined);
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ user: Me['user'] }>('/auth/login', { identifier, password });
      router.replace(res.user.mustChangePassword ? '/change-password' : homeFor(res.user.role));
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel (large screens): light, calm, with a few product facts. */}
      <section className="relative isolate hidden overflow-hidden border-r border-slate-200 bg-white p-12 lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute inset-0 -z-10 opacity-70 [background-image:radial-gradient(rgb(148_163_184/0.35)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
        <div aria-hidden className="absolute -right-24 top-24 -z-10 h-80 w-80 rounded-full bg-sky-100 blur-3xl" />
        <div aria-hidden className="absolute -bottom-24 left-10 -z-10 h-72 w-72 rounded-full bg-emerald-100/70 blur-3xl" />
        <div className="flex animate-fade-up items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white">S</div>
          <span className="text-lg font-semibold tracking-tight text-slate-900">School Management</span>
        </div>
        <div className="max-w-md animate-fade-up [animation-delay:120ms]">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-slate-900">
            Everything your school runs on, <span className="text-brand-600">in one place.</span>
          </h2>
          <p className="mt-4 text-slate-600">Attendance, fees, exams, homework, results and messages to parents — for principals, teachers, parents and students.</p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              ['✓', 'Attendance', 'bg-emerald-50 text-emerald-600 ring-emerald-100'],
              ['₨', 'Fees', 'bg-sky-50 text-sky-600 ring-sky-100'],
              ['✎', 'Results', 'bg-amber-50 text-amber-600 ring-amber-100'],
            ].map(([i, t, c], n) => (
              <div key={t} className="animate-fade-up rounded-2xl border border-slate-200 bg-white/80 p-4 text-center shadow-sm backdrop-blur" style={{ animationDelay: `${240 + n * 90}ms` }}>
                <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-xl text-lg ring-1 ${c}`}>{i}</div>
                <div className="mt-2 text-xs font-medium text-slate-600">{t}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-400">Secure login · your data stays with your school</p>
      </section>
      <div className="flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white lg:hidden">S</div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Welcome back</h1>
          <p className="mt-1 text-sm text-gray-500">Log in to your school account</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/[0.05]">
          <Field label="Username or email">
            <input className="input" autoComplete="username" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          </Field>
          <Field label="Password">
            <div className="relative">
              <input
                className="input pr-16"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs font-medium text-gray-500 hover:bg-gray-100">
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" className="w-full" loading={loading}>
            Log in
          </Button>
          <p className="text-center text-xs text-gray-500">Forgot your password? Ask your school principal to reset it.</p>
        </form>
      </div>
      </div>
    </main>
  );
}
