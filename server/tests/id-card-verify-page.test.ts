import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildWorld, login, resetDb, startDb, stopDb, type World } from './helpers.js';
import { Student } from '../src/models/index.js';
import { verifyPageRouter } from '../src/modules/idcards.routes.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

/** The API-only server mounts this page at /verify (no web app on the same address). */
const pageApp = () => { const a = express(); a.use('/verify', verifyPageRouter); return a; };

describe('ID card QR: server-rendered verification page', () => {
  it('shows a valid card, a not-enrolled card and an unknown card as plain HTML', async () => {
    const p = await login(w.app, 'principal');
    const sid = w.studentIds[0]!;
    expect((await p.get(`/api/id-cards/students/${sid}?layout=card`)).status).toBe(200); // issues the token
    const token = (await Student.findById(sid).lean())!.idCardToken!;

    const ok = await request(pageApp()).get(`/verify/${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('text/html');
    expect(ok.text).toContain('Valid student card');
    expect(ok.text).toContain('Ali');
    expect(ok.text).toContain('Grade 5');
    expect(ok.headers['cache-control']).toBe('no-store');

    await Student.updateOne({ _id: sid }, { status: 'archived' });
    expect((await request(pageApp()).get(`/verify/${token}`)).text).toContain('not currently enrolled');

    const bad = await request(pageApp()).get('/verify/' + 'x'.repeat(32));
    expect(bad.status).toBe(404);
    expect(bad.text).toContain('could not be verified');
    // Nothing private is shown: no admission number, date of birth or token.
    expect(ok.text).not.toContain(token);
  });

  it('escapes names so a student name cannot inject HTML', async () => {
    const p = await login(w.app, 'principal');
    const sid = w.studentIds[1]!;
    await p.get(`/api/id-cards/students/${sid}?layout=card`);
    await Student.updateOne({ _id: sid }, { fullName: '<script>alert(1)</script>' });
    const token = (await Student.findById(sid).lean())!.idCardToken!;
    const r = await request(pageApp()).get(`/verify/${token}`);
    expect(r.text).not.toContain('<script>alert(1)</script>');
    expect(r.text).toContain('&lt;script&gt;');
  });
});
