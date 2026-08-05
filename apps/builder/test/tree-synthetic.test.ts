/**
 * Spec 090 S2 — buildTree marks the `(unsaved)` grouping row `synthetic: true` and REAL workflow
 * rows carry no flag. The flag is the load-bearing bit: the sidebar keeps a synthetic row
 * expandable but never selectable-as-edit-base (clicking it used to arm the phantom target
 * `_drafts/(unsaved)` → deterministic ② death, bundle 1785901684698 / repro 1785916628346).
 * The FE consumption is a render-guard with no component-test infra (components/** is unowned —
 * docs/state/README §Bề mặt chưa có chủ), so the SERVER contract is what gets pinned.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTree, type TreeWorkflowNode } from '../server/lib/artifacts.js';
import { createTask } from '../server/state/task.js';

describe('buildTree — synthetic `(unsaved)` row (spec 090 S2)', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tree-syn-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('a pre-scaffold task lands under `(unsaved)` with synthetic:true; a real workflow row has NO flag', async () => {
    // Real workflow folder + a loose (pre-scaffold, no project/slug) task.
    await mkdir(join(dir, 'projects', 'p1', 'wf', 'workflows'), { recursive: true });
    await writeFile(join(dir, 'projects', 'p1', 'wf', 'workflows', 'main.yml'), 'app: {}\n');
    await createTask(dir, { requirement: 'loose draft' }); // no workflow/slug → pre-scaffold

    const tree = await buildTree(dir, Date.now());
    const rows = tree.flatMap((p) => p.workflows.map((w) => [p.id, w] as [string, TreeWorkflowNode]));

    const unsaved = rows.find(([, w]) => w.id === '(unsaved)');
    assert.ok(unsaved, 'the loose task produced the (unsaved) grouping row');
    assert.equal(unsaved![0], '_drafts');
    assert.equal(unsaved![1].synthetic, true, 'grouping row is marked synthetic');
    assert.equal(unsaved![1].tasks.length, 1);

    const real = rows.find(([, w]) => w.id === 'wf');
    assert.ok(real, 'the real workflow row exists');
    assert.equal(real![1].synthetic, undefined, 'real rows carry NO flag (pre-090 wire shape)');
  });

  test('orphan task in an EXISTING project → its row is synthetic too (the second phantom generator)', async () => {
    // Found reviewing 090 in the live UI: the first fix only marked the `(unsaved)` bucket. A task
    // whose PROJECT exists but whose workflowSlug matches no folder got its own row here — carrying a
    // friendly name (the requirement prefix) and the full edit/delete affordances — so clicking it
    // armed a target the route now rejects: a select-then-refuse loop. This is the shape the field
    // repro left behind (`_drafts/unsaved`, run 1785916628346).
    await mkdir(join(dir, 'projects', '_drafts', 'real_wf', 'workflows'), { recursive: true });
    await writeFile(join(dir, 'projects', '_drafts', 'real_wf', 'workflows', 'main.yml'), 'app: {}\n');
    const orphan = await createTask(dir, { requirement: 'edit a ghost', workflow: 'ghost_wf', project: '_drafts' });
    orphan.workflowSlug = 'ghost_wf'; // what localEditSeed would resolve (no folder exists for it)
    const { saveTask } = await import('../server/state/task.js');
    await saveTask(dir, orphan);

    const tree = await buildTree(dir, Date.now());
    const drafts = tree.find((p) => p.id === '_drafts');
    assert.ok(drafts, '_drafts project row exists (it has a real folder on disk)');
    const ghost = drafts!.workflows.find((w) => w.id === 'ghost_wf');
    assert.ok(ghost, 'the orphan task still shows (visibility preserved)');
    assert.equal(ghost!.synthetic, true, 'no folder on disk ⇒ synthetic ⇒ not selectable as a base');
    const realWf = drafts!.workflows.find((w) => w.id === 'real_wf');
    assert.equal(realWf?.synthetic, undefined, 'the sibling REAL workflow is unaffected');
  });
});
