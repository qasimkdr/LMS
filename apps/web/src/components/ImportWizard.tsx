'use client';

import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, ErrorBox, Table, Td } from './ui';
import { Credentials, type Login } from './Credentials';

interface RowResult {
  line: number;
  name: string;
  className: string;
  errors: string[];
  family: string;
}
interface Preview {
  total: number;
  valid: number;
  invalid: number;
  results: RowResult[];
}
interface CreatedStudent {
  fullName: string;
  admissionNo?: string;
  logins?: Login[];
  username?: string;
  tempPassword?: string;
  role?: string;
}

/** Upload → preview with row errors → import valid rows → show login slips. */
export function ImportWizard({ kind, schoolName }: { kind: 'students' | 'staff'; schoolName?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [created, setCreated] = useState<CreatedStudent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);

  async function send(f: File, commit: boolean) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', f);
    try {
      const r = await api.post<Preview & { created?: CreatedStudent[] }>(`/import/${kind}${commit ? '?commit=true&skipInvalid=true' : ''}`, form);
      if (commit) setCreated(r.created ?? []);
      else setPreview(r);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && (e.details as { results?: RowResult[] })?.results) {
        setPreview((p) => (p ? { ...p, results: (e.details as { results: RowResult[] }).results } : p));
      }
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const logins: Login[] =
      kind === 'students'
        ? created.flatMap((c) => (c.logins ?? []).map((l) => ({ ...l, forName: l.role === 'PARENT' ? `parent of ${c.fullName}` : undefined })))
        : created.map((c) => ({ role: c.role!, username: c.username!, tempPassword: c.tempPassword!, fullName: c.fullName }));
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 print:hidden">
          Imported {created.length} {kind === 'students' ? 'student' : 'staff member'}
          {created.length === 1 ? '' : 's'}.
        </div>
        <Credentials logins={logins} schoolName={schoolName} />
      </div>
    );
  }

  const rows = preview ? (onlyErrors ? preview.results.filter((r) => r.errors.length) : preview.results) : [];

  return (
    <div className="space-y-6">
      <Card title="1. Download the template">
        <p className="text-sm text-gray-600">
          Fill in one row per {kind === 'students' ? 'student' : 'staff member'}.{' '}
          {kind === 'students' && 'Brothers and sisters with the same father CNIC or mobile number are linked as one family with one parent login.'}
        </p>
        <a href={`/api/import/${kind}/template`} className="mt-3 inline-block">
          <Button type="button" variant="secondary">
            Download Excel template
          </Button>
        </a>
      </Card>
      <Card title="2. Upload the filled file">
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFile(f);
            setPreview(null);
            send(f, false);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => input.current?.click()} loading={busy && !preview}>
            {file ? 'Choose another file' : 'Choose file'}
          </Button>
          {file && <span className="text-sm text-gray-600">{file.name}</span>}
        </div>
        <p className="mt-2 text-xs text-gray-500">Excel (.xlsx) or CSV, up to 2000 rows. Nothing is saved until you confirm.</p>
      </Card>
      <ErrorBox error={error} />
      {preview && (
        <Card
          title="3. Check and import"
          actions={
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Show only rows with errors
            </label>
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="gray">{preview.total} rows</Badge>
            <Badge tone="green">{preview.valid} ready</Badge>
            {preview.invalid > 0 && <Badge tone="red">{preview.invalid} with errors (will be skipped)</Badge>}
          </div>
          <Table head={['Row', 'Name', kind === 'students' ? 'Class' : 'Role', ...(kind === 'students' ? ['Family'] : []), 'Result']}>
            {rows.map((r) => (
              <tr key={r.line} className={r.errors.length ? 'bg-red-50/50' : ''}>
                <Td className="text-gray-500">{r.line}</Td>
                <Td className="font-medium">{r.name}</Td>
                <Td>{r.className}</Td>
                {kind === 'students' && <Td className="text-gray-600">{r.family}</Td>}
                <Td className="whitespace-normal">
                  {r.errors.length ? <span className="text-red-700">{r.errors.join(' · ')}</span> : <span className="text-emerald-700">Ready</span>}
                </Td>
              </tr>
            ))}
          </Table>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => file && send(file, true)} loading={busy} disabled={preview.valid === 0}>
              Import {preview.valid} row{preview.valid === 1 ? '' : 's'}
            </Button>
            {preview.invalid > 0 && <span className="text-sm text-gray-500">Or fix the errors in Excel and upload again.</span>}
          </div>
        </Card>
      )}
    </div>
  );
}
