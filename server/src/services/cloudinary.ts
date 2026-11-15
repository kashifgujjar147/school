import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Cloudinary signed uploads without the SDK. The API secret never leaves the server: the dashboard
 * asks for a short-lived signature, then uploads the file straight to Cloudinary (with progress),
 * and finally registers the returned delivery URL in the media library.
 */
export const cloudinaryConfigured = (): boolean => Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

/** Cloudinary signature: SHA-1 of the alphabetically sorted `key=value` pairs joined by `&`, followed by the API secret. */
export function signCloudinaryParams(params: Record<string, string | number>, secret: string): string {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return createHash('sha1').update(toSign + secret).digest('hex');
}

export function cloudinaryFolder(): string {
  return env.CLOUDINARY_FOLDER || `school-${env.SCHOOL_INSTALL_ID}/website`;
}

export function cloudinaryUploadTicket(kind: 'image' | 'video', now = Date.now()) {
  // Everything that constrains the upload is part of the signature, so the browser cannot change it.
  const params = {
    allowed_formats: kind === 'image' ? 'jpg,png,webp' : 'mp4,webm',
    folder: cloudinaryFolder(),
    timestamp: Math.floor(now / 1000)
  };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${kind}/upload`,
    cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY,
    params, signature: signCloudinaryParams(params, env.CLOUDINARY_API_SECRET),
    maxBytes: (kind === 'image' ? env.WEBSITE_IMAGE_MAX_MB : env.WEBSITE_VIDEO_MAX_MB) * 1024 * 1024
  };
}
