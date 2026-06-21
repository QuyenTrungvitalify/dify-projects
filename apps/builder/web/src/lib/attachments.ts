/* ============================================================
   attachments.ts (web) — composer image helpers (spec 012).
   Mirrors the server caps (server/lib/attachments.ts) for an
   immediate client-side guard; the backend re-validates and is
   authoritative (a bad request still 400s, surfaced as ApiError).
   ============================================================ */
import type { ImageAttachment } from '../api';

/** Held in the composer: the wire fields + a stable id for the chip list. */
export interface ComposerImage extends ImageAttachment {
  id: string;
}

export const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** A file the composer will accept: an allowed image type within the per-image size cap. */
export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_IMAGE_MIME.includes(file.type) && file.size > 0 && file.size <= MAX_IMAGE_BYTES;
}

/** Read a File as a base64 data-URL (the transport shape — no multipart). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('failed to read file'));
    r.readAsDataURL(file);
  });
}

/** Strip the chip-only `id` before sending to the backend. */
export function toWire(images: ComposerImage[]): ImageAttachment[] {
  return images.map(({ name, mime, dataUrl }) => ({ name, mime, dataUrl }));
}
