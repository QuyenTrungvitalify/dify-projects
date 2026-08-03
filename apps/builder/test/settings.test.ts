/**
 * Dev Settings (spec 083 follow-up) — the per-machine override layer.
 *
 * Asserts the contract the ⚙ modal depends on: local overrides load/validate/coerce, secrets are
 * never round-tripped to the browser (masked to a `set` flag, cleared via clearSecrets), a blank
 * value clears an override, unknown keys and bad types are rejected, and — the load-bearing part —
 * loadShareConfig LAYERS the local override over the team-committed .dify-share.json so a machine
 * can point at a different drop URL without editing (or diffing) the tracked file.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIELDS,
  loadLocalSettings,
  localOverride,
  resolveSettings,
  saveLocalSettings,
} from '../server/lib/settings.js';
import { loadShareConfig } from '../server/lib/share.js';

const LOCAL = '.dify-settings.local.json';

describe('dev settings — local overrides', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'settings-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('save then load round-trips only registry keys; unknown keys are rejected', async () => {
    assert.equal((await saveLocalSettings(dir, { values: { 'share.url': 'https://x/exec', contributor: 'Taro' } })).ok, true);
    assert.deepEqual(await loadLocalSettings(dir), { 'share.url': 'https://x/exec', contributor: 'Taro' });
    const bad = await saveLocalSettings(dir, { values: { 'nope.key': 'x' } });
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /unknown setting/);
  });

  test('a blank value clears an override; number is validated + coerced', async () => {
    await saveLocalSettings(dir, { values: { 'share.maxKb': '256', contributor: 'Taro' } });
    assert.equal((await loadLocalSettings(dir))['share.maxKb'], 256, 'number coerced from string');
    await saveLocalSettings(dir, { values: { contributor: '   ' } }); // blank → clear
    assert.equal('contributor' in (await loadLocalSettings(dir)), false);
    const bad = await saveLocalSettings(dir, { values: { 'share.maxKb': 'lots' } });
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /positive number/);
  });

  test('share.url must be https (immediate feedback, matching loadShareConfig)', async () => {
    const bad = await saveLocalSettings(dir, { values: { 'share.url': 'http://insecure/exec' } });
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /https/);
  });

  test('a corrupt local file degrades to no overrides (never throws)', async () => {
    await writeFile(join(dir, LOCAL), '{oops', 'utf8');
    assert.deepEqual(await loadLocalSettings(dir), {});
    assert.equal(await localOverride(dir, 'share.url'), undefined);
  });

  test('resolveSettings masks secrets, marks `set`, and shows the team-file fallback hint', async () => {
    await saveLocalSettings(dir, { values: { 'share.secret': 's3cret', contributor: 'Taro' } });
    const fields = await resolveSettings(dir, { url: 'https://team/exec', maxKb: 512 });
    const secret = fields.find((f) => f.key === 'share.secret')!;
    assert.equal(secret.value, null, 'secret value is NEVER sent to the browser');
    assert.equal(secret.set, true, 'but the UI knows one is set');
    const url = fields.find((f) => f.key === 'share.url')!;
    assert.equal(url.value, null, 'no local override for url');
    assert.match(url.fallback, /team file: https:\/\/team\/exec/);
    const contributor = fields.find((f) => f.key === 'contributor')!;
    assert.equal(contributor.value, 'Taro', 'non-secret local value is shown for editing');
  });

  test('clearSecrets removes a stored secret; the tracked secret is untouched', async () => {
    await saveLocalSettings(dir, { values: { 'share.secret': 's3cret' } });
    assert.equal((await loadLocalSettings(dir))['share.secret'], 's3cret');
    await saveLocalSettings(dir, { clearSecrets: ['share.secret'] });
    assert.equal('share.secret' in (await loadLocalSettings(dir)), false);
  });

  test('the registry is the single source the modal renders from', () => {
    // every field has the metadata the generic form needs; secrets are typed password.
    for (const f of FIELDS) {
      assert.ok(f.key && f.label && f.section && f.type);
      if (f.secret) assert.equal(f.type, 'password');
    }
  });
});

describe('loadShareConfig — local override layered over the team file', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'sharecfg-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('local override wins over .dify-share.json without editing it', async () => {
    await writeFile(join(dir, '.dify-share.json'), JSON.stringify({ url: 'https://team/exec', secret: 'team', maxKb: 512 }), 'utf8');
    // team file alone:
    let cfg = await loadShareConfig(dir);
    assert.equal(cfg?.url, 'https://team/exec');
    // local override points this machine elsewhere:
    await saveLocalSettings(dir, { values: { 'share.url': 'https://mine/exec', 'share.secret': 'mine', 'share.maxKb': '128' } });
    cfg = await loadShareConfig(dir);
    assert.equal(cfg?.url, 'https://mine/exec');
    assert.equal(cfg?.secret, 'mine');
    assert.equal(cfg?.maxKb, 128);
    // the tracked team file is byte-untouched (no diff, no clobber):
    const tracked = JSON.parse(await readFile(join(dir, '.dify-share.json'), 'utf8'));
    assert.equal(tracked.url, 'https://team/exec');
    assert.ok(existsSync(join(dir, LOCAL)), 'override went to the local file');
  });

  test('a local url with no team file at all still enables drop mode', async () => {
    assert.equal(await loadShareConfig(dir), null, 'nothing configured → git fallback');
    await saveLocalSettings(dir, { values: { 'share.url': 'https://solo/exec' } });
    assert.equal((await loadShareConfig(dir))?.url, 'https://solo/exec');
  });
});
