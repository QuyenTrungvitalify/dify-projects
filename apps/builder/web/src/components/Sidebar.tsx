/* ============================================================
   Sidebar.tsx — 3-level tree: Project ▸ Workflow ▸ Task (AC #13)
   Live (lat4-ui): fed by GET /api/tree (project.group → projects/
   <slug>/ → .runs task). Project hover shows ONLY "+" (no gear);
   the active task gets the highlight pill. Breadcrumb is static
   (not auto-updated mid-run) — handled in App.
   ============================================================ */
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { I } from './Icon';
import { t as tr, tf } from '../lib/i18n';
import { askConfirm } from '../store';
import type { WireTreeProject, WireTreeWorkflow, WireTreeTask } from '../types';

export function Twist({ open, onClick }: { open: boolean; onClick?: JSX.MouseEventHandler<HTMLSpanElement> }) {
  return (
    <span className={'tw-twist' + (open ? ' open' : '')} onClick={onClick}>
      <I.chevron />
    </span>
  );
}

function TaskRow({ task, activeTask, onOpen }: {
  task: WireTreeTask;
  activeTask: string | null;
  onOpen: (taskId: string) => void;
}) {
  const active = task.id === activeTask;
  return (
    <div className={'tree-row tree-task' + (active ? ' active' : '')} onClick={() => onOpen(task.id)}>
      <span className="tw-name">{task.name}</span>
      <span className="tw-time">{task.time}</span>
    </div>
  );
}

function WorkflowRow({ wf, activeTask, defaultOpen, onOpen, onNewTask }: {
  wf: WireTreeWorkflow;
  activeTask: string | null;
  defaultOpen: boolean;
  onOpen: (taskId: string) => void;
  onNewTask: (slug: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="tree-row tree-workflow" onClick={() => setOpen((o) => !o)}>
        <Twist open={open} />
        <span className="tw-name">{wf.name}</span>
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" title={tr('newTaskInWorkflow')} onClick={() => onNewTask(wf.id)}><I.plus /></button>
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {wf.tasks.length === 0 && <div className="tree-row tree-empty"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noTasksYet')}</span></div>}
          {wf.tasks.map((t) => <TaskRow key={t.id} task={t} activeTask={activeTask} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

function ProjectRow({ project, activeTask, defaultOpen, onOpen, onNewTask }: {
  project: WireTreeProject;
  activeTask: string | null;
  defaultOpen: boolean;
  onOpen: (taskId: string) => void;
  onNewTask: (slug: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="tree-row tree-project" onClick={() => setOpen((o) => !o)}>
        <Twist open={open} />
        <span className="tw-ic"><I.folder /></span>
        <span className="tw-name">{project.name}</span>
        {/* AC #13: project hover shows ONLY "+" (New task) — no gear */}
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" title={tr('newTask')} onClick={() => onNewTask(project.workflows[0]?.id ?? '')}><I.plus /></button>
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {project.workflows.map((wf) => (
            <WorkflowRow key={wf.id} wf={wf} activeTask={activeTask} defaultOpen={defaultOpen}
              onOpen={onOpen} onNewTask={onNewTask} />
          ))}
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

export function Sidebar({ collapsed, activeTask, tree, active, onOpen, onCancel, onNewTask, onNewProject }: {
  collapsed: boolean;
  activeTask: string | null;
  tree: WireTreeProject[];
  active: WireTreeTask[];
  onOpen: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onNewTask: () => void;
  onNewProject: () => void;
  onToggle: () => void;
}) {
  // Default-open the project that holds the active task (or the first project).
  const activeProjectId = tree.find((p) =>
    p.workflows.some((w) => w.tasks.some((t) => t.id === activeTask))
  )?.id ?? tree[0]?.id;

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      <div className="sb-head">
        <span className="sb-title">{tr('projects')}</span>
        <div className="sb-head-actions">
          <button className="icon-btn" title={tr('newProject')} onClick={onNewProject}><I.newFile /></button>
        </div>
      </div>

      <button className="sb-newtask" onClick={onNewTask}>
        <I.plus /><span>{tr('newTask')}</span>
      </button>

      <div className="sb-scroll">
        <ActiveSection active={active} activeTask={activeTask} onOpen={onOpen} onCancel={onCancel} />
        {tree.length === 0 && <div className="tree-row"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noProjectsYet')}</span></div>}
        {tree.map((p) => (
          <ProjectRow key={p.id} project={p} activeTask={activeTask} defaultOpen={p.id === activeProjectId}
            onOpen={onOpen} onNewTask={() => onNewTask()} />
        ))}
      </div>
    </aside>
  );
}
