// composer-route.ts — where a typed message GOES: a new build, a revision, or a question.
//
// Extracted pure out of App.tsx's `send()` for the same reason gate-foot.ts was: the decision had no
// unit-test home, and it degrades SILENTLY when wrong — a message meant as a fix that lands on /ask comes
// back as a polite explanation while the workflow is untouched, and nothing in the UI says so. That is
// exactly how the post-import fix loop first failed in the field (a send whose /reply 409'd disarmed
// change-mode, so the user's retry became a question).
//
// The rule, in one place:
//   no task            → 'start'   a brand-new build/chat from the empty surface
//   promote build      → 'reply'   no Ask surface; typed text is always a Request-changes (spec 052)
//   done + change-mode → 'reply'   the post-import fix loop — reopens the build, resumes ③
//   done | cancelled   → 'ask'     terminal default: a question about a finished/abandoned build
//   error              → 'reply'   the Retry path (§I)
//   change-mode        → 'reply'   an armed Request-changes at a parked gate
//   otherwise          → 'ask'     the default at every gate (spec 033/034)
import type { WireStatus, WireTask } from '../types';

export type ComposerTarget = 'start' | 'reply' | 'ask';
export type ComposerMode = 'ask' | 'change';

export function composerTarget(
  task: Pick<WireTask, 'status' | 'kind'> | null | undefined,
  mode: ComposerMode
): ComposerTarget {
  if (!task) return 'start';
  if (task.kind === 'promote') return 'reply';
  if (task.status === 'done' || task.status === 'cancelled') {
    // Change-mode is reachable at `done` ONLY (armed by the gate foot's Request-a-fix); a cancelled build
    // re-enters through Restore, so its composer stays a question box.
    return task.status === 'done' && mode === 'change' ? 'reply' : 'ask';
  }
  if (task.status === 'error') return 'reply'; // Retry-out-of-error, with or without steering text
  return mode === 'change' ? 'reply' : 'ask';
}

/**
 * The `label` a 'reply' send carries — the English action name the resolved gate card shows (spec 016 D4).
 * `undefined` falls back to the store's generic 'Requested changes'. A promote reply is always the pinned
 * 'Request changes'; a text-steered Retry out of error has no armed action unless the user chose one.
 */
export function replyLabel(
  status: WireStatus,
  kind: WireTask['kind'],
  mode: ComposerMode,
  changeLabel: string
): string | undefined {
  if (kind === 'promote') return 'Request changes';
  if (status === 'error' && mode !== 'change') return undefined;
  return changeLabel;
}
