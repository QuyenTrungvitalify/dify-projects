/**
 * project-create.ts — the shared project-tier scaffold + the create-name validation (spec 031).
 *
 * ONE source of truth for the `init_project.py --kind project` argv: both `ensureScaffold`
 * (the Spec-gate path) and the `POST /api/projects` route (the modal path) call `scaffoldProjectTier`,
 * so the two can never drift on flags. `checkProjectName` is the D3/D2 gate — English/folder-safe only,
 * rejected (never coerced) so the modal can show a red, teaching error; the SAME regex is mirrored on
 * the client for instant feedback (see web/src/lib/slug.ts).
 */
import type { runPython as realRunPython } from './shell.js';
import type { ShellResult } from './shell.js';
import { DRAFTS_PROJECT, sanitizeSlug } from '../state/task.js';

/** D3/D2: a project name must start folder-safe and use only `[A-Za-z0-9]` + space / `_` / `-`. The
 *  leading-alnum requirement also forbids a `_drafts`-style leading underscore. Mirrored client-side. */
export const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

export type ProjectNameCheck =
  | { ok: true; slug: string }
  | { ok: false; error: 'name_required' | 'name_charset' | 'reserved' };

/** Validate a user-supplied project name and derive its folder slug (D2/D3). Rejects — never coerces —
 *  so the caller surfaces a red, teaching error rather than inventing a `project_N`. */
export function checkProjectName(rawName: string): ProjectNameCheck {
  const name = rawName.trim();
  if (!name) return { ok: false, error: 'name_required' };
  if (!PROJECT_NAME_RE.test(name)) return { ok: false, error: 'name_charset' };
  const slug = sanitizeSlug(name);
  // Backstop: the regex already forbids a leading `_`, so a name can't sanitize to `_drafts` — but guard
  // the reserved sentinel explicitly so the modal can never manufacture the drafts bucket.
  if (slug === DRAFTS_PROJECT) return { ok: false, error: 'reserved' };
  return { ok: true, slug };
}

/**
 * Scaffold the PROJECT tier only — `projects/<slug>/` with `.dify-workspace.yaml` (name + endpoints) +
 * `envs/`, NO workflow. The exact `init_project.py --kind project` call `ensureScaffold` makes; shared so
 * the modal route and the Spec gate stay on one argv. Idempotency (skip-if-exists) is the caller's job.
 */
export function scaffoldProjectTier(
  projectsDir: string,
  slug: string,
  name: string,
  runPython: typeof realRunPython
): Promise<ShellResult> {
  return runPython(projectsDir, [
    'tools/dify_base/init_project.py', '--non-interactive', '--kind', 'project',
    '--name', name, '--slug', slug, '--primary-lang', 'en',
  ]);
}

/**
 * Scaffold the WORKFLOW tier only — `projects/<project>/<slug>/` (workflows/ SPEC.md prompts/ inputs/
 * tests/) with a placeholder `workflows/main.yml`. The exact `init_project.py --kind workflow` argv that
 * was inline in `scaffold.ts`'s `ensureScaffold`, factored out (spec 051 D1) so the Spec-gate scaffold
 * and the `POST /api/bases` importer stay on ONE argv — the `scaffoldProjectTier` precedent, one tier
 * down. The caller ensures the PROJECT tier exists first and owns idempotency (skip-if-exists).
 */
export function scaffoldWorkflowTier(
  projectsDir: string,
  project: string,
  slug: string,
  name: string,
  runPython: typeof realRunPython
): Promise<ShellResult> {
  return runPython(projectsDir, [
    'tools/dify_base/init_project.py', '--non-interactive', '--kind', 'workflow',
    '--project', project, '--name', name, '--slug', slug,
    '--app-type', 'workflow', '--primary-lang', 'en',
  ]);
}
