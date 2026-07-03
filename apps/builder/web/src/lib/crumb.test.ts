/**
 * Spec 029 (S5) — the new-task breadcrumb model. The crumb's icon/label/active must switch with the
 * sidebar "+" pre-selection (workflow-edit vs project-target vs plain new task), with workflow-edit
 * taking precedence (AC5). Pure-function tests (no render) — the click-to-clear + reset half is covered
 * by store.test.ts (resetToNew) and manual QA.
 */
import { describe, it, expect } from 'vitest';
import { newTaskCrumb, wfDisplayName, runContextCrumb } from './crumb';
import { setLang } from './i18n';
import type { WireTreeProject, WireTask } from '../types';

const tree: WireTreeProject[] = [
  { id: 'my_app', name: 'My App', workflows: [
    { id: 'chatbot', name: 'Chatbot', tasks: [] },
    { id: 'summarizer', name: 'Summarizer', tasks: [] },
  ] },
];

describe('029 · wfDisplayName', () => {
  it('resolves a slug to its display name', () => {
    expect(wfDisplayName(tree, 'chatbot')).toBe('Chatbot');
  });
  it('falls back to the raw slug when not found', () => {
    expect(wfDisplayName(tree, 'ghost')).toBe('ghost');
  });
});

describe('029 · newTaskCrumb (EN)', () => {
  it('workflow set → message icon, "Editing <name>", active (clickable-to-clear)', () => {
    setLang('en');
    const c = newTaskCrumb('chatbot', null, tree);
    expect(c.icon).toBe('message');
    expect(c.label).toBe('Editing Chatbot');
    expect(c.active).toBe(true);
  });
  it('targetProject set → folder icon, "New task in <display name>", active', () => {
    setLang('en');
    const c = newTaskCrumb('none', 'my_app', tree);
    expect(c.icon).toBe('folder');
    expect(c.label).toBe('New task in My App'); // spec 030: resolves the project folder → its display name
    expect(c.active).toBe(true);
  });
  it('neither → folder icon, plain "New task", inert', () => {
    setLang('en');
    const c = newTaskCrumb('none', null, tree);
    expect(c.icon).toBe('folder');
    expect(c.label).toBe('New task');
    expect(c.active).toBe(false);
  });
  it('workflow wins over targetProject (AC5 precedence)', () => {
    setLang('en');
    const c = newTaskCrumb('summarizer', 'my_app', tree);
    expect(c.icon).toBe('message');
    expect(c.label).toBe('Editing Summarizer');
  });
  it("empty-string workflow ('' or 'none') is treated as no pre-selection", () => {
    setLang('en');
    expect(newTaskCrumb('', 'my_app', tree).label).toBe('New task in My App');
    expect(newTaskCrumb('none', null, tree).active).toBe(false);
  });
});

describe('030 · runContextCrumb (open-build context)', () => {
  const t = (o: Partial<WireTask>): WireTask => ({
    taskId: '1', project: null, workflowSlug: null, workflow: null, workflowFile: 'main.yml', requirement: 'r',
    seedPath: null, deploy: 'none', confirmMode: 'each_step', phase: 'analyze', status: 'running',
    name: null, sessionIds: {}, artifacts: {}, ...o,
  });

  it('from-scratch into a project, BEFORE slug derived → project display name only (no leaf)', () => {
    const c = runContextCrumb(t({ project: 'my_app' }), tree);
    expect(c).toEqual({ group: 'My App', leaf: null });
  });
  it('from-scratch into a project, AFTER name derived → project › name', () => {
    const c = runContextCrumb(t({ project: 'my_app', workflowSlug: 'summarizer', name: 'Summarizer' }), tree);
    expect(c).toEqual({ group: 'My App', leaf: 'Summarizer' });
  });
  it('edit-existing → project from tree lookup, leaf = workflow name', () => {
    // 'chatbot' lives under project 'my_app' in the tree fixture
    const c = runContextCrumb(t({ project: 'my_app', workflowSlug: 'chatbot', workflow: 'Chatbot' }), tree);
    expect(c).toEqual({ group: 'My App', leaf: 'Chatbot' });
  });
  it('edit-existing with workflowSlug in tree but no workflow name → leaf falls back to tree name', () => {
    const c = runContextCrumb(t({ project: 'my_app', workflowSlug: 'summarizer' }), tree);
    expect(c).toEqual({ group: 'My App', leaf: 'Summarizer' });
  });
  it('plain from-scratch before it names itself → null (phase track alone)', () => {
    expect(runContextCrumb(t({}), tree)).toBe(null);
  });
  it('a loose build (no project) with a derived name → leaf only, no group', () => {
    const c = runContextCrumb(t({ project: null, name: 'Brand New' }), tree);
    expect(c).toEqual({ group: null, leaf: 'Brand New' });
  });
  it('project folder name equals its display + workflow name → no duplicated leaf', () => {
    const solo: WireTreeProject[] = [{ id: 'solo', name: 'solo', workflows: [{ id: 'solo', name: 'solo', tasks: [] }] }];
    const c = runContextCrumb(t({ project: 'solo', workflowSlug: 'solo' }), solo);
    expect(c).toEqual({ group: 'solo', leaf: null });
  });
});

describe('029 · newTaskCrumb (JA localization + {name} interpolation)', () => {
  it('localizes both labels with the name in the JA position', () => {
    setLang('ja');
    expect(newTaskCrumb('chatbot', null, tree).label).toBe('Chatbot を編集');
    expect(newTaskCrumb('none', 'my_app', tree).label).toBe('My App 内に新規タスク'); // spec 030: display name
    expect(newTaskCrumb('none', null, tree).label).toBe('新規タスク');
    setLang('en'); // restore for other suites
  });
});
