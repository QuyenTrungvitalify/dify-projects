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
import { workflowRowAction } from '../lib/workflow-row';
import { cancelConfirmCopy } from '../lib/cancel-confirm';
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
      {/* No edit pencil here. It used to run the SAME call as the workflow row's pencil — a new
          conversation on the PARENT workflow, ignoring this task entirely — while sitting on a task
          row where it read as "edit this conversation". That action does exist, but it is "Request a
          fix" on the last card inside the conversation, not a sidebar button. */}
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        <RemoveButton taskId={task.id} name={task.name} />
      </span>
    </div>
  );
}

export function WorkflowRow({ wf, projectId, activeTask, active, reveal, defaultOpen, onOpen, onNewTask }: {
  wf: WireTreeWorkflow;
  projectId: string;
  activeTask: string | null;
  /** UX: this workflow is the active/selected menu node (open build's workflow, or the pre-selected
   *  edit target). Adds the highlight. */
  active: boolean;
  /** Whether becoming `active` should also SCROLL this row into view. Highlighting and revealing are
   *  two different things and were one; see the note on the effect below. */
  reveal: boolean;
  defaultOpen: boolean;
  onOpen: (taskId: string) => void;
  onNewTask: (opts?: NewTaskOpts) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rowRef = useRef<HTMLDivElement>(null);
  // Reveal the selected workflow — but only when `reveal` says the activation was an act of AIMING at
  // this node, not a reflection of which build happens to be open. Opening a running task from 進行中
  // lights its copy down in Build too, and that copy used to drag the whole sidebar to itself: measured,
  // the list jumped 158px under the pointer, moving the row you had just clicked from y=167 to y=9.
  // The highlight is what tells you where the build lives; the scroll was never part of that message.
  // (block:'nearest' → still a no-op when the row is already visible.)
  useEffect(() => {
    if (active && reveal) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active, reveal]);
  // Clicking the row always expands it so its builds show; `workflowRowAction` decides what else —
  // open the sole build, arm a new edit-build, or (a synthetic `(unsaved)` group) nothing at all.
  // The reasoning for each branch lives with the helper. The twist chevron alone toggles collapse
  // (stopPropagation below); a synthetic row also hides the edit/delete actions, while its tasks
  // stay openable and keep their own × via TaskRow.
  const select = (): void => {
    setOpen(true);
    const act = workflowRowAction(wf);
    if (act.kind === 'open') onOpen(act.taskId);
    else if (act.kind === 'newTask') onNewTask({ baseWorkflow: { project: projectId, workflow: wf.id } });
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
              (I.edit) vs the project "+" (I.plus). Labelled "Edit in a new conversation", not "New task":
              it is technically a new task, but what the user is doing is EDITING an existing workflow,
              and the old label hid that — it read as "start something from scratch here". */}
          <button className="icon-btn" title={tr('editThisWorkflow')} onClick={() => onNewTask({ baseWorkflow: { project: projectId, workflow: wf.id } })}><I.edit /></button>
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
          {wf.tasks.map((t) => <TaskRow key={t.id} task={t} activeTask={activeTask} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

function ProjectRow({ project, activeTask, activeProject, activeWorkflow, reveal, defaultOpen, onOpen, onNewTask }: {
  project: WireTreeProject;
  activeTask: string | null;
  /** UX: the active/selected project folder — the open build's project or the pre-selected target. */
  activeProject: string | null;
  /** UX: the active/selected workflow as the compound `project/workflow` key (null when none). */
  activeWorkflow: string | null;
  /** See WorkflowRow: whether activation should scroll, not merely highlight. Passed on to the
   *  workflows inside, so a project and its workflows never disagree about it. */
  reveal: boolean;
  defaultOpen: boolean;
  onOpen: (taskId: string) => void;
  onNewTask: (opts?: NewTaskOpts) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rowRef = useRef<HTMLDivElement>(null);
  const active = project.id === activeProject;
  const isDrafts = project.id === '_drafts';
  // Reveal the selected project when it becomes active — this is what makes a freshly-CREATED project
  // scroll into view + light up the moment createProject pre-targets it (req #2). `reveal` is what keeps
  // that case working while the OTHER way a project lights up — a build being open inside it — no longer
  // scrolls: that one is a reflection, not a request.
  useEffect(() => {
    if (active && reveal) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active, reveal]);
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
                active={activeWorkflow === compound} reveal={reveal}
                defaultOpen={defaultOpen || activeWorkflow === compound}
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
 *  F1: each row has a hover-× that cancels the build WITHOUT opening it. It ALWAYS confirms first —
 *  the × is a terminal /cancel, not a "hide this row", and a parked build used to die on a single stray
 *  click. Only the copy differs: a live turn says a turn will be stopped, a parked one says what survives. */
function ActiveSection({ active, activeTask, onOpen, onCancel }: {
  active: WireTreeTask[];
  activeTask: string | null;
  onOpen: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}) {
  if (active.length === 0) return null;
  const cancelRow = async (e: JSX.TargetedMouseEvent<HTMLButtonElement>, t: WireTreeTask): Promise<void> => {
    e.stopPropagation();
    const copy = cancelConfirmCopy(t.status);
    const ok = await askConfirm({
      title: tr(copy.titleKey),
      message: tf(copy.msgKey, { name: t.name }),
      okLabel: tr(copy.okKey),
      danger: true,
    });
    if (!ok) return;
    onCancel(t.id);
  };
  return (
    <div className="sb-active">
      {/* Same heading card as Chat / 蒸留 / Build, minus the "+" — nothing is added here directly, so
          it is a plain div rather than a button. It used to be a bare 10px uppercase label sitting at
          the far left while every other heading was a card 36px in, which is what made this block read
          as belonging to a different design. */}
      <div className="sb-section-btn sb-section-static">
        <span className="sb-section-label"><I.clock />{tr('inProgress')}</span>
      </div>
      <CollapsibleList items={active} render={(t) => (
        <div key={t.id} className={'tree-row tree-task tree-flat' + (t.id === activeTask ? ' active' : '')} onClick={() => onOpen(t.id)}>
          {/* The lead glyph the other flat lists have (💬 chat, ✨ distill). It also carries state the
              row's text already names: a live turn spins, a build parked at a gate shows the clock —
              "in progress" covers both, but only one of them is actually working right now. */}
          <span className="tw-ic">
            {t.status === 'awaiting_confirm' ? <I.clock /> : <span className="spin sb-row-spin" />}
          </span>
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
    <div className={'tree-row tree-task tree-flat' + (consult.id === activeTask ? ' active' : '')} onClick={() => onOpen(consult.id)}>
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
    <div className={'tree-row tree-task tree-flat' + (promote.id === activeTask ? ' active' : '')} onClick={() => onOpen(promote.id)}>
      <span className="tw-ic"><I.spark /></span>
      <span className="tw-name">{promote.name}</span>
      <span className="tw-time">{promote.time}</span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        <RemoveButton taskId={promote.id} name={promote.name} />
      </span>
    </div>
  );
}

export function Sidebar({ collapsed, activeTask, activeProject, activeWorkflow, revealActive, tree, active, consults, promotes, onOpen, onCancel, onNewTask, onNewChat, onNewProject, onAddYaml }: {
  collapsed: boolean;
  activeTask: string | null;
  /** The active/selected project folder (open build's project, or the pre-selected target). */
  activeProject: string | null;
  /** The active/selected workflow as the compound `project/workflow` key. */
  activeWorkflow: string | null;
  /**
   * Should the active node be SCROLLED to, or only highlighted?
   *
   * True when the active node was AIMED at — the composer is targeting a project/workflow, which is
   * also the state `createProject` leaves behind, and what makes a new project reveal itself. False
   * when it merely mirrors the build that is open: opening a running task from 進行中 lights its copy
   * in Build as well, and scrolling to that copy yanks the list out from under the click that caused it.
   */
  revealActive: boolean;
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
            active={activeWorkflow === `_drafts/${wf.id}`} reveal={revealActive}
            defaultOpen={activeWorkflow === `_drafts/${wf.id}` || taskProjectId === '_drafts'}
            onOpen={onOpen} onNewTask={onNewTask} />
        )} />

        {/* ④ Project — the named project folders. */}
        <SectionHeader icon={<I.folder />} label={tr('sectionProjects')} addTitle={tr('newProject')} onAdd={onNewProject} />
        {namedProjects.length === 0 && <div className="tree-row tree-empty"><span className="tw-name" style={{ color: 'var(--tx-faint)' }}>{tr('noProjectsYet')}</span></div>}
        <CollapsibleList items={namedProjects} render={(p) => (
          <ProjectRow key={p.id} project={p} activeTask={activeTask}
            activeProject={activeProject} activeWorkflow={activeWorkflow} reveal={revealActive}
            defaultOpen={p.id === openProjectId}
            onOpen={onOpen} onNewTask={onNewTask} />
        )} />
      </div>
    </aside>
  );
}
