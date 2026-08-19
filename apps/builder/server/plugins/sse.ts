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
import { taskTurnRunning } from '../lib/lock.js';
import { logEvent } from '../lib/run-events.js';
import { taskDir, isTaskId } from '../state/task.js';

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
 *
 * `turnRunning` tells the connecting client whether a turn (phase OR ask) currently holds this task. The
 * client cannot infer it: an Ask leaves `status` untouched, so a `done` build streaming an answer and a
 * `done` build whose answer died look identical over `GET /api/tasks/:id`. It is what lets a reopened tab
 * settle a leftover open Q&A instead of rendering "Answering…" forever — while NOT settling one whose
 * answer is still arriving on this very stream.
 */
export function initEvent(
  sse: SSEState,
  reconnected: boolean,
  turnRunning: boolean
): { id: number; event: 'init'; data: { reconnected: boolean; turnRunning: boolean } } {
  return { id: sse.nextEventId(), event: 'init', data: { reconnected, turnRunning } };
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
  /** Spec 099 S0 — where `.runs/<taskId>/events.jsonl` lives, so a connect/disconnect can be recorded
   *  somewhere the export bundle can carry off the machine. Optional: omitted ⇒ no timeline write, and
   *  the transport behaves exactly as before (the existing tests construct the plugin without it). */
  projectsDir?: string;
}

/** How many streams are live for THIS task — the number the multi-tab question actually asks. */
export function clientsForTask(sse: SSEState, taskId: string): number {
  let n = 0;
  for (const c of sse.clients) if (c.taskId === taskId) n++;
  return n;
}

/**
 * Register `GET /api/tasks/:id/stream` (spec Endpoints). Hijacks the reply, registers the client
 * under its taskId, replays any missed buffered events (Last-Event-ID), then emits the minimal
 * `init` event so the store can re-fetch authoritative state (AC #22).
 */
const ssePlugin = async (app: FastifyInstance, opts: SSEPluginOptions): Promise<void> => {
  const { sse, port, projectsDir } = opts;
  /** Spec 099 S0 — best-effort, fire-and-forget: `logEvent` swallows its own IO errors, and a stream
   *  must never fail because a timeline write did. Called from a sync socket handler, hence `void`. */
  const note = (taskId: string, kind: 'stream_open' | 'stream_close'): void => {
    if (!projectsDir) return;
    // CONFINEMENT. This route never validated `:id` because it never needed to — the id was only a Set
    // key and a broadcast filter, so a junk value was inert. Writing the timeline changes that: it turns
    // the id into a filesystem path via `taskDir` → `join`, and `join` happily normalises `../` right out
    // of `.runs/`. So the guard belongs to the WRITE, and it arrived with it.
    //
    // MEASURED, not assumed: with this line removed, `GET /api/tasks/..%2F..%2F..%2FESCAPED/stream`
    // really does append to `<projectsDir>/ESCAPED/events.jsonl` — Fastify decodes `%2F` into a path
    // separator inside the param. And the SSE GET is deliberately lenient about a missing Origin (a
    // same-origin EventSource may omit it), so a plain `<img src=…>` on any page reaches it. Low impact
    // — the attacker controls the path, not the content, which is one JSON line — but it is a
    // cross-origin write primitive that did not exist before the timeline write did.
    if (!isTaskId(taskId)) return;
    void logEvent(taskDir(projectsDir, taskId), { kind, detail: `clients=${clientsForTask(sse, taskId)}` });
  };

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
      if (!alive) return; // idempotent — BOTH 'close' and 'error' fire on a destroyed socket, and the
      //                     guard above is what keeps that one disconnect from being logged twice.
      alive = false;
      clearInterval(heartbeatTimer);
      sse.clients.delete(client);
      if (client.dropped > 0) {
        app.log.warn({ taskId, dropped: client.dropped }, '[SSE] slow client dropped events');
      }
      // Spec 099 S0. AFTER the delete, so the count is who REMAINS — `clients=1` on a close means one
      // other tab is still watching this build, which is the answer the 099 investigation could not get.
      app.log.info({ taskId, clients: clientsForTask(sse, taskId) }, '[SSE] client closed');
      note(taskId, 'stream_close');
    }

    sse.clients.add(client);
    // AFTER the add, so the count INCLUDES this one: `clients=2` on an open is the multi-tab moment.
    app.log.info({ taskId, clients: clientsForTask(sse, taskId) }, '[SSE] client connected');
    note(taskId, 'stream_open');

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
    const ie = initEvent(sse, reconnected, taskTurnRunning(taskId));
    writeToClient(client, ie.id, ie.event, ie.data);

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
};

export default ssePlugin;
