// gate-stale-import.test.ts — spec 105: a finished build can now be AHEAD of the app it deployed.
//
// Two changes met here. Autonomous builds deliberately skip the ④ Import gate (spec 036 D5: deploy is
// reached from the done state, not auto-pushed), and unattended fix rounds now run straight through ④
// instead of parking at ③. So the only surface that ever compared "what is on disk" with "what was
// imported" — the Import gate card — is precisely the surface such a build never sees.
//
// The result was 完了 on a card while Dify held an older file, with nothing saying so. The user's next
// move after that card is to go and run the app.
import { describe, it, expect } from 'vitest';
import { gateView } from './components/Chat';
import type { WireTask } from './types';

const doneTask = (over: Partial<WireTask>): WireTask =>
  ({ phase: 'test', status: 'done', workflowFile: 'main.yml', ...over }) as WireTask;

describe('105 · a done build whose deployed app is behind', () => {
  it('says so, and the line LEADS the summary', () => {
    const v = gateView(doneTask({ importedHash: 'aaa', artifactHash: 'bbb', importedAt: 0 }));
    expect(v.summary[0]).toMatch(/Dify still has the version imported at/);
    // The ordinary done lines survive underneath — the build really did finish.
    expect(v.summary.join(' ')).toMatch(/Linters re-run/);
  });

  it('stays silent when Dify already has this exact file', () => {
    const v = gateView(doneTask({ importedHash: 'same', artifactHash: 'same', importedAt: 0 }));
    expect(v.summary.join(' ')).not.toMatch(/Dify still has/);
  });

  it('stays silent when nothing was ever imported — there is nothing to be behind', () => {
    // The common case: a build that finished without ever being pushed. Claiming Dify is stale here
    // would invent a deployment that does not exist.
    expect(gateView(doneTask({ artifactHash: 'bbb' })).summary.join(' ')).not.toMatch(/Dify still has/);
    expect(gateView(doneTask({})).summary.join(' ')).not.toMatch(/Dify still has/);
  });

  it('stays silent when the current file has not been measured', () => {
    // `artifactHash` absent means "not measured", never "different". Reading it as a difference would
    // put a deployment warning on a build nobody can check — the same three-state care the ③ gate takes.
    const v = gateView(doneTask({ importedHash: 'aaa', importedAt: 0 }));
    expect(v.summary.join(' ')).not.toMatch(/Dify still has/);
  });
});
