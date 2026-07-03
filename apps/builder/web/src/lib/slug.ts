/**
 * slug.ts — the CLIENT mirror of the server's project-name rule (spec 031 D2/D3). Kept byte-for-byte
 * in sync with server `sanitizeSlug` (state/task.ts) and `PROJECT_NAME_RE` (lib/project-create.ts) so
 * the modal's live folder preview equals the folder the route will actually create (risk 4). A shared
 * fixture test (slug.test.ts) pins the agreement.
 */

/** D3: a project name must start folder-safe and use only `[A-Za-z0-9]` + space / `_` / `-`. */
export const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

/** Mirror of server `sanitizeSlug`: lowercase, non-alnum runs → `_`, strip edge `_`, cap 40, drop a
 *  trailing `_`, fall back to `workflow`; an intentional leading `_` is preserved. */
export function projectSlug(raw: string): string {
  const body =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40)
      .replace(/_+$/, '') || 'workflow';
  return raw.trim().startsWith('_') ? `_${body}` : body;
}

/** True when `name` (as-typed, before trim) is an acceptable project name per D3. */
export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_RE.test(name.trim());
}
