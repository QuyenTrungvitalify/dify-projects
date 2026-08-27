// qa-stop.test.ts — spec 097: Stop is offered on EVERY ask, and the pending bubble is not full-width.
//
// The gap this guards: the top-bar stop pill was gated `asking && task?.kind === 'consult'`, so an ask
// on a BUILD — the common case, asking about a finished build — had no way to abort at all and the
// wall-clock was the only escape. That is what made a 3-minute budget feel like a hang, and what would
// have made the new 8-minute budget worse. The button is what pays for the longer wall, so it is pinned
// as a source-shape fact rather than left to a screenshot.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src');
const app = readFileSync(join(HERE, 'components', 'App.tsx'), 'utf8');
const chat = readFileSync(join(HERE, 'components', 'Chat.tsx'), 'utf8');
const css = readFileSync(join(HERE, 'styles', 'surface-blocks.css'), 'utf8');

describe('097 · Stop on every ask', () => {
  test('QaAnswer takes an onStop and renders it only while the answer is still running', () => {
    assert.match(chat, /onStop\?: \(\) => void/);
    assert.match(chat, /\{!done && onStop && \(/);
  });

  test('the call site passes onStop for any unfinished answer — no consult gate', () => {
    const at = app.indexOf('<QaAnswer');
    assert.notEqual(at, -1);
    const block = app.slice(at, at + 700);
    assert.match(block, /onStop=\{item\.done \? undefined : /);
    assert.doesNotMatch(block, /kind === 'consult'/);
  });

  test('the top pill no longer duplicates it (it ends the BUILD, never an ask)', () => {
    // Two controls for one action read as two different actions; the bubble owns ask-stopping now.
    assert.doesNotMatch(app, /asking && task\?\.kind === 'consult'/);
    // The pill grew a second state — it is also the discard for any parked gate that offers one — so
    // its condition is no longer the bare `busy`. What this guards is unchanged and is the reason the
    // shape is pinned at all: BOTH states are build facts (a running turn, or the gate's own cancel
    // action), so no amount of asking can put a second stop button on the screen.
    assert.match(app, /const endPill = endBuildPill\(busy, gateOffersCancel\(task\)\)/);
    assert.match(app, /view === 'conversation' && endPill && \(/);
  });

  test('the pill is dead while an ask streams — /cancel would abort the ANSWER, not the build', () => {
    // POST /cancel returns early when the live turn is an ask (routes/tasks.ts): it force-kills that
    // child and leaves task.status alone. So a 「ビルドを破棄」 click mid-answer would silently end the
    // answer and leave the build exactly where it was — a control that lies about what it did. The
    // docked bar it inherited this action from was disabled the same way (`busy || asking`).
    const at = app.indexOf("view === 'conversation' && endPill && (");
    assert.notEqual(at, -1);
    const block = app.slice(at, at + 700);
    assert.match(block, /disabled=\{endPill === 'discard' && asking\}/);
  });

  test('the stop hint is translated (a JA reader must not meet English on a control)', () => {
    const i18n = readFileSync(join(HERE, 'lib', 'i18n.ts'), 'utf8');
    assert.equal([...i18n.matchAll(/stopAnswerHint:/g)].length, 2, 'EN + JA');
    assert.match(i18n, /stopAnswerHint: 'この回答を停止します/);
  });
});

describe('097 · the pending bubble hugs its content', () => {
  test('a body-less bubble gets the thin modifier', () => {
    // Full-width for a spinner and two words read as an EMPTY answer rather than a pending one.
    assert.match(chat, /'qa-bubble' \+ \(html \? '' : ' qa-thin'\)/);
  });

  test('the modifier actually shrinks it (a class with no rule would be a silent no-op)', () => {
    assert.match(css, /\.qa-bubble\.qa-thin\s*\{[^}]*width:\s*auto/);
    assert.match(css, /\.qa-stop\s*\{/);
  });
});
