# Spec 018 — Turn write-confinement allowlist (015 follow-up)

**Status**: Implemented (2026-06-21) — server `npm test` 162 green; self-modify denied at the live binary
**Effort**: S
**Depends on**: [015](015-builder-security-turn-sandbox.md) (this closes a write-vector its hook left open)

> **Done (2026-06-21).** `pathIsProtectedWrite` inverted to the allowlist (writable = `projects/**` + the
> own `.runs/<taskId>/**` + `apps/builder/.runs/<taskId>/**` + `.vscode/settings.json`; everything else
> denied), `cwd` threaded from `input.cwd` for relative/absolute/`..` resolution, the now-redundant
> `SHELL_INIT` deny-set removed (the allowlist subsumes it). Verified at the live hook binary: Write/Edit to
> `permission-gate.ts` / `orchestrator.ts` / `headless-settings.json` / `scripts/` / `.github/` → **deny**;
> `projects/**`, own `.runs/<taskId>/`, `.vscode/settings.json` → **allow**; sibling `.runs/<other>/` and
> absolute out-of-repo → **deny**. Tests in `permission-gate.test.ts` (the `spec 018` describe).

> **One residual from 015, found in review.** 015's hook protects a **deny-list** of write paths
> (`.venv`/`.git`/`.claude`/`tools`/`skills` + system dirs + sibling `.runs`). But the app's OWN source —
> `apps/builder/server/**` (incl. **the hook itself** + the orchestrator), `apps/builder/web/**`,
> `headless-settings.json`, plus `scripts/`, `.github/`, root files — is **not** protected. A deny-list is
> whack-a-mole; this inverts the write check to an **allowlist** (the hook already does allowlist-first for
> Bash), closing the whole class in one move.

## Context — the hook can be neutered by the turn it guards

The 015 permission hook runs as `node permission-gate.ts` **fresh per tool call** (it reads the file from
disk each time). `pathIsProtectedWrite` denies a fixed set of segments, but **not** `apps/builder/**`.
Verified on the current binary:

```
Write apps/builder/server/hooks/permission-gate.ts  → ALLOW   ⚠
Write apps/builder/server/lib/orchestrator.ts        → ALLOW   ⚠
Write apps/builder/headless-settings.json            → ALLOW   ⚠
```

So a steered turn (poisoned seed/image) can, **in one turn**:
1. `Write apps/builder/server/hooks/permission-gate.ts` → overwrite the hook to "allow everything" (allowed,
   because that path isn't protected);
2. every subsequent tool call **in the same turn** runs the neutered hook → read `.env`, write `.venv`,
   `curl`, anything — the entire 015 boundary is off.

The post-turn `git status` revert is only a **backstop**: it restores the hook *after* the turn settles, but
the in-turn bypass (token read into the artifact, etc.) has already happened. The same gap lets a turn write
`scripts/setup.sh`, `.github/workflows/*`, or a root `Makefile`/`package.json` — operator/CI-run poison
vectors a deny-list would each have to enumerate.

> **Why a deny-list can't win here:** there are too many dangerous write targets (the app code, the hook,
> CI, scripts, root files). The turn legitimately writes **only two places** — its workflow project and its
> own run dir. An allowlist of exactly those is both simpler and complete.

## Goals

1. A turn can write **only** the roots it legitimately needs (its `projects/<slug>/` + its own
   `.runs/<taskId>/`), mirroring the post-turn confinement whitelist.
2. Writing the hook, the orchestrator, `headless-settings.json`, any `apps/builder/**` source, `scripts/`,
   `.github/`, or a root file is **denied at the hook** (pre-write), not just reverted after.
3. No legit build write regresses.

## Non-goals

- No change to the read denies (`.env`/`.ssh`/…), the Bash analyzer, or anything else in 015.
- The post-turn `git` confinement stays as the backstop (and still handles cross-PROJECT writes, which the
  hook allows broadly since it doesn't know the slug — see Design).

## Design

Invert `pathIsProtectedWrite` (and the `WRITE_TOOLS` path in `checkForbiddenPath`) to an **allowlist**,
resolving the tool's `file_path` against the turn's cwd so relative/absolute/`..` forms are handled
uniformly:

```ts
function pathIsProtectedWrite(rawPath: string, taskId?: string, cwd?: string): boolean {
  if (pathIsSensitiveRead(rawPath)) return true;                 // .env/.ssh/… (unchanged)
  const root = cwd ?? process.cwd();                             // the turn's cwd = repo root
  const abs = resolve(root, rawPath);                            // relative→joined, absolute→as-is, '..' collapsed
  if (abs !== root && !abs.startsWith(root + '/')) return true;  // outside the repo → protected
  const p = lc(abs === root ? '' : abs.slice(root.length + 1));  // repo-relative
  const own = taskId ? lc(taskId) : null;
  // WRITABLE roots = the post-turn confinement whitelist:
  if (p.startsWith('projects/')) return false;                   // the build's workflow output
  if (own && (p.startsWith(`.runs/${own}/`) || p.startsWith(`apps/builder/.runs/${own}/`))) return false;
  if (!own && /^(apps\/builder\/)?\.runs\/[^/]+\//.test(p)) return false; // direct-CLI: own run dir
  if (p === '.vscode/settings.json') return false;
  return true;                                                   // EVERYTHING else → protected (deny)
}
```

- `cwd` is threaded from the PreToolUse payload (`input.cwd`) through `checkForbiddenPath` →
  `pathIsProtectedWrite`; falls back to `process.cwd()` (the hook runs at the turn cwd).
- `resolve` collapses `..`, so `projects/x/../../apps/builder/server/y` resolves to `apps/builder/server/y`
  → protected (no traversal escape).
- **Cross-project nuance:** the hook doesn't know the build's `<slug>`, so it allows `projects/**` broadly;
  a write to a DIFFERENT project is still caught by the post-turn confinement (which knows the slug). The
  in-turn class this spec closes is writing the **app's own code**, not another workflow.
- This subsumes the old deny segments (`.venv`/`.git`/`.claude`/`tools`/`skills`/system/shell-init/sibling
  `.runs`) — none are in the allowlist, so all stay denied — and adds the app source + scripts + CI + root.

## Behavior — what changes after 018

- **Legit builds are unchanged.** A turn writing `projects/<slug>/workflows/main.yml`, `projects/<slug>/SPEC.md`,
  `.runs/<taskId>/analyze.json` → all still allowed.
- **The turn can no longer disable its own guard.** `Write`/`Edit`/`MultiEdit`/`NotebookEdit` to
  `permission-gate.ts`, `orchestrator.ts`, `headless-settings.json`, any `apps/builder/**`, `scripts/`,
  `.github/`, or a root file → **denied at the hook**, before the write happens.
- Nothing else about the flow changes; this is one tighter write rule.

## Acceptance criteria

1. `Write`/`Edit`/`MultiEdit`/`NotebookEdit` to the hook, the orchestrator, `headless-settings.json`, any
   `apps/builder/**` source (outside the own `.runs/<taskId>/`), `scripts/**`, `.github/**`, or a root file
   → **DENIED** (unit + live-binary).
2. Legit writes still allowed: `projects/<slug>/**`, the own `apps/builder/.runs/<taskId>/**` +
   `.runs/<taskId>/**`, `.vscode/settings.json`.
3. Traversal (`projects/x/../../apps/builder/server/y`) and absolute paths outside the repo → DENIED.
4. A sibling task's `.runs/<other>/` stays denied (unchanged).
5. `npm run typecheck` + `npm test` (server) + the hook live-binary test green; 015 acceptance unbroken.

## References

- This session's 015 review follow-up: the self-modify write vector verified on the current hook binary
  (Write to `permission-gate.ts`/`orchestrator.ts`/`headless-settings.json` all returned `allow`).
- [015](015-builder-security-turn-sandbox.md) — the hook + `pathIsProtectedWrite` this tightens;
  [post-turn.ts:177-186](../../apps/builder/server/lib/post-turn.ts) `confinementCheck` — the whitelist this mirrors.
