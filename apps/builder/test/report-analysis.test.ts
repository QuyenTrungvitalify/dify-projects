/**
 * report-analysis.test.ts — spec 075 S1. The classifier is ASYMMETRIC on purpose: auto_fail is a
 * sound structural-impossibility verdict, auto_pass is withheld to purely-structural (lint) criteria,
 * everything behavioral is manual. These tests pin exactly that so a future "helpful" widening that
 * starts auto_pass-ing behavioral sentences (the overclaiming trap) fails here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCriterion,
  classifyCriteria,
  criteriaSummaryNote,
  summarizeTimeline,
  type CriterionFacts,
} from '../server/lib/report-analysis.js';
import type { RunEvent } from '../server/lib/run-events.js';

const HAS_ALL: CriterionFacts = { lintClean: true, hasTriggerEntry: true, hasToolNode: true };
const HAS_NONE: CriterionFacts = { lintClean: true, hasTriggerEntry: false, hasToolNode: false };

describe('classifyCriterion — auto_fail is sound (structural impossibility)', () => {
  test('criterion needs a trigger, build has none → auto_fail', () => {
    const c = classifyCriterion('毎週金曜に自動起動して集計を送信する', HAS_NONE);
    assert.equal(c.status, 'auto_fail');
  });

  test('criterion needs a tool/service, build has no tool node → auto_fail', () => {
    const c = classifyCriterion('Chatworkのルームに通知を送信する', { ...HAS_NONE });
    assert.equal(c.status, 'auto_fail');
  });

  test('tool criterion that says http is NOT auto_failed on missing tool node (http is the tool)', () => {
    // A build can legitimately hit Chatwork via http-request instead of a tool node.
    const c = classifyCriterion('ChatworkへhttpでPOSTする', { ...HAS_NONE });
    assert.notEqual(c.status, 'auto_fail');
  });
});

describe('classifyCriterion — auto_pass is WITHHELD except pure structural claims', () => {
  test('behavioral sentence with a trigger present → manual, NOT auto_pass', () => {
    // The overclaiming trap: trigger exists, but "1件送信される per receipt" needs a live run.
    const c = classifyCriterion('webhookで受信ごとに通知が1件送信される', HAS_ALL);
    assert.equal(c.status, 'manual');
    assert.match(c.basis, /trigger entry ✓/);
  });

  test('pure validation/import claim + lint clean → auto_pass', () => {
    const c = classifyCriterion('ワークフローファイルがDifyにインポートできる', HAS_ALL);
    assert.equal(c.status, 'auto_pass');
  });

  test('same validation claim but lint dirty → auto_fail', () => {
    const c = classifyCriterion('ワークフローファイルがDifyにインポートできる', { ...HAS_ALL, lintClean: false });
    assert.equal(c.status, 'auto_fail');
  });

  test('a behavioral criterion never auto_passes even with everything present', () => {
    const c = classifyCriterion('悪い評価だけを集計してトップ3を出す', HAS_ALL);
    assert.equal(c.status, 'manual');
  });
});

describe('classifyCriterion — default manual', () => {
  test('an ordinary behavioral sentence with no structural hook → manual', () => {
    const c = classifyCriterion('金額は書き換えず、正確に転記する', HAS_ALL);
    assert.equal(c.status, 'manual');
  });

  test('AC-S1: an unmapped criterion is manual, never a guessed auto_pass', () => {
    for (const c of classifyCriteria(['出力は日本語である', '3つ以内の箇条書き'], HAS_ALL)) {
      assert.equal(c.status, 'manual');
    }
  });
});

describe('criteriaSummaryNote', () => {
  test('null when no criteria', () => {
    assert.equal(criteriaSummaryNote([]), null);
  });
  test('counts the three buckets', () => {
    const note = criteriaSummaryNote([
      { text: 'a', status: 'auto_pass', basis: '' },
      { text: 'b', status: 'auto_fail', basis: '' },
      { text: 'c', status: 'manual', basis: '' },
      { text: 'd', status: 'manual', basis: '' },
    ]);
    assert.match(note!, /set 4 acceptance criteria/);
    assert.match(note!, /1 tự-kiểm đạt/);
    assert.match(note!, /1 tự-kiểm KHÔNG đạt/);
    assert.match(note!, /2 cần bạn chạy thử/);
  });
});

describe('summarizeTimeline', () => {
  const ev = (ts: number, kind: RunEvent['kind'], phase?: string, detail?: string): RunEvent => ({ ts, kind, phase, detail });

  test('per-phase working ms = phase_start → first gate_reached; total = first ts → last gate', () => {
    const events: RunEvent[] = [
      ev(1000, 'phase_start', 'analyze', 'fresh'),
      ev(1133, 'gate_reached', 'analyze', 'success'),
      ev(1133, 'gate_action', 'analyze', 'continue'),
      ev(1133, 'phase_start', 'spec', 'fresh'),
      ev(1326, 'gate_reached', 'spec', 'success'),
      ev(1326, 'phase_start', 'implement', 'fresh'),
      ev(1660, 'gate_reached', 'implement', 'success'),
    ];
    const tl = summarizeTimeline(events);
    assert.deepEqual(
      tl.phases.map((p) => [p.phase, p.workingMs]),
      [['analyze', 133], ['spec', 193], ['implement', 334]]
    );
    assert.equal(tl.totalMs, 660);
  });

  test('a phase that started but never gated → workingMs null', () => {
    const tl = summarizeTimeline([ev(1000, 'phase_start', 'analyze'), ev(1050, 'error', 'analyze', 'boom')]);
    assert.deepEqual(tl.phases, []); // no gate_reached → not recorded as a completed span
    assert.equal(tl.totalMs, null);
  });

  test('empty events → empty timeline, null total', () => {
    const tl = summarizeTimeline([]);
    assert.deepEqual(tl.phases, []);
    assert.equal(tl.totalMs, null);
  });

  test('a resume re-reaching a gate does not double-count the phase', () => {
    const tl = summarizeTimeline([
      ev(1000, 'phase_start', 'implement', 'fresh'),
      ev(1300, 'gate_reached', 'implement', 'success'),
      ev(1400, 'phase_start', 'implement', 'resume'),
      ev(1500, 'gate_reached', 'implement', 'success'),
    ]);
    assert.equal(tl.phases.length, 1);
    assert.equal(tl.phases[0].workingMs, 300); // first span, not the resume
  });
});
