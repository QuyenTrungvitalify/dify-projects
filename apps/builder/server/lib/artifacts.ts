/**
 * artifacts.ts — read-only helpers for the Lát 4 UI surface (spec 009 §B / Endpoints).
 *
 * Three concerns, all READ-only (the UI is a dumb renderer; the only write path is
 * `PUT /api/tasks/:id/spec`, handled in routes/ui.ts):
 *   - {@link readArtifactContents} — load the SPEC.md / main.yml / report.json a task produced, so
 *     `GET /api/tasks/:id` can return "state + artifact contents" (spec Endpoints :532). The diff
 *     producer is Lát 5 → `diff` stays null here (the panel degrades to "no diff yet").
 *   - {@link specPathFor} — the SAME SPEC.md path the orchestrator's §A gate-check uses
 *     (`projects/<slug>/SPEC.md` once a slug exists, else the pre-scaffold `.runs/<taskId>/SPEC.md`),
 *     shared by the GET and the PUT so an in-place edit round-trips to where Implement re-reads it.
 *   - {@link buildTree} — the `project.group → projects/<slug>/ → .runs task` 3-level sidebar tree
 *     (spec §Data model + §Revision Frontend model).
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runsRoot, type Task } from '../state/task.js';

export interface ArtifactContents {
  /** projects/<slug>/SPEC.md or the pre-scaffold .runs/<taskId>/SPEC.md (phase ②, editable). */
  spec: string | null;
  /** projects/<slug>/workflows/<file> (phase ③). */
  yaml: string | null;
  /** parsed report.json (phase ④). */
  report: unknown | null;
  /** unified-diff text from `.runs/<taskId>/diff.json` (Lát 5 diff producer); null until Implement. */
  diff: string | null;
}

/** Resolve the canonical SPEC.md path for a task — slug-known → project, else pre-scaffold run dir. */
export function specPathFor(projectsDir: string, task: Task): string {
  return task.slug
    ? join(projectsDir, 'projects', task.slug, 'SPEC.md')
    : join(projectsDir, 'apps/builder/.runs', task.taskId, 'SPEC.md');
}

async function readMaybe(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Load whatever artifacts the task has produced so far (missing files degrade to null). */
export async function readArtifactContents(
  projectsDir: string,
  task: Task
): Promise<ArtifactContents> {
  const spec = await readMaybe(specPathFor(projectsDir, task));
  const yaml = task.slug
    ? await readMaybe(join(projectsDir, 'projects', task.slug, 'workflows', task.workflowFile))
    : null;
  let report: unknown | null = null;
  if (task.artifacts.report) {
    const raw = await readMaybe(join(projectsDir, task.artifacts.report));
    if (raw) {
      try {
        report = JSON.parse(raw);
      } catch {
        report = null;
      }
    }
  }
  // Diff: the producer writes `.runs/<taskId>/diff.json` = { path, diff } after Implement; surface
  // the unified-diff text (the panel renders it via SplitDiffView, else degrades to "no diff yet").
  let diff: string | null = null;
  const diffRaw = await readMaybe(join(projectsDir, `apps/builder/.runs/${task.taskId}/diff.json`));
  if (diffRaw) {
    try {
      diff = (JSON.parse(diffRaw) as { diff?: string }).diff ?? null;
    } catch {
      diff = null;
    }
  }
  return { spec, yaml, report, diff };
}

// ───────────────────────────── sidebar tree ─────────────────────────────

export interface TreeTaskNode {
  id: string;
  name: string;
  time: string;
  status: Task['status'];
  phase: Task['phase'];
}
export interface TreeWorkflowNode {
  id: string; // slug
  name: string;
  tasks: TreeTaskNode[];
}
export interface TreeProjectNode {
  id: string; // group key
  name: string;
  workflows: TreeWorkflowNode[];
}

interface WorkspaceProject {
  slug: string;
  name: string;
  group: string;
}

/**
 * Minimal reader for the `project:` mapping in a `.dify-workspace.yaml` — extracts `name`, `slug`,
 * and the optional `group` sub-key (spec §Data model). The files are machine-generated with
 * consistent 2-space indentation, so a scoped block read is sufficient and avoids a YAML dep.
 *
 * This NEVER writes the file (writing a scalar `project:` would crash `regen_vscode_settings.py`,
 * spec §Data model) — it only reads the nested keys. `group` defaults to the slug when absent
 * (ungrouped → the slug is its own Project row, §Revision Frontend model).
 */
function parseWorkspaceProject(yamlText: string, fallbackSlug: string): WorkspaceProject {
  const lines = yamlText.split('\n');
  const out: Record<string, string> = {};
  let inProject = false;
  for (const line of lines) {
    if (/^project:\s*$/.test(line)) {
      inProject = true;
      continue;
    }
    if (inProject) {
      // A non-indented, non-empty line ends the project block.
      if (/^\S/.test(line)) break;
      const m = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
      if (m) {
        const key = m[1];
        let val = m[2].trim();
        // strip surrounding quotes + trailing inline comment on unquoted scalars
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        } else {
          val = val.replace(/\s+#.*$/, '').trim();
        }
        out[key] = val;
      }
    }
  }
  const slug = out.slug || fallbackSlug;
  return { slug, name: out.name || slug, group: out.group || slug };
}

/** ms-timestamp taskId → coarse "now" relative label (spec sidebar shows a short age, not a clock). */
function relTime(taskId: string, nowMs: number): string {
  const ms = Number(taskId);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const s = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo` : `${Math.floor(mo / 12)}y`;
}

function taskTitle(task: Task): string {
  if (task.name && task.name.trim()) return task.name.trim();
  const req = (task.requirement || '').trim();
  if (req) return req.length > 46 ? req.slice(0, 46) + '…' : req;
  return task.taskId;
}

const isNonTerminal = (s: Task['status']): boolean =>
  s === 'running' || s === 'scaffolding' || s === 'awaiting_confirm';

/**
 * The in-progress builds (`GET /api/active`, Lát 6): every non-terminal task in `.runs/`, newest
 * first. With the turn-level lock, ANY number of builds may sit parked at gates (`awaiting_confirm`)
 * — this lets the SPA list + reach them all on load so a parked build is never stranded (extends
 * AC #22 to the no-taskId case). Read-only; mirrors {@link buildTree}'s task scan but flat.
 */
export async function listActiveTasks(projectsDir: string, nowMs: number): Promise<TreeTaskNode[]> {
  const root = runsRoot(projectsDir);
  if (!existsSync(root)) return [];
  const out: TreeTaskNode[] = [];
  for (const taskId of await readdir(root)) {
    const f = join(root, taskId, 'task.json');
    if (!existsSync(f)) continue; // skip Lát-1 smoke dirs (SPEC.md only, no task.json)
    const raw = await readMaybe(f);
    if (!raw) continue;
    let task: Task;
    try {
      task = JSON.parse(raw) as Task;
    } catch {
      continue;
    }
    if (!isNonTerminal(task.status)) continue;
    out.push({
      id: task.taskId,
      name: taskTitle(task),
      time: relTime(task.taskId, nowMs),
      status: task.status,
      phase: task.phase,
    });
  }
  return out.sort((a, b) => Number(b.id) - Number(a.id)); // newest first
}

/**
 * Build the Project ▸ Workflow ▸ Task tree (spec §Data model). Scans each
 * `projects/<slug>/.dify-workspace.yaml` for the workflow rows (grouped by `project.group`), then
 * attaches each `.runs/<taskId>/task.json`
 * to its workflow by `task.slug`. Slug-less tasks (a new build still pre-scaffold) collect under a
 * synthetic "Drafts" project so the active build is always visible in the sidebar.
 */
export async function buildTree(projectsDir: string, nowMs: number): Promise<TreeProjectNode[]> {
  // 1. Workflows from projects/<slug>/ (+ their workspace group).
  const projectsRoot = join(projectsDir, 'projects');
  const workflowBySlug = new Map<string, WorkspaceProject>();
  if (existsSync(projectsRoot)) {
    for (const slug of await readdir(projectsRoot)) {
      const wsPath = join(projectsRoot, slug, '.dify-workspace.yaml');
      if (!existsSync(wsPath)) continue;
      const text = await readMaybe(wsPath);
      workflowBySlug.set(slug, text ? parseWorkspaceProject(text, slug) : { slug, name: slug, group: slug });
    }
  }

  // 2. Tasks from .runs/<taskId>/task.json, bucketed by slug.
  const tasksBySlug = new Map<string, TreeTaskNode[]>();
  const drafts: TreeTaskNode[] = [];
  const root = runsRoot(projectsDir);
  if (existsSync(root)) {
    for (const taskId of await readdir(root)) {
      const f = join(root, taskId, 'task.json');
      if (!existsSync(f)) continue; // skip Lát-1 smoke dirs (SPEC.md only, no task.json)
      const raw = await readMaybe(f);
      if (!raw) continue;
      let task: Task;
      try {
        task = JSON.parse(raw) as Task;
      } catch {
        continue;
      }
      const node: TreeTaskNode = {
        id: task.taskId,
        name: taskTitle(task),
        time: relTime(task.taskId, nowMs),
        status: task.status,
        phase: task.phase,
      };
      if (task.slug) {
        const arr = tasksBySlug.get(task.slug) ?? [];
        arr.push(node);
        tasksBySlug.set(task.slug, arr);
      } else {
        drafts.push(node);
      }
    }
  }

  const byTaskIdDesc = (a: TreeTaskNode, b: TreeTaskNode): number => Number(b.id) - Number(a.id);

  // 3. Group workflows by project.group.
  const groups = new Map<string, TreeProjectNode>();
  for (const wp of workflowBySlug.values()) {
    const tasks = (tasksBySlug.get(wp.slug) ?? []).sort(byTaskIdDesc);
    const wf: TreeWorkflowNode = { id: wp.slug, name: wp.name, tasks };
    const proj = groups.get(wp.group) ?? { id: wp.group, name: wp.group, workflows: [] };
    proj.workflows.push(wf);
    groups.set(wp.group, proj);
  }

  // A task whose slug has no projects/<slug>/ dir yet (scaffold raced / removed) → keep it visible.
  for (const [slug, tasks] of tasksBySlug) {
    if (!workflowBySlug.has(slug)) {
      const proj = groups.get(slug) ?? { id: slug, name: slug, workflows: [] };
      proj.workflows.push({ id: slug, name: slug, tasks: tasks.sort(byTaskIdDesc) });
      groups.set(slug, proj);
    }
  }

  const result = [...groups.values()];
  result.forEach((p) => p.workflows.sort((a, b) => a.name.localeCompare(b.name)));
  result.sort((a, b) => a.name.localeCompare(b.name));

  // 4. Drafts (slug-less, in-flight) lead the list so the active build is visible.
  if (drafts.length) {
    result.unshift({
      id: '__drafts__',
      name: 'Drafts',
      workflows: [{ id: '__drafts__', name: '(unsaved)', tasks: drafts.sort(byTaskIdDesc) }],
    });
  }
  return result;
}
