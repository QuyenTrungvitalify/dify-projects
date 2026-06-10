/* ============================================================
   sse-client.ts — COPIED + PRUNED from claude-nexus
   `src/client/sse-client.ts` (spec 009 Lát 4 task 3).

   KEPT verbatim (the load-bearing transport): EventSource connect,
   onopen reset-delay, onerror exponential backoff WITH JITTER
   (delay * (0.7 + Math.random()*0.6)), the `waitingForInit`
   stale-suppression guard, the returned teardown closure.

   PRUNED: the ~21 nexus-only listeners (restart:* / pipeline:* /
   permission:* / dev:build:* / git:status-changed / task:handoff /
   workflow:progress / session:sync-status), withCredentials/cookie
   auth, clientId. This app streams ONE task at a time over
   `/api/tasks/:id/stream` with three events: init · task:update ·
   phase:output. On reconnect the store re-fetches GET /api/tasks/:id
   (AC #22) — wired via onReconnect in the store, not here.
   ============================================================ */
import type { WireTask } from './types';

export interface SSEHandlers {
  /** Minimal server init ({reconnected}). The store re-fetches GET /api/tasks/:id from here. */
  onInit: (data: { reconnected: boolean }) => void;
  /** Full task state on every phase/status/gate transition. */
  onTaskUpdate: (task: WireTask) => void;
  /** A streamed assistant fragment for the current phase. */
  onPhaseOutput: (data: { phase: string; text: string }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/** Open the SSE stream for one task; returns a teardown closure. */
export function connectSSE(taskId: string, handlers: SSEHandlers): () => void {
  let eventSource: EventSource | null = null;
  let reconnectDelay = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  // Suppress stale buffered task:update events replayed BEFORE init on reconnect — init triggers
  // the authoritative GET re-fetch, so a buffered `running` can't clobber the real gate (AC #22).
  let waitingForInit = true;

  function connect(): void {
    if (closed) return;
    if (eventSource) eventSource.close();
    waitingForInit = true;
    eventSource = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/stream`);

    eventSource.onopen = () => {
      reconnectDelay = 1000;
      handlers.onConnect?.();
    };

    eventSource.onerror = () => {
      handlers.onDisconnect?.();
      eventSource?.close();
      eventSource = null;
      if (closed) return;
      const jitter = reconnectDelay * (0.7 + Math.random() * 0.6);
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        connect();
      }, jitter);
    };

    eventSource.addEventListener('init', (e: MessageEvent) => {
      waitingForInit = false;
      handlers.onInit(JSON.parse(e.data));
    });

    eventSource.addEventListener('task:update', (e: MessageEvent) => {
      if (waitingForInit) return; // skip stale replay before init (ground truth)
      handlers.onTaskUpdate(JSON.parse(e.data));
    });

    eventSource.addEventListener('phase:output', (e: MessageEvent) => {
      handlers.onPhaseOutput(JSON.parse(e.data));
    });
  }

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}
