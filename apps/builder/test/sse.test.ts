/**
 * Spec 099 S0 / 101 §2.5 — record SSE connect + disconnect where the evidence can leave the machine.
 *
 * WHY THIS SLICE EXISTS. The 099 investigation stalled on one question: how many tabs were open on that
 * build at once? Two tabs is a real data-loss scenario (099 S1b — the passive tab used to overwrite the
 * active one's thread). `.runs/dev-restart.log` recorded every request but NEVER a disconnect, so every
 * stream appeared to end only when the process died, and any "N streams were live" count read off it was
 * fiction. Worse, that log is process-global, mixes tasks, and is not redacted — so it can never ride the
 * export bundle. On a tester's machine it is unreachable. `events.jsonl` already ships in the bundle.
 *
 * These tests use a REAL listening server: the route calls `reply.hijack()`, which `app.inject()` does
 * not model — a hijacked reply never completes an injected request, so an inject-based test would hang
 * or assert on a fiction. A real socket is also the only way to produce a real disconnect, which is the
 * event under test.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get, type IncomingMessage, type ClientRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import ssePlugin, { createSSEState, clientsForTask } from '../server/plugins/sse.js';

const TASK = '1786505684286';

/** Read the timeline back, newest last. Absent file ⇒ [] (the write is best-effort by contract). */
async function events(dir: string): Promise<Array<{ kind: string; detail?: string }>> {
  try {
    const raw = await readFile(join(dir, `apps/builder/.runs/${TASK}/events.jsonl`), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Open a stream and resolve once the server has actually accepted it (first byte of the init frame). */
function openStream(port: number, track?: ClientRequest[]): Promise<{ req: ClientRequest; res: IncomingMessage }> {
  return new Promise((resolve) => {
    const req = get({ host: '127.0.0.1', port, path: `/api/tasks/${TASK}/stream` }, (res) => {
      res.once('data', () => resolve({ req, res }));
      res.resume();
    });
    track?.push(req); // so the teardown can force it shut even if an assertion throws first
    req.on('error', () => {}); // a destroyed socket is the SUBJECT here, never a test failure
  });
}

/** Poll until `pred` holds or the budget runs out — the timeline write is fire-and-forget. */
async function until<T>(read: () => Promise<T>, pred: (v: T) => boolean, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (pred(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('SSE connect/disconnect lands on the run timeline (spec 099 S0)', () => {
  let dir: string;
  let app: FastifyInstance;
  let port: number;
  /** Every stream this test opened. See the teardown — this list is load-bearing, not bookkeeping. */
  let opened: ClientRequest[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sse-'));
    await mkdir(join(dir, `apps/builder/.runs/${TASK}`), { recursive: true });
    opened = [];
    app = Fastify();
    await app.register(ssePlugin, { sse: createSSEState(), port: 4123, projectsDir: dir });
    await app.listen({ host: '127.0.0.1', port: 0 });
    port = (app.server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    // Destroy every stream BEFORE closing the app. `reply.hijack()` hands the socket to us, so Fastify's
    // close waits on it forever — and a test whose assertion throws before its own cleanup would leave
    // one open. Learned the hard way: an early failure turned the whole file into a hang with no output,
    // which in CI is a timeout with no signal — strictly worse than a red test.
    for (const r of opened) r.destroy();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('a CLIENT disconnect is recorded — the event dev-restart.log could never see', async () => {
    const { req } = await openStream(port, opened);
    const seen = await until(() => events(dir), (e) => e.some((x) => x.kind === 'stream_open'));
    assert.deepEqual(
      seen.map((e) => e.kind), ['stream_open'],
      'the open is recorded, and nothing else is yet',
    );
    assert.equal(seen[0].detail, 'clients=1', 'the count INCLUDES the stream that just opened');

    req.destroy(); // the client goes away — a closed tab, exactly the case under investigation

    const after = await until(() => events(dir), (e) => e.some((x) => x.kind === 'stream_close'));
    assert.deepEqual(after.map((e) => e.kind), ['stream_open', 'stream_close']);
    assert.equal(after[1].detail, 'clients=0', 'the close count is who REMAINS, not who left');
  });

  test('TWO tabs on one build are visible as clients=2 — the question 099 could not answer', async () => {
    const a = await openStream(port, opened);
    await until(() => events(dir), (e) => e.length >= 1);
    const b = await openStream(port, opened);
    const both = await until(() => events(dir), (e) => e.filter((x) => x.kind === 'stream_open').length === 2);

    assert.deepEqual(
      both.filter((e) => e.kind === 'stream_open').map((e) => e.detail),
      ['clients=1', 'clients=2'],
      'THE POINT: the second tab is legible in the export, no console access required',
    );

    b.req.destroy();
    const afterB = await until(() => events(dir), (e) => e.some((x) => x.kind === 'stream_close'));
    assert.equal(
      afterB.find((e) => e.kind === 'stream_close')!.detail, 'clients=1',
      'one tab left, one still watching — that is the state the clobber happens in',
    );
    a.req.destroy();
  });

  test('IDEMPOTENT: a destroyed socket may fire both close and error — still exactly ONE line', async () => {
    const { req } = await openStream(port, opened);
    await until(() => events(dir), (e) => e.length >= 1);
    req.destroy(new Error('boom')); // provokes 'error' alongside 'close'

    const after = await until(() => events(dir), (e) => e.some((x) => x.kind === 'stream_close'));
    await new Promise((r) => setTimeout(r, 120)); // give a would-be second write time to land
    const settled = await events(dir);
    assert.equal(
      settled.filter((e) => e.kind === 'stream_close').length, 1,
      'one disconnect must be one line — a double count would inflate every concurrency reading',
    );
    assert.ok(after.length >= 2);
  });

  test('no projectsDir → the transport is byte-unchanged (nothing written, nothing thrown)', async () => {
    const bare = Fastify();
    await bare.register(ssePlugin, { sse: createSSEState(), port: 4123 }); // as the pre-099 tests build it
    await bare.listen({ host: '127.0.0.1', port: 0 });
    const p = (bare.server.address() as AddressInfo).port;
    try {
      const { req } = await openStream(p, opened);
      req.destroy();
      await new Promise((r) => setTimeout(r, 120));
      assert.deepEqual(await events(dir), [], 'an unconfigured plugin writes no timeline at all');
    } finally {
      await bare.close();
    }
  });
});

describe('CONFINEMENT: a junk task id never becomes a filesystem path (spec 101 review)', () => {
  // This route deliberately never validated `:id`, and that was FINE while the id was only a Set key and
  // a broadcast filter — junk in, junk inert. Recording the timeline (2.5) changed the id into an
  // argument to `taskDir` → `join`, and `join` normalises `../` straight out of `.runs/`. The guard is
  // part of the write, not part of the transport: an unrecognised id still gets a working stream, it
  // just leaves no trace on disk.
  let dir: string;
  let app: FastifyInstance;
  let port: number;
  let opened: ClientRequest[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sse-confine-'));
    // Pre-create BOTH targets, and this is the point of the whole describe: `logEvent` uses `appendFile`,
    // which fails on a missing parent — so a traversal test against a non-existent directory passes
    // whether the guard exists or not. Decorative. Creating the escape target means the ONLY thing that
    // can stop the write is the guard, which is what makes these red when it is removed.
    await mkdir(join(dir, 'ESCAPED'), { recursive: true });          // where `../../../ESCAPED` lands
    await mkdir(join(dir, `apps/builder/.runs/${TASK}`), { recursive: true }); // the legitimate target
    opened = [];
    app = Fastify();
    await app.register(ssePlugin, { sse: createSSEState(), port: 4123, projectsDir: dir });
    await app.listen({ host: '127.0.0.1', port: 0 });
    port = (app.server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    for (const r of opened) r.destroy();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  /** Same as openStream but for an arbitrary (hostile) id. */
  function openId(id: string): Promise<ClientRequest> {
    return new Promise((resolve) => {
      const req = get({ host: '127.0.0.1', port, path: `/api/tasks/${id}/stream` }, (res) => {
        res.once('data', () => resolve(req));
        res.resume();
      });
      opened.push(req);
      req.on('error', () => resolve(req));
      setTimeout(() => resolve(req), 1500);
    });
  }

  for (const [label, id] of [
    ['encoded traversal', '..%2F..%2F..%2FESCAPED'],
    ['double-encoded', '..%252F..%252FESCAPED'],
    ['dot segments', '...'],
    ['not a timestamp', 'abc'],
    ['empty-ish', '%20'],
  ] as const) {
    test(`${label} (${id}) → stream still works, NOTHING is written anywhere under projectsDir`, async () => {
      const req = await openId(id);
      req.destroy();
      await new Promise((r) => setTimeout(r, 150));

      // Walk the whole temp root: any events.jsonl at all means the id reached the filesystem.
      const found: string[] = [];
      const walk = async (p: string): Promise<void> => {
        for (const e of await readdir(p, { withFileTypes: true })) {
          const full = join(p, e.name);
          if (e.isDirectory()) await walk(full);
          else if (e.name === 'events.jsonl') found.push(full);
        }
      };
      await walk(dir);
      assert.deepEqual(found, [], `a junk id wrote a timeline at ${found[0] ?? '(none)'}`);
    });
  }

  test('a REAL id still writes — the guard rejects junk, not everything', async () => {
    const req = await openId(TASK);
    req.destroy();
    const seen = await until(() => events(dir), (e) => e.length >= 2);
    assert.deepEqual(seen.map((e) => e.kind), ['stream_open', 'stream_close']);
  });
});

describe('clientsForTask — counts THIS build, not the whole server', () => {
  test('a stream on another task is not part of this build’s tab count', () => {
    const sse = createSSEState();
    const mk = (taskId: string) => ({ res: {} as never, taskId, queue: [], flushing: false, dropped: 0 });
    sse.clients.add(mk('A'));
    sse.clients.add(mk('A'));
    sse.clients.add(mk('B'));
    assert.equal(clientsForTask(sse, 'A'), 2);
    assert.equal(clientsForTask(sse, 'B'), 1);
    assert.equal(clientsForTask(sse, 'C'), 0, 'a build nobody is watching reads zero, not the total');
  });
});
