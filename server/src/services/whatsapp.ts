import { createHmac } from 'node:crypto';
import { whatsappRecipient } from '@sms/shared';
import { env } from '../config/env.js';
import { SecretSettings } from '../models/index.js';
import { decryptJson, safeEqual } from '../security/crypto.js';
import type { SendResult } from './sms-providers.js';

/**
 * WhatsApp Business Cloud API (Meta Graph API).
 *
 * Messages a business starts (alerts, reminders) must use a template that Meta has APPROVED for the
 * WhatsApp Business Account. Configure `templateName` with a template whose body has exactly one
 * variable ({{1}}); the rendered school message is passed as that variable. Without a template the
 * API only delivers free-form text inside the 24-hour window after the parent last messaged the
 * school, so a template is strongly recommended (the dashboard warns when none is set).
 */
export interface WhatsappConfig {
  enabled: boolean;
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
  templateName: string;
  templateLanguage: string;
  apiVersion: string;
  source: 'dashboard' | 'environment';
}

export async function getWhatsappConfig(): Promise<WhatsappConfig> {
  const secret = await SecretSettings.findById('whatsapp').lean();
  if (secret) {
    try { return { ...decryptJson<Omit<WhatsappConfig, 'source'>>(secret), source: 'dashboard' }; } catch { /* fall back to env */ }
  }
  return {
    enabled: Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
    accessToken: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    appSecret: env.WHATSAPP_APP_SECRET, verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    templateName: env.WHATSAPP_TEMPLATE_NAME, templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE,
    apiVersion: env.WHATSAPP_API_VERSION, source: 'environment'
  };
}

/** What is missing before WhatsApp messages can be sent. Empty = configured. */
export function whatsappProblems(c: WhatsappConfig): string[] {
  if (!c.enabled) return ['WhatsApp is not enabled'];
  const p: string[] = [];
  if (!c.accessToken) p.push('WhatsApp access token missing');
  if (!c.phoneNumberId) p.push('WhatsApp phone number ID missing');
  return p;
}

/** Non-blocking advice shown in the dashboard. */
export function whatsappWarnings(c: WhatsappConfig): string[] {
  const w: string[] = [];
  if (!c.templateName) w.push('No approved message template set: WhatsApp only delivers free-form text within 24 hours of the parent messaging the school.');
  if (!c.appSecret) w.push('App secret not set: delivery status callbacks cannot be verified and will be rejected.');
  if (!c.verifyToken) w.push('Webhook verify token not set: Meta cannot register the status callback URL.');
  return w;
}

function isNetworkError(e: unknown): boolean {
  const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  return ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(String(code)) || (e as Error)?.name === 'TimeoutError';
}

export function whatsappPayload(c: WhatsappConfig, toE164: string, message: string): Record<string, unknown> {
  const to = whatsappRecipient(toE164);
  if (c.templateName) {
    return {
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: c.templateName, language: { code: c.templateLanguage || 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: message }] }] }
    };
  }
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: message } };
}

export async function sendWhatsapp(c: WhatsappConfig, toE164: string, message: string): Promise<SendResult> {
  const problems = whatsappProblems(c);
  if (problems.length) return { ok: false, retryable: false, offline: false, error: problems.join('; ') };
  try {
    const r = await fetch(`https://graph.facebook.com/${encodeURIComponent(c.apiVersion)}/${encodeURIComponent(c.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(whatsappPayload(c, toE164, message)),
      signal: AbortSignal.timeout(20_000)
    });
    const json = (await r.json().catch(() => ({}))) as { messages?: { id?: string; message_status?: string }[]; error?: { message?: string; code?: number } };
    if (!r.ok) {
      // 429 / 5xx and Meta's throttling codes are retryable; auth and template errors are not.
      const retryable = r.status >= 500 || r.status === 429 || [4, 80007, 130429, 131048, 131056].includes(Number(json.error?.code));
      return { ok: false, retryable, offline: false, error: `WhatsApp ${r.status}: ${json.error?.message ?? 'error'}`.slice(0, 300) };
    }
    const id = json.messages?.[0]?.id ?? null;
    return { ok: true, providerMessageId: id, providerStatus: json.messages?.[0]?.message_status ?? 'accepted' };
  } catch (e) {
    const offline = isNetworkError(e);
    return { ok: false, retryable: true, offline, error: offline ? 'No internet connection to WhatsApp' : (e as Error).message };
  }
}

/** Meta signs webhook bodies: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret, raw body). */
export function verifyMetaSignature(appSecret: string, rawBody: Buffer | undefined, header: string): boolean {
  if (!appSecret || !rawBody || !header.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(expected, header);
}

/** Meta status → our job status. 'read' implies delivered. */
export function mapWhatsappStatus(s: string): 'delivered' | 'undelivered' | 'sent' | null {
  switch (s) {
    case 'delivered': case 'read': return 'delivered';
    case 'failed': return 'undelivered';
    case 'sent': return 'sent';
    default: return null;
  }
}
