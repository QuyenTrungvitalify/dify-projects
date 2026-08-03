/**
 * promote.ts — the `kind:'promote'` build flow for spec 052 (a gated, one-click "Promote to pattern"
 * door in the Builder). It orchestrates the full spec-050 pipeline behind a human review gate:
 *
 *   startPromote  → B1 mechanical eligibility gate (`promote_gate.py check`, D2)
 *                     ├─ eligible:false → park at the `promote_blocked` gate (NO turn, nothing written)
 *                     └─ eligible:true  → runDistillTurn
 *   runDistillTurn → ONE `claude` distill turn (D3): reads the source as untrusted DATA, writes the
 *                    distilled pattern to a STAGING path only (`apps/builder/.runs/<id>/promote/<slug>.yml`
 *                    — the 018 write-allowlist already permits the run dir; it CANNOT touch templates/).
 *                     → B2′ re-gate (`check <src> --distilled <staged>`, D4)
 *                        ├─ not clean → `promote_distill_failed` gate (Request-changes re-runs; Discard)
 *                        └─ clean     → record mechanical candidate rules (D4/B3) → `promote_review` gate
 *   promoteConfirm → the human 1-click Approve (D5) — the ONLY write to templates/patterns/. Finalize
 *                    (D6, BACKEND, outside any turn): stamp x-provenance → move staged → build_index +
 *                    check_provenance. A slug collision is surfaced (overwrite/rename), never silent.
 *   promoteReply   → "Request changes" at either gate → re-run the distill turn, note-steered.
 *
 * The phase FSM (orchestrator.ts) is UNTOUCHED (AC7): routes/tasks.ts delegates to these on
 * `task.kind==='promote'` BEFORE reaching confirmAdvance/replyWithin. `runPython` strips DIFY_* (shell.ts),
 * so both gate calls' import-probe degrades to `skipped` — the button never contacts Dify (D2).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readNestedScalar } from './artifacts.js';
import { deriveSlugName } from './slug.js';
import { ClaudeSession } from './claude-session.js';
import { renderPrompt } from './phases.js';
import { relocateRunArtifacts } from './scaffold.js';
import { buildHolderId, clearSession, isCancelled, setSession } from './lock.js';
import {
  emit,
  errMsg,
  resolveRunners,
  type OrchestratorCtx,
  type ConfirmPayload,
} from './orchestrator-shared.js';
import { computePromoteGate } from './gate.js';
import {
  finishShareSkipped,
  runSharePreflight,
  runShareShip,
  shareOfferEligible,
} from './share.js';
import { saveTask, type PromoteVerdict, type Task } from '../state/task.js';

const SKILL = '.claude/skills/dify-build';
const GATE_PY = 'tools/dify_base/promote_gate.py';
/** Per-turn wall-clock budget — the orchestrator's TURN_TIMEOUT_MS idiom (env-tunable, read once). */
const TURN_TIMEOUT_MS = Number(process.env.BUILDER_TURN_TIMEOUT_MS) || 10 * 60 * 1000;

/** The staging root for a promote task's distilled output — under the OWN run dir, which the 018
 *  write-allowlist already permits (so the turn structurally cannot write templates/ directly, D3/D6). */
export function stagedRel(task: Task): string {
  return `apps/builder/.runs/${task.taskId}/promote/${task.promote!.slug}.yml`;
}
const notesRel = (task: Task): string => `apps/builder/.runs/${task.taskId}/promote/notes.json`;
const targetRel = (slug: string): string => `templates/patterns/${slug}.yml`;

/** Parse `promote_gate.py check --json` stdout → verdict. The command prints ONLY the pretty JSON dump
 *  (linter subprocess output is captured internally), but be defensive: fall back to the {…} span. */
export function parseVerdict(stdout: string): PromoteVerdict | null {
  const attempt = (s: string): PromoteVerdict | null => {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      if (typeof o.eligible !== 'boolean') return null;
      return {
        eligible: o.eligible,
        reasons: Array.isArray(o.reasons) ? (o.reasons as string[]) : [],
        warnings: Array.isArray(o.warnings) ? (o.warnings as string[]) : [],
        probe: typeof o.probe === 'string' ? o.probe : 'skipped',
        probeDetail: typeof o.probe_detail === 'string' ? o.probe_detail : undefined,
        knownGoodDify: (o.known_good_dify as string | null | undefined) ?? null,
      };
    } catch {
      return null;
    }
  };
  const direct = attempt(stdout.trim());
  if (direct) return direct;
  const a = stdout.indexOf('{');
  const b = stdout.lastIndexOf('}');
  return a !== -1 && b > a ? attempt(stdout.slice(a, b + 1)) : null;
}

/** Run `promote_gate.py check <source> [--distilled <staged>] --json` via the injectable runPython seam.
 *  Exit code is 0 (eligible) / 1 (blocked) but ALWAYS carries the JSON, so we parse regardless of code. */
async function runGateCheck(
  task: Task,
  ctx: OrchestratorCtx,
  distilled?: string
): Promise<PromoteVerdict | null> {
  const { runPython } = resolveRunners(ctx);
  const args = [GATE_PY, 'check', task.promote!.sourceFile, '--json'];
  if (distilled) args.push('--distilled', distilled);
  const r = await runPython(ctx.projectsDir, args);
  const v = parseVerdict(r.stdout);
  if (!v) {
    ctx.log.warn({ taskId: task.taskId, code: r.code, tail: (r.stderr || r.stdout).slice(-300) }, 'promote gate: unparseable verdict');
  }
  return v;
}

// ───────────────────────────── entry: POST /api/promote ─────────────────────────────

/** B1 (D2): the mechanical eligibility gate FIRST — cheap + deterministic, no Dify side-effect. An
 *  ineligible source parks at `promote_blocked` immediately (no turn spawned, nothing written). */
export async function startPromote(task: Task, ctx: OrchestratorCtx): Promise<void> {
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);
  if (isCancelled(task.taskId)) return;

  const verdict = await runGateCheck(task, ctx);
  if (isCancelled(task.taskId)) return;
  if (!verdict) {
    task.status = 'error';
    task.error = 'promote gate did not return a verdict (see server log)';
    await emit(task, ctx);
    return;
  }
  task.promote!.verdict = verdict;
  if (!verdict.eligible) {
    task.status = 'awaiting_confirm';
    task.gate = computePromoteGate('blocked');
    task.promote!.note = verdict.reasons[0] ?? 'source is not eligible for promotion';
    await emit(task, ctx);
    return;
  }
  await runDistillTurn(task, ctx);
}

// ───────────────────────────── the distill turn (D3) + re-gate (D4) ─────────────────────────────

/** D3/D4 — spawn ONE `claude` distill turn writing to the STAGING path only, then re-gate the output.
 *  `noteText` (from a "Request changes") is appended to the prompt to steer the re-run. */
export async function runDistillTurn(task: Task, ctx: OrchestratorCtx, noteText?: string): Promise<void> {
  const { projectsDir, settingsPath, log } = ctx;
  const { runTurn } = resolveRunners(ctx);
  const p = task.promote!;
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);

  const staged = stagedRel(task);
  await mkdir(join(projectsDir, `apps/builder/.runs/${task.taskId}/promote`), { recursive: true });
  const body = await readFile(join(projectsDir, `${SKILL}/promote.md`), 'utf8');
  const rendered = renderPrompt(body, {
    TASK_ID: task.taskId,
    SOURCE_PATH: p.sourceFile,
    STAGED_PATH: staged,
    NOTES_PATH: notesRel(task),
    SLUG: p.slug,
    KNOWN_GOOD_DIFY: p.verdict?.knownGoodDify ?? '',
  });
  const CHANGE = '## Change request (revise the staged pattern; do not restart from scratch)';
  const prompt = noteText ? `${rendered}\n\n${CHANGE}\n${noteText}` : rendered;

  // NEVER spawn for a build that no longer owns the turn lock (mirrors runPhase's guard).
  if (isCancelled(task.taskId) || buildHolderId() !== task.taskId) {
    task.status = 'cancelled';
    task.gate = undefined;
    await saveTask(projectsDir, task);
    return;
  }

  log.info({ taskId: task.taskId }, 'spawning promote distill turn');
  const session = new ClaudeSession(`${task.taskId}:promote`, { taskId: task.taskId, workingDir: projectsDir, settingsPath, log });
  setSession(task.taskId, session);
  // spec 084: accumulate the streamed output alongside the live broadcast, so it can be persisted (below)
  // and replayed when the task is opened AFTER it finished (a bg distill's live SSE was never watched).
  let distillText = '';
  const turn = await runTurn(session, prompt, undefined, {
    timeoutMs: TURN_TIMEOUT_MS,
    onText: (text) => {
      distillText += text;
      ctx.broadcast?.(task.taskId, 'phase:output', { phase: 'test', text });
    },
  });
  clearSession(task.taskId);
  // Persist the narrative (replaces any prior run's log on a Request-changes/Resend re-run). Set before the
  // cancel/stage checks so even a cancelled or failed distill keeps its partial reasoning for review.
  p.distillLog = distillText || undefined;
  if (isCancelled(task.taskId)) {
    task.status = 'cancelled';
    task.gate = undefined;
    await emit(task, ctx);
    return;
  }

  // The turn may write to the shorthand `.runs/<id>/` (cwd=repo root) — relocate into the canonical
  // `apps/builder/.runs/<id>/` before reading the staged output (verifyPhase's precedent).
  await relocateRunArtifacts(projectsDir, task.taskId, log);

  const stagedAbs = join(projectsDir, staged);
  let stagedOk = false;
  try {
    const st = await stat(stagedAbs);
    stagedOk = st.size > 0;
  } catch {
    stagedOk = false;
  }
  if (!stagedOk) {
    await parkDistillFailed(task, ctx, turn.note ? [turn.note] : ['the distill turn produced no staged pattern']);
    return;
  }

  // B2′ (D4) — re-gate the OUTPUT: the placeholder transform is the one step that can silently break a
  // ref/schema, so re-linting the distilled file carries the source's guarantee forward.
  const reVerdict = await runGateCheck(task, ctx, staged);
  if (isCancelled(task.taskId)) return;
  if (!reVerdict) {
    task.status = 'error';
    task.error = 'promote re-gate did not return a verdict (see server log)';
    await emit(task, ctx);
    return;
  }
  p.verdict = reVerdict;
  p.staged = staged;
  if (!reVerdict.eligible) {
    await parkDistillFailed(task, ctx, reVerdict.reasons);
    return;
  }

  // B3 (D4) — route each MECHANICAL gotcha the turn surfaced into the linter-candidate channel (deduped
  // by promote_gate.py itself). DESIGN gotchas stay in the pattern's `# GOTCHA:` header (not automated).
  p.rules = await recordCandidateRules(task, ctx);

  task.promote!.target = targetRel(p.slug);
  task.promote!.note = undefined;
  // spec 084 (DEV): a `test` distill NEVER auto-finalizes — always park the review gate so repeated dev
  // testing writes nothing to the shelf. Approve is still reachable (then it's clearable via the tray).
  if (p.test) {
    task.status = 'awaiting_confirm';
    task.gate = computePromoteGate('review');
    await emit(task, ctx);
    return;
  }
  // spec 084 S2: auto-approve a NO-collision new pattern — skip the genericity `review` gate (accepted
  // for the 1-dev/own-build context, netted by the tray's report + 1-click [Undo]). The write STILL goes
  // through the single door `finalizePromotion`. A slug COLLISION is never auto-clobbered: park the
  // Overwrite / Save-as-new choice (`reviewCollision`) exactly as promoteConfirm would have at Approve.
  if (existsSync(join(projectsDir, targetRel(p.slug)))) {
    task.status = 'awaiting_confirm';
    task.gate = computePromoteGate('reviewCollision');
    task.promote!.note = `templates/patterns/${p.slug}.yml already exists — overwrite it or save as a new pattern.`;
    await emit(task, ctx);
    return;
  }
  await finalizePromotion(task, ctx, p.slug);
}

async function parkDistillFailed(task: Task, ctx: OrchestratorCtx, reasons: string[]): Promise<void> {
  task.status = 'awaiting_confirm';
  task.gate = computePromoteGate('distill_failed');
  task.promote!.note = reasons.filter(Boolean).join(' | ') || 'the distilled output failed the re-lint';
  await emit(task, ctx);
}

/** Read the turn's `promote/notes.json` (optional) and record each mechanical rule via `promote_gate.py
 *  candidate`. Best-effort — a missing/malformed notes file just records nothing. */
async function recordCandidateRules(task: Task, ctx: OrchestratorCtx): Promise<string[]> {
  const { runPython } = resolveRunners(ctx);
  let notes: { mechanicalRules?: { rule?: unknown; citation?: unknown }[] } | null = null;
  try {
    notes = JSON.parse(await readFile(join(ctx.projectsDir, notesRel(task)), 'utf8'));
  } catch {
    return [];
  }
  const recorded: string[] = [];
  for (const m of notes?.mechanicalRules ?? []) {
    const rule = typeof m.rule === 'string' ? m.rule.trim() : '';
    const citation = typeof m.citation === 'string' ? m.citation.trim() : '';
    if (!rule || !citation) continue;
    try {
      await runPython(ctx.projectsDir, [GATE_PY, 'candidate', '--rule', rule, '--citation', citation]);
      recorded.push(rule);
    } catch (e) {
      ctx.log.warn({ taskId: task.taskId, err: errMsg(e) }, 'promote candidate record failed (non-fatal)');
    }
  }
  return recorded;
}

// ───────────────────────────── gate actions (delegated on kind==='promote') ─────────────────────────────

/** POST /confirm for a promote task (D5/D6). `approve` finalizes; on a slug collision it re-parks with the
 *  overwrite/rename choice; `approve_overwrite`/`approve_rename` resolve that choice. */
export async function promoteConfirm(
  task: Task,
  actionId: string,
  ctx: OrchestratorCtx,
  _payload?: ConfirmPayload
): Promise<void> {
  const p = task.promote!;
  if (task.status !== 'awaiting_confirm') {
    return; // stale/no-op — the route already validated the action is current, but re-guard defensively
  }
  // Spec 081 — the post-finalize share gates. Both are /confirm-only (a "no" is `share_skip`, never a
  // cancel — the promotion itself is already done and must not read as cancelled).
  if (task.gate?.flag === 'promote_share_offer') {
    if (actionId === 'share') return runSharePreflight(task, ctx);
    if (actionId === 'share_skip') return finishShareSkipped(task, ctx);
    return;
  }
  if (task.gate?.flag === 'promote_share_review') {
    if (actionId === 'share_confirm') return runShareShip(task, ctx);
    if (actionId === 'share_skip') return finishShareSkipped(task, ctx);
    return;
  }
  if (task.gate?.flag !== 'promote_review') {
    return;
  }
  if (!p.staged || !existsSync(join(ctx.projectsDir, p.staged))) {
    task.status = 'error';
    task.error = 'the staged pattern is missing — re-run the distill (Request changes)';
    await emit(task, ctx);
    return;
  }

  if (actionId === 'approve') {
    // Collision → never silently clobber (D6): surface the overwrite/rename choice.
    if (existsSync(join(ctx.projectsDir, targetRel(p.slug)))) {
      task.gate = computePromoteGate('reviewCollision');
      p.note = `templates/patterns/${p.slug}.yml already exists — overwrite it or save as a new pattern.`;
      await emit(task, ctx);
      return;
    }
    await finalizePromotion(task, ctx, p.slug);
    return;
  }
  if (actionId === 'approve_overwrite') {
    await finalizePromotion(task, ctx, p.slug);
    return;
  }
  if (actionId === 'approve_rename') {
    await finalizePromotion(task, ctx, firstFreePatternSlug(ctx.projectsDir, p.slug));
    return;
  }
}

/** POST /reply for a promote task — "Request changes" at the review or distill-failed gate re-runs the
 *  distill turn, note-steered against the SAME source. Only those two gates offer a reply; the route guards
 *  this, but re-guard here so a distill is NEVER re-run from the blocked gate (B1: ineligible → nothing
 *  written) regardless of caller. */
export async function promoteReply(task: Task, text: string, ctx: OrchestratorCtx): Promise<void> {
  if (task.gate?.flag !== 'promote_review' && task.gate?.flag !== 'promote_distill_failed') return;
  await runDistillTurn(task, ctx, text);
}

// ───────────────────────────── finalize (D6, BACKEND — gated by Approve) ─────────────────────────────

/** The move `staging → templates/patterns/` + x-provenance stamp + INDEX/provenance rebuild. Runs in the
 *  backend AFTER the human Approve (outside any turn — the human gate is the control, D6). */
async function finalizePromotion(task: Task, ctx: OrchestratorCtx, slug: string): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runPython } = resolveRunners(ctx);
  const p = task.promote!;
  task.status = 'running';
  task.gate = undefined;
  await emit(task, ctx);

  const target = targetRel(slug);
  const stagedAbs = join(projectsDir, p.staged!);
  const targetAbs = join(projectsDir, target);
  const stagedContent = await readFile(stagedAbs, 'utf8');
  // spec 070: an external (pasted) source stamps honest provenance (source=external + declared license +
  // content hash); a local project workflow stays byte-identical to spec 052 (source=original/MIT).
  const header = provenanceHeader(
    p.sourceFile,
    p.verdict?.knownGoodDify ?? '',
    p.origin === 'external' ? { label: p.originLabel, sha256: p.originSha256, license: p.license } : undefined
  );
  // Stamp the x-provenance header (LAST-write comment convention) and move to the curated tier.
  await mkdir(join(projectsDir, 'templates/patterns'), { recursive: true });
  await writeFile(targetAbs, header + stagedContent);
  await unlink(stagedAbs).catch(() => {}); // best-effort move (the run dir dies with the task anyway)

  // INDEX + provenance rebuild — the exact commands the template-promote skill runs.
  const idx = await runPython(projectsDir, ['tools/dify_base/build_index.py']);
  // A /cancel could have raced the (childless) INDEX rebuild — respect it rather than clobber `cancelled`
  // back to `done` (the pattern file is already written; a stray file is preferable to a lying status).
  if (isCancelled(task.taskId)) return;
  if (idx.code !== 0) {
    log.warn({ taskId: task.taskId, tail: (idx.stderr || idx.stdout).slice(-300) }, 'build_index after promote failed (non-fatal)');
    p.note = 'pattern promoted, but the INDEX rebuild reported an error — re-run tools/dify_base/build_index.py';
  } else {
    await runPython(projectsDir, ['tools/dify_base/check_provenance.py']).catch(() => undefined);
    p.note = undefined;
  }
  p.target = target;
  p.slug = slug;
  // Spec 081 — when this workspace can share (origin remote + shareable provenance), park at the
  // share-offer gate instead of ending. False-safe: any doubt ⇒ the exact pre-081 terminal state.
  if (await shareOfferEligible(task, ctx)) {
    task.status = 'awaiting_confirm';
    task.gate = computePromoteGate('share_offer');
  } else {
    task.status = 'done';
    task.gate = { actions: [] };
  }
  await emit(task, ctx);
}

/** spec 084 S2 — Undo an auto-approved promotion: the INVERSE of finalizePromotion, kept deliberately
 *  simple (NO git — the 074 clean-copy has users without it). Unlink `templates/patterns/<slug>.yml` +
 *  rebuild INDEX/provenance (the exact runPython commands finalize uses), so the catalog never dangles a
 *  pattern that no longer exists. A missing target (already removed / overwritten) is a NO-OP, not an
 *  error — the tray's [Undo] is "instant regret", idempotent by design. */
export async function undoPromotion(task: Task, ctx: OrchestratorCtx): Promise<{ removed: boolean }> {
  const { projectsDir } = ctx;
  const { runPython } = resolveRunners(ctx);
  const slug = task.promote?.slug;
  if (!slug) return { removed: false };
  const targetAbs = join(projectsDir, targetRel(slug));
  let removed = false;
  if (existsSync(targetAbs)) {
    await unlink(targetAbs).catch(() => {});
    removed = true;
  }
  // Rebuild the catalog whether or not the file was present (a prior partial state could still be stale).
  await runPython(projectsDir, ['tools/dify_base/build_index.py']).catch(() => undefined);
  await runPython(projectsDir, ['tools/dify_base/check_provenance.py']).catch(() => undefined);
  return { removed };
}

/** The x-provenance header (spec 052 D6), following the `template-promote` pattern-target convention
 *  (the committed `templates/patterns/per-row-notify.yml` header verbatim): `source=original`, a MIT
 *  license stamp, `spec=052`, and `known_good_dify` from the B1 verdict (empty when the probe skipped).
 *  `orig_sha256` is deliberately empty — a `source=original` pattern has no upstream file to hash against;
 *  `check_provenance.py`'s content axis skips it for originals (the committed per-row-notify.yml, which has
 *  the same empty field, classifies `current`). */
export function provenanceHeader(
  sourceFile: string,
  knownGoodDify: string,
  external?: { label?: string; sha256?: string; license?: string }
): string {
  const today = new Date().toISOString().slice(0, 10);
  // spec 070 D3 — an EXTERNAL (pasted/uploaded) source is NEVER stamped source=original/MIT: that would
  // falsely claim third-party work as ours on a redistributed shelf. Stamp honestly (source=external + the
  // declared license + a content hash); check_provenance.py then CORRECTLY classifies it orphan/license-
  // review (warn-only in CI). The local (project-workflow) path below is byte-identical to spec 052.
  if (external) {
    const label = external.label || sourceFile;
    const license = external.license || 'unknown';
    return (
      `# x-provenance: source=external repo=\n` +
      `#   commit= file="${label}" orig_sha256=${external.sha256 ?? ''} promoted=${today}\n` +
      `#   license=${license} spec=070 known_good_dify=${knownGoodDify}\n`
    );
  }
  return (
    `# x-provenance: source=original repo=\n` +
    `#   commit= file="${sourceFile}" orig_sha256= promoted=${today}\n` +
    `#   license=MIT spec=052 known_good_dify=${knownGoodDify}\n`
  );
}

/** spec 070 — resolve a PASTED/uploaded YAML (a source that exists in no project) into a house-style
 *  pattern slug + a content hash. The slug derives from `app.name` (`deriveSlugName` handles JP → ASCII),
 *  then is hyphenated to the templates/patterns/ convention. The bytes are hashed for honest provenance. */
export function resolvePastedPromoteSource(
  yaml: string
): { ok: true; slug: string; sha256: string } | { ok: false; status: number; error: string } {
  if (!yaml.trim()) return { ok: false, status: 400, error: 'yaml is required (the workflow contents)' };
  const appName = readNestedScalar(yaml, 'app', 'name') ?? '';
  const base = deriveSlugName(appName).slug; // JP-only app.name → GENERIC_SLUG 'workflow'
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'pattern';
  const sha256 = createHash('sha256').update(yaml, 'utf8').digest('hex');
  return { ok: true, slug, sha256 };
}

/** The first free `templates/patterns/<slug>[-2,-3,…].yml` (hyphen-suffixed to match the pattern
 *  filename convention). Used when the human chooses "Save as a new pattern" on a collision. */
export function firstFreePatternSlug(projectsDir: string, slug: string): string {
  const free = (s: string): boolean => !existsSync(join(projectsDir, targetRel(s)));
  if (free(slug)) return slug;
  for (let n = 2; n < 1000; n++) {
    const cand = `${slug}-${n}`;
    if (free(cand)) return cand;
  }
  return `${slug}-${Date.now()}`;
}

// ───────────────────────────── source resolution (used by the route) ─────────────────────────────

/** Resolve + validate the promotion source `{project, workflow}` → a repo-relative source file, or an
 *  error the route maps to HTTP. Confinement: the components must be plain path segments (no traversal),
 *  and the workflow's `main.yml` must exist on disk. Also derives the house-style pattern slug. */
export function resolvePromoteSource(
  projectsDir: string,
  project: string,
  workflow: string
): { ok: true; sourceFile: string; slug: string } | { ok: false; status: number; error: string } {
  const clean = (s: string): boolean => /^[A-Za-z0-9._-]+$/.test(s) && !s.includes('..');
  if (!project || !workflow) return { ok: false, status: 400, error: 'project and workflow are required' };
  if (!clean(project) || !clean(workflow)) {
    return { ok: false, status: 400, error: 'project/workflow must be plain path segments (no separators or "..")' };
  }
  const sourceFile = `projects/${project}/${workflow}/workflows/main.yml`;
  if (!existsSync(join(projectsDir, sourceFile))) {
    return { ok: false, status: 404, error: `no workflow at ${sourceFile}` };
  }
  // House-style pattern slug: the workflow folder name, hyphenated (templates/patterns/ uses hyphens).
  const slug = workflow.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'pattern';
  return { ok: true, sourceFile, slug };
}
