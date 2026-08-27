// textless-reply.test.ts — the two ends of "this button is one click".
//
// A reply action drawn as a single click and a route that answers 400 without text is a button that
// cannot do what it says. That is what 「再試行を続ける」 was: the web app rendered it as an arm-the-
// composer signpost precisely BECAUSE the route demanded text, so its label promised a free re-run and
// its behaviour asked you to write an essay first.
//
// `TEXTLESS_REPLY_IDS` is now the single list both ends read. This file pins that they still read the
// same one: the route's acceptance (`acceptsTextlessReply`, unit-tested here) and the renderer's
// carve-out (`replyButtonKind`, grepped here because it lives in the web package, the same convention
// gate-i18n-labels.test.ts and vocab-one-root.test.ts use for cross-package agreements).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptsTextlessReply, computeGate, TEXTLESS_REPLY_IDS } from '../server/lib/gate.js';
import type { Task } from '../server/state/task.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Just enough task for the acceptance rule — it reads `status` and `gate` and nothing else. */
const parked = (gate: ReturnType<typeof computeGate>): Pick<Task, 'status' | 'gate'> =>
  ({ status: 'awaiting_confirm', gate }) as Pick<Task, 'status' | 'gate'>;

describe('an empty /reply is accepted exactly where a one-click button is drawn', () => {
  test('the still-failing Implement gate — the case that was broken', () => {
    const gate = computeGate('implement', { outcome: 'still_failing' }, 'none');
    assert.ok(gate.actions.some((a) => a.id === 'keep'), 'the gate still offers Keep-trying');
    assert.equal(acceptsTextlessReply(parked(gate)), true);
  });

  test('an errored build, whatever its gate says', () => {
    // The licence here is the STATUS, not the action list: a promote build that errors carries no gate
    // at all, and the route has always let an errored build re-run from its fresh prompt.
    assert.equal(acceptsTextlessReply({ status: 'error', gate: undefined } as Pick<Task, 'status' | 'gate'>), true);
  });

  test('an ordinary parked gate does NOT — empty text there means nothing', () => {
    // Analyze/Spec/clean-Implement offer `changes`, which exists to CARRY an instruction. Accepting an
    // empty one would spawn a paid turn that was told nothing.
    for (const gate of [
      computeGate('analyze', { outcome: 'success' }, 'none'),
      computeGate('spec', { outcome: 'success' }, 'none'),
      computeGate('implement', { outcome: 'success' }, 'none'),
      computeGate('test', { outcome: 'awaiting_import' }, 'none'),
    ]) {
      assert.equal(acceptsTextlessReply(parked(gate)), false);
    }
  });

  test('only reply-KIND actions count, never a confirm that happens to share an id', () => {
    const gate = { actions: [{ id: 'keep', label: 'Keep trying', kind: 'confirm' as const, route: '/confirm' as const }] };
    assert.equal(acceptsTextlessReply(parked(gate)), false);
  });
});

describe('the renderer draws a click for exactly those ids', () => {
  test('replyButtonKind answers `retry` for every id on the shared list', () => {
    const src = readFileSync(join(HERE, '..', 'web', 'src', 'lib', 'gate-foot.ts'), 'utf8');
    // The web package cannot import from the server, so the list is duplicated by hand there. What this
    // checks is that the duplicate has not drifted: every id the ROUTE will accept an empty body for is
    // named in the renderer's carve-out, and the renderer names no other.
    const carveOut = src.slice(src.indexOf('export function replyButtonKind'));
    for (const id of TEXTLESS_REPLY_IDS) {
      assert.match(carveOut, new RegExp(`action\\.id === '${id}'`), `renderer forgot the id '${id}'`);
    }
    const drawnAsClick = [...carveOut.matchAll(/action\.id === '([a-z_]+)'/g)].map((m) => m[1]);
    // `changes` appears in that function too, answering 'hidden' — it is the one id allowed to be named
    // there without being on the list, and it must never become a click.
    const unexpected = drawnAsClick.filter((id) => !TEXTLESS_REPLY_IDS.includes(id) && id !== 'changes');
    assert.deepEqual(unexpected, [], `renderer clicks an id the route will 400: ${unexpected.join(', ')}`);
  });

  test('the route reads the shared list rather than a second copy of it', () => {
    const routes = readFileSync(join(HERE, '..', 'server', 'routes', 'tasks.ts'), 'utf8');
    assert.match(routes, /if \(!text && !acceptsTextlessReply\(task\)\)/);
  });
});
