/**
 * 013 D3 (C3) — the pure Dify-I/O parsers. A bug here silently attaches the WRONG app id or builds a
 * broken workflow URL, so they are tabled exhaustively:
 *   • appIdFromJsonOut — app_id > id > nested app.id precedence; non-string/missing → null; scans the
 *     last JSON-looking line; non-JSON lines skipped.
 *   • appUrlFrom — strips a trailing /console/api (and trailing slashes) before appending the app path.
 *   • slugifyName — mirrors sync.py's _slugify (used by the crash-recovery name match).
 *   • parseListTable — drops the header / dashes / "→ N total" footer, keeps data rows.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  appIdFromJsonOut,
  appUrlFrom,
  slugifyName,
  parseListTable,
  pickReconciledApp,
  pulledFileFromStdout,
  type SeedRow,
} from '../server/lib/dify-io.js';

describe('appIdFromJsonOut', () => {
  test('field precedence: app_id > nested app.id — top-level `id` is NEVER an app id', () => {
    assert.equal(appIdFromJsonOut('{"app_id":"A","id":"B"}'), 'A');
    assert.equal(appIdFromJsonOut('{"app":{"id":"C"}}'), 'C');
    // Probed against self-hosted Dify (DSL 0.6.0): the response carries BOTH `id` (the import RECORD)
    // and `app_id` (the app), with different values. The old `?? obj.id` fallback was a documented
    // guess ("self-hosted may differ") and it read the record id as an app id.
    assert.equal(appIdFromJsonOut('{"id":"B"}'), null, 'a bare record id is not an app id');
  });

  // The failure this guards is silent and expensive: a bogus `task.appId` + an `app_url` pointing at
  // nothing, with the push-intent marker cleared as "resolved" — so nothing ever retries.
  test('a FAILED import yields null even though it carries a record `id` (probed shape)', () => {
    const failed = '{"id":"6663e102","status":"failed","app_id":null,"error":"App not found"}';
    assert.equal(appIdFromJsonOut(failed), null);
  });

  test('status gates the read — `pending` (DSL version mismatch) is a 200 that is NOT a success', () => {
    assert.equal(appIdFromJsonOut('{"id":"rec1","status":"pending","app_id":null}'), null);
    // Defensive: even if a future shape carried an app_id alongside a non-completed status, an
    // unconfirmed import must not be stamped as the build's app.
    assert.equal(appIdFromJsonOut('{"status":"failed","app_id":"A"}'), null);
  });

  test('both success statuses are accepted; an absent status stays readable (older shapes)', () => {
    assert.equal(appIdFromJsonOut('{"status":"completed","app_id":"A"}'), 'A');
    assert.equal(appIdFromJsonOut('{"status":"completed-with-warnings","app_id":"A"}'), 'A');
    assert.equal(appIdFromJsonOut('{"app_id":"A"}'), 'A');
  });

  test('self-hosted / missing / non-string id → null', () => {
    assert.equal(appIdFromJsonOut('{"foo":1}'), null);
    assert.equal(appIdFromJsonOut('{"app_id":null}'), null);
    assert.equal(appIdFromJsonOut('{"app_id":123}'), null);
    assert.equal(appIdFromJsonOut(''), null);
    assert.equal(appIdFromJsonOut('no json here'), null);
  });

  test('scans the LAST json line; non-JSON lines are skipped', () => {
    assert.equal(appIdFromJsonOut('starting push...\n{"app_id":"X"}\nDone.'), 'X');
    assert.equal(appIdFromJsonOut('{"app_id":"1"}\n{"app_id":"2"}'), '2', 'the last JSON line wins');
    // The last JSON line still wins even when it yields nothing — it is the authoritative result, so a
    // stale earlier line must never be scavenged for an id the final outcome does not support.
    assert.equal(appIdFromJsonOut('{"app_id":"1"}\n{"status":"failed","app_id":null}'), null);
  });
});

describe('appUrlFrom', () => {
  test('standard console base → strips /console/api', () => {
    assert.equal(appUrlFrom('http://localhost/console/api', 'abc'), 'http://localhost/app/abc/workflow');
  });
  test('trailing slash(es) are normalized before the /console/api strip', () => {
    assert.equal(appUrlFrom('http://localhost/console/api/', 'abc'), 'http://localhost/app/abc/workflow');
    assert.equal(appUrlFrom('http://localhost/console/api///', 'abc'), 'http://localhost/app/abc/workflow');
  });
  test('a base that is NOT /console/api is used as-is', () => {
    assert.equal(appUrlFrom('https://dify.example.com', 'id9'), 'https://dify.example.com/app/id9/workflow');
  });
});

describe('slugifyName (mirrors sync.py _slugify)', () => {
  test('lowercases, collapses non-alnum runs to a single _, trims edge underscores', () => {
    assert.equal(slugifyName('My Cool App'), 'my_cool_app');
    assert.equal(slugifyName('  Hello   World  '), 'hello_world');
    assert.equal(slugifyName('Café! #2'), 'caf_2');
    assert.equal(slugifyName('keep-dash_under'), 'keep-dash_under');
  });
  test('empty / all-symbols → "untitled"', () => {
    assert.equal(slugifyName(''), 'untitled');
    assert.equal(slugifyName('   '), 'untitled');
    assert.equal(slugifyName('!!!'), 'untitled');
  });
});

describe('parseListTable', () => {
  test('keeps data rows, drops the header / dashes / footer', () => {
    const stdout = [
      '  app_id                                 mode           name',
      '  -------------------------------------- -------------- ----------------',
      '  abc12345-app-id-0001                   workflow       My Cool App',
      '  def67890-app-id-0002                   chat           Another App',
      '  → 2 total',
    ].join('\n');
    assert.deepEqual(parseListTable(stdout), [
      { app_id: 'abc12345-app-id-0001', mode: 'workflow', name: 'My Cool App' },
      { app_id: 'def67890-app-id-0002', mode: 'chat', name: 'Another App' },
    ]);
  });

  test('non-indented lines and short/garbage ids are ignored', () => {
    const stdout = 'header noise\n  short x y\n  proper-id-12345 workflow Name Here';
    assert.deepEqual(parseListTable(stdout), [
      { app_id: 'proper-id-12345', mode: 'workflow', name: 'Name Here' },
    ]);
  });
});

describe('pickReconciledApp (spec 014 D6 / C6 — never silently attach the wrong app)', () => {
  const row = (app_id: string, name: string): SeedRow => ({ app_id, mode: 'workflow', name });

  test('exactly one name match → attaches that id, not ambiguous', () => {
    const rows = [row('id-1', 'My Cool App'), row('id-2', 'Other App')];
    assert.deepEqual(pickReconciledApp(rows, 'My Cool App'), { appId: 'id-1', ambiguous: false });
  });

  test('matching is by slugified name (mirrors the push --name slug)', () => {
    const rows = [row('id-9', 'my  cool   app!')];
    assert.deepEqual(pickReconciledApp(rows, 'My Cool App'), { appId: 'id-9', ambiguous: false });
  });

  test('≥2 same-named apps → AMBIGUOUS, no id attached (no newest-pick guess)', () => {
    // sync.py list exposes only id/mode/name (no created-at) — there is no safe disambiguator, so two
    // same-named apps (a crashed-then-retried import, or two builds with the same derived name) must
    // NOT silently resolve to "the first/newest" — that could attach the WRONG app_id (the C6 hole).
    const rows = [row('id-old', 'Dup App'), row('id-new', 'Dup App')];
    assert.deepEqual(pickReconciledApp(rows, 'Dup App'), { appId: null, ambiguous: true });
  });

  test('no match → null, not ambiguous (nothing to reconcile → "check Dify")', () => {
    assert.deepEqual(pickReconciledApp([row('id-1', 'Something Else')], 'Missing App'), {
      appId: null,
      ambiguous: false,
    });
    assert.deepEqual(pickReconciledApp([], 'Anything'), { appId: null, ambiguous: false });
  });
});

describe('pulledFileFromStdout (spec 014 D7 / 011 R15 — exact seed file, not an mtime guess)', () => {
  test('extracts the basename from the sync.py "✓ …/workflows/<file> (<n> bytes)" line', () => {
    const stdout = [
      '',
      'Will pull 1 app',
      '  ✓ projects/my_slug/workflows/my_cool_app.yml (12345 bytes)',
      '',
      '✓ Saved 1/1 apps to projects/my_slug/workflows/',
    ].join('\n');
    assert.equal(pulledFileFromStdout(stdout), 'my_cool_app.yml');
  });

  test('takes the LAST ✓ workflow line (a single --app-id pull writes exactly one)', () => {
    const stdout =
      '  ✓ projects/s/workflows/first.yaml (10 bytes)\n  ✓ projects/s/workflows/second.yml (20 bytes)';
    assert.equal(pulledFileFromStdout(stdout), 'second.yml');
  });

  test('no ✓ workflow line (error / unparseable) → null (caller falls back to the mtime scan)', () => {
    assert.equal(pulledFileFromStdout('No apps match.'), null);
    assert.equal(pulledFileFromStdout('  ✓ projects/s/envs/dev.env (3 bytes)'), null);
    assert.equal(pulledFileFromStdout(''), null);
  });
});
