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
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">S</div>
          <h1 className="text-2xl font-semibold text-gray-900">Welcome back</h1>
          <p className="mt-1 text-sm text-gray-500">Log in to your school account</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
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
    </main>
  );
}
