/**
 * Spec 029 (S5) — the new-task breadcrumb model. The crumb's icon/label/active must switch with the
 * sidebar "+" pre-selection (workflow-edit vs project-target vs plain new task), with workflow-edit
 * taking precedence (AC5). Pure-function tests (no render) — the click-to-clear + reset half is covered
 * by store.test.ts (resetToNew) and manual QA.
 */
import { describe, it, expect } from 'vitest';
import { newTaskCrumb, wfDisplayName, runContextCrumb, workflowOptions, activeSidebarProject, activeSidebarWorkflow } from './crumb';
import { setLang } from './i18n';
import type { WireTreeProject, WireTreeTask, WireTask } from '../types';

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
  it('workflow set → edit (pencil) icon, "Editing <name>", active (clickable-to-clear)', () => {
    setLang('en');
    const c = newTaskCrumb('chatbot', null, tree);
    expect(c.icon).toBe('edit');
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
    expect(c.icon).toBe('edit');
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

describe('workflowOptions (recency-sorted composer dropdown)', () => {
  const mkTask = (id: string): WireTreeTask => ({ id, name: 't', time: '', status: 'done', phase: 'test' });
  const rtree: WireTreeProject[] = [
    // _drafts must be excluded even though its task is the "newest".
    { id: '_drafts', name: 'Drafts', workflows: [{ id: '(unsaved)', name: '(unsaved)', tasks: [mkTask('9999999999999')] }] },
    { id: 'proj_a', name: 'Proj A', workflows: [
      { id: 'old_wf', name: 'Old WF', tasks: [mkTask('1000000000001')] },       // oldest activity
      { id: 'no_task_wf', name: 'No Task WF', tasks: [] },                       // never built → sorts last
    ] },
    { id: 'proj_b', name: 'Proj B', workflows: [
      { id: 'new_wf', name: 'New WF', tasks: [mkTask('1783000000000'), mkTask('1000000000000')] }, // newest (tasks newest-first)
    ] },
  ];

  it('sorts by newest-task recency ACROSS projects; excludes _drafts; a no-task workflow sorts last', () => {
    expect(workflowOptions(rtree).map((o) => o.v)).toEqual([
      'proj_b/new_wf',      // newest task 1783…
      'proj_a/old_wf',      // 1000000000001
      'proj_a/no_task_wf',  // no task → 0 → last
    ]);
    expect(workflowOptions(rtree).some((o) => o.v.startsWith('_drafts/'))).toBe(false);
  });

  it('value is the compound "project/workflow"; label is "Project / Workflow"', () => {
    const nw = workflowOptions(rtree).find((o) => o.v === 'proj_b/new_wf');
    expect(nw?.l).toBe('Proj B / New WF');
  });

  // The armed workflow must always BE in the list. A `_drafts` edit (the sidebar Build section's rows
  // are `_drafts` workflows, so this is the common edit) is excluded from the options by design, and a
  // chip whose value matches no option renders the raw compound slug — `_drafts/build_requirement_news_
  // automat…`, truncated before the `_2` that distinguishes two sibling folders — while the crumb above
  // it showed the workflow's NAME. Same target, two names, neither checkable against the other.
  const dtree: WireTreeProject[] = [
    { id: '_drafts', name: 'Drafts', workflows: [
      { id: 'news_2', name: '📦 3 Build Requirement — News Automation APP 1…', tasks: [] },
    ] },
    ...rtree.slice(1),
  ];

  it('prepends the ARMED workflow when the list has no option for it, labelled by its display name', () => {
    const opts = workflowOptions(dtree, '_drafts/news_2');
    expect(opts[0]).toEqual({ v: '_drafts/news_2', l: '📦 3 Build Requirement — News Automation APP 1…' });
  });

  it('does not duplicate an armed workflow that already has an option', () => {
    const opts = workflowOptions(rtree, 'proj_b/new_wf');
    expect(opts.filter((o) => o.v === 'proj_b/new_wf')).toHaveLength(1);
    expect(opts[0].l).toBe('Proj B / New WF'); // still the recency order, not a prepended copy
  });

  it('adds nothing for "none" / no armed workflow', () => {
    expect(workflowOptions(dtree, 'none').some((o) => o.v.startsWith('_drafts/'))).toBe(false);
    expect(workflowOptions(dtree).some((o) => o.v.startsWith('_drafts/'))).toBe(false);
  });

  it('a deleted/renamed armed target still gets an option (bare slug label, never a dead chip)', () => {
    const opts = workflowOptions(rtree, 'proj_a/ghost_wf');
    expect(opts[0]).toEqual({ v: 'proj_a/ghost_wf', l: 'ghost_wf' });
  });
});

describe('084 S1.5 · activeSidebar{Project,Workflow} — a distill never co-highlights its source', () => {
  it('a promote task returns null (its home is the Distill section, not the Build tree)', () => {
    const promote = { kind: 'promote', project: '_drafts', workflowSlug: 'x_y_m_t' } as unknown as WireTask;
    expect(activeSidebarProject(promote)).toBe(null);
    expect(activeSidebarWorkflow(promote)).toBe(null);
  });
  it('a normal build task still highlights its project/workflow as before', () => {
    const build = { kind: undefined, project: 'proj', workflowSlug: 'flow' } as unknown as WireTask;
    expect(activeSidebarProject(build)).toBe('proj');
    expect(activeSidebarWorkflow(build)).toBe('proj/flow');
  });
  it('a consult (no project) yields null workflow, project null — unchanged', () => {
    const consult = { kind: 'consult', project: null, workflowSlug: null } as unknown as WireTask;
    expect(activeSidebarProject(consult)).toBe(null);
    expect(activeSidebarWorkflow(consult)).toBe(null);
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
