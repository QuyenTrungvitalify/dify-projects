/* ============================================================
   Sidebar.tsx — 3-level tree: Project ▸ Workflow ▸ Task (AC #13)
   Ported from sidebar.jsx. Project hover shows only "+"; the
   active task gets the highlight pill (CSS .tree-task.active).
   ============================================================ */
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { I } from './Icon';
import type { TreeProject, TreeWorkflow, TreeTask } from '../types';

export function Twist({ open, onClick }: { open: boolean; onClick?: JSX.MouseEventHandler<HTMLSpanElement> }) {
  return (
    <span className={'tw-twist' + (open ? ' open' : '')} onClick={onClick}>
      <I.chevron />
    </span>
  );
}

function TaskRow({ task, activeTask, onOpen }: {
  task: TreeTask;
  activeTask: string | null;
  onOpen: (task: TreeTask) => void;
}) {
  const active = task.id === activeTask;
  return (
    <div className={'tree-row tree-task' + (active ? ' active' : '')}
      onClick={() => onOpen(task)}
    >
      <span className="tw-name">{task.name}</span>
      <span className="tw-time">{task.time}</span>
    </div>
  );
}

function WorkflowRow({ wf, activeTask, onOpen }: {
  wf: TreeWorkflow;
  activeTask: string | null;
  onOpen: (task: TreeTask) => void;
}) {
  const [open, setOpen] = useState(wf.open);
  return (
    <div>
      <div className="tree-row tree-workflow" onClick={() => setOpen((o) => !o)}>
        <Twist open={open} />
        <span className="tw-name">{wf.name}</span>
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" title="New task in this workflow"><I.plus /></button>
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {wf.tasks.map((t) => (
            <TaskRow key={t.id} task={t} activeTask={activeTask} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectRow({ project, activeTask, onOpen }: {
  project: TreeProject;
  activeTask: string | null;
  onOpen: (task: TreeTask) => void;
}) {
  const [open, setOpen] = useState(project.open);
  return (
    <div>
      <div className="tree-row tree-project" onClick={() => setOpen((o) => !o)}>
        <Twist open={open} />
        <span className="tw-ic"><I.folder /></span>
        <span className="tw-name">{project.name}</span>
        {/* per brief: project hover shows ONLY "+" */}
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" title="New workflow"><I.plus /></button>
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {project.workflows.map((wf) => (
            <WorkflowRow key={wf.id} wf={wf} activeTask={activeTask} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed, activeTask, tree, onOpen, onNewTask, onNewProject }: {
  collapsed: boolean;
  activeTask: string | null;
  tree: TreeProject[];
  onOpen: (task: TreeTask) => void;
  onNewTask: () => void;
  onNewProject: () => void;
  onToggle: () => void;
}) {
  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      <div className="sb-head">
        <span className="sb-title">Projects</span>
        <div className="sb-head-actions">
          <button className="icon-btn" title="Filter"><I.filter /></button>
          <button className="icon-btn" title="New project" onClick={onNewProject}><I.newFile /></button>
        </div>
      </div>

      <button className="sb-newtask" onClick={onNewTask}>
        <I.plus /><span>New task</span>
      </button>

      <div className="sb-scroll">
        {tree.map((p) => (
          <ProjectRow key={p.id} project={p} activeTask={activeTask} onOpen={onOpen} />
        ))}
      </div>

      <div className="sb-foot">
        <div className="tree-row">
          <span className="tw-ic"><I.gear /></span>
          <span className="tw-name">Settings</span>
        </div>
      </div>
    </aside>
  );
}
