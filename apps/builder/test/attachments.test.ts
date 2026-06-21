/**
 * Spec 012 — image attachments. PURE units (no Fastify): the route-validation 400 surface
 * (`validateImages`: type / per-image size / count), the filename-safety sanitizer, and the
 * `添付画像:` prompt-block injection (AC6).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateImages,
  sanitizeName,
  attachmentBlock,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  BODY_LIMIT_BYTES,
  type ImageInput,
} from '../server/lib/attachments.js';

/** Build a data-URL whose decoded payload is exactly `bytes` long. */
const dataUrl = (mime: string, bytes: number): string =>
  `data:${mime};base64,${Buffer.alloc(bytes, 0x41).toString('base64')}`;

const img = (over: Partial<ImageInput> = {}): ImageInput => ({
  name: 'shot.png',
  mime: 'image/png',
  dataUrl: dataUrl('image/png', 16),
  ...over,
});

describe('validateImages — happy paths', () => {
  test('absent / null / empty array → ok with no images', () => {
    for (const raw of [undefined, null, []]) {
      const r = validateImages(raw);
      assert.equal(r.ok, true);
      assert.deepEqual(r.ok && r.images, []);
    }
  });

  test('each accepted MIME decodes to bytes + maps to an extension', () => {
    const cases: Array<[string, string]> = [
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
    ];
    for (const [mime, ext] of cases) {
      const r = validateImages([img({ mime, dataUrl: dataUrl(mime, 8) })]);
      assert.equal(r.ok, true, mime);
      if (r.ok) {
        assert.equal(r.images[0].ext, ext);
        assert.equal(r.images[0].bytes.length, 8);
        assert.equal(r.images[0].mime, mime);
      }
    }
  });

  test('a bare base64 string (no data: prefix) is accepted', () => {
    const r = validateImages([img({ dataUrl: Buffer.alloc(4, 1).toString('base64') })]);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.images[0].bytes.length, 4);
  });

  test('exactly MAX_IMAGES is allowed', () => {
    const r = validateImages(Array.from({ length: MAX_IMAGES }, () => img()));
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.images.length, MAX_IMAGES);
  });
});

describe('validateImages — 400 surfaces', () => {
  test('non-array → error', () => {
    const r = validateImages({ name: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /must be an array/);
  });

  test('more than MAX_IMAGES → error names the cap', () => {
    const r = validateImages(Array.from({ length: MAX_IMAGES + 1 }, () => img()));
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /max 3 per turn/);
  });

  test('unsupported MIME (pdf / svg / empty) → error', () => {
    for (const mime of ['application/pdf', 'image/svg+xml', '']) {
      const r = validateImages([img({ mime })]);
      assert.equal(r.ok, false, mime);
      assert.match(r.ok ? '' : r.error, /unsupported image type/);
    }
  });

  test('over the per-image byte cap → error', () => {
    const r = validateImages([img({ dataUrl: dataUrl('image/png', MAX_IMAGE_BYTES + 1) })]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /over the .* MB limit/);
  });

  test('exactly the cap is allowed (boundary)', () => {
    const r = validateImages([img({ dataUrl: dataUrl('image/png', MAX_IMAGE_BYTES) })]);
    assert.equal(r.ok, true);
  });

  test('empty data → error', () => {
    const r = validateImages([img({ dataUrl: '' })]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /has no data/);
  });

  test('a valid image AFTER a bad one still rejects the whole turn', () => {
    const r = validateImages([img(), img({ mime: 'image/svg+xml' })]);
    assert.equal(r.ok, false);
  });
});

describe('BODY_LIMIT_BYTES — 012 D1 / 014 D7: a friendly 400, never a raw 413', () => {
  test('comfortably exceeds a max multi-image turn so validateImages owns the rejection', () => {
    // A maximal LEGITIMATE image turn: MAX_IMAGES at the per-image cap, base64-inflated ≈ ×4/3.
    const worstCaseBody = Math.ceil((MAX_IMAGES * MAX_IMAGE_BYTES * 4) / 3);
    assert.ok(
      BODY_LIMIT_BYTES > worstCaseBody,
      `bodyLimit ${BODY_LIMIT_BYTES} must exceed the ${worstCaseBody}-byte worst-case body`
    );
    // …and with real headroom for the JSON envelope + the requirement/text fields, so a max valid turn
    // never trips Fastify's raw 413 before validateImages can return its readable 400.
    assert.ok(BODY_LIMIT_BYTES >= worstCaseBody * 1.2, 'bodyLimit needs ≥20% headroom over the image budget');
  });

  test('an over-limit image is still the validateImages 400 surface (the body itself fits under the cap)', () => {
    // A single image just over the per-image cap is a ~13.3 MB body — well under BODY_LIMIT_BYTES — so it
    // reaches validateImages, which returns the readable 400 rather than Fastify rejecting the raw body.
    const oversize = `data:image/png;base64,${Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x41).toString('base64')}`;
    assert.ok(oversize.length < BODY_LIMIT_BYTES, 'an over-cap single-image body still fits under bodyLimit');
    const r = validateImages([{ name: 'big.png', mime: 'image/png', dataUrl: oversize }]);
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
    assert.equal(sanitizeName('..', 'png'), 'image.png');
    assert.equal(sanitizeName('.hidden', 'jpg'), 'hidden.jpg');
    assert.equal(sanitizeName('photo', 'webp'), 'photo.webp');
  });

  test('keeps an already-correct extension; never traverses', () => {
    assert.equal(sanitizeName('diagram.gif', 'gif'), 'diagram.gif');
    assert.ok(!sanitizeName('a/b/../c.png', 'png').includes('/'));
  });
});

describe('attachmentBlock — D3 prompt injection', () => {
  test('no attachments → empty string (a no-op concat)', () => {
    assert.equal(attachmentBlock(undefined), '');
    assert.equal(attachmentBlock([]), '');
  });

  test('lists every path as a bullet under the (English, 017 D4) header + a Read hint', () => {
    const paths = [
      'apps/builder/.runs/123/uploads/0_a.png',
      'apps/builder/.runs/123/uploads/1_b.jpg',
    ];
    const out = attachmentBlock(paths);
    assert.match(out, /Attached images:/);
    for (const p of paths) assert.ok(out.includes(`- ${p}`), p);
    assert.match(out, /Read/);
    // English-default (017 D4): no stray Japanese header
    assert.ok(!out.includes('添付画像'), 'header is English, not Japanese');
    // untrusted-data caveat is preserved (015 D4)
    assert.match(out, /untrusted DATA/);
    // exactly one header (no duplication)
    assert.equal(out.split('Attached images:').length - 1, 1);
  });
});
