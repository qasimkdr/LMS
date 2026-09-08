import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import RuleRoundedIcon from '@mui/icons-material/RuleRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import {
  Alert,
  Button,
  CircularProgress,
  LinearProgress,
  Skeleton,
  Switch,
  TextField,
} from '@mui/material';
import { useEffect, useState } from 'react';
import FileUpload from '../../components/storage/FileUpload';
import { api } from '../../lib/api';
import BackupRestorePanel from './components/BackupRestorePanel';
import StorageCleanupPanel from './components/StorageCleanupPanel';

type School = {
  name: string;
  logoUrl?: string | null;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  timezone: string;
  primaryColor: string;
  secondaryColor: string;
};

type Policy = {
  actionKey: string;
  requiresApproval: boolean;
  allowedForStaff: boolean;
};

type Usage = {
  usedBytes: number;
  limitBytes: number;
  files: number;
  percentage: number;
};

const mb = (value: number) =>
  (value / 1024 / 1024).toFixed(value >= 1024 * 1024 * 100 ? 0 : 1);

export default function PrincipalSettings() {
  const [school, setSchool] = useState<School | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: overview }, { data: policyRows }, { data: storageUsage }] =
        await Promise.all([
          api.get('/school-operations/overview'),
          api.get<Policy[]>('/policies'),
          api.get<Usage>('/storage/usage'),
        ]);
      setSchool(overview.school);
      setPolicies(policyRows);
      setUsage(storageUsage);
    } catch {
      setError('Could not load school settings.');
    } finally {
      setLoading(false);
    }
  };

  const refreshUsage = async () => {
    try {
      const { data } = await api.get<Usage>('/storage/usage');
      setUsage(data);
    } catch {
      setError('Storage cleanup completed, but the quota meter could not be refreshed.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveSchool = async () => {
    if (!school) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/school-operations/school', school);
      setSchool(data);
      setMessage('School branding updated.');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not save school settings.');
    } finally {
      setSaving(false);
    }
  };

  const updatePolicy = async (policy: Policy, patch: Partial<Policy>) => {
    const next = { ...policy, ...patch };
    setPolicies((items) =>
      items.map((item) => (item.actionKey === policy.actionKey ? next : item)),
    );
    try {
      await api.put('/policies', next);
    } catch {
      setPolicies((items) =>
        items.map((item) => (item.actionKey === policy.actionKey ? policy : item)),
      );
      setError('Could not update approval policy.');
    }
  };

  const exportBackup = async () => {
    setExporting(true);
    setError('');
    try {
      const response = await api.get('/backups/export', { responseType: 'blob' });
      const disposition = String(response.headers['content-disposition'] ?? '');
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const name =
        match?.[1] ??
        `nexora-school-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Give slower/cloud browsers time to consume the download first.
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setMessage('School backup exported securely.');
    } catch {
      setError('Could not export school backup.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fbff] p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton
              key={index}
              variant="rounded"
              height={120}
              sx={{ borderRadius: 5 }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!school) return null;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eef5ff,#fff_50%,#fff8ed)] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7">
          <span className="text-xs font-black uppercase tracking-[.22em] text-violet-600">
            School configuration
          </span>
          <h1 className="mt-2 text-3xl font-black text-slate-950 sm:text-4xl">
            Branding, controls & backup
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Manage school identity, approval rules, private storage and tenant-safe exports.
          </p>
        </header>

        {error && (
          <Alert severity="error" className="mb-4" onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {message && (
          <Alert severity="success" className="mb-4" onClose={() => setMessage('')}>
            {message}
          </Alert>
        )}

        <section className="glass-panel mb-6 rounded-[30px] p-5 md:p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 p-3 text-white">
              <PaletteRoundedIcon />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-950">School identity</h2>
              <p className="text-sm text-slate-500">
                Shown under Principal, Staff, Teacher, Student and Parent accounts.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="School name"
              value={school.name}
              onChange={(event) => setSchool({ ...school, name: event.target.value })}
            />
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">
                School logo
              </p>
              <FileUpload
                value={school.logoUrl ?? ''}
                onChange={(reference) =>
                  setSchool({ ...school, logoUrl: reference || null })
                }
                category="school-logo"
                label="Upload logo"
                accept=".jpg,.jpeg,.png,.webp,.gif"
              />
            </div>
            <TextField
              label="Email"
              value={school.email ?? ''}
              onChange={(event) => setSchool({ ...school, email: event.target.value })}
            />
            <TextField
              label="Phone"
              value={school.phone ?? ''}
              onChange={(event) => setSchool({ ...school, phone: event.target.value })}
            />
            <TextField
              label="Address"
              value={school.address ?? ''}
              onChange={(event) => setSchool({ ...school, address: event.target.value })}
            />
            <TextField
              label="Timezone"
              value={school.timezone}
              onChange={(event) => setSchool({ ...school, timezone: event.target.value })}
            />
            <TextField
              label="Primary color"
              value={school.primaryColor}
              onChange={(event) =>
                setSchool({ ...school, primaryColor: event.target.value })
              }
            />
            <TextField
              label="Secondary color"
              value={school.secondaryColor}
              onChange={(event) =>
                setSchool({ ...school, secondaryColor: event.target.value })
              }
            />
            <TextField
              className="sm:col-span-2"
              multiline
              minRows={3}
              label="School description"
              value={school.description ?? ''}
              onChange={(event) =>
                setSchool({ ...school, description: event.target.value })
              }
            />
          </div>

          <div className="mt-5 flex items-center gap-4">
            <div
              className="h-14 w-14 rounded-2xl border border-white shadow"
              style={{
                background: `linear-gradient(135deg,${school.primaryColor},${school.secondaryColor})`,
              }}
            />
            <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-500">
              {school.logoUrl ? 'Logo securely stored' : 'No logo uploaded'}
            </div>
            <Button
              variant="contained"
              onClick={saveSchool}
              disabled={saving}
              sx={{
                ml: 'auto',
                borderRadius: 3,
                fontWeight: 900,
                background: `linear-gradient(90deg,${school.primaryColor},${school.secondaryColor})`,
              }}
            >
              {saving ? <CircularProgress size={20} color="inherit" /> : 'Save branding'}
            </Button>
          </div>
        </section>

        {usage && (
          <section className="glass-panel mb-6 rounded-[30px] p-5 md:p-7">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 p-3 text-white">
                <StorageRoundedIcon />
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-black text-slate-950">Private storage</h2>
                    <p className="text-sm text-slate-500">
                      {usage.files} files · {mb(usage.usedBytes)} MB used of{' '}
                      {mb(usage.limitBytes)} MB
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${
                      usage.percentage >= 95
                        ? 'bg-rose-100 text-rose-700'
                        : usage.percentage >= 80
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {usage.percentage}% used
                  </span>
                </div>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, usage.percentage)}
                  sx={{ mt: 2, height: 10, borderRadius: 999 }}
                />
                {usage.percentage >= 80 && (
                  <Alert
                    severity={usage.percentage >= 95 ? 'error' : 'warning'}
                    sx={{ mt: 2, borderRadius: 3 }}
                  >
                    {usage.percentage >= 95
                      ? 'Storage is almost full. Remove unused files or increase the school quota.'
                      : 'Storage usage has crossed 80% of the school quota.'}
                  </Alert>
                )}
                <StorageCleanupPanel onCleaned={() => void refreshUsage()} />
              </div>
            </div>
          </section>
        )}

        <section className="glass-panel mb-6 rounded-[30px] p-5 md:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">School data backup</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Download a tenant-scoped JSON export of school configuration, users without password hashes, academics, attendance, fees, reports and file metadata. Stored file bytes are not duplicated.
              </p>
            </div>
            <Button
              variant="contained"
              startIcon={
                exporting ? <CircularProgress size={18} color="inherit" /> : <DownloadRoundedIcon />
              }
              disabled={exporting}
              onClick={exportBackup}
              sx={{
                borderRadius: 3,
                fontWeight: 900,
                minWidth: 190,
                background: 'linear-gradient(90deg,#059669,#2563eb)',
              }}
            >
              {exporting ? 'Exporting...' : 'Export backup'}
            </Button>
          </div>

          <BackupRestorePanel currentSchoolName={school.name} />
        </section>

        <section className="glass-panel rounded-[30px] p-5 md:p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-2xl bg-gradient-to-br from-amber-400 to-rose-500 p-3 text-white">
              <RuleRoundedIcon />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-950">Staff approval policy</h2>
              <p className="text-sm text-slate-500">
                Decide what Staff may do and whether Principal review is required.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {policies.map((policy) => (
              <div
                key={policy.actionKey}
                className="flex flex-col gap-3 rounded-[22px] border border-white bg-white/75 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-black text-slate-900">
                    {policy.actionKey.replaceAll('_', ' ')}
                  </p>
                  <p className="text-xs text-slate-400">
                    Configure Staff access for this action.
                  </p>
                </div>
                <div className="flex items-center gap-5 text-xs font-bold text-slate-600">
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={policy.allowedForStaff}
                      onChange={(event) =>
                        void updatePolicy(policy, { allowedForStaff: event.target.checked })
                      }
                    />
                    Staff allowed
                  </label>
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={policy.requiresApproval}
                      disabled={!policy.allowedForStaff}
                      onChange={(event) =>
                        void updatePolicy(policy, { requiresApproval: event.target.checked })
                      }
                    />
                    Needs approval
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
