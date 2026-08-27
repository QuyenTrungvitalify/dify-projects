/* ============================================================
   i18n.ts — UI-chrome localization (EN ⇆ JA), client-side only.
   Same pattern as the theme toggle: a @preact/signals signal +
   localStorage, no server involvement. Components read strings via
   t()/tf(), which read `lang.value` during render → they auto-
   subscribe and re-render on a language switch.

   SCOPE (v1): fixed UI strings only. LLM/tool-generated content —
   the streamed run output, SPEC.md, YAML, diff, report details,
   error/lint lines — stays in whatever language the build produced
   (out of scope; that needs a prompt/server change).

   EN values are byte-identical to the original hardcoded strings,
   so English behavior (and the string-asserting unit tests) is
   unchanged; only `ja` adds a second column.
   ============================================================ */
import { signal } from '@preact/signals';
import type { PhaseKey } from '../types';

export type Lang = 'en' | 'ja';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'en' || saved === 'ja') return saved;
  } catch {
    /* ignore */
  }
  return 'en';
}

export const lang = signal<Lang>(initialLang());

export function setLang(l: Lang): void {
  lang.value = l;
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* ignore */
  }
}

type Dict = Record<string, string>;

const EN: Dict = {
  /* chat-top / shell */
  newTask: 'New task',
  toggleSidebar: 'Toggle sidebar',
  stop: 'Stop',
  stopRunningBuild: 'Stop the running build',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  artifact: 'Artifact',
  exportRun: 'Export',
  exportRunHint: 'Download a zip that explains this run — dossier, artifacts, per-phase transcripts (prompt + tools), timeline, and your attachments',
  // spec 062 follow-up — "Export to Drive": upload the same dossier straight to the team Drive (exports/).
  exportDownload: 'Download zip',
  exportingDrive: 'Exporting…',
  exportDrive: 'Export to Drive',
  exportDriveHint: 'Upload this run dossier straight to the team Drive (exports/). No team Drive set up → downloads instead.',
  exportDriveDoneTitle: 'Uploaded to Drive',
  exportDriveDoneMsg: 'The run dossier is in the team Drive at {path}.',
  exportDriveUnconfirmedTitle: 'Sent to Drive (unconfirmed)',
  exportDriveUnconfirmedMsg: 'The upload reached Google but it didn’t return a confirmation (a known Apps Script quirk). The file has almost certainly landed — check the exports/ folder in the team Drive to be sure.',
  exportNoDriveTitle: 'Downloaded instead',
  exportNoDriveMsg: 'No team Drive is configured (set the drop URL/secret in ⚙ Settings › Share) — the dossier zip was downloaded to this machine instead.',
  gotIt: 'Got it',
  /* the ⚙ header menu (PrefsMenu) — UI language, reply language and theme in one dropdown */
  prefs: 'Settings',
  prefsUiLang: 'Interface',
  prefsReplyLang: 'Reply language',
  prefsTheme: 'Theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  /* spec 088 — phase-completion notifications (header bell + tab badge) */
  notifyToggle: 'Phase-completion notifications',
  notifyEnableHint: 'Notify when a phase finishes (browser notification while this tab is hidden)',
  notifyDisableHint: 'Phase notifications are on — click to turn off',
  notifyBlockedHint: 'Notifications are blocked by the browser — allow them for this site in the browser settings',
  notifGate: '{phase} finished — ready for review',
  notifDone: 'Build finished',
  notifError: 'Build failed',
  notifAnswer: 'Answer ready',
  notifyNudgeText: 'A build is running — enable notifications to know the moment a phase finishes.',
  // spec 104 S1: the auto-mode variant. Deliberately the ACCOUNT's voice, not this build's — a usage
  // limit is account-wide, so it stops every build and every question, not just this one (spec 104 §7 Q4).
  notifyNudgeAutoText: 'Auto mode runs all four steps without stopping. Enable notifications to know when it finishes — or stops early, like when this account hits its usage limit.',
  notifyNudgeEnable: 'Enable notifications',
  notifyNudgeDismiss: 'Don’t show again',
  notifyTip: 'Ping when a phase is done',
  // user-facing update & restart (the in-app scripts/update-and-run.command)
  updateBtnHint: 'Update — pull the latest code, rebuild, and restart the app',
  updateConfirmTitle: 'Update the app?',
  updateConfirmMsg: 'Pulls the latest code, rebuilds, and restarts. This takes a few minutes; builds can’t run during the update.',
  updateRunning: 'Updating… (this can take a few minutes)',
  updateRestarting: 'Restarting… the page reloads when it’s back',
  updateDone: '✓ Updated and restarted',
  updatePullFailed: 'Could not fetch the latest code — contact the admin.',
  updateOnBranch: 'Not updated — this copy is on branch «{branch}», not main, and updating would discard it. Run `git checkout main` first if you want the latest version.',
  updateBuildFailed: 'Build failed — contact the admin.',
  updateBusy: 'A build is running — cancel it first, then update.',
  /* The turn-collision 409, restated in the reader's language. It says the one thing the server's
     English never did: the message is still in the composer. The old wording ("try again in a
     moment") invited exactly the retry that used to strand a copy of the message in the thread. */
  turnBusy:
    'A turn is already running. Your message is still in the composer — stop the running turn, or wait for it to finish.',
  updateTip: 'Update to the latest here',
  /* In-app Claude sign-in. The whole point of this surface is that "not signed in" stops being a
     dead end you can only leave through a terminal, so every string here names the next physical act
     (open the page, copy the code, paste it) rather than the state it is reporting. */
  authTitle: 'Sign in to Claude',
  authWhy:
    'Builds run through the `claude` CLI on this machine, and it is not signed in. You can do it right here — no terminal.',
  authOpenPage: 'Open the sign-in page',
  authOpened: 'A sign-in page should have opened in your browser. Sign in there and this window continues on its own — there is nothing to copy back.',
  authWaiting: 'Waiting for you to finish on the sign-in page…',
  authFallback: 'No page opened? Use this instead — it gives you a code to paste below.',
  authCodeLabel: 'Code from the sign-in page (only if it showed you one)',
  authSubmit: 'Finish signing in',
  authStarting: 'Preparing the sign-in page…',
  authExchanging: 'Signing in…',
  authDone: '✓ Signed in — send your message again',
  authFailed: 'That code was not accepted. Open the page again and copy a fresh one.',
  authCliMissing: 'The `claude` CLI is not installed on this machine — contact the admin.',
  authStartFailed: 'Could not start the sign-in.',
  authRetry: 'Start again',
  /* The signed-out 409 on a send. Like `turnBusy`, it exists to say the thing the server's English
     cannot: the message was not lost. */
  authNeeded:
    'Not signed in to Claude. Your message is still in the composer — sign in, then send it again.',
  /* The language the MODEL answers in — distinct from the toggle above, which is the UI chrome's own
     language. Kept apart on purpose: a Japanese-chrome user may still want replies in Vietnamese. */
  chatLangAuto: 'Auto',
  chatLangHint: 'Reply language: {name} (the workflow itself keeps the requirement’s language)',
  chatLangAutoName: 'follow what you write',

  /* empty / new-task surface */
  phDescribeWorkflow: 'Describe the workflow or change…',
  /* spec 029: dynamic new-task crumb (pre-selection from the sidebar "+") */
  editingWorkflow: 'Editing {name}',
  newTaskInProjectName: 'New task in {name}',
  clearPreselection: 'Clear — start a plain new task',
  runContextHint: 'Where this build lands',
  // spec 051-followup: the run-crumb "running with a base" badge (edit-existing / Dify-seed builds).
  baseLabel: 'base:',
  runningWithBaseHint: 'Editing an existing workflow as the base — Implement modifies this file',
  seedFrom: 'SEED FROM',
  noSeedApps: 'No seed apps — connect Dify to seed from a workspace app. New workflows start from scratch.',
  // spec 051 D5: import a standalone YAML as a local edit-existing base.
  addYamlAsBase: '＋ Add YAML as base',
  importBaseTitle: 'Add a YAML as a base',
  importBaseHint: 'Upload or paste a workflow YAML. It is validated, then lands as a local base under projects/ that you can edit — the app.name is kept as its display label.',
  importBaseFile: 'Choose a .yml / .yaml file',
  importBasePaste: 'or paste the YAML',
  phPasteYaml: 'app:\n  name: My Workflow\n  ...',
  importBaseName: 'Name (optional)',
  phImportBaseName: 'defaults to the YAML’s app.name',
  importBaseProject: 'Target project (optional)',
  importBaseDrafts: '_drafts — staging (not committed)',
  importBaseSubmit: 'Add base',
  importBaseEmpty: 'Upload or paste a workflow YAML first.',
  importBaseLanded: 'Imported as {workflow} in {project}.',
  importBaseUse: 'Use this base',
  // spec 070: the external-YAML intake modal (base OR distill) + its Projects-header trigger.
  intakeYamlBtn: 'Add external YAML',
  intakeTitle: 'Add external workflow YAML',
  intakeHint: 'Pick what to do with an external workflow YAML, then upload or paste it. It is validated first.',
  intakeActionLabel: 'What to do',
  intakeActionBase: 'Edit as a base',
  intakeActionDistill: 'Distill to shelf',
  intakeBaseHint: 'Lands it in a project as a base, ready for a build that edits it.',
  intakeDistillHint: 'Distills it into a pattern later builds can reuse. A review opens — nothing is saved until you approve it.',
  intakeDistillPath: 'An approved pattern lands in templates/patterns/.',
  intakeSourceLabel: 'Source label (optional)',
  phIntakeSourceLabel: 'where this YAML came from (kept as provenance)',
  intakeLicense: 'License',
  intakeLicenseHint: 'Stamped into the pattern header. Only a permissive license lets this pattern be shared to the team shelf later.',
  intakeDistillSubmit: 'Distill',
  none: 'none',
  try: 'TRY',
  phReplyOrDescribe: 'Reply, or describe another change…',
  phDescribeAnother: 'Describe another change to start a new build…',
  openIt: 'Open it',
  /* spec 099 S2′ — this browser stopped keeping the conversation. Only truthful because S1 (backfill
     from the server transcript) shipped first: the exchanges really do come back on reopen. */
  persistQuota: 'This browser is out of storage, so the conversation is no longer being saved here. Your questions and answers are safe on the server and come back when you reopen this build.',
  persistFailed: 'The conversation could not be saved in this browser. Your questions and answers are safe on the server and come back when you reopen this build.',

  /* stop-build confirm (shared App + Sidebar) */
  stopBuildTitle: 'Stop this build?',
  stopBuildMsg: "Cancel <c>{name}</c>? Its running turn will be stopped and this phase's progress discarded.",
  stopBuild: 'Stop build',
  /* the same × on a build parked at a gate: nothing is running, so the copy names what survives. */
  cancelGateTitle: 'Cancel this build?',
  cancelGateMsg: 'Cancel <c>{name}</c>? It is waiting at a gate — the spec and artifacts so far are kept, and you can restore the build from its conversation.',

  /* destructive gate confirms (spec 016 D4) */
  acceptAnywayTitle: 'Ship a workflow that failed validation?',
  acceptAnywayMsg: 'The linters did not pass after the cap-5 attempts. Accepting marks this build done with the failure recorded — the workflow may not run correctly in Dify.',
  acceptAnywayOk: 'Accept anyway',
  importConfirmTitle: 'Import to your self-hosted Dify?',
  importConfirmMsg: "Push <c>{file}</c> to your Dify workspace. This creates a NEW app — it won't update an existing one.",
  importConfirmOk: 'Import',
  discardTitle: 'Discard this build?',
  discardMsg: 'Abandon this build. The spec and any artifacts so far stay on disk, but the build is closed.',
  discardOk: 'Discard build',

  /* phase labels */
  phase_analyze: 'Analyze',
  phase_spec: 'Spec',
  phase_implement: 'Implement',
  phase_test: 'Test',

  /* disclosure */
  running: 'Running',
  stoppedDuring: 'Stopped during',
  distillStep: 'Distillation', // spec 052: a promote task's single turn — not "④ Test"
  working: 'Working…',

  /* gate — meta + per-state copy */
  phaseMeta: 'phase {idx} / 4',
  phaseMeta4: 'phase 4 / 4',
  exit1: 'exit 1',
  gateErrorBadge: 'Phase failed',
  gateErroredTitle: '{phase} errored',
  gateErrorSummary: 'No files were written. Retry re-runs only this phase from the approved input.',
  gateCancelledBadge: 'Cancelled',
  gateCancelledTitle: 'Build abandoned',
  gateCancelledSummary: 'Cancelled by user — the spec/artifacts so far are preserved.',
  restoreBuild: 'Restore build',
  gateDoneBadge: 'Done',
  gateDoneTitle: 'Test passed — workflow updated',
  // spec 105 — a build can now finish `done` with Dify holding an OLDER file: an unattended fix round
  // runs straight through ④, and autonomous builds deliberately skip the Import gate. Saying nothing
  // there means 完了 quietly claims something that is not true of the deployed app.
  // Spec 105 — the phase track's tooltip on a step that never ran (① / ② on an edit of a workflow
  // that already had both an analysis and a spec).
  phaseSkipped: 'Skipped — this workflow already had an analysis and a spec on disk.',
  gateDoneStaleImport: 'Dify still has the version imported at {time}; the workflow has changed since. Importing again sends the current one.',
  gateDoneSummary1: 'Linters re-run on the produced main.yml.',
  gateDoneSummary2: 'Open the report in the panel for the details.',
  gateFailBadge: 'Lint still failing',
  gateFailTitle: 'Still failing after the cap-5 attempts',
  gateFailSummary1: 'The agent self-corrected as far as it could in one turn.',
  gateFailSummary2: 'Your call: accept anyway, keep trying, or abandon.',
  gateAnalyzeBadge: 'Analyze complete',
  gateAnalyzeTitle: 'Ready to write the spec',
  gateAnalyzeSummary1: 'Requirement analyzed.',
  gateAnalyzeSummary2: 'Continue to draft the spec, or request changes.',
  gatePattern: 'Pattern: {pattern}',
  gateSpecBadge: 'Spec ready',
  gateSpecTitle: 'Spec drafted — review before I build',
  gateSpecSummary1: 'SPEC.md is editable in the panel — tweak it before implement (last-writer wins).',
  gateImplBadge: 'Implemented',
  gateImplTitle: 'main.yml built and linted',
  gateImplSummary1: 'Workflow YAML generated; all linters green.',
  gateReadyBadge: 'Ready',
  gateReadyTitle: 'Continue',

  /* spec 094 S1 — the round that changed nothing. Says WHAT happened and WHERE that leaves the user;
     it never says the round was wrong (answering without editing is often the correct answer). The
     model's own explanation of why is already rendered above this line. */
  /* spec 096 — the composer Model chip. The alias values are product names: identical in both
     languages, and they are what the user would type at a CLI, so they stay as-is. */
  model: 'Model',
  model_opus: 'Opus',
  model_sonnet: 'Sonnet',
  model_haiku: 'Haiku',
  model_fable: 'Fable',
  modelUnset: 'not recorded',
  modelHint: 'Which model runs this task. Each option means the newest of that family your environment can reach. You can change it later — it applies from the next step on, and steps already done keep the model they ran on.',
  gateNoChangeBadge: 'No file change',
  gateNoChangeSummary: 'This round did not change the workflow file — the answer above explains why. If you expected an edit, say what should differ and ask again.',
  // spec 103 L0 — the sibling of the line above: that one says the round did nothing, this one says the
  // round did something the spec never learned about. Advisory: the build is fine, the paperwork is not.
  // States the FACT, conditions the conclusion. The earlier wording asserted the spec was now wrong,
  // which is false for a lint fix or a cosmetic YAML edit — changes that legitimately touch nothing the
  // document describes. Worse, SPEC_RECONCILE explicitly tells the turn a no-op is a correct outcome,
  // so the badge was scolding it for obeying. Advisory means advisory: say what was measured, let the
  // human judge whether it matters.
  gateSpecStale: 'The workflow changed but the spec document did not. If this change affects what the workflow does, the spec is now out of date — check it before you rely on it.',
  // spec 103 step 1 — the undo. Wording says what it takes back (a fix ROUND, both files), never
  // "revert the spec": restoring one file without the other is the drift this spec exists to remove.
  // {n} places, because the round's own footprint is the only thing that tells one ③ card from another.
  gateSpecEdits: 'The spec document was updated too — {n} place{s}.',
  // spec 103 Lane B — both are SENDS. No "spec" in the labels: the person deciding may not know what
  // one is, but everyone understands "do it" versus "show me first".
  sendVariants: 'How to send this fix',
  sendFixNow: 'Fix it now',
  sendFixNowSub: 'Makes the change, then shows you the result.',
  sendPlanFirst: 'Show me the plan first',
  sendPlanFirstSub: 'Describes what would change, then you decide. One extra run.',
  gateSpecNoop: 'Nothing in the spec needed changing for that — the workflow was left as it is. Send it as a direct fix if you want the workflow changed anyway.',
  specDraftPending: 'Waiting for your decision at the gate — not saved, not in the workflow',
  specDraftTitle: 'SPEC.md — proposed',
  specDraftNote: 'This is the proposed plan, not the current spec. Nothing is saved until you approve it at the gate.',
  gateProposalBadge: 'Plan',
  gateProposalTitle: 'Here is what I would change',
  gateProposalSummary: 'Nothing has changed yet — the workflow and the spec are untouched until you say go.',
  undoFix: 'Take this fix back',
  undoFixTitle: 'Take this fix back?',
  undoFixMsg: 'The workflow file and the spec document both return to how they were before this fix. The conversation stays. Asking for the fix again costs another run.',
  // spec 103 step 1 — the 差分 tab answers one question about two files.
  diffSpecUnchanged: 'This round did not change the spec.',
  diffWorkflowUnchanged: 'This round did not change the workflow file.',
  gateNoChangeImport: 'The file is byte-for-byte the one imported at {time}, so importing again would send Dify what it already has.',

  /* deploy gate — awaiting_import (spec 016 D1) */
  gateImportBadge: 'Ready to deploy',
  gateImportTitle: 'Import {file} to your self-hosted Dify',
  gateImportSummary1: 'Import pushes the linted workflow to your Dify workspace.',
  // The first import of a build creates the app; from then on this build OWNS it and re-imports overwrite
  // it in place (push --app-id). Saying "re-importing duplicates it" was true before that and is the exact
  // sentence a user reads right before clicking Import, so it has to track the real behavior.
  gateImportSummary2: 'Import creates a new Dify app. Later imports from this build update that same app instead of adding another.',
  gateImportSummaryUpdate: 'This updates the Dify app this build already created — same app, same URL, no duplicate. Reload the app in Dify to see the change.',
  gateImportSummary3: 'Skip finishes the build locally without deploying.',
  gateImportSummaryEdit: "You're editing <c>{workflow}</c> — importing still creates a separate new app, not an update to it.",

  /* gate links */
  openSpec: 'open SPEC.md',
  /* Two links, one per file: a diff is a view of ONE document now, so a single "view diff" would have
     to pick a file without saying which. */
  viewSpecDiff: 'spec diff',
  viewWorkflowDiff: 'workflow diff',
  openReport: 'open report',

  /* gate reply */
  phWhatShouldChange: 'What should change before continuing?',
  cancel: 'Cancel',
  sendRerun: 'Send & re-run',

  /* spec 033/092: the composer's two send actions (ask = Enter/chat button, change = the ✎ pill) */
  modeChange: 'Request changes',
  phAskOrChange: 'Ask a question or request changes…',
  phChangeMode: 'What should change?',
  sendAskTip: 'Send as question (Enter)',
  // The single-button composer (a promote build): there is no question lane to contrast with and no
  // modifier to press, so the tip states what the ONE button does rather than borrowing the two-button
  // wording — which would promise a shortcut that does nothing here.
  sendChangeOnlyTip: 'Every message here is sent as a change request',
  sendChangeTip: 'Send as change request (⌘Enter / Ctrl+Enter) — re-runs the phase with your instruction',
  /* the send button's label: next to the change pill it must say WHAT it sends (a bare "Send" there
     would read as the submit for an armed "Request changes", re-creating the old mode-toggle trap). */
  sendAskBtn: 'Send question',
  sendBtn: 'Send',
  qaAnswered: 'Answered',
  qaAnswering: 'Answering…',
  // spec 034: terminal (done/cancelled) Ask composer placeholder + the fresh-seed "sources" caption.
  phAskAboutBuild: 'Ask about this build…',
  qaSeededFrom: 'Based on: {sources}',
  /* spec 082: consult mode (chat-first) — the entry Mode chip, section, placeholders, graduate. */
  consultChat: 'Chat',
  consultSection: 'Chats',
  /* spec 082 §4.5 rev: the sidebar's four sections — each (except In progress) a button-header with a "+". */
  sectionChat: 'Chat',
  sectionBuild: 'Build',
  sectionProjects: 'Projects',
  sectionDistill: 'Distill', // spec 084 S1.5 — the promote/distill task section
  sbShowMore: 'Show {n} more', // spec 084 follow-up — sidebar section load-more
  sbShowLess: 'Show less',
  removeTask: 'Remove', // spec 084 follow-up — the sidebar row-× (permanent delete)
  removeTaskTitle: 'Remove this task?',
  removeTaskMsg: 'Permanently delete “{name}” and its record. This cannot be undone.',
  removeTaskOk: 'Remove',
  removeProject: 'Delete project', // spec 084 follow-up — the ProjectRow × (permanent, cascades)
  removeProjectTitle: 'Delete this whole project?',
  removeProjectMsg: 'Permanently delete “{name}” — all {n} workflow(s) inside it and every build. This cannot be undone.',
  removeProjectOk: 'Delete project',
  removeWorkflow: 'Delete workflow', // spec 084 follow-up — the WorkflowRow × (permanent, cascades its builds)
  removeWorkflowTitle: 'Delete this workflow?',
  removeWorkflowMsg: 'Permanently delete “{name}” and its {n} build(s). This cannot be undone.',
  removeWorkflowOk: 'Delete workflow',

  newChat: 'New chat',
  newBuild: 'New build',
  appName: 'Builder',
  phConsult: 'Ask anything — or drop a .yml file to talk it over…',
  phConsultChat: 'Keep the conversation going…',
  newConsultDesc: 'Ask questions about Dify or your use case. We can build it later.',
  graduateBtn: 'Start build from chat',
  graduateHint: 'Summarize this conversation into a requirement and prefill a new build',
  graduatePromptText: 'Summarize our conversation so far into one complete, self-contained requirement for building this Dify workflow. Reply with ONLY the requirement text, no preamble, in the language I have been using.',
  confirmDistill: 'Start distillation',
  stopAnswerHint: 'Stop this answer (nothing is written to your files either way)',
  stopConsultAnswer: 'Stop this answer',
  cardTitle: 'Machine check',
  cardLintClean: 'Structure is valid — importable as-is',
  // spec 035: the done/cancelled gate-foot "Edit this workflow" button.
  // It names its COST up front: it opens a NEW conversation (a fresh edit-existing build — new session,
  // empty thread). The cheap in-place path is the composer's ✎ `modeChange` pill, so the two must never
  // read alike.
  // Artifact panel — expand is a panel-level display option (every tab), the contents rail rides with it.
  expandPanel: 'Expand',
  collapsePanel: 'Collapse',
  expandPanelHint: 'Expand the panel to fill the window — adds a contents list for jumping between sections',
  collapsePanelHint: 'Back to the normal panel width (Esc)',
  contents: 'Contents',
  contentsEmpty: 'No sections to jump to',
  editThisWorkflow: 'Edit in a new conversation',
  // The post-import fix loop — the done card's "keep working here" action (arms change-mode → /reply).
  // Short label for the header pill (the tooltip `editThisWorkflowHint` still spells it out). It says
  // "new" because that is the distinction that matters now: this pill leaves the current conversation.
  editWorkflowShort: 'Edit (new)',
  editThisWorkflowHint: 'Open a NEW conversation that edits this workflow. To keep this one going, type the change below and send it with ✎ Request changes instead.',
  // spec 036 D5: the done-state "Run test with workflow" foot action (autonomous builds + self-host creds).
  runTestWithWorkflow: 'Run test with workflow',
  // Discoverability change: the foot action is always shown; clicking it without a self-host target
  // configured surfaces this message (checked in store.liveTest before dispatch).
  liveTestNeedsSelfhost:
    'To run a workflow test, a self-host Dify target must be configured — set the self-host console URL and API key in the backend environment first.',
  // spec 084 — the background distill tray (corner panel).
  trayTitle: 'Distill',
  trayDistilling: 'Distilling {slug}…',
  trayQueued: 'Waiting for the build lane…',
  trayReady: 'Ready to review',
  trayPromoted: 'Promoted {slug}',
  trayShared: 'Shared {slug} to team',
  trayCollision: 'Name already in use: {slug}',
  trayFailed: 'Distill failed',
  trayBlocked: 'Not eligible',
  trayLeakBlocked: 'Cannot share — secret detected',
  trayShareFailed: 'Share to team failed',
  trayTarget: '{target}',
  trayViewReport: 'View report',
  trayDetails: 'Details',
  trayResend: 'Resend',
  trayUndo: 'Undo',
  trayApprove: 'Approve',
  trayOverwrite: 'Overwrite',
  traySaveAsNew: 'Save as new',
  trayShareTeam: 'Share to team',
  trayKeepLocal: 'Keep local',
  trayPush: 'Push to team',
  trayDiscard: 'Discard',
  trayClose: 'Close',
  // hover bubbles on the tray header icons (clearer than the bare labels)
  trayDetailsTip: 'Open this task',
  trayCloseTip: 'Dismiss (cancels if running)',
  trayCloseRunningTitle: 'Stop this distill?',
  trayCloseRunningMsg: 'The distill for “{slug}” has not finished — closing it will cancel it.',
  trayCloseRunningOk: 'Stop distill',
  trayUndone: 'Removed from the shelf',
  // spec 084 (DEV) — the test-distill tray controls (only under ?dev=1 / BUILDER_DEV; the on/off switch
  // lives in the ⚙ Settings modal, literal English there).
  trayTestBadge: 'DEV',
  trayClearTest: 'Clear test ({n})',
  // spec 052 — "Promote to pattern" (the header pill + the promote build's gate cards).
  promoteToPattern: 'Promote to pattern',
  promoteToPatternHint: 'Distill this proven build into a reusable templates/patterns/ pattern (gated by a human review).',
  promoteThreadOpen: 'Promote {project}/{workflow} to a reusable pattern',
  promoteExternalThreadOpen: 'Distill {label} into a reusable pattern',
  openPattern: 'View pattern',
  promoteBlockedBadge: 'Blocked',
  promoteBlockedTitle: 'Not eligible for promotion',
  promoteBlockedSummary: 'This build did not pass the eligibility gate — nothing was distilled or written.',
  promoteDistillFailedBadge: 'Needs work',
  promoteDistillFailedTitle: 'The distilled pattern failed the re-check',
  promoteDistillFailedSummary: 'The distilled output did not pass the linters — request changes to re-run, or discard.',
  promoteReviewBadge: 'Review',
  promoteReviewTitle: 'Review the distilled pattern before it lands',
  promoteReviewSummary: 'Nothing is on the shelf yet — Approve is what writes this pattern to templates/patterns/. Review it first.',
  promoteTargetLine: 'Target: {target}',
  promoteProbeLine: 'Import probe: {probe}',
  promoteDoneBadge: 'Promoted',
  promoteDoneTitle: 'Pattern promoted',
  promoteDoneSummary: 'The pattern landed in templates/patterns/ and the INDEX was rebuilt.',
  promoteErrorTitle: 'Promotion failed',
  promoteCancelledTitle: 'Promotion discarded',
  promoteCancelledSummary: 'Nothing was written to templates/patterns/.',
  /* spec 081 — the post-promote share turn */
  promoteShareOfferTitle: 'Share this pattern with the team?',
  promoteShareOfferSummary: 'It can be pushed to the shared repo for review — nothing is sent until you confirm on the next step.',
  promoteShareReviewBadge: 'Share check',
  promoteShareReviewTitle: 'Review before it leaves this machine',
  promoteShareScanClean: 'Leak scan: clean — nothing credential- or instance-shaped found.',
  promoteShareFindingsLine: 'Leak scan: {n} advisory finding(s) — check each line below before pushing.',
  promoteShareMoreFindings: '…and {n} more finding(s) — open the pattern YAML to review them all.',
  promoteShareDupLine: 'Shelf duplicate check: {dup}.',
  promoteShareLicenseLine: 'Pushing shares this pattern under the MIT license (as stamped in its header).',
  promoteShareFailedLine: 'The push did not go through: {error}',
  promoteSharePushedLine: 'Shared: branch {branch} was pushed — a PR opens automatically and the owner will review it.',
  promoteShareSentLine: 'Shared to the team shelf — the admin will review it and add it to the shared patterns.',
  askAnomalyTitle: 'Ask reverted an unexpected write',
  askAnomalyMsg: 'The Ask turn attempted to write despite the guard — reverted: {files}. Nothing was kept; send it with ✎ Request changes if you want that edit.',
  askAnomalyOk: 'OK',
  askAnomalyKindModified: 'modified, reverted',
  askAnomalyKindCreated: 'created, removed',
  askAnomalyKindDeleted: 'deleted, restored',
  askAnomalyRestoreFailed: 'could NOT be reverted — check this file',

  /* composer settings — spec 036: Deploy + Test chips removed (row is Workflow · Confirm · Fast build).
     deploy/test are capability-driven at the test gate now (difyTargets), not start-bound; the
     deploy/deployFixed/selfhost/cloud/testMode/testStatic/testLive/testHint labels went with them. */
  workflow: 'Workflow',
  confirm: 'Confirm',
  workflowFixed: 'workflow target is fixed when the build starts',
  confirmModeHint: 'change confirm-mode once the build pauses at a gate',
  setAtStart: 'set when the build started — not changeable mid-build',
  noneNew: 'none (new)',
  eachStep: 'each step',
  specOnly: 'spec only',
  auto: 'auto',
  /* spec 028: fast-build toggle */
  fast: 'Fast build',
  fastHint: 'merge Analyze+Spec, skip pattern search — single-LLM, from-scratch only',
  fastOn: 'on',
  fastOff: 'off',
  gateLivePassBadge: 'LIVE ✓',
  gateLiveFailBadge: 'LIVE ✗',
  gateLivePassTitle: 'Workflow ran — review the output',
  gateLiveFailTitle: 'Live test result needs review',
  gateLiveModel: 'model: {model} (auto-filled {n} node(s))',
  gateLiveOutput: 'output: {out}',
  gateLiveJudge: 'judge (advisory):',
  gateLiveApp: 'app: {url}',
  // spec 036: "Delete old apps" on the live gate — remove every test app except the current one (a re-test
  // also auto-deletes the prior apps, so this rarely has anything to clean).
  deleteOldApps: 'Delete old apps ({n})',
  gateLiveInfraBadge: 'LIVE ⚠',
  gateLiveInfraTitle: "Live test couldn't run (infrastructure)",
  gateLiveInfraSummary: 'the live run could not complete',
  gateLiveStaticStands: 'The static lint result stands (PASS).',

  /* composer file attachments (spec 012 → 025) */
  attachFile: 'Attach file',
  removeFile: 'Remove file',
  dropFiles: 'Drop files to attach',

  /* sidebar */
  projects: 'Projects',
  newProject: 'New project',
  // spec 090 S2 — the synthetic `(unsaved)` group row: explain why it is not clickable-as-base.
  unsavedGroupHint: 'Drafts without a folder yet — open a task to view it. To edit a file, use Import base.',
  noTasksYet: 'no tasks yet',
  inProgress: 'In progress',
  noProjectsYet: 'No projects yet',
  noChatsYet: 'No chats yet',
  noDistillsYet: 'No distills yet',
  noBuildsYet: 'No builds yet',
  cancelThisBuild: 'Cancel this build',
  hintGate: 'gate',
  hintRunning: 'running',

  /* create-project modal (spec 031) */
  createProject: 'Create Project',
  close: 'Close',
  projectName: 'Project name',
  phProjectName: 'English only — e.g. eiken_grammar, toeic',
  folderPreview: 'Folder: {slug}',
  nameCharsetError: 'Use English letters and numbers only — e.g. eiken_grammar',
  projectExists: '"{name}" already exists',
  openExisting: 'Open',
  skip: 'Skip',
  createProjectBtn: 'Create project',
  ok: 'OK',

  /* artifact panel */
  hidePanel: 'Hide panel',
  newWorkflow: 'new workflow',
  tab_spec: 'Spec',
  tab_report: 'Report',

  /* spec tab */
  specEdit: 'Edit',
  specPreview: 'Preview',
  specSplit: 'Split',
  /* The 4th spec view / the 2nd main.yml view — the old Diff TAB, moved into the file it describes. */
  specDiffMode: 'Diff',
  yamlCodeMode: 'Code',
  noSpecYet: 'No SPEC.md yet — it appears after the Spec phase.',
  nothingToPreview: 'Nothing to preview yet.',
  saving: 'Saving…',
  saveSpec: 'Save spec',
  savedFeedsImplement: 'Saved · feeds Implement',
  unsavedChanges: 'Unsaved changes',
  tokenRedacted: 'API token redacted · never shown',
  tbBold: 'Bold',
  tbItalic: 'Italic',
  tbStrike: 'Strikethrough',
  tbInlineCode: 'Inline code',
  tbH1: 'Heading 1',
  tbH2: 'Heading 2',
  tbH3: 'Heading 3',
  tbBullet: 'Bullet list',
  tbNumbered: 'Numbered list',
  tbQuote: 'Quote',
  tbCodeBlock: 'Code block',
  tbLink: 'Link',
  tbVariable: 'Variable',

  /* yaml tab */
  yamlLines: 'yaml · {n} lines',
  /* SPEC.md's and a diff's equivalent of the line count — the same slot, so the two files' headers say
     the same KIND of thing about themselves. A diff counts changed lines, which is its real size. */
  mdLines: 'markdown · {n} lines',
  diffStat: 'diff',
  noYamlYet: 'No main.yml yet — it appears after the Implement phase.',
  lintResults: 'Lint results',
  lintOk: 'ok',
  /* Not `copyYaml` any more: the same button now sits on SPEC.md too. The visible label stays the one
     word everyone expects on a code block; the TOOLTIP says which of the two copyable things it means,
     now that a "Copy path" sits beside it. */
  copyFile: 'Copy',
  copyFileHint: 'Copy the file contents',
  copied: 'Copied',
  /* the per-code-block copy button the markdown renderer emits (every fenced block, every surface) */
  copyCode: 'Copy this block',
  revealInFinder: 'Reveal in Finder',
  copyPath: 'Copy path',
  copyPathHint: 'Copy the full path of this file',
  /* The panel head's pair points at a DIRECTORY, so "this file" would be a small lie in the one place a
     screen reader has to rely on the label alone. */
  copyFolderPathHint: "Copy the full path of this build's folder",
  pathCopied: 'Path copied',

  /* diff tab */
  diffBinary: 'Binary or oversized diff — not shown.',
  diffNoChanges: 'No textual changes in this file.',

  /* report tab */
  runReport: 'Run report',
  noReportYet: 'No report yet — it appears after the Test phase.',
  rWorkflowFile: 'Workflow file',
  rLint: 'Lint',
  rDeploy: 'Deploy',
  rAccepted: 'Accepted',
  rLintAllPassed: 'all passed',
  rLintFailures: 'failures recorded',
  rNotDeployed: 'not deployed (local)',
  rLintOverridden: 'lint failure overridden (human)',
  deployedTag: 'DEPLOYED · {deploy}',
  open: 'Open',
  noteCloud: 'Cloud deploy — import the YAML manually in Dify Studio (steps in the notes below; the YAML is in the main.yml tab).',
  noteSelfhost: 'Not imported — use the Import button, or check Dify (see notes).',
  noteDeployOff: 'No Dify target configured — no app URL. Set DIFY_CONSOLE_URL / DIFY_CONSOLE_TOKEN to import & get a link.',
};

const JA: Dict = {
  /* chat-top / shell */
  newTask: '新規タスク',
  toggleSidebar: 'サイドバーの切り替え',
  stop: '停止',
  stopRunningBuild: '実行中のビルドを停止',
  live: 'ライブ',
  reconnecting: '再接続中…',
  artifact: '成果物',
  exportRun: 'エクスポート',
  exportRunHint: 'このビルドを説明するzipをダウンロード — ダイジェスト・成果物・各フェーズの記録（プロンプト＋ツール）・タイムライン・添付ファイル',
  // spec 062 follow-up — 「Driveへエクスポート」: 同じダイジェストをチームDrive（exports/）へ直接アップロード
  exportDownload: 'zipをダウンロード',
  exportingDrive: 'アップロード中…',
  exportDrive: 'Driveへエクスポート',
  exportDriveHint: 'このビルドのダイジェストをチームDrive（exports/）へ直接アップロード。チームDrive未設定ならダウンロードします。',
  exportDriveDoneTitle: 'Driveへアップロードしました',
  exportDriveDoneMsg: 'ダイジェストはチームDriveの {path} にあります。',
  exportDriveUnconfirmedTitle: 'Driveへ送信しました（未確認）',
  exportDriveUnconfirmedMsg: 'アップロードはGoogleに到達しましたが、確認応答が返りませんでした（Apps Scriptの既知の挙動）。ファイルはほぼ確実に保存されています。念のためチームDriveの exports/ フォルダをご確認ください。',
  exportNoDriveTitle: '代わりにダウンロードしました',
  exportNoDriveMsg: 'チームDriveが未設定です（⚙設定 › 共有 でドロップURL/シークレットを設定）— ダイジェストzipをこの端末にダウンロードしました。',
  gotIt: 'OK',
  /* the ⚙ header menu (PrefsMenu) */
  prefs: '設定',
  prefsUiLang: '表示言語',
  prefsReplyLang: '返答の言語',
  prefsTheme: 'テーマ',
  themeLight: 'ライト',
  themeDark: 'ダーク',
  /* spec 088 — phase-completion notifications */
  notifyToggle: 'フェーズ完了通知',
  notifyEnableHint: 'フェーズ完了時に通知する(タブが非表示のときにブラウザ通知)',
  notifyDisableHint: '完了通知はオン — クリックでオフ',
  notifyBlockedHint: '通知がブラウザにブロックされています — ブラウザのサイト設定で許可してください',
  notifGate: '{phase} 完了 — 確認待ち',
  notifDone: 'ビルド完了',
  notifError: 'ビルド失敗',
  notifAnswer: '回答完了',
  notifyNudgeText: 'ビルド実行中 — 通知を有効にすると、フェーズ完了をすぐ知らせます。',
  notifyNudgeAutoText: '自動モードは4ステップを止まらずに実行します。通知を有効にすると、完了時や途中停止時（このアカウントが利用上限に達した場合など）にすぐ知らせます。',
  notifyNudgeEnable: '通知を有効にする',
  notifyNudgeDismiss: '今後表示しない',
  notifyTip: 'ONでフェーズ完了を通知',
  updateBtnHint: 'アップデート — 最新コードを取得して再ビルド・再起動します',
  updateConfirmTitle: 'アプリを更新しますか？',
  updateConfirmMsg: '最新コードを取得し、再ビルドして再起動します。数分かかります。更新中はビルドを実行できません。',
  updateRunning: '更新中…（数分かかることがあります）',
  updateRestarting: '再起動中… 復帰後に自動で再読み込みします',
  updateDone: '✓ 更新して再起動しました',
  updatePullFailed: '最新コードの取得に失敗しました — 管理者に連絡してください。',
  updateOnBranch: '更新しませんでした — いま main ではなく「{branch}」ブランチにいます。更新するとこのブランチが失われるため、そのままにしました。最新版にするには先に `git checkout main` を実行してください。',
  updateBuildFailed: 'ビルドに失敗しました — 管理者に連絡してください。',
  updateBusy: 'ビルド実行中です — 先にキャンセルしてから更新してください。',
  turnBusy:
    '実行中のターンがあります。入力内容はそのまま残っています — 実行中のターンを停止するか、終了までお待ちください。',
  updateTip: 'ここから最新版に更新',
  authTitle: 'Claude にログイン',
  authWhy:
    'ビルドはこの PC の `claude` CLI で動きますが、いまログインしていません。ターミナルは不要 — ここでログインできます。',
  authOpenPage: 'ログインページを開く',
  authOpened: 'ブラウザでログインページが開いているはずです。そこでログインすれば、この画面は自動で次に進みます — コピーして戻す作業はありません。',
  authWaiting: 'ログインページでの操作をお待ちしています…',
  authFallback: 'ページが開かない場合はこちら。開いた先でコードが表示されるので、下の欄に貼り付けてください。',
  authCodeLabel: 'ログインページのコード（表示された場合のみ）',
  authSubmit: 'ログインを完了する',
  authStarting: 'ログインページを準備中…',
  authExchanging: 'ログイン処理中…',
  authDone: '✓ ログインしました — メッセージを送信し直してください',
  authFailed: 'コードが受け付けられませんでした。ページを開き直して、新しいコードをコピーしてください。',
  authCliMissing: 'この PC に `claude` CLI がインストールされていません — 管理者に連絡してください。',
  authStartFailed: 'ログインを開始できませんでした。',
  authRetry: 'やり直す',
  authNeeded:
    'Claude にログインしていません。入力内容はそのまま残っています — ログインしてから送信し直してください。',
  chatLangAuto: '自動',
  chatLangHint: '返答の言語: {name}（ワークフロー自体は要件の言語のまま）',
  chatLangAutoName: '入力した言語に合わせる',

  /* empty / new-task surface */
  phDescribeWorkflow: 'ワークフローや変更内容を入力…',
  /* spec 029: dynamic new-task crumb (pre-selection from the sidebar "+") */
  editingWorkflow: '{name} を編集',
  newTaskInProjectName: '{name} 内に新規タスク',
  clearPreselection: '選択を解除して新規タスク',
  runContextHint: 'このビルドの保存先',
  // spec 051-followup
  baseLabel: 'ベース:',
  runningWithBaseHint: '既存ワークフローをベースに編集中 — 実装フェーズがこのファイルを変更します',
  seedFrom: 'ベースにする',
  noSeedApps: 'シードアプリがありません — Dify を接続するとワークスペースのアプリをベースにできます。新規ワークフローはゼロから作成されます。',
  // spec 051 D5
  addYamlAsBase: '＋ YAMLをベースに追加',
  importBaseTitle: 'YAMLをベースに追加',
  importBaseHint: 'ワークフローのYAMLをアップロードまたは貼り付けます。検証後、projects/ 配下にローカルのベースとして保存され、編集できます（app.name が表示名になります）。',
  importBaseFile: '.yml / .yaml ファイルを選択',
  importBasePaste: 'または YAML を貼り付け',
  phPasteYaml: 'app:\n  name: マイワークフロー\n  ...',
  importBaseName: '名前（任意）',
  phImportBaseName: '未入力の場合は YAML の app.name を使用',
  importBaseProject: '対象プロジェクト（任意）',
  importBaseDrafts: '_drafts — ステージング（コミットされません）',
  importBaseSubmit: 'ベースに追加',
  importBaseEmpty: 'まずワークフローのYAMLをアップロードまたは貼り付けてください。',
  importBaseLanded: '{project} に {workflow} として取り込みました。',
  importBaseUse: 'このベースを使う',
  // spec 070
  intakeYamlBtn: '外部YAMLを追加',
  intakeTitle: '外部ワークフローYAMLを追加',
  intakeHint: '外部ワークフローYAMLの用途を選んでから、アップロードまたは貼り付けてください。先に検証されます。',
  intakeActionLabel: '用途',
  intakeActionBase: 'ベースにして編集',
  intakeActionDistill: 'パターン棚に蒸留',
  intakeBaseHint: 'プロジェクトにベースとして取り込み、それを編集するビルドを始められます。',
  intakeDistillHint: '今後のビルドで再利用できるパターンに蒸留します。レビューが開き、承認するまで保存されません。',
  intakeDistillPath: '承認されたパターンは templates/patterns/ に保存されます。',
  intakeSourceLabel: '出典ラベル（任意）',
  phIntakeSourceLabel: 'このYAMLの出典（provenance に記録）',
  intakeLicense: 'ライセンス',
  intakeLicenseHint: 'パターンのヘッダーに記録されます。あとでチームの棚へ共有できるのは permissive なライセンスのときだけです。',
  intakeDistillSubmit: '蒸留',
  none: 'なし',
  try: '例',
  phReplyOrDescribe: '返信、または別の修正を入力…',
  // 変更 CỐ Ý giữ (spec 103 S1): đây là 'mô tả thay đổi khác để bắt đầu build MỚI' — hành động khác
  // với 'sửa build này'. Dùng 修正 ở đây sẽ nói dối về việc nút làm gì.
  phDescribeAnother: '別の変更を入力して新しいビルドを開始…',
  openIt: '開く',
  persistQuota: 'このブラウザの保存領域が不足しているため、会話はこの端末に保存されていません。質問と回答はサーバー側に残っており、このビルドを開き直すと復元されます。',
  persistFailed: 'この会話をブラウザに保存できませんでした。質問と回答はサーバー側に残っており、このビルドを開き直すと復元されます。',

  /* stop-build confirm */
  stopBuildTitle: 'このビルドを停止しますか？',
  stopBuildMsg: '<c>{name}</c> をキャンセルしますか？ 実行中のターンが停止され、このフェーズの進捗は破棄されます。',
  stopBuild: 'ビルドを停止',
  cancelGateTitle: 'このビルドをキャンセルしますか？',
  cancelGateMsg: '<c>{name}</c> をキャンセルしますか？ ゲートで待機中です — これまでの仕様・成果物は保持され、会話画面からビルドを復元できます。',

  /* destructive gate confirms (spec 016 D4) */
  acceptAnywayTitle: '検証に失敗したワークフローを出力しますか？',
  acceptAnywayMsg: '最大5回の試行後もリンターが通りませんでした。承認するとこのビルドは失敗を記録したうえで完了扱いになります — Dify で正しく動作しない可能性があります。',
  acceptAnywayOk: 'このまま承認',
  importConfirmTitle: 'セルフホストの Dify にインポートしますか？',
  importConfirmMsg: '<c>{file}</c> を Dify ワークスペースに送信します。新しいアプリが作成されます — 既存のアプリは更新されません。',
  importConfirmOk: 'インポート',
  discardTitle: 'このビルドを破棄しますか？',
  discardMsg: 'このビルドを中止します。これまでの仕様や成果物はディスクに残りますが、ビルドは閉じられます。',
  discardOk: 'ビルドを破棄',

  /* phase labels */
  phase_analyze: '分析',
  phase_spec: '仕様',
  phase_implement: '実装',
  phase_test: 'テスト',

  /* disclosure */
  running: '実行中',
  stoppedDuring: '停止しました：',
  distillStep: '蒸留', // spec 052: promote タスクの1ターン — 「④ テスト」ではない
  working: '処理中…',

  /* gate */
  phaseMeta: 'フェーズ {idx} / 4',
  phaseMeta4: 'フェーズ 4 / 4',
  exit1: 'exit 1',
  gateErrorBadge: 'フェーズ失敗',
  gateErroredTitle: '{phase} でエラー',
  gateErrorSummary: 'ファイルは書き込まれていません。再試行すると、承認済みの入力からこのフェーズだけを再実行します。',
  gateCancelledBadge: 'キャンセル',
  gateCancelledTitle: 'ビルドを中止しました',
  gateCancelledSummary: 'ユーザーによりキャンセルされました — これまでの仕様・成果物は保持されます。',
  restoreBuild: 'ビルドを復元',
  gateDoneBadge: '完了',
  gateDoneTitle: 'テスト合格 — ワークフローを更新しました',
  phaseSkipped: 'スキップ — このワークフローには分析と仕様がすでにありました。',
  gateDoneStaleImport: 'Dify には {time} にインポートした版が残っています。その後ワークフローは変わりました。もう一度インポートすると今の版が送られます。',
  gateDoneSummary1: '生成された main.yml に対してリンターを再実行しました。',
  gateDoneSummary2: '詳細はパネルのレポートを開いてください。',
  gateFailBadge: 'リンターが失敗のまま',
  gateFailTitle: '最大5回の試行後も失敗しています',
  gateFailSummary1: 'エージェントは1ターンでできる限り自己修正しました。',
  gateFailSummary2: '判断してください：このまま承認、再試行を続ける、または中止。',
  gateAnalyzeBadge: '分析完了',
  gateAnalyzeTitle: '仕様を書く準備ができました',
  gateAnalyzeSummary1: '要件を分析しました。',
  gateAnalyzeSummary2: '続けて仕様を作成するか、修正を依頼してください。',
  gatePattern: 'パターン: {pattern}',
  gateSpecBadge: '仕様準備完了',
  gateSpecTitle: '仕様を作成しました — ビルド前にご確認ください',
  gateSpecSummary1: 'SPEC.md はパネルで編集できます — 実装前に調整してください（上書き保存）。',
  gateImplBadge: '実装完了',
  gateImplTitle: 'main.yml をビルドしリンターを実行しました',
  gateImplSummary1: 'ワークフロー YAML を生成、すべてのリンターが成功。',
  gateReadyBadge: '準備完了',
  gateReadyTitle: '続行',

  /* spec 094 S1 */
  /* spec 096 */
  model: 'モデル',
  model_opus: 'Opus',
  model_sonnet: 'Sonnet',
  model_haiku: 'Haiku',
  model_fable: 'Fable',
  modelUnset: '記録なし',
  modelHint: 'このタスクを実行するモデル。各項目はご利用環境で使える、その系列の最新版を指します。後から変更できます — 次のステップから反映され、実行済みのステップは当時のモデルのままです。',
  gateNoChangeBadge: 'ファイル変更なし',
  gateNoChangeSummary: 'この回はワークフローファイルを変更していません — 理由は上の回答をご覧ください。修正が入るはずだった場合は、どこが違うべきかを書いてもう一度お伝えください。',
  gateSpecStale: 'ワークフローは変わりましたが、仕様書は更新されていません。今回の変更が動作に関わるものなら、仕様書は現状と食い違っています — 頼りにする前に確認してください。',
  gateSpecEdits: '仕様書も {n} か所 更新しました。',
  sendVariants: '送り方',
  sendFixNow: 'すぐ直す',
  sendFixNowSub: '直してから結果を見せます。',
  sendPlanFirst: '先に計画を見せて',
  sendPlanFirstSub: '何を変えるか説明してから決められます。実行 +1 回。',
  gateSpecNoop: '今回は仕様書を変える必要がありませんでした — ワークフローもそのままです。それでも直したい場合は、すぐ直すで送ってください。',
  specDraftPending: 'ゲートでの決定待ち — 保存もされておらず、ワークフローにも入っていません',
  specDraftTitle: 'SPEC.md（修正案）',
  specDraftNote: 'これは修正案です。現在の仕様書ではありません。ゲートで進めるまで、何も保存されません。',
  gateProposalBadge: '計画',
  gateProposalTitle: 'こう変えようと思います',
  gateProposalSummary: 'まだ何も変わっていません — 進めると言うまで、ワークフローも仕様書もそのままです。',
  undoFix: 'この修正を取り消す',
  undoFixTitle: 'この修正を取り消しますか？',
  undoFixMsg: 'ワークフローファイルと仕様書の両方が、この修正の前の状態に戻ります。会話はそのまま残ります。もう一度依頼する場合は実行が 1 回分かかります。',
  diffSpecUnchanged: 'この回は仕様書を変更していません。',
  diffWorkflowUnchanged: 'この回はワークフローファイルを変更していません。',
  gateNoChangeImport: '{time} にインポートしたファイルと1バイトも違いません。もう一度インポートしても、Dify にすでにあるものを送ることになります。',

  /* deploy gate — awaiting_import (spec 016 D1) */
  gateImportBadge: 'デプロイ準備完了',
  gateImportTitle: '{file} をセルフホストの Dify にインポート',
  gateImportSummary1: 'インポートすると、リンター済みのワークフローが Dify ワークスペースに送信されます。',
  gateImportSummary2: 'インポートすると Dify に新しいアプリが作成されます。以降このビルドから再インポートしても、同じアプリが更新されるだけで増えません。',
  gateImportSummaryUpdate: 'このビルドが作成済みの Dify アプリを更新します — 同じアプリ・同じ URL で、複製は作られません。変更を見るには Dify 側で再読み込みしてください。',
  gateImportSummary3: 'スキップするとデプロイせずにローカルでビルドを完了します。',
  gateImportSummaryEdit: '<c>{workflow}</c> を編集中です — インポートしても別の新規アプリが作成され、このアプリは更新されません。',

  /* gate links */
  openSpec: 'SPEC.md を開く',
  viewSpecDiff: '仕様の差分',
  viewWorkflowDiff: 'ワークフローの差分',
  openReport: 'レポートを開く',

  /* gate reply */
  phWhatShouldChange: '続行する前に何を変更しますか？',
  cancel: 'キャンセル',
  sendRerun: '送信して再実行',

  /* spec 033/092: the composer's two send actions (ask = Enter/chat button, change = the ✎ pill) */
  // spec 103 S1: 修正 is the ONE root word for "change this build". This pill used to lead with 変更
  // while the button an inch away led with 修正 — two words for one action on one screen (§1.5).
  modeChange: '修正を依頼',
  phAskOrChange: '質問または修正依頼を入力…',
  phChangeMode: '何を修正しますか？',
  sendAskTip: '質問として送信 (Enter)',
  sendChangeOnlyTip: 'ここでの送信はすべて修正依頼として届きます',
  sendChangeTip: '修正依頼として送信 (⌘Enter / Ctrl+Enter) — 指示に沿ってフェーズを再実行します',
  sendAskBtn: '質問を送信',
  sendBtn: '送信',
  qaAnswered: '回答済み',
  qaAnswering: '回答中…',
  // spec 034
  phAskAboutBuild: 'このビルドについて質問…',
  qaSeededFrom: '参照: {sources}',
  /* spec 082: 相談モード */
  consultChat: '相談',
  consultSection: '相談',
  /* spec 082 §4.5 rev */
  sectionChat: 'チャット',
  sectionBuild: 'ビルド',
  sectionProjects: 'プロジェクト',
  sectionDistill: '蒸留', // spec 084 S1.5
  sbShowMore: 'あと{n}件を表示', // spec 084 follow-up
  sbShowLess: '折りたたむ',
  removeTask: '削除', // spec 084 follow-up — サイドバー行の×（完全削除）
  removeTaskTitle: 'このタスクを削除しますか？',
  removeTaskMsg: '「{name}」とその記録を完全に削除します。元に戻せません。',
  removeTaskOk: '削除',
  removeProject: 'プロジェクトを削除', // spec 084 follow-up — ProjectRow の×（完全削除・連鎖）
  removeProjectTitle: 'このプロジェクトごと削除しますか？',
  removeProjectMsg: '「{name}」— 中の {n} 個のワークフローとすべてのビルドを完全に削除します。元に戻せません。',
  removeProjectOk: 'プロジェクトを削除',
  removeWorkflow: 'ワークフローを削除', // spec 084 follow-up — WorkflowRow の×（完全削除・ビルド連鎖）
  removeWorkflowTitle: 'このワークフローを削除しますか？',
  removeWorkflowMsg: '「{name}」と その {n} 件のビルドを完全に削除します。元に戻せません。',
  removeWorkflowOk: 'ワークフローを削除',

  newChat: '新規チャット',
  newBuild: '新規ビルド',
  appName: 'Builder',
  phConsult: '何でも聞いてください — .yml ファイルをドロップして相談もできます…',
  phConsultChat: '会話を続ける…',
  newConsultDesc: 'Difyの仕様や用途について相談します。後からこの要件でビルドを開始することもできます。',
  graduateBtn: 'チャットからビルド開始',
  graduateHint: '会話を要件にまとめて、新しいビルドに事前入力します',
  graduatePromptText: 'これまでの会話を要約し、このDifyワークフローを構築するための完全で独立した要件を1つ作成してください。前置きなしで要件テキストのみを、これまで使用してきた言語で返信してください。',
  confirmDistill: '蒸留を開始する',
  stopAnswerHint: 'この回答を停止します（どちらにせよファイルには書き込まれません）',
  stopConsultAnswer: 'この回答を停止',
  cardTitle: '機械チェック',
  cardLintClean: '構造は有効 — そのままインポート可能',
  // spec 035 — 「編集」は新しい会話が始まることを名前で先に伝える（同じ会話で直す道は入力欄の
  // ✎ `modeChange`）。
  expandPanel: '拡大',
  collapsePanel: '元に戻す',
  expandPanelHint: 'パネルをウィンドウ幅まで拡大します — 見出し一覧が表示され、セクション間を移動できます',
  collapsePanelHint: '通常の幅に戻す（Esc）',
  contents: '目次',
  contentsEmpty: '移動できる見出しがありません',
  editThisWorkflow: '新しい会話で編集',
  editWorkflowShort: '編集（新規）',
  editThisWorkflowHint: 'このワークフローを編集する新しい会話を開きます。この会話のまま直す場合は、下の入力欄に変更内容を書いて「✎ 修正を依頼」で送信してください。',
  // 完了後の修正ループ — 完了カードの「この会話のまま直す」アクション。
  // spec 036 D5
  runTestWithWorkflow: 'ワークフローでテスト実行',
  liveTestNeedsSelfhost:
    'ワークフローテストを実行するには、セルフホストの Dify 接続設定が必要です。先にバックエンド環境でセルフホストのコンソール URL と API キーを設定してください。',
  // spec 084 — バックグラウンド蒸留トレイ（コーナーパネル）
  trayTitle: '蒸留',
  trayDistilling: '{slug} を蒸留中…',
  trayQueued: 'ビルドレーンの空きを待機中…',
  trayReady: 'レビュー可能',
  trayPromoted: '{slug} を昇格しました',
  trayShared: '{slug} をチームに共有しました',
  trayCollision: '名前が既に使用中: {slug}',
  trayFailed: '蒸留に失敗しました',
  trayBlocked: '対象外',
  trayLeakBlocked: '共有できません — シークレットを検出',
  trayShareFailed: 'チームへの共有に失敗しました',
  trayTarget: '{target}',
  trayViewReport: 'レポートを見る',
  trayDetails: '詳細',
  trayResend: '再実行',
  trayUndo: '元に戻す',
  trayApprove: '承認',
  trayOverwrite: '上書き',
  traySaveAsNew: '別名で保存',
  trayShareTeam: 'チームに共有',
  trayKeepLocal: 'ローカルのみ',
  trayPush: 'チームへ送信',
  trayDiscard: '破棄',
  trayClose: '閉じる',
  trayDetailsTip: 'このタスクを開く',
  trayCloseTip: '閉じる（実行中の場合は中止）',
  trayCloseRunningTitle: 'この蒸留を中止しますか？',
  trayCloseRunningMsg: '「{slug}」の蒸留はまだ完了していません — 閉じると中止されます。',
  trayCloseRunningOk: '蒸留を中止',
  trayUndone: 'シェルフから削除しました',
  // spec 084 (DEV) — テスト蒸留のトレイ操作（?dev=1 / BUILDER_DEV のみ；オン/オフは ⚙ 設定モーダル内）
  trayTestBadge: 'DEV',
  trayClearTest: 'テストを消去 ({n})',
  // spec 052 — パターンへの昇格
  promoteToPattern: 'パターンに昇格',
  promoteToPatternHint: 'この実証済みビルドを再利用可能な templates/patterns/ パターンに蒸留します（人によるレビューで承認）。',
  promoteThreadOpen: '{project}/{workflow} を再利用可能なパターンに昇格',
  promoteExternalThreadOpen: '{label} を再利用可能なパターンに蒸留',
  openPattern: 'パターンを表示',
  promoteBlockedBadge: 'ブロック',
  promoteBlockedTitle: '昇格の条件を満たしていません',
  promoteBlockedSummary: 'このビルドは適格性ゲートを通過しませんでした — 蒸留も書き込みも行われていません。',
  promoteDistillFailedBadge: '要修正',
  promoteDistillFailedTitle: '蒸留されたパターンが再チェックに失敗しました',
  promoteDistillFailedSummary: '蒸留結果がリンターを通過しませんでした — 修正を依頼して再実行するか、破棄してください。',
  promoteReviewBadge: 'レビュー',
  promoteReviewTitle: '昇格前に蒸留されたパターンをレビュー',
  promoteReviewSummary: 'まだ棚には何も入っていません — このパターンを templates/patterns/ に書き込むのは「承認」です。先に内容を確認してください。',
  promoteTargetLine: '出力先: {target}',
  promoteProbeLine: 'インポートプローブ: {probe}',
  promoteDoneBadge: '昇格済み',
  promoteDoneTitle: 'パターンを昇格しました',
  promoteDoneSummary: 'パターンが templates/patterns/ に配置され、INDEX が再構築されました。',
  promoteErrorTitle: '昇格に失敗しました',
  promoteCancelledTitle: '昇格を破棄しました',
  promoteCancelledSummary: 'templates/patterns/ には何も書き込まれていません。',
  /* spec 081 — 昇格後の共有ターン */
  promoteShareOfferTitle: 'このパターンをチームと共有しますか？',
  promoteShareOfferSummary: 'レビュー用に共有リポジトリへ送信できます — 次のステップで確認するまで何も送信されません。',
  promoteShareReviewBadge: '共有チェック',
  promoteShareReviewTitle: '送信前に内容を確認してください',
  promoteShareScanClean: '漏えいスキャン: 問題なし — 認証情報や実環境の痕跡は見つかりませんでした。',
  promoteShareFindingsLine: '漏えいスキャン: 要確認 {n} 件 — 送信前に下の各行を確認してください。',
  promoteShareMoreFindings: '…ほか {n} 件 — パターン YAML を開いてすべて確認してください。',
  promoteShareDupLine: '重複チェック: {dup}。',
  promoteShareLicenseLine: '送信するとこのパターンは MIT ライセンス（ヘッダーに記載）で共有されます。',
  promoteShareFailedLine: '送信できませんでした: {error}',
  promoteSharePushedLine: '共有しました: ブランチ {branch} を送信 — PR が自動作成され、オーナーがレビューします。',
  promoteShareSentLine: 'チームの棚に共有しました — 管理者がレビューのうえ共有パターンに追加します。',
  askAnomalyTitle: '予期しない書き込みを元に戻しました',
  askAnomalyMsg: 'ガードにもかかわらず質問ターンが書き込みを試みたため、元に戻しました: {files}。変更は反映されていません — その内容が必要な場合は「✎ 修正を依頼」で送信してください。',
  askAnomalyOk: 'OK',
  askAnomalyKindModified: '変更を元に戻しました',
  askAnomalyKindCreated: '作成されたため削除しました',
  askAnomalyKindDeleted: '削除されたため復元しました',
  askAnomalyRestoreFailed: '元に戻せませんでした — このファイルを確認してください',

  /* composer settings — spec 036: Deploy + Test チップを削除（行は Workflow · Confirm · Fast build）。
     deploy/test はテストゲートで capability から決まる（difyTargets）— 開始時固定ではない。 */
  workflow: 'ワークフロー',
  confirm: '確認',
  workflowFixed: 'ワークフローの対象はビルド開始時に固定されます',
  confirmModeHint: 'ビルドがゲートで一時停止したら確認モードを変更できます',
  setAtStart: 'ビルド開始時に設定されます — ビルド中は変更できません',
  noneNew: 'なし（新規）',
  eachStep: '各ステップ',
  specOnly: '仕様のみ',
  auto: '自動',
  /* spec 028: fast-build toggle */
  fast: '高速ビルド',
  fastHint: 'Analyze+Specを統合しパターン検索を省略 — 単一LLM・新規作成のみ',
  fastOn: 'オン',
  fastOff: 'オフ',
  gateLivePassBadge: 'LIVE ✓',
  gateLiveFailBadge: 'LIVE ✗',
  gateLivePassTitle: 'ワークフローが実行されました — 出力を確認',
  gateLiveFailTitle: 'ライブテスト結果の確認が必要',
  gateLiveModel: 'モデル: {model}（{n}ノード自動補完）',
  gateLiveOutput: '出力: {out}',
  gateLiveJudge: '判定（参考）:',
  gateLiveApp: 'アプリ: {url}',
  // spec 036: 「古いアプリを削除」— 現在のアプリ以外のテストアプリを削除（再テスト時に自動削除もされる）
  deleteOldApps: '古いアプリを削除 ({n})',
  gateLiveInfraBadge: 'LIVE ⚠',
  gateLiveInfraTitle: 'ライブテストを実行できません（インフラ）',
  gateLiveInfraSummary: 'ライブ実行を完了できませんでした',
  gateLiveStaticStands: '静的Lint結果は有効です（PASS）。',

  /* composer file attachments (spec 012 → 025) */
  attachFile: 'ファイルを添付',
  removeFile: 'ファイルを削除',
  dropFiles: 'ファイルをドロップして添付',

  /* sidebar */
  projects: 'プロジェクト',
  newProject: '新規プロジェクト',
  unsavedGroupHint: 'まだフォルダのない下書きです — タスクを開いて内容を確認できます。ファイルを編集するには「ベースを取り込む」を使ってください。',
  noTasksYet: 'タスクはまだありません',
  inProgress: '進行中',
  noProjectsYet: 'プロジェクトはまだありません',
  noChatsYet: 'チャットはまだありません',
  noDistillsYet: '蒸留はまだありません',
  noBuildsYet: 'ビルドはまだありません',
  cancelThisBuild: 'このビルドをキャンセル',
  hintGate: 'ゲート',
  hintRunning: '実行中',

  /* create-project modal (spec 031) */
  createProject: 'プロジェクトを作成',
  close: '閉じる',
  projectName: 'プロジェクト名',
  phProjectName: '英字のみ（例: eiken_grammar, toeic）',
  folderPreview: 'フォルダ: {slug}',
  nameCharsetError: 'プロジェクト名は英数字のみ（例: eiken_grammar）',
  projectExists: '「{name}」は既にあります',
  openExisting: '開く',
  skip: 'スキップ',
  createProjectBtn: 'プロジェクトを作成',
  ok: 'OK',

  /* artifact panel */
  hidePanel: 'パネルを隠す',
  newWorkflow: '新規ワークフロー',
  tab_spec: '仕様',
  tab_report: 'レポート',

  /* spec tab */
  specEdit: '編集',
  specPreview: 'プレビュー',
  specSplit: '分割',
  specDiffMode: '差分',
  yamlCodeMode: 'コード',
  noSpecYet: 'SPEC.md はまだありません — 仕様フェーズの後に表示されます。',
  nothingToPreview: 'プレビューする内容がまだありません。',
  saving: '保存中…',
  saveSpec: '仕様を保存',
  savedFeedsImplement: '保存済み · 実装に反映',
  unsavedChanges: '未保存の変更',
  tokenRedacted: 'API トークンは秘匿 · 表示されません',
  tbBold: '太字',
  tbItalic: '斜体',
  tbStrike: '取り消し線',
  tbInlineCode: 'インラインコード',
  tbH1: '見出し1',
  tbH2: '見出し2',
  tbH3: '見出し3',
  tbBullet: '箇条書き',
  tbNumbered: '番号付きリスト',
  tbQuote: '引用',
  tbCodeBlock: 'コードブロック',
  tbLink: 'リンク',
  tbVariable: '変数',

  /* yaml tab */
  yamlLines: 'yaml · {n} 行',
  mdLines: 'markdown · {n} 行',
  diffStat: '差分',
  noYamlYet: 'main.yml はまだありません — 実装フェーズの後に表示されます。',
  lintResults: 'リンター結果',
  lintOk: 'ok',
  copyFile: 'コピー',
  copyFileHint: 'ファイルの内容をコピー',
  copied: 'コピーしました',
  copyCode: 'このブロックをコピー',
  revealInFinder: 'Finderで開く',
  copyPath: 'パスをコピー',
  copyPathHint: 'このファイルのフルパスをコピー',
  copyFolderPathHint: 'このビルドのフォルダのフルパスをコピー',
  pathCopied: 'パスをコピーしました',

  /* diff tab */
  diffBinary: 'バイナリまたはサイズ超過の差分 — 表示されません。',
  diffNoChanges: 'このファイルにテキストの変更はありません。',

  /* report tab */
  runReport: '実行レポート',
  noReportYet: 'レポートはまだありません — テストフェーズの後に表示されます。',
  rWorkflowFile: 'ワークフローファイル',
  rLint: 'リンター',
  rDeploy: 'デプロイ',
  rAccepted: '承認',
  rLintAllPassed: 'すべて成功',
  rLintFailures: '失敗を記録',
  rNotDeployed: '未デプロイ（ローカル）',
  rLintOverridden: 'リンター失敗を上書き承認（人間）',
  deployedTag: 'デプロイ済み · {deploy}',
  open: '開く',
  noteCloud: 'クラウドデプロイ — Dify Studio で YAML を手動インポートしてください（手順は下記のノート、YAML は main.yml タブにあります）。',
  noteSelfhost: '未インポート — インポートボタンを使うか、Dify を確認してください（ノート参照）。',
  noteDeployOff: 'Dify ターゲット未設定 — アプリ URL はありません。（ワークフローでテスト実行したい場合は DIFY_CONSOLE_URL / DIFY_CONSOLE_TOKEN を設定してください。）',
};

const DICT: Record<Lang, Dict> = { en: EN, ja: JA };

/* Gate action / resolution labels are produced by the SERVER in English (gate.ts) and reach the dumb
   renderer as display strings. To localize without a server change we map them here, keyed by their
   stable English text (the action `id` alone is ambiguous — 'continue'/'changes' differ per phase).
   Unknown labels pass through unchanged. */
const ACTION_JA: Dict = {
  'Continue to Spec': '仕様へ進む',
  'Request changes': '修正を依頼', // spec 103 S1
  'Implement this spec': 'この仕様で実装',
  'Edit spec': '仕様を修正', // spec 103 S1
  // spec 103 Lane B — the proposal gate. Plain words on purpose: the person deciding may not know
  // what a "spec" is, but everyone understands "go with this" / "change the plan" / "never mind".
  'Go with this': 'これで進める',
  'Change the plan': '説明を直す',
  'Never mind': 'やめる',
  'Continue to Test': 'テストへ進む',
  'Accept anyway': 'このまま承認',
  'Keep trying': '再試行を続ける',
  Abandon: '中止',
  'Import to Dify': 'Dify にインポート',
  'Finish without importing': 'インポートせず完了',
  // Legacy label: builds whose ④ gate was computed before the rename cache 'Skip import' in
  // task.gate — keep mapping it so they don't fall back to raw English. (Gate labels translate by
  // the English string, so a renamed label must keep its old key alive for in-flight builds.)
  'Skip import': 'インポートせず完了',
  'Retry phase': 'フェーズを再試行',
  'Discard build': 'ビルドを破棄',
  /* spec 032 live-test gate actions */
  'Test with workflow': 'ワークフローでテスト',
  'Accept result': '結果を承認',
  'Re-test': '再テスト',
  'Retry live': 'ライブ再試行',
  'Accept static': '静的結果を承認',
  'Delete test apps': 'テストアプリを削除',
  /* spec 052 promote gate actions */
  'Approve & promote': '承認して昇格',
  Discard: '破棄',
  'Overwrite existing': '既存を上書き',
  'Save as a new pattern': '新しいパターンとして保存',
  /* spec 081 share gate actions */
  'Share to team shelf': 'チームの棚に共有',
  'Keep local only': 'ローカルのみに保持',
  'Push to shared repo': '共有リポジトリへ送信',
  'Try push again': 'もう一度送信',
  /* Resolved-state labels. These do NOT come from gate.ts like everything above — store.ts mints them
     client-side (resolveLabel, and the restore path's `resolved: 'Restored'`), which is why they slipped
     past gate-i18n-labels.test.ts and reached Japanese users in English. That test now scrapes store.ts
     too; all six live here. */
  Cancelled: 'キャンセル済み',
  Continued: '続行済み',
  'Requested changes': '修正を依頼済み', // spec 103 S1
  Done: '完了',      // matches gateDoneBadge — the badge and its receipt should say one word
  Errored: 'エラーで終了',
  Restored: '復元済み', // restoreBuild is 「ビルドを復元」; this is the receipt for having pressed it
};

/** Localize a server-provided gate action / resolution label (keyed by its English text). */
export function tAction(label: string): string {
  return lang.value === 'ja' ? ACTION_JA[label] ?? label : label;
}

/* Report `notes` (spec 030 P2) is assembled BACKEND-side (report.ts + slugNote/patternAdvisory/
   duplicateWarning) from a FIXED set of English sentence frames, then joined into ONE string that
   reaches this dumb renderer. Which frames appear — and their interpolated slugs/URLs/paths — vary per
   build, so it is not a single fixed label mappable via tAction. To make it follow the toggle WITHOUT a
   report.json shape change, translate each known frame in place; capture groups keep the interpolated
   slug/URL/path literal, and any unknown text (e.g. raw validator stderr, or a future wording drift in
   report.ts) passes through in English — graceful, never a crash. Same client-side-map spirit as
   ACTION_JA: the toggle drives it, so notes stay consistent with the already-localized report labels. */
const NOTE_JA: [RegExp, string][] = [
  // spec 066 S5: plain + self-terminating (the old 'all linters passed' had no period, so the join
  // fused it into the next sentence; 「リンター」 was katakana for a word a user never knew anyway).
  [/The workflow file passed every automated check\./g, 'ワークフローファイルは自動チェックをすべて通過しました。'],
  [/lint failures recorded: /g, 'リンター失敗を記録: '],
  [
    /ACCEPTED with failing linters \(human "Accept anyway" override\)\./g,
    'リンター失敗のまま承認（人間による「このまま承認」の上書き）。',
  ],
  [
    /'([^']+)' already exists in this project — using '([^']+)' to avoid overwriting it\./g,
    "'$1' はこのプロジェクトに既に存在するため、上書きを避けて '$2' を使用します。",
  ],
  // spec 066 S5: reworded plain (the old frame opened with 「アドバイザリ」 and named the internal
  // pattern/feature/graph vocabulary). `$1` = the gap list — 019's feature names, kept literal.
  [
    /Heads up: the template this build started from doesn't cover everything you asked for \((.+?)\)\. The workflow was still built — worth checking it does what you need\./g,
    'お知らせ: このビルドの元にしたテンプレートは、ご依頼の内容をすべてはカバーしていません（$1）。ワークフローは作成済みですが、意図どおりか確認することをおすすめします。',
  ],
  // spec 064: `deploy=none (no Dify contact).` is no longer emitted into the human note (dev detail —
  // it lives on report.deploy), so its frame is retired.
  [
    /Cloud deploy: auto-import is blocked by CSRF, so import manually\. The copyable YAML is the produced workflow \((.+?), shown in the main\.yml tab\)\. Steps in Dify Studio: ① Studio → Create app → "Import DSL" → ② paste the YAML \(or upload the file\) → ③ Create\./g,
    'クラウドデプロイ: 自動インポートは CSRF によりブロックされるため手動でインポートします。コピー可能な YAML は生成されたワークフロー（$1、main.yml タブに表示）です。Dify Studio の手順: ① Studio → アプリ作成 →「DSL をインポート」→ ② YAML を貼り付け（またはファイルをアップロード）→ ③ 作成。',
  ],
  [/imported to Dify: /g, 'Dify にインポート済み: '],
  // spec 064: the plugin advisory is now PLAIN (the old "unresolved_plugin_todo / plugin hash /
  // dependencies" jargon frames are retired — that jargon no longer reaches the user). Two deploy
  // variants, translated whole.
  [
    /this workflow relies on a Dify plugin — install it in Dify Studio → Plugins if a run reports it missing\./g,
    'このワークフローは Dify のプラグインを使用します — 実行時に「プラグインがありません」と出たら、Studio → Plugins でインストールしてください。',
  ],
  [
    /this workflow relies on a Dify plugin — install the plugins this workflow needs in Dify Studio → Plugins before importing \(otherwise the import fails\)\./g,
    'このワークフローは Dify のプラグインを使用します — インポート前に、必要なプラグインを Studio → Plugins でインストールしてください（未インストールだとインポートに失敗します）。',
  ],
  // spec 064: the preflight blocker details are now plain-language (runnability.ts), translated here
  // so the JA user reads them in Japanese rather than as a literal English needs-list.
  [
    /the AI model \(filled in automatically when you test — nothing to set up\)/g,
    'AI モデル（テスト実行時に自動で設定されます — 何もする必要はありません）',
  ],
  // spec 087 S3 — the CONDITIONAL variant (workspace model count unverifiable): the promise is kept
  // but scoped, so the JA user reads the same honesty the EN note carries.
  [
    /the AI model \(filled in automatically when you test, if your Dify has a model enabled — this could not be checked right now\)/g,
    'AI モデル（テスト実行時に自動で設定されます — ただし Dify でモデルが有効になっている場合です。今回は確認できませんでした）',
  ],
  [
    /a plugin this workflow needs — install it in Dify Studio → Plugins if a run reports it missing/g,
    'このワークフローに必要なプラグイン — 実行時に不足と出たら Studio → Plugins でインストールしてください',
  ],
  // spec 061: the plain-language tool post-import checklist (report.ts toolInstallNote — wording-stable).
  // $1 = the comma-joined tool name list, kept literal.
  [
    /this workflow uses these Dify tools: (.+?)\. Before you can run it: \(1\) install each from Studio → Plugins → Marketplace, \(2\) add an API key in the tool settings for any that need one, \(3\) run the workflow to test it\./g,
    'このワークフローは次の Dify ツールを使用します: $1。実行する前に: (1) Studio → Plugins → Marketplace から各ツールをインストール、(2) API キーが必要なツールはツール設定でキーを追加、(3) ワークフローを実行してテストしてください。',
  ],
  [
    /editing "([^"]+)": a Dify import always creates a NEW app \(a duplicate of "([^"]+)"\), never an in-place update — delete\/replace the old app in Dify after importing\./g,
    '"$1" を編集中: Dify インポートは常に新規アプリ（"$2" の複製）を作成し、既存アプリをその場で更新しません — インポート後に Dify で旧アプリを削除/置換してください。',
  ],
  // The overwrite path's honest middle case: the import meant to update the app this build made, but the
  // user had deleted it in Dify, so a new one exists after all. Frame emitted by import.ts (staleTarget).
  [
    /the Dify app this build previously imported no longer exists, so a NEW app was created instead of updating it\./g,
    'このビルドが以前インポートした Dify アプリは既に存在しないため、更新ではなく新しいアプリを作成しました。',
  ],
  // spec 037 S1 → reworded by spec 066 S5. `$1` = the blocker list; spec 064 already made each item
  // plain prose, so localizing the frame no longer leaves a literal English needs-list behind.
  [
    /Before this workflow can run, you need to: (.+?)\. \(The build itself is finished — these are setup steps in Dify\.\)/g,
    'このワークフローを実行する前に、次の準備が必要です: $1。（ビルド自体は完了しています — これらは Dify 側での設定作業です。）',
  ],
  // spec 066 S4 — the `deploy=none` (DEFAULT) path's two missing items. 057's trigger advisory was
  // gated to selfhost|cloud, and the only note naming the workflow file was gated to cloud, so the
  // default build was told neither to enable its trigger nor that the file exists — while its own
  // digest promised 「自動起動・自走」.
  // spec 095: re-worded on both sides. The old JA sentence told a user to flip a switch that is not on
  // that screen until the workflow is published — the same misdirection as the English it mirrored.
  [
    /This workflow starts on a schedule \(or a webhook\), so importing it is not enough: it begins firing on its own only once you PUBLISH it in Dify Studio\. After publishing, the app page lists the trigger with an on\/off switch; check that it is on\. \(Before you publish, that panel says no trigger has been added, even though the trigger is already in your draft\.\)/g,
    'このワークフローはスケジュール（または Webhook）で起動します。取り込むだけでは足りません — Dify Studio で「公開」して初めて自動起動が始まります。公開後、アプリ画面にトリガーがオン/オフのスイッチ付きで表示されるので、オンになっているか確認してください。（公開前はトリガーが下書きに入っていても、その欄には「トリガーがありません」と表示されます。）',
  ],
  // spec 095 — the webhook-only checklist note.
  [
    /Right after importing, Dify flags the webhook step with "webhook URL required" and will not let you publish yet\. That one is expected: the address for receiving data is issued by your Dify, not stored in the file\. Click that step once — the URL appears and the warning clears\. If any other item stays in the checklist, that is a real problem — send a screenshot\./g,
    '取り込んだ直後、Dify は Webhook のステップに「Webhook URL が必要です」と表示し、まだ公開させません。これは想定どおりです — データを受け取るアドレスはファイルではなく、お使いの Dify が発行するためです。そのステップを一度クリックすれば URL が表示され、警告は消えます。チェックリストに他の項目が残る場合は本当の不具合です — スクリーンショットをお送りください。',
  ],
  [
    /Your workflow file is (.+?) \(you can copy it from the main\.yml tab\)\. To use it: in Dify Studio choose Create app → "Import DSL", then paste the file in\./g,
    'ワークフローファイルは $1 です（main.yml タブからコピーできます）。使い方: Dify Studio で Create app →「Import DSL」を選び、ファイルの内容を貼り付けてください。',
  ],
  // The remaining two blocker details. `$1` = the module list, kept literal (they are import names).
  [
    /a code step uses (.+?), which Dify's sandbox does not provide — it needs rewriting with the standard library/g,
    'コードのステップが $1 を使っていますが、Dify のサンドボックスには入っていません — 標準ライブラリで書き直す必要があります',
  ],
  [
    /a knowledge base to search — pick one in Dify \(this step has none selected yet\)/g,
    '検索対象のナレッジベース — Dify で選択してください（このステップにはまだ未設定です）',
  ],
  // spec 066 S2/S3 — the two blocker DETAILS this spec adds. The wrapper frame above localizes and
  // keeps `$1` (the needs-list) literal, so without these a JA user reads a Japanese sentence with an
  // English list inside it: exactly the mixed render 064 set out to end. The whole 066 finding came
  // from a JP naive prompt, so this IS the primary audience.
  [
    /an AI model — add one in Dify first \(this workflow can't summarize or write without it\)/g,
    'AI モデル — 先に Dify で追加してください（これがないと要約や文章生成ができません）',
  ],
  [
    /a value for ([A-Za-z0-9_]+) — you'll paste this into Dify \(the workflow can't run without it\)/g,
    '$1 の値 — Dify に貼り付けてください（これがないとワークフローは実行できません）',
  ],
  // spec 095 S5 — the sixth blocker detail. `$1` = the tool's on-canvas label (e.g. "Tavily Search"),
  // kept literal: it is the string the user must find on their own screen, so translating it would
  // point at something that is not there (the affordance rule).
  [
    /a connection for (.+?) — open that step in Dify and connect it \(most tools need an API key or a sign-in\)\. Dify will not let you publish while it says authorization is required/g,
    '$1 の接続 — Dify で該当ステップを開いて接続してください（多くのツールは API キーかサインインが必要です）。「認証が必要」と表示されている間は公開できません',
  ],
  // spec 066 S4: the ④ import-probe verdicts. Previously had NO frame at all, so a JA user read
  // "import-probe: OK — Dify accepted this DSL (probe app deleted)" in raw English.
  [
    /Checked automatically: Dify accepts this workflow file\. \(A temporary copy named "([^"]+)" was left in Dify — you can delete it\.\)/g,
    '自動チェック済み: このワークフローファイルは Dify に取り込めます。（"$1" という一時コピーが Dify に残っています — 削除して構いません。）',
  ],
  [
    /Checked automatically: Dify accepts this workflow file\./g,
    '自動チェック済み: このワークフローファイルは Dify に取り込めます。',
  ],
  [
    /Could not check the import automatically \(/g,
    '取り込みの自動チェックができませんでした（',
  ],
  [/Dify rejected this workflow file — /g, 'Dify がこのワークフローファイルを受け付けませんでした — '],
  [
    /Could not check the import automatically: Dify held it for confirmation, which usually means the file's version and your Dify server don't match\./g,
    '取り込みの自動チェックができませんでした: Dify が確認待ちで保留したため — 通常はファイルのバージョンと Dify サーバーが一致していないことを意味します。',
  ],
  // spec 032: the live-test `reason` line (phase ④ summary). Two success variants + two failure variants.
  [
    /ran OK \(no model needed \(deterministic\), (.+?) tokens\) — review the output below/g,
    '実行成功（モデル不要（確定的）、$1 トークン）— 下記の出力を確認してください',
  ],
  [
    /ran OK \(auto-filled (\d+) node\(s\) with (.+?), (.+?) tokens\) — review the output below/g,
    '実行成功（$1 ノードを $2 で自動補完、$3 トークン）— 下記の出力を確認してください',
  ],
  [/workflow ran but FAILED: /g, 'ワークフローは実行されましたが失敗しました: '],
  [/workflow ran but produced no output/g, 'ワークフローは実行されましたが出力がありませんでした'],
  // spec 032 D8: the `need_input` park — the start-node has a variable whose type could not be
  // auto-filled. `$1` = the variable name(s), kept literal; `/reply` is a command, kept literal.
  [
    /need sample input for: (.+?) — provide it via \/reply then test again/g,
    'サンプル入力が必要です: $1 — /reply で入力してから再テストしてください',
  ],
  // spec 057 S4: the trigger-entry manual-enable advisory (report notes + the ④ live reason —
  // wording-stable in report.ts TRIGGER_ENTRY_NOTE).
  [
    /trigger-entry workflow: the run above was a manual fire — a schedule or webhook starts firing on its own only once you PUBLISH the workflow in Dify Studio\. After publishing, the app page lists the trigger with an on\/off switch; check that it is on\. \(Before you publish, that panel says no trigger has been added, even though the trigger is already in your draft\.\)/g,
    'トリガー起動のワークフローです。上の実行は手動実行でした — スケジュールや Webhook の自動起動は、Dify Studio で「公開」して初めて始まります。公開後、アプリ画面にトリガーがオン/オフのスイッチ付きで表示されるので、オンになっているか確認してください。（公開前はトリガーが下書きに入っていても、その欄には「トリガーがありません」と表示されます。）',
  ],
  // spec 032: the `infra_degraded` reason (live run couldn't reach Dify). Two backend prefixes wrap a
  // sync.py `_fmt_request_error` variant; translate the fixed phrases, keep the exception class name.
  [/run could not complete: /g, 'ライブ実行を完了できませんでした: '],
  [/run failed: /g, '実行失敗: '],
  [
    /connection failed \(DNS \/ unreachable \/ refused\) — (\w+)/g,
    '接続失敗（DNS 解決不可 / 到達不可 / 接続拒否）— $1',
  ],
  [/timeout after (.+?)s/g, 'タイムアウト（$1 秒）'],
  // ── spec 045: turn-failure triage notes (turn-runner.ts classifyTurnFailure — wording-stable) ──
  [
    /Claude CLI usage limit reached — builds cannot run until the limit resets\./g,
    'Claude CLIの利用上限に達しました — 上限がリセットされるまでビルドを実行できません。',
  ],
  [
    /Claude CLI is not authenticated on this machine — run `claude` in a terminal and log in\./g,
    'このマシンのClaude CLIが未認証です — ターミナルで `claude` を実行してログインしてください。',
  ],
  [
    /Cannot reach the Anthropic API from this machine \(network\/proxy\)\./g,
    'このマシンからAnthropic APIに接続できません（ネットワーク／プロキシ）。',
  ],
  [
    /failed to spawn claude process — is the `claude` CLI installed\?/g,
    'claudeプロセスを起動できませんでした — `claude` CLIはインストールされていますか？',
  ],
  [
    /process exited code (.+?) before a result event — stderr tail:/g,
    'プロセスが結果イベントの前に終了しました（exit $1）— stderr末尾:',
  ],
  [
    /phase timed out after (\d+)s — retry or simplify/g,
    'フェーズが $1 秒でタイムアウトしました — 再試行するか、要件を簡素化してください',
  ],
];

/** Localize a backend-built report `notes` string to the current language (spec 030 P2). EN passes
 *  through unchanged; JA translates each known frame, keeping interpolated slugs/URLs/paths literal.
 *  Reading lang.value subscribes the caller so a language toggle re-renders it. */
export function localizeNotes(notes: string): string {
  if (lang.value !== 'ja') return notes;
  let out = notes;
  for (const [re, ja] of NOTE_JA) out = out.replace(re, ja);
  return out;
}

/** Translate a key for the current language (EN fallback, then the raw key). Reading lang.value here
 *  subscribes the calling component, so a language switch re-renders it. */
export function t(key: string): string {
  const l = lang.value;
  return DICT[l][key] ?? EN[key] ?? key;
}

/** Like t(), with {placeholder} substitution. `{s}` is a convenience plural marker for English.
 *  The replacement is a function so a value containing `$` (e.g. a task name) is inserted literally,
 *  not interpreted as a String.replace special pattern ($&, $1, …). */
export function tf(key: string, params: Record<string, string | number>): string {
  let out = t(key);
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), () => String(v));
  }
  return out;
}

/** Localized phase label by canonical key (PHASE_LABELS stays the English index table for logic/tests). */
export function phaseLabel(key: PhaseKey): string {
  return t('phase_' + key);
}
