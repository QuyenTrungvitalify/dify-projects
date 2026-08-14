/**
 * Finishing an interrupted ask from the backend transcript. The bug being pinned: send a question, open
 * another task, come back — the streamed chunks are gone from the wire (ask:answer is excluded from the
 * replay buffer, and a new EventSource sends no Last-Event-ID), so the settle used to close an EMPTY
 * bubble as a successful "Answered". These tests hold the two honesty rules: never graft across
 * questions, never shorten an answer.
 */
import { describe, it, expect } from 'vitest';
import { recoverOpenAsk, openAskIndex, type LastAsk } from './ask-recovery';
import type { LiveThreadItem } from '../store';

const user = (text: string): LiveThreadItem => ({ id: 'u', kind: 'user', text });
const qa = (question: string, answer: string, done = false): LiveThreadItem =>
  ({ id: 'q', kind: 'qa', question, answer, done });
const ask = (over: Partial<LastAsk> = {}): LastAsk => ({ q: 'why?', a: 'the full answer', ok: true, ...over });

describe('openAskIndex', () => {
  it('finds the LAST unsettled qa bubble', () => {
    const items = [qa('a', 'x', true), user('why?'), qa('why?', '')];
    expect(openAskIndex(items)).toBe(2);
  });

  it('is -1 when every bubble is settled', () => {
    expect(openAskIndex([qa('a', 'x', true)])).toBe(-1);
    expect(openAskIndex([])).toBe(-1);
  });
});

describe('recoverOpenAsk', () => {
  it('fills an EMPTY bubble from the transcript — the reported failure', () => {
    const items = [user('why?'), qa('why?', '')];
    const rec = recoverOpenAsk(items, ask({ a: 'because of X and Y' }));
    expect(rec).not.toBeNull();
    expect((rec!.items[1] as { answer: string }).answer).toBe('because of X and Y');
    expect(rec!.ok).toBe(true);
    expect(items[1]).toEqual(qa('why?', '')); // input not mutated
  });

  it('completes a PARTIAL bubble (the switch happened mid-answer)', () => {
    const rec = recoverOpenAsk([qa('why?', 'because of')], ask({ a: 'because of X and Y' }));
    expect((rec!.items[0] as { answer: string }).answer).toBe('because of X and Y');
  });

  it('NEVER shortens: a live stream ahead of the transcript keeps its text, but adopts the outcome', () => {
    const long = 'because of X and Y, in detail';
    const rec = recoverOpenAsk([qa('why?', long)], ask({ a: 'because of X', ok: false }));
    expect((rec!.items[0] as { answer: string }).answer).toBe(long);
    expect(rec!.ok).toBe(false);
  });

  it('refuses to graft an answer belonging to a DIFFERENT question', () => {
    expect(recoverOpenAsk([qa('what about Z?', '')], ask({ q: 'why?', a: 'about why' }))).toBeNull();
  });

  it('matches ignoring surrounding whitespace (store.ask trims, the transcript may not)', () => {
    const rec = recoverOpenAsk([qa('why?', '')], ask({ q: '  why?\n', a: 'ans' }));
    expect((rec!.items[0] as { answer: string }).answer).toBe('ans');
  });

  it('carries a FAILED outcome through, so a bad settle stops reading as success', () => {
    const rec = recoverOpenAsk([qa('why?', '')], ask({ a: "couldn't get an answer", ok: false }));
    expect(rec!.ok).toBe(false);
  });

  it('returns null with no transcript — every pre-transcript build keeps the old behavior', () => {
    expect(recoverOpenAsk([qa('why?', '')], undefined)).toBeNull();
    expect(recoverOpenAsk([qa('why?', '')], null)).toBeNull();
  });

  it('returns null when no bubble is open (nothing to finish)', () => {
    expect(recoverOpenAsk([qa('why?', 'done already', true)], ask())).toBeNull();
  });
});

/**
 * The AUTO-RECONNECT hole. There the settle runs BEFORE the authoritative GET lands, so `lastAsk` is not
 * available yet and the bubble closes empty — and a settled bubble is invisible to the default pass.
 * The second pass runs once the snapshot arrives, with `includeSettled`.
 */
describe('recoverOpenAsk — the second pass (includeSettled)', () => {
  it('fills a bubble that ALREADY settled empty', () => {
    const rec = recoverOpenAsk([qa('why?', '', true)], ask({ a: 'the answer' }), true);
    expect((rec!.items[0] as { answer: string }).answer).toBe('the answer');
  });

  it('still refuses a different question', () => {
    expect(recoverOpenAsk([qa('other?', '', true)], ask({ q: 'why?' }), true)).toBeNull();
  });

  it('is a NO-OP on a normal connect: the client already has the full answer', () => {
    const items = [qa('why?', 'the full answer', true)];
    const rec = recoverOpenAsk(items, ask({ a: 'the full answer' }), true);
    expect(rec!.items).toBe(items); // same reference → assigning it re-renders nothing
  });

  it('targets the LAST exchange, not an older settled one', () => {
    const items = [qa('old?', 'old answer', true), qa('why?', '', true)];
    const rec = recoverOpenAsk(items, ask({ q: 'why?', a: 'new answer' }), true);
    expect((rec!.items[1] as { answer: string }).answer).toBe('new answer');
    expect((rec!.items[0] as { answer: string }).answer).toBe('old answer');
  });

  it('without the flag, a settled bubble is left alone (default pass is unchanged)', () => {
    expect(recoverOpenAsk([qa('why?', '', true)], ask({ a: 'x' }))).toBeNull();
  });
});

/* The cost only ever exists on the transcript side, so recovery must fold it on even when the LIVE text
   wins — it is a fact about the turn, not a competing version of the answer. (Rule 2 stays intact: the
   text is never shortened.) */
describe('recovery carries the dev cost tip', () => {
  const cost = { model: 'claude-opus-5', outputTokens: 494 };

  it('folds cost onto a bubble whose live text is already complete', () => {
    const items = [{ id: 'a', kind: 'qa', question: 'q', answer: 'the full answer', done: false }] as unknown as LiveThreadItem[];
    const out = recoverOpenAsk(items, { q: 'q', a: 'the full', ok: true, cost });
    const qa = out!.items[0] as { answer: string; cost?: { model?: string } };
    expect(qa.answer).toBe('the full answer'); // never shortened
    expect(qa.cost?.model).toBe('claude-opus-5');
  });

  it('carries it when the transcript answer wins too', () => {
    const items = [{ id: 'a', kind: 'qa', question: 'q', answer: 'the', done: false }] as unknown as LiveThreadItem[];
    const out = recoverOpenAsk(items, { q: 'q', a: 'the full answer', ok: true, cost });
    const qa = out!.items[0] as { answer: string; cost?: { model?: string } };
    expect(qa.answer).toBe('the full answer');
    expect(qa.cost?.model).toBe('claude-opus-5');
  });

  it('leaves a bubble untouched when the transcript has no cost (every pre-existing build)', () => {
    const items = [{ id: 'a', kind: 'qa', question: 'q', answer: 'done text', done: false }] as unknown as LiveThreadItem[];
    const out = recoverOpenAsk(items, { q: 'q', a: 'done', ok: true });
    expect(out!.items[0]).toBe(items[0]);
  });
});
