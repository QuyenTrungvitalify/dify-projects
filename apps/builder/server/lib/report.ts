/**
 * report.ts — Phase ④ Test&Report BACKEND (no claude turn), spec 009 Lát 2 + Lát 5.
 *
 * Re-runs the 4 linters (LINTERS — the shared 013 contract) on the produced workflow and synthesizes
 * `apps/builder/.runs/<taskId>/report.json` (shape per test.md :36–44). Deploy-aware (Lát 5):
 *   - `none`     → local only; `app_url`/`duplicate_warning` null.
 *   - `cloud`    → skip import (CSRF blocks auto); the notes carry the copyable-YAML + Studio steps.
 *   - `selfhost` → the import (push) is a SEPARATE step (orchestrator `runImportAndFinish`); this fn
 *                  writes the report and re-writes it with `app_url`/`duplicate_warning` after push.
 *
 * NEVER runs `sync.py` itself (that is `dify-io.ts`). The Dify token appears nowhere in the report.
 */
import { join } from 'node:path';
import { stat, writeFile, readFile } from 'node:fs/promises';
import { runPython } from './shell.js';
import { LINTERS, LINT_DETAIL_LINES, lintClean, type LintCodes } from './linters.js';
import { checkRunnability, preflightNote, sourceContractNote, hasUnresolvedPluginTodo } from './runnability.js';
import { patternFeatureGap, patternAdvisoryLine } from './analysis.js';
import { loadWorkspaceFacts, enabledModelCount } from './dify-io.js'; // spec 066 S3 / 067 S6
import { readEvents } from './run-events.js';
import { classifyCriteria, criteriaSummaryNote, summarizeTimeline } from './report-analysis.js'; // spec 075 S1
import { computePromoteHint } from './promote-hint.js'; // spec 078 S2
import type { Task } from '../state/task.js';
import type { SessionLogger } from './claude-session.js';

export interface ReportResult {
  ok: boolean;
  reasons: string[];
  reportRel: string;
  /** all 4 linters exited 0 — gates whether a selfhost build may show the Import button (AC #25). */
  lintClean: boolean;
}

export interface ReportOpts {
  /** the still-failing "Accept anyway" human override (§D / AC #25). */
  acceptedLintFailure?: boolean;
  /** selfhost: the clickable workflow URL after a successful import (else null). */
  appUrl?: string | null;
  /** selfhost edit-existing: the prominent "created a NEW app (duplicate)" warning (spec footgun). */
  duplicateWarning?: string | null;
  /** selfhost: a note when the app id could not be captured ("push may have completed — check Dify"). */
  importNote?: string | null;
  /** Spec 048 D2: ③'s lint exit codes from the SAME dispatched request — set ONLY by the windowless
   *  maybeAutoAdvance ③→④ hop (auto/spec_only/fast; turn lock held, so no edit window exists between
   *  the ③ verify and this report). When present AND clean, the report reuses the codes verbatim and
   *  skips both the 4 linter spawns and the preflight recompute (one shared guard — task.preflightNote
   *  is fresh from the same verify). Guarded by lintClean because a failing set would need the linters'
   *  output lines for the notes — unreachable from the hop anyway (auto HARD-STOPS at still_failing).
   *  NEVER populated from an HTTP payload (a client could otherwise skip a windowed re-run). */
  reuseLint?: LintCodes;
}

/**
 * D7 (spec 014): the edit-existing duplicate warning for a CLOUD or NONE build. Dify import always
 * creates a NEW app, so editing an existing workflow duplicates on ANY import path — cloud (the user
 * Studio-imports the YAML) and none (if they later import it), not only the selfhost push that
 * `runImportAndFinish` already warns about post-push. Returns null for a from-scratch build
 * (`task.workflow` unset) or the selfhost path (handled with app-url context by the importer). PURE.
 */
export function editExistingDuplicateWarning(task: Task): string | null {
  if (!task.workflow) return null;
  if (task.deploy !== 'cloud' && task.deploy !== 'none') return null;
  return (
    `editing "${task.workflow}": a Dify import always creates a NEW app (a duplicate of ` +
    `"${task.workflow}"), never an in-place update — delete/replace the old app in Dify after importing.`
  );
}

// D2 (spec 017): hasUnresolvedPluginTodo MOVED to runnability.ts (spec 037 S1 — runnability.ts
// uses it as its `plugin_todo` class predicate; keeping it here would make a report↔runnability
// import cycle). Re-exported so every existing consumer keeps importing it from report.ts.
export { hasUnresolvedPluginTodo };

/** Spec 057 S4 — the trigger-entry manual-enable advisory. ONE string, shared by the report notes
 *  (below) and the ④ live gate card (live-test.ts appends it to the parked result's reason). */
/**
 * Spec 105 — the ④ judge grades against `## Acceptance Criteria`, and when there are none it does not
 * run at all (`runJudge` returns null on an empty rubric). Everything downstream then reads as a clean
 * pass: the verdict stays `live-verified`, and the per-criterion ✓/✗ lines the reviewer looks for are
 * simply absent — which is indistinguishable, at a glance, from a rubric that had nothing to complain
 * about. The only honest difference is that ONE check ran (did it execute without erroring) instead of
 * that check plus the list.
 *
 * A rubric goes missing for reasons the reader cannot see: a workflow imported as a base and edited
 * directly (no ② ever wrote a spec), a spec whose criteria heading was translated, a parse that found
 * the section empty. None of those surface anywhere else, so the run says it here.
 */
// wording-stable (NOTE_JA keys off this)
export const NO_RUBRIC_NOTE =
  'no acceptance criteria were found for this build, so only ONE thing was checked: that the workflow ' +
  'ran without erroring. Nobody graded WHAT it produced. Add an `## Acceptance Criteria` section to ' +
  'SPEC.md and test again to have the output judged against it.';

/**
 * Spec 095 (2026-08-12) — CORRECTED. The previous wording sent users to Quick Settings right after
 * import to "ENABLE the trigger", and both halves of that were wrong:
 *
 *  1. ORDER. Before the workflow is published, that panel reads "no trigger added" — Dify only lists
 *     a trigger there once the workflow is PUBLISHED (observed on 1.15: the panel says the trigger
 *     "may already exist in the draft, takes effect after publishing"). A user following the old note
 *     went hunting for a switch that does not exist yet. That is exactly what happened.
 *  2. THE SWITCH IS ALREADY ON. Publishing raises `app_published_workflow_was_updated`, whose handler
 *     creates the AppTrigger row with `status=AppTriggerStatus.ENABLED`
 *     (api/events/event_handlers/update_app_triggers_when_app_published_workflow_updated.py). The
 *     switch in Quick Settings exists so you can turn it OFF, not because it starts off. So "until you
 *     enable it, it never fires" overstated a step that publishing performs.
 *
 * Read from vendor/dify-src @1.13 and NOT yet observed after a successful publish on 1.15 (the build
 * that surfaced all this could not be published at all), which is why the wording says CHECK the
 * switch rather than asserting it is already on. Both readings stay true, and the reader is pointed
 * at the right screen at the right moment either way.
 */
// wording-stable (NOTE_JA keys off this)
export const TRIGGER_ENTRY_NOTE =
  'trigger-entry workflow: the run above was a manual fire — a schedule or webhook starts firing on ' +
  'its own only once you PUBLISH the workflow in Dify Studio. After publishing, the app page lists ' +
  'the trigger with an on/off switch; check that it is on. (Before you publish, that panel says no ' +
  'trigger has been added, even though the trigger is already in your draft.)';

/**
 * Spec 095 — the webhook-only companion. A freshly imported webhook workflow ALWAYS shows a
 * pre-publish checklist item on the webhook step ("webhook URL required"), and publishing is blocked
 * until it clears — which reads like a broken file but is not one: the URL belongs to the Dify
 * instance, not to the file, and Dify mints it the moment that step's panel is opened (observed on
 * 1.15: the checklist went 3 → 2 the instant the node opened, with no typing and no publish).
 *
 * Deliberately says what to DO and what will be seen, and does not tell anyone to ignore a checklist
 * item — the one other item in that list on the same build was a real bug in our own YAML (the
 * missing `variables`), and a note that teaches "those warnings are normal" would have buried it.
 */
// wording-stable (NOTE_JA keys off this)
export const WEBHOOK_URL_NOTE =
  'Right after importing, Dify flags the webhook step with "webhook URL required" and will not let ' +
  'you publish yet. That one is expected: the address for receiving data is issued by your Dify, not ' +
  'stored in the file. Click that step once — the URL appears and the warning clears. If any other ' +
  'item stays in the checklist, that is a real problem — send a screenshot.';

/**
 * Spec 066 S4(a) — the SAME advisory for a `deploy: 'none'` build, which is the DEFAULT
 * (`task.ts` createTask) and the terminal state of any auto-mode run.
 *
 * Why a variant instead of ungating `TRIGGER_ENTRY_NOTE`: that string opens with "an API run is a
 * manual fire", which presumes a test run against Dify. A `none` build never contacts Dify at all, so
 * the clause would describe something that did not happen. (It is correct where it is used — the
 * selfhost/cloud report and `live-test.ts`'s parked-result reason, both of which DID run.)
 *
 * This is the note whose absence made the dossier lie: `analyze.json`'s digest promised
 * 「毎朝9時に自動起動…自走ワークフロー」 while the one sentence that would have saved the user — enable the
 * trigger, or it never fires — was written, tested, localized, and then withheld from precisely the
 * mode that needed it most.
 */
// wording-stable (NOTE_JA keys off this)
// Spec 095: same two corrections as TRIGGER_ENTRY_NOTE above — publish first, then CHECK the switch.
export const TRIGGER_ENABLE_NOTE =
  'This workflow starts on a schedule (or a webhook), so importing it is not enough: it begins ' +
  'firing on its own only once you PUBLISH it in Dify Studio. After publishing, the app page lists ' +
  'the trigger with an on/off switch; check that it is on. (Before you publish, that panel says no ' +
  'trigger has been added, even though the trigger is already in your draft.)';

/**
 * Spec 049 D2 / 066 S4 — the ④ import-probe verdicts, in ONE place.
 *
 * There are two probes (`orchestrator.ts`'s per-build one and `base-import.ts`'s per-base one) and
 * they used to carry their own copies of these four strings. That duplication is exactly why 066's
 * first pass rewrote one set and left the other emitting `import-probe: OK — Dify accepted this DSL
 * (probe app deleted)` — a divergence no test could see, because each producer was tested against its
 * own copy. One source, two callers.
 *
 * Wording (066 S4): plain, self-terminating, and NOTE_JA-framed. The old success line was four
 * internal terms plus an announcement that an app had been deleted — which a user reads as "my
 * workflow was thrown away". The FAILED branch keeps Dify's verbatim tail: 049 D3 needs it for a
 * ④ fix-turn, and `localizeNotes` leaves an unmapped tail literal by design.
 */
// wording-stable (NOTE_JA keys off these)
export const probeVerdict = {
  ok: (strayName?: string): string =>
    strayName
      ? `Checked automatically: Dify accepts this workflow file. (A temporary copy named "${strayName}" was left in Dify — you can delete it.)`
      : 'Checked automatically: Dify accepts this workflow file.',
  rejected: (detail: string): string =>
    `Dify rejected this workflow file — ${detail || 'no reason was reported'}`,
  parked: (): string =>
    "Could not check the import automatically: Dify held it for confirmation, which usually means the file's version and your Dify server don't match.",
  skipped: (reason: string): string => `Could not check the import automatically (${reason})`,
};

/** Spec 086 S1 — the probe verdict as a STRUCTURED value, derived from the minted note by prefix.
 *  Co-located with {@link probeVerdict} (the 085 `isTimeoutNote` discipline) so mint and match can
 *  never be reworded apart. `null` = no probe ran (e.g. the deploy path skipped it). Consumed by
 *  report.json (`probe`) so the campaign aggregator counts mechanically instead of grepping prose
 *  (the retired-notes_include lesson, 066 S5). */
export type ProbeStatus = 'ok' | 'failed' | 'unknown_version' | 'skipped';
export function probeStatus(note: string | undefined | null): ProbeStatus | null {
  if (!note) return null;
  if (note.startsWith('Checked automatically: Dify accepts')) return 'ok';
  if (note.startsWith('Dify rejected this workflow file')) return 'failed';
  if (note.startsWith('Could not check the import automatically: Dify held it')) return 'unknown_version';
  if (note.startsWith('Could not check the import automatically (')) return 'skipped';
  return null; // an unrecognized note is NOT evidence of any verdict — never guess
}

/** Spec 066 S4(b) — where the file IS, and what to do with it, for the `deploy: 'none'` default.
 *  `cloudStudioNote` was the ONLY note naming `wfRel`, and it is gated to `cloud` — so the default
 *  path left the user holding a YAML they did not know existed. It also opens with "Cloud deploy:
 *  auto-import is blocked by CSRF", which is both jargon and untrue here, so it cannot be reused. */
export function importFileNote(wfRel: string): string {
  return (
    `Your workflow file is ${wfRel} (you can copy it from the main.yml tab). ` +
    'To use it: in Dify Studio choose Create app → "Import DSL", then paste the file in.'
  );
}

/** Spec 057 S4 — pure-text predicate (the hasUnresolvedPluginTodo precedent): does the workflow
 *  YAML declare a trigger-* entry node (trigger-schedule / trigger-webhook / trigger-plugin)?
 *  Matches the node-body `type:` line, quoted or not. */
export function hasTriggerEntry(yamlText: string): boolean {
  return /^\s*type:\s*['"]?trigger-/m.test(yamlText);
}

/** Spec 095 — narrower than {@link hasTriggerEntry}: a `trigger-webhook` entry specifically. Only a
 *  webhook gets the "webhook URL required" checklist item, so only a webhook gets that note; a
 *  schedule-only build showing it would be describing a screen the reader will never see. */
export function hasWebhookEntry(yamlText: string): boolean {
  return /^\s*type:\s*['"]?trigger-webhook(['"]|\s|$)/m.test(yamlText);
}

/** Spec 061 — does the workflow declare a `tool` node (a plugin tool the target workspace must have)?
 *  Matches a node-body `type: tool` line; tolerates a trailing quote/comment but not `type: tool-*`. */
export function hasToolNode(yamlText: string): boolean {
  return /^\s*type:\s*['"]?tool(['"]|\s|$)/m.test(yamlText);
}

/** Does the DELIVERED workflow actually contain a node providing this analysis feature? The same
 *  pure-text `type:` predicate as hasTriggerEntry/hasToolNode, generalised over the feature vocabulary
 *  `patternFeatures` reads out of index.json (`has_<type>` → `<type>`, plus the computed `trigger`
 *  family key — mirror build_index.py, which sets has_trigger for ANY `trigger-*` node).
 *
 *  `file-input` is deliberately unhandled (it is a START-variable property, not a node type): it falls
 *  through to a `type:` match that cannot hit, so it stays in the gap — i.e. it degrades to today's
 *  ①-computed answer rather than being silently declared covered. */
export function deliveredFeature(yamlText: string, feature: string): boolean {
  if (feature === 'trigger') return hasTriggerEntry(yamlText);
  const esc = feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*type:\\s*['"]?${esc}(['"]|\\s|$)`, 'm').test(yamlText);
}

/** Spec 061 — the friendly name of EACH distinct `tool` node (prefer its own `tool_label`, else its
 *  `provider_name`). Pure text (no YAML parse — the backend delegates parsing to the python probes,
 *  and these predicates must tolerate malformed input like their siblings). Deduped, ordered.
 *
 *  Split by LIST ITEM, not by `type:`. The first cut split at each line-start `type:` and then read
 *  the label from the text AFTER the marker — which silently assumed `type: tool` precedes the label
 *  fields. It does in hand-written YAML, but a Dify export (and any `yaml.safe_dump` round-trip)
 *  sorts each `data:` block alphabetically, putting `type` LAST: every label then falls into the
 *  PREVIOUS segment and is lost. `hasToolNode` still fires, so the checklist rendered while naming
 *  nothing — "install each from Studio → Plugins" with no plugin named. A node is one `- ` item, so
 *  cutting there is order-independent by construction. */
export function toolLabels(yamlText: string): string[] {
  const seen = new Set<string>();
  // `^[ \t]*-[ \t]+` = a YAML list item at any indent (a node under `nodes:`). A node's own fields
  // are more deeply indented, so they never split. Non-node items (edges, prompt_template roles)
  // simply never contain a `type: tool` line.
  for (const block of yamlText.split(/^[ \t]*-[ \t]+/m)) {
    if (!/^[ \t]*type:[ \t]*['"]?tool['"]?[ \t]*$/m.test(block)) continue;
    const label =
      block.match(/^[ \t]*tool_label:[ \t]*['"]?([^'"\n]+?)['"]?[ \t]*$/m)?.[1] ??
      block.match(/^[ \t]*provider_name:[ \t]*['"]?([^'"\n]+?)['"]?[ \t]*$/m)?.[1];
    if (label) seen.add(label.trim());
  }
  return [...seen];
}

/** Spec 061 — the plain-language post-import checklist that REPLACES the developer-jargon plugin-hash
 *  note for a tool workflow. Names EVERY tool (not just the first). Wording-stable (i18n NOTE_JA keys
 *  off it); deliberately jargon-free — no "plugin hash"/"dependencies"/"provider_id" reaches the user
 *  (it also passes the spec-063 comprehension gate). Generic key wording ("any that need an API key")
 *  is honest across a multi-tool mix rather than mis-claiming a key for a keyless tool. */
/**
 * Spec 066 S5 — join the note parts so two sentences can NEVER fuse again. The real dossier read
 * "all linters passed preflight: not runnable out-of-the-box …" because `lintLine` shipped without a
 * terminator and `join(' ')` glued it to the next part — the result parses as a PASS and buries the
 * actual verdict mid-sentence. Rewording the offender fixes today's note; normalising at the SEAM
 * fixes every future note too, including parts this file doesn't own (`task.probeNote` comes from
 * orchestrator.ts, and its error/skip branches end with a verbatim tail nobody can punctuate at the
 * source). Structural, not cosmetic: it is what makes "every part self-terminates" TRUE rather than
 * a convention people remember to follow.
 * Terminators already present are left alone; `)` and `。` count (a JA-localized part, and the
 * "(… delete it.)" parenthetical). Empty/blank parts are dropped.
 */
export function joinNotes(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/[.!?。)]$/.test(p) ? p : `${p}.`))
    .join('\n');
}

export function toolInstallNote(labels: string[]): string {
  const list = labels.length ? labels.join(', ') : 'the tool it needs';
  return (
    `this workflow uses these Dify tools: ${list}. Before you can run it: ` +
    `(1) install each from Studio → Plugins → Marketplace, (2) add an API key in the tool settings ` +
    `for any that need one, (3) run the workflow to test it.`
  );
}

/** The Dify Studio manual-import steps for the cloud path (AC #9) — copyable YAML lives in main.yml. */
function cloudStudioNote(wfRel: string): string {
  return (
    'Cloud deploy: auto-import is blocked by CSRF, so import manually. The copyable YAML is the ' +
    `produced workflow (${wfRel}, shown in the main.yml tab). Steps in Dify Studio: ` +
    '① Studio → Create app → "Import DSL" → ② paste the YAML (or upload the file) → ③ Create.'
  );
}

export async function runReport(
  projectsDir: string,
  task: Task,
  log: SessionLogger,
  opts?: ReportOpts
): Promise<ReportResult> {
  const wfRel = `projects/${task.project}/${task.workflowSlug}/workflows/${task.workflowFile}`;

  // 1. Re-run the 4 linters (relative .venv/bin/python, cwd = projectsDir); capture exit codes.
  //    The list + clean-test come from the shared linter contract (013 D1) — the ③ gate and this ④
  //    report provably run the identical set, so a verdict can never drift between the two phases.
  //    Spec 048 D2: on the WINDOWLESS hop (opts.reuseLint, clean) the codes are ③'s own verify over
  //    the byte-identical file, so the re-run is skipped — and the preflight recompute below shares
  //    THIS guard (one `reuse` branch, deliberately: the two skips are valid for exactly the same
  //    no-edit-window reason and must never diverge). Every windowed path re-runs (037 r2).
  const reuse = opts?.reuseLint && lintClean(opts.reuseLint) ? opts.reuseLint : undefined;
  const lint: LintCodes = reuse
    ? { ...reuse }
    : { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 };
  const lintNotes: string[] = [];
  if (!reuse) {
    // D5 (spec 017): linters run concurrently, then folded in LINTERS order → the keyed exit codes and
    // the note order are identical to the former sequential loop. The ④ Import precondition (lintClean,
    // AC #25) reads only the codes, so the verdict is unchanged — only the wall-clock shrinks.
    const lintResults = await Promise.all(LINTERS.map((l) => runPython(projectsDir, [l.script, wfRel])));
    LINTERS.forEach((l, i) => {
      const r = lintResults[i];
      lint[l.key] = r.code;
      if (r.code !== 0) {
        const detail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-LINT_DETAIL_LINES).join(' ⏎ ');
        lintNotes.push(`${l.key} exit ${r.code}: ${detail}`);
      }
    });
  }
  const isLintClean = lintClean(lint);

  // D2 (spec 017): advisory — a left-over `dependencies: [] + # TODO plugin hash` lints clean but
  // breaks a selfhost/cloud import. Surface it as a NOTE; it NEVER feeds `lintClean` or the gate.
  // Spec 057 S4: same read also feeds the trigger-entry predicate (one file read, two advisories).
  let unresolvedPluginTodo = false;
  let triggerEntry = false;
  let webhookEntry = false; // spec 095: narrower than triggerEntry — only a webhook gets the URL note
  let toolNodePresent = false; // spec 075 S1: reused by the criteria classifier below
  let toolNote = ''; // spec 061: the plain-language tool checklist (empty ⇒ not a tool workflow)
  // The pattern-coverage advisory, RE-CHECKED against the delivered workflow. Seeded with ①'s line so
  // an unreadable file degrades to exactly today's behaviour (fail-open — never silently drop a warning).
  let patternNote: string | null = task.patternAdvisory ?? null;
  try {
    const yamlText = await readFile(join(projectsDir, wfRel), 'utf8');
    unresolvedPluginTodo = hasUnresolvedPluginTodo(yamlText);
    triggerEntry = hasTriggerEntry(yamlText);
    webhookEntry = hasWebhookEntry(yamlText);
    toolNodePresent = hasToolNode(yamlText);
    if (toolNodePresent) toolNote = toolInstallNote(toolLabels(yamlText));
    // task.patternAdvisory was computed at ① — BEFORE ③ wrote any YAML — so it can only compare the
    // analysis against the SEED template. ③ routinely closes that gap itself (a scheduled-fetch-notify
    // seed has no `iteration`, yet the build adds one for a per-row send), and a feature can also be
    // met by a different shape on purpose (row filtering folded into a `code` node instead of if-else).
    // Repeating ①'s line verbatim at ④ therefore sends the user hunting for a hole that isn't there.
    // Re-derive the gap and keep only what the delivered file really lacks.
    patternNote = patternAdvisoryLine(
      patternFeatureGap(projectsDir, task.analysisPattern ?? '', task.analysisFeatures).filter(
        (f) => !deliveredFeature(yamlText, f)
      )
    );
  } catch {
    /* unreadable workflow → the lint gate above already recorded the real failure; not our concern */
  }

  // Spec 037 S1 (r2) — RECOMPUTE the runnability preflight on the same workflow text: ④ is backend
  // (never the implement verify), so a human's ③-gate edit of main.yml followed by Confirm must not
  // ship a STALE preflightNote into report.json. Advisory only — a probe failure changes nothing.
  // Spec 048 D2: skipped under the SAME `reuse` guard as the linters — the windowless hop just set
  // task.preflightNote in ③'s verify over this identical file; only a windowed path can go stale.
  if (!reuse) {
    try {
      // Spec 066 S3: hand the classifier the fact that decides whether the model advisory may promise
      // auto-fill (043) — the workspace's enabled-model count. `enabledModelCount` returns undefined
      // when that number is not EVIDENCE (no harvest, or the models arm failed and wrote a `[]` that
      // means nothing — 067 S6); undefined gets the CONDITIONAL wording (087 S3) — the auto-fill
      // promise is only made as far as it was verified, still without inventing a scare.
      const pf = await checkRunnability(projectsDir, wfRel, undefined, {
        workspaceModelCount: enabledModelCount(await loadWorkspaceFacts(projectsDir, task.taskId)),
      });
      task.preflightNote = preflightNote(pf) ?? undefined;
      // Spec 072 S2 — the external-input contract, recomputed on the same file for the same reason.
      task.sourceContractNote = sourceContractNote(pf) ?? undefined;
    } catch {
      /* advisory — the lint gate above already surfaced any real unreadability */
    }
  }

  // 2. Synthesize report.json. `accepted_lint_failure` marks the still-failing "Accept anyway"
  //    human override (§D / AC #25). Deploy drives app_url / duplicate_warning / notes.
  const accepted = !!opts?.acceptedLintFailure;
  const appUrl = opts?.appUrl ?? null;
  // D7 (spec 014): selfhost passes its own post-push warning via `opts.duplicateWarning`; for the paths
  // with no separate import step (cloud/none edit-existing) we auto-compute it so they carry it too.
  const duplicateWarning = opts?.duplicateWarning ?? editExistingDuplicateWarning(task);
  // Spec 066 S5: plain + SELF-TERMINATING. "all linters passed" is jargon ("linter" → 「リンター」 is a
  // word a JA office worker never knew in English either), and it was the ONE note part with no
  // terminating punctuation — so `noteParts.join(' ')` below fused it into the next sentence, yielding
  // "all linters passed preflight: not runnable…", which parses as a PASS and buries the real verdict.
  // The lint-failure branch keeps its machine detail (dev-facing; localizeNotes leaves the tail literal).
  const lintLine = lintNotes.length
    ? `lint failures recorded: ${lintNotes.join('; ')}`
    : 'The workflow file passed every automated check.';

  const noteParts: string[] = [lintLine];
  // F4 (spec 010): a derived-slug collision was auto-suffixed at the Spec gate — record it so an `auto`
  // run (which never showed a gate) still surfaces the rename, and each_step has it in the report too.
  if (task.slugNote) noteParts.push(task.slugNote);
  // O2 (spec 019): carry the pattern-coverage advisory into the report too (an `auto` run never shows
  // the Analyze gate where it first appears). Advisory only — it never fails the build. Re-checked
  // against the delivered workflow above, so it names only what is STILL missing.
  if (patternNote) noteParts.push(patternNote);
  // Spec 037 S1: the runnability preflight line — an `auto` run never shows the ③ gate where it
  // first appears, so the report carries it too (the patternAdvisory precedent). Advisory only.
  if (task.preflightNote) noteParts.push(task.preflightNote);
  // Spec 049 D2: the import-probe verdict (real-Dify oracle). Advisory only — never feeds lintClean.
  // On FAILURE it carries Dify's verbatim (redacted) error: the exact input a "Request changes"
  // fix-turn needs (D3 recovery path).
  if (task.probeNote) noteParts.push(task.probeNote);
  if (accepted) noteParts.unshift('ACCEPTED with failing linters (human "Accept anyway" override).');
  // spec 064: `deploy=none` is a dev detail with no meaning to a user — kept on the structured
  // report.deploy field (below), dropped from the human note text.
  if (task.deploy === 'cloud') noteParts.push(cloudStudioNote(wfRel));
  // Spec 066 S4(b): the `none` default gets its own plain import line. Without it this path — the one
  // the dossier ran — named the file NOWHERE, and S5 had just retired its only other Dify-related
  // line (`deploy=none (no Dify contact).`), leaving it strictly less informative than before 066.
  if (task.deploy === 'none') noteParts.push(importFileNote(wfRel));
  if (task.deploy === 'selfhost') {
    if (appUrl) noteParts.push(`imported to Dify: ${appUrl}`);
    if (opts?.importNote) noteParts.push(opts.importNote);
  }
  // Spec 061: a tool workflow gets a PLAIN post-import checklist (install → set up → test) naming the
  // tool. Spec 067 S5b — gated on hasToolNode, NOT on the TODO marker: the plugin hash is public and
  // version-keyed, so a resolved `dependencies:` entry is now the CORRECT output (067 S1/S5), which
  // makes `unresolvedPluginTodo` false. Nesting this under the TODO would silently retire the checklist
  // exactly when a build finally uses a tool — the user still has to install the plugin and add its API
  // key, whether or not we resolved the hash for them.
  if (toolNote) noteParts.push(toolNote);
  // D2 (017): the unresolved-plugin-TODO advisory — the NON-tool remainder (a model-provider plugin).
  // Pushed (not unshifted) so the duplicate warning still leads.
  if (unresolvedPluginTodo && !toolNote) {
    // spec 064: plain — no "plugin hash"/"dependencies"/"# TODO" jargon (the raw
    // `unresolved_plugin_todo: true` field stays on report.json for dev/`/report`).
    const tail =
      task.deploy === 'none'
        ? 'install it in Dify Studio → Plugins if a run reports it missing.'
        : 'install the plugins this workflow needs in Dify Studio → Plugins before importing (otherwise the import fails).';
    noteParts.push(`this workflow relies on a Dify plugin — ${tail}`);
  }
  // Spec 057 S4 + 066 S4(a): a trigger workflow does NOTHING on its own until the trigger is ENABLED
  // in Dify Studio Quick Settings. EVERY deploy mode needs to hear that — 057 gated it to the paths
  // the app imports for, which silently excluded `none`, the DEFAULT. The `none` variant drops the
  // "an API run is a manual fire" clause (no run happened). Advisory only — never feeds lintClean.
  if (triggerEntry) {
    noteParts.push(task.deploy === 'none' ? TRIGGER_ENABLE_NOTE : TRIGGER_ENTRY_NOTE);
    // Spec 095: webhook-only, and it belongs BEFORE the source-contract note — the reader hits the
    // checklist the moment they open the workflow, long before they go wire up the caller. Gated on
    // the webhook node itself (not on `triggerEntry`), so a schedule-only build never sees it.
    if (webhookEntry) noteParts.push(WEBHOOK_URL_NOTE);
  }
  // Spec 072 S2 — a webhook entry also needs its SOURCE wired (enabling the trigger is necessary but
  // not sufficient: Google Form does not call a webhook by itself). Sits right after the enable note.
  if (task.sourceContractNote) noteParts.push(task.sourceContractNote);

  // Spec 075 S1: the build wrote its own acceptance criteria at ②, and until now NOTHING read them
  // back. Grade what a static ④ soundly can (asymmetric — see report-analysis.ts), surface the rest as
  // manual, and fold the timeline the run already logged. Best-effort: a missing/torn file → skip, the
  // report must never fail on its own analysis.
  let criteriaCheck: ReturnType<typeof classifyCriteria> = [];
  let timeline: ReturnType<typeof summarizeTimeline> | null = null;
  try {
    const runDirAbs = join(projectsDir, `apps/builder/.runs/${task.taskId}`);
    const raw = await readFile(join(runDirAbs, 'criteria.json'), 'utf8').catch(() => '');
    const criteria: string[] = raw ? (JSON.parse(raw).criteria ?? []) : [];
    criteriaCheck = classifyCriteria(criteria, {
      lintClean: isLintClean,
      hasTriggerEntry: triggerEntry,
      hasToolNode: toolNodePresent,
    });
    const note = criteriaSummaryNote(criteriaCheck);
    if (note) noteParts.push(note);
    // null (not an empty object) when no events were recorded — an unambiguous "no timeline" for consumers.
    const evs = await readEvents(runDirAbs);
    timeline = evs.length ? summarizeTimeline(evs) : null;
  } catch {
    // analysis is additive — never let it break the report the gate depends on.
  }
  // The duplicate warning leads the notes so the UI surfaces it prominently (spec footgun).
  if (duplicateWarning) noteParts.unshift(`⚠ ${duplicateWarning}`);

  // Spec 078 S2 — the self-harvest promote nudge: a from-scratch, lint-clean build whose shape is
  // absent from the curated shelf (LIVE `catalog.py check --shelf` parse) gets a DEV-ONLY hint
  // pointing at the existing Promote button. A separate report/task field, NEVER a noteParts entry
  // — notes are structurally user-facing (Chat.tsx render + build_userview), and the nudge in the
  // userview is an AUTO-FAIL comprehension case. Advisory: a catalog failure changes nothing.
  let promoteHint: string | null = null;
  try {
    promoteHint = await computePromoteHint(projectsDir, task, wfRel, isLintClean, runPython);
  } catch {
    /* advisory — the nudge must never break the ④ gate */
  }
  task.promoteHint = promoteHint ?? undefined;

  const report = {
    workflow_file: wfRel,
    lint: {
      validate: lint.validate,
      lint_refs: lint.lint_refs,
      lint_plugin_hashes: lint.lint_plugin_hashes,
      lint_node_bodies: lint.lint_node_bodies, // spec 038 P3 — the 4th LINTERS entry
    },
    deploy: task.deploy,
    app_url: appUrl,
    duplicate_warning: duplicateWarning,
    accepted_lint_failure: accepted,
    // Spec 086 S1 — ADDITIVE: the import-probe verdict as a structured value (see probeStatus).
    // `null` = no probe ran. The campaign aggregator reads THIS, never the prose in `notes`.
    probe: probeStatus(task.probeNote),
    // D2 (017): advisory only — recorded for the deploy step / UI; does NOT affect `lintClean`.
    unresolved_plugin_todo: unresolvedPluginTodo,
    // Spec 078 S2: dev-surface ONLY (devMode render) — deliberately a sibling of `notes`, never
    // inside it, so build_userview (digest+notes) structurally cannot leak it to the user.
    promote_hint: promoteHint,
    notes: joinNotes(noteParts),
    // Spec 075 S1 — ADDITIVE. The build's own acceptance criteria, each bucketed (auto_fail is sound,
    // auto_pass withheld to structural-only, else manual), plus the per-phase working timeline the run
    // already logged. Consumers that read the pre-075 fields are unaffected.
    criteria_check: criteriaCheck,
    timeline,
  };
  const reportRel = `apps/builder/.runs/${task.taskId}/report.json`;
  const reportAbs = join(projectsDir, reportRel);
  await writeFile(reportAbs, JSON.stringify(report, null, 2));
  task.artifacts.report = reportRel;

  // 3. Gate for ④ = report.json exists + non-empty (no result event — ④ is backend, not a turn).
  const reasons: string[] = [];
  let size = -1;
  try {
    size = (await stat(reportAbs)).size;
  } catch {
    reasons.push(`report.json missing: ${reportRel}`);
  }
  if (size === 0) reasons.push(`report.json empty: ${reportRel}`);
  if (lintNotes.length) log.warn({ taskId: task.taskId, lintNotes }, 'report: lint non-zero');

  return { ok: reasons.length === 0, reasons, reportRel, lintClean: isLintClean };
}
