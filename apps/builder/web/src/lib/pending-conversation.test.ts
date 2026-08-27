/**
 * Spec 105 M4 — which conversations are worth interrupting a new one for.
 *
 * The whole value is in the narrowness. A prompt that fires on the ordinary path (finish a build, click
 * the pencil, start the next round) is a prompt people learn to dismiss unread — and then it is worth
 * nothing on the one occasion it carried news. So `done`/`cancelled` MUST stay silent, and only a build
 * a human still owes an answer to may speak.
 */
import { describe, it, expect } from 'vitest';
import { pendingConversation, isWaiting } from './pending-conversation';
import type { WireTreeProject, WireTreeTask } from '../types';

const task = (id: string, status: WireTreeTask['status'], phase: WireTreeTask['phase'] = 'implement'): WireTreeTask =>
  ({ id, name: id, time: '', status, phase });

const tree = (tasks: WireTreeTask[], project = 'p1', wf = 'specced'): WireTreeProject[] =>
  [{ id: project, name: project, workflows: [{ id: wf, name: wf, tasks }] }];

describe('105 M4 · the conversation a new build would walk away from', () => {
  it('speaks for a build parked at a gate, and for an errored one', () => {
    // Both are holding a question open: one at a gate, one behind a Retry that is a single click away.
    expect(pendingConversation(tree([task('t1', 'awaiting_confirm')]), 'p1/specced')?.id).toBe('t1');
    expect(pendingConversation(tree([task('t2', 'error')]), 'p1/specced')?.id).toBe('t2');
  });

  it('stays silent for a finished or abandoned build — the common path', () => {
    // This IS what 「新しい会話で編集」 is for. Asking here would put a dialog between the user and the
    // action on nearly every use of the button.
    expect(pendingConversation(tree([task('t3', 'done')]), 'p1/specced')).toBeNull();
    expect(pendingConversation(tree([task('t4', 'cancelled')]), 'p1/specced')).toBeNull();
  });

  it('stays silent for a running build — the create route already refuses that', () => {
    // `POST /api/tasks` 409s while a turn holds the lock, so this cannot be reached by starting a build.
    // Claiming it here would describe a collision the server has already prevented.
    expect(pendingConversation(tree([task('t5', 'running')]), 'p1/specced')).toBeNull();
  });

  it('picks the NEWEST waiting one when several qualify', () => {
    // Rows arrive newest-first from `buildTree`, so the first match is the one a human recognises as
    // "the one I was in" — not the oldest thing still lying around.
    const t = tree([task('new', 'done'), task('mid', 'awaiting_confirm'), task('old', 'error')]);
    expect(pendingConversation(t, 'p1/specced')?.id).toBe('mid');
  });

  it('resolves a bare slug where the SEND would go, not wherever the name appears first', () => {
    // The same trap `armedStartsAtImplement` shipped and had to fix. `start()` resolves a bare slug
    // against `settings.targetProject`, falling back to `_drafts` server-side — so scanning every
    // project and taking the first name match would warn about some other folder's build.
    const t: WireTreeProject[] = [
      ...tree([task('mine', 'awaiting_confirm')], 'my_app', 'specced'),
      ...tree([task('drafts', 'done')], '_drafts', 'specced'),
    ];
    expect(pendingConversation(t, 'specced')).toBeNull();            // → _drafts/specced, which is done
    expect(pendingConversation(t, 'specced', 'my_app')?.id).toBe('mine');
  });

  it('says nothing when nothing is armed, or the row is unknown', () => {
    expect(pendingConversation(tree([task('t', 'error')]), null)).toBeNull();
    expect(pendingConversation(tree([task('t', 'error')]), 'none')).toBeNull();
    expect(pendingConversation(tree([task('t', 'error')]), 'p1/other')).toBeNull();
  });

  it('isWaiting is the one place the rule lives', () => {
    expect(isWaiting({ status: 'awaiting_confirm' })).toBe(true);
    expect(isWaiting({ status: 'error' })).toBe(true);
    for (const s of ['done', 'cancelled', 'running', 'scaffolding'] as const) {
      expect(isWaiting({ status: s })).toBe(false);
    }
  });
});
