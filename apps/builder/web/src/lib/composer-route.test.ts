// composer-route.test.ts — pins where a typed message goes. This decision fails SILENTLY when wrong (a
// fix that lands on /ask comes back as an explanation while the workflow is untouched), which is exactly
// how the post-import fix loop first broke in the field — hence a pure module with its own tests.
import { describe, it, expect } from 'vitest';
import { composerTarget, replyLabel } from './composer-route';
import type { WireTask } from '../types';

const t = (over: Partial<WireTask>): Pick<WireTask, 'status' | 'kind'> =>
  ({ status: 'awaiting_confirm', ...over }) as WireTask;

describe('composerTarget — the empty surface', () => {
  it('no task → start (a brand-new build or chat)', () => {
    expect(composerTarget(null, 'ask')).toBe('start');
    expect(composerTarget(undefined, 'change')).toBe('start');
  });
});

describe('composerTarget — the post-import fix loop (a DONE build stays fixable)', () => {
  it('done + change-mode → reply (reopens the build, resumes the implement session)', () => {
    expect(composerTarget(t({ status: 'done' }), 'change')).toBe('reply');
  });

  it('done + ask-mode → ask (a question about the finished build is still the default)', () => {
    expect(composerTarget(t({ status: 'done' }), 'ask')).toBe('ask');
  });

  it('CANCELLED + change-mode → ask, NOT reply (a cancelled build re-enters via Restore)', () => {
    expect(composerTarget(t({ status: 'cancelled' }), 'change')).toBe('ask');
    expect(composerTarget(t({ status: 'cancelled' }), 'ask')).toBe('ask');
  });

  it('a done PROMOTE build is a promote reply, never the fix loop (no implement phase to resume)', () => {
    expect(composerTarget(t({ status: 'done', kind: 'promote' }), 'ask')).toBe('reply');
  });
});

describe('composerTarget — live gates (unchanged by the fix loop)', () => {
  it('parked gate: ask by default, reply when change-mode is armed', () => {
    expect(composerTarget(t({ status: 'awaiting_confirm' }), 'ask')).toBe('ask');
    expect(composerTarget(t({ status: 'awaiting_confirm' }), 'change')).toBe('reply');
  });

  it('error → reply in BOTH modes (the Retry path — Ask is not offered there)', () => {
    expect(composerTarget(t({ status: 'error' }), 'ask')).toBe('reply');
    expect(composerTarget(t({ status: 'error' }), 'change')).toBe('reply');
  });

  it('promote → reply at any status/mode (a promote build has no Ask surface, spec 052)', () => {
    for (const status of ['awaiting_confirm', 'error', 'done', 'cancelled'] as const) {
      expect(composerTarget(t({ status, kind: 'promote' }), 'ask')).toBe('reply');
    }
  });

  it('running → follows the mode (the composer is disabled mid-turn; this is the fallthrough)', () => {
    expect(composerTarget(t({ status: 'running' }), 'ask')).toBe('ask');
  });
});

describe('replyLabel — what the resolved gate card reads', () => {
  it('promote is always the pinned label', () => {
    expect(replyLabel('awaiting_confirm', 'promote', 'ask', 'Edit spec')).toBe('Request changes');
  });

  it('a text-steered Retry with no armed action → undefined (store falls back to the generic)', () => {
    expect(replyLabel('error', undefined, 'ask', 'Edit spec')).toBeUndefined();
  });

  it('an armed action carries its own label — including the done-build fix', () => {
    expect(replyLabel('error', undefined, 'change', 'Keep trying')).toBe('Keep trying');
    expect(replyLabel('awaiting_confirm', undefined, 'change', 'Edit spec')).toBe('Edit spec');
    expect(replyLabel('done', undefined, 'change', 'Request changes')).toBe('Request changes');
  });
});
