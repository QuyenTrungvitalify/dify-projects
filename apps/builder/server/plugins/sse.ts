/**
 * sse.ts — the SSE transport for spec 009 Lát 4 (ADAPTED from claude-nexus
 * `src/server/plugins/sse.ts`).
 *
 * KEPT (transport core, vendored verbatim in spirit):
 *   - `reply.hijack()` + `writeHead(200, {text/event-stream, no-cache, keep-alive, X-Accel-Buffering:no})`
 *   - per-client backpressure queue (`flushQueue`, `MAX_QUEUE_SIZE`, the `flushing` re-entry guard)
 *   - heartbeat `setInterval` (`: heartbeat\n\n`)
 *   - idempotent `cleanup()` on close/error
 *   - the `RingBuffer` + Last-Event-ID batch replay (`eventBuffer.filter(e => e.id > lastEventId)`)
 *     — this is what AC #22 leans on.
 *
 * STRIPPED (nexus wiring that does not apply to this single-user localhost app):
 *   - `opts.container` DI (`authToken`, `taskManager`, `evaluator`), `extractAuthToken` + the
 *     401 token gate — there is no token here.
 *   - the heavyweight `init` payload (`taskManager.list()` / pending permissions / restart status) —
 *     replaced with a MINIMAL `{ reconnected }` (the store re-fetches `GET /api/tasks/:id` after init,
 *     AC #22), and `onClientClose`/visibility correlation.
 *
 * CHANGED for this app: broadcasts are **task-scoped**. `broadcast(taskId, event, data)` fans out
 * only to clients subscribed to that task's `GET /api/tasks/:id/stream`, and the replay buffer is
 * filtered by taskId too. The high-volume `phase:output` event is excluded from the replay buffer
 * (mirrors nexus excluding `task:output`); the lightweight `task:update` events are buffered.
 */
import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { isOriginAllowed } from './sse-origin-check.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_QUEUE_SIZE = parseInt(process.env.SSE_CLIENT_QUEUE_SIZE || '200', 10);
const SSE_EVENT_BUFFER_SIZE = parseInt(process.env.SSE_EVENT_BUFFER_SIZE || '1000', 10);
const SSE_MAX_CLIENTS = parseInt(process.env.SSE_MAX_CLIENTS || '50', 10);

export interface SSEClient {
  res: ServerResponse;
  taskId: string;
  queue: Array<{ id: number; event: string; data: unknown }>;
  flushing: boolean;
  dropped: number;
}

type BufferEntry = { id: number; taskId: string; event: string; data: unknown; ts: number };

/** Fixed-capacity ring buffer (O(1) push/evict) for Last-Event-ID replay — copied from nexus. */
export class RingBuffer {
  private buf: (BufferEntry | undefined)[];
  private head = 0;
  private count = 0;
  constructor(private capacity: number) {
    this.buf = new Array(capacity);
  }
  get length(): number {
    return this.count;
  }
  push(entry: BufferEntry): void {
    this.buf[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  filter(fn: (entry: BufferEntry) => boolean): BufferEntry[] {
    const result: BufferEntry[] = [];
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const entry = this.buf[(start + i) % this.capacity]!;
      if (fn(entry)) result.push(entry);
    }
    return result;
  }
}

export interface SSEState {
  clients: Set<SSEClient>;
  eventCounter: number;
  eventBuffer: RingBuffer;
  /** Fan out an event to every client subscribed to `taskId`; buffer lightweight events for replay. */
  broadcast: (taskId: string, event: string, data: unknown) => void;
  /** Allocate the next monotonic event id WITHOUT broadcasting/buffering — for a transient out-of-band
   *  event (the `init` frame) that must still be strictly newer than every replayable event (C4). */
  nextEventId: () => number;
}

export function createSSEState(): SSEState {
  const clients = new Set<SSEClient>();
  const eventBuffer = new RingBuffer(SSE_EVENT_BUFFER_SIZE);
  let eventCounter = 0;

  function broadcast(taskId: string, event: string, data: unknown): void {
    eventCounter++;
    const id = eventCounter;
    // Exclude the high-volume streamed-output events from the replay buffer (nexus excludes
    // `task:output`); spec 033: `ask:answer` is the same high-volume shape as `phase:output`, so it gets
    // the identical exclusion. Keep the lightweight phase/status/gate `task:update` + the terminal
    // `ask:done` marker replayable.
    if (event !== 'phase:output' && event !== 'ask:answer') {
      eventBuffer.push({ id, taskId, event, data, ts: Date.now() });
    }
    for (const client of clients) {
      if (client.taskId === taskId) writeToClient(client, id, event, data);
    }
  }

  return {
    clients,
    get eventCounter() {
      return eventCounter;
    },
    set eventCounter(v: number) {
      eventCounter = v;
    },
    eventBuffer,
    broadcast,
    nextEventId() {
      return ++eventCounter;
    },
  };
}

/**
 * The id + payload of the `init` frame a (re)connecting client receives. C4 (spec 019): it takes a
 * FRESH id from the counter rather than re-reading `eventCounter` (the last *broadcast* id), so `init`
 * is strictly newer than every replayable buffered event. Reusing the last id made `init` tie an
 * already-issued event id; a client adopting that as its `Last-Event-ID` then under/over-replays by one
 * on the next reconnect — the exact off-by-one AC #22 leans on. `init` is never buffered, so spending an
 * id is free.
 */
export function initEvent(sse: SSEState, reconnected: boolean): { id: number; event: 'init'; data: { reconnected: boolean } } {
  return { id: sse.nextEventId(), event: 'init', data: { reconnected } };
}

/** Enqueue an event for a client (drops past MAX_QUEUE_SIZE) and kick the drain. */
function writeToClient(client: SSEClient, id: number, event: string, data: unknown): void {
  if (client.queue.length >= MAX_QUEUE_SIZE) {
    client.dropped++;
    return;
  }
  client.queue.push({ id, event, data });
  flushQueue(client);
}

/**
 * Drain the queue into the socket, honoring `res.write()` backpressure: a `false` return schedules a
 * one-shot `drain` listener and pauses. The `flushing` flag prevents re-entry while a push() arrives
 * mid-drain. Copied from nexus.
 */
function flushQueue(client: SSEClient): void {
  if (client.flushing || client.queue.length === 0) return;
  client.flushing = true;
  while (client.queue.length > 0) {
    const item = client.queue.shift()!;
    const payload = `id: ${item.id}\nevent: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`;
    let ok: boolean;
    try {
      ok = client.res.write(payload);
    } catch {
      client.flushing = false;
      return;
    }
    if (!ok) {
      client.res.once('drain', () => {
        client.flushing = false;
        flushQueue(client);
      });
      return;
    }
  }
  client.flushing = false;
}

export interface SSEPluginOptions {
  sse: SSEState;
  /** Builder bind port — the Origin allowlist is keyed off it (spec §J). */
  port: number;
}

/**
 * Register `GET /api/tasks/:id/stream` (spec Endpoints). Hijacks the reply, registers the client
 * under its taskId, replays any missed buffered events (Last-Event-ID), then emits the minimal
 * `init` event so the store can re-fetch authoritative state (AC #22).
 */
const ssePlugin = async (app: FastifyInstance, opts: SSEPluginOptions): Promise<void> => {
  const { sse, port } = opts;

  app.get<{ Params: { id: string } }>('/api/tasks/:id/stream', async (request, reply) => {
    // Origin allowlist (spec §J) — fires before hijack so Fastify still owns the response.
    if (!isOriginAllowed(request.headers.origin, port)) {
      return reply.code(403).send({ error: 'origin not allowed' });
    }
    if (sse.clients.size >= SSE_MAX_CLIENTS) {
      return reply.code(503).header('Retry-After', '5').send({ error: 'SSE capacity reached' });
    }

    const taskId = request.params.id;
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let alive = true;
    let heartbeatTimer: ReturnType<typeof setInterval>;

    const client: SSEClient = { res: raw, taskId, queue: [], flushing: false, dropped: 0 };

    function cleanup(): void {
      if (!alive) return; // idempotent
      alive = false;
      clearInterval(heartbeatTimer);
      sse.clients.delete(client);
      if (client.dropped > 0) {
        app.log.warn({ taskId, dropped: client.dropped }, '[SSE] slow client dropped events');
      }
    }

    sse.clients.add(client);

    heartbeatTimer = setInterval(() => {
      if (!alive) return;
      try {
        raw.write(`: heartbeat\n\n`);
      } catch {
        cleanup();
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Last-Event-ID replay (reconnection): batch-write the events this task missed.
    const lastEventId = parseInt((request.headers['last-event-id'] as string) || '0', 10);
    const reconnected = lastEventId > 0;
    if (reconnected) {
      const missed = sse.eventBuffer.filter((e) => e.taskId === taskId && e.id > lastEventId);
      if (missed.length > 0) {
        try {
          raw.write(
            missed
              .map((e) => `id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
              .join('')
          );
        } catch {
          cleanup();
        }
      }
    }

    // Minimal init — the store re-fetches GET /api/tasks/:id to restore the gate (AC #22). C4: a FRESH
    // id (strictly newer than any replayed event), not the stale last-broadcast counter.
    const ie = initEvent(sse, reconnected);
    writeToClient(client, ie.id, ie.event, ie.data);

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
};

export default ssePlugin;
