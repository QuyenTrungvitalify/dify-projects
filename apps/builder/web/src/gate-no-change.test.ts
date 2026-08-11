// gate-no-change.test.ts — spec 094 S1, the UI half: what the two gates say when a fix round changed
// nothing.
//
// The measured failure (run 1786089321835) was NOT a wrong computation — it was that the ③ gate and the
// ④ Import gate rendered an empty round IDENTICALLY to a round that fixed two real bugs, so the user
// re-imported an unchanged file and asked "bạn có chắc đang sửa đúng ko?". These cases pin the
// difference, and pin that it appears ONLY on a positive measurement.
import { describe, it, expect } from 'vitest';
import { gateView } from './components/Chat';
import type { WireTask } from './types';

const implTask = (over: Partial<WireTask>): WireTask =>
  ({ phase: 'implement', status: 'awaiting_confirm', gate: { actions: [] }, ...over }) as WireTask;

const importTask = (over: Partial<WireTask>): WireTask =>
  ({
    phase: 'test',
    status: 'awaiting_confirm',
    workflowFile: 'main.yml',
    gate: { actions: [], flag: 'awaiting_import' },
    ...over,
  }) as WireTask;

describe('094 S1 · ③ gate — the round that changed nothing', () => {
  it('artifactUnchanged:true → its own badge, and the no-change line LEADS the summary', () => {
    const v = gateView(implTask({ artifactUnchanged: true }));
    expect(v.badge).toBe('No file change');
    expect(v.summary[0]).toMatch(/did not change the workflow file/);
    // The ordinary lint line survives underneath — the round still produced a verified file.
    expect(v.summary.join(' ')).toMatch(/linters green/);
  });

  it('artifactUnchanged:false → the ordinary Implemented card, unchanged from pre-094', () => {
    const v = gateView(implTask({ artifactUnchanged: false }));
    expect(v.badge).toBe('Implemented');
    expect(v.summary.join(' ')).not.toMatch(/did not change/);
  });

  it('artifactUnchanged absent (pre-094 build / not measured) → ordinary card, never a claim', () => {
    // The load-bearing case: `undefined` must not read as "unchanged". Every task.json written before
    // this spec lacks the field, and a badge saying "nothing changed" on a round that DID change
    // something is worse than no badge at all.
    const v = gateView(implTask({}));
    expect(v.badge).toBe('Implemented');
    expect(v.summary.join(' ')).not.toMatch(/did not change/);
  });
});

describe('094 S1 · ④ Import gate — "this is the file you already imported"', () => {
  it('matching hashes → the line appears FIRST, with the import time', () => {
    const v = gateView(
      importTask({
        importAppId: 'app-1',
        artifactHash: 'abc',
        importedHash: 'abc',
        importedAt: new Date('2026-08-10T01:09:00Z').getTime(),
      })
    );
    expect(v.summary[0]).toMatch(/byte-for-byte the one imported at/);
  });

  it('differing hashes (a real fix landed) → no line', () => {
    const v = gateView(
      importTask({ importAppId: 'app-1', artifactHash: 'def', importedHash: 'abc', importedAt: 1 })
    );
    expect(v.summary.join(' ')).not.toMatch(/byte-for-byte/);
  });

  it('nothing imported yet → no line (nothing to compare against)', () => {
    const v = gateView(importTask({ artifactHash: 'abc' }));
    expect(v.summary.join(' ')).not.toMatch(/byte-for-byte/);
  });

  it('the Import action set is NOT touched — the button stays available', () => {
    // 094 non-goal: never block the import. The user may re-push deliberately, and since the
    // ④-overwrite work a redundant import is harmless (same app id in, same app out).
    const actions = [{ id: 'import', label: 'Import to Dify', kind: 'confirm', route: '/confirm' }];
    const v = gateView(
      importTask({
        gate: { actions, flag: 'awaiting_import' },
        importAppId: 'app-1',
        artifactHash: 'abc',
        importedHash: 'abc',
        importedAt: 1,
      } as Partial<WireTask>)
    );
    expect(v.badge).toBe('Ready to deploy'); // still the deploy card, just with one more sentence
  });
});
