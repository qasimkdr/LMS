'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AuthProvider, homeFor, useAuth } from '@/components/auth';
import { Button, ErrorBox, Field, Loading } from '@/components/ui';
import { useToast } from '@/components/toast';

function ChangePassword() {
  const { me, loading, reload, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  if (loading) return <Loading />;
  if (!me) {
    router.replace('/login');
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError(new Error('New passwords do not match'));
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      const fresh = await reload();
      toast('Password changed');
      router.replace(homeFor(fresh!.user.role));
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">{me.user.mustChangePassword ? 'Set your own password' : 'Change password'}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {me.user.mustChangePassword
              ? `Hi ${me.user.fullName}, you logged in with a temporary password. Choose a new one to continue.`
              : 'You will be logged out on your other devices.'}
          </p>
        </div>
        <Field label={me.user.mustChangePassword ? 'Temporary password' : 'Current password'}>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 8 characters, with a letter and a number.">
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </Field>
        <Field label="Confirm new password">
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" className="w-full" loading={saving}>
          Save password
        </Button>
        <div className="flex justify-between text-sm">
          {!me.user.mustChangePassword ? (
            <button type="button" className="text-gray-500 hover:underline" onClick={() => router.back()}>
              Cancel
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="text-gray-500 hover:underline" onClick={logout}>
            Log out
          </button>
        </div>
      </form>
    </main>
  );
}

export default function Page() {
  return (
    <AuthProvider>
      <ChangePassword />
    </AuthProvider>
  );
}
