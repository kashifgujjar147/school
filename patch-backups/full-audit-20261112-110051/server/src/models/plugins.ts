import { randomUUID } from 'node:crypto';
import { Schema } from 'mongoose';

/**
 * Fields shared by every SYNCHRONISED collection.
 * _id is a UUID string generated where the record is first created, so a record created on the
 * local server keeps the same identity in Atlas forever (no re-keying, no duplicates).
 */
export function syncedFields(schema: Schema) {
  schema.add({
    version: { type: Number, default: 1, min: 1 },
    updatedByNode: { type: String },
    deletedAt: { type: Date, default: null }
  });
  schema.index({ updatedAt: 1 });
}

export const uuidId = { type: String, default: () => randomUUID() } as const;

export const baseOptions = { timestamps: true, versionKey: false, strict: 'throw' } as const;
