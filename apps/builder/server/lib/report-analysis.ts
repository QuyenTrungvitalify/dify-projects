/**
 * report-analysis.ts — pure helpers that turn a run's ALREADY-RECORDED data into report.json fields
 * (spec 075 S1). Two things a run captured but no report ever read: the acceptance criteria the build
 * wrote for itself (criteria.json) and the per-phase timeline (events.jsonl).
 *
 * DESIGN — the anti-overclaiming rule this repo keeps re-learning. An acceptance criterion is a whole
 * natural-language sentence ("webhookで受信ごとに通知が1件送信される") that bundles a STRUCTURAL claim
 * (there is a webhook trigger) with a BEHAVIORAL one (exactly one message goes out per receipt). A
 * static ④ can verify the structure but NOT the behavior — that needs a live run. So the classifier is
 * ASYMMETRIC:
 *   - `auto_fail` is trustworthy: if a criterion REQUIRES a structure the build provably lacks (needs a
 *     trigger, none exists; needs a tool node, none exists), the criterion cannot be met, full stop.
 *   - `auto_pass` is WITHHELD: structure present ≠ whole sentence satisfied, so a present structure only
 *     downgrades to `manual` (never claims pass). Lint-only criteria — the sentence is purely "the file
 *     validates / imports" — are the one exception that can auto_pass, since there the sentence IS the
 *     structural check.
 * Everything unmatched defaults to `manual` (OQ1: prefer a miss over a wrong match). The value is
 * SURFACING the rubric + attaching the structural fact, not pretending to grade behavior.
 */
import type { RunEvent } from './run-events.js';

export type CriterionStatus = 'auto_pass' | 'auto_fail' | 'manual';

export interface CriterionCheck {
  text: string;
  status: CriterionStatus;
  /** Why this bucket — the fact consulted, in plain words. Always present for auto_*; a hint for manual. */
  basis: string;
}

/** The already-computed structural facts runReport has on hand. Kept minimal + boolean so this stays pure. */
export interface CriterionFacts {
  lintClean: boolean;
  hasTriggerEntry: boolean;
  hasToolNode: boolean;
}

// Keyword sets — matched case-insensitively as substrings so JA/VI/EN all land. Deliberately broad on
// the REQUIREMENT side (what the criterion asks for) and narrow on the auto_pass side.
const RE_TRIGGER = /webhook|トリガー|trigger|スケジュール|schedule|定期|毎日|毎週|毎月|cron|lịch|định kỳ/i;
const RE_TRIGGER_FIRE = /起動|発火|受信|届く|送信され|fire|run|chạy|kích hoạt|tự động/i;
const RE_TOOL = /chatwork|slack|スプレッドシート|spreadsheet|google ?sheet|notion|github|gmail|tool|プラグイン|plugin/i;
const RE_LINT_ONLY = /バリデーション|検証|インポートでき|import(s|able)?|validate|自動チェック|hợp lệ|import được/i;
const RE_BEHAVIOR = /1件|1行|ごと|順|並|集計|要約|抜き出|分類|判定|しきい|閾|以上|未満|トップ|top|sort|group|đếm|lọc|gom|phân loại|tóm/i;

/**
 * Classify ONE criterion. Sound-not-complete: only returns auto_* when a deterministic fact settles it.
 */
export function classifyCriterion(text: string, f: CriterionFacts): CriterionCheck {
  const t = text.trim();
  const needsTrigger = RE_TRIGGER.test(t) && RE_TRIGGER_FIRE.test(t);
  const needsTool = RE_TOOL.test(t);

  // auto_fail — a required structure is provably absent → the sentence cannot hold. Trustworthy.
  if (needsTrigger && !f.hasTriggerEntry) {
    return { text: t, status: 'auto_fail', basis: 'tiêu chí đòi một trigger (webhook/schedule) nhưng build không có trigger entry nào' };
  }
  if (needsTool && !f.hasToolNode && !/http/i.test(t)) {
    return { text: t, status: 'auto_fail', basis: 'tiêu chí đòi gọi một tool/dịch vụ nhưng build không có tool node' };
  }

  // auto_pass — ONLY when the sentence is purely a validation/import claim (no behavioral verb). There
  // the structural check IS the whole criterion, so lint settles it both ways.
  if (RE_LINT_ONLY.test(t) && !RE_BEHAVIOR.test(t) && !needsTrigger && !needsTool) {
    return f.lintClean
      ? { text: t, status: 'auto_pass', basis: '4 linter sạch — file hợp lệ/import được (tiêu chí thuần cấu trúc)' }
      : { text: t, status: 'auto_fail', basis: 'linter còn lỗi — file chưa hợp lệ' };
  }

  // manual — attach the structural fact as a non-authoritative hint so the human/judge sees it too.
  const hints: string[] = [];
  if (needsTrigger) hints.push('có trigger entry ✓ (nhưng hành vi phát-mỗi-lần cần chạy thật)');
  if (needsTool) hints.push('có tool node ✓ (nhưng hành vi gọi thật cần chạy thật)');
  return {
    text: t,
    status: 'manual',
    basis: hints.length ? hints.join(' · ') : 'câu hành vi — chỉ xác nhận được khi chạy thật',
  };
}

export function classifyCriteria(criteria: string[], f: CriterionFacts): CriterionCheck[] {
  return criteria.map((c) => classifyCriterion(c, f));
}

/** One-line human summary for report.notes: "Build tự đặt N tiêu chí; A tự-kiểm, B cần chạy thật." */
export function criteriaSummaryNote(checks: CriterionCheck[]): string | null {
  if (!checks.length) return null;
  const pass = checks.filter((c) => c.status === 'auto_pass').length;
  const fail = checks.filter((c) => c.status === 'auto_fail').length;
  const manual = checks.filter((c) => c.status === 'manual').length;
  const parts: string[] = [];
  if (pass) parts.push(`${pass} tự-kiểm đạt`);
  if (fail) parts.push(`${fail} tự-kiểm KHÔNG đạt`);
  if (manual) parts.push(`${manual} cần bạn chạy thử để xác nhận`);
  return `This build set ${checks.length} acceptance criteria for itself: ${parts.join(', ')}.`;
}

export interface PhaseTiming {
  phase: string;
  /** ms from this phase's start to its gate — the WORK time. null if the phase never reached a gate. */
  workingMs: number | null;
  outcome?: string;
}

export interface Timeline {
  phases: PhaseTiming[];
  totalMs: number | null;
}

/**
 * Fold events.jsonl into per-phase working times. `phase_start` opens a phase; the first `gate_reached`
 * after it closes the working span (detail = outcome). Robust to missing events: a phase with a start
 * but no gate gets workingMs=null. Human wait-at-gate time is deliberately NOT counted here (OQ2 —
 * `gate_reached → gate_action` is the human, a different number); this is machine work time only.
 */
export function summarizeTimeline(events: RunEvent[]): Timeline {
  const phases: PhaseTiming[] = [];
  const startByPhase = new Map<string, number>();
  let firstTs: number | null = null;
  let lastGateTs: number | null = null;

  for (const ev of events) {
    if (firstTs === null) firstTs = ev.ts;
    const phase = ev.phase ?? '(none)';
    if (ev.kind === 'phase_start') {
      startByPhase.set(phase, ev.ts);
    } else if (ev.kind === 'gate_reached') {
      const started = startByPhase.get(phase);
      // Only record the FIRST gate per phase (a resume can re-reach it); skip if already recorded.
      if (!phases.some((p) => p.phase === phase)) {
        phases.push({ phase, workingMs: started != null ? ev.ts - started : null, outcome: ev.detail });
      }
      lastGateTs = ev.ts;
    }
  }
  return { phases, totalMs: firstTs != null && lastGateTs != null ? lastGateTs - firstTs : null };
}
