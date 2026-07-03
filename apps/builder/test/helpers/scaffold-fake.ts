/**
 * Spec 030 test helper — emulate `init_project.py`'s on-disk effect for a fake `runPython` seam.
 * ensureScaffold (scaffold.ts) invokes init TWICE: `--kind project --slug <project>` (creates the
 * project manifest) then `--kind workflow --project <project> --slug <workflowSlug>` (creates the
 * workflow's workflows/ dir). Mirror both so the SPEC.md move + the workflow write land where the
 * path builders expect.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Returns true if `args` is an init_project.py invocation (and applies its filesystem effect). */
export function applyInitFake(dir: string, args: string[]): boolean {
  if (!args.some((a) => a.includes('init_project.py'))) return false;
  const val = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const kind = val('--kind') ?? 'project';
  const slug = val('--slug');
  if (!slug) return true;
  if (kind === 'workflow') {
    const project = val('--project') ?? '_drafts';
    mkdirSync(join(dir, 'projects', project, slug, 'workflows'), { recursive: true });
  } else {
    mkdirSync(join(dir, 'projects', slug), { recursive: true });
    writeFileSync(join(dir, 'projects', slug, '.dify-workspace.yaml'), `project:\n  name: "${slug}"\n  slug: "${slug}"\n`);
  }
  return true;
}
