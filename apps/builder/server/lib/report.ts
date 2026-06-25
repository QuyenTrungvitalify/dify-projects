/**
 * report.ts — Phase ④ Test&Report BACKEND (no claude turn), spec 009 Lát 2 + Lát 5.
 *
 * Re-runs the 3 linters on the produced workflow and synthesizes
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
import type { Task } from '../state/task.js';
import type { SessionLogger } from './claude-session.js';

export interface ReportResult {
  ok: boolean;
  reasons: string[];
  reportRel: string;
  /** all 3 linters exited 0 — gates whether a selfhost build may show the Import button (AC #25). */
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

/**
 * D2 (spec 017): does the produced workflow still carry an UNRESOLVED plugin TODO? PURE.
 *
 * The documented authoring convention (AGENTS.md §4.3) is: a workflow that needs a marketplace
 * plugin leaves `dependencies: []` and a `# TODO: add plugin hash from target workspace` marker.
 * The three linters PASS that (an empty `dependencies` is valid format — `lint_plugin_hashes` only
 * rejects a malformed *present* hash), so a `selfhost`/`cloud` import would later fail for the
 * missing plugin with no earlier signal. This textual check is that signal. It is ADVISORY: the
 * caller records it as a NOTE and never lets it flip `lintClean` or block a build.
 *
 * Detection (conservative, no YAML dep): a comment line carrying TODO + "plugin" + "hash" AND an
 * empty inline `dependencies: []` (optionally with a trailing inline `# comment`; a populated
 * block-style `dependencies:` means the hash was filled in, so the marker is stale text, not a
 * live gap → not flagged).
 */
export function hasUnresolvedPluginTodo(yamlText: string): boolean {
  const todoMarker = yamlText
    .split('\n')
    .some((line) => /#\s*todo\b/i.test(line) && /plugin/i.test(line) && /hash/i.test(line));
  if (!todoMarker) return false;
  // `(#.*)?` tolerates a trailing inline comment, e.g. `dependencies: []  # TODO add plugin hash`
  // — the form an authoring turn often emits. Without it the `$` anchored right after `]`, so the
  // inline-comment form slipped past the check (false negative). (spec 017 D2 hardening)
  return /^[ \t]*dependencies:[ \t]*\[[ \t]*\][ \t]*(#.*)?$/m.test(yamlText);
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
  const slug = task.slug!;
  const wfRel = `projects/${slug}/workflows/${task.workflowFile}`;

  // 1. Re-run the 3 linters (relative .venv/bin/python, cwd = projectsDir); capture exit codes.
  //    The list + clean-test come from the shared linter contract (013 D1) — the ③ gate and this ④
  //    report provably run the identical set, so a verdict can never drift between the two phases.
  const lint: LintCodes = { validate: 0, lint_refs: 0, lint_plugin_hashes: 0 };
  const lintNotes: string[] = [];
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
  const isLintClean = lintClean(lint);

  // D2 (spec 017): advisory — a left-over `dependencies: [] + # TODO plugin hash` lints clean but
  // breaks a selfhost/cloud import. Surface it as a NOTE; it NEVER feeds `lintClean` or the gate.
  let unresolvedPluginTodo = false;
  try {
    unresolvedPluginTodo = hasUnresolvedPluginTodo(await readFile(join(projectsDir, wfRel), 'utf8'));
  } catch {
    /* unreadable workflow → the lint gate above already recorded the real failure; not our concern */
  }

  // 2. Synthesize report.json. `accepted_lint_failure` marks the still-failing "Accept anyway"
  //    human override (§D / AC #25). Deploy drives app_url / duplicate_warning / notes.
  const accepted = !!opts?.acceptedLintFailure;
  const appUrl = opts?.appUrl ?? null;
  // D7 (spec 014): selfhost passes its own post-push warning via `opts.duplicateWarning`; for the paths
  // with no separate import step (cloud/none edit-existing) we auto-compute it so they carry it too.
  const duplicateWarning = opts?.duplicateWarning ?? editExistingDuplicateWarning(task);
  const lintLine = lintNotes.length
    ? `lint failures recorded: ${lintNotes.join('; ')}`
    : 'all linters passed';

  const noteParts: string[] = [lintLine];
  // F4 (spec 010): a derived-slug collision was auto-suffixed at the Spec gate — record it so an `auto`
  // run (which never showed a gate) still surfaces the rename, and each_step has it in the report too.
  if (task.slugNote) noteParts.push(task.slugNote);
  // O2 (spec 019): carry the pattern-coverage advisory into the report too (an `auto` run never shows
  // the Analyze gate where it first appears). Advisory only — it never fails the build.
  if (task.patternAdvisory) noteParts.push(task.patternAdvisory);
  if (accepted) noteParts.unshift('ACCEPTED with failing linters (human "Accept anyway" override).');
  if (task.deploy === 'none') noteParts.push('deploy=none (no Dify contact).');
  if (task.deploy === 'cloud') noteParts.push(cloudStudioNote(wfRel));
  if (task.deploy === 'selfhost') {
    if (appUrl) noteParts.push(`imported to Dify: ${appUrl}`);
    if (opts?.importNote) noteParts.push(opts.importNote);
  }
  // D2 (017): the unresolved-plugin-TODO advisory. Pushed (not unshifted) so the duplicate warning
  // still leads; phrased as "before import" only for the deploy paths that actually import.
  if (unresolvedPluginTodo) {
    const tail =
      task.deploy === 'none'
        ? 'add the plugin hash before deploying.'
        : 'add the plugin hash from the target workspace BEFORE import (the import will fail otherwise).';
    noteParts.push(`unresolved_plugin_todo: dependencies are empty but a "# TODO add plugin hash" remains — ${tail}`);
  }
  // The duplicate warning leads the notes so the UI surfaces it prominently (spec footgun).
  if (duplicateWarning) noteParts.unshift(`⚠ ${duplicateWarning}`);

  const report = {
    workflow_file: wfRel,
    lint: {
      validate: lint.validate,
      lint_refs: lint.lint_refs,
      lint_plugin_hashes: lint.lint_plugin_hashes,
    },
    deploy: task.deploy,
    app_url: appUrl,
    duplicate_warning: duplicateWarning,
    accepted_lint_failure: accepted,
    // D2 (017): advisory only — recorded for the deploy step / UI; does NOT affect `lintClean`.
    unresolved_plugin_todo: unresolvedPluginTodo,
    notes: noteParts.join(' '),
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
