/* ============================================================
   attachments.ts (web) — composer file helpers (spec 012 → 025).
   Mirrors the server caps (server/lib/attachments.ts) for an
   immediate client-side guard; the backend re-validates and is
   authoritative (a bad request still 400s, surfaced as ApiError).
   ============================================================ */
import type { Attachment } from '../api';

/** Held in the composer: the wire fields + a stable id for the chip list. */
export interface ComposerAttachment extends Attachment {
  id: string;
}

/** Images keep the MIME key (reliable for image/* in the browser). */
export const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** Non-images validate by extension — `File.type` is unreliable for the text family (spec 025 D2). */
export const ACCEPTED_EXT = new Set([
  'pdf',
  'txt',
  'csv',
  'tsv',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'log',
]);
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Lower-cased trailing extension of a filename (no leading dot), or '' if none. */
function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/** True when this MIME is an accepted image type → render a thumbnail; else render a file chip. */
export function isImageMime(mime: string): boolean {
  return ACCEPTED_IMAGE_MIME.includes(mime.toLowerCase());
}

/**
 * A file the composer will accept: within the per-file size cap, AND either an allowed image MIME or a
 * filename extension in {@link ACCEPTED_EXT} (the server re-validates with the same rule, spec 025 D2).
 */
export function isAcceptedFile(file: File): boolean {
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) return false;
  return ACCEPTED_IMAGE_MIME.includes(file.type) || ACCEPTED_EXT.has(extOf(file.name));
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
export function toWire(files: ComposerAttachment[]): Attachment[] {
  return files.map(({ name, mime, dataUrl }) => ({ name, mime, dataUrl }));
}
