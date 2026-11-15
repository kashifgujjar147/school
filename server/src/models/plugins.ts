import { randomUUID } from 'node:crypto';
import { Schema } from 'mongoose';

/**
 * Fields shared by every SYNCHRONISED collection. Spread into the schema definition
 * (`new Schema({ ..., ...syncedDef })`) so Mongoose's type inference knows about them; adding them
 * later with `schema.add()` would leave `version` / `deletedAt` invisible to TypeScript.
 * _id is a UUID string generated where the record is first created, so a record created on the
 * local server keeps the same identity in Atlas forever (no re-keying, no duplicates).
 */
export const syncedDef = {
  version: { type: Number, default: 1, min: 1 },
  updatedByNode: { type: String },
  deletedAt: { type: Date, default: null }
};

/** Indexes shared by every synchronised collection (the fields themselves come from syncedDef). */
export function syncedFields(schema: Schema) {
  for (const p of Object.keys(syncedDef)) {
    if (!schema.path(p)) throw new Error(`Synchronised schema is missing "${p}": spread ...syncedDef into its definition`);
  }
  schema.index({ updatedAt: 1 });
}

export const uuidId = { type: String, default: () => randomUUID() } as const;

export const baseOptions = { timestamps: true, versionKey: false, strict: 'throw' } as const;
