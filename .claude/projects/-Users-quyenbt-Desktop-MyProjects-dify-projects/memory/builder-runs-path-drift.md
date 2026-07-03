---
name: builder-runs-path-drift
description: spec 009 Builder — dify-build skill writes artifacts to repo-root .runs/, backend relocates to apps/builder/.runs/
metadata:
  type: project
---

The `dify-build` skill bodies (`analyze.md`/`spec.md`/`test.md`) tell a turn to write its task
artifact to the shorthand `.runs/<taskId>/…`. The turn's cwd is the repo root (spike §1 spawn
contract), so that resolves to **repo-root `.runs/`** — but spec 009 §A:517 canonicalizes the
artifact home to **`apps/builder/.runs/`**. The skill cannot be edited to match (the auto-mode
classifier blocks edits to `.claude/skills/**` as agent-loaded-config self-modification).

**Why:** un-bridged, ① Analyze writes repo-root `.runs/<taskId>/analyze.json`, which is outside
the confinement whitelist → reverted → "artifact missing" → chain dies at phase 1.

**How to apply:** the Lát-2 orchestrator (`apps/builder/server/lib/orchestrator.ts`,
`relocateRunArtifacts`) moves repo-root `.runs/<taskId>/*` → `apps/builder/.runs/<taskId>/`
right after each turn, before verify; `post-turn.ts` whitelists task-scoped `.runs/<taskId>/`.
`apps/builder/.runs/` is gitignored, so canonical-home writes are invisible to confinement.
Lát 3–5 reuse this — do not "fix" by writing to repo-root `.runs/`. See [[builder-lat2-done]].
