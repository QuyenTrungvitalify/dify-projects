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
import { askConfirm, removeTask, removeProject, removeWorkflow } from '../store';
import { devMode } from '../lib/dev';
import { sidebarPageSize, pageList } from '../lib/sidebar-prefs';
import { RebuildButton } from './RebuildButton';
import { UpdateButton } from './UpdateButton';
import { ShelfButton } from './ShelfOverlay';
import { SettingsButton } from './SettingsModal';
import type { WireTreeProject, WireTreeWorkflow, WireTreeTask, NewTaskOpts } from '../types';

export function Twist({ open, onClick }: { open: boolean; onClick?: JSX.MouseEventHandler<HTMLSpanElement> }) {
  return (
    <span className={'tw-twist' + (open ? ' open' : '')} onClick={onClick}>
      <I.chevron />
    </span>
  );
}

/** spec 084 follow-up — the hover "remove" × on a history row (Chat / Distill / Build / Project). Confirms
 *  (destructive: permanently deletes the task record), then `removeTask`. Stops propagation so it never
 *  opens the row. Placed inside a `.row-actions` span (hover-revealed, like the edit affordance). */
function RemoveButton({ taskId, name }: { taskId: string; name: string }) {
  const onClick = async (e: JSX.TargetedMouseEvent<HTMLButtonElement>): Promise<void> => {
    e.stopPropagation();
    const ok = await askConfirm({
      title: tr('removeTaskTitle'),
      message: tf('removeTaskMsg', { name }),
      okLabel: tr('removeTaskOk'),
      danger: true,
    });
    if (ok) void removeTask(taskId);
  };
  return (
    <button className="icon-btn" title={tr('removeTask')} aria-label={tr('removeTask')} onClick={(e) => void onClick(e)}>
      <I.close />
    </button>
  );
}

/** spec 084 follow-up — the WorkflowRow × : confirm (names the workflow + build count), then permanently
 *  delete this workflow. Works in `_drafts` (clear a junk build) and in named projects alike. */
async function confirmRemoveWorkflow(projectId: string, wf: WireTreeWorkflow): Promise<void> {
  const ok = await askConfirm({
    title: tr('removeWorkflowTitle'),
    message: tf('removeWorkflowMsg', { name: wf.name, n: wf.tasks.length }),
    okLabel: tr('removeWorkflowOk'),
    danger: true,
  });
  if (ok) void removeWorkflow(projectId, wf.id);
}

/** spec 084 follow-up — the ProjectRow × : a STRONG confirm (names the project + workflow count + that it's
 *  irreversible), then permanently deletes the whole project. Named projects only (never `_drafts`). */
async function confirmRemoveProject(project: WireTreeProject): Promise<void> {
  const ok = await askConfirm({
    title: tr('removeProjectTitle'),
    message: tf('removeProjectMsg', { name: project.name, n: project.workflows.length }),
    okLabel: tr('removeProjectOk'),
    danger: true,
  });
  if (ok) void removeProject(project.id);
}

function TaskRow({ task, activeTask, onOpen, projectId, workflowSlug, synthetic, onNewTask }: {
  task: WireTreeTask;
  activeTask: string | null;
  onOpen: (taskId: string) => void;
  projectId: string;
  workflowSlug: string;
  /** Spec 090 S2: parent row is the synthetic `(unsaved)` group — its slug is NOT a real workflow,
   *  so the edit-shortcut (which would arm that phantom as the base) is hidden. × stays. */
  synthetic?: boolean;
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
        {!synthetic && (
          <button className="icon-btn" title={tr('editThisWorkflow')} onClick={() => onNewTask({ baseWorkflow: { project: projectId, workflow: workflowSlug } })}><I.edit /></button>
        )}
        <RemoveButton taskId={task.id} name={task.name} />
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
  // Spec 090 S2: a `synthetic` row (the `(unsaved)` bucket) is a DISPLAY group, not a workflow —
  // clicking it used to silently arm the composer with the phantom target `_drafts/(unsaved)`,
  // whose build died deterministically at ② (`artifact missing`; the field bundle + repro
  // 1785916628346). For it, click = expand only; the edit/delete actions are hidden (its tasks
  // remain openable, and each still has its own × via TaskRow).
  const select = (): void => {
    setOpen(true);
    if (!wf.synthetic) onNewTask({ baseWorkflow: { project: projectId, workflow: wf.id } });
  };
  return (
    <div>
      <div ref={rowRef} className={'tree-row tree-workflow' + (active ? ' active' : '')} onClick={select}
        title={wf.synthetic ? tr('unsavedGroupHint') : undefined}>
        <Twist open={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} />
        <span className="tw-name">{wf.name}</span>
        {!wf.synthetic && (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          {/* spec 030: workflow "+" = new task that EDITS this workflow → pre-select the COMPOUND
              {project, workflow} key (the same workflow name can exist in multiple projects). Edit glyph
              (I.edit, "edit this workflow") vs the project "+" (I.plus). */}
          <button className="icon-btn" title={tr('newTaskInWorkflow')} onClick={() => onNewTask({ baseWorkflow: { project: projectId, workflow: wf.id } })}><I.edit /></button>
          {/* spec 084 follow-up — permanently delete this workflow (folder + its builds). The Build/`_drafts`
              rows are workflows, so this is the "delete a junk build" ×. */}
          <button className="icon-btn" title={tr('removeWorkflow')} aria-label={tr('removeWorkflow')}
            onClick={() => void confirmRemoveWorkflow(projectId, wf)}><I.close /></button>
        </span>
        )}
      </div>
      {open && (
        <div className="tree-children">
          {wf.tasks.length === 0 && <div className="tree-row tree-empty"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noTasksYet')}</span></div>}
          {wf.tasks.map((t) => <TaskRow key={t.id} task={t} activeTask={activeTask} onOpen={onOpen} projectId={projectId} workflowSlug={wf.id} synthetic={wf.synthetic} onNewTask={onNewTask} />)}
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
          {/* spec 084 follow-up — permanently delete this whole project (folder + all builds). Named
              projects only; the reserved `_drafts` scratch home is never deletable. */}
          {!isDrafts && (
            <button className="icon-btn" title={tr('removeProject')} aria-label={tr('removeProject')}
              onClick={() => void confirmRemoveProject(project)}><I.close /></button>
          )}
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
      <CollapsibleList items={active} render={(t) => (
        <div key={t.id} className={'tree-row tree-task' + (t.id === activeTask ? ' active' : '')} onClick={() => onOpen(t.id)}>
          <span className="tw-name">{t.name}</span>
          <span className="tw-time">{activeHint(t.status)}</span>
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" title={tr('cancelThisBuild')} onClick={(e) => void cancelRow(e, t)}><I.close /></button>
          </span>
        </div>
      )} />
    </div>
  );
}

/** spec 084 (follow-up) — a collapsible sibling list: shows the first `sidebarPageSize` rows, then a
 *  "Show N more" / "Show less" toggle (the Nexus load-more pattern). Applied to EVERY sidebar section so a
 *  long list never floods the panel. `render` returns keyed rows; the count is a client pref (⚙ modal). */
function CollapsibleList<T,>({ items, render }: { items: T[]; render: (item: T) => JSX.Element }) {
  const [expanded, setExpanded] = useState(false);
  const { shown, overflow } = pageList(items, sidebarPageSize.value, expanded);
  return (
    <>
      {shown.map(render)}
      {overflow > 0 && (
        <button className="sb-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? tr('sbShowLess') : tf('sbShowMore', { n: overflow })}
        </button>
      )}
    </>
  );
}

/** spec 082 §4.5 rev — a section header rendered as a BUTTON (the チャット style): an icon + label so the
 *  block is self-identifying, and a trailing "+" so "add new of this kind" is one obvious click. Used for
 *  the Chat / Build / Project sections (NOT 進行中, which is a live-state list with nothing to add). */
function SectionHeader({ icon, label, addTitle, onAdd }: {
  icon: JSX.Element;
  label: string;
  addTitle: string;
  onAdd: () => void;
}) {
  return (
    <button className="sb-section-btn" onClick={onAdd} title={addTitle} aria-label={addTitle}>
      <span className="sb-section-label">{icon}{label}</span>
      <I.plus className="sb-section-plus" />
    </button>
  );
}

/** spec 082 §4.5 rev — one consult chat row (the Chat section body). */
function ConsultRow({ consult, activeTask, onOpen }: {
  consult: WireTreeTask;
  activeTask: string | null;
  onOpen: (taskId: string) => void;
}) {
  return (
    <div className={'tree-row tree-task' + (consult.id === activeTask ? ' active' : '')} onClick={() => onOpen(consult.id)}>
      <span className="tw-ic"><I.message /></span>
      <span className="tw-name">{consult.name}</span>
      <span className="tw-time">{consult.time}</span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        <RemoveButton taskId={consult.id} name={consult.name} />
      </span>
    </div>
  );
}

/** spec 084 S1.5 — one distill/promote task row (the 蒸留 section body). Mirrors {@link ConsultRow}. */
function PromoteRow({ promote, activeTask, onOpen }: {
  promote: WireTreeTask;
  activeTask: string | null;
  onOpen: (taskId: string) => void;
}) {
  return (
    <div className={'tree-row tree-task' + (promote.id === activeTask ? ' active' : '')} onClick={() => onOpen(promote.id)}>
      <span className="tw-ic"><I.spark /></span>
      <span className="tw-name">{promote.name}</span>
      <span className="tw-time">{promote.time}</span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        <RemoveButton taskId={promote.id} name={promote.name} />
      </span>
    </div>
  );
}

export function Sidebar({ collapsed, activeTask, activeProject, activeWorkflow, tree, active, consults, promotes, onOpen, onCancel, onNewTask, onNewChat, onNewProject, onAddYaml }: {
  collapsed: boolean;
  activeTask: string | null;
  /** The active/selected project folder (open build's project, or the pre-selected target). */
  activeProject: string | null;
  /** The active/selected workflow as the compound `project/workflow` key. */
  activeWorkflow: string | null;
  tree: WireTreeProject[];
  active: WireTreeTask[];
  /** spec 082: the consult chats for the Chat section. */
  consults: WireTreeTask[];
  /** spec 084 S1.5: the distill/promote tasks for the 蒸留 section. */
  promotes: WireTreeTask[];
  onOpen: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  /** Start a new BUILD (Build "+" / a workflow-row edit). Opens the empty surface in build mode. */
  onNewTask: (opts?: NewTaskOpts) => void;
  /** spec 082 §4.5 rev: start a new CHAT (Chat "+"). Opens the empty surface in consult mode. */
  onNewChat: () => void;
  onNewProject: () => void;
  /** spec 070: open the external-YAML intake modal (base OR distill) — the general header door. */
  onAddYaml: () => void;
  onToggle: () => void;
}) {
  // spec 082 §4.5 rev: split the tree into the loose-builds home (`_drafts` → the "Build" section) and
  // the named projects (the "Project" section). `_drafts` always leads buildTree, so this is a clean
  // partition. The Build section flattens `_drafts`'s workflows directly under its header — the section
  // header REPLACES the old nested "Drafts" folder row.
  const draftsProject = tree.find((p) => p.id === '_drafts');
  const namedProjects = tree.filter((p) => p.id !== '_drafts');

  // Default-open the SELECTED project (menu highlight / target), else the one holding the active task,
  // else the first NAMED project.
  const taskProjectId = tree.find((p) =>
    p.workflows.some((w) => w.tasks.some((t) => t.id === activeTask))
  )?.id;
  const openProjectId = activeProject ?? taskProjectId ?? namedProjects[0]?.id;

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      <div className="sb-head">
        <span className="sb-title">{tr('appName')}</span>
        <div className="sb-head-actions">
          {/* ONE reload button, never two. They look identical (same ⟳ glyph) but do different things:
              Update pulls main + npm install + build + restart; Rebuild only rebuilds the code already on
              disk. On a dev machine the pull is the WRONG one — it would checkout main over the branch
              being worked on — and a dev pulls from a terminal anyway, so dev mode shows Rebuild alone.
              Everyone else keeps Update, which is the only one that can reach new code without a terminal. */}
          {devMode ? <RebuildButton /> : <UpdateButton collapsed={collapsed} />}
          {devMode && <ShelfButton />}
          {devMode && <SettingsButton />}
          {/* spec 084 follow-up: the external-YAML intake door moved to the 蒸留 section's "+" (add new =
              distill a YAML), so the redundant header paperclip is dropped. `onAddYaml` is wired there. */}
        </div>
      </div>

      <div className="sb-scroll">
        {/* ① 進行中 — a live-state list; a plain label with no "+" (nothing to add here directly). */}
        <ActiveSection active={active} activeTask={activeTask} onOpen={onOpen} onCancel={onCancel} />

        {/* ② Chat */}
        <SectionHeader icon={<I.message />} label={tr('sectionChat')} addTitle={tr('newChat')} onAdd={onNewChat} />
        {consults.length === 0 && <div className="tree-row tree-empty"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noChatsYet')}</span></div>}
        <CollapsibleList items={consults} render={(c) => <ConsultRow key={c.id} consult={c} activeTask={activeTask} onOpen={onOpen} />} />

        {/* ②.5 蒸留 (spec 084 S1.5) — the distill/promote task history. ALWAYS shown (even when empty) so
            its "+" = the external-YAML intake door is always reachable (it replaced the header paperclip). */}
        <SectionHeader icon={<I.spark />} label={tr('sectionDistill')} addTitle={tr('intakeYamlBtn')} onAdd={onAddYaml} />
        {promotes.length === 0 && <div className="tree-row tree-empty"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noDistillsYet')}</span></div>}
        <CollapsibleList items={promotes} render={(p) => <PromoteRow key={p.id} promote={p} activeTask={activeTask} onOpen={onOpen} />} />

        {/* ③ Build — the loose builds (`_drafts`), flattened under this header. */}
        <SectionHeader icon={<I.sliders />} label={tr('sectionBuild')} addTitle={tr('newBuild')} onAdd={() => onNewTask()} />
        {(!draftsProject || draftsProject.workflows.length === 0) && <div className="tree-row tree-empty"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noBuildsYet')}</span></div>}
        <CollapsibleList items={draftsProject?.workflows ?? []} render={(wf) => (
          <WorkflowRow key={wf.id} wf={wf} projectId="_drafts" activeTask={activeTask}
            active={activeWorkflow === `_drafts/${wf.id}`}
            defaultOpen={activeWorkflow === `_drafts/${wf.id}` || taskProjectId === '_drafts'}
            onOpen={onOpen} onNewTask={onNewTask} />
        )} />

        {/* ④ Project — the named project folders. */}
        <SectionHeader icon={<I.folder />} label={tr('sectionProjects')} addTitle={tr('newProject')} onAdd={onNewProject} />
        {namedProjects.length === 0 && <div className="tree-row tree-empty"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noProjectsYet')}</span></div>}
        <CollapsibleList items={namedProjects} render={(p) => (
          <ProjectRow key={p.id} project={p} activeTask={activeTask}
            activeProject={activeProject} activeWorkflow={activeWorkflow}
            defaultOpen={p.id === openProjectId}
            onOpen={onOpen} onNewTask={onNewTask} />
        )} />
      </div>
    </aside>
  );
}
