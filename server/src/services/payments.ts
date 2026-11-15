import { createHmac } from 'node:crypto';
import { balanceMinor, checkPaymentAmount, type PaymentProviderName } from '@sms/shared';
import { env } from '../config/env.js';
import { FeePayment, FeeVoucher, PaymentEvent, PaymentIntent, SecretSettings } from '../models/index.js';
import { decryptJson, safeEqual } from '../security/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { $cmp, $in } from '../utils/query.js';
import { applyPayment } from './fees.js';
import { audit } from './audit.js';

/**
 * Online fee payments — provider-based.
 *
 * Rules that every provider follows:
 *  - the browser is NEVER trusted: a redirect back from the checkout page changes nothing;
 *  - a payment is recorded only after (1) a callback whose signature verifies, AND (2) the payment
 *    is re-confirmed with the provider's own API (paid, same amount, same currency);
 *  - each provider event is processed once (paymentevents), each provider payment is applied once
 *    (unique transactionRef / intentId in feepayments);
 *  - card details never touch this server: the parent pays on the provider's hosted page.
 */

export interface PaymentConfig {
  provider: PaymentProviderName;
  stripe?: { secretKey: string; webhookSecret: string };
  currency: string;
  source: 'dashboard' | 'environment';
}

export async function getPaymentConfig(): Promise<PaymentConfig> {
  const secret = await SecretSettings.findById('payments').lean();
  if (secret) {
    try { return { ...decryptJson<Omit<PaymentConfig, 'source'>>(secret), source: 'dashboard' }; } catch { /* fall back to env */ }
  }
  return {
    provider: env.PAYMENT_PROVIDER,
    stripe: { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET },
    currency: env.PAYMENT_CURRENCY.toLowerCase(),
    source: 'environment'
  };
}

export function paymentProblems(c: PaymentConfig): string[] {
  if (c.provider === 'none') return ['No online payment provider is configured'];
  const p: string[] = [];
  if (c.provider === 'stripe') {
    if (!c.stripe?.secretKey) p.push('Stripe secret key missing');
    if (!c.stripe?.webhookSecret) p.push('Stripe webhook signing secret missing (payments could not be verified)');
  }
  return p;
}

export interface CheckoutSession { sessionId: string; url: string; expiresAt: Date }
/** A provider's authoritative view of a checkout session (from its API, never from the browser). */
export interface ProviderSessionState { paid: boolean; open: boolean; expired: boolean; amountMinor: number; currency: string; paymentRef: string | null; intentId: string | null }
export interface VerifiedEvent { eventId: string; type: string; sessionId: string | null; intentId: string | null }

interface PaymentProvider {
  createCheckout(c: PaymentConfig, i: { intentId: string; amountMinor: number; currency: string; description: string; voucherId: string }): Promise<CheckoutSession>;
  /** Verifies the callback signature; throws AppError(400) when it does not verify. */
  parseWebhook(c: PaymentConfig, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedEvent;
  retrieve(c: PaymentConfig, sessionId: string): Promise<ProviderSessionState>;
  expire(c: PaymentConfig, sessionId: string): Promise<void>;
}

// ------------------------------------------------------------------ Stripe Checkout
const STRIPE_API = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_S = 300;

async function stripeCall<T>(c: PaymentConfig, method: 'GET' | 'POST', path: string, form?: URLSearchParams, idempotencyKey?: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(STRIPE_API + path, {
      method,
      headers: {
        Authorization: `Bearer ${c.stripe!.secretKey}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: form, signal: AbortSignal.timeout(20_000)
    });
  } catch {
    throw new AppError(503, 'PROVIDER_UNREACHABLE', 'The payment provider cannot be reached. Try again shortly.');
  }
  const json = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) {
    logger.warn({ status: r.status, path }, 'stripe api error');
    throw new AppError(502, 'PROVIDER_ERROR', `Payment provider error: ${json.error?.message ?? r.status}`.slice(0, 200));
  }
  return json;
}

interface StripeSession { id: string; url: string | null; expires_at: number; payment_status: 'paid' | 'unpaid' | 'no_payment_required'; status: 'open' | 'complete' | 'expired'; amount_total: number | null; currency: string | null; payment_intent: string | { id: string } | null; client_reference_id: string | null; metadata?: Record<string, string> }

export const stripeProvider: PaymentProvider = {
  async createCheckout(c, i) {
    const f = new URLSearchParams();
    f.set('mode', 'payment');
    f.set('success_url', `${env.APP_URL}/parent/payments/${i.intentId}?result=return`);
    f.set('cancel_url', `${env.APP_URL}/parent/payments/${i.intentId}?result=cancelled`);
    f.set('client_reference_id', i.intentId);
    f.set('metadata[intentId]', i.intentId);
    f.set('metadata[voucherId]', i.voucherId);
    f.set('payment_intent_data[metadata][intentId]', i.intentId);
    f.set('line_items[0][quantity]', '1');
    f.set('line_items[0][price_data][currency]', i.currency);
    f.set('line_items[0][price_data][unit_amount]', String(i.amountMinor));
    f.set('line_items[0][price_data][product_data][name]', i.description.slice(0, 200));
    // Stripe's minimum session lifetime is 30 minutes.
    f.set('expires_at', String(Math.floor(Date.now() / 1000) + 31 * 60));
    const s = await stripeCall<StripeSession>(c, 'POST', '/checkout/sessions', f, `checkout-${i.intentId}`);
    if (!s.url) throw new AppError(502, 'PROVIDER_ERROR', 'Payment provider did not return a checkout page');
    return { sessionId: s.id, url: s.url, expiresAt: new Date(s.expires_at * 1000) };
  },

  parseWebhook(c, rawBody, headers) {
    const header = String(headers['stripe-signature'] ?? '');
    if (!verifyStripeSignature(c.stripe?.webhookSecret ?? '', rawBody, header)) throw new AppError(400, 'BAD_SIGNATURE', 'Invalid signature');
    let evt: { id?: string; type?: string; data?: { object?: { id?: string; object?: string; client_reference_id?: string | null; metadata?: Record<string, string> } } };
    try { evt = JSON.parse(rawBody.toString('utf8')); } catch { throw badRequest('Invalid payload'); }
    if (!evt.id || !evt.type) throw badRequest('Invalid event');
    const obj = evt.data?.object;
    const isSession = obj?.object === 'checkout.session';
    return {
      eventId: evt.id, type: evt.type,
      sessionId: isSession ? obj?.id ?? null : null,
      intentId: obj?.metadata?.intentId ?? (isSession ? obj?.client_reference_id ?? null : null)
    };
  },

  async retrieve(c, sessionId) {
    const s = await stripeCall<StripeSession>(c, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
    const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null;
    return {
      paid: s.payment_status === 'paid', open: s.status === 'open', expired: s.status === 'expired',
      amountMinor: s.amount_total ?? 0, currency: (s.currency ?? '').toLowerCase(), paymentRef: pi ?? s.id,
      intentId: s.metadata?.intentId ?? s.client_reference_id ?? null
    };
  },

  async expire(c, sessionId) {
    await stripeCall(c, 'POST', `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, new URLSearchParams()).catch(() => undefined);
  }
};

/** Stripe-Signature: "t=<unix>,v1=<hex hmac>[,v1=...]" over "<t>.<raw body>" with the endpoint secret. */
export function verifyStripeSignature(secret: string, rawBody: Buffer | undefined, header: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !rawBody || !header) return false;
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSec - t) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  return sigs.some((s) => safeEqual(s, expected));
}

const PROVIDERS: Partial<Record<PaymentProviderName, PaymentProvider>> = { stripe: stripeProvider };

function providerFor(c: PaymentConfig): PaymentProvider {
  const p = PROVIDERS[c.provider];
  const problems = paymentProblems(c);
  if (!p || problems.length) throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', `Online payment is not available: ${problems.join('; ') || 'unsupported provider'}`);
  return p;
}

// ------------------------------------------------------------------ Starting a payment
export async function startCheckout(opts: { voucherId: string; userId: string; amountMinor?: number }) {
  const cfg = await getPaymentConfig();
  const provider = providerFor(cfg);
  const v = await FeeVoucher.findOne({ _id: opts.voucherId, deletedAt: null }).lean();
  if (!v) throw notFound('Voucher not found');
  if (v.status === 'cancelled') throw conflict('This voucher has been cancelled');
  if (v.currency.toLowerCase() !== cfg.currency) throw conflict(`Online payment is set up for ${cfg.currency.toUpperCase()}, but this voucher is in ${v.currency}.`);
  const amountMinor = opts.amountMinor ?? balanceMinor(v.totalMinor, v.paidMinor);
  const err = checkPaymentAmount(amountMinor, v.totalMinor, v.paidMinor, v.allowPartial);
  if (err) throw badRequest(err);

  // One open checkout per voucher: reuse it for the same amount, otherwise retire it first so a
  // parent cannot accidentally pay the same voucher twice in two browser tabs.
  const open = await PaymentIntent.find({ voucherId: v._id, status: $in(['created', 'pending']), expiresAt: $cmp({ gt: new Date() }) }).lean();
  for (const o of open) {
    if (o.amountMinor === amountMinor && o.checkoutUrl && o.userId === opts.userId) return o;
    if (o.providerSessionId) await provider.expire(cfg, o.providerSessionId);
    await PaymentIntent.updateOne({ _id: o._id, status: $in(['created', 'pending']) }, { status: 'expired', $push: { events: { type: 'superseded' } } });
  }

  const intent = await PaymentIntent.create({
    voucherId: v._id, studentId: v.studentId, userId: opts.userId, amountMinor, currency: cfg.currency,
    provider: cfg.provider, status: 'created', expiresAt: new Date(Date.now() + 31 * 60_000), events: [{ type: 'created' }]
  });
  try {
    const session = await provider.createCheckout(cfg, { intentId: intent._id, amountMinor, currency: cfg.currency, description: `${v.title} — ${v.voucherNumber}`, voucherId: v._id });
    const updated = await PaymentIntent.findByIdAndUpdate(intent._id, {
      status: 'pending', providerSessionId: session.sessionId, checkoutUrl: session.url, expiresAt: session.expiresAt, $push: { events: { type: 'checkout_created' } }
    }, { new: true }).lean();
    return updated!;
  } catch (e) {
    await PaymentIntent.updateOne({ _id: intent._id }, { status: 'failed', lastError: (e as Error).message, $push: { events: { type: 'checkout_failed', detail: (e as Error).message } } });
    throw e;
  }
}

// ------------------------------------------------------------------ Verification (webhook + reconcile)
/**
 * Brings an intent up to date from the provider's API. Called by the signed webhook and when the
 * parent returns from the checkout page. Safe to call any number of times, concurrently.
 */
export async function reconcileIntent(intentId: string, source: string): Promise<{ status: string; paymentId: string | null }> {
  const intent = await PaymentIntent.findById(intentId).lean();
  if (!intent) throw notFound('Payment not found');
  if (intent.status === 'succeeded' || intent.status === 'amount_mismatch' || !intent.providerSessionId) return { status: intent.status, paymentId: intent.paymentId ?? null };
  const cfg = await getPaymentConfig();
  const provider = providerFor(cfg);
  const state = await provider.retrieve(cfg, intent.providerSessionId);
  if (state.intentId && state.intentId !== intent._id) throw new AppError(400, 'MISMATCH', 'Provider session does not belong to this payment');

  if (!state.paid) {
    if (state.expired && intent.status !== 'expired') {
      await PaymentIntent.updateOne({ _id: intent._id, status: $in(['created', 'pending', 'failed']) }, { status: 'expired', $push: { events: { type: 'expired', detail: source } } });
      return { status: 'expired', paymentId: null };
    }
    return { status: intent.status, paymentId: null };
  }

  // Paid according to the provider's API. The amount and currency must be exactly what we asked for.
  if (state.amountMinor !== intent.amountMinor || state.currency !== intent.currency.toLowerCase()) {
    await PaymentIntent.updateOne({ _id: intent._id }, {
      status: 'amount_mismatch', providerPaymentRef: state.paymentRef,
      lastError: `Provider reports ${state.amountMinor} ${state.currency}, expected ${intent.amountMinor} ${intent.currency}`,
      $push: { events: { type: 'amount_mismatch', detail: source } }
    });
    await audit(null, 'payment.amount_mismatch', 'payment_intent', intent._id, { provider: intent.provider });
    return { status: 'amount_mismatch', paymentId: null };
  }

  // Claim the intent so concurrent webhook + reconcile calls do not both apply it. The unique
  // intentId / transactionRef in feepayments would reject a second payment even without this.
  const claimed = await PaymentIntent.findOneAndUpdate(
    { _id: intent._id, status: $in(['created', 'pending', 'failed', 'expired']), $or: [{ lockedUntil: null }, { lockedUntil: $cmp({ lt: new Date() }) }] },
    { $set: { status: 'processing', lockedUntil: new Date(Date.now() + 60_000) } },
    { new: true }
  ).lean();
  if (!claimed) {
    const now = await PaymentIntent.findById(intent._id).lean();
    return { status: now?.status ?? 'processing', paymentId: now?.paymentId ?? null };
  }
  try {
    let paymentId: string;
    try {
      const p = await applyPayment({
        voucherId: intent.voucherId, amountMinor: state.amountMinor, method: 'online', paidAt: new Date(), enforceRules: false,
        provider: intent.provider, transactionRef: state.paymentRef, intentId: intent._id, receivedBy: null
      });
      paymentId = p._id;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      const existing = await FeePayment.findOne({ intentId: intent._id }).lean();
      if (!existing) throw e;
      paymentId = existing._id;
    }
    await PaymentIntent.updateOne({ _id: intent._id }, {
      status: 'succeeded', paymentId, providerPaymentRef: state.paymentRef, verifiedAt: new Date(), lockedUntil: null, lastError: null,
      $push: { events: { type: 'verified', detail: source } }
    });
    return { status: 'succeeded', paymentId };
  } catch (e) {
    await PaymentIntent.updateOne({ _id: intent._id }, { status: 'pending', lockedUntil: null, lastError: (e as Error).message });
    throw e;
  }
}

/** Handles a provider callback. Returns what happened (for logging/tests); throws 400 on a bad signature. */
export async function handlePaymentWebhook(providerName: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
  const cfg = await getPaymentConfig();
  if (providerName !== cfg.provider) throw new AppError(404, 'NOT_FOUND', 'Unknown payment provider');
  const provider = providerFor(cfg);
  if (!rawBody?.length) throw badRequest('Empty body');
  const evt = provider.parseWebhook(cfg, rawBody, headers);
  const key = `${cfg.provider}:${evt.eventId}`;
  try {
    await PaymentEvent.create({ _id: key, provider: cfg.provider, type: evt.type, intentId: evt.intentId, outcome: 'received' });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { duplicate: true, outcome: 'duplicate' };
    throw e;
  }
  try {
    const intent = evt.intentId
      ? await PaymentIntent.findById(evt.intentId).lean()
      : evt.sessionId ? await PaymentIntent.findOne({ providerSessionId: evt.sessionId }).lean() : null;
    if (!intent) {
      await PaymentEvent.updateOne({ _id: key }, { outcome: 'ignored_unknown_intent' });
      return { duplicate: false, outcome: 'ignored_unknown_intent' };
    }
    if (evt.sessionId && intent.providerSessionId !== evt.sessionId) {
      await PaymentEvent.updateOne({ _id: key }, { outcome: 'ignored_session_mismatch' });
      return { duplicate: false, outcome: 'ignored_session_mismatch' };
    }
    // The event only tells us WHICH payment to look at; the outcome comes from the provider's API.
    const r = await reconcileIntent(intent._id, `webhook:${evt.type}`);
    await PaymentEvent.updateOne({ _id: key }, { outcome: r.status });
    return { duplicate: false, outcome: r.status };
  } catch (e) {
    // Let the provider retry: forget this event so the retry is processed.
    await PaymentEvent.deleteOne({ _id: key }).catch(() => undefined);
    throw e;
  }
}
