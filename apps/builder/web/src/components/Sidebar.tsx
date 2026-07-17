/* ============================================================
   Sidebar.tsx — 3-level tree: Project ▸ Workflow ▸ Task (AC #13)
   Live (lat4-ui): fed by GET /api/tree (projects/<project>/ →
   <workflow>/ → .runs task). Project hover shows ONLY "+" (no gear);
   the active task gets the highlight pill. Breadcrumb is static
   (not auto-updated mid-run) — handled in App.
   ============================================================ */
import { useState, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { I } from './Icon';
import { t as tr, tf } from '../lib/i18n';
import { askConfirm } from '../store';
import { devMode } from '../lib/dev';
import { RebuildButton } from './RebuildButton';
import type { WireTreeProject, WireTreeWorkflow, WireTreeTask, NewTaskOpts } from '../types';

export function Twist({ open, onClick }: { open: boolean; onClick?: JSX.MouseEventHandler<HTMLSpanElement> }) {
  return (
    <span className={'tw-twist' + (open ? ' open' : '')} onClick={onClick}>
      <I.chevron />
    </span>
  );
}

function TaskRow({ task, activeTask, onOpen, projectId, workflowSlug, onNewTask }: {
  task: WireTreeTask;
  activeTask: string | null;
  onOpen: (taskId: string) => void;
  projectId: string;
  workflowSlug: string;
  onNewTask: (opts?: NewTaskOpts) => void;
}) {
  const active = task.id === activeTask;
  return (
    <div className={'tree-row tree-task' + (active ? ' active' : '')} onClick={() => onOpen(task.id)}>
      <span className="tw-name">{task.name}</span>
      <span className="tw-time">{task.time}</span>
      {/* hover: edit this task's WORKFLOW — a NEW edit-existing build on it (same as the workflow-row "+").
          Surfaced here too so it's reachable from any task row (esp. in _drafts). */}
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" title={tr('editThisWorkflow')} onClick={() => onNewTask({ baseWorkflow: { project: projectId, workflow: workflowSlug } })}><I.message /></button>
      </span>
    </div>
  );
}

function WorkflowRow({ wf, projectId, activeTask, active, defaultOpen, onOpen, onNewTask }: {
  wf: WireTreeWorkflow;
  projectId: string;
  activeTask: string | null;
  /** UX: this workflow is the active/selected menu node (open build's workflow, or the pre-selected
   *  edit target). Adds the highlight + reveals it in the scroll region. */
  active: boolean;
  defaultOpen: boolean;
  onOpen: (taskId: string) => void;
  onNewTask: (opts?: NewTaskOpts) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rowRef = useRef<HTMLDivElement>(null);
  // Reveal the selected workflow when it becomes active (block:'nearest' → a no-op when already visible).
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  // Clicking the row SELECTS this workflow: open a new task that edits it (menu-style), and expand it so
  // its tasks show. The twist chevron alone toggles collapse (stopPropagation below).
  const select = (): void => { setOpen(true); onNewTask({ baseWorkflow: { project: projectId, workflow: wf.id } }); };
  return (
    <div>
      <div ref={rowRef} className={'tree-row tree-workflow' + (active ? ' active' : '')} onClick={select}>
        <Twist open={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} />
        <span className="tw-name">{wf.name}</span>
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          {/* spec 030: workflow "+" = new task that EDITS this workflow → pre-select the COMPOUND
              {project, workflow} key (the same workflow name can exist in multiple projects). Distinct
              glyph (I.message, a "new build/chat on this workflow") vs the project "+" (I.plus). */}
          <button className="icon-btn" title={tr('newTaskInWorkflow')} onClick={() => onNewTask({ baseWorkflow: { project: projectId, workflow: wf.id } })}><I.message /></button>
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {wf.tasks.length === 0 && <div className="tree-row tree-empty"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noTasksYet')}</span></div>}
          {wf.tasks.map((t) => <TaskRow key={t.id} task={t} activeTask={activeTask} onOpen={onOpen} projectId={projectId} workflowSlug={wf.id} onNewTask={onNewTask} />)}
        </div>
      )}
    </div>
  );
}

function ProjectRow({ project, activeTask, activeProject, activeWorkflow, defaultOpen, onOpen, onNewTask }: {
  project: WireTreeProject;
  activeTask: string | null;
  /** UX: the active/selected project folder — the open build's project or the pre-selected target. */
  activeProject: string | null;
  /** UX: the active/selected workflow as the compound `project/workflow` key (null when none). */
  activeWorkflow: string | null;
  defaultOpen: boolean;
  onOpen: (taskId: string) => void;
  onNewTask: (opts?: NewTaskOpts) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rowRef = useRef<HTMLDivElement>(null);
  const active = project.id === activeProject;
  const isDrafts = project.id === '_drafts';
  // Reveal the selected project when it becomes active — this is what makes a freshly-CREATED project
  // scroll into view + light up the moment createProject pre-targets it (req #2).
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  // Clicking the row SELECTS this project: a from-scratch new task targeting it (menu-style, "start
  // right away"), and expand it. `_drafts` is not a real target → degrade to a plain new task. The twist
  // chevron alone toggles collapse (stopPropagation below).
  const select = (): void => { setOpen(true); onNewTask(isDrafts ? undefined : { targetProject: project.id }); };
  return (
    <div>
      <div ref={rowRef} className={'tree-row tree-project' + (active ? ' active' : '')} onClick={select}>
        <Twist open={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} />
        <span className="tw-ic"><I.folder /></span>
        <span className="tw-name">{project.name}</span>
        {/* AC #13: project hover shows ONLY "+" (New task) — no gear.
            spec 030: project "+" = from-scratch build that lands in THIS project folder (project.id ===
            the folder). The reserved `_drafts` project is not a real target → degrade to a plain new task. */}
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" title={tr('newTask')} onClick={() => onNewTask(isDrafts ? undefined : { targetProject: project.id })}><I.plus /></button>
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {/* spec 031 S4: a freshly-created project with no workflows just shows an empty tree (no hint row). */}
          {project.workflows.map((wf) => {
            const compound = `${project.id}/${wf.id}`;
            return (
              <WorkflowRow key={wf.id} wf={wf} projectId={project.id} activeTask={activeTask}
                active={activeWorkflow === compound} defaultOpen={defaultOpen || activeWorkflow === compound}
                onOpen={onOpen} onNewTask={onNewTask} />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A status hint for an in-progress build: a parked build shows "gate", a live turn shows "running". */
function activeHint(status: WireTreeTask['status']): string {
  return status === 'awaiting_confirm' ? tr('hintGate') : tr('hintRunning');
}

/** "In progress" section (Lát 6): every non-terminal build, so a parked one is reachable on load and
 *  never stranded. Clicking opens it (reconnects its SSE + gate). The active build keeps the pill.
 *  F1: each row has a hover-× that cancels the build WITHOUT opening it — a parked build dismisses
 *  immediately; a running build (a live turn) confirms first so a turn isn't killed by a stray click. */
function ActiveSection({ active, activeTask, onOpen, onCancel }: {
  active: WireTreeTask[];
  activeTask: string | null;
  onOpen: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}) {
  if (active.length === 0) return null;
  const cancelRow = async (e: JSX.TargetedMouseEvent<HTMLButtonElement>, t: WireTreeTask): Promise<void> => {
    e.stopPropagation();
    const running = t.status !== 'awaiting_confirm'; // running/scaffolding = a live turn → confirm first
    if (running) {
      const ok = await askConfirm({
        title: tr('stopBuildTitle'),
        message: tf('stopBuildMsg', { name: t.name }),
        okLabel: tr('stopBuild'),
        danger: true,
      });
      if (!ok) return;
    }
    onCancel(t.id);
  };
  return (
    <div className="sb-active">
      <div className="tree-row tree-section" style={{ fontSize: 10, letterSpacing: '.06em', color: 'var(--tx-faint)', textTransform: 'uppercase', cursor: 'default' }}>
        {tr('inProgress')}
      </div>
      {active.map((t) => (
        <div key={t.id} className={'tree-row tree-task' + (t.id === activeTask ? ' active' : '')} onClick={() => onOpen(t.id)}>
          <span className="tw-name">{t.name}</span>
          <span className="tw-time">{activeHint(t.status)}</span>
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" title={tr('cancelThisBuild')} onClick={(e) => void cancelRow(e, t)}><I.close /></button>
          </span>
        </div>
      ))}
    </div>
  );
}

export function Sidebar({ collapsed, activeTask, activeProject, activeWorkflow, tree, active, onOpen, onCancel, onNewTask, onNewProject, onAddYaml }: {
  collapsed: boolean;
  activeTask: string | null;
  /** The active/selected project folder (open build's project, or the pre-selected target). */
  activeProject: string | null;
  /** The active/selected workflow as the compound `project/workflow` key. */
  activeWorkflow: string | null;
  tree: WireTreeProject[];
  active: WireTreeTask[];
  onOpen: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onNewTask: (opts?: NewTaskOpts) => void;
  onNewProject: () => void;
  /** spec 070: open the external-YAML intake modal (base OR distill) — the general Projects-header door. */
  onAddYaml: () => void;
  onToggle: () => void;
}) {
  // Default-open the SELECTED project (menu highlight / new-project target), else the one holding the
  // active task, else the first project.
  const taskProjectId = tree.find((p) =>
    p.workflows.some((w) => w.tasks.some((t) => t.id === activeTask))
  )?.id;
  const openProjectId = activeProject ?? taskProjectId ?? tree[0]?.id;

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      <div className="sb-head">
        <span className="sb-title">{tr('projects')}</span>
        <div className="sb-head-actions">
          {/* spec 059: the dev-only rebuild moved here (from the per-task DevPanel) so it's reachable
              from any view. Left of New-project → the latter keeps its right-edge alignment. */}
          {devMode && <RebuildButton />}
          {/* spec 070: the general external-YAML intake door (base OR distill) — was a per-surface link on
              the empty state; now a header action reachable from any view, left of New-project. The
              paperclip matches the modal's own "Choose a .yml file" affordance (clean line-icon; the boxy
              I.yaml glyph read as a mis-sized "YL" chip next to the document icon). */}
          <button className="icon-btn" title={tr('intakeYamlBtn')} aria-label={tr('intakeYamlBtn')} onClick={onAddYaml}><I.paperclip /></button>
          <button className="icon-btn" title={tr('newProject')} onClick={onNewProject}><I.newFile /></button>
        </div>
      </div>

      <button className="sb-newtask" onClick={() => onNewTask()}>
        <I.plus /><span>{tr('newTask')}</span>
      </button>

      <div className="sb-scroll">
        <ActiveSection active={active} activeTask={activeTask} onOpen={onOpen} onCancel={onCancel} />
        {tree.length === 0 && <div className="tree-row"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noProjectsYet')}</span></div>}
        {tree.map((p) => (
          <ProjectRow key={p.id} project={p} activeTask={activeTask}
            activeProject={activeProject} activeWorkflow={activeWorkflow}
            defaultOpen={p.id === openProjectId}
            onOpen={onOpen} onNewTask={onNewTask} />
        ))}
      </div>
    </aside>
  );
}
