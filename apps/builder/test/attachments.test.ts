/**
 * Spec 012 → 025 — file attachments. PURE units (no Fastify): the route-validation 400 surface
 * (`validateAttachments`: type / per-file size / count), the filename-safety sanitizer, and the
 * `Attached files:` prompt-block injection (AC6). 025 generalizes the image-only path to PDF + the
 * text family, validating non-images by the filename EXTENSION (the browser `File.type` is unreliable).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAttachments,
  sanitizeName,
  attachmentBlock,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  BODY_LIMIT_BYTES,
  type AttachmentInput,
} from '../server/lib/attachments.js';

/** Build a data-URL whose decoded payload is exactly `bytes` long. */
const dataUrl = (mime: string, bytes: number): string =>
  `data:${mime};base64,${Buffer.alloc(bytes, 0x41).toString('base64')}`;

/** An accepted-image entry by default; override any field for the non-image / 400 cases. */
const att = (over: Partial<AttachmentInput> = {}): AttachmentInput => ({
  name: 'shot.png',
  mime: 'image/png',
  dataUrl: dataUrl('image/png', 16),
  ...over,
});

describe('validateAttachments — happy paths', () => {
  test('absent / null / empty array → ok with no attachments', () => {
    for (const raw of [undefined, null, []]) {
      const r = validateAttachments(raw);
      assert.equal(r.ok, true);
      assert.deepEqual(r.ok && r.attachments, []);
    }
  });

  test('each accepted image MIME decodes to bytes + maps to an extension', () => {
    const cases: Array<[string, string]> = [
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
    ];
    for (const [mime, ext] of cases) {
      const r = validateAttachments([att({ mime, dataUrl: dataUrl(mime, 8) })]);
      assert.equal(r.ok, true, mime);
      if (r.ok) {
        assert.equal(r.attachments[0].ext, ext);
        assert.equal(r.attachments[0].bytes.length, 8);
        assert.equal(r.attachments[0].mime, mime);
      }
    }
  });

  test('025: accept non-images BY EXTENSION (pdf/csv/txt/md) — ext derived from the filename', () => {
    // The browser `File.type` is unreliable for these, so the validator keys off the name's extension
    // and tolerates any/empty MIME (D2). The saved ext is the (allowlisted) filename extension (D3).
    const cases: Array<[string, string, string]> = [
      ['report.pdf', 'application/pdf', 'pdf'],
      ['data.csv', 'text/csv', 'csv'], // real-world: also '' or application/vnd.ms-excel — all fine
      ['notes.txt', 'text/plain', 'txt'],
      ['readme.md', '', 'md'], // .md often has an empty File.type
    ];
    for (const [name, mime, ext] of cases) {
      const r = validateAttachments([att({ name, mime, dataUrl: dataUrl(mime, 8) })]);
      assert.equal(r.ok, true, name);
      if (r.ok) {
        assert.equal(r.attachments[0].ext, ext, `${name} → ${ext}`);
        assert.equal(r.attachments[0].bytes.length, 8);
      }
    }
  });

  test('a bare base64 string (no data: prefix) is accepted', () => {
    const r = validateAttachments([att({ dataUrl: Buffer.alloc(4, 1).toString('base64') })]);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.attachments[0].bytes.length, 4);
  });

  test('exactly MAX_ATTACHMENTS is allowed', () => {
    const r = validateAttachments(Array.from({ length: MAX_ATTACHMENTS }, () => att()));
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.attachments.length, MAX_ATTACHMENTS);
  });
});

describe('validateAttachments — 400 surfaces', () => {
  test('non-array → error', () => {
    const r = validateAttachments({ name: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /must be an array/);
  });

  test('more than MAX_ATTACHMENTS → error names the cap', () => {
    const r = validateAttachments(Array.from({ length: MAX_ATTACHMENTS + 1 }, () => att()));
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /max 3 per turn/);
  });

  test('025: reject a disallowed extension (exe/zip) or an unknown-extension blob', () => {
    for (const [name, mime] of [
      ['malware.exe', 'application/octet-stream'],
      ['archive.zip', 'application/zip'],
      ['blob', ''], // no extension at all
      ['image.svg', 'image/svg+xml'], // Q4: svg stays rejected (not in the ext allowlist; not an image MIME)
    ] as Array<[string, string]>) {
      const r = validateAttachments([att({ name, mime })]);
      assert.equal(r.ok, false, name);
      assert.match(r.ok ? '' : r.error, /unsupported file/);
    }
  });

  test('a non-image MIME whose NAME is not an allowlisted extension → rejected', () => {
    // A `.png` filename carrying a non-image MIME fails BOTH keys (png isn't in the ext allowlist, and
    // the MIME isn't an accepted image) — images must present a real image MIME.
    const r = validateAttachments([att({ name: 'shot.png', mime: 'application/pdf' })]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /unsupported file/);
  });

  test('over the per-file byte cap → error', () => {
    const r = validateAttachments([att({ dataUrl: dataUrl('image/png', MAX_ATTACHMENT_BYTES + 1) })]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /over the .* MB limit/);
  });

  test('exactly the cap is allowed (boundary)', () => {
    const r = validateAttachments([att({ dataUrl: dataUrl('image/png', MAX_ATTACHMENT_BYTES) })]);
    assert.equal(r.ok, true);
  });

  test('empty data → error', () => {
    const r = validateAttachments([att({ dataUrl: '' })]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /has no data/);
  });

  test('a valid attachment AFTER a bad one still rejects the whole turn', () => {
    const r = validateAttachments([att(), att({ name: 'image.svg', mime: 'image/svg+xml' })]);
    assert.equal(r.ok, false);
  });
});

describe('BODY_LIMIT_BYTES — 012 D1 / 014 D7: a friendly 400, never a raw 413', () => {
  test('comfortably exceeds a max multi-file turn so validateAttachments owns the rejection', () => {
    // A maximal LEGITIMATE turn: MAX_ATTACHMENTS at the per-file cap, base64-inflated ≈ ×4/3.
    const worstCaseBody = Math.ceil((MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES * 4) / 3);
    assert.ok(
      BODY_LIMIT_BYTES > worstCaseBody,
      `bodyLimit ${BODY_LIMIT_BYTES} must exceed the ${worstCaseBody}-byte worst-case body`
    );
    // …and with real headroom for the JSON envelope + the requirement/text fields, so a max valid turn
    // never trips Fastify's raw 413 before validateAttachments can return its readable 400.
    assert.ok(BODY_LIMIT_BYTES >= worstCaseBody * 1.2, 'bodyLimit needs ≥20% headroom over the file budget');
  });

  test('an over-limit file is still the validateAttachments 400 surface (the body itself fits under the cap)', () => {
    // A single file just over the per-file cap is a ~13.3 MB body — well under BODY_LIMIT_BYTES — so it
    // reaches validateAttachments, which returns the readable 400 rather than Fastify rejecting the raw body.
    const oversize = `data:image/png;base64,${Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x41).toString('base64')}`;
    assert.ok(oversize.length < BODY_LIMIT_BYTES, 'an over-cap single-file body still fits under bodyLimit');
    const r = validateAttachments([{ name: 'big.png', mime: 'image/png', dataUrl: oversize }]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /over the .* MB limit/);
  });
});

describe('sanitizeName — D6 filename safety', () => {
  test('strips any path component (never trust the client name)', () => {
    assert.equal(sanitizeName('../../etc/passwd.png', 'png'), 'passwd.png');
    assert.equal(sanitizeName('C:\\Users\\me\\a.png', 'png'), 'a.png');
  });

  test('lowercases + keeps only [a-z0-9._-], collapsing the rest', () => {
    assert.equal(sanitizeName('My Screenshot (2024).png', 'png'), 'my_screenshot_2024_.png');
  });

  test('drops leading dots/dashes (no dotfiles / no ..) and appends the right extension', () => {
    assert.equal(sanitizeName('..', 'png'), 'file.png'); // 025: default base is now 'file', not 'image'
    assert.equal(sanitizeName('.hidden', 'jpg'), 'hidden.jpg');
    assert.equal(sanitizeName('photo', 'webp'), 'photo.webp');
  });

  test('025: works for non-image extensions too (pdf/csv/md)', () => {
    assert.equal(sanitizeName('report.pdf', 'pdf'), 'report.pdf');
    assert.equal(sanitizeName('data', 'csv'), 'data.csv');
    assert.equal(sanitizeName('My Notes.MD', 'md'), 'my_notes.md');
  });

  test('keeps an already-correct extension; never traverses', () => {
    assert.equal(sanitizeName('diagram.gif', 'gif'), 'diagram.gif');
    assert.ok(!sanitizeName('a/b/../c.png', 'png').includes('/'));
  });
});

describe('attachmentBlock — D5 prompt injection', () => {
  test('no attachments → empty string (a no-op concat)', () => {
    assert.equal(attachmentBlock(undefined), '');
    assert.equal(attachmentBlock([]), '');
  });

  test('lists every path as a bullet under the (English, 017 D4) header + a Read/PDF hint', () => {
    const paths = [
      'apps/builder/.runs/123/uploads/0_a.png',
      'apps/builder/.runs/123/uploads/1_b.csv',
    ];
    const out = attachmentBlock(paths);
    assert.match(out, /Attached files:/);
    for (const p of paths) assert.ok(out.includes(`- ${p}`), p);
    assert.match(out, /Read/);
    // 025 D5: the PDF page-range hint is present
    assert.match(out, /page range/);
    // English-default (017 D4): no stray Japanese header
    assert.ok(!out.includes('添付'), 'header is English, not Japanese');
    // untrusted-data caveat is preserved + reworded for "files" (015 D4 / 025 §Security)
    assert.match(out, /untrusted DATA/);
    // exactly one header (no duplication)
    assert.equal(out.split('Attached files:').length - 1, 1);
  });
});
