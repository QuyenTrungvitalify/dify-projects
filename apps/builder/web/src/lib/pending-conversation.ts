// pending-conversation.ts — is there a conversation on this workflow that is still waiting for you?
//
// Spec 105 M4. Starting a new conversation on a workflow that already has one is normal and usually
// right — it is what 「新しい会話で編集」 is FOR. But one case is not: a build parked at a gate is
// literally waiting for an answer, and walking away from it leaves two conversations writing the same
// `main.yml` and `SPEC.md`. That hazard is already documented one layer down — `POST /undo-fix` compares
// hashes and 409s precisely because "another build's round, or a human Save on the spec panel" can move
// those files underneath a task that thought it owned them.
//
// So the question is narrow, and the narrowness is the design:
//
//   done / cancelled → nothing is waiting. SILENT. This is the common path (finish a build, click the
//                      pencil, start the next round) and a prompt here would be the prompt everyone
//                      learns to dismiss without reading.
//   running          → already refused upstream: `POST /api/tasks` 409s while a turn holds the lock,
//                      so this cannot be reached by starting a build.
//   awaiting_confirm → parked at a gate with the question still open.        ASK.
//   error            → parked too, and its Retry is one click away.          ASK.
//
// Pure so the rule has a unit-test home and cannot drift into a component's render conditions — the
// same reason `terminalFootActions` and `canPropose` live outside their callers.
import type { WireTreeProject, WireTreeTask } from '../types';

/** Mirrors the server's `DRAFTS_PROJECT`, as `crumb.ts` does and for the same reason: the FE has to be
 *  able to predict where a bare slug will land without reaching into `server/`. */
const DRAFTS_PROJECT = '_drafts';

/** A build is "still waiting" when a human, not the machine, holds the next move. */
export function isWaiting(t: Pick<WireTreeTask, 'status'>): boolean {
  return t.status === 'awaiting_confirm' || t.status === 'error';
}

/**
 * The conversation a new build on `slug` would walk away from, or null when there is none to warn about.
 *
 * `targetProject` resolves a BARE slug the way `store.start()` resolves it (compound `project/workflow`
 * carries its own project). Getting that wrong would point the lookup at a different folder's builds —
 * the same mistake `armedStartsAtImplement` shipped and had to fix, so it is written the same way here.
 *
 * Returns the NEWEST waiting build: tree rows arrive newest-first (`byTaskIdDesc` in `artifacts.ts`), so
 * the first match is the one a human would recognise as "the one I was in".
 */
export function pendingConversation(
  tree: WireTreeProject[],
  slug: string | null | undefined,
  targetProject?: string | null
): WireTreeTask | null {
  if (!slug || slug === 'none') return null;
  const slash = slug.indexOf('/');
  const project = slash !== -1 ? slug.slice(0, slash) : targetProject || DRAFTS_PROJECT;
  const wf = slash !== -1 ? slug.slice(slash + 1) : slug;
  const row = tree.find((p) => p.id === project)?.workflows.find((w) => w.id === wf);
  return row?.tasks.find(isWaiting) ?? null;
}
