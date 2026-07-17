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
  test('the search verbs point at the tools that replace them', () => {
    assert.match(analyzeBashCommand('grep -in chatwork templates/tool-catalog.json').reason, /Grep tool/);
    assert.match(analyzeBashCommand('find . -name find.py').reason, /Glob tool/);
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

  test('the destructive verbs keep the blunt refusal — for them redirection is not the point', () => {
    for (const cmd of ['rm -rf /', 'sudo ls', 'dd if=/dev/zero of=/dev/sda', 'chmod 777 /etc']) {
      const r = analyzeBashCommand(cmd);
      assert.equal(r.decision, 'deny');
      assert.match(r.reason, /dangerous executable/, `${cmd} must not be offered a workaround`);
    }
  });
});

describe('the invariants that keep the hints honest', () => {
  test('every tool a hint names is one headless-settings actually ALLOWS', () => {
    // A hint pointing at a denied tool would swap one dead end for another — worse than silence.
    const settings = JSON.parse(readFileSync(join(REPO, 'apps/builder/headless-settings.json'), 'utf8'));
    const allowed = new Set<string>(settings.permissions.allow);
    const denied: string[] = [];
    for (const cmd of ['grep x y', 'find . -name x', 'sed -i s/a/b/ f', 'awk {print} f', 'cp a b', 'mv a b', 'mkdir d', 'touch f', 'tee f']) {
      const reason = analyzeBashCommand(cmd).reason;
      for (const tool of reason.match(/\b(Read|Write|Edit|Glob|Grep|Bash)\b/g) ?? []) {
        if (!allowed.has(tool)) denied.push(`${cmd} → names "${tool}", which is not in permissions.allow`);
      }
    }
    assert.deepEqual(denied, []);
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
