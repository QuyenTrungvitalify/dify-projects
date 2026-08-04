/* ============================================================
   crumb.ts (spec 029) — the new-task breadcrumb model. Pure
   helpers (no DOM) so the label/icon/active logic is unit-
   testable independently of App's render. The crumb reflects the
   sidebar "+" pre-selection: editing a workflow (workflow "+"),
   targeting a project group (project "+"), or a plain new task.
   ============================================================ */
import { t as tr, tf } from './i18n';
import type { WireTreeProject, WireTask } from '../types';

export interface NewTaskCrumb {
  icon: 'edit' | 'folder';
  label: string;
  /** true ⇒ a pre-selection is active, so the crumb is clickable-to-clear (it IS the "×"). */
  active: boolean;
}

/** Look up a workflow's display name in the tree. Accepts a bare workflow slug (first match across
 *  projects) OR the spec-030 compound `project/workflow` (scoped to that project); falls back to the
 *  workflow part on no match. */
export function wfDisplayName(tree: WireTreeProject[], slug: string): string {
  const slash = slug.indexOf('/');
  if (slash !== -1) {
    const project = slug.slice(0, slash);
    const wf = slug.slice(slash + 1);
    const proj = tree.find((p) => p.id === project);
    return proj?.workflows.find((w) => w.id === wf)?.name ?? wf;
  }
  for (const p of tree) for (const w of p.workflows) if (w.id === slug) return w.name;
  return slug;
}

/** Look up a project's display name by folder in the tree; falls back to the raw folder on no match. */
export function projectDisplayName(tree: WireTreeProject[], project: string): string {
  return tree.find((p) => p.id === project)?.name ?? project;
}

/**
 * Options for the composer's Workflow dropdown, sorted by RECENCY (the workflow whose NEWEST task is most
 * recent leads) instead of alphabetically — so the workflows you actually touch surface at the top when
 * there are many (the flat A→Z list didn't scale). `_drafts` scratch is excluded. Each option is the
 * spec-030 compound `project/workflow` value + a readable `Project / Workflow` label. Pure (tree-derived).
 */
export function workflowOptions(tree: WireTreeProject[]): { v: string; l: string }[] {
  return tree
    .filter((p) => p.id !== '_drafts')
    .flatMap((p) =>
      p.workflows.map((w) => ({
        v: `${p.id}/${w.id}`,
        l: `${p.name} / ${w.name}`,
        // buildTree returns a workflow's tasks NEWEST-first, so tasks[0].id (a 13-digit ms timestamp) is
        // its most recent activity. A workflow with no tasks sorts last (0). Number compare is exact for
        // 13-digit ids (< 2^53).
        recent: Number(w.tasks[0]?.id ?? 0),
      })),
    )
    .sort((a, b) => b.recent - a.recent)
    .map(({ v, l }) => ({ v, l }));
}

/**
 * Derive the new-task crumb from the current RunSettings pre-selection. Workflow-edit wins over a
 * project target (AC5 precedence: if the user picks a workflow after a project "+", the edit label
 * shows). `active` gates the clickable-to-clear affordance; a plain new task is inert (as before).
 */
export function newTaskCrumb(
  workflow: string | null,
  targetProject: string | null,
  tree: WireTreeProject[],
): NewTaskCrumb {
  if (workflow && workflow !== 'none')
    return { icon: 'edit', label: tf('editingWorkflow', { name: wfDisplayName(tree, workflow) }), active: true };
  if (targetProject)
    return { icon: 'folder', label: tf('newTaskInProjectName', { name: projectDisplayName(tree, targetProject) }), active: true };
  return { icon: 'folder', label: tr('newTask'), active: false };
}

/** spec 030: the context breadcrumb for an OPEN build (conversation view) — which project/workflow this
 *  build belongs to, so a running/parked build isn't a context-less thread. `group` is the project
 *  folder (`task.project`, known before the workflow slug is derived — from the sidebar "+" target);
 *  `leaf` is the workflow display name (tree lookup of `task.project`/`task.workflowSlug`, after the
 *  scaffold), else the workflow/derived name. Returns null when there is no project context to show —
 *  the caller then shows the phase track alone. */
export interface RunContextCrumb {
  group: string | null;
  leaf: string | null;
}

type RunCrumbTask = Pick<WireTask, 'project' | 'workflowSlug' | 'workflow' | 'name'>;

export function runContextCrumb(task: RunCrumbTask, tree: WireTreeProject[]): RunContextCrumb | null {
  let group: string | null = task.project ?? null;
  let leaf: string | null = task.workflow ?? task.name ?? null;
  if (task.project) {
    const proj = tree.find((p) => p.id === task.project);
    if (proj) {
      group = proj.name;
      if (task.workflowSlug) leaf = leaf ?? proj.workflows.find((w) => w.id === task.workflowSlug)?.name ?? null;
    }
    leaf = leaf ?? task.workflowSlug ?? null;
  }
  if (leaf && leaf === group) leaf = null; // avoid repeating the project name as the leaf
  if (!group && !leaf) return null;
  return { group, leaf };
}

/** spec 084 S1.5 — the sidebar's active PROJECT for an open task. A promote/distill task lives in its
 *  own "蒸留" section, so it must NOT highlight the SOURCE project it carries for provenance — return
 *  null (mirrors a consult, whose project is already null). */
export function activeSidebarProject(task: Pick<WireTask, 'kind' | 'project'>): string | null {
  if (task.kind === 'promote') return null;
  return task.project ?? null;
}

/** spec 084 S1.5 — the sidebar's active `project/workflow` key for an open task. A promote/distill task
 *  must NOT highlight its SOURCE workflow in the Build tree (it carries the source's project/workflowSlug
 *  for the header pill + provenance) — return null, so only its Distill-section row highlights. */
export function activeSidebarWorkflow(task: Pick<WireTask, 'kind' | 'project' | 'workflowSlug'>): string | null {
  if (task.kind === 'promote') return null;
  return task.project && task.workflowSlug ? `${task.project}/${task.workflowSlug}` : null;
}
