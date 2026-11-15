import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { SecretSettings } from '../models/index.js';
import { decryptJson, safeEqual } from '../security/crypto.js';

export interface ProviderConfig {
  provider: 'none' | 'twilio' | 'http';
  twilio?: { accountSid: string; authToken: string; from: string };
  http?: { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; bodyTemplate: string; from: string; idPath: string };
  webhookToken?: string;
  source: 'dashboard' | 'environment';
}

export type SendResult =
  | { ok: true; providerMessageId: string | null; providerStatus?: string }
  | { ok: false; retryable: boolean; offline: boolean; error: string };

/** Dashboard-entered (encrypted) credentials take precedence over environment defaults. */
export async function getProviderConfig(): Promise<ProviderConfig> {
  const secret = await SecretSettings.findById('sms').lean();
  if (secret) {
    try { return { ...decryptJson<Omit<ProviderConfig, 'source'>>(secret), source: 'dashboard' }; } catch { /* fall through to env */ }
  }
  let headers: Record<string, string> = {};
  try { headers = JSON.parse(env.SMS_HTTP_HEADERS); } catch { headers = {}; }
  return {
    provider: env.SMS_PROVIDER,
    twilio: { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM },
    http: { url: env.SMS_HTTP_URL, method: env.SMS_HTTP_METHOD, headers, bodyTemplate: env.SMS_HTTP_BODY, from: env.SMS_HTTP_FROM, idPath: env.SMS_HTTP_ID_PATH },
    webhookToken: env.SMS_WEBHOOK_TOKEN,
    source: 'environment'
  };
}

/** Returns a list of what is missing; empty array means the provider is configured. */
export function configProblems(c: ProviderConfig): string[] {
  if (c.provider === 'none') return ['No SMS provider selected'];
  const p: string[] = [];
  if (c.provider === 'twilio') {
    if (!c.twilio?.accountSid) p.push('Twilio Account SID missing');
    if (!c.twilio?.authToken) p.push('Twilio Auth Token missing');
    if (!c.twilio?.from) p.push('Twilio sender number missing');
  }
  if (c.provider === 'http') {
    if (!c.http?.url) p.push('Gateway URL missing');
    if (!c.http?.bodyTemplate && c.http?.method === 'POST') p.push('Request body template missing');
  }
  return p;
}

function isNetworkError(e: unknown): boolean {
  const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  return ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(String(code)) || (e as Error)?.name === 'TimeoutError';
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function fill(t: string, vars: Record<string, string>, encode: (s: string) => string) {
  return t.replace(/\{\{(to|message|from)\}\}/g, (_m, k: string) => encode(vars[k] ?? ''));
}

export async function sendSms(c: ProviderConfig, to: string, message: string, jobId: string): Promise<SendResult> {
  const problems = configProblems(c);
  if (problems.length) return { ok: false, retryable: false, offline: false, error: problems.join('; ') };
  try {
    if (c.provider === 'twilio') {
      const t = c.twilio!;
      const body = new URLSearchParams({ To: to, From: t.from, Body: message });
      if (c.webhookToken) body.set('StatusCallback', `${env.APP_URL}/api/webhooks/sms/twilio?job=${jobId}`);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body, signal: AbortSignal.timeout(20_000)
      });
      const json = (await r.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number };
      if (!r.ok) return { ok: false, retryable: r.status >= 500 || r.status === 429, offline: false, error: `Twilio ${r.status}: ${json.message ?? 'error'}` };
      return { ok: true, providerMessageId: json.sid ?? null, providerStatus: json.status };
    }
    const hcfg = c.http!;
    const vars = { to, message, from: hcfg.from };
    const url = hcfg.method === 'GET' ? fill(hcfg.url, vars, encodeURIComponent) : hcfg.url;
    const isJson = /json/i.test(hcfg.headers['Content-Type'] ?? hcfg.headers['content-type'] ?? '');
    const r = await fetch(url, {
      method: hcfg.method, headers: hcfg.headers,
      body: hcfg.method === 'POST' ? fill(hcfg.bodyTemplate, vars, isJson ? (s) => JSON.stringify(s).slice(1, -1) : encodeURIComponent) : undefined,
      signal: AbortSignal.timeout(20_000)
    });
    const text = await r.text();
    let json: unknown = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!r.ok) return { ok: false, retryable: r.status >= 500 || r.status === 429, offline: false, error: `Gateway ${r.status}: ${text.slice(0, 200)}` };
    const id = json ? getPath(json, hcfg.idPath) : null;
    return { ok: true, providerMessageId: id ? String(id) : null };
  } catch (e) {
    const offline = isNetworkError(e);
    return { ok: false, retryable: true, offline, error: offline ? 'No internet connection to SMS provider' : (e as Error).message };
  }
}

/** Verifies Twilio's X-Twilio-Signature (HMAC-SHA1 of URL + sorted POST params). */
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string): boolean {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  return safeEqual(expected, signature);
}

/** Maps provider receipt statuses to our states. Only explicit delivery confirmations become `delivered`. */
export function mapReceipt(status: string): 'delivered' | 'undelivered' | 'sent' | null {
  const s = status.toLowerCase();
  if (['delivered', 'delivrd', 'success_delivered'].includes(s)) return 'delivered';
  if (['undelivered', 'failed', 'undeliv', 'rejected', 'expired'].includes(s)) return 'undelivered';
  if (['sent', 'queued', 'accepted', 'sending', 'enroute'].includes(s)) return 'sent';
  return null;
}
