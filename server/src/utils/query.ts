import mongoose from 'mongoose';

/**
 * Trusted MongoDB query operators.
 *
 * The connection runs with `sanitizeFilter: true` (config/db.ts): Mongoose wraps every
 * `$`-operator object it finds in a filter value in `$eq`, so a user-supplied object such as
 * `{ "$ne": "" }` is matched literally instead of being executed (operator injection).
 *
 * Operators the SERVER builds must therefore be marked as trusted explicitly. These helpers are
 * the only place that does so. Each one accepts operands that are plain scalars only and throws
 * otherwise, so a user-controlled object can never ride along inside a trusted operator.
 * Anything not built through these helpers stays sanitised.
 */
export type Scalar = string | number | boolean | Date | null;

function kindOf(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  return v === undefined ? 'undefined' : typeof v;
}

/** Returns v if it is a safe scalar operand; throws for objects, arrays, functions, NaN, etc. */
export function assertScalar(v: unknown): Scalar {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  throw new TypeError(`Unsafe query operand (${kindOf(v)}): only strings, numbers, booleans, dates and null are allowed`);
}

function trust<T extends object>(op: T): T {
  return mongoose.trusted(op) as T;
}

/**
 * `{ $in: values }`. `undefined` entries are dropped (they come from optional references such as an
 * unset reviewer id and can never match a document key).
 */
export function $in<T extends Scalar>(values: Iterable<T | undefined>): { $in: T[] } {
  return trust({ $in: scalarList(values) });
}

/** `{ $nin: values }` (undefined entries dropped, as for $in). */
export function $nin<T extends Scalar>(values: Iterable<T | undefined>): { $nin: T[] } {
  return trust({ $nin: scalarList(values) });
}

/** Copies the defined values, checking each one at runtime (the static type alone is not trusted). */
function scalarList<T extends Scalar>(values: Iterable<T | undefined>): T[] {
  const list: T[] = [];
  for (const v of values) {
    if (v === undefined) continue;
    assertScalar(v);
    list.push(v);
  }
  return list;
}

/** `{ $ne: value }`. */
export function $ne(value: Scalar): { $ne: Scalar } {
  return trust({ $ne: assertScalar(value) });
}

export interface Comparison { gt?: Scalar; gte?: Scalar; lt?: Scalar; lte?: Scalar; ne?: Scalar }

/**
 * Range / comparison operators, e.g. `$cmp({ gte: from, lte: to })` → `{ $gte: from, $lte: to }`.
 * Keys whose value is `undefined` are omitted; at least one bound is required.
 */
export function $cmp(c: Comparison): Partial<Record<'$gt' | '$gte' | '$lt' | '$lte' | '$ne', Scalar>> {
  const out: Partial<Record<'$gt' | '$gte' | '$lt' | '$lte' | '$ne', Scalar>> = {};
  for (const k of ['gt', 'gte', 'lt', 'lte', 'ne'] as const) {
    if (c[k] !== undefined) out[`$${k}`] = assertScalar(c[k]);
  }
  if (!Object.keys(out).length) throw new TypeError('$cmp needs at least one bound');
  return trust(out);
}
