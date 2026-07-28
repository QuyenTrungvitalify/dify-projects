import { describe, it, expect } from 'vitest';
import { canPromoteFromConversation, type PromoteVisibilityTask } from './promote-visibility';

const base: PromoteVisibilityTask = {
  kind: 'build',
  status: 'done',
  phase: 'test',
  project: '_drafts',
  workflowSlug: 'my_wf',
};
const t = (over: Partial<PromoteVisibilityTask> = {}): PromoteVisibilityTask => ({ ...base, ...over });

describe('canPromoteFromConversation', () => {
  it('shows for a finished build with a resolved workflow', () => {
    expect(canPromoteFromConversation('conversation', t({ status: 'done' }))).toBe(true);
  });

  it('shows at the ④ test gate (awaiting_confirm + test) — the 85ecfa8 case', () => {
    expect(canPromoteFromConversation('conversation', t({ status: 'awaiting_confirm', phase: 'test' }))).toBe(true);
  });

  it('hidden at awaiting_confirm on an EARLIER phase (only ④/test counts)', () => {
    expect(canPromoteFromConversation('conversation', t({ status: 'awaiting_confirm', phase: 'implement' }))).toBe(false);
    expect(canPromoteFromConversation('conversation', t({ status: 'awaiting_confirm', phase: 'spec' }))).toBe(false);
  });

  it('hidden while running', () => {
    expect(canPromoteFromConversation('conversation', t({ status: 'running' }))).toBe(false);
  });

  it('hidden for a cancelled build (not proven)', () => {
    expect(canPromoteFromConversation('conversation', t({ status: 'cancelled' }))).toBe(false);
  });

  it('hidden for a promote task (you do not promote a promote)', () => {
    expect(canPromoteFromConversation('conversation', t({ kind: 'promote' }))).toBe(false);
  });

  it('hidden before the workflow is scaffolded (no project / slug)', () => {
    expect(canPromoteFromConversation('conversation', t({ project: null }))).toBe(false);
    expect(canPromoteFromConversation('conversation', t({ workflowSlug: null }))).toBe(false);
  });

  it('hidden outside the conversation view, or with no task', () => {
    expect(canPromoteFromConversation('empty', t())).toBe(false);
    expect(canPromoteFromConversation('conversation', null)).toBe(false);
    expect(canPromoteFromConversation('conversation', undefined)).toBe(false);
  });
});
