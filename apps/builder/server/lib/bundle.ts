/**
 * bundle.ts — spec 062 S2/S5. Assemble a run's dossier zip: the on-disk artifacts + persisted
 * transcripts + the S1b timeline + the user's attachments + a generated `summary.md` (S3).
 *
 * CONFINEMENT (S5): reads ONLY the task's run dir (`.runs/<taskId>/`) and its workflow subtree
 * (`projects/<project>/<slug>/`) — never a path from the request. Every TEXT file passes
 * `redactSecrets` before it enters the zip (defense in depth — a DSL/report/prompt could echo a pasted
 * token); `sessionIds` is stripped from the bundled task.json. Attachments are BINARY → added raw
 * (redacting bytes would corrupt them), bounded by a ~25 MB total cap; any overflow is stated in
 * summary.md so the omission is never silent.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { redactSecrets } from './dify-io.js';
import { zipStore, type ZipEntry } from './zip.js';
import { buildDossier, buildDossierData } from './dossier.js';
import { buildAskLedger } from './ask-ledger.js';
import type { ConsultChatLine } from './ask.js';
import { parseToolStats, type ToolStats } from './run-transcript.js';
import { collectBuildInfo } from './build-info.js';
import { readEvents } from './run-events.js';
import { specPathFor } from './artifacts.js';
import { taskDir, workflowDir, type Task } from '../state/task.js';

/** ~25 MB total attachment budget — the in-memory assembler's safety valve (OQ5). */
export const ATTACHMENT_CAP_BYTES = 25 * 1024 * 1024;

// The known run-dir artifacts (each optional — a missing one is simply skipped + noted in summary.md).
const RUN_ARTIFACTS = [
  'analyze.json',
  'criteria.json',
  'report.json',
  'diff.json',
  'preflight.json',
  'workspace.json',
  'events.jsonl',
  // Spec 101 §2.4: `runs.jsonl` shipped (27f0fc0) AFTER this list was written, so the dossier had been
  // going out WITHOUT the per-attempt phase timeline — the newest evidence source, and the one that
  // backs the "disk is a recoverable copy of the thread" claim. On the author's own machine the gap is
  // invisible (the run dir is right there); on a tester's machine it is the difference between a
  // diagnosable report and a guess. Same reason `events.jsonl` is here: both are machine-readable
  // timelines, both are already redaction-safe text, neither is rendered for a human in summary.md.
  'runs.jsonl',
] as const;

async function readText(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

async function listDir(abs: string): Promise<string[]> {
  try {
    return await readdir(abs);
  } catch {
    return [];
  }
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Build the dossier zip for `task`. Never reads outside the run dir + the task's workflow subtree.
 * Returns the complete archive buffer.
 */
export async function buildBundle(
  projectsDir: string,
  task: Task,
  opts?: { attachmentCapBytes?: number }
): Promise<Buffer> {
  const attachmentCap = opts?.attachmentCapBytes ?? ATTACHMENT_CAP_BYTES;
  const runDir = taskDir(projectsDir, task.taskId);
  const entries: ZipEntry[] = []; // everything EXCEPT summary.md (generated last, once we know the list)
  const text = (name: string, body: string): void => {
    entries.push({ name, data: Buffer.from(redactSecrets(body), 'utf8') });
  };

  // ── task.json — strip sessionIds (noise), then redact ──
  const rawTask = await readText(join(runDir, 'task.json'));
  const parsedTask = parseJson<Record<string, unknown>>(rawTask);
  if (parsedTask) {
    delete parsedTask.sessionIds;
    text('task.json', JSON.stringify(parsedTask, null, 2));
  }

  // ── the known run-dir artifacts ──
  const criteriaRaw = await readText(join(runDir, 'criteria.json'));
  const reportRaw = await readText(join(runDir, 'report.json'));
  for (const f of RUN_ARTIFACTS) {
    const body = await readText(join(runDir, f));
    if (body != null) text(f, body);
  }

  // ── SPEC.md + the workflow DSL (from the workflow subtree — specPathFor/workflowDir are confined) ──
  const spec = await readText(specPathFor(projectsDir, task));
  if (spec != null) text('SPEC.md', spec);
  const wfRel = workflowDir(task);
  if (wfRel) {
    const wfDir = join(projectsDir, wfRel, 'workflows');
    for (const f of await listDir(wfDir)) {
      if (!/\.ya?ml$/i.test(f)) continue;
      const body = await readText(join(wfDir, f));
      if (body != null) text(`workflows/${f}`, body);
    }
  }

  // ── transcripts/<phase>.md (S1) — already redacted at write time; redact again is idempotent.
  //    Parse each back into a per-phase tool-activity tally for the dossier's Process section ──
  const toolStats: Partial<Record<'analyze' | 'spec' | 'implement' | 'test', ToolStats>> = {};
  for (const f of await listDir(join(runDir, 'transcripts'))) {
    if (!f.endsWith('.md')) continue;
    const body = await readText(join(runDir, 'transcripts', f));
    if (body == null) continue;
    text(`transcripts/${f}`, body);
    const phase = f.replace(/\.md$/, '');
    if (phase === 'analyze' || phase === 'spec' || phase === 'implement' || phase === 'test') {
      const stats = parseToolStats(body);
      if (stats.total) toolStats[phase] = stats;
    }
  }

  // ── the ask transcript + its ledger ──
  // The conversation ABOUT a build is part of the record of that build, and until now the bundle carried
  // none of it. It also carries the only durable evidence that the ask optimisation still holds: each
  // answer records the prompt it was sent (spec 098 cut that from ~143KB to ~5KB) and what the turn cost.
  // `ask-ledger.md` renders those rows so the question is answerable by reading, not by re-measuring.
  const chatRaw = await readText(join(runDir, 'chat.jsonl'));
  if (chatRaw != null) {
    text('chat.jsonl', chatRaw);
    const lines: ConsultChatLine[] = chatRaw
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as ConsultChatLine; } catch { return null; } })
      .filter((l): l is ConsultChatLine => !!l);
    const ledger = buildAskLedger(lines);
    if (ledger) text('ask-ledger.md', ledger);
  }

  // ── attachments (BINARY, raw, capped) — scan the confined uploads/ dir, never trust a request path ──
  let attachTotal = 0;
  let attachmentsOmitted = 0;
  for (const f of (await listDir(join(runDir, 'uploads'))).sort()) {
    const abs = join(runDir, 'uploads', f);
    let buf: Buffer;
    try {
      buf = await readFile(abs);
    } catch {
      continue;
    }
    if (attachTotal + buf.length > attachmentCap) {
      attachmentsOmitted++;
      continue;
    }
    attachTotal += buf.length;
    entries.push({ name: `attachments/${f}`, data: buf }); // raw — never redacted (would corrupt binary)
  }

  // ── shared dossier inputs (the timeline + parsed artifacts) ──
  const events = await readEvents(runDir);
  const report = parseJson<{ notes?: unknown }>(reportRaw);
  const reportNotes = Array.isArray(report?.notes)
    ? (report!.notes as unknown[]).filter((n): n is string => typeof n === 'string')
    : null;
  const criteria = parseCriteria(criteriaRaw);
  const omittedNote = attachmentsOmitted
    ? `${attachmentsOmitted} attachment(s) omitted — over the ${Math.round(attachmentCap / (1024 * 1024))} MB cap`
    : null;

  // ── build-info.json (#1) — provenance stamp so a fleet of exports correlates behavior ↔ version ──
  const models = [...new Set(Object.values(task.cost ?? {}).map((c) => c?.model).filter((m): m is string => !!m))];
  const info = await collectBuildInfo(projectsDir, models, Date.now());
  text('build-info.json', JSON.stringify(info, null, 2));

  // The final listing; summary.md + dossier.json are the two generated files added last.
  const fileNames = ['summary.md', 'dossier.json', ...entries.map((e) => e.name)];
  const dossierInput = { task, events, criteria, reportNotes, files: fileNames, omittedNote, toolStats };

  // ── dossier.json (#2) — the machine-readable twin (fleet aggregation via jq) ──
  text('dossier.json', JSON.stringify(buildDossierData(dossierInput), null, 2));

  // summary.md leads the archive so the reader opens it first.
  const summary = buildDossier(dossierInput);
  return zipStore([{ name: 'summary.md', data: Buffer.from(redactSecrets(summary), 'utf8') }, ...entries]);
}

/** criteria.json is `{ criteria: [...] }` (or a bare array); each item is EITHER a plain string (the
 *  real persistCriteria shape — verified against a live export) OR a `{criterion}` object. Normalize
 *  both to the `{criterion}` list the dossier renders. */
function parseCriteria(raw: string | null): Array<{ criterion?: string }> | null {
  const parsed = parseJson<unknown>(raw);
  if (!parsed) return null;
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { criteria?: unknown }).criteria)
      ? (parsed as { criteria: unknown[] }).criteria
      : null;
  if (!arr) return null;
  return arr
    .map((c) =>
      typeof c === 'string'
        ? { criterion: c }
        : c && typeof c === 'object'
          ? { criterion: String((c as { criterion?: unknown }).criterion ?? '') }
          : null
    )
    .filter((c): c is { criterion: string } => !!c && !!c.criterion.trim());
}
