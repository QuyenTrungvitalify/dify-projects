/**
 * zip.ts — spec 062 S2. A dependency-free, STORE-ONLY (no compression) zip writer.
 *
 * The dossier payload is small text (KBs) + a few user attachments; deflate buys little and adds
 * risk, so we emit uncompressed local-file-headers + CRC32 + a central directory + EOCD — the
 * minimal valid .zip that Finder AND Windows Explorer both open (pinned by test/zip.test.ts running
 * the emitted buffer through the system `unzip -t`). No `archiver` dependency (repo lean ethos, OQ1).
 *
 * PURE + deterministic: no clock (a fixed DOS timestamp), so the same entries always produce the same
 * bytes — the round-trip test needs no time mocking. Assemble in memory (`Buffer`) and `reply.send()`.
 */

/** Standard CRC-32 (poly 0xEDB88320) lookup table, built once at module load. */
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** forward-slash path inside the archive (e.g. `transcripts/implement.md`). */
  name: string;
  /** raw bytes — already redacted for text entries (S5); binary attachments added as-is. */
  data: Buffer;
}

// A fixed DOS date/time (1980-01-01 00:00) keeps the output deterministic. 1980 is the DOS epoch, the
// smallest legal value: year=0 (1980), month=1, day=1 → ((0)<<9)|(1<<5)|1 = 0x21; time = 0.
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;
const FLAG_UTF8 = 0x0800; // general-purpose bit 11: the name is UTF-8 (so non-ASCII paths round-trip)

/**
 * Build a store-only zip from `entries`. Duplicate names are the caller's responsibility (the bundle
 * assembler dedupes by construction). Returns the complete archive as one `Buffer`.
 */
export function zipStore(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = []; // local headers + data, in order
  const centrals: Buffer[] = []; // central-directory records, in the same order
  let offset = 0; // running offset of the next local header (== its central-dir pointer)

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // compression method: 0 = store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size (== uncompressed for store)
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    parts.push(local, nameBuf, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central file header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(0, 10); // method store
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // relative offset of the local header
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + size;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end-of-central-directory signature
  eocd.writeUInt16LE(0, 4); // this disk number
  eocd.writeUInt16LE(0, 6); // disk with the central directory
  eocd.writeUInt16LE(entries.length, 8); // central-dir records on this disk
  eocd.writeUInt16LE(entries.length, 10); // total central-dir records
  eocd.writeUInt32LE(centralBuf.length, 12); // size of the central directory
  eocd.writeUInt32LE(offset, 16); // offset of the central directory (== end of local section)
  eocd.writeUInt16LE(0, 20); // .zip comment length

  return Buffer.concat([...parts, centralBuf, eocd]);
}
