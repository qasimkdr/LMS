'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorBox, Field, Loading, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';

interface TypeRow {
  key: string;
  label: string;
  description: string;
  available: boolean;
  rules: string[];
  rule: string;
  template: { name: string; language: string };
  suggestedTemplate: { name: string; language: string; category: string; text: string };
  params: string[];
}
interface Settings {
  whatsappEnabled: boolean;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  displayPhone: string | null;
  verifiedName: string | null;
  status: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  countryCode: string;
  webhookUrl: string;
  verifyToken: string;
  testMode: boolean;
  types: TypeRow[];
}

const statusInfo: Record<string, { tone: 'green' | 'red' | 'amber' | 'gray'; label: string }> = {
  CONNECTED: { tone: 'green', label: 'Connected' },
  NOT_SET: { tone: 'gray', label: 'Not set up' },
  TOKEN_EXPIRED: { tone: 'red', label: 'Access token expired' },
  ERROR: { tone: 'red', label: 'Connection problem' },
};
const ruleLabel: Record<string, string> = { auto: 'Send automatically', manual: 'Only when we press Send', off: 'Off' };

function Copy({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-gray-100 px-2 py-1.5 text-xs">{value}</code>
      <Button
        variant="secondary"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          toast('Copied');
        }}
      >
        Copy
      </Button>
    </div>
  );
}

export default function WhatsAppSettingsPage() {
  const toast = useToast();
  const { data, error, loading, setData } = useData<{ settings: Settings }>('/messaging/settings');
  const s = data?.settings;
  const [creds, setCreds] = useState({ phoneNumberId: '', businessAccountId: '', accessToken: '', appSecret: '', countryCode: '92' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testType, setTestType] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (s) setCreds((c) => ({ ...c, phoneNumberId: s.phoneNumberId ?? '', businessAccountId: s.businessAccountId ?? '', countryCode: s.countryCode, accessToken: '', appSecret: '' }));
  }, [s?.phoneNumberId, s?.businessAccountId, s?.countryCode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!s) return null;
  const st = statusInfo[s.status] ?? statusInfo.ERROR;

  async function save(body: object, msg: string) {
    setSaving(true);
    setFormError(null);
    try {
      const r = await api.put<{ settings: Settings }>('/messaging/settings', body);
      setData(r);
      toast(r.settings.lastError ? `Saved, but: ${r.settings.lastError}` : msg, r.settings.lastError ? 'error' : 'success');
      return true;
    } catch (e) {
      setFormError(e);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="WhatsApp" subtitle="Connect your school’s own WhatsApp Business number. Your school pays Meta directly for messages." />
      <div className="space-y-6">
        {s.testMode && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Test mode is on for this server: messages are recorded as sent but nothing is really sent to WhatsApp.
          </div>
        )}
        <Card title="Status">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={st.tone}>{st.label}</Badge>
                {s.status === 'CONNECTED' && <span className="text-sm text-gray-700">{[s.verifiedName, s.displayPhone].filter(Boolean).join(' · ')}</span>}
              </div>
              {s.lastError && <p className="mt-2 max-w-xl text-sm text-red-700">{s.lastError}</p>}
              {s.lastCheckedAt && <p className="mt-1 text-xs text-gray-500">Checked {dateTime(s.lastCheckedAt)}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={s.whatsappEnabled} disabled={saving} onChange={(e) => save({ whatsappEnabled: e.target.checked }, e.target.checked ? 'WhatsApp switched on' : 'WhatsApp switched off')} />
                Send WhatsApp messages
              </label>
              <Button
                variant="secondary"
                onClick={async () => {
                  const r = await api.post<{ settings: Settings }>('/messaging/settings/check');
                  setData(r);
                  toast(r.settings.status === 'CONNECTED' ? 'Connection works' : (r.settings.lastError ?? 'Not connected'), r.settings.status === 'CONNECTED' ? 'success' : 'error');
                }}
              >
                Check connection
              </Button>
            </div>
          </div>
          {!s.whatsappEnabled && <p className="mt-3 text-xs text-gray-500">While WhatsApp is off, parents still get notices in the app.</p>}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Connect your number">
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const body: Record<string, string> = { phoneNumberId: creds.phoneNumberId, businessAccountId: creds.businessAccountId, countryCode: creds.countryCode };
                if (creds.accessToken) body.accessToken = creds.accessToken;
                if (creds.appSecret) body.appSecret = creds.appSecret;
                if (await save(body, 'Saved and connected')) setCreds((c) => ({ ...c, accessToken: '', appSecret: '' }));
              }}
            >
              <Field label="Phone number ID" hint="Meta → WhatsApp → API Setup">
                <input className="input font-mono" inputMode="numeric" value={creds.phoneNumberId} onChange={(e) => setCreds({ ...creds, phoneNumberId: e.target.value.trim() })} />
              </Field>
              <Field label="WhatsApp Business Account ID (optional)">
                <input className="input font-mono" inputMode="numeric" value={creds.businessAccountId} onChange={(e) => setCreds({ ...creds, businessAccountId: e.target.value.trim() })} />
              </Field>
              <Field label="Permanent access token" hint={s.hasAccessToken ? 'Saved. Paste a new one only to replace it.' : 'From a System User in Meta Business Settings, with whatsapp_business_messaging permission.'}>
                <input className="input font-mono" type="password" autoComplete="off" placeholder={s.hasAccessToken ? '•••••••• (saved)' : ''} value={creds.accessToken} onChange={(e) => setCreds({ ...creds, accessToken: e.target.value })} />
              </Field>
              <Field label="App secret (for delivery and read ticks)" hint={s.hasAppSecret ? 'Saved.' : 'Meta app → Settings → Basic. Optional.'}>
                <input className="input font-mono" type="password" autoComplete="off" placeholder={s.hasAppSecret ? '•••••••• (saved)' : ''} value={creds.appSecret} onChange={(e) => setCreds({ ...creds, appSecret: e.target.value })} />
              </Field>
              <Field label="Country calling code" hint="Added to local numbers like 0300…">
                <input className="input w-24" value={creds.countryCode} onChange={(e) => setCreds({ ...creds, countryCode: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <ErrorBox error={formError} />
              <Button type="submit" loading={saving}>
                Save and connect
              </Button>
              <p className="text-xs text-gray-500">The token and secret are stored encrypted and are never shown again.</p>
            </form>
          </Card>

          <div className="space-y-6">
            <Card title="How to set it up">
              <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700">
                <li>Create a Meta Business account and a WhatsApp Business account at business.facebook.com, and add your school’s phone number.</li>
                <li>In developers.facebook.com create an app with the WhatsApp product. Copy the <strong>Phone number ID</strong>.</li>
                <li>In Business Settings → System users, create a system user, give it the app and the WhatsApp account, and generate a <strong>permanent token</strong>.</li>
                <li>Paste them here and press <strong>Save and connect</strong>, then send a test message.</li>
                <li>Create the message templates listed below in WhatsApp Manager and wait for Meta to approve them (usually minutes to a day).</li>
                <li>Optional: for delivered and read ticks, add the webhook below in your Meta app (field: messages) and paste the app secret.</li>
              </ol>
            </Card>
            <Card title="Webhook (delivery and read ticks)">
              <div className="space-y-3 text-sm">
                <div>
                  <div className="mb-1 text-xs font-medium text-gray-500">Callback URL</div>
                  <Copy value={s.webhookUrl} />
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-gray-500">Verify token</div>
                  <Copy value={s.verifyToken} />
                </div>
              </div>
            </Card>
            <Card title="Send a test message">
              <div className="space-y-3">
                <Field label="Mobile number">
                  <input className="input" inputMode="tel" placeholder="03001234567" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
                </Field>
                <Field label="Template">
                  <select className="input" value={testType} onChange={(e) => setTestType(e.target.value)}>
                    <option value="">Meta’s “hello_world” (works on new accounts)</option>
                    {s.types.filter((t) => t.available).map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label} ({t.template.name})
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  disabled={!s.hasAccessToken || !testPhone}
                  loading={testing}
                  onClick={async () => {
                    setTesting(true);
                    try {
                      await api.post('/messaging/settings/test', { phone: testPhone, type: testType || undefined });
                      toast('Test message sent. Check the phone.');
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Failed', 'error');
                    } finally {
                      setTesting(false);
                    }
                  }}
                >
                  Send test
                </Button>
              </div>
            </Card>
          </div>
        </div>

        <Card title="Which messages to send">
          <div className="divide-y divide-gray-100">
            {s.types.map((t) => (
              <TypeSettings key={t.key} t={t} disabled={saving} onSave={save} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function TypeSettings({ t, disabled, onSave }: { t: TypeRow; disabled: boolean; onSave: (body: object, msg: string) => Promise<boolean> }) {
  const [name, setName] = useState(t.template.name);
  const [language, setLanguage] = useState(t.template.language);
  const [show, setShow] = useState(false);
  const dirty = name !== t.template.name || language !== t.template.language;
  return (
    <div className={`py-4 ${t.available ? '' : 'opacity-50'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">
            {t.label} {!t.available && <Badge>Coming in {t.description}</Badge>}
          </div>
          {t.available && <div className="text-sm text-gray-500">{t.description}</div>}
        </div>
        {t.available && (
          <div className="flex flex-wrap gap-1">
            {t.rules.map((r) => (
              <button
                key={r}
                disabled={disabled}
                onClick={() => onSave({ rules: { [t.key]: r } }, `${t.label}: ${ruleLabel[r]}`)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${t.rule === r ? (r === 'off' ? 'bg-gray-700 text-white' : 'bg-brand-600 text-white') : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {r === 'manual' && t.key === 'MANUAL' ? 'On' : ruleLabel[r]}
              </button>
            ))}
          </div>
        )}
      </div>
      {t.available && (
        <div className="mt-3">
          <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setShow(!show)}>
            {show ? 'Hide template' : `Template: ${t.template.name} (${t.template.language})`}
          </button>
          {show && (
            <div className="mt-3 grid gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-2">
              <div className="space-y-3">
                <Field label="Template name in Meta">
                  <input className="input font-mono" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Language code" hint="e.g. en, en_US, ur">
                  <input className="input w-28 font-mono" value={language} onChange={(e) => setLanguage(e.target.value)} />
                </Field>
                <Button disabled={!dirty || disabled} onClick={() => onSave({ templates: { [t.key]: { name, language } } }, 'Template saved')}>
                  Save template name
                </Button>
              </div>
              <div className="text-sm">
                <div className="mb-1 text-xs font-medium text-gray-500">Create this template in WhatsApp Manager (category: {t.suggestedTemplate.category})</div>
                <Copy value={t.suggestedTemplate.text} />
                <div className="mt-2 text-xs text-gray-500">
                  Variables: {t.params.map((p, i) => `{{${i + 1}}} = ${p}`).join(', ')}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
