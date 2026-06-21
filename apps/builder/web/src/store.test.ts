/**
 * Spec 014 D5 (closes 011 R8) — the reconnect version guard. `applyTask` used to set `task.value`
 * UNconditionally, so a late init/reconnect `GET /api/tasks/:id` resolving AFTER a newer live
 * `task:update` would clobber it (the UI reverts to an older phase/gate). Each persisted transition now
 * carries a monotonic `rev`; a strictly-older snapshot for the same task is dropped.
 */
import { describe, it, expect } from 'vitest';
import { applyTask, applyOutput, flushPendingOutput, isFreshSnapshot, resetToNew, task, thread } from './store';
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
    slug: null,
    name: null,
    sessionIds: {},
    artifacts: {},
    rev,
  }) as WireTask;

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
