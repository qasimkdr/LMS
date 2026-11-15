import { env } from '../config/env';

/** Meta WhatsApp Cloud API client (one school's credentials per call). */

export interface WaCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export class WaError extends Error {
  constructor(message: string, public retryable: boolean, public code?: number) {
    super(message);
  }
}

const base = () => `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}`;

/** 0300-1234567 -> 923001234567; +92 300 1234567 -> 923001234567. Returns null if it can't be a phone number. */
export function normalizePhone(raw: string | null | undefined, countryCode = '92'): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = countryCode + d.slice(1);
  else if (d.length <= 10) d = countryCode + d;
  return /^\d{10,15}$/.test(d) ? d : null;
}

async function call(path: string, token: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new WaError(`Could not reach WhatsApp: ${(e as Error).message}`, true);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_user_msg?: string } } & Record<string, unknown>;
  if (!res.ok) {
    const msg = data.error?.error_user_msg ?? data.error?.message ?? `WhatsApp error ${res.status}`;
    // 429 / 5xx / throttling codes are worth retrying; bad numbers, templates or tokens are not.
    const retryable = res.status >= 500 || res.status === 429 || [4, 80007, 130429, 131016].includes(data.error?.code ?? 0);
    throw new WaError(msg, retryable, data.error?.code);
  }
  return data;
}

/** Checks the credentials and returns the business phone's display number and name. */
export async function checkConnection(c: WaCredentials) {
  if (env.WHATSAPP_DRY_RUN) return { displayPhone: '(test mode)', verifiedName: 'Test mode – messages are not really sent' };
  const d = (await call(`/${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name`, c.accessToken)) as {
    display_phone_number?: string;
    verified_name?: string;
  };
  return { displayPhone: d.display_phone_number ?? '', verifiedName: d.verified_name ?? '' };
}

/** Sends an approved template. Returns Meta's message id. */
export async function sendTemplate(c: WaCredentials, to: string, name: string, language: string, params: string[]): Promise<string> {
  if (env.WHATSAPP_DRY_RUN) return `dry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name,
      language: { code: language },
      // Template variables may not contain new lines, tabs or more than 4 spaces in a row.
      components: params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p.replace(/\s*[\r\n\t]+\s*/g, ' ').replace(/ {4,}/g, '   ').slice(0, 1000) })) }] : [],
    },
  };
  const d = (await call(`/${encodeURIComponent(c.phoneNumberId)}/messages`, c.accessToken, { method: 'POST', body: JSON.stringify(body) })) as { messages?: { id: string }[] };
  const id = d.messages?.[0]?.id;
  if (!id) throw new WaError('WhatsApp did not return a message id', true);
  return id;
}
