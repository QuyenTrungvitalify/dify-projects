/**
 * share.ts — spec 081 + 083: the post-promote "share upstream" turn.
 *
 * After `finalizePromotion` lands a pattern on the LOCAL shelf, this module carries it the last
 * mile: offer → preflight (leak scan + near-dup) → the contributor's confirm → ship. Two
 * transports behind the SAME gates (spec 083 — the gates are the contract, the transport is a
 * detail):
 *   - drop (primary): HTTP POST `{yaml, meta}` to the team's drop URL (`.dify-share.json` —
 *     an admin-deployed Apps Script writing into the admin's Drive, tools/share_inbox/). Zero
 *     per-user setup: the config ships in the repo. The admin sweeps the inbox via /shelf-inbox.
 *   - git (fallback, spec 081): a `contrib/<slug>-<date>` branch pushed to `origin` carrying
 *     EXACTLY two paths (pattern + INDEX.md); contrib-pr.yml opens the PR. Needs push rights.
 *
 * Git discipline (the 074 B-series lessons): the user's checkout is NEVER touched. The commit is
 * built in a THROWAWAY `git worktree` under the OS tmpdir — no branch switching in the user's
 * working tree, no interaction with their staging area, no dirty-file sweep is even possible.
 * Every failure (git or HTTP) returns a human-actionable message; nothing is swallowed.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { hostname, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { computePromoteGate } from './gate.js';
import { isCancelled } from './lock.js';
import { emit, resolveRunners, type FetchLike, type OrchestratorCtx } from './orchestrator-shared.js';
import { loadLocalSettings, localOverride } from './settings.js';
import type { ShellResult } from './shell.js';
import type { PromoteShareFinding, PromoteState, Task } from '../state/task.js';

type RunGit = (projectsDir: string, args: string[]) => Promise<ShellResult>;
type RunPython = (projectsDir: string, args: string[]) => Promise<ShellResult>;

const GATE_PY = 'tools/dify_base/promote_gate.py';
const CATALOG_PY = 'tools/dify_base/catalog.py';

/** Mirror of `tools/dify_base/sources.py::PERMISSIVE_LICENSES` (the promote/redistribution gate).
 *  A TS mirror, not a subprocess: the set changes ~never, and the python side re-checks at review
 *  time anyway (check_provenance license hygiene) — drift degrades to a wrongly-hidden offer, never
 *  to a wrong share. */
const PERMISSIVE = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Unlicense', 'CC0-1.0', 'CC-BY-4.0',
]);

/** Spec 081 §3 — an EXTERNAL (pasted) source with an unknown/non-permissive license must never be
 *  redistributed to the shared shelf. A local promote is always shareable (source=original + MIT). */
export function shareableProvenance(p: PromoteState): boolean {
  if (p.origin !== 'external') return true;
  return PERMISSIVE.has(p.license ?? '');
}

/** Is this workspace a git clone with an `origin` to push to? Any git failure ⇒ no (the share offer
 *  simply doesn't appear — a workspace without a remote has nowhere to share to). */
export async function hasOriginRemote(projectsDir: string, runGit: RunGit): Promise<boolean> {
  try {
    return (await runGit(projectsDir, ['remote', 'get-url', 'origin'])).code === 0;
  } catch {
    return false;
  }
}

// ── the drop transport's config (spec 083) ──────────────────────────────────────────────────────

export interface ShareConfig {
  url: string;
  secret?: string;
  maxKb: number;
}

/** Read the tracked team config `.dify-share.json` (committed at the repo root, the `.dify-tag`
 *  precedent). A raw parse — no https gate here — used both as the drop config base and as the
 *  "team default" the dev Settings modal displays. */
export async function loadTrackedShare(
  projectsDir: string
): Promise<{ url?: string; secret?: string; maxKb?: number } | null> {
  try {
    const raw = JSON.parse(await readFile(join(projectsDir, '.dify-share.json'), 'utf8')) as Record<string, unknown>;
    return {
      url: typeof raw.url === 'string' ? raw.url.trim() : undefined,
      secret: typeof raw.secret === 'string' && raw.secret ? raw.secret : undefined,
      maxKb: typeof raw.maxKb === 'number' && raw.maxKb > 0 ? raw.maxKb : undefined,
    };
  } catch {
    return null;
  }
}

/** The EFFECTIVE drop config: the local dev-settings override (`.dify-settings.local.json`, per
 *  machine) layered over the team file. Null when no https url resolves — every null falls back to
 *  the git path, so a broken/empty config degrades, never breaks a promote. */
export async function loadShareConfig(projectsDir: string): Promise<ShareConfig | null> {
  const tracked = await loadTrackedShare(projectsDir);
  const local = await loadLocalSettings(projectsDir);
  const url = String(local['share.url'] ?? tracked?.url ?? '').trim();
  if (!url.startsWith('https://')) return null;
  const secretRaw = local['share.secret'] ?? tracked?.secret;
  const maxKbRaw = local['share.maxKb'] ?? tracked?.maxKb;
  const maxKb = typeof maxKbRaw === 'number' ? maxKbRaw : Number(maxKbRaw);
  return {
    url,
    secret: secretRaw != null ? String(secretRaw) : undefined,
    maxKb: Number.isFinite(maxKb) && maxKb > 0 ? maxKb : 512,
  };
}

/** Whether finalize should park at the share-offer gate instead of ending at `done`. False-safe:
 *  any error reads as "not eligible" so a promote NEVER fails on the share seam. Spec 083: a
 *  configured drop URL is eligible on its own (no git needed anywhere on the user machine);
 *  otherwise the 081 origin probe decides the git fallback. */
export async function shareOfferEligible(task: Task, ctx: OrchestratorCtx): Promise<boolean> {
  try {
    const p = task.promote;
    if (!p?.target || !shareableProvenance(p)) return false;
    if (await loadShareConfig(ctx.projectsDir)) return true;
    return await hasOriginRemote(ctx.projectsDir, resolveRunners(ctx).runGit);
  } catch {
    return false;
  }
}

// ── preflight (leak scan + near-dup) ────────────────────────────────────────────────────────────

export interface SharePreflightResult {
  findings: PromoteShareFinding[];
  /** one-line near-dup verdict for the human + the commit metadata ('new' | 'near-dup of …'). */
  dup?: string;
  /** a tool that failed to run/parse is REPORTED, never silently treated as clean. */
  note?: string;
}

export async function sharePreflight(
  projectsDir: string,
  targetRel: string,
  runPython: RunPython
): Promise<SharePreflightResult> {
  const notes: string[] = [];
  let findings: PromoteShareFinding[] = [];
  const scan = await runPython(projectsDir, [GATE_PY, 'share-scan', targetRel, '--json']);
  try {
    const o = JSON.parse(scan.stdout) as { findings?: PromoteShareFinding[] };
    findings = (o.findings ?? []).map((f) => ({
      kind: String(f.kind), line: Number(f.line), excerpt: String(f.excerpt).slice(0, 160),
    }));
  } catch {
    notes.push('share-scan did not run — review the file by eye before confirming');
  }
  let dup: string | undefined;
  const chk = await runPython(projectsDir, [CATALOG_PY, 'check', targetRel, '--shelf', '--json']);
  try {
    const v = JSON.parse(chk.stdout) as { verdict?: string; match?: string | null; weak?: boolean };
    if (v.verdict === 'new') dup = 'new (no shelf match)';
    else if (v.verdict) {
      dup = `${v.verdict}${v.match ? ` of ${v.match}` : ''}${v.weak ? ' (weak signal — small shape)' : ''}`;
    }
  } catch {
    notes.push('near-dup check did not run — the reviewer will judge duplication');
  }
  return { findings, dup, note: notes.length ? notes.join(' | ') : undefined };
}

// ── commit metadata (becomes the PR title/body via contrib-pr.yml) ──────────────────────────────

/** The commit subject+body. The BODY is the only channel from the contributor's machine to the PR
 *  (the hub's contrib-pr.yml lifts it verbatim into the PR body), so it carries the verdicts the
 *  reviewer needs plus the spec 081 S1 checklist. */
export function contributionMessage(p: PromoteState): { subject: string; body: string } {
  const share = p.share;
  const scanLine = !share ? 'not run'
    : share.findings && share.findings.length
      ? `${share.findings.length} advisory finding(s) — reviewed by the contributor at the confirm gate`
      : 'clean';
  const body = [
    'Distilled pattern shared from a Builder promote (spec 081).',
    '',
    `- slug: ${p.slug}`,
    `- source: ${p.origin === 'external' ? `external (license ${p.license || 'unknown'})` : 'original (local proven build)'}`,
    `- gate: ${p.verdict?.eligible ? 'eligible' : 'unknown'} (probe: ${p.verdict?.probe ?? 'skipped'})`,
    `- known_good_dify: ${p.verdict?.knownGoodDify || '(probe skipped)'}`,
    `- share-scan: ${scanLine}`,
    `- near-dup: ${share?.dup ?? 'not run'}`,
    ...(share?.note ? [`- preflight note: ${share.note}`] : []),
    '',
    'Reviewer checklist (docs/state/templates-and-promotion.md):',
    '- [ ] x-provenance header valid (source=original, or external + permissive license)',
    '- [ ] placeholders clean — no internal URLs / tokens / hostnames left',
    '- [ ] not a near-duplicate of an existing shelf pattern',
    '- [ ] pattern-count mentions bumped: README + AGENTS.md + docs/architecture.md (test_docs_drift pins the exact count)',
    '- [ ] on an INDEX.md conflict: re-run tools/dify_base/build_index.py and commit the result',
  ].join('\n');
  return { subject: `contrib: add pattern ${p.slug}`, body };
}

/** Who is sharing. Precedence: the dev-settings `contributor` override (passed in) → the
 *  `BUILDER_CONTRIBUTOR` env → the OS username. The hostname rides along in the meta so the admin
 *  can map a "PC-xxx" back to a person once. */
export function contributorIdentity(override?: string): { contributor: string; hostname: string } {
  const local = (override ?? '').trim();
  const env = (process.env.BUILDER_CONTRIBUTOR ?? '').trim();
  let user = '';
  try {
    user = userInfo().username;
  } catch {
    user = 'unknown';
  }
  return { contributor: local || env || user, hostname: hostname() };
}

/** The drop payload's `meta` — the same facts `contributionMessage` puts in the git commit body,
 *  as JSON for the admin's /shelf-inbox sweep. `contributor` override = the dev-settings value. */
export function contributionMeta(p: PromoteState, contributor?: string): Record<string, unknown> {
  const id = contributorIdentity(contributor);
  return {
    slug: p.slug,
    source: p.origin === 'external' ? `external (license ${p.license || 'unknown'})` : 'original (local proven build)',
    gate: { eligible: p.verdict?.eligible ?? null, probe: p.verdict?.probe ?? 'skipped' },
    knownGoodDify: p.verdict?.knownGoodDify ?? null,
    shareScan: p.share?.findings?.length
      ? { findings: p.share.findings }
      : { findings: [], note: 'clean' },
    nearDup: p.share?.dup ?? 'not run',
    preflightNote: p.share?.note ?? null,
    contributor: id.contributor,
    hostname: id.hostname,
    sharedAt: new Date().toISOString(),
  };
}

// ── the drop transport itself (spec 083 — HTTP POST to the team's drop URL) ─────────────────────

// 60s (was 30s): a Google Apps Script /exec POST 302-redirects to script.googleusercontent.com and the
// round-trip (cold start + Drive writes + the redirect hop) can run long — a too-short timeout aborts the
// wait even though doPost already succeeded server-side (the file lands in Drive, but the app reports a
// false timeout → the user retries → duplicate uploads). Give the redirect room.
const DROP_TIMEOUT_MS = 60_000;

/** POST the pattern to the drop URL. The receiver (tools/share_inbox/Code.gs, Google-hosted)
 *  answers `{ok:true}` / `{ok:false, error}`; Apps Script responds via a 302 redirect, so the
 *  fetch MUST follow redirects (the default — never pass redirect:'manual' here). */
export async function postContribution(
  cfg: ShareConfig,
  payload: { slug: string; yaml: string; meta: Record<string, unknown> },
  fetchFn: FetchLike,
  contributor?: string
): Promise<ShareOutcome> {
  if (Buffer.byteLength(payload.yaml, 'utf8') > cfg.maxKb * 1024) {
    return { ok: false, error: `the pattern is larger than the share cap (${cfg.maxKb}KB) — check it for embedded data before sharing.` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DROP_TIMEOUT_MS);
  try {
    const id = contributorIdentity(contributor);
    const res = await fetchFn(cfg.url, {
      method: 'POST',
      // A User-Agent is REQUIRED in practice: Node's undici fetch sends none by default, and Google Apps
      // Script's /exec → googleusercontent redirect can HANG (or serve an error page) for a UA-less client
      // — the same request works from curl/browsers, which always send one. This is the fix for the "file
      // landed in Drive but the app timed out" symptom (spec 083 follow-up).
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'dify-builder-share/1.0' },
      body: JSON.stringify({
        secret: cfg.secret ?? '',
        slug: payload.slug,
        contributor: id.contributor,
        yaml: payload.yaml,
        meta: payload.meta,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `the share inbox returned HTTP ${res.status} — try again later. Detail: ${text.slice(0, 200)}` };
    }
    try {
      const o = JSON.parse(text) as { ok?: boolean; error?: string };
      if (o.ok === true) return { ok: true };
      return { ok: false, error: `the share inbox rejected the upload: ${o.error ?? 'no detail'}` };
    } catch {
      return { ok: false, error: `unexpected reply from the share inbox (not JSON — likely a Google error page). Check the drop URL in ⚙ Settings › Share (the per-machine override wins over .dify-share.json), and that the Apps Script is deployed for public access. Got: ${text.slice(0, 120)}` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(msg)) return { ok: false, error: 'the share inbox did not answer within 30s (offline?). Check your connection and try again.' };
    return { ok: false, error: `could not reach the share inbox (offline?). Check your connection and try again. Detail: ${msg.slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── the push itself (throwaway worktree — never the user's checkout) ────────────────────────────

export interface ShareOutcome {
  ok: boolean;
  branch?: string;
  error?: string;
}

const identityHelp =
  'git identity is not configured — run `git config --global user.name "Your Name"` and ' +
  '`git config --global user.email you@example.com`, then Share again.';

function classifyPushError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (/permission denied|403|not authorized|authentication|access denied|could not read from remote/.test(s)) {
    return 'push was rejected (no write access to origin). Ask the repo owner for branch-push access, ' +
      'or fork the repo and push this branch there manually. Detail: ' + tail(stderr);
  }
  if (/could not resolve|unable to access|network|connection|timed out/.test(s)) {
    return 'could not reach origin (offline?). Check your connection and Share again. Detail: ' + tail(stderr);
  }
  return 'git push failed: ' + tail(stderr);
}

const tail = (s: string): string => (s.trim().split('\n').pop() ?? '').slice(0, 300);

/** The date-stamped `contrib/<slug>-<yyyymmdd>` branch, suffixed past any existing local branch. */
async function freeBranchName(projectsDir: string, slug: string, runGit: RunGit): Promise<string> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const base = `contrib/${slug}-${date}`;
  for (let n = 0; n < 100; n++) {
    const cand = n === 0 ? base : `${base}-${n + 1}`;
    const r = await runGit(projectsDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${cand}`]);
    if (r.code !== 0) return cand;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Commit `paths` (their CURRENT working-tree content in the user's checkout) onto a fresh branch
 * from HEAD and push it to origin. Built in a temp `git worktree`, so the user's branch, index,
 * and working tree are untouched — their local shelf keeps the pattern regardless of outcome.
 */
export async function pushContribution(
  projectsDir: string,
  opts: { slug: string; paths: string[]; subject: string; body: string },
  runGit: RunGit
): Promise<ShareOutcome> {
  const email = await runGit(projectsDir, ['config', 'user.email']);
  if (email.code !== 0 || !email.stdout.trim()) return { ok: false, error: identityHelp };
  if ((await runGit(projectsDir, ['remote', 'get-url', 'origin'])).code !== 0) {
    return { ok: false, error: 'this workspace has no `origin` remote — nothing to share to.' };
  }

  const branch = await freeBranchName(projectsDir, opts.slug, runGit);
  const wt = await mkdtemp(join(tmpdir(), 'contrib-share-'));
  let branchCreated = false;
  try {
    const add = await runGit(projectsDir, ['worktree', 'add', '-b', branch, wt, 'HEAD']);
    if (add.code !== 0) return { ok: false, error: 'could not prepare the share worktree: ' + tail(add.stderr) };
    branchCreated = true;

    // The user's CURRENT file content (finalize already wrote pattern + rebuilt INDEX there).
    for (const rel of opts.paths) {
      const content = await readFile(join(projectsDir, rel));
      await mkdir(dirname(join(wt, rel)), { recursive: true });
      await writeFile(join(wt, rel), content);
    }
    const staged = await runGit(projectsDir, ['-C', wt, 'add', '--', ...opts.paths]);
    if (staged.code !== 0) return { ok: false, error: 'git add failed in the share worktree: ' + tail(staged.stderr) };
    // --no-verify: the pattern already passed the B2′ 4-linter re-gate, and the hub CI re-lints the
    // branch on push — a repo pre-commit hook here would only add an unpredictable local dependency.
    const commit = await runGit(projectsDir, [
      '-C', wt, 'commit', '--no-verify', '-m', opts.subject, '-m', opts.body,
    ]);
    if (commit.code !== 0) {
      const err = commit.stderr + commit.stdout;
      if (/user\.(name|email)|tell me who you are|empty ident/i.test(err)) return { ok: false, error: identityHelp };
      if (/nothing to commit/i.test(err)) {
        return { ok: false, error: 'nothing to commit — the shared paths are identical to HEAD (already committed?).' };
      }
      return { ok: false, error: 'git commit failed: ' + tail(err) };
    }
    const push = await runGit(projectsDir, ['-C', wt, 'push', '-u', 'origin', branch]);
    if (push.code !== 0) return { ok: false, error: classifyPushError(push.stderr || push.stdout) };
    return { ok: true, branch };
  } finally {
    // Best-effort cleanup, ALWAYS: drop the worktree, then the local branch (the remote branch is
    // the durable artifact on success; on failure a clean slate lets Share-again just work).
    await runGit(projectsDir, ['worktree', 'remove', '--force', wt]).catch(() => undefined);
    await rm(wt, { recursive: true, force: true }).catch(() => undefined);
    if (branchCreated) await runGit(projectsDir, ['branch', '-D', branch]).catch(() => undefined);
    await runGit(projectsDir, ['worktree', 'prune']).catch(() => undefined);
  }
}

// ── the FSM steps promoteConfirm dispatches to ──────────────────────────────────────────────────

/** `share` at the offer gate → run the preflight, then (spec 084 v1.4 "Share = Push") SHIP immediately on
 *  a clean scan — the [Share to team] click was the human gate, so no 2nd confirm. The ONE hard fuse: a
 *  real secret finding (`findings` ≠ empty) BLOCKS the push (park `share_blocked`, keep-local only — never
 *  a "push anyway"). Near-dup (`dup`) is advisory (admin filters at /shelf-inbox), never blocks. */
export async function runSharePreflight(task: Task, ctx: OrchestratorCtx): Promise<void> {
  const p = task.promote!;
  task.status = 'running';
  task.gate = undefined;
  await emit(task, ctx);
  const { runPython } = resolveRunners(ctx);
  const pre = await sharePreflight(ctx.projectsDir, p.target!, runPython);
  if (isCancelled(task.taskId)) return;
  p.share = { state: 'review', findings: pre.findings, dup: pre.dup, note: pre.note };
  // Clean scan → Share = Push: ship straight through (runShareShip emits the terminal state itself).
  if (pre.findings.length === 0) {
    await runShareShip(task, ctx);
    return;
  }
  // Secret detected → hard fuse: park keep-local-only. The findings ride on p.share for the task view.
  task.status = 'awaiting_confirm';
  task.gate = computePromoteGate('share_blocked');
  await emit(task, ctx);
}

/** `share_confirm` at the review gate → ship it. Transport (spec 083): a configured drop URL wins
 *  (POST — zero git anywhere); else the 081 git push. Success ends `done` (the contributor's
 *  journey ends here); failure re-parks with guidance + a Try-again. */
export async function runShareShip(task: Task, ctx: OrchestratorCtx): Promise<void> {
  const p = task.promote!;
  task.status = 'running';
  task.gate = undefined;
  await emit(task, ctx);

  const cfg = await loadShareConfig(ctx.projectsDir);
  let mode: 'drop' | 'git';
  let out: ShareOutcome;
  if (cfg) {
    mode = 'drop';
    const who = await localOverride(ctx.projectsDir, 'contributor');
    const yaml = await readFile(join(ctx.projectsDir, p.target!), 'utf8');
    out = await postContribution(cfg, { slug: p.slug, yaml, meta: contributionMeta(p, who) }, resolveRunners(ctx).fetchFn, who);
  } else {
    mode = 'git';
    const { subject, body } = contributionMessage(p);
    out = await pushContribution(
      ctx.projectsDir,
      { slug: p.slug, paths: [p.target!, 'INDEX.md'], subject, body },
      resolveRunners(ctx).runGit
    );
  }
  if (isCancelled(task.taskId)) return;
  if (out.ok) {
    p.share = { ...p.share, state: 'pushed', mode, branch: out.branch, error: undefined };
    task.status = 'done';
    task.gate = { actions: [] };
  } else {
    ctx.log.warn({ taskId: task.taskId, mode, error: out.error }, 'share ship failed (re-parked with guidance)');
    p.share = { ...p.share, state: 'failed', mode, error: out.error };
    task.status = 'awaiting_confirm';
    task.gate = computePromoteGate('share_retry');
  }
  await emit(task, ctx);
}

/** `share_skip` at either share gate → end exactly where a non-shareable promote ends. */
export async function finishShareSkipped(task: Task, ctx: OrchestratorCtx): Promise<void> {
  task.promote!.share = undefined;
  task.status = 'done';
  task.gate = { actions: [] };
  await emit(task, ctx);
}
