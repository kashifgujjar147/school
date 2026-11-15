import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildWorld, login, makeParent, resetDb, startDb, stopDb, uuid, type World } from './helpers.js';
import { FeePayment, FeeVoucher, PaymentEvent, PaymentIntent } from '../src/models/index.js';
import { verifyStripeSignature } from '../src/services/payments.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

const WHSEC = 'whsec_testsecret1234567890';
const voucherBody = (studentId: string, extra: object = {}) => ({
  studentId, title: 'Tuition', period: '2026-11', dueDate: '2026-11-10',
  items: [{ label: 'Tuition fee', amountMinor: 500000 }, { label: 'Lab', amountMinor: 50000 }], ...extra
});

function signed(body: object, secret = WHSEC, t = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return { raw, header: `t=${t},v1=${sig}` };
}

async function postWebhook(raw: string, header: string) {
  return request(w.app).post('/api/webhooks/payments/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', header).send(raw);
}

describe('vouchers & manual payments', () => {
  it('issues a voucher with an exact total, enforces full payment, replays idempotent retries', async () => {
    const p = await login(w.app, 'principal');
    const v = await p.post('/api/fees/vouchers', voucherBody(w.studentIds[0]!));
    expect(v.status).toBe(201);
    expect(v.body.data).toMatchObject({ totalMinor: 550000, paidMinor: 0, status: 'unpaid', currency: 'PKR' });
    expect(v.body.data.voucherNumber).toMatch(/^FV-202611-[A-Z2-9]{6}$/);
    expect((await p.post('/api/fees/vouchers', voucherBody(w.studentIds[0]!))).status).toBe(409);
    const id = v.body.data._id;
    // Partial not allowed on this voucher; overpayment never allowed; Idempotency-Key required.
    expect((await p.post(`/api/fees/vouchers/${id}/payments`, { amountMinor: 100000, method: 'cash' }, { 'Idempotency-Key': uuid() })).status).toBe(400);
    expect((await p.post(`/api/fees/vouchers/${id}/payments`, { amountMinor: 600000, method: 'cash' }, { 'Idempotency-Key': uuid() })).status).toBe(400);
    expect((await p.post(`/api/fees/vouchers/${id}/payments`, { amountMinor: 550000, method: 'cash' })).status).toBe(400);
    const key = uuid();
    const pay = await p.post(`/api/fees/vouchers/${id}/payments`, { amountMinor: 550000, method: 'cash', reference: 'slip 7' }, { 'Idempotency-Key': key });
    expect(pay.status).toBe(201);
    const replay = await p.post(`/api/fees/vouchers/${id}/payments`, { amountMinor: 550000, method: 'cash' }, { 'Idempotency-Key': key });
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(await FeePayment.countDocuments({ voucherId: id })).toBe(1);
    expect((await FeeVoucher.findById(id).lean())).toMatchObject({ paidMinor: 550000, status: 'paid' });
    expect((await p.post(`/api/fees/vouchers/${id}/payments`, { amountMinor: 1, method: 'cash' }, { 'Idempotency-Key': uuid() })).status).toBe(400);
    expect((await p.post(`/api/fees/vouchers/${id}/cancel`, { reason: 'mistake' })).status).toBe(409);
    const receipt = await p.get(`/api/fees/payments/${pay.body.data._id}/receipt`);
    expect(receipt.headers['content-type']).toBe('application/pdf');
    expect((await p.get(`/api/fees/vouchers/${id}/pdf`)).headers['content-type']).toBe('application/pdf');
  });

  it('partial payments when allowed; bulk issue skips students who already have the voucher', async () => {
    const p = await login(w.app, 'principal');
    const v = await p.post('/api/fees/vouchers', voucherBody(w.studentIds[0]!, { allowPartial: true }));
    await p.post(`/api/fees/vouchers/${v.body.data._id}/payments`, { amountMinor: 200000, method: 'bank_transfer' }, { 'Idempotency-Key': uuid() });
    expect((await FeeVoucher.findById(v.body.data._id).lean())).toMatchObject({ paidMinor: 200000, status: 'partial' });
    const bulk = await p.post('/api/fees/vouchers/bulk', { ...voucherBody(''), studentId: undefined, classroomId: w.classroomId });
    expect(bulk.status).toBe(201);
    expect(bulk.body.data).toMatchObject({ created: 2, skipped: 1, students: 3 });
    const again = await p.post('/api/fees/vouchers/bulk', { ...voucherBody(''), studentId: undefined, classroomId: w.classroomId });
    expect(again.body.data).toMatchObject({ created: 0, skipped: 3 });
    const sum = await p.get('/api/fees/summary');
    expect(sum.body.data.outstandingMinor).toBe(550000 * 3 - 200000);
  });

  it('teachers cannot read or manage fees', async () => {
    const t = await login(w.app, 'teacher1');
    expect((await t.get('/api/fees/vouchers')).status).toBe(403);
    expect((await t.post('/api/fees/vouchers', voucherBody(w.studentIds[0]!))).status).toBe(403);
  });
});

describe('online payments (Stripe Checkout)', () => {
  it('without a configured provider: honest "not available" state, nothing is created', async () => {
    const p = await login(w.app, 'principal');
    const v = await p.post('/api/fees/vouchers', voucherBody(w.studentIds[0]!));
    const { parent } = await makeParent(w);
    expect((await parent.get('/api/parent/payments/availability')).body.data.available).toBe(false);
    const r = await parent.post(`/api/parent/vouchers/${v.body.data._id}/checkout`, {});
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('PAYMENTS_NOT_CONFIGURED');
    expect(await PaymentIntent.countDocuments()).toBe(0);
    const s = await p.get('/api/fees/settings');
    expect(s.body.data.provider.configured).toBe(false);
  });

  it('signature verification helper: rejects wrong secret, stale timestamp and tampering', () => {
    const { raw, header } = signed({ id: 'evt_1' });
    expect(verifyStripeSignature(WHSEC, Buffer.from(raw), header)).toBe(true);
    expect(verifyStripeSignature('whsec_other', Buffer.from(raw), header)).toBe(false);
    expect(verifyStripeSignature(WHSEC, Buffer.from(raw + ' '), header)).toBe(false);
    const old = signed({ id: 'evt_1' }, WHSEC, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyStripeSignature(WHSEC, Buffer.from(old.raw), old.header)).toBe(false);
  });

  it('records a payment only after a verified callback AND API re-confirmation; duplicates are ignored', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.put('/api/fees/provider', { provider: 'stripe', secretKey: 'sk_test_abcdefghijklmnop', webhookSecret: WHSEC, currency: 'pkr' })).status).toBe(200);
    const settings = await p.get('/api/fees/settings');
    expect(settings.body.data.provider).toMatchObject({ configured: true, provider: 'stripe' });
    expect(JSON.stringify(settings.body.data)).not.toContain('sk_test_abcdefghijklmnop');
    expect(JSON.stringify(settings.body.data)).not.toContain(WHSEC);

    const v = await p.post('/api/fees/vouchers', voucherBody(w.studentIds[0]!));
    const other = await p.post('/api/fees/vouchers', voucherBody(w.studentIds[2]!)); // Omar: not this parent's child
    const { parent } = await makeParent(w);

    let sessionState = { payment_status: 'unpaid', status: 'open', amount_total: 550000, currency: 'pkr' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith('/v1/checkout/sessions') && init?.method === 'POST') {
        const form = new URLSearchParams(String(init.body));
        expect(form.get('line_items[0][price_data][unit_amount]')).toBe('550000');
        expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^checkout-/);
        return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: Math.floor(Date.now() / 1000) + 1860, metadata: { intentId: form.get('metadata[intentId]') } }), { status: 200 });
      }
      if (u.includes('/v1/checkout/sessions/cs_test_1')) {
        const intent = await PaymentIntent.findOne({ providerSessionId: 'cs_test_1' }).lean();
        return new Response(JSON.stringify({ id: 'cs_test_1', url: null, expires_at: 0, ...sessionState, payment_intent: 'pi_123', client_reference_id: intent?._id, metadata: { intentId: intent?._id } }), { status: 200 });
      }
      throw new Error('unexpected fetch ' + u);
    });

    expect((await parent.post(`/api/parent/vouchers/${other.body.data._id}/checkout`, {})).status).toBe(404);
    const co = await parent.post(`/api/parent/vouchers/${v.body.data._id}/checkout`, {});
    expect(co.status).toBe(201);
    expect(co.body.data.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    const intentId = co.body.data.intentId;
    // Starting checkout again for the same amount reuses the open session (no second payment page).
    expect((await parent.post(`/api/parent/vouchers/${v.body.data._id}/checkout`, {})).body.data.intentId).toBe(intentId);

    const evt = (id: string) => ({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', object: 'checkout.session', client_reference_id: intentId, metadata: { intentId } } } });

    // 1) Forged callback (bad signature): rejected, nothing recorded.
    const forged = signed(evt('evt_forged'), 'whsec_attacker_secret_123');
    expect((await postWebhook(forged.raw, forged.header)).status).toBe(400);
    // 2) Parent "returns" from checkout but the provider says unpaid: still unpaid.
    expect((await parent.get(`/api/parent/payments/${intentId}`)).body.data.status).toBe('pending');
    // 3) Valid signature but the provider's API says unpaid: still unpaid.
    const e1 = signed(evt('evt_1'));
    expect((await postWebhook(e1.raw, e1.header)).status).toBe(200);
    expect((await FeeVoucher.findById(v.body.data._id).lean())!.status).toBe('unpaid');
    expect(await FeePayment.countDocuments()).toBe(0);

    // 4) Provider confirms payment: exactly one payment recorded, voucher paid.
    sessionState = { payment_status: 'paid', status: 'complete', amount_total: 550000, currency: 'pkr' };
    const e2 = signed(evt('evt_2'));
    expect((await postWebhook(e2.raw, e2.header)).status).toBe(200);
    expect((await FeeVoucher.findById(v.body.data._id).lean())).toMatchObject({ status: 'paid', paidMinor: 550000 });
    // 5) The same event replayed, a different event for the same session, and the parent's return: no duplicates.
    expect((await postWebhook(e2.raw, e2.header)).status).toBe(200);
    const e3 = signed({ ...evt('evt_3'), type: 'checkout.session.async_payment_succeeded' });
    expect((await postWebhook(e3.raw, e3.header)).status).toBe(200);
    const ret = await parent.get(`/api/parent/payments/${intentId}`);
    expect(ret.body.data.status).toBe('succeeded');
    expect(ret.body.data.receipt.receiptNumber).toMatch(/^RC-/);
    expect(await FeePayment.countDocuments()).toBe(1);
    const pay = (await FeePayment.findOne().lean())!;
    expect(pay).toMatchObject({ method: 'online', provider: 'stripe', transactionRef: 'pi_123', intentId, amountMinor: 550000 });
    expect(await PaymentEvent.countDocuments()).toBe(3);
    // Parent can download their own receipt; payment shows in their fee history.
    expect((await parent.get(`/api/parent/receipts/${pay._id}/pdf`)).headers['content-type']).toBe('application/pdf');
    expect((await parent.get(`/api/parent/children/${w.studentIds[0]}/fees`)).body.data.payments).toHaveLength(1);
    // Paid voucher cannot be paid again.
    expect((await parent.post(`/api/parent/vouchers/${v.body.data._id}/checkout`, {})).status).toBe(400);
    fetchMock.mockRestore();
  });

  it('an amount mismatch is flagged and NOT applied', async () => {
    const p = await login(w.app, 'principal');
    await p.put('/api/fees/provider', { provider: 'stripe', secretKey: 'sk_test_abcdefghijklmnop', webhookSecret: WHSEC, currency: 'pkr' });
    const v = await p.post('/api/fees/vouchers', voucherBody(w.studentIds[0]!));
    const { parent } = await makeParent(w);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/v1/checkout/sessions') && init?.method === 'POST') return new Response(JSON.stringify({ id: 'cs_test_2', url: 'https://checkout.stripe.com/x', expires_at: Math.floor(Date.now() / 1000) + 1860 }), { status: 200 });
      return new Response(JSON.stringify({ id: 'cs_test_2', payment_status: 'paid', status: 'complete', amount_total: 100, currency: 'pkr', payment_intent: 'pi_x' }), { status: 200 });
    });
    const co = await parent.post(`/api/parent/vouchers/${v.body.data._id}/checkout`, {});
    const e = signed({ id: 'evt_m', type: 'checkout.session.completed', data: { object: { id: 'cs_test_2', object: 'checkout.session', metadata: { intentId: co.body.data.intentId } } } });
    expect((await postWebhook(e.raw, e.header)).status).toBe(200);
    expect((await PaymentIntent.findById(co.body.data.intentId).lean())!.status).toBe('amount_mismatch');
    expect((await FeeVoucher.findById(v.body.data._id).lean())!.status).toBe('unpaid');
    expect(await FeePayment.countDocuments()).toBe(0);
    fetchMock.mockRestore();
  });

  it('only principals/admins can configure the provider; invalid keys are refused', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.put('/api/fees/provider', { provider: 'stripe', secretKey: 'not-a-key', webhookSecret: WHSEC, currency: 'pkr' })).status).toBe(400);
    expect((await p.put('/api/fees/provider', { provider: 'stripe', secretKey: 'sk_test_abcdefghijklmnop', currency: 'pkr' })).status).toBe(400); // no webhook secret
    const t = await login(w.app, 'teacher1');
    expect((await t.put('/api/fees/provider', { provider: 'none' })).status).toBe(403);
  });
});
