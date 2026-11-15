'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '../useData';
import { useToast } from '../toast';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal } from '../ui';
import { className } from '@/lib/types';
import { useFeePerms, useMoney } from './shared';

interface Head {
  id: string;
  name: string;
  frequency: 'MONTHLY' | 'SELECTED_MONTHS' | 'ONE_TIME';
  months: number[] | null;
  discountable: boolean;
  sortOrder: number;
  isActive: boolean;
  classFees: { classId: string; amount: number }[];
}
interface SetupData {
  heads: Head[];
  classes: { id: string; name: string; stream: string | null; students: number }[];
  settings: {
    dueDay: number;
    lateFeeType: string;
    lateFeeAmount: number;
    lateFeeMax: number;
    autoGenerate: boolean;
    bankDetails: Record<string, string | null> | null;
    voucherNote: string | null;
    receiptPrefix: string;
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const freqLabel = { MONTHLY: 'Every month', SELECTED_MONTHS: 'Some months', ONE_TIME: 'One-off only' };

export function FeeSetup() {
  const toast = useToast();
  const perms = useFeePerms();
  const { data, error, loading, reload } = useData<SetupData>('/fees/setup');
  const [editing, setEditing] = useState<Head | 'new' | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <div className="space-y-6">
      <Card
        title="Fee heads"
        actions={
          <div className="flex gap-2">
            {data.heads.length === 0 && (
              <Button
                variant="secondary"
                onClick={async () => {
                  await api.post('/fees/heads/presets');
                  toast('Common fee heads added');
                  reload();
                }}
              >
                Add common heads
              </Button>
            )}
            <Button onClick={() => setEditing('new')}>+ Fee head</Button>
          </div>
        }
      >
        {data.heads.length === 0 ? (
          <Empty title="No fee heads yet">Start with tuition fee, annual charges, exam fee…</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.heads.map((h) => (
              <li key={h.id} className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${h.isActive ? '' : 'opacity-50'}`}>
                <span>
                  <span className="font-medium">{h.name}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {freqLabel[h.frequency]}
                    {h.frequency === 'SELECTED_MONTHS' && h.months && ` (${h.months.map((m) => MONTHS[m - 1]).join(', ')})`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {h.discountable && <Badge tone="blue">Discounts apply</Badge>}
                  {!h.isActive && <Badge>Not in use</Badge>}
                  <Button variant="ghost" onClick={() => setEditing(h)}>
                    Edit
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data.heads.length > 0 && <StructureGrid data={data} onSaved={reload} />}
      <SettingsForm data={data} onSaved={reload} />
      {perms.isPrincipal && <GatewaySettings />}
      {editing && <HeadModal head={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function HeadModal({ head, onClose, onSaved }: { head: Head | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: head?.name ?? '', frequency: head?.frequency ?? 'MONTHLY', months: head?.months ?? [], discountable: head?.discountable ?? true, sortOrder: head?.sortOrder ?? 0, isActive: head?.isActive ?? true });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={head ? `Edit ${head.name}` : 'New fee head'}>
      <div className="space-y-4">
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Tuition fee" />
        </Field>
        <Field label="Charged">
          <select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Head['frequency'] })}>
            <option value="MONTHLY">Every month</option>
            <option value="SELECTED_MONTHS">Only in some months (annual, exam fee…)</option>
            <option value="ONE_TIME">Only as a one-off charge (admission, books…)</option>
          </select>
        </Field>
        {f.frequency === 'SELECTED_MONTHS' && (
          <div className="grid grid-cols-6 gap-1">
            {MONTHS.map((m, i) => (
              <label key={m} className={`flex cursor-pointer items-center justify-center rounded-lg border py-1.5 text-xs ${f.months.includes(i + 1) ? 'border-brand-500 bg-brand-50 font-semibold' : 'border-gray-200'}`}>
                <input type="checkbox" className="sr-only" checked={f.months.includes(i + 1)} onChange={(e) => setF({ ...f, months: e.target.checked ? [...f.months, i + 1].sort((a, b) => a - b) : f.months.filter((x) => x !== i + 1) })} />
                {m}
              </label>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.discountable} onChange={(e) => setF({ ...f, discountable: e.target.checked })} /> Student discounts (sibling, scholarship…) apply to this fee
        </label>
        {head && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> In use
          </label>
        )}
        <ErrorBox error={error} />
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              if (head) await api.patch(`/fees/heads/${head.id}`, f);
              else await api.post('/fees/heads', f);
              toast('Saved');
              onSaved();
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

function StructureGrid({ data, onSaved }: { data: SetupData; onSaved: () => void }) {
  const toast = useToast();
  const money = useMoney();
  const heads = data.heads.filter((h) => h.isActive && h.frequency !== 'ONE_TIME');
  const initial = () => Object.fromEntries(heads.flatMap((h) => data.classes.map((c) => [`${c.id}:${h.id}`, String(h.classFees.find((x) => x.classId === c.id)?.amount ?? '')])));
  const [grid, setGrid] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setGrid(initial()), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!heads.length) return null;
  const monthly = (classId: string) => heads.filter((h) => h.frequency === 'MONTHLY').reduce((a, h) => a + (Number(grid[`${classId}:${h.id}`]) || 0), 0);
  return (
    <Card title="Fee structure (amount per class)">
      <div className="-mx-5 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-5 py-2">Class</th>
              {heads.map((h) => (
                <th key={h.id} className="whitespace-nowrap px-2 py-2">
                  {h.name}
                </th>
              ))}
              <th className="px-3 py-2">Monthly total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.classes.map((c, ri) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap px-5 py-1.5 font-medium">
                  {className(c)} <span className="text-xs font-normal text-gray-400">({c.students})</span>
                </td>
                {heads.map((h) => (
                  <td key={h.id} className="px-2 py-1.5">
                    <input
                      className="input w-28 py-1 text-right"
                      type="number"
                      min={0}
                      value={grid[`${c.id}:${h.id}`] ?? ''}
                      onChange={(e) => setGrid({ ...grid, [`${c.id}:${h.id}`]: e.target.value })}
                      aria-label={`${h.name} for ${c.name}`}
                    />
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">
                  {money(monthly(c.id))}
                  {ri > 0 && (
                    <button
                      className="ml-2 text-xs text-brand-700 hover:underline"
                      title="Copy amounts from the class above"
                      onClick={() => {
                        const prev = data.classes[ri - 1];
                        setGrid({ ...grid, ...Object.fromEntries(heads.map((h) => [`${c.id}:${h.id}`, grid[`${prev.id}:${h.id}`] ?? ''])) });
                      }}
                    >
                      ↓ copy above
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        className="mt-4"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.put('/fees/structure', { rows: Object.entries(grid).map(([k, v]) => ({ classId: k.split(':')[0], headId: k.split(':')[1], amount: Number(v) || 0 })) });
            toast('Fee structure saved. New vouchers will use these amounts.');
            onSaved();
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Failed', 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        Save fee structure
      </Button>
    </Card>
  );
}

function SettingsForm({ data, onSaved }: { data: SetupData; onSaved: () => void }) {
  const toast = useToast();
  const s = data.settings;
  const b = s.bankDetails ?? {};
  const [f, setF] = useState({
    dueDay: String(s.dueDay),
    lateFeeType: s.lateFeeType,
    lateFeeAmount: String(s.lateFeeAmount),
    lateFeeMax: String(s.lateFeeMax),
    autoGenerate: s.autoGenerate,
    receiptPrefix: s.receiptPrefix,
    voucherNote: s.voucherNote ?? '',
    bankName: b.bankName ?? '',
    accountTitle: b.accountTitle ?? '',
    accountNumber: b.accountNumber ?? '',
    iban: b.iban ?? '',
    branch: b.branch ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Fee settings">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Due day of month">
          <input className="input" type="number" min={1} max={28} value={f.dueDay} onChange={set('dueDay')} />
        </Field>
        <Field label="Late fee">
          <select className="input" value={f.lateFeeType} onChange={set('lateFeeType')}>
            <option value="NONE">No late fee</option>
            <option value="FIXED">Fixed amount after due date</option>
            <option value="PER_DAY">Amount per day late</option>
          </select>
        </Field>
        {f.lateFeeType !== 'NONE' && (
          <Field label={f.lateFeeType === 'FIXED' ? 'Late fee amount' : 'Per day'}>
            <input className="input" type="number" min={0} value={f.lateFeeAmount} onChange={set('lateFeeAmount')} />
          </Field>
        )}
        {f.lateFeeType === 'PER_DAY' && (
          <Field label="Maximum late fee" hint="0 = no limit">
            <input className="input" type="number" min={0} value={f.lateFeeMax} onChange={set('lateFeeMax')} />
          </Field>
        )}
        <Field label="Receipt number prefix">
          <input className="input" value={f.receiptPrefix} onChange={set('receiptPrefix')} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2 lg:col-span-3">
          <input type="checkbox" checked={f.autoGenerate} onChange={(e) => setF({ ...f, autoGenerate: e.target.checked })} />
          Create each month’s vouchers automatically on the 1st
        </label>
      </div>
      <div className="mt-6 text-sm font-semibold">Bank details printed on vouchers</div>
      <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Bank">
          <input className="input" value={f.bankName} onChange={set('bankName')} />
        </Field>
        <Field label="Account title">
          <input className="input" value={f.accountTitle} onChange={set('accountTitle')} />
        </Field>
        <Field label="Account number">
          <input className="input" value={f.accountNumber} onChange={set('accountNumber')} />
        </Field>
        <Field label="IBAN">
          <input className="input" value={f.iban} onChange={set('iban')} />
        </Field>
        <Field label="Branch">
          <input className="input" value={f.branch} onChange={set('branch')} />
        </Field>
        <Field label="Note on vouchers">
          <input className="input" value={f.voucherNote} onChange={set('voucherNote')} placeholder="e.g. Fee once paid is not refundable" />
        </Field>
      </div>
      <div className="mt-4 space-y-3">
        <ErrorBox error={error} />
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.put('/fees/settings', {
                dueDay: Number(f.dueDay),
                lateFeeType: f.lateFeeType,
                lateFeeAmount: Number(f.lateFeeAmount) || 0,
                lateFeeMax: Number(f.lateFeeMax) || 0,
                autoGenerate: f.autoGenerate,
                receiptPrefix: f.receiptPrefix,
                voucherNote: f.voucherNote,
                bankDetails: { bankName: f.bankName, accountTitle: f.accountTitle, accountNumber: f.accountNumber, iban: f.iban, branch: f.branch },
              });
              toast('Fee settings saved');
              onSaved();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save settings
        </Button>
      </div>
    </Card>
  );
}

interface Gateway {
  provider: string;
  enabled: boolean;
  merchantId: string | null;
  hasPassword: boolean;
  hasIntegritySalt: boolean;
  sandbox: boolean;
  allowPartial: boolean;
  testGatewayAvailable: boolean;
  returnUrl: string;
}

function GatewaySettings() {
  const toast = useToast();
  const { data, error, setData } = useData<{ settings: Gateway }>('/pay/settings');
  const [f, setF] = useState({ provider: 'NONE', merchantId: '', password: '', integritySalt: '', sandbox: true, allowPartial: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setF((x) => ({ ...x, provider: data.settings.provider, merchantId: data.settings.merchantId ?? '', sandbox: data.settings.sandbox, allowPartial: data.settings.allowPartial, password: '', integritySalt: '' }));
  }, [data]);
  if (error) return null; // plan without online payment
  if (!data) return null;
  const g = data.settings;
  async function save(body: object, msg: string) {
    setBusy(true);
    try {
      const r = await api.put<{ settings: Gateway }>('/pay/settings', body);
      setData(r);
      toast(msg);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title="Online fee payment"
      actions={
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={g.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? 'Online payment switched on' : 'Online payment switched off')} />
          Parents can pay online
        </label>
      }
    >
      <p className="mb-4 text-sm text-gray-600">Use your school’s own merchant account. Money goes straight to your account; the receipt is created automatically when the payment succeeds.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider">
          <select className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
            <option value="NONE">Not set</option>
            <option value="JAZZCASH">JazzCash (wallet, card, voucher)</option>
            {g.testGatewayAvailable && <option value="TEST">Test gateway (no real money)</option>}
          </select>
        </Field>
        {f.provider === 'JAZZCASH' && (
          <>
            <Field label="Merchant ID">
              <input className="input font-mono" value={f.merchantId} onChange={(e) => setF({ ...f, merchantId: e.target.value })} />
            </Field>
            <Field label="Password" hint={g.hasPassword ? 'Saved. Enter only to change.' : undefined}>
              <input className="input font-mono" type="password" autoComplete="off" placeholder={g.hasPassword ? '•••••• (saved)' : ''} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            </Field>
            <Field label="Integrity salt" hint={g.hasIntegritySalt ? 'Saved. Enter only to change.' : undefined}>
              <input className="input font-mono" type="password" autoComplete="off" placeholder={g.hasIntegritySalt ? '•••••• (saved)' : ''} value={f.integritySalt} onChange={(e) => setF({ ...f, integritySalt: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.sandbox} onChange={(e) => setF({ ...f, sandbox: e.target.checked })} /> Sandbox (testing) account
            </label>
            <div className="sm:col-span-2">
              <div className="text-xs font-medium text-gray-500">Return URL to give JazzCash</div>
              <code className="mt-1 block break-all rounded bg-gray-100 px-2 py-1.5 text-xs">{g.returnUrl}</code>
            </div>
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.allowPartial} onChange={(e) => setF({ ...f, allowPartial: e.target.checked })} /> Allow paying part of the dues
        </label>
      </div>
      <Button
        className="mt-4"
        loading={busy}
        onClick={() =>
          save(
            {
              provider: f.provider,
              merchantId: f.merchantId,
              sandbox: f.sandbox,
              allowPartial: f.allowPartial,
              ...(f.password ? { password: f.password } : {}),
              ...(f.integritySalt ? { integritySalt: f.integritySalt } : {}),
            },
            'Payment settings saved',
          )
        }
      >
        Save payment settings
      </Button>
    </Card>
  );
}
