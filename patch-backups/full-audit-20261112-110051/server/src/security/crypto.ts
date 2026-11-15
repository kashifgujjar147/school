import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

const BCRYPT_COST = env.NODE_ENV === 'test' ? 4 : 12;

export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const key = () => Buffer.from(env.DATA_ENCRYPTION_KEY.slice(0, 64), 'hex');

/** AES-256-GCM for secrets stored in the database (e.g. SMS provider credentials). */
export function encryptJson(value: unknown): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return { ciphertext: ct.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

export function decryptJson<T>(e: { ciphertext: string; iv?: string | null; tag?: string | null }): T {
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(e.iv!, 'base64'));
  d.setAuthTag(Buffer.from(e.tag!, 'base64'));
  const pt = Buffer.concat([d.update(Buffer.from(e.ciphertext, 'base64')), d.final()]);
  return JSON.parse(pt.toString('utf8')) as T;
}

/** Strong random password for first-run principal / admin-issued temporary passwords. */
export function generatePassword(): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz'; const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ'; const digits = '23456789';
  const all = lower + upper + digits;
  const pick = (set: string) => set[randomBytes(1)[0]! % set.length]!;
  const chars = [pick(lower), pick(upper), pick(digits), ...Array.from({ length: 11 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = randomBytes(1)[0]! % (i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join('');
}
