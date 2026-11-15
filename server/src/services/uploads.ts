import { mkdir, writeFile, unlink, open, rename, stat } from 'node:fs/promises';
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
  const abs = path.resolve(uploadDir, publicPath.slice('/uploads/'.length));
  // Path traversal guard: the file must be strictly inside uploadDir (a prefix check alone would also
  // accept a sibling such as "uploads2/").
  const rel = path.relative(uploadDir, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
  await unlink(abs).catch(() => undefined);
}

// ---------------------------------------------------------------------------- website media
/** Detects MP4 / WebM from magic bytes. HEIC/AVIF images and QuickTime files share the ISO "ftyp" box and are rejected. */
export function sniffVideo(buf: Buffer): 'mp4' | 'webm' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis', 'qt  '].includes(brand)) return null;
    return 'mp4';
  }
  return null;
}

const tmpDir = path.join(uploadDir, '.tmp');

/**
 * Website media can be large (video), so it is streamed to a temporary file instead of memory.
 * The temp folder starts with a dot: express.static is configured with dotfiles: 'deny'.
 */
export const websiteUpload = () => multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { mkdir(tmpDir, { recursive: true }).then(() => cb(null, tmpDir), (e) => cb(e as Error, tmpDir)); },
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.part`)
  }),
  limits: { fileSize: Math.max(env.WEBSITE_IMAGE_MAX_MB, env.WEBSITE_VIDEO_MAX_MB) * 1024 * 1024, files: 1 }
});

export interface StoredMedia { url: string; kind: 'image' | 'video'; mime: string; sizeBytes: number }
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' } as const;

/**
 * Moves an uploaded temp file into uploads/website/ after checking its real type and size.
 * The stored name is a server-generated UUID + an extension derived from the content, so nothing
 * the client sent (name, mimetype, extension) decides where or how the file is served.
 */
export async function storeWebsiteMedia(tmpPath: string): Promise<StoredMedia> {
  try {
    const fh = await open(tmpPath, 'r');
    const head = Buffer.alloc(16);
    try { await fh.read(head, 0, 16, 0); } finally { await fh.close(); }
    const img = sniffImage(head);
    const ext = img && img !== 'ico' ? img : sniffVideo(head);
    if (!ext) throw badRequest('Only PNG, JPEG or WebP images and MP4 or WebM videos are accepted');
    const kind = ext === 'mp4' || ext === 'webm' ? 'video' : 'image';
    const { size } = await stat(tmpPath);
    const maxMb = kind === 'image' ? env.WEBSITE_IMAGE_MAX_MB : env.WEBSITE_VIDEO_MAX_MB;
    if (size > maxMb * 1024 * 1024) throw badRequest(`${kind === 'image' ? 'Images' : 'Videos'} can be at most ${maxMb} MB`);
    const dir = path.join(uploadDir, 'website');
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    await rename(tmpPath, path.join(dir, name));
    return { url: `/uploads/website/${name}`, kind, mime: MIME[ext], sizeBytes: size };
  } catch (e) {
    await unlink(tmpPath).catch(() => undefined);
    throw e;
  }
}
