/**
 * Spec 019 C4 — the SSE `init` frame must take a FRESH, strictly-newer event id instead of re-reading
 * the last-broadcast `eventCounter`. A reconnecting client adopts the most recent frame's id as its
 * `Last-Event-ID`; if `init` reuses the id of an already-replayed event, the next reconnect replays off
 * by one (the exact id the AC #22 Last-Event-ID path leans on). These pin the allocator + the helper the
 * plugin delegates to (the plugin hijacks the socket, so the id decision is unit-tested here directly).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSSEState, initEvent } from '../server/plugins/sse.js';

const bufferedIds = (sse: ReturnType<typeof createSSEState>): number[] =>
  sse.eventBuffer.filter(() => true).map((e) => e.id);

describe('SSE init event id (019 C4)', () => {
  test('init id is strictly GREATER than every replayable (buffered) event id', () => {
    const sse = createSSEState();
    sse.broadcast('t1', 'task:update', { a: 1 }); // id 1, buffered
    sse.broadcast('t1', 'task:update', { a: 2 }); // id 2, buffered
    const lastBuffered = Math.max(...bufferedIds(sse)); // 2

    const ie = initEvent(sse, true);
    assert.equal(ie.event, 'init');
    assert.ok(ie.id > lastBuffered, `init id ${ie.id} must exceed last buffered id ${lastBuffered}`);

    // The next real broadcast stays strictly monotonic after init consumed an id (no collision).
    sse.broadcast('t1', 'task:update', { a: 3 });
    assert.ok(Math.max(...bufferedIds(sse)) > ie.id, 'a later broadcast id stays > the init id');
  });

  test('init is transient — it is NOT pushed into the replay buffer', () => {
    const sse = createSSEState();
    sse.broadcast('t', 'task:update', {});
    const before = bufferedIds(sse).length;
    initEvent(sse, false);
    assert.equal(bufferedIds(sse).length, before, 'initEvent must not buffer (only allocate an id)');
  });

  test('nextEventId() advances the same counter broadcast() uses', () => {
    const sse = createSSEState();
    sse.broadcast('t', 'task:update', {}); // eventCounter → 1
    assert.equal(sse.nextEventId(), 2);
    assert.equal(sse.eventCounter, 2);
    sse.broadcast('t', 'task:update', {}); // eventCounter → 3
    assert.equal(sse.eventCounter, 3);
  });
});
