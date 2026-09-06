import AddBusinessIcon from '@mui/icons-material/AddBusiness';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Skeleton, TextField } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import SchoolCard, { type SchoolSummary } from './components/SchoolCard';

type CreateSchoolForm = {
  name: string; slug: string; email: string; phone: string; address: string; description: string;
  studentLimit: number; teacherLimit: number; storageLimitMb: number;
  principalFirstName: string; principalLastName: string; principalEmail: string; principalUsername: string; principalPassword: string;
};

const blank: CreateSchoolForm = {
  name: '', slug: '', email: '', phone: '', address: '', description: '', studentLimit: 1000, teacherLimit: 100, storageLimitMb: 1024,
  principalFirstName: '', principalLastName: '', principalEmail: '', principalUsername: '', principalPassword: '',
};

export default function SuperAdminSchools() {
  const [schools, setSchools] = useState<SchoolSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get<SchoolSummary[]>('/super-admin/schools'); setSchools(data); }
    catch { setError('Could not load schools.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => schools.filter((s) => `${s.name} ${s.slug} ${s.users[0]?.email ?? ''}`.toLowerCase().includes(query.toLowerCase())), [schools, query]);

  const changeStatus = async (school: SchoolSummary, status: SchoolSummary['status']) => {
    setBusyId(school.id); setError('');
    try {
      const { data } = await api.patch<SchoolSummary>(`/super-admin/schools/${school.id}/status`, { status, reason: 'Changed from Super Admin dashboard' });
      setSchools((prev) => prev.map((item) => item.id === school.id ? { ...item, ...data } : item));
    } catch { setError('School status could not be updated.'); }
    finally { setBusyId(null); }
  };

  const createSchool = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/super-admin/schools', {
        name: form.name, slug: form.slug, email: form.email || undefined, phone: form.phone || undefined, address: form.address || undefined,
        description: form.description || undefined, studentLimit: Number(form.studentLimit), teacherLimit: Number(form.teacherLimit), storageLimitMb: Number(form.storageLimitMb),
        principal: { firstName: form.principalFirstName, lastName: form.principalLastName, email: form.principalEmail, username: form.principalUsername, password: form.principalPassword },
      });
      setOpen(false); setForm(blank); await load();
    } catch (e: any) { setError(e?.response?.data?.message ?? 'School could not be created.'); }
    finally { setSaving(false); }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e9f2ff_0,#f8fbff_35%,#fffaf4_100%)] px-4 py-6 sm:px-8 lg:px-10">
      <section className="mx-auto max-w-7xl">
        <header className="mb-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div><span className="text-xs font-black uppercase tracking-[.24em] text-blue-600">Nexora Control Center</span><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Schools & subscriptions</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">Create tenant schools, control access states, quotas and principal ownership from one platform.</p></div>
          <Button startIcon={<AddBusinessIcon />} variant="contained" onClick={() => setOpen(true)} sx={{ borderRadius: 3, px: 3, py: 1.4, fontWeight: 900, background: 'linear-gradient(90deg,#2563eb,#7c3aed)' }}>Add school</Button>
        </header>

        {error && <Alert severity="error" className="mb-5" onClose={() => setError('')}>{error}</Alert>}

        <div className="mb-6 flex flex-col gap-3 rounded-[24px] border border-white bg-white/70 p-3 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-slate-50 px-4"><SearchIcon className="text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search school, slug or principal email" className="h-12 w-full bg-transparent text-sm outline-none" /></div>
          <Button startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading} sx={{ borderRadius: 3, fontWeight: 800 }}>Refresh</Button>
        </div>

        {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} variant="rounded" height={235} sx={{ borderRadius: 7 }} />)}</div> : filtered.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((school) => <SchoolCard key={school.id} school={school} busy={busyId === school.id} onStatus={(status) => void changeStatus(school, status)} />)}</div> : <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/60 py-20 text-center text-slate-500">No schools match your search.</div>}
      </section>

      <Dialog open={open} onClose={() => !saving && setOpen(false)} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 5 } }}>
        <DialogTitle sx={{ fontWeight: 900 }}>Create new Nexora school</DialogTitle>
        <DialogContent><div className="grid gap-4 pt-2 sm:grid-cols-2">
          <Field label="School name" value={form.name} set={(v) => setForm({ ...form, name: v, slug: form.slug || v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') })} />
          <Field label="School slug" value={form.slug} set={(v) => setForm({ ...form, slug: v.toLowerCase() })} />
          <Field label="School email" value={form.email} set={(v) => setForm({ ...form, email: v })} />
          <Field label="Phone" value={form.phone} set={(v) => setForm({ ...form, phone: v })} />
          <Field label="Address" value={form.address} set={(v) => setForm({ ...form, address: v })} />
          <Field label="Description" value={form.description} set={(v) => setForm({ ...form, description: v })} />
          <NumberField label="Student limit" value={form.studentLimit} set={(v) => setForm({ ...form, studentLimit: v })} />
          <NumberField label="Teacher limit" value={form.teacherLimit} set={(v) => setForm({ ...form, teacherLimit: v })} />
          <NumberField label="Storage MB" value={form.storageLimitMb} set={(v) => setForm({ ...form, storageLimitMb: v })} />
          <div className="sm:col-span-2 mt-2 border-t border-slate-100 pt-4 text-sm font-black text-slate-700">Principal account</div>
          <Field label="First name" value={form.principalFirstName} set={(v) => setForm({ ...form, principalFirstName: v })} />
          <Field label="Last name" value={form.principalLastName} set={(v) => setForm({ ...form, principalLastName: v })} />
          <Field label="Principal email" value={form.principalEmail} set={(v) => setForm({ ...form, principalEmail: v })} />
          <Field label="Username" value={form.principalUsername} set={(v) => setForm({ ...form, principalUsername: v })} />
          <Field label="Temporary password" type="password" value={form.principalPassword} set={(v) => setForm({ ...form, principalPassword: v })} />
        </div></DialogContent>
        <DialogActions sx={{ p: 3 }}><Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button variant="contained" onClick={() => void createSchool()} disabled={saving || !form.name || !form.slug || !form.principalEmail || form.principalPassword.length < 8} sx={{ borderRadius: 3, fontWeight: 900 }}>{saving ? <CircularProgress size={20} color="inherit" /> : 'Create school'}</Button></DialogActions>
      </Dialog>
    </main>
  );
}

function Field({ label, value, set, type = 'text' }: { label: string; value: string; set: (v: string) => void; type?: string }) { return <TextField label={label} value={value} type={type} onChange={(e) => set(e.target.value)} fullWidth />; }
function NumberField({ label, value, set }: { label: string; value: number; set: (v: number) => void }) { return <TextField label={label} type="number" value={value} onChange={(e) => set(Number(e.target.value))} fullWidth />; }
