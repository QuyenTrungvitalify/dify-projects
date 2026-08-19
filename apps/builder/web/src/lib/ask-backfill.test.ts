/**
 * Spec 099 S1 / 101 §3.1 — restoring a build's lost Q&A from the transcript on disk.
 *
 * The unit under test is where every trap lives: pairing, the Set-vs-multiset diff, whether an existing
 * item may be touched (never), and whether the restored block is honest about its own position. The
 * store wiring around it is thin by design and tested separately.
 */
import { describe, it, expect } from 'vitest';
import { backfillFromTranscript, type TranscriptLine } from './ask-backfill';
import type { LiveThreadItem } from '../store';

let n = 0;
const uid = (): string => `id-${++n}`;
const opts = { phase: 'test' as const, uid };

const qa = (question: string, answer = 'a', done = true): LiveThreadItem =>
  ({ id: `qa-${question}`, kind: 'qa', question, answer, done });
const user = (text: string): LiveThreadItem => ({ id: `u-${text}`, kind: 'user', text });
const run = (output: string): LiveThreadItem =>
  ({ id: `r-${output}`, kind: 'run', phase: 'implement', running: false, output });

/** A transcript of `qN`/`aN` exchanges, exactly how `recordAsk` lays them out. */
const chatOf = (...qs: string[]): TranscriptLine[] =>
  qs.flatMap((q) => [
    { role: 'user' as const, text: q },
    { role: 'assistant' as const, text: `answer to ${q}` },
  ]);

const texts = (items: LiveThreadItem[]): string[] =>
  items.map((i) => (i.kind === 'qa' ? `qa:${i.question}` : i.kind === 'user' ? `user:${i.text}` : `${i.kind}`));

describe('backfillFromTranscript — append what is missing, never rebuild', () => {
  it('appends the exchanges the thread does not have, in transcript order, as user+qa pairs', () => {
    const items = [user('build me a thing'), qa('q1')];
    const out = backfillFromTranscript(items, chatOf('q1', 'q2', 'q3'), opts)!;

    expect(out).not.toBeNull();
    expect(texts(out)).toEqual([
      'user:build me a thing', 'qa:q1',
      'user:q2', 'qa:q2',
      'user:q3', 'qa:q3',
    ]);
    const restored = out[out.length - 1] as LiveThreadItem & { kind: 'qa' };
    expect(restored.answer).toBe('answer to q3');
    expect(restored.done).toBe(true); // a restored exchange is settled — it finished long ago
  });

  it('returns NULL when nothing is missing — not an equal copy', () => {
    // Load-bearing: the caller assigns to a signal the persistence effect watches, so a new-but-equal
    // array would publish a write for an unchanged thread. That is the multi-tab clobber shape (S1b).
    const items = [qa('q1'), qa('q2')];
    expect(backfillFromTranscript(items, chatOf('q1', 'q2'), opts)).toBeNull();
  });

  it('returns NULL for an empty transcript, and for one with no complete exchange', () => {
    expect(backfillFromTranscript([qa('q1')], [], opts)).toBeNull();
    expect(
      backfillFromTranscript([], [{ role: 'user', text: 'asked, never answered' }], opts),
      'a question whose turn died has no answer to restore',
    ).toBeNull();
  });

  it('MULTISET, not Set: the same question asked twice with one bubble kept restores exactly one', () => {
    // A Set-based diff concludes "q1 is present" and restores nothing, losing an exchange for good.
    const out = backfillFromTranscript([qa('q1')], chatOf('q1', 'q1'), opts)!;
    expect(out.filter((i) => i.kind === 'qa')).toHaveLength(2);
    expect(texts(out)).toEqual(['qa:q1', 'user:q1', 'qa:q1']);
  });

  it('matches on TRIMMED text, so trailing whitespace is not a phantom gap', () => {
    expect(backfillFromTranscript([qa('q1')], [
      { role: 'user', text: '  q1\n' },
      { role: 'assistant', text: 'a' },
    ], opts)).toBeNull();
  });

  it('NEVER touches an existing item — run and gate history survives byte-identical', () => {
    // This is the difference between backfill and rebuild: `chat.jsonl` knows nothing about run/gate,
    // so a rebuild would erase the phase timeline to restore the conversation.
    const timeline = [user('req'), run('analyze output'), qa('q1'), run('implement output')];
    const out = backfillFromTranscript(timeline, chatOf('q1', 'q2'), opts)!;
    expect(out.slice(0, 4)).toEqual(timeline); // same references, same order
    expect(out.slice(0, 4).every((it, i) => it === timeline[i])).toBe(true);
  });

  it('an EMPTY thread (LRU just evicted it) restores everything, without duplicating', () => {
    const out = backfillFromTranscript([], chatOf('q1', 'q2'), opts)!;
    expect(texts(out)).toEqual(['user:q1', 'qa:q1', 'user:q2', 'qa:q2']);
  });

  it('carries cost and sessionReset when the transcript has them, and omits them when it does not', () => {
    const chat: TranscriptLine[] = [
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1', cost: { inputTokens: 7 } as never, sessionReset: true },
      { role: 'user', text: 'q2' },
      { role: 'assistant', text: 'a2' },
    ];
    const out = backfillFromTranscript([], chat, opts)!;
    const first = out[1] as LiveThreadItem & { kind: 'qa' };
    const second = out[3] as LiveThreadItem & { kind: 'qa' };
    expect(first.cost).toEqual({ inputTokens: 7 });
    expect(first.sessionReset).toBe(true);
    expect(second.cost).toBeUndefined();
    expect('sessionReset' in second).toBe(false); // absent, not `false` — the shape stays clean
  });

  it('an ok:false answer keeps its text verbatim and gains no `ok` field', () => {
    // `recordAsk` writes what the READER SAW, ⚠ notice included, so a restored failure can never read
    // as more finished than the live one did — and `LiveThreadItem` has nowhere to put `ok` anyway.
    const out = backfillFromTranscript([], [
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'partial…\n⚠ the answer was cut off' },
    ], opts)!;
    const item = out[1] as LiveThreadItem & { kind: 'qa' };
    expect(item.answer).toBe('partial…\n⚠ the answer was cut off');
    expect('ok' in item).toBe(false);
  });
});

describe('backfillFromTranscript — the marker only appears when something is genuinely unclear', () => {
  it('a clean TAIL restore says nothing: correct order needs no explanation', () => {
    const out = backfillFromTranscript([qa('q1')], chatOf('q1', 'q2', 'q3'), opts)!;
    expect(out.some((i) => i.kind === 'run')).toBe(false);
  });

  it('a HOLE in the middle DOES say so — the rendered order is no longer the real one', () => {
    // The thread kept q1 and q3 but lost q2. Appending q2 at the end puts it after q3, which is a lie
    // unless stated: thread items carry no timestamp, so there is no honest place to insert it.
    const out = backfillFromTranscript([qa('q1'), qa('q3')], chatOf('q1', 'q2', 'q3'), opts)!;
    const note = out.find((i) => i.kind === 'run') as LiveThreadItem & { kind: 'run' };
    expect(note).toBeDefined();
    expect(note.output).toMatch(/1 exchange\(s\) below were restored/);
    expect(note.output).toMatch(/may not be exact/);
    expect(note.phase).toBe('test'); // stamped with the phase under view
  });

  it('the marker asks to be rendered EXPANDED — a notice nobody opens has disclosed nothing', () => {
    // Found in a real browser, not in a unit test: collapsed, this item renders as a button labelled
    // "④ Test", identical to a phase's output, and its text is not in the document at all until clicked.
    const out = backfillFromTranscript([qa('q1'), qa('q3')], chatOf('q1', 'q2', 'q3'), opts)!;
    const note = out.find((i) => i.kind === 'run') as LiveThreadItem & { kind: 'run' };
    expect(note.open).toBe(true);
  });

  it('REGRESSION: a real phase run leaves `open` unset, so ordinary output keeps collapsing', () => {
    // The flag exists for notices only. If it leaked onto phase runs, every reopened build would unfurl
    // every phase log at once.
    const timeline = [run('analyze output'), qa('q1')];
    const out = backfillFromTranscript(timeline, chatOf('q1', 'q2'), opts)!;
    const phaseRun = out.find((i) => i.kind === 'run' && i.output === 'analyze output') as LiveThreadItem & { kind: 'run' };
    expect(phaseRun.open).toBeUndefined();
  });

  it('a server-side cut ALWAYS says so, even on a clean tail, and states how many are unshown', () => {
    const out = backfillFromTranscript([], chatOf('q1'), { ...opts, dropped: 3 })!;
    const note = out.find((i) => i.kind === 'run') as LiveThreadItem & { kind: 'run' };
    expect(note.output).toMatch(/3 older exchange\(s\) are not shown/);
    expect(note.output).toMatch(/exported bundle/); // where the rest can still be read
  });

  it('the marker sits BEFORE the restored block, never inside or after it', () => {
    const out = backfillFromTranscript([qa('q1'), qa('q3')], chatOf('q1', 'q2', 'q3'), opts)!;
    const markerAt = out.findIndex((i) => i.kind === 'run');
    const firstRestored = out.findIndex((i) => i.kind === 'user' && i.text === 'q2');
    expect(markerAt).toBeGreaterThan(-1);
    expect(markerAt).toBeLessThan(firstRestored);
  });
});
