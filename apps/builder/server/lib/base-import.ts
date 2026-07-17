/**
 * base-import.ts — import ONE standalone YAML as a local edit-existing base (spec 051 D1/D2/D3/D4).
 *
 * A field user hands over a raw `.yml` ("brush-up させて this workflow"). Today it reaches neither base
 * door (the `/api/seeds` Dify apps, the `/api/tree` repo workflows) without manual folder surgery. This
 * lands it in door #2's territory in one call: validate → derive a folder slug → scaffold the workflow
 * tier → write the file verbatim to `projects/<project>/<slug>/workflows/main.yml`, whence `/api/tree`
 * lists it and the `ワークフロー` selector shows it as a base — zero new storage tier (D4).
 *
 * SECURITY is inherited, not invented (015 D4): the YAML is DATA — it only ever re-enters a turn as
 * `{{SEED_PATH}}`, which Analyze/Implement already treat as untrusted. The write is confined to the
 * `projects/` subtree; the slug is sanitized; `..`/path-separator `name`/`project` are rejected (AC4).
 * This is NOT a build turn, so there is no gate/turn-confinement interaction. The mutating POST that
 * calls this is Origin-checked by the global `onRequest` hook (index.ts).
 *
 * The Japanese name is NEVER lost: it lives in the written YAML's `app.name` (verbatim), and
 * `buildTree`'s `workflowDisplayName` reads THAT for the chip label — the folder slug is a separate,
 * ASCII-safe concern. So we derive the slug with `deriveSlugName` (a non-Latin `app.name` collapses to
 * `workflow`) + `firstFreeSlug` (auto-suffix a collision), NOT `checkProjectName` (the English-only
 * project-name gate, which would 400 a JP `app.name`).
 */
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { runPython as realRunPython } from './shell.js';
import { LINTERS, LINT_DETAIL_LINES } from './linters.js';
import { probeVerdict } from './report.js'; // spec 066 S4: ONE source for the probe verdicts
import { deriveSlugName, firstFreeSlug, titleCaseSlug } from './slug.js';
import { readNestedScalar } from './artifacts.js';
import { scaffoldProjectTier, scaffoldWorkflowTier } from './project-create.js';
import { MAX_ATTACHMENT_BYTES } from './attachments.js';
import { difyTargets, importForTest, deleteApp, reconcileAppIdByName, redactSecrets } from './dify-io.js';
import { DRAFTS_PROJECT, sanitizeSlug } from '../state/task.js';

/** The wire body of `POST /api/bases` (spec 051 D1). `yaml` is the file contents; `project` is an
 *  optional target (an EXISTING project slug — the modal creates a new one via `POST /api/projects`
 *  first, then passes its slug here). `fileName` is the original upload name, present only for the
 *  file-picker path — used solely for the `.yml`/`.yaml` extension check (absent on paste-YAML). */
export interface ImportBaseInput {
  yaml?: unknown;
  name?: unknown;
  project?: unknown;
  fileName?: unknown;
}

/** A discriminated result the route maps to HTTP: `ok` → 200; else `status` is the HTTP code and
 *  `error` the message. `slugNote` narrates a `firstFreeSlug` auto-suffix (F4 precedent); `probeNote`
 *  carries the optional 049 import-probe verdict (advisory only — never blocks the import). */
export type ImportBaseResult =
  | { ok: true; project: string; workflow: string; slugNote?: string; probeNote?: string }
  | { ok: false; status: number; error: string };

/** The optional 049 import-probe seam (D2, advisory) — a test injects a fake; production probes the real
 *  Dify. Returns a human note (or undefined to attach nothing). */
export type BaseProbe = (projectsDir: string, project: string, slug: string) => Promise<string | undefined>;

/** `.yml`/`.yaml` only (D1) — the file-upload accept path (paste-YAML has no extension to check). */
const YAML_EXT = new Set(['yml', 'yaml']);

/** A `name`/`project` is crafted if it carries a path separator or a `..` traversal segment. We REJECT
 *  (not silently sanitize) so a hostile input surfaces as a 400 rather than a mangled slug (AC4). */
const hasTraversal = (s: string): boolean => /[\\/]/.test(s) || s.split(/[\\/]/).includes('..') || s.includes('..');

const MB = (n: number): string => (n / (1024 * 1024)).toFixed(1);

/**
 * The optional 049 import-probe against the REAL Dify (spec 051 D2 — advisory, NEVER blocks). Decoupled
 * from the ④ `runImportProbe` (which needs a Task/ctx): it calls the same self-contained dify-io ops
 * (`importForTest` → capture → `deleteApp`, orphan-swept by name) directly. Skips silently with no note
 * when there are no selfhost creds; any failure returns a warning note but never throws. Mirrors the ④
 * probe's verdicts (OK / pending-mismatch / FAILED-verbatim) so a user sees a consistent message.
 */
export async function probeImportedBase(projectsDir: string, project: string, slug: string): Promise<string | undefined> {
  if (!difyTargets().selfhost) return undefined; // no creds → nothing to probe against (037/049 degrade)
  const wfRel = `projects/${project}/${slug}/workflows/main.yml`;
  const probeName = `[probe] base ${project}/${slug}`; // stable per base → a leaked orphan is sweepable by name
  try {
    const res = await importForTest(projectsDir, project, slug, wfRel, probeName);
    if (res.ok && res.appId) {
      const deleted = await deleteApp(projectsDir, res.appId).catch(() => false);
      // spec 066 S4: the SHARED verdict strings — this producer used to carry its own copy and was
      // left behind when the orchestrator's copy was reworded.
      return probeVerdict.ok(deleted ? undefined : probeName);
    }
    if (res.ok && res.status === 'pending') {
      return probeVerdict.parked();
    }
    const rec = await reconcileAppIdByName(projectsDir, probeName).catch(() => ({ appId: null, ambiguous: false }));
    if (rec.appId) await deleteApp(projectsDir, rec.appId).catch(() => false);
    const detail = redactSecrets(res.stderr ?? '').trim().split('\n').slice(-3).join(' ⏎ ');
    return probeVerdict.rejected(detail);
  } catch (e) {
    return probeVerdict.skipped(redactSecrets(e instanceof Error ? e.message : String(e)));
  }
}

/**
 * spec 070 — lint a standalone YAML string with the SAME 4-linter set the ③ build gate and base-import
 * run, against a TEMP file (never under `projects/`). Returns the verbatim failure messages (empty ⇒
 * clean). Shared by the base door (below) and the distill-from-paste door (`POST /api/promote`, D2) so a
 * poisonous YAML is rejected identically at either entrance. `runPython` is the 013-D2 seam.
 */
export async function lintStandaloneYaml(
  projectsDir: string,
  yaml: string,
  runPython: typeof realRunPython
): Promise<string[]> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'dify-yaml-lint-'));
  const tmpFile = join(tmpDir, 'main.yml');
  try {
    await writeFile(tmpFile, yaml, 'utf8');
    const results = await Promise.all(LINTERS.map((lint) => runPython(projectsDir, [lint.script, tmpFile])));
    const failures: string[] = [];
    LINTERS.forEach((lint, i) => {
      const r = results[i];
      if (r.code !== 0) {
        const detail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-LINT_DETAIL_LINES).join(' ⏎ ');
        failures.push(`${lint.name} exit ${r.code}: ${detail}`);
      }
    });
    return failures;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Import a standalone YAML as a local edit-existing base. PURE of HTTP — returns a discriminated result
 * the route maps to a status code. `runPython` is the 013-D2 seam (a test injects a fake; production
 * passes the real `init_project.py`/linter runner).
 */
export async function importYamlAsBase(
  projectsDir: string,
  input: ImportBaseInput,
  runPython: typeof realRunPython,
  probe: BaseProbe = probeImportedBase
): Promise<ImportBaseResult> {
  // 1. Shape + size + extension (D1 step 1 — reuse MAX_ATTACHMENT_BYTES; single file; .yml/.yaml only).
  const yaml = typeof input.yaml === 'string' ? input.yaml : '';
  if (!yaml.trim()) return { ok: false, status: 400, error: 'yaml is required (the file contents)' };
  const bytes = Buffer.byteLength(yaml, 'utf8');
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, status: 400, error: `file is ${MB(bytes)} MB — over the ${MB(MAX_ATTACHMENT_BYTES)} MB limit` };
  }
  if (input.fileName != null) {
    const ext = (/\.([a-z0-9]+)$/i.exec(String(input.fileName).trim())?.[1] ?? '').toLowerCase();
    if (!YAML_EXT.has(ext)) {
      return { ok: false, status: 400, error: `unsupported file '${String(input.fileName)}' — only .yml/.yaml` };
    }
  }

  // 2. Crafted-name guards (AC4) — reject `..`/separators in the raw name/project BEFORE deriving.
  const rawName = input.name != null ? String(input.name).trim() : '';
  const rawProject = input.project != null ? String(input.project).trim() : '';
  if (rawName && hasTraversal(rawName)) return { ok: false, status: 400, error: 'name must not contain path separators' };
  if (rawProject && hasTraversal(rawProject)) return { ok: false, status: 400, error: 'project must not contain path separators' };

  // 3. Resolve the target project (D3) — an override (existing slug) or the `_drafts` staging default.
  //    sanitizeSlug is a backstop; the guard above already 400s a traversal attempt.
  const project = rawProject ? sanitizeSlug(rawProject) : DRAFTS_PROJECT;

  // 4. Validation gate (D2) — run the SAME 4-linter set the ③ build gate runs, against a TEMP file, and
  //    reject before writing anything to `projects/`. A base seeds every build from it, so a dangling
  //    ref / fabricated hash / bad node body is as poisonous as an import-blocker. (spec 070: the shared
  //    `lintStandaloneYaml` — the distill-from-paste door reuses this identical gate.)
  const failures = await lintStandaloneYaml(projectsDir, yaml, runPython);
  if (failures.length) {
    return { ok: false, status: 400, error: failures.join('\n') };
  }

  // 5. Derive the folder slug (JP `app.name` → `workflow`, then auto-suffix a per-project collision).
  const appName = readNestedScalar(yaml, 'app', 'name') ?? '';
  const source = rawName || appName;
  const base = deriveSlugName(source).slug;
  const slug = firstFreeSlug(projectsDir, project, base);
  const slugNote =
    slug !== base ? `'${base}' already exists in '${project}' — using '${slug}' to avoid overwriting it.` : undefined;

  // 6. Scaffold the tiers (D1 step 4). Ensure the PROJECT tier exists first (`_drafts` may have no
  //    manifest yet), then the WORKFLOW tier via the shared argv. `firstFreeSlug` guarantees the
  //    workflow dir is fresh, so the scaffold never overwrites an existing base.
  if (!existsSync(join(projectsDir, 'projects', project, '.dify-workspace.yaml'))) {
    const pr = await scaffoldProjectTier(projectsDir, project, titleCaseSlug(project), runPython);
    if (pr.code !== 0) {
      return { ok: false, status: 500, error: `scaffold project failed: ${(pr.stderr || pr.stdout).trim().slice(0, 300)}` };
    }
  }
  const wr = await scaffoldWorkflowTier(projectsDir, project, slug, source || slug, runPython);
  if (wr.code !== 0) {
    return { ok: false, status: 500, error: `scaffold workflow failed: ${(wr.stderr || wr.stdout).trim().slice(0, 300)}` };
  }

  // 7. Write the uploaded bytes VERBATIM to main.yml (D4) — overwriting the scaffold's placeholder. The
  //    dir is guaranteed to exist (just scaffolded), but mkdir -p defends a scaffold that skipped it.
  const wfDirAbs = join(projectsDir, 'projects', project, slug, 'workflows');
  await mkdir(wfDirAbs, { recursive: true });
  await writeFile(join(wfDirAbs, 'main.yml'), yaml, 'utf8');

  // 8. Optional 049 import-probe (D2 — advisory ONLY). The base has already landed; a probe failure or
  //    absent creds never changes that — it only attaches a warning note. Defensive: never let it throw.
  const probeNote = await probe(projectsDir, project, slug).catch(() => undefined);

  return { ok: true, project, workflow: slug, ...(slugNote ? { slugNote } : {}), ...(probeNote ? { probeNote } : {}) };
}
