import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
} from '@mui/material';
import { useRef, useState } from 'react';
import { api } from '../../../lib/api';

type BackupValidation = {
  valid: boolean;
  restoreAllowed: boolean;
  format?: string;
  version?: number;
  exportedAt?: string;
  sourceSchool?: { id?: string; name?: string; slug?: string };
  currentSchool?: { id?: string; name?: string; slug?: string };
  counts?: Record<string, number>;
  issues?: string[];
  warnings?: string[];
};

type RestoreChange = {
  collection: string;
  current: number;
  backup: number;
  delta: number;
};

type RestorePlan = {
  dryRun: boolean;
  ready: boolean;
  school: { id: string; name: string; slug: string };
  backupFingerprint: string;
  exportedAt?: string;
  expiresAt: string;
  confirmationToken: string;
  confirmationPhrase: string;
  currentCounts: Record<string, number>;
  backupCounts: Record<string, number>;
  changes: RestoreChange[];
  protections: string[];
  warnings: string[];
};

type Props = {
  currentSchoolName: string;
};

const labelFor = (value: string) =>
  value.replaceAll(/([A-Z])/g, ' $1').replaceAll('_', ' ').trim();

export default function BackupRestorePanel({ currentSchoolName }: Props) {
  const [validating, setValidating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [fileName, setFileName] = useState('');
  const [payload, setPayload] = useState<unknown | null>(null);
  const [validation, setValidation] = useState<BackupValidation | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const validateFile = async (file: File) => {
    setValidating(true);
    setError('');
    setMessage('');
    setValidation(null);
    setPlan(null);
    setPayload(null);
    setFileName(file.name);

    try {
      if (file.size > 20 * 1024 * 1024) {
        throw new Error('Backup file is larger than the 20 MB restore limit.');
      }

      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Selected file is not valid JSON.');
      }

      try {
        const { data } = await api.post<BackupValidation>('/backups/validate', parsed);
        setValidation(data);
        setPayload(parsed);
        setMessage(
          data.restoreAllowed
            ? 'Backup is valid and matches this school. No data has been changed.'
            : 'Backup validation finished. Restore remains blocked.',
        );
      } catch (requestError: any) {
        const serverValidation = requestError?.response?.data as BackupValidation | undefined;
        if (serverValidation && serverValidation.valid === false) {
          setValidation(serverValidation);
          setError('Backup validation failed. Review the issues below.');
        } else {
          throw requestError;
        }
      }
    } catch (e: any) {
      setError(
        e?.response?.data?.message ?? e?.message ?? 'Could not validate the selected backup.',
      );
    } finally {
      setValidating(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const createPlan = async () => {
    if (!payload || !validation?.restoreAllowed) return;
    setPlanning(true);
    setError('');
    setMessage('');
    setPlan(null);
    try {
      const { data } = await api.post<RestorePlan>('/backups/restore-plan', payload);
      setPlan(data);
      setMessage('Dry-run restore plan created. No school data has been changed.');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not create the restore dry run.');
    } finally {
      setPlanning(false);
    }
  };

  return (
    <div className="mt-5 rounded-[24px] border border-violet-100 bg-gradient-to-br from-violet-50/90 to-blue-50/80 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 p-3 text-white">
            <RestoreRoundedIcon />
          </div>
          <div>
            <h3 className="font-black text-slate-950">Restore safety center</h3>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              Validate a Nexora backup, compare it with current school data and generate a signed dry-run plan before any restore can be confirmed.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void validateFile(file);
          }}
        />
        <Button
          variant="outlined"
          startIcon={validating ? <CircularProgress size={18} /> : <UploadFileRoundedIcon />}
          disabled={validating || planning}
          onClick={() => inputRef.current?.click()}
          sx={{ borderRadius: 3, fontWeight: 900, minWidth: 190 }}
        >
          {validating ? 'Validating...' : 'Choose backup'}
        </Button>
      </div>

      {error && (
        <Alert severity="error" sx={{ mt: 3, borderRadius: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {message && (
        <Alert severity="success" sx={{ mt: 3, borderRadius: 3 }} onClose={() => setMessage('')}>
          {message}
        </Alert>
      )}

      {fileName && (
        <p className="mt-4 text-xs font-bold text-slate-500">Selected: {fileName}</p>
      )}

      {validation && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Chip
              label={validation.valid ? 'Valid format' : 'Invalid backup'}
              color={validation.valid ? 'success' : 'error'}
              size="small"
            />
            <Chip
              label={validation.restoreAllowed ? 'Tenant match' : 'Restore blocked'}
              color={validation.restoreAllowed ? 'success' : 'warning'}
              size="small"
            />
            {validation.version != null && (
              <Chip label={`Version ${validation.version}`} size="small" />
            )}
          </div>

          {(validation.sourceSchool?.name || validation.currentSchool?.name) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/80 p-3">
                <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  Backup school
                </p>
                <p className="mt-1 font-black text-slate-900">
                  {validation.sourceSchool?.name ?? 'Unknown'}
                </p>
              </div>
              <div className="rounded-2xl bg-white/80 p-3">
                <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  Current school
                </p>
                <p className="mt-1 font-black text-slate-900">
                  {validation.currentSchool?.name ?? currentSchoolName}
                </p>
              </div>
            </div>
          )}

          {validation.counts && Object.keys(validation.counts).length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {Object.entries(validation.counts).map(([key, count]) => (
                <div key={key} className="rounded-2xl bg-white/80 p-3">
                  <p className="truncate text-[11px] font-bold text-slate-400">
                    {labelFor(key)}
                  </p>
                  <p className="mt-1 text-lg font-black text-slate-900">{count}</p>
                </div>
              ))}
            </div>
          )}

          {validation.issues?.map((issue) => (
            <Alert key={issue} severity="error" sx={{ borderRadius: 3 }}>
              {issue}
            </Alert>
          ))}
          {validation.warnings?.map((warning) => (
            <Alert key={warning} severity="warning" sx={{ borderRadius: 3 }}>
              {warning}
            </Alert>
          ))}

          {validation.restoreAllowed && !plan && (
            <div className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-black text-slate-900">Validation passed</p>
                <p className="mt-1 text-xs text-slate-500">
                  Generate the dry run to compare this backup with live tenant data. This step is read-only.
                </p>
              </div>
              <Button
                variant="contained"
                disabled={planning}
                onClick={() => void createPlan()}
                startIcon={planning ? <CircularProgress size={18} color="inherit" /> : <VerifiedUserRoundedIcon />}
                sx={{
                  borderRadius: 3,
                  fontWeight: 900,
                  minWidth: 190,
                  background: 'linear-gradient(90deg,#7c3aed,#2563eb)',
                }}
              >
                {planning ? 'Planning...' : 'Generate dry run'}
              </Button>
            </div>
          )}
        </div>
      )}

      {plan && (
        <div className="mt-5 space-y-4 rounded-[24px] border border-emerald-100 bg-white/90 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Chip label="Dry run ready" color="success" size="small" />
            <Chip label={`Fingerprint ${plan.backupFingerprint}`} size="small" />
            <Chip
              label={`Expires ${new Date(plan.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
              color="warning"
              size="small"
            />
          </div>

          <div>
            <h4 className="font-black text-slate-950">Current → backup impact</h4>
            <p className="mt-1 text-xs text-slate-500">
              These are record-count differences only. Nothing below has been written to the database.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {plan.changes.map((change) => (
              <div key={change.collection} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  {labelFor(change.collection)}
                </p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="font-black text-slate-900">
                    {change.current} → {change.backup}
                  </p>
                  <span
                    className={`text-xs font-black ${
                      change.delta > 0
                        ? 'text-emerald-600'
                        : change.delta < 0
                          ? 'text-rose-600'
                          : 'text-slate-400'
                    }`}
                  >
                    {change.delta > 0 ? '+' : ''}
                    {change.delta}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {plan.protections.map((protection) => (
            <Alert key={protection} severity="info" sx={{ borderRadius: 3 }}>
              {protection}
            </Alert>
          ))}
          {plan.warnings.map((warning) => (
            <Alert key={warning} severity="warning" sx={{ borderRadius: 3 }}>
              {warning}
            </Alert>
          ))}

          <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-rose-500">
              Future confirmation phrase
            </p>
            <code className="mt-2 block break-all rounded-xl bg-white px-3 py-2 text-sm font-black text-slate-900">
              {plan.confirmationPhrase}
            </code>
            <p className="mt-2 text-xs text-slate-500">
              The signed restore token is held only in this page state and expires automatically. Actual restore execution remains locked until the transactional importer is implemented and verified.
            </p>
            <Button disabled variant="contained" sx={{ mt: 2, borderRadius: 3, fontWeight: 900 }}>
              Restore execution locked
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
