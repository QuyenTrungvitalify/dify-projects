/**
 * permission-gate.ts — the Builder's lightweight PreToolUse permission hook (spec 015 D1).
 *
 * WHY THIS EXISTS (the chain it closes). A build turn is a bare `claude` child at cwd=repo-root with
 * `--permission-mode acceptEdits` governed by a STATIC glob deny-list (headless-settings.json). A glob
 * deny matches tool calls by PATH — it cannot see INSIDE a Bash command. The phases must run
 * `.venv/bin/python <script>`, but `python` reads/writes ANY file, so a steered turn bypasses every
 * Read/Write glob deny: `python -c "open('apps/builder/.env')"` exfiltrates the Dify token,
 * `python -c "open('.venv/bin/python','w')"` poisons the interpreter the backend later runs `sync.py`
 * WITH the token, and the post-turn `git status` confinement is blind to `.gitignore`'d writes so it
 * never reverts it. Net: poisoned seed/image → token exfil + backend RCE.
 *
 * THE FIX. A PreToolUse hook reads each tool call and returns allow/deny IN-PROCESS, instantly — it can
 * see inside a Bash command, so it denies `python -c` / `bash -c` / `curl` / reads of `.env` / writes to
 * `.venv`. This is the structurally-correct version of what the static deny-list tries to do. It is the
 * fast-path ONLY ported from claude-nexus's `permission-gate.ts` + `command-analyzer.ts` +
 * `forbidden-paths.ts`: NO policy server, NO human-approval queue, NO dashboard (spec 015 "stay light").
 *
 * DESIGN — ALLOWLIST-FIRST (not nexus's deny-list-first classifier). The Builder runs a FIXED, tiny
 * command set (enumerated from the 4 phase `.md`), so the safe default is DEFAULT-DENY: allow exactly
 * the known-good `.venv/bin/python <known script>` forms + read-only `git`/inspectors, deny everything
 * else. (Nexus's classifier returns "moderate→ask_server" for a plain `python <script>`; with no server
 * that would map to deny and false-positive every legit phase command — see Q3.) Default-deny is both
 * simpler and strictly safer for a fixed command set.
 *
 * RUNTIME. ONE self-contained file (no relative imports) so it runs under bare `node` in BOTH dev
 * (`npm run dev`) and prod (`npm start`) with no tsx/build dependency — Node ≥22.6 runs `.ts` natively.
 * Registered as a `PreToolUse` (matcher `.*`) hook in headless-settings.json; the command is
 * `node --disable-warning=ExperimentalWarning apps/builder/server/hooks/permission-gate.ts` (relative —
 * the turn's cwd is the repo root). The pure decision functions are exported for unit tests; `main()`
 * runs only when this file is the process entry (so a test `import` never blocks on stdin).
 */
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// ─── The PreToolUse wire shapes (Claude Code) ───────────────────────────────────────────────────
export interface HookInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  permission_mode?: string;
}
export type Decision = 'allow' | 'deny' | 'abstain';
export interface DecisionResult {
  decision: Decision;
  reason: string;
}

// ─── Q2 — the Builder's FIXED allow-set (enumerated from the 4 phase .md) ────────────────────────
// The ONLY `.venv/bin/python` scripts a turn ever runs. `sync.py` / `init_project.py` are
// BACKEND-owned (never a turn — the token never enters a turn), so they are deliberately ABSENT.
export const ALLOWED_PYTHON_SCRIPTS = new Set<string>([
  'tools/dify_base/find.py',
  'skills/mango-svip/scripts/generate_id.py',
  'tools/dify_base/validate_workflow.py',
  'tools/dify_base/lint_refs.py',
  'tools/dify_base/lint_plugin_hashes.py',
  // Spec 038 P3 — the 4th LINTERS entry; without this the turn's self-correct loop (implement.md
  // step 5 runs the linters itself) would be hook-DENIED on the new linter and park more builds.
  'tools/dify_base/lint_node_bodies.py',
]);

// Read-only inspectors a turn may shell harmlessly. They add NO capability over the (allowed) Read /
// Glob / Grep tools, cannot write (a redirect `>` is rejected as a metacharacter below), and a
// sensitive target is still denied by checkForbiddenPath (which runs FIRST). Kept minimal.
const ALLOWED_READONLY = new Set<string>(['ls', 'cat', 'head', 'tail', 'pwd', 'wc', 'echo', 'true']);

// Leading verbs that are dangerous outright (ported from nexus DENY_EXECUTABLES) — surfaced with a
// clear reason before the default-deny tail. Default-deny would catch them anyway; this is for UX.
const DENY_EXECUTABLES = new Set<string>([
  'rm', 'rmdir', 'sudo', 'su', 'mkfs', 'dd', 'fdisk', 'shutdown', 'reboot', 'halt', 'poweroff',
  'chmod', 'chown', 'chgrp', 'kill', 'killall', 'pkill', 'iptables', 'ufw', 'useradd', 'userdel',
  'usermod', 'passwd', 'visudo', 'nc', 'ncat', 'socat', 'nmap', 'wget', 'curl', 'cp', 'mv', 'tee',
  'ln', 'xargs', 'eval', 'find', 'sed', 'awk', 'git-upload-pack',
]);

/**
 * What to reach for INSTEAD, per denied command. The denial is the one teaching moment that ALWAYS
 * lands: it arrives exactly when the agent is wrong, so — unlike a doc — it needs no link to resolve
 * and costs no turn to fetch.
 *
 * Measured on run 1784263317775 / 1784265851924: a bare "not in the allow-set" / "dangerous
 * executable" tells the agent WHAT failed but not WHAT TO DO, so it reads as a syntax complaint and
 * the model retries with different FLAGS — `grep` 3× (-i -E → -in → -in), `find` 6× (varying
 * -maxdepth). ~9 turns burned re-asking a question that was never about the flags. "dangerous
 * executable: find" is actively misleading on top: `find` is refused because the Glob tool covers it,
 * not because it is unsafe.
 *
 * Every substitute here must be a tool `headless-settings.json` actually allows (Bash/Read/Write/
 * Edit/Glob/Grep) — never name a way out that is itself denied.
 */
const SUBSTITUTE: Record<string, string> = {
  // NOT "the Grep tool" — the first version of this map said exactly that, and run 1784267358546 shows
  // why it was wrong: ③ called Grep twice, got an error BOTH times (it is deferred in the child
  // session — callable only after a ToolSearch), fell back to shell `grep`, and thrashed 25 times. A
  // hint is only as good as the door it points at, and "allowed by headless-settings" (which Grep is)
  // does not mean "callable right now". Point at what is PROVEN to work in a turn: find.py answers the
  // question ③ was actually asking — `--has iteration` returns 11 vetted paths in ONE allowed call —
  // and Read never fails.
  grep: 'the Read tool on a known file, or `.venv/bin/python tools/dify_base/find.py --has <feature>` to locate a workflow example (one call, returns paths)',
  rg: 'the Read tool, or `.venv/bin/python tools/dify_base/find.py --has <feature>` for a workflow example',
  ack: 'the Read tool',
  find: '`.venv/bin/python tools/dify_base/find.py --has <feature>` for a workflow example, or `ls` for a directory',
  fd: '`ls`, or `.venv/bin/python tools/dify_base/find.py --has <feature>` for a workflow example',
  locate: '`ls`',
  sed: 'the Edit tool', awk: 'the Read tool (then process the text yourself)',
  cp: 'the Read + Write tools', mv: 'the Read + Write tools (then delete is not needed — leave the original)',
  mkdir: 'the Write tool (it creates parent directories for you)',
  touch: 'the Write tool', tee: 'the Write tool',
  xargs: 'one plain command per call',
  curl: 'nothing — a turn never reaches the network; the backend owns every Dify call',
  wget: 'nothing — a turn never reaches the network; the backend owns every Dify call',
};

/** Append the sanctioned alternative to a denial, when one exists. Reason text only — never a decision. */
const withHint = (reason: string, base: string): string =>
  SUBSTITUTE[base] ? `${reason} — use ${SUBSTITUTE[base]} instead` : reason;

const INTERPRETERS = new Set<string>(['python', 'python3', 'node', 'nodejs', 'perl', 'ruby', 'php', 'deno', 'bun']);
const SHELLS = new Set<string>(['bash', 'sh', 'zsh', 'dash', 'csh', 'ksh', 'fish']);

// Read-only git status/diff flags. `git diff` is NOT inherently read-only: `--output=<f>` WRITES an
// arbitrary file and `--no-index <a> <b>` READS arbitrary files — so any flag NOT in this set is denied
// (spec 015 review C1; default-deny mirrors the hook's allowlist-first philosophy).
const SAFE_GIT_FLAGS = new Set<string>([
  '--porcelain', '--short', '-s', '--branch', '-b', '--long', '--stat', '--numstat', '--shortstat',
  '--name-only', '--name-status', '--summary', '--cached', '--staged', '-u', '--unified',
  '--no-color', '--no-renames', '--find-renames', '-M', '--find-copies', '-C', '--untracked-files', '--ignored',
]);
// Write-class tools — the path may be `file_path` OR `notebook_path`; all go through pathIsProtectedWrite
// (spec 015 review H2: MultiEdit/NotebookEdit were uncovered → poison-.venv via the edit channel).
const WRITE_TOOLS = new Set<string>(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// A "structurally simple" command: ONLY characters that appear in the legit phase commands. Any shell
// metacharacter (| & ; < > $ ` ( ) { } * ? ~ ! # \ newline …) is OUTSIDE this set → the command is
// denied. This single gate forecloses chaining / redirect / subshell / expansion / globbing /
// background-job smuggling without needing a full shell AST (and without the `shell-quote` dep).
// QUOTES (' ") are DELIBERATELY EXCLUDED (spec 015 review C2): allowing them let
// `cat apps/builder/.e''nv` carry no literal `.env` substring past the secret check while the shell
// still collapsed the quotes and read the token. The phase commands never quote, so forbidding quotes
// loses nothing and removes that whole split-the-literal bypass class.
const SIMPLE_COMMAND = /^[A-Za-z0-9 _./:=@,+-]+$/;

// ─── command-analyzer (allowlist-first) ─────────────────────────────────────────────────────────

/** Strip a single layer of surrounding quotes and a leading `./` so `"./tools/x.py"` matches the set. */
function normToken(t: string): string {
  let s = t;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  if (s.startsWith('./')) s = s.slice(2);
  return s;
}

/** Is this exe token the repo's pinned venv python? (relative `.venv/bin/python` or any absolute path
 *  ending in it). A bare `python`/`python3` is NOT — that forces the canonical interpreter and blocks
 *  the `python -c` exfil/poison vector at the verb. */
function isVenvPython(exe: string): boolean {
  return exe === '.venv/bin/python' || exe === '.venv/bin/python3' || /(^|\/)\.venv\/bin\/python3?$/.test(exe);
}

/**
 * Allowlist-first Bash triage → allow/deny (never abstain — Bash is default-DENY because
 * headless `permissions.allow:["Bash"]` would otherwise allow anything the hook abstains on).
 */
export function analyzeBashCommand(rawCommand: string): DecisionResult {
  const command = (rawCommand ?? '').trim();
  if (!command) return { decision: 'deny', reason: 'empty command' };

  // 1. Structural gate — reject any shell metacharacter (chaining / redirect / subshell / pipe /
  //    expansion / glob / background). The legit phase commands contain none.
  if (!SIMPLE_COMMAND.test(command)) {
    // The observed shape is `<allowed cmd> … | head` or `… 2>&1` — the pipe alone is what fails, so the
    // model retries the WHOLE command instead of just dropping the tail. Say what to do: the tool result
    // comes back whole, so `| head` was never buying anything.
    return {
      decision: 'deny',
      reason:
        'command contains a shell metacharacter (chaining/redirect/subshell/pipe/expansion are not allowed) — ' +
        're-run it as ONE plain command with no pipe/redirect/`;`. Output is returned in full, so ' +
        '`| head` is unnecessary.',
    };
  }

  const tokens = command.split(/\s+/).map(normToken).filter(Boolean);
  if (tokens.length === 0) return { decision: 'deny', reason: 'empty command' };
  const exe = tokens[0];
  const base = exe.includes('/') ? exe.slice(exe.lastIndexOf('/') + 1) : exe;

  // 2. The pinned venv python on a KNOWN script (no -c/-e/-m) → the only python a turn may run.
  if (isVenvPython(exe)) {
    const script = tokens[1];
    if (!script || script.startsWith('-')) {
      return { decision: 'deny', reason: `python with a code flag (-c/-e/-m) or no script is denied — only the fixed phase scripts are allowed` };
    }
    if (!ALLOWED_PYTHON_SCRIPTS.has(script)) {
      return { decision: 'deny', reason: `python script not in the Builder allow-set: ${script}` };
    }
    return { decision: 'allow', reason: `allowed phase script: ${script}` };
  }

  // 3. Explicit dangerous verbs — clear reason before the default-deny tail.
  // `find`/`sed`/`awk`/`cp`/`mv` sit in DENY_EXECUTABLES beside `rm`/`sudo`, but they are refused
  // because an allowed TOOL already covers them — calling that "dangerous" sent the model hunting for
  // a safer invocation (6 `find` retries, run 1784265851924). Name the substitute when there is one;
  // the genuinely destructive verbs keep the blunt wording, which for them is the whole point.
  if (DENY_EXECUTABLES.has(base)) {
    return {
      decision: 'deny',
      reason: SUBSTITUTE[base]
        ? withHint(`${base} is not available to a Builder turn`, base)
        : `dangerous executable: ${base}`,
    };
  }
  if (SHELLS.has(base)) return { decision: 'deny', reason: `shell interpreter: ${base} (use the fixed phase commands)` };
  if (INTERPRETERS.has(base)) {
    return { decision: 'deny', reason: `bare interpreter '${base}' is denied — use .venv/bin/python on a fixed phase script` };
  }

  // 4. Read-only git (status/diff) — ONLY with read-only flags (spec 015 review C1). `git diff` is NOT
  //    inherently read-only: --output=<path> WRITES an arbitrary file (poison .venv / overwrite the hook /
  //    clobber a sibling task) and --no-index <a> <b> READS arbitrary files. Default-deny any flag not in
  //    SAFE_GIT_FLAGS; non-dash tokens after the subcommand are pathspecs/refs (harmless to read).
  if (base === 'git') {
    const rest = tokens.slice(1);
    const sub = rest.find((t) => !t.startsWith('-'));
    if (sub !== 'status' && sub !== 'diff') {
      return { decision: 'deny', reason: `git subcommand not allowed: ${sub ?? '(none)'} (only status/diff)` };
    }
    for (const t of rest) {
      if (t === sub || !t.startsWith('-')) continue;
      const flag = t.includes('=') ? t.slice(0, t.indexOf('=')) : t;
      if (!SAFE_GIT_FLAGS.has(flag)) {
        return { decision: 'deny', reason: `git flag not allowed: ${t} (only read-only status/diff flags)` };
      }
    }
    return { decision: 'allow', reason: `read-only git ${sub}` };
  }

  // 5. Read-only inspectors.
  if (ALLOWED_READONLY.has(base)) return { decision: 'allow', reason: `read-only command: ${base}` };

  // 6. Default-deny tail (the Builder runs a fixed, small command set).
  return { decision: 'deny', reason: withHint(`command not in the Builder allow-set: ${base}`, base) };
}

// ─── forbidden-paths (hard deny, content-aware) ─────────────────────────────────────────────────

const isDarwin = process.platform === 'darwin';
const lc = (s: string): string => (isDarwin ? s.toLowerCase() : s);

/** Collapse '.'/'..' segments + strip trailing/duplicate slashes so `apps/builder/.env/` (trailing
 *  slash) and `.runs/<own>/../<sibling>/x` (dot-dot escape) cannot dodge the path checks below
 *  (spec 015 review H3 + the sibling-.runs dot-dot escape). */
function normPath(raw: string): string {
  const abs = raw.startsWith('/');
  const out: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
      continue;
    }
    out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/');
}

/** Exact credential basenames + key-file extensions a turn may never read (spec 015 review H3 — the
 *  set was hardcoded to .env/.ssh/.aws/.gnupg, leaving .netrc/.npmrc/.docker/.kube/etc. readable). */
const SENSITIVE_BASENAMES = new Set<string>([
  '.netrc', '.npmrc', '.git-credentials', '.gitconfig', '.pgpass', 'credentials',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
]);
const SENSITIVE_DIRS = ['.ssh/', '.aws/', '.gnupg/', '.docker/', '.kube/', '.config/'];

/** A path that can NEVER be read (the Dify token file + private creds). Boundary-aware + normalized. */
function pathIsSensitiveRead(rawPath: string): boolean {
  const p = lc(normPath(rawPath));
  const baseName = p.slice(p.lastIndexOf('/') + 1);
  // `.env` family: the credential file is `.env`/`.env.local`/`dev.env` (basename STARTS-WITH or ENDS-WITH
  // `.env`). A workflow file like `config.env.yml` is NOT (basename ends `.yml`) — so a legit `*.env.yml`
  // is not a false-positive (spec 015 review fixed the substring FP in commandReferencesSecret too).
  if (baseName.startsWith('.env') || baseName.endsWith('.env')) return true;
  if (SENSITIVE_BASENAMES.has(baseName)) return true;
  if (/\.(pem|key|p12|pfx)$/.test(baseName)) return true;
  for (const seg of SENSITIVE_DIRS) {
    if (p.includes('/' + seg) || p.startsWith(seg)) return true;
  }
  return p === '.ssh' || p === '.aws' || p === '.gnupg';
}

/**
 * ALLOWLIST-first write guard (spec 018, closing the 015-review S9 self-modify class). A turn writes ONLY
 * two places — its workflow project + its own run dir — so we mirror the post-turn confinement whitelist and
 * DENY everything else: the app's OWN code (incl. THIS hook, the orchestrator, headless-settings.json,
 * apps/builder/**), tools/, skills/, .venv/, .git/, .claude/, scripts/, .github/, root files, system dirs,
 * shell-init, and a SIBLING task's run dir. A deny-list could never enumerate every poison target; an
 * allowlist of the two legit roots is complete. `cwd` (the turn's cwd = repo root) resolves relative AND
 * absolute file_path forms uniformly and collapses `..`, so traversal can't climb out of the allowed roots.
 */
function pathIsProtectedWrite(rawPath: string, taskId?: string, cwd?: string): boolean {
  if (pathIsSensitiveRead(rawPath)) return true; // .env / .ssh / .aws / .gnupg are also write-protected
  const root = (cwd && cwd.startsWith('/') ? cwd : process.cwd()).replace(/\/+$/, '');
  const abs = resolve(root, rawPath); // relative→joined, absolute→as-is, '..' collapsed
  if (abs !== root && !abs.startsWith(root + '/')) return true; // resolves OUTSIDE the repo → protected
  const p = lc(abs === root ? '' : abs.slice(root.length + 1)); // repo-relative, normalized
  const own = taskId ? lc(taskId) : null;
  // WRITABLE roots = the post-turn confinement whitelist (post-turn.ts confinementCheck):
  if (p.startsWith('projects/')) return false; // the build's workflow output (cross-project caught post-turn)
  if (own && (p.startsWith(`.runs/${own}/`) || p.startsWith(`apps/builder/.runs/${own}/`))) return false;
  if (!own && /^(apps\/builder\/)?\.runs\/[^/]+\//.test(p)) return false; // direct-CLI: any own run dir
  if (p === '.vscode/settings.json') return false;
  return true; // EVERYTHING else → protected
}

/**
 * Does this path leave the repo? The READ twin of {@link pathIsProtectedWrite}'s escape test.
 *
 * WHY. The sensitive list below it is a DENY-list — `.env`/`.ssh`/`.aws`/credentials — so everything
 * NOT on it was readable anywhere on the machine: `cat /etc/passwd`, `cat ~/Documents/x` and
 * `ls -R /Users/<me>` all returned `allow`. That is not academic. A turn may write `projects/`
 * (pathIsProtectedWrite permits it) and the build IMPORTS that file into Dify — so read-anything +
 * write-workflow + import = an exfil channel that never touches the network `curl`/`wget` bans.
 * The write side has always been repo-scoped; the read side never was. This closes that asymmetry.
 *
 * `resolve` collapses `..`, so path-math traversal is caught. `realpathSync` additionally catches a
 * SYMLINK out (`vendor/dify-src` → ../../dify-workspace, 8.5 GB of Dify source outside the tree);
 * when the path is not on disk there is nothing to resolve and the collapsed form is the best answer —
 * a read of a non-existent file fails on its own anyway.
 */
function resolvesOutsideRepo(rawPath: string, cwd?: string): boolean {
  const rootRaw = (cwd && cwd.startsWith('/') ? cwd : process.cwd()).replace(/\/+$/, '');
  const lexical = resolve(rootRaw, rawPath); // '..' collapsed — honest about traversal, blind to symlinks
  // `.venv/` is EXEMPT from the symlink half, and must be: `.venv/bin/python` is a symlink to the
  // uv/system interpreter (~/.local/share/uv/…) by design, so realpath'ing it says "outside" and would
  // deny `.venv/bin/python tools/dify_base/find.py` — i.e. every build. It is not an exfil path: what a
  // turn may RUN through it is already pinned to ALLOWED_PYTHON_SCRIPTS (`python -c` is denied), and
  // `.venv/` is not a writable root. The exemption is LEXICAL, so `.venv/bin/../../../etc/passwd`
  // collapses out of `.venv/` above and is still checked.
  if (lexical.startsWith(rootRaw + '/.venv/')) return false;
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p; // not on disk → path math already collapsed '..'; nothing more to learn
    }
  };
  const root = real(rootRaw);
  const abs = real(lexical);
  return abs !== root && !abs.startsWith(root + '/');
}

/**
 * A Bash command touching anything outside the repo. Same tokenizer as {@link commandReferencesSecret}
 * (SIMPLE_COMMAND has already guaranteed no quotes/metachars, so a token IS what the shell sees).
 *
 * Non-path tokens cost nothing: a flag like `-la` resolves to `<root>/-la` — inside — so only a token
 * that leaves the tree can trip this. That keeps the false-positive surface at essentially zero for the
 * fixed command set, while `cat /etc/passwd` and `ls -R /Users/<me>` stop.
 *
 * Every token with a `/` is resolved, not just absolute/`..` ones: a RELATIVE token escapes too when it
 * crosses a symlink — `ls vendor/dify-src` looks repo-local and lands on ../../dify-workspace. (A first
 * cut skipped those to save a syscall and let exactly that through.) A bare word cannot escape: it
 * resolves under the root, and only a symlink AT the root could change that — none exists, and a turn
 * cannot make one (`ln` is denied, Write writes files).
 */
function commandReachesOutsideRepo(command: string, cwd?: string): string | null {
  for (const raw of command.split(/\s+/)) {
    const tok = raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw;
    if (!tok || !tok.includes('/')) continue; // a bare word/flag resolves under the root
    if (resolvesOutsideRepo(tok, cwd)) return tok;
  }
  return null;
}

/** Bash commands referencing a secret BY PATH (catches `cat apps/builder/.env`). Tokenizes — the
 *  SIMPLE_COMMAND gate guarantees no quotes/metachars, so a token IS what the shell sees — and reuses
 *  pathIsSensitiveRead per token (incl. `--flag=<path>` values). This both broadens the secret set and
 *  FIXES the substring false-positive: a legit `config.env.yml` workflow file is NOT flagged, while
 *  `apps/builder/.env` / `~/.netrc` are. Note: NOT `.venv` — legit commands start with `.venv/bin/python`. */
function commandReferencesSecret(command: string): boolean {
  for (const raw of command.split(/\s+/)) {
    const tok = raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw;
    if (tok && pathIsSensitiveRead(tok)) return true;
  }
  return false;
}

/**
 * Hard-deny forbidden-path access for a tool call — runs BEFORE the allow logic, cannot be overridden.
 * Returns a deny reason, or null if no forbidden path is touched.
 */
export function checkForbiddenPath(
  toolName: string,
  toolInput: Record<string, unknown>,
  taskId?: string,
  cwd?: string
): string | null {
  // Write-class tools carry the path in file_path OR notebook_path (MultiEdit/NotebookEdit too — H2).
  const filePath = (typeof toolInput?.file_path === 'string' ? toolInput.file_path : undefined)
    ?? (typeof toolInput?.notebook_path === 'string' ? toolInput.notebook_path : undefined);
  if (filePath) {
    if (WRITE_TOOLS.has(toolName)) {
      if (pathIsProtectedWrite(filePath, taskId, cwd)) return `forbidden: write to a protected path (${filePath})`;
    }
    if (toolName === 'Read') {
      if (pathIsSensitiveRead(filePath)) return `forbidden: read of a sensitive file (${filePath})`;
      if (resolvesOutsideRepo(filePath, cwd)) {
        return `forbidden: read outside the repo (${filePath}) — a turn only ever needs files in this repo`;
      }
    }
  }
  // Glob/Grep search root + pattern.
  if (toolName === 'Glob' || toolName === 'Grep') {
    const searchPath = typeof toolInput?.path === 'string' ? toolInput.path : undefined;
    if (searchPath && pathIsSensitiveRead(searchPath)) return `forbidden: ${toolName} on a sensitive path (${searchPath})`;
    if (searchPath && resolvesOutsideRepo(searchPath, cwd)) {
      return `forbidden: ${toolName} outside the repo (${searchPath})`;
    }
    for (const key of ['pattern', 'glob']) {
      const v = toolInput?.[key];
      if (typeof v === 'string' && (v.includes('.env') || v.includes('.ssh') || v.includes('.aws') || v.includes('.gnupg'))) {
        return `forbidden: ${toolName} ${key} references a sensitive path`;
      }
    }
  }
  // Bash command referencing a secret by name (the python/cat exfil vector).
  if (toolName === 'Bash' && typeof toolInput?.command === 'string') {
    if (commandReferencesSecret(toolInput.command)) {
      return `forbidden: command references a protected secret path (.env/.ssh/.aws/.gnupg)`;
    }
    // …and the same command reaching OUT of the repo at all. The secret list above is a deny-list; this
    // is the allow-list half — everything a phase legitimately reads lives in this tree (measured over
    // runs 1784263317775 / 1784265851924 / 1784267358546: .claude, .runs, apps, docs, projects, skills,
    // templates, tools — nothing else). Mirrors the write side, which has always been repo-scoped.
    const escapee = commandReachesOutsideRepo(toolInput.command, cwd);
    if (escapee) {
      return `forbidden: command reaches outside the repo (${escapee}) — a turn only ever needs files in this repo`;
    }
  }
  return null;
}

// ─── The decision (the dispatcher) ──────────────────────────────────────────────────────────────

/** Read-only / side-effect-free tools that are always safe once forbidden-paths has passed. */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'TodoWrite', 'WebSearch']);

/**
 * The pure decision for one PreToolUse payload. `abstain` (→ emit `{}`) defers to the settings'
 * permission model for tools the hook neither blesses nor blocks (it never broadens Bash — Bash is
 * always allow/deny). `taskId` (from BUILDER_TASK_ID) scopes the sibling-`.runs` write guard. `askMode`
 * (from BUILDER_ASK_MODE, spec 033 D3 layer 1) denies every write-class call outright for this turn.
 */
export function decide(input: HookInput, taskId?: string, askMode?: boolean): DecisionResult {
  // Fail CLOSED on a malformed payload (e.g. JSON `null`/an array) — a thrown decide() would emit no
  // decision and Claude Code would fail OPEN (spec 015 review H1).
  if (!input || typeof input !== 'object') {
    return { decision: 'deny', reason: 'malformed hook input — fail closed' };
  }
  if (input.hook_event_name && input.hook_event_name !== 'PreToolUse') {
    return { decision: 'abstain', reason: 'non-PreToolUse event' };
  }
  const toolName = input.tool_name ?? '';
  const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;

  // 0. Forbidden paths — hard deny, first (cannot be overridden by the allow logic below). `input.cwd`
  //    (the turn's cwd = repo root) anchors the write-allowlist's relative/absolute path resolution.
  const forbidden = checkForbiddenPath(toolName, toolInput, taskId, input.cwd);
  if (forbidden) return { decision: 'deny', reason: forbidden };

  // 1. Bash — allowlist-first (default-deny tail).
  if (toolName === 'Bash') {
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';
    return analyzeBashCommand(command);
  }

  // 2. Spec 033 D3 layer 1 — Ask mode: deny EVERY write-class call outright, checked before the
  //    existing write-allow below. A normal phase/reply/judge turn never sets BUILDER_ASK_MODE, so
  //    branch 3 below is untouched byte-for-byte for every other turn.
  if (askMode && WRITE_TOOLS.has(toolName)) {
    return { decision: 'deny', reason: 'Ask mode — this turn may not write files' };
  }

  // 3. Write-class (Write/Edit/MultiEdit/NotebookEdit) — forbidden-paths already passed; in-project → allow.
  if (WRITE_TOOLS.has(toolName)) {
    return { decision: 'allow', reason: 'in-project write' };
  }

  // 4. Read-only tools — safe once forbidden-paths passed.
  if (READ_ONLY_TOOLS.has(toolName)) return { decision: 'allow', reason: 'read-only tool' };

  // 5. Unknown tool → abstain (let the settings' allow-list decide; the hook never broadens it).
  return { decision: 'abstain', reason: `no opinion on ${toolName || 'unknown tool'}` };
}

// ─── Entry: read stdin → decide → emit the PreToolUse decision JSON ──────────────────────────────

function emit(result: DecisionResult): void {
  if (result.decision === 'abstain') {
    process.stdout.write('{}');
    return;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason,
    },
  }));
}

export function main(): void {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    // No stdin → fail safe: abstain (deny would block direct Claude Code usage of this repo).
    emit({ decision: 'abstain', reason: 'no hook input' });
    return;
  }
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    emit({ decision: 'abstain', reason: 'unparseable hook input' });
    return;
  }
  // BUILDER_TASK_ID is exported into the turn env by claude-session.ts so the sibling-`.runs` write
  // guard knows which task is "self". Absent (direct CLI use) → the guard is skipped.
  const taskId = process.env.BUILDER_TASK_ID || undefined;
  // Spec 033 D3 layer 1: BUILDER_ASK_MODE=1 (set by claude-session.ts only for an Ask turn) denies
  // every write-class call outright for this call. Absent for every other turn → decide()'s existing
  // write-allow branch is unaffected.
  const askMode = process.env.BUILDER_ASK_MODE === '1';
  // Fail CLOSED: any throw computing the decision DENIES rather than emitting nothing (which Claude Code
  // would treat as no-decision → fail OPEN, turning the whole gate off for that call — review H1).
  let result: DecisionResult;
  try {
    result = decide(input, taskId, askMode);
  } catch {
    result = { decision: 'deny', reason: 'permission hook error — fail closed' };
  }
  emit(result);
}

// Run main() ONLY when this file is the process entry — so a unit-test `import` never blocks on stdin.
const isEntry = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (isEntry) main();
