/**
 * hook-check.ts — boot-time smoke that the PreToolUse permission hook is actually LOADABLE (spec 019 L4).
 *
 * WHY. A build turn runs under `--permission-mode acceptEdits`; the structural confinement (deny `python
 * -c`, reads of `.env`, writes to `.venv`, sibling-`.runs` writes) lives in the PreToolUse hook
 * `apps/builder/server/hooks/permission-gate.ts`, invoked by Claude Code as a bare
 * `node ... permission-gate.ts` — which relies on Node ≥22.6 running `.ts` natively. If the host node
 * can't load the `.ts` (older node, stripping disabled, file moved), the hook spawn fails and Claude
 * Code treats a no-output PreToolUse as no-decision → the gate is OFF for that call: the sandbox **fails
 * OPEN** and nothing detects it. This module spawns the EXACT configured command at boot and verifies it
 * runs + emits a decision, so the operator is warned (v1 = warn-not-fail) instead of silently unguarded.
 *
 * It mirrors the real invocation precisely (the command string read from the settings file, cwd =
 * projectsDir, a representative PreToolUse JSON on stdin) so it never false-refuses on a healthy host.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export interface HookCheckResult {
  ok: boolean;
  detail: string;
}

/** Read the PreToolUse hook command from a Claude Code settings file. Returns null if absent/unreadable. */
export async function readPreToolUseCommand(settingsPath: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    const cmd = parsed.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command;
    return typeof cmd === 'string' && cmd.trim() ? cmd.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Spawn the hook command exactly as Claude Code does (cwd = projectsDir, a benign PreToolUse payload on
 * stdin) and verify it RAN: exit 0 + parseable JSON on stdout (proving the `.ts` executed and emitted a
 * decision — on a node that can't load `.ts`, the spawn errors / exits non-zero with no JSON). Resolves
 * `{ok:false}` (never throws) so the caller can warn-and-continue.
 */
export function checkHookLoadable(projectsDir: string, command: string): Promise<HookCheckResult> {
  const argv = command.split(/\s+/).filter(Boolean);
  if (argv.length === 0) return Promise.resolve({ ok: false, detail: 'empty hook command' });
  const [cmd, ...args] = argv;
  // A representative PreToolUse frame — enough for the hook to run decide() and emit a JSON decision.
  const stdinPayload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: '.venv/bin/python tools/dify_base/find.py --list-features' },
    cwd: projectsDir,
    permission_mode: 'acceptEdits',
  });

  return new Promise<HookCheckResult>((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: projectsDir, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, detail: `spawn threw: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('error', (e) => resolve({ ok: false, detail: `spawn error: ${e.message}` }));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, detail: `exit ${code}: ${err.trim().slice(0, 200)}` });
        return;
      }
      try {
        JSON.parse(out);
        resolve({ ok: true, detail: 'hook loaded and emitted a decision' });
      } catch {
        resolve({ ok: false, detail: `exit 0 but non-JSON output: ${out.trim().slice(0, 120)}` });
      }
    });
    child.stdin.on('error', () => {
      /* a hook that exits before reading stdin → EPIPE; the close handler decides */
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

export interface SmokeLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

/**
 * Boot helper: read the configured PreToolUse command and smoke it; log a LOUD warning when it does not
 * load (the fail-open condition) and an info line when it does. v1 = warn-not-fail (returns the result so
 * a caller could choose to refuse-to-start instead). Mirrors the real invocation, so a healthy host
 * (Node ≥22.6) never trips it.
 */
export async function smokePermissionHook(
  projectsDir: string,
  settingsPath: string,
  log: SmokeLogger
): Promise<HookCheckResult> {
  const command = await readPreToolUseCommand(settingsPath);
  if (!command) {
    const r = { ok: false, detail: 'no PreToolUse hook command in settings' };
    log.warn(
      { settingsPath },
      'L4: no PreToolUse permission hook is configured — turn confinement relies on the static glob deny-list ONLY (a Bash `python -c` can bypass it). Check headless-settings.json.'
    );
    return r;
  }
  const r = await checkHookLoadable(projectsDir, command);
  if (r.ok) {
    log.info({ command }, 'L4: PreToolUse permission hook smoke-check passed');
  } else {
    log.warn(
      { command, detail: r.detail },
      'L4 SECURITY: the PreToolUse permission hook did NOT load — the turn sandbox FAILS OPEN (sibling-write / token-exfil guards are off). Most likely the host Node cannot run the `.ts` hook (needs Node ≥22.6). The builder will still start; fix the runtime to restore confinement.'
    );
  }
  return r;
}

/**
 * SEC1 (spec 024): decide whether boot must refuse based on the hook smoke result.
 * Refuse when the hook is not loadable/configured (fail-open condition) UNLESS the operator
 * explicitly opts out via BUILDER_ALLOW_UNGUARDED=1. A healthy host (r.ok) never refuses.
 */
export function gateBootOnHook(
  result: HookCheckResult,
  allowUnguarded: boolean
): { refuse: boolean; reason?: string } {
  if (result.ok) return { refuse: false };
  if (allowUnguarded) return { refuse: false };
  return {
    refuse: true,
    reason:
      `SEC1: refusing to start — the PreToolUse permission hook did not load (${result.detail}). ` +
      `The turn sandbox would fail OPEN. Fix the host runtime (needs Node ≥22.6 to run the .ts hook), ` +
      `or set BUILDER_ALLOW_UNGUARDED=1 to start unguarded at your own risk.`,
  };
}
