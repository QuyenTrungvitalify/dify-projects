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
 *   - {@link buildTree} — the `projects/<project>/ → projects/<project>/<workflow>/ → .runs task`
 *     3-level sidebar tree, a direct 2-level filesystem walk (spec 030).
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DRAFTS_PROJECT, runsRoot, workflowDir, type Task } from '../state/task.js';
import { titleCaseSlug } from './slug.js';

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

/** Resolve the canonical SPEC.md path for a task — scaffolded → workflow subtree, else pre-scaffold run dir. */
export function specPathFor(projectsDir: string, task: Task): string {
  const dir = workflowDir(task);
  return dir
    ? join(projectsDir, dir, 'SPEC.md')
    : join(projectsDir, 'apps/builder/.runs', task.taskId, 'SPEC.md');
}

/** Resolve the on-disk workflow YAML path for a task, or null pre-scaffold (not written yet).
 *  Mirrors the yaml read in {@link readArtifactContents}; used by the "Reveal in Finder" endpoint. */
export function workflowPathFor(projectsDir: string, task: Task): string | null {
  const dir = workflowDir(task);
  return dir ? join(projectsDir, dir, 'workflows', task.workflowFile) : null;
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
  // Spec 052: a promote build surfaces its distilled pattern (not the source workflow) in the `yaml` pane —
  // that is what the review gate asks the human to inspect before Approve. Read the STAGED file first (it
  // exists from the distill turn through the review gate — `target` is only the PROPOSED path there, not yet
  // on disk); after Approve the staged file is moved, so fall back to the finalized `target`.
  if (task.kind === 'promote') {
    const p = task.promote;
    let yaml = p?.staged ? await readMaybe(join(projectsDir, p.staged)) : null;
    if (yaml == null && p?.target) yaml = await readMaybe(join(projectsDir, p.target));
    return { spec: null, yaml, report: null, diff: null };
  }
  const spec = await readMaybe(specPathFor(projectsDir, task));
  const wfPath = workflowPathFor(projectsDir, task);
  const yaml = wfPath ? await readMaybe(wfPath) : null;
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
  id: string; // workflow folder name (spec 030)
  name: string;
  tasks: TreeTaskNode[];
}
export interface TreeProjectNode {
  id: string; // project folder name (spec 030)
  name: string;
  workflows: TreeWorkflowNode[];
}

/**
 * Read a single `<parent>:` mapping key from a machine-generated YAML (`.dify-workspace.yaml`'s
 * `project.name`, or a workflow `main.yml`'s `app.name`). The files use consistent 2-space
 * indentation, so a scoped block read is sufficient and avoids a YAML dependency. Returns null when
 * the parent block or the key is absent. Read-only — it NEVER writes.
 */
export function readNestedScalar(yamlText: string, parent: string, key: string): string | null {
  const lines = yamlText.split('\n');
  let inBlock = false;
  for (const line of lines) {
    if (new RegExp(`^${parent}:\\s*$`).test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (/^\S/.test(line)) break; // a non-indented line ends the block
      const m = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
      if (m && m[1] === key) {
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        } else {
          val = val.replace(/\s+#.*$/, '').trim();
        }
        return val || null;
      }
    }
  }
  return null;
}

/** Spec 030 D1: the PROJECT display name = `project.name` in `projects/<project>/.dify-workspace.yaml`,
 *  else a title-cased folder name. */
function projectDisplayName(manifestText: string | null, projectFolder: string): string {
  return (manifestText && readNestedScalar(manifestText, 'project', 'name')) || titleCaseSlug(projectFolder);
}

/** Spec 030 D6: the WORKFLOW display name = the Dify DSL `app.name` in the workflow's `main.yml`
 *  (else the first `*.yml` in workflows/), falling back to a title-cased folder name when absent
 *  or the YAML is broken. */
async function workflowDisplayName(wfAbs: string, wfFolder: string): Promise<string> {
  const wfDir = join(wfAbs, 'workflows');
  if (existsSync(wfDir)) {
    let files: string[];
    try {
      files = (await readdir(wfDir)).filter((f) => /\.ya?ml$/i.test(f));
    } catch {
      files = [];
    }
    // Prefer main.yml (the from-scratch convention); else the first yaml (a Dify-seed pull).
    const pick = files.includes('main.yml') ? 'main.yml' : files.sort()[0];
    if (pick) {
      const text = await readMaybe(join(wfDir, pick));
      const name = text && readNestedScalar(text, 'app', 'name');
      if (name) return name;
    }
  }
  return titleCaseSlug(wfFolder);
}

/** At the PROJECT level, these entries are NOT workflow folders (D1/D2 shared config + dotfiles). */
function isReservedProjectEntry(name: string): boolean {
  return name === 'envs' || name === 'README.md' || name.startsWith('.');
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
 * Spec 030 — build the Project ▸ Workflow ▸ Task tree as a DIRECT 2-level read of the filesystem:
 * `projects/<project>/` are the Project rows, `projects/<project>/<workflow>/` (a dir with a
 * `workflows/` inside) are the Workflow rows. There is no more `project.group` grouping — the folder
 * IS the group. Tasks attach by their `(project, workflowSlug)` pair. A task with no folder yet
 * (pre-scaffold, or a raced/removed dir) is surfaced (under its project if it exists on disk, else the
 * `_drafts` project) so an in-flight build is never stranded.
 */
export async function buildTree(projectsDir: string, nowMs: number): Promise<TreeProjectNode[]> {
  const byTaskIdDesc = (a: TreeTaskNode, b: TreeTaskNode): number => Number(b.id) - Number(a.id);
  const keyOf = (project: string, workflow: string): string => `${project}/${workflow}`;

  // 1. Tasks from .runs/<taskId>/task.json, bucketed by the (project, workflowSlug) pair.
  const tasksByKey = new Map<string, TreeTaskNode[]>();
  const drafts: TreeTaskNode[] = []; // pre-scaffold (project/workflowSlug null) → still visible
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
      if (task.project && task.workflowSlug) {
        const k = keyOf(task.project, task.workflowSlug);
        (tasksByKey.get(k) ?? tasksByKey.set(k, []).get(k)!).push(node);
      } else {
        drafts.push(node);
      }
    }
  }

  // 2. Walk projects/<project>/<workflow>/ two levels deep → the real tree.
  const projectsRoot = join(projectsDir, 'projects');
  const projects = new Map<string, TreeProjectNode>();
  const claimedKeys = new Set<string>();
  const getProject = (folder: string, name: string): TreeProjectNode => {
    let p = projects.get(folder);
    if (!p) {
      p = { id: folder, name, workflows: [] };
      projects.set(folder, p);
    }
    return p;
  };

  const createdByProject = new Map<string, number>(); // folder birthtime → newest-first project sort
  if (existsSync(projectsRoot)) {
    for (const projectFolder of await readdir(projectsRoot)) {
      const projectAbs = join(projectsRoot, projectFolder);
      let entries: string[];
      let createdMs = 0;
      try {
        const st = await stat(projectAbs);
        if (!st.isDirectory()) continue;
        createdMs = st.birthtimeMs || st.mtimeMs; // birthtime; mtime fallback for FS without it
        entries = await readdir(projectAbs);
      } catch {
        continue;
      }
      createdByProject.set(projectFolder, createdMs);
      const manifest = await readMaybe(join(projectAbs, '.dify-workspace.yaml'));
      const proj = getProject(projectFolder, projectDisplayName(manifest, projectFolder));
      for (const wfFolder of entries) {
        if (isReservedProjectEntry(wfFolder)) continue;
        const wfAbs = join(projectAbs, wfFolder);
        // A workflow folder is a dir that CONTAINS a workflows/ subdir.
        if (!existsSync(join(wfAbs, 'workflows'))) continue;
        const k = keyOf(projectFolder, wfFolder);
        claimedKeys.add(k);
        proj.workflows.push({
          id: wfFolder,
          name: await workflowDisplayName(wfAbs, wfFolder),
          tasks: (tasksByKey.get(k) ?? []).sort(byTaskIdDesc),
        });
      }
    }
  }

  // 3. Orphan visibility — a task whose (project, workflowSlug) matches no folder yet (scaffold raced /
  //    removed) must not be dropped. Attach it to its project row if that project exists on disk, else
  //    collect it under the reserved `_drafts` project (created below alongside pre-scaffold drafts).
  const orphanDrafts: TreeTaskNode[] = [];
  for (const [k, tasks] of tasksByKey) {
    if (claimedKeys.has(k)) continue;
    const slash = k.indexOf('/');
    const project = k.slice(0, slash);
    const workflow = k.slice(slash + 1);
    if (projects.has(project)) {
      projects.get(project)!.workflows.push({ id: workflow, name: titleCaseSlug(workflow), tasks: tasks.sort(byTaskIdDesc) });
    } else {
      orphanDrafts.push(...tasks);
    }
  }

  // 4. Pre-scaffold + orphaned-project tasks → the `_drafts` project (real folder if it exists on disk,
  //    else a synthetic row) so an in-flight build is always reachable.
  const loose = [...drafts, ...orphanDrafts];
  if (loose.length) {
    const draftsRow = getProject(DRAFTS_PROJECT, 'Drafts');
    draftsRow.workflows.push({ id: '(unsaved)', name: '(unsaved)', tasks: loose.sort(byTaskIdDesc) });
  }

  const result = [...projects.values()];
  result.forEach((p) => p.workflows.sort((a, b) => a.name.localeCompare(b.name)));
  // `_drafts` leads the list so the active build is visible; the rest sort NEWEST-CREATED FIRST (folder
  // birthtime) so a just-created project surfaces at the top, not buried alphabetically. Name is the
  // tie-break (or for a synthetic project with no folder timestamp).
  result.sort((a, b) => {
    if (a.id === DRAFTS_PROJECT) return -1;
    if (b.id === DRAFTS_PROJECT) return 1;
    const ca = createdByProject.get(a.id) ?? 0;
    const cb = createdByProject.get(b.id) ?? 0;
    return cb - ca || a.name.localeCompare(b.name);
  });
  return result;
}
