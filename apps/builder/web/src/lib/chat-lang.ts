import type { ChatLang } from '../store';

/** The task fields the reply-language control depends on — a narrow view so it's unit-testable
 *  without constructing a whole WireTask. */
export interface ChatLangTask {
  taskId: string;
  /** The build's own setting. Absent on a task.json written before the field existed ⇒ 'auto'. */
  chatLang?: string;
}

/** Where a pick made in the ⚙ menu has to land. */
export type ChatLangTarget =
  /** No build is open — set the default that future builds inherit, and nothing else. */
  | { kind: 'global' }
  /** A build is open — patch it too, so the change lands on the conversation being read. */
  | { kind: 'task'; taskId: string };

/**
 * Which reply language the ⚙ menu should show as in force.
 *
 * With a build open it is THE BUILD'S, not the global default — the same rule the composer's
 * Confirm chip follows (it renders `task.confirmMode`, not `settings.confirm`). This is not
 * cosmetic: `task.chatLang` is what `resolveLang` actually reads, and it outranks the language of
 * the message you just typed. Showing the global value instead let the menu display ✓Tiếng Việt
 * over a build that was pinned to Japanese and answering in it.
 *
 * An old task.json has no field at all; `normalizeChatLang` reads that as 'auto', so we must too —
 * otherwise the menu would show the global pick over a build that is really inferring.
 */
export function chatLangInForce(task: ChatLangTask | null | undefined, global: ChatLang): ChatLang {
  if (!task) return global;
  return task.chatLang === 'vi' || task.chatLang === 'ja' ? task.chatLang : 'auto';
}

/** Where a pick lands: on the open build (plus the global default) or on the global default alone. */
export function chatLangTarget(task: ChatLangTask | null | undefined): ChatLangTarget {
  return task ? { kind: 'task', taskId: task.taskId } : { kind: 'global' };
}
