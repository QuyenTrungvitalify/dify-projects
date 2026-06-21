/* ============================================================
   sidebar.jsx — 3-level tree: Project ▸ Workflow ▸ Task
   ============================================================ */
const { useState } = React;

function Twist({ open, onClick }) {
  return (
    <span className={"tw-twist" + (open ? " open" : "")} onClick={onClick}>
      <I.chevron />
    </span>
  );
}

function TaskRow({ task, activeTask, onOpen }) {
  const active = task.id === activeTask;
  return (
    <div className={"tree-row tree-task" + (active ? " active" : "")}
         onClick={() => onOpen(task)}>
      <span className="tw-name">{task.name}</span>
      <span className="tw-time">{task.time}</span>
    </div>
  );
}

function WorkflowRow({ wf, activeTask, onOpen }) {
  const [open, setOpen] = useState(wf.open);
  return (
    <div>
      <div className="tree-row tree-workflow" onClick={() => setOpen(o => !o)}>
        <Twist open={open} />
        <span className="tw-name">{wf.name}</span>
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" title="New task in this workflow"><I.plus /></button>
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {wf.tasks.map(t => (
            <TaskRow key={t.id} task={t} activeTask={activeTask} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectRow({ project, activeTask, onOpen }) {
  const [open, setOpen] = useState(project.open);
  return (
    <div>
      <div className="tree-row tree-project" onClick={() => setOpen(o => !o)}>
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
          {project.workflows.map(wf => (
            <WorkflowRow key={wf.id} wf={wf} activeTask={activeTask} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({ collapsed, activeTask, tree, onOpen, onNewTask, onNewProject, onToggle }) {
  return (
    <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
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
        {tree.map(p => (
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

window.Sidebar = Sidebar;
window.Twist = Twist;
