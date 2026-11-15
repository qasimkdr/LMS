'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Button, Card, ErrorBox, Field, Loading, PageHeader } from '@/components/ui';

interface Overview {
  school: { name: string; code: string; address: string | null; city: string | null; phone: string | null; email: string | null; logoFileId: string | null };
}

export default function SettingsPage() {
  const toast = useToast();
  const { reload: reloadMe } = useAuth();
  const { data, loading, reload } = useData<Overview>('/school/overview');
  const [f, setF] = useState({ address: '', city: '', phone: '', email: '' });
  const [logoFileId, setLogoFileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data) return;
    const s = data.school;
    setF({ address: s.address ?? '', city: s.city ?? '', phone: s.phone ?? '', email: s.email ?? '' });
    setLogoFileId(s.logoFileId);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (!data) return null;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('category', 'LOGO');
      form.append('file', file);
      const res = await api.post<{ file: { id: string } }>('/files', form);
      setLogoFileId(res.file.id);
      toast('Logo uploaded. Click Save to use it.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch('/school/profile', { ...f, logoFileId });
      toast('School profile saved');
      reload();
      reloadMe();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="School profile" subtitle="Shown on report cards, receipts and vouchers" />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        <Card title="Logo">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
              {logoFileId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(logoFileId)} alt="School logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-gray-400">No logo</span>
              )}
            </div>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
            <Button type="button" variant="secondary" onClick={() => input.current?.click()} loading={uploading}>
              {logoFileId ? 'Change logo' : 'Upload logo'}
            </Button>
          </div>
        </Card>
        <Card title="Contact details" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="School name" hint="Contact support to change the name">
              <input className="input" value={data.school.name} disabled />
            </Field>
            <Field label="School code">
              <input className="input" value={data.school.code} disabled />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                <input className="input" value={f.address} onChange={set('address')} />
              </Field>
            </div>
            <Field label="City">
              <input className="input" value={f.city} onChange={set('city')} />
            </Field>
            <Field label="Phone">
              <input className="input" value={f.phone} onChange={set('phone')} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={f.email} onChange={set('email')} />
            </Field>
          </div>
          <div className="mt-5 space-y-3">
            <ErrorBox error={error} />
            <Button type="submit" loading={saving}>
              Save
            </Button>
          </div>
        </Card>
      </form>
    </>
  );
}
