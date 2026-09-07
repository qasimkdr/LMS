import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useState } from 'react';
import { api } from '../../../lib/api';

type OrphanObject = {
  id: string;
  fileName: string;
  category: string;
  mimeType: string;
  sizeBytes: number;
  createdAt?: string | null;
};

type ScanResult = {
  dryRun: boolean;
  olderThanHours: number;
  count: number;
  bytes: number;
  skippedCategories: string[];
  objects: OrphanObject[];
};

type CleanupResult = {
  ok: boolean;
  scanned: number;
  deleted: number;
  deletedBytes: number;
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; reason: string }>;
};

type Props = {
  onCleaned?: () => void;
};

const mb = (bytes: number) =>
  (bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1);

export default function StorageCleanupPanel({ onCleaned }: Props) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const scanOrphans = async () => {
    setScanning(true);
    setError('');
    setMessage('');
    try {
      const { data } = await api.get<ScanResult>('/storage/orphans', {
        params: { olderThanHours: 24, limit: 200 },
      });
      setScan(data);
      if (!data.count) setMessage('No safely-detectable orphan files older than 24 hours were found.');
    } catch (scanError: any) {
      setError(scanError?.response?.data?.message ?? 'Could not scan storage for unused files.');
    } finally {
      setScanning(false);
    }
  };

  const cleanup = async () => {
    setCleaning(true);
    setError('');
    try {
      const { data } = await api.post<CleanupResult>('/storage/orphans/cleanup', {
        olderThanHours: 24,
        limit: 100,
        confirm: 'DELETE_ORPHANS',
      });
      setConfirmOpen(false);
      setMessage(
        `Removed ${data.deleted} unused file${data.deleted === 1 ? '' : 's'} and reclaimed ${mb(data.deletedBytes)} MB.`,
      );
      if (data.failed.length) {
        setError(`${data.failed.length} file${data.failed.length === 1 ? '' : 's'} could not be removed.`);
      }
      await scanOrphans();
      onCleaned?.();
    } catch (cleanupError: any) {
      setError(cleanupError?.response?.data?.message ?? 'Storage cleanup failed.');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-black text-slate-900">Unused upload cleanup</p>
          <p className="mt-1 text-xs text-slate-500">
            Scans only logo, assignment, material and submission uploads whose references can be verified safely. Exam, report and general files are never auto-cleaned.
          </p>
        </div>
        <Button
          variant="outlined"
          startIcon={scanning ? <CircularProgress size={16} /> : <SearchRoundedIcon />}
          disabled={scanning || cleaning}
          onClick={() => void scanOrphans()}
          sx={{ borderRadius: 3, fontWeight: 800, whiteSpace: 'nowrap' }}
        >
          {scanning ? 'Scanning...' : 'Scan unused files'}
        </Button>
      </div>

      {scan && scan.count > 0 && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-black text-amber-900">
              {scan.count} unused file{scan.count === 1 ? '' : 's'} · {mb(scan.bytes)} MB reclaimable
            </p>
            <p className="mt-1 text-xs font-semibold text-amber-700">
              Only files older than 24 hours are shown. Every file is checked again immediately before deletion.
            </p>
          </div>
          <Button
            color="error"
            variant="contained"
            startIcon={<DeleteSweepRoundedIcon />}
            disabled={cleaning}
            onClick={() => setConfirmOpen(true)}
            sx={{ borderRadius: 3, fontWeight: 900, whiteSpace: 'nowrap' }}
          >
            Clean unused files
          </Button>
        </div>
      )}

      {scan && scan.objects.length > 0 && (
        <div className="mt-3 max-h-44 space-y-2 overflow-auto rounded-2xl border border-slate-100 bg-white p-3">
          {scan.objects.slice(0, 25).map((object) => (
            <div key={object.id} className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <p className="truncate font-bold text-slate-700">{object.fileName}</p>
                <p className="text-slate-400">{object.category}</p>
              </div>
              <span className="whitespace-nowrap font-black text-slate-500">{mb(object.sizeBytes)} MB</span>
            </div>
          ))}
          {scan.objects.length > 25 && (
            <p className="text-xs font-bold text-slate-400">+ {scan.objects.length - 25} more files</p>
          )}
        </div>
      )}

      {message && <Alert severity="success" sx={{ mt: 3, borderRadius: 3 }} onClose={() => setMessage('')}>{message}</Alert>}
      {error && <Alert severity="error" sx={{ mt: 3, borderRadius: 3 }} onClose={() => setError('')}>{error}</Alert>}

      <Dialog open={confirmOpen} onClose={() => !cleaning && setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Delete verified unused uploads?</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ borderRadius: 3 }}>
            This permanently removes the currently detected unused storage objects from Supabase and their Nexora metadata. Referenced files are re-checked and skipped automatically.
          </Alert>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button disabled={cleaning} onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={cleaning}
            startIcon={cleaning ? <CircularProgress size={16} color="inherit" /> : <DeleteSweepRoundedIcon />}
            onClick={() => void cleanup()}
            sx={{ borderRadius: 3, fontWeight: 900 }}
          >
            {cleaning ? 'Cleaning...' : 'Delete verified orphans'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
