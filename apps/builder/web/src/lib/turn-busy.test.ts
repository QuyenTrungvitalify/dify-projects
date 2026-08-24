/**
 * The turn-collision 409 is the ONE error a user meets while simply trying to talk, so it is the one
 * the UI restates in the reader's language. That restating is only safe if the match is narrow: these
 * tests pin both halves — it recognizes the collision, and it lets every other 409 through untouched.
 */
import { describe, it, expect } from 'vitest';
import { isTurnBusy, TURN_BUSY_PREFIX } from './turn-busy';

describe('isTurnBusy', () => {
  it('matches the server string verbatim', () => {
    expect(isTurnBusy(409, 'a turn is already running — try again in a moment')).toBe(true);
  });

  it('matches the prefix even if the advice tail is reworded server-side', () => {
    expect(isTurnBusy(409, TURN_BUSY_PREFIX)).toBe(true);
  });

  it('leaves the OTHER 409s alone — they carry their own specific message', () => {
    for (const m of [
      'task is done, not awaiting_confirm',
      "'apply_spec' is not a current confirm action",
      'not a promote task',
      'this task has a turn running — cancel it before removing it', // a DIFFERENT 409, different wording
      '/ask is not available for a promote build',
    ]) {
      expect(isTurnBusy(409, m)).toBe(false);
    }
  });

  it('is status-scoped: the same words on a non-409 are not a turn collision', () => {
    expect(isTurnBusy(500, 'a turn is already running — try again in a moment')).toBe(false);
  });
});
