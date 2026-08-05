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
/**
 * Non-images validate by extension — `File.type` is unreliable for the text family (spec 025 D2).
 * MUST stay identical to the server's set (`server/lib/attachments.ts`); a parity test pins them
 * equal, because a drift here shows up as a file the picker offers and the server then rejects.
 */
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
  'docx',
  'xlsx',
  'pptx',
]);
/**
 * Pre-2007 Office files. Kept OUT of `<input accept>` (the picker shouldn't offer what can't work) but
 * deliberately allowed PAST this guard — see {@link isAcceptedFile}.
 */
export const LEGACY_OFFICE_EXT = new Set(['doc', 'xls', 'ppt']);
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
 *
 * One deliberate exception: a pre-2007 Office file passes this guard even though the server will reject
 * it. Rejecting here would DISCARD it silently — this guard has no error surface, it just drops the
 * file — whereas the server's 400 reaches the shared error banner and names the fix ("Save As .docx").
 * `<input accept>` still hides these, so the case only arises via drag-and-drop or paste, and being told
 * why beats a file that vanishes. Every other rejected type is one the user is unlikely to have aimed at.
 */
export function isAcceptedFile(file: File): boolean {
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) return false;
  if (ACCEPTED_IMAGE_MIME.includes(file.type) || ACCEPTED_EXT.has(extOf(file.name))) return true;
  return LEGACY_OFFICE_EXT.has(extOf(file.name));
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
