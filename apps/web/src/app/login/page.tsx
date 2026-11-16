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
      {/* Brand panel (large screens) */}
      <section className="relative isolate hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute -left-24 -top-24 -z-10 h-96 w-96 animate-float rounded-full bg-brand-600/50 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 right-0 -z-10 h-[28rem] w-[28rem] animate-float rounded-full bg-violet-600/40 blur-3xl [animation-delay:-3s]" />
        <div aria-hidden className="absolute inset-0 -z-10 opacity-[0.12] [background-image:radial-gradient(rgb(255_255_255/0.7)_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="flex animate-fade-up items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 via-indigo-500 to-violet-600 text-lg font-bold shadow-lg shadow-brand-600/40">S</div>
          <span className="text-lg font-semibold tracking-tight">School Management</span>
        </div>
        <div className="max-w-md animate-fade-up [animation-delay:120ms]">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Everything your school runs on,{' '}
            <span className="bg-gradient-to-r from-sky-300 via-indigo-300 to-fuchsia-300 bg-clip-text text-transparent">in one place.</span>
          </h2>
          <p className="mt-4 text-white/70">Attendance, fees, exams, homework, results and messages to parents — for principals, teachers, parents and students.</p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              ['✓', 'Attendance'],
              ['₨', 'Fees'],
              ['✎', 'Results'],
            ].map(([i, t], n) => (
              <div key={t} className="glass animate-fade-up rounded-2xl p-4 text-center" style={{ animationDelay: `${240 + n * 90}ms` }}>
                <div className="text-xl">{i}</div>
                <div className="mt-1 text-xs text-white/75">{t}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-white/40">Secure login · your data stays with your school</p>
      </section>
      <div className="flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-lg font-bold text-white shadow-lg shadow-brand-600/30 lg:hidden">S</div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Welcome back</h1>
          <p className="mt-1 text-sm text-gray-500">Log in to your school account</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-3xl border border-gray-200/70 bg-white/90 p-6 shadow-xl shadow-gray-900/[0.06] backdrop-blur">
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
