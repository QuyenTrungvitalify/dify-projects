/**
 * chatLangInForce / chatLangTarget — what the ⚙ menu shows, and where a pick lands.
 *
 * WHY THIS TEST EXISTS. The bug these two rules close was silent in both directions at once: a build
 * created under 日本語 answered Japanese to plainly Vietnamese messages (because `task.chatLang`
 * outranks the typed text on the server), AND the menu displayed ✓Tiếng Việt over it the whole time.
 * Nothing errored; the control simply described a setting the conversation was not using.
 *
 * So both halves are pinned: the menu must read the OPEN BUILD's value, and a pick must be routed at
 * that build rather than only at the global default that future builds inherit.
 */
import { describe, it, expect } from 'vitest';
import { chatLangInForce, chatLangTarget } from './chat-lang';

const t = (chatLang?: string): { taskId: string; chatLang?: string } => ({ taskId: '1787190372697', chatLang });

describe('chatLangInForce', () => {
  it('shows the global default when no build is open', () => {
    expect(chatLangInForce(null, 'vi')).toBe('vi');
    expect(chatLangInForce(undefined, 'auto')).toBe('auto');
  });

  it("shows the OPEN BUILD's language, even when the global default disagrees", () => {
    // the reported case: menu said Tiếng Việt, the build was pinned to — and answering in — Japanese
    expect(chatLangInForce(t('ja'), 'vi')).toBe('ja');
    expect(chatLangInForce(t('vi'), 'ja')).toBe('vi');
  });

  it("reads a build with no stored language as 'auto', not as the global default", () => {
    // a task.json predating the field: the server infers from the text, so the menu must not claim
    // the global pick is in force
    expect(chatLangInForce(t(undefined), 'vi')).toBe('auto');
    expect(chatLangInForce(t('nonsense'), 'ja')).toBe('auto');
  });
});

describe('chatLangTarget', () => {
  it('aims a pick at the open build, so the change reaches the conversation being read', () => {
    expect(chatLangTarget(t('ja'))).toEqual({ kind: 'task', taskId: '1787190372697' });
  });

  it('falls back to the global default when nothing is open', () => {
    expect(chatLangTarget(null)).toEqual({ kind: 'global' });
  });
});
