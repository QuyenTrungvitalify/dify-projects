/**
 * unzip.ts — a dependency-free zip READER (spec 089). The mirror of `zip.ts`'s store-only writer.
 *
 * It exists for one caller: the Office attachment extractors (`office-text.ts`). A .docx/.xlsx/.pptx
 * is a zip of XML parts, so reading one means reading a zip — and the repo's lean ethos (`zip.ts`
 * §header: "No `archiver` dependency") applies just as much to the read direction. `node:zlib` supplies
 * the only hard part (deflate); the rest is header arithmetic.
 *
 * SECURITY — two properties this module guarantees, and the reason it takes a `want` predicate instead
 * of returning everything:
 *   1. It NEVER touches the filesystem. Entry names are used as Map keys and nothing else, so a crafted
 *      name (`../../etc/passwd`) has no path to a write. The caller asks for a fixed allowlist of part
 *      names it already knows; anything else in the archive is skipped without being inflated.
 *   2. Total inflated bytes are capped ({@link MAX_INFLATED}), so a zip bomb throws instead of
 *      exhausting memory. The cap is per-call; the attachment route admits at most 3 files per turn, so
 *      the worst-case transient footprint is 3× this number on top of the request body.
 *
 * Unsupported by design: Zip64 (a >4 GB archive or >65535 entries) and encrypted entries — neither can
 * occur in a file that passed the 10 MB attachment cap, and a wrong guess is better than a silent
 * misread, so both throw.
 */
import { inflateRawSync } from 'node:zlib';

/**
 * Cap on total inflated bytes per archive. Sized against the memory ceiling rather than the format:
 * a turn admits 3 attachments, so this bounds transient Buffers at ~96 MB on top of the 64 MiB request
 * body. Real Office files in the 10 MB attachment cap inflate to a few MB of XML, so this is generous
 * headroom for legitimate input and still refuses a bomb.
 */
export const MAX_INFLATED = 32 * 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Max bytes the EOCD record can sit above the end of file: its 22-byte fixed part + a 64 KB comment. */
const EOCD_SEARCH_SPAN = 22 + 0xffff;

/**
 * Locate the end-of-central-directory record. It has no fixed position — a trailing .zip comment may
 * follow it — so the only way to find it is to scan BACKWARDS for its signature and take the last
 * plausible hit. Returns its offset, or -1 when this is not a zip at all.
 */
function findEocd(buf: Buffer): number {
  const start = Math.max(0, buf.length - EOCD_SEARCH_SPAN);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Read the entries whose name satisfies `want`, returning `name → decompressed bytes`.
 *
 * Sizes and the compression method come from the CENTRAL directory, never from the local header: when
 * an archive is written in streaming mode the local header carries zeros and defers the real sizes to a
 * trailing data descriptor. The central directory is always authoritative, which sidesteps that case
 * entirely.
 *
 * Throws (never returns partial nonsense) on: not-a-zip, Zip64, a corrupt offset, an encrypted entry,
 * an unsupported compression method, or the inflate cap. Callers surface the message to the user.
 */
export function readEntries(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (buf.length < 22) throw new Error('not a zip archive (too short)');

  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // The Zip64 sentinels. Both are unreachable under the 10 MB attachment cap, so treat them as
  // "refuse loudly" rather than growing a second format path that would never be exercised.
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('Zip64 archives are not supported');
  if (cdOffset >= buf.length) throw new Error('corrupt zip (central directory past end of file)');

  let inflated = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error('corrupt zip (bad central directory record)');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (!want(name)) continue;
    // Bit 0 is the traditional-encryption flag. An encrypted part would inflate to garbage rather than
    // fail, which is exactly the silent misread this module refuses to produce.
    if (flags & 0x1) throw new Error(`encrypted zip entry '${name}' is not supported`);

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`corrupt zip (bad local header for '${name}')`);
    }
    // The local header's name/extra lengths may differ from the central copy's (extra fields commonly
    // do), so the data offset must be computed from the LOCAL record even though sizes come from the
    // central one.
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) throw new Error(`corrupt zip (entry '${name}' runs past end of file)`);
    const raw = buf.subarray(dataStart, dataEnd);

    const budget = MAX_INFLATED - inflated;
    if (budget <= 0) throw new Error('zip contents exceed the decompression limit');

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw); // copy: don't pin the whole archive via a subarray view
    // `maxOutputLength` makes zlib abort mid-stream, so a bomb is refused while inflating rather than
    // after a 4 GB allocation succeeds. The post-check below covers the stored (method 0) path too.
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: budget });
    else throw new Error(`zip entry '${name}' uses unsupported compression method ${method}`);

    inflated += data.length;
    if (inflated > MAX_INFLATED) throw new Error('zip contents exceed the decompression limit');
    out.set(name, data);
  }
  return out;
}
