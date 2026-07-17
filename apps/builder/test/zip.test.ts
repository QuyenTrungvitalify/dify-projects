/**
 * Spec 062 S2 / AC #1 — the hand-rolled store-only zip (lib/zip.ts) MUST produce an archive real
 * unzip tools accept, not just one that "looks right". A bad CRC32 / central-directory / EOCD is the
 * exact failure mode that Finder tolerates but Windows Explorer rejects — so we pin it by running the
 * emitted buffer through the SYSTEM `unzip` (present on macOS + CI Linux): `-t` verifies every CRC,
 * `-l` lists the names, and a full extract must reproduce the bytes. A deliberately corrupted byte
 * must make `-t` FAIL, proving the CRC is genuinely checked (not a placeholder).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipStore } from '../server/lib/zip.js';

// `unzip` is standard on macOS + Debian CI; skip loudly rather than fail if a runner lacks it.
function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('zipStore (spec 062 S2)', () => {
  let unzip = false;
  before(() => {
    unzip = hasUnzip();
    if (!unzip) console.warn('zip.test: `unzip` not found — round-trip assertions skipped');
  });

  const entries = [
    // markdown carries non-ASCII CONTENT (③, JP) — that exercises UTF-8 bytes inside a file, which the
    // writer + unzip handle fine. Non-ASCII NAMES are deliberately avoided: macOS's ancient Info-ZIP
    // mangles UTF-8 *filenames* on extract regardless of the (correctly-set) UTF-8 flag — that would be
    // testing the platform's unzip, not our writer.
    { name: 'summary.md', data: Buffer.from('# Run dossier — ③ Implement\n\n**Intent** привет\n', 'utf8') },
    { name: 'transcripts/implement.md', data: Buffer.from('## ③ Implement — attempt 1\n', 'utf8') },
    // a "binary" blob (all byte values, incl. NUL/0xFF) exercises raw non-text round-tripping.
    { name: 'attachments/blob.bin', data: Buffer.from([0x00, 0xff, 0x10, 0x7f, 0x80, 0x00, 0xde]) },
  ];

  test('emits a valid archive that `unzip -t` accepts and lists every entry', (t) => {
    if (!unzip) return t.skip('no unzip');
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      const zipPath = join(dir, 'bundle.zip');
      writeFileSync(zipPath, zipStore(entries));

      // -t: test the archive (every CRC) — exit 0 == all good.
      const testOut = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' });
      assert.match(testOut, /No errors detected/i);

      // -l: the listing names every entry.
      const listOut = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
      for (const e of entries) assert.ok(listOut.includes(e.name), `listing has ${e.name}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a full extract reproduces every byte (text AND binary)', (t) => {
    if (!unzip) return t.skip('no unzip');
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      const zipPath = join(dir, 'bundle.zip');
      writeFileSync(zipPath, zipStore(entries));
      execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(dir, 'out')]);
      for (const e of entries) {
        const got = readFileSync(join(dir, 'out', e.name));
        assert.deepEqual(got, e.data, `${e.name} round-trips byte-for-byte`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a corrupted data byte makes `unzip -t` FAIL (the CRC is really checked)', (t) => {
    if (!unzip) return t.skip('no unzip');
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      const buf = zipStore([{ name: 'a.txt', data: Buffer.from('hello world', 'utf8') }]);
      // The stored payload sits right after the 30-byte local header + 5-byte name ("a.txt").
      const payloadStart = 30 + 5;
      buf[payloadStart] = buf[payloadStart] ^ 0xff; // flip the first data byte
      const zipPath = join(dir, 'bad.zip');
      writeFileSync(zipPath, buf);
      assert.throws(
        () => execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' }),
        'unzip -t must reject a CRC mismatch'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('empty archive is a well-formed 22-byte EOCD (unzip recognizes it, not garbage)', (t) => {
    if (!unzip) return t.skip('no unzip');
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      const buf = zipStore([]);
      assert.equal(buf.length, 22, 'an empty zip is exactly the 22-byte EOCD record');
      const zipPath = join(dir, 'empty.zip');
      writeFileSync(zipPath, buf);
      assert.ok(existsSync(zipPath));
      // Info-ZIP reports a VALID empty archive as `warning: zipfile is empty` (exit 1) — that message
      // (not "cannot find zipfile" / a CRC error) confirms the EOCD parsed. The real bundle is never
      // empty (summary.md always present), so this is only the degenerate-input sanity check.
      try {
        execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8', stdio: 'pipe' });
      } catch (e) {
        const err = e as { stderr?: Buffer | string };
        assert.match(String(err.stderr ?? ''), /zipfile is empty/i);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
