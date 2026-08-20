// composer-route.ts — where a typed message GOES: a new build, a revision, or a question.
//
// Extracted pure out of App.tsx's `send()` for the same reason gate-foot.ts was: the decision had no
// unit-test home, and it degrades SILENTLY when wrong — a message meant as a fix that lands on /ask comes
// back as a polite explanation while the workflow is untouched, and nothing in the UI says so. That is
// exactly how the post-import fix loop first failed in the field (a send whose /reply 409'd disarmed
// change-mode, so the user's retry became a question).
//
// spec 092: `intent` is PER-MESSAGE — it names the send button the user pressed (Enter/chat = 'ask',
// the labeled change pill / ⌘Enter = 'change'), not a sticky composer mode. The decision table is
// unchanged from the sticky-mode era; only the parameter's source moved from state to the click.
//
// The rule, in one place:
//   no task            → 'start'   a brand-new build/chat from the empty surface
//   promote build      → 'reply'   no Ask surface; typed text is always a Request-changes (spec 052)
//   done + change      → 'reply'   the post-import fix loop — reopens the build, resumes ③
//   done | cancelled   → 'ask'     terminal default: a question about a finished/abandoned build
//   error              → 'reply'   the Retry path (§I)
//   change             → 'reply'   a Request-changes at a parked gate
//   otherwise          → 'ask'     the default at every gate (spec 033/034)
import type { WireStatus, WireTask } from '../types';

export type ComposerTarget = 'start' | 'reply' | 'ask';
/** spec 103 Lane B: 'propose' is a THIRD send — "fix it, but show me the plan first". A sibling of
 *  'change', never a mode: spec 092's rule is that intent lives on the button pressed, and a proposal
 *  that could be silently armed would re-create exactly the class of bug that rule exists to prevent. */
export type ComposerIntent = 'ask' | 'change' | 'propose';

export function composerTarget(
  task: Pick<WireTask, 'status' | 'kind'> | null | undefined,
  intent: ComposerIntent
): ComposerTarget {
  if (!task) return 'start';
  if (task.kind === 'promote') return 'reply';
  if (task.status === 'done' || task.status === 'cancelled') {
    // A change-intent send is honored at `done` ONLY (the change pill shows there); a cancelled build
    // re-enters through Restore, so its composer stays a question box even if 'change' arrives.
    return task.status === 'done' && intent !== 'ask' ? 'reply' : 'ask';
  }
  if (task.status === 'error') return 'reply'; // Retry-out-of-error, with or without steering text
  return intent !== 'ask' ? 'reply' : 'ask';
}

/**
 * The `label` a 'reply' send carries — the English action name the resolved gate card shows (spec 016 D4).
 * `undefined` falls back to the store's generic 'Requested changes'. A promote reply is always the pinned
 * 'Request changes'; a text-steered Retry out of error has no armed action unless the user chose one.
 */
export function replyLabel(
  status: WireStatus,
  kind: WireTask['kind'],
  intent: ComposerIntent,
  changeLabel: string
): string | undefined {
  if (kind === 'promote') return 'Request changes';
  if (status === 'error' && intent === 'ask') return undefined;
  return changeLabel;
}
