/**
 * Spec 014 D5 (closes 011 R8) — the reconnect version guard. `applyTask` used to set `task.value`
 * UNconditionally, so a late init/reconnect `GET /api/tasks/:id` resolving AFTER a newer live
 * `task:update` would clobber it (the UI reverts to an older phase/gate). Each persisted transition now
 * carries a monotonic `rev`; a strictly-older snapshot for the same task is dropped.
 */
import { describe, it, expect } from 'vitest';
import { applyTask, applyOutput, flushPendingOutput, isFreshSnapshot, resetToNew, settings, splitWorkflowSetting, task, thread } from './store';
import type { LiveThreadItem } from './store';
import type { WireTask, WirePhase } from './types';

/** A minimal running snapshot — `status:'running'` keeps `applyTask` on the run branch, so it never
 *  fires the gate-branch artifact-contents GET (no network in the unit). */
const mk = (taskId: string, rev: number | undefined, phase: WirePhase = 'analyze'): WireTask =>
  ({
    taskId,
    project: null,
    workflow: null,
    workflowFile: 'main.yml',
    requirement: 'r',
    seedPath: null,
    deploy: 'none',
    confirmMode: 'each_step',
    phase,
    status: 'running',
    workflowSlug: null,
    name: null,
    sessionIds: {},
    artifacts: {},
    rev,
  }) as WireTask;

describe('splitWorkflowSetting (spec 030 — compound project/workflow parse)', () => {
  it("'none'/empty → null (from-scratch)", () => {
    expect(splitWorkflowSetting('none')).toBe(null);
    expect(splitWorkflowSetting('')).toBe(null);
    expect(splitWorkflowSetting(null)).toBe(null);
  });
  it('compound project/workflow → both parts', () => {
    expect(splitWorkflowSetting('client_a/summarizer')).toEqual({ project: 'client_a', workflow: 'summarizer' });
  });
  it('a bare legacy value → workflow only (no project)', () => {
    expect(splitWorkflowSetting('summarizer')).toEqual({ workflow: 'summarizer' });
  });
});

describe('isFreshSnapshot (pure rev comparator)', () => {
  it('same task: a strictly-older rev is stale → dropped', () => {
    expect(isFreshSnapshot(mk('A', 1), 'A', 2)).toBe(false);
  });
  it('same task: a newer rev applies', () => {
    expect(isFreshSnapshot(mk('A', 3), 'A', 2)).toBe(true);
  });
  it('same task: an EQUAL rev still applies (artifactContents-enrichment GET shares the rev)', () => {
    expect(isFreshSnapshot(mk('A', 2), 'A', 2)).toBe(true);
  });
  it('a different task always applies (and resets tracking)', () => {
    expect(isFreshSnapshot(mk('B', 0), 'A', 9)).toBe(true);
  });
  it('absent rev ⇒ 0 — a pre-014 snapshot migrates trivially', () => {
    expect(isFreshSnapshot(mk('A', undefined), 'A', 0)).toBe(true); // 0 >= 0
    expect(isFreshSnapshot(mk('A', undefined), 'A', 1)).toBe(false); // 0 < 1
  });
});

describe('applyTask reconnect guard (014 D5 / R8)', () => {
  it('a stale (older-rev) reconnect GET cannot revert a newer applied state', () => {
    applyTask(mk('T1', 1, 'analyze'));
    applyTask(mk('T1', 2, 'spec')); // newer live task:update
    expect(task.value?.phase).toBe('spec');

    applyTask(mk('T1', 1, 'analyze')); // late init/reconnect GET resolves with the OLD snapshot
    expect(task.value?.phase).toBe('spec'); // NOT reverted
    expect(task.value?.rev).toBe(2);
  });

  it('a genuinely newer update still applies (the guard only drops older revs)', () => {
    applyTask(mk('T2', 1, 'analyze'));
    applyTask(mk('T2', 2, 'spec'));
    expect(task.value?.phase).toBe('spec');
    expect(task.value?.rev).toBe(2);
  });

  it('switching to a different task always applies, even if its rev is lower', () => {
    applyTask(mk('T3', 5, 'implement'));
    applyTask(mk('T4', 1, 'analyze')); // a different, freshly-opened build
    expect(task.value?.taskId).toBe('T4');
    expect(task.value?.phase).toBe('analyze');
  });
});

// The /cancel, /restore, failSafe, PATCH confirm_mode routes broadcast a task:update DIRECTLY (bypassing
// the orchestrator's emit). The review found they did NOT bump rev, so an in-flight same-rev enrichment
// GET (issued when the gate was applied) could resolve afterwards and RESURRECT the just-cancelled gate
// — the exact race D5 closes. The fix routes them through bumpRev so the relayed snapshot is strictly
// newer; these pin the comparator effect (the store guard the backend rev now feeds).
describe('cancel/restore bump rev (014 D5 review fix) — a stale gate GET cannot resurrect', () => {
  it('after a rev-bumped cancel, the in-flight same-build gate GET is strictly-older → dropped', () => {
    // gate applied at rev=5; the fixed cancel route bumps → broadcasts cancelled at rev=6; the enrichment
    // GET issued at the gate resolves with the awaiting_confirm snapshot at rev=5 → 5 < 6 → dropped.
    expect(isFreshSnapshot(mk('C', 5, 'test'), 'C', 6)).toBe(false);
  });
  it('WITHOUT the bump (equal rev) it would have applied — why the route must bump', () => {
    expect(isFreshSnapshot(mk('C', 5, 'test'), 'C', 5)).toBe(true); // the pre-fix resurrection
  });
});

// ── spec 017 D6: streaming-output coalescing (F2) ───────────────────────────────────────────────
const runItem = (phase: WirePhase, output = ''): LiveThreadItem =>
  ({ id: 'r', kind: 'run', phase, running: true, output });

describe('applyOutput coalescing (017 D6)', () => {
  it('accumulates fragments onto the trailing running run item (flush-equivalent to the old append)', () => {
    thread.value = [runItem('analyze')];
    applyOutput('analyze', 'Hello ');
    applyOutput('analyze', 'world');
    flushPendingOutput(); // explicit drain (the test env may or may not have requestAnimationFrame)
    const last = thread.value[thread.value.length - 1] as LiveThreadItem & { kind: 'run' };
    expect(last.output).toBe('Hello world');
  });

  it('ignores output for a phase that is not the trailing running item (matches old guard)', () => {
    thread.value = [runItem('analyze', 'kept')];
    applyOutput('spec', 'stray');
    flushPendingOutput();
    const last = thread.value[thread.value.length - 1] as LiveThreadItem & { kind: 'run' };
    expect(last.output).toBe('kept');
  });

  it('a gate transition (applyTask) flushes buffered output FIRST — no fragment is lost', () => {
    thread.value = [runItem('analyze')];
    applyOutput('analyze', 'streamed before the gate');
    // a gate snapshot arrives WITHOUT an explicit flush; applyTask must drain the buffer first.
    const gate = {
      ...mk('GATE1', 1, 'analyze'),
      status: 'awaiting_confirm',
      artifactContents: {}, // truthy → skip the enrichment GET (no network in the unit)
    } as unknown as WireTask;
    applyTask(gate);
    // the (now finalized) run item must carry the streamed text, with running flipped off.
    const run = thread.value.find((i) => i.kind === 'run') as LiveThreadItem & { kind: 'run' };
    expect(run.output).toBe('streamed before the gate');
    expect(run.running).toBe(false);
  });
});

// ── spec 019 C1: a phase:output straggler after the run→gate boundary must not be dropped ──────────
// The run is already finalized and a gate sits after it (the post-transition thread shape). A late
// fragment for that phase must land on its (finalized) run item, not vanish. The old flush only
// appended to a *running* trailing item and then clear()-ed everything → silent data loss.
const irun = (
  phase: WirePhase,
  running: boolean,
  output: string
): LiveThreadItem => ({ id: 'run-' + phase, kind: 'run', phase, running, output });

describe('flushPendingOutput straggler safety (019 C1)', () => {
  it('a straggler after the run→gate transition lands on its run item (not dropped, not doubled)', () => {
    thread.value = [
      irun('implement', false, 'before'), // run finalized at the boundary
      { id: 'g', kind: 'gate', phase: 'implement', snapshot: mk('S', 1, 'implement') },
    ];
    applyOutput('implement', '-straggler'); // arrives AFTER the gate (trailing item is the gate)
    flushPendingOutput();

    const run = thread.value.find((i) => i.kind === 'run') as LiveThreadItem & { kind: 'run' };
    expect(run.output).toBe('before-straggler'); // không mất — landed on its phase's run item

    flushPendingOutput(); // re-drain
    const run2 = thread.value.find((i) => i.kind === 'run') as LiveThreadItem & { kind: 'run' };
    expect(run2.output).toBe('before-straggler'); // không double-append — the key was cleared on landing
  });

  it('a fragment for a phase with NO run item yet is kept buffered (not dropped) until its run exists', () => {
    thread.value = [irun('analyze', true, 'a')];
    applyOutput('test', 'early'); // 'test' has no run item yet
    flushPendingOutput();
    // the analyze item is untouched and 'early' was not lost — it lands once a 'test' run appears.
    expect((thread.value[0] as LiveThreadItem & { kind: 'run' }).output).toBe('a');
    thread.value = [irun('analyze', false, 'a'), irun('test', true, '')];
    flushPendingOutput();
    const testRun = thread.value.find(
      (i) => i.kind === 'run' && i.phase === 'test'
    ) as LiveThreadItem & { kind: 'run' };
    expect(testRun.output).toBe('early'); // the buffered fragment finally landed
  });
});

// ── artifactContents preservation (restores the lost R3/R8 "never blank a defined artifact" guard) ──
// SSE `task:update` and the optimistic /confirm snapshots carry NO artifactContents — only a GET does.
// A naive `task.value = t` blanked the artifact panel (spec/yaml/diff/report read task.artifactContents)
// for the ENTIRE running phase, since a running phase never re-fetches. Symptom: at the Spec gate the
// panel showed SPEC.md, then went "SPEC.md はまだありません" the instant Implement started. setTaskValue
// carries the last-known contents forward for the SAME task; a fresh GET still overrides them.
const withArtifacts = (taskId: string, rev: number, phase: WirePhase, spec: string): WireTask =>
  ({
    ...mk(taskId, rev, phase),
    artifactContents: { spec, yaml: null, report: null, diff: null },
  }) as unknown as WireTask;

describe('artifactContents survive a content-less snapshot (panel-blank fix)', () => {
  it('a later SSE update WITHOUT artifactContents keeps the gate-fetched spec (same task)', () => {
    applyTask(withArtifacts('AC1', 1, 'spec', '# SPEC body')); // e.g. the Spec-gate enrichment GET
    expect(task.value?.artifactContents?.spec).toBe('# SPEC body');

    applyTask(mk('AC1', 2, 'implement')); // live task:update: running Implement, no artifactContents
    expect(task.value?.phase).toBe('implement');
    expect(task.value?.artifactContents?.spec).toBe('# SPEC body'); // preserved — panel stays populated
  });

  it('a fresh GET still OVERRIDES preserved contents (e.g. yaml appears after Implement)', () => {
    applyTask(withArtifacts('AC2', 1, 'implement', '# SPEC'));
    applyTask(withArtifacts('AC2', 2, 'test', '# SPEC v2')); // a real GET with newer contents wins
    expect(task.value?.artifactContents?.spec).toBe('# SPEC v2');
  });

  it('a DIFFERENT task does not inherit the previous task\'s artifactContents', () => {
    applyTask(withArtifacts('AC3', 1, 'spec', 'leak?'));
    applyTask(mk('AC4', 1, 'analyze')); // a freshly-opened build, content-less
    expect(task.value?.taskId).toBe('AC4');
    expect(task.value?.artifactContents).toBeUndefined(); // no cross-task bleed
  });
});

// ── auto-mode panel-blank: a STALE-rev gate GET still grafts its contents (contents only, not phase) ──
// In `auto` confirm-mode the Spec gate auto-advances before the spec-gate enrichment GET resolves, so the
// GET lands at a STRICTLY OLDER rev than the running Implement and the freshness guard drops it whole →
// spec pane blank for the phase. graftStaleArtifacts recovers the contents WITHOUT reverting phase/gate.
describe('stale-rev gate GET grafts artifactContents without reverting phase (auto panel-blank fix)', () => {
  it('a late older-rev spec GET grafts the spec onto the running Implement (phase/rev unchanged)', () => {
    applyTask(mk('AUTO', 3, 'implement')); // auto already advanced to Implement, content-less
    expect(task.value?.artifactContents?.spec).toBeUndefined();
    applyTask(withArtifacts('AUTO', 2, 'spec', '# SPEC body')); // the spec-gate GET resolves LATE (rev 2 < 3)
    expect(task.value?.phase).toBe('implement'); // NOT reverted to spec
    expect(task.value?.rev).toBe(3); // NOT reverted
    expect(task.value?.artifactContents?.spec).toBe('# SPEC body'); // grafted → panel populated
  });

  it('a stale GET WITHOUT artifactContents grafts nothing (014 D5 drop preserved)', () => {
    applyTask(mk('AUTO2', 3, 'implement'));
    applyTask(mk('AUTO2', 2, 'spec')); // older rev, no contents → fully dropped
    expect(task.value?.phase).toBe('implement');
    expect(task.value?.artifactContents).toBeUndefined();
  });

  it('graft never OVERWRITES content the live state already has (current non-null wins)', () => {
    applyTask(withArtifacts('AUTO3', 3, 'implement', '# new spec'));
    applyTask(withArtifacts('AUTO3', 2, 'spec', '# old spec')); // stale GET with an older spec
    expect(task.value?.artifactContents?.spec).toBe('# new spec'); // not clobbered by the stale graft
  });
});

// ── orphan running-run reconciliation (auto-mode stuck "実行中 ②" after cancel) ──────────────────
// Only ONE phase runs at a time (turn-locked) → only the trailing run item may be `running`. An
// out-of-order/auto/reconnect snapshot can leave an earlier run still spinning, and cancel only closes
// the trailing item → the orphan spins forever. applyTask finalizes any non-trailing running run.
describe('non-trailing running run is finalized (stuck-spinner fix)', () => {
  it('closes an orphan "Running spec" left behind when Implement is the trailing run', () => {
    thread.value = [
      { id: 'g', kind: 'gate', phase: 'spec', snapshot: mk('ORPH', 2, 'spec'), resolved: 'x' },
      { id: 'r-spec', kind: 'run', phase: 'spec', running: true, output: '' }, // orphan: still running
      { id: 'r-impl', kind: 'run', phase: 'implement', running: true, output: '' },
    ] as unknown as typeof thread.value;
    applyTask(mk('ORPH', 5, 'implement')); // any fresh same-task update runs the reconciliation sweep
    const specRun = thread.value.find((i) => i.kind === 'run' && i.phase === 'spec') as
      | (LiveThreadItem & { kind: 'run' })
      | undefined;
    expect(specRun?.running).toBe(false); // orphan finalized…
    expect(specRun?.stopped).toBeUndefined(); // …as DONE (its phase completed), not stopped
    expect(thread.value.filter((i) => i.kind === 'run' && i.running).length).toBeLessThanOrEqual(1);
  });

  it('does NOT touch the trailing running run (the genuinely active phase)', () => {
    thread.value = [];
    applyTask(mk('TRAIL', 1, 'implement')); // opens a fresh trailing Implement run
    const run = thread.value.find((i) => i.kind === 'run' && i.phase === 'implement') as
      | (LiveThreadItem & { kind: 'run' })
      | undefined;
    expect(run?.running).toBe(true);
  });
});

// ── spec 019 C2: resetToNew must clear the reconnect rev-guard ───────────────────────────────────
// The guard (_appliedTaskId/_appliedRev) drops any same-task snapshot strictly older than the last
// applied (014 D5). resetToNew used to leave it set, so re-opening a build whose persisted rev is ≤ the
// stale leftover was dropped in applyTask → task.value stayed null + the thread held only the user line
// (a reproducible "blank thread on re-open after reset"). This pins the fix: reset clears the guard.
describe('resetToNew clears the reconnect rev-guard (019 C2)', () => {
  it('after reset, re-opening a build with an older-or-equal rev is NOT dropped (no blank thread)', () => {
    // 1. A build ran and reached a high rev — the guard now holds (taskId 'RX', rev 5).
    applyTask(mk('RX', 5, 'spec'));
    expect(task.value?.taskId).toBe('RX');

    // 2. User resets to the new-task surface.
    resetToNew();
    expect(task.value).toBe(null);

    // 3. Re-open the SAME build: openTask seeds the thread with the user line, nulls task.value, then
    //    applyTask()s the fetched snapshot — whose persisted rev (2) is LOWER than the _appliedRev (5)
    //    that a direct-broadcast route (cancel/restore/PATCH) had bumped before the reset.
    thread.value = [{ id: 'u', kind: 'user', text: 'r' }];
    applyTask(mk('RX', 2, 'spec'));

    // WITHOUT C2 the stale guard drops this older-rev same-task snapshot → task stays null + the thread
    // shows only the user line (blank). WITH C2, resetToNew cleared the guard so it applies.
    expect(task.value?.taskId).toBe('RX');
    expect(thread.value.length).toBeGreaterThan(1); // a run item was appended → not blank
  });
});

// ── New task resets the "base on existing workflow / seed app" selectors ─────────────────────────
// The Workflow/Seed pickers choose what a build starts from; they are start-bound (read-only once a
// build is open) and the dropdown's `none` reset can be off-screen with many workflows. So resetToNew
// must clear them — otherwise the prior build's choice silently carries into the next "new task".
describe('resetToNew resets the new-build base selectors', () => {
  it('clears workflow → none and seed → null (confirm/deploy preferences persist)', () => {
    settings.value = { workflow: 'workflow_uppercases_input_string', confirm: 'auto', deploy: 'cloud', seed: 's1', fast: true, test: 'static', targetProject: 'my_app' };
    resetToNew();
    expect(settings.value.workflow).toBe('none');
    expect(settings.value.seed).toBe(null);
    expect(settings.value.fast).toBe(false); // spec 028: per-build shape assertion — reset like the base selectors
    expect(settings.value.targetProject).toBe(null); // spec 029: per-build target — reset like the base selectors (AC6)
    expect(settings.value.confirm).toBe('auto'); // general preference — not reset
    expect(settings.value.deploy).toBe('cloud'); // general preference — not reset
  });
});
