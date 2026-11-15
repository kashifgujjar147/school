import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/http.js';

export const uploadDir = path.resolve(env.UPLOAD_DIR);

export const memoryUpload = (maxBytes: number) => multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } });

/** Detects image type from magic bytes — never trust the client's mimetype or extension. */
export function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | 'ico' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico';
  return null;
}

/** Stores an image under uploads/<folder>/ and returns its public path (/uploads/...). */
export async function saveImage(buf: Buffer, folder: 'branding' | 'students', allowIco = false): Promise<string> {
  const kind = sniffImage(buf);
  if (!kind || (kind === 'ico' && !allowIco)) throw badRequest('Only PNG, JPEG or WebP images are accepted');
  const dir = path.join(uploadDir, folder);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${kind}`;
  await writeFile(path.join(dir, name), buf);
  return `/uploads/${folder}/${name}`;
}

export async function removeUpload(publicPath?: string | null) {
  if (!publicPath?.startsWith('/uploads/')) return;
  const abs = path.resolve(uploadDir, publicPath.replace('/uploads/', ''));
  if (!abs.startsWith(uploadDir)) return; // path traversal guard
  await unlink(abs).catch(() => undefined);
}
