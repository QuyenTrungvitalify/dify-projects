/**
 * A denial must say what to do INSTEAD — it is the one teaching moment that always lands.
 *
 * Unlike a doc, the denial reaches the agent exactly when it is wrong: no link to resolve, no turn
 * spent fetching it. That matters because the old wording taught nothing and the model read it as a
 * SYNTAX complaint, so it retried with different flags:
 *
 *   run 1784263317775 · spec     "command not in the Builder allow-set: grep" → grep 3× (-i -E, -in, -in)
 *   run 1784265851924 · analyze  "dangerous executable: find"                 → find 6× (varying -maxdepth)
 *
 * ~9 turns re-asking a question that was never about the flags. "dangerous executable: find" was
 * misleading on top — find is refused because the Glob tool covers it, not because it is unsafe.
 *
 * These tests pin the WORDING (the fix) and, more importantly, the two invariants that keep it honest:
 * every named way out must itself be allowed, and no decision may change.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeBashCommand } from '../server/hooks/permission-gate.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('a denial names the sanctioned alternative', () => {
  test('the search verbs point at find.py — the one search a turn can actually run', () => {
    // NOT the Grep tool: it is deferred in the child session and errored 2/2 in run 1784267358546,
    // so ③ fell back to shell grep and thrashed 25×. find.py --has answers the same question in ONE
    // allowed call and returns paths.
    assert.match(analyzeBashCommand('grep -in chatwork templates/tool-catalog.json').reason, /find\.py --has/);
    assert.match(analyzeBashCommand('find . -name find.py').reason, /find\.py --has/);
    assert.match(analyzeBashCommand('sed -i s/a/b/ x.yml').reason, /Edit tool/);
  });

  test('`find` is no longer called dangerous — it is merely unavailable', () => {
    const r = analyzeBashCommand('find /repo -maxdepth 5 -name find.py');
    assert.ok(!/dangerous/i.test(r.reason), 'the old wording sent the model hunting for a "safer" find');
    assert.match(r.reason, /not available/);
  });

  test('mkdir is answered with the tool that makes it unnecessary', () => {
    // The observed call: `mkdir -p .runs/<id>` before writing into it — Write creates parents itself.
    assert.match(analyzeBashCommand('mkdir -p .runs/123').reason, /Write tool.*parent directories/);
  });

  test('a pipe denial says to drop the pipe — not to rephrase the whole command', () => {
    const r = analyzeBashCommand('.venv/bin/python tools/dify_base/find.py --list-features 2>&1 | head -60');
    assert.match(r.reason, /ONE plain command/);
    assert.match(r.reason, /returned in full/, 'and why `| head` was pointless to begin with');
  });

  test('a command named after an Object member gets no hint (the lookup is prototype-safe)', () => {
    // `base` is the first token of an attacker-shaped command. With an object literal,
    // SUBSTITUTE['constructor'] returned Object's constructor — truthy — and the reason read
    // "use function Object() { [native code] } instead". The decision was never wrong; the message was.
    for (const base of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const r = analyzeBashCommand(`${base} foo`);
      assert.equal(r.decision, 'deny');
      assert.ok(!/native code|function |\[object/.test(r.reason), `${base} → leaked an Object member: ${r.reason}`);
    }
  });

  test('the destructive verbs keep the blunt refusal — for them redirection is not the point', () => {
    for (const cmd of ['rm -rf /', 'sudo ls', 'dd if=/dev/zero of=/dev/sda', 'chmod 777 /etc']) {
      const r = analyzeBashCommand(cmd);
      assert.equal(r.decision, 'deny');
      assert.match(r.reason, /dangerous executable/, `${cmd} must not be offered a workaround`);
    }
  });
});

describe('the invariants that keep the hints honest', () => {
  test('a hint never names a door that is not open in a turn', () => {
    // The FIRST version of this test asserted "the named tool is in permissions.allow" — and passed,
    // because Grep IS listed there. It proved nothing: permission is not availability. Grep is deferred
    // in the child session, errored 2/2 in run 1784267358546, and the hint sent ③ straight at it.
    // So assert what actually matters instead: (a) never name Grep/Glob until they are proven callable
    // from a turn, and (b) every shell command a hint suggests must itself pass this very gate.
    const cmds = ['grep x y', 'find . -name x', 'sed -i s/a/b/ f', 'awk {print} f', 'cp a b', 'mv a b', 'mkdir d', 'touch f', 'tee f', 'rg x y'];
    for (const cmd of cmds) {
      const reason = analyzeBashCommand(cmd).reason;
      assert.ok(
        !/\b(Grep|Glob) tool\b/.test(reason),
        `${cmd} → hint names the ${reason.match(/\b(Grep|Glob) tool\b/)?.[0]}, which errored 2/2 in a real turn`
      );
      // Any shell command inside a hint (backticked) must be one this gate allows — or the hint is a trap.
      for (const suggested of reason.match(/`([^`]*\.venv\/bin\/python[^`]*)`/g) ?? []) {
        const bare = suggested.replace(/`/g, '').replace(/<[^>]+>/g, 'llm'); // fill the placeholder
        assert.equal(analyzeBashCommand(bare).decision, 'allow', `hint suggests "${bare}", which this gate denies`);
      }
    }
  });

  test('the tools a hint DOES name are the ones that never failed in a real turn', () => {
    // Read/ls/find.py: used successfully in every one of the three measured runs.
    const settings = JSON.parse(readFileSync(join(REPO, 'apps/builder/headless-settings.json'), 'utf8'));
    assert.ok(new Set<string>(settings.permissions.allow).has('Read'), 'Read must stay permitted');
    assert.match(analyzeBashCommand('grep x y').reason, /Read tool/);
  });

  test('the hints changed the REASON only — every decision is untouched', () => {
    // The gate is the security boundary; this change must be pure text. Allow stays allow, deny deny.
    const cases: [string, 'allow' | 'deny'][] = [
      ['ls -la projects', 'allow'],
      ['cat AGENTS.md', 'allow'],
      ['.venv/bin/python tools/dify_base/find.py --has llm', 'allow'],
      ['.venv/bin/python tools/dify_base/lint_refs.py x.yml', 'allow'],
      ['grep -in x y', 'deny'],
      ['find . -name x', 'deny'],
      ['mkdir -p d', 'deny'],
      ['rm -rf /', 'deny'],
      ['curl https://example.com', 'deny'],
      ['ls x | head', 'deny'],
      ['.venv/bin/python -c print(1)', 'deny'],
      ['.venv/bin/python tools/dify_base/sync.py list', 'deny'], // backend-only, still refused
    ];
    for (const [cmd, want] of cases) {
      assert.equal(analyzeBashCommand(cmd).decision, want, `${cmd} must still ${want}`);
    }
  });

  test('the network verbs are told the backend owns Dify — not offered a workaround', () => {
    for (const cmd of ['curl https://dify.local/v1', 'wget https://x/y']) {
      const r = analyzeBashCommand(cmd);
      assert.equal(r.decision, 'deny');
      assert.match(r.reason, /never reaches the network|backend owns/);
    }
  });
});
