/**
 * criteria.ts — spec 032 A3 / §3 / D6: the Acceptance-Criteria rubric.
 *
 * Spec ② authors the criteria as a `## Acceptance Criteria` markdown list in SPEC.md (a single authored
 * source the human can edit at the Spec gate). At spec-verify the backend parses that section into
 * `.runs/<taskId>/criteria.json` (a machine-readable list) — parse HERE, not at judge time, so the human's
 * gate edits are captured but a later SPEC.md edit during Implement can't silently change the rubric
 * mid-test. Empty list ⇒ the live-test judge (T3) degrades to a smoke-test (advisory-low). Non-fatal: a
 * parse/write failure never fails the Spec phase.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task } from '../state/task.js';

/**
 * Extract the criteria list from SPEC.md: the list items under a `## Acceptance Criteria` heading (any
 * `#` level), up to the NEXT heading. Handles `-`/`*`/`+` and `1.`/`1)` markers and strips an optional
 * `[ ]`/`[x]` checkbox. Pure + deterministic; returns [] when the section is absent/empty.
 */
export function parseAcceptanceCriteria(md: string): string[] {
  const out: string[] = [];
  let inSection = false;
  let inFence = false;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    // Skip fenced code blocks entirely so a ``` example under the heading can't seed bogus criteria
    // (or trip an early section-enter). A fence line flips the flag and is itself ignored.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      if (/^acceptance criteria\b/i.test(heading[1].trim())) {
        inSection = true; // enter the section
        continue;
      }
      if (inSection) break; // any later heading ends it
      continue;
    }
    if (!inSection) continue;
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (!item) continue;
    const text = item[1].replace(/^\[[ xX]\]\s*/, '').trim(); // drop a leading checkbox
    if (text) out.push(text);
  }
  return out;
}

/** Repo-relative path of a task's criteria.json (mirrors phases.ts `runArtifact`). */
export function criteriaRel(taskId: string): string {
  return `apps/builder/.runs/${taskId}/criteria.json`;
}

/**
 * Read SPEC.md at `specAbsPath`, parse its Acceptance Criteria, write `.runs/<taskId>/criteria.json`, and
 * record `task.artifacts.criteria`. Always writes (even `{criteria:[]}`) so the live-test path can tell
 * "no rubric → smoke-test" apart from "not a spec build". Caller wraps this so a failure is non-fatal.
 */
export async function persistCriteria(projectsDir: string, task: Task, specAbsPath: string): Promise<string[]> {
  const md = await readFile(specAbsPath, 'utf8');
  const criteria = parseAcceptanceCriteria(md);
  const rel = criteriaRel(task.taskId);
  await writeFile(join(projectsDir, rel), JSON.stringify({ criteria }, null, 2));
  task.artifacts.criteria = rel;
  return criteria;
}
