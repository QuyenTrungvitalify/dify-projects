# Spec 049 — Dify import-blocker defense: mirror-the-source linting, real-import probe, recovery UX

**Status**: Draft — authored 2026-07-08 from a live field incident (same-day root-caused + empirically
verified). **S–M** (~1–1.5 ngày). The theme: our linters are a MIMIC of Dify's rules and a mimic
drifts, so the guarantee has three layers — (L1) copy the rules from Dify's own source, (L2) ask the
REAL Dify before calling a build done, (L3) give the field user a recovery path that actually edits.

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-08.

**Builds on**: [013](013-builder-linter-contract-and-test-seams.md) (D1 lives INSIDE
`validate_workflow.py` — the LINTERS list itself does not change, so the ③ gate and the ④ report
inherit it with zero plumbing); [020](020-lint-severity-policy.md) (D2 ships warn-only →
measure → promote); [032](032-builder-live-workflow-test.md)/[036](036-builder-capability-aware-test-targets.md)
(the `sync.py push` import path + the auto-delete-test-apps precedent D2 reuses);
[037](037-runnability-preflight-and-workspace-facts.md) (the advisory-note channel D2's probe note
rides; the runnability classes stay untouched — import blockers are a DIFFERENT failure family);
[041](041-builder-test-gate-revision-routing.md) (the `/reply` → Implement revision path D3's
guidance points users at); [045](045-turn-failure-triage.md) (the "name the cause at the gate"
philosophy, now applied to Dify's own errors).

---

## Motivation — the 2026-07-08 incident

A field build (ChatWork 催促通知フロー) failed Dify Studio import. All 4 linters passed the file; the
runnability probe (037) had no relevant class. Root cause, proven against `vendor/dify-src` and by
API reproduction: the build wrote

```yaml
environment_variables:
- variable: CHATWORK_API_TOKEN     # ← the START-NODE INPUT shape
  value_type: secret
  value: ''
```

but Dify's `build_environment_variable_from_mapping` (`api/factories/variable_factory.py`) requires
the key **`name:`** → `POST /apps/imports` returns HTTP 400 `{"error":"missing name",
"imported_dsl_version":""}`. A one-key fix imported `status: completed` on the first try.

Three structural lessons, one per decision below:
1. **Nobody was watching this shape.** It was the FIRST corpus build ever to emit an env var; 6/7
   pattern templates carry `environment_variables: []` so the model hand-wrote the shape from memory
   — and no linter validates that block. Rules that exist only in the model's memory WILL regress.
2. **We cannot pre-enumerate Dify's rules.** The mimic-linter approach caps out at "the rules we've
   met". The only oracle that catches EVERY import blocker — including ones Dify adds later — is a
   real import against the user's own Dify.
3. **The field recovery path is misunderstood.** The natural user instinct is to paste the error
   into **Ask** — but Ask is Q&A by design (its layer-2 restore REVERTS file edits). The path that
   actually fixes is **Request changes** (`/reply`, routes to the Implement session per 041) or
   Edit-again-from-done (035). Nothing tells users this.

## Decisions

- **D1 · `validate_workflow.py` learns the variables block (locked).** New check, mirrored from
  `vendor/dify-src/api/factories/variable_factory.py` (`build_environment_variable_from_mapping` /
  `build_conversation_variable_from_mapping` — the same factory validates both): every entry of
  `workflow.environment_variables` AND `workflow.conversation_variables` must have (a) a non-empty
  string `name` — when the entry carries `variable:` and no `name:`, the error says so explicitly:
  `environment_variables entries use 'name:' — 'variable:' is the start-node input shape (Dify
  import fails "missing name")`; (b) a `value_type`; (c) a `value` key that is present and not YAML
  null (empty string IS valid — Dify checks `is None`, mirrored exactly). Exit non-zero per the
  linter contract. Placement INSIDE `validate_workflow.py` — the LINTERS list, docs-contract-pin,
  and the 013 cross-consumer identity suite all stay byte-unchanged.
  - D1b *(r2 fold-in)*: the `dify-import-gap-matrix` mining workflow (running at authoring time) will
    enumerate the remaining hard-fails on the import path from `app_dsl_service.py` etc.; each
    CONFIRMED rule lands as an additional check in the same style. Tracked as **OQ2** until the
    matrix lands — S1 does NOT block on it.
- **D2 · ④ import-probe — ask the real Dify (locked; advisory in v1 per 020).** On the STATIC ④
  report, when `difyTargets().selfhost` is true and the build is NOT already on a real-import path
  (`task.testMode !== 'live'` and the flow won't push anyway): the backend does a real
  `sync.py push` of the produced YAML (probe-prefixed app name), captures the outcome, and
  **immediately deletes** the created app (the 036 auto-delete precedent; a failed import creates no
  app — verified live: `app_id: null` on failure). Outcome rides the advisory channel:
  - success → note `import-probe: OK — Dify <version> accepted this DSL (probe app deleted)`;
  - failure → note `import-probe FAILED: <Dify's error, redactSecrets'd, verbatim>` — the verbatim
    error is deliberate: it is exactly what the `/reply` fix-turn needs;
  - no creds / network down / timeout → note `import-probe: skipped (<reason>)` — degrade, never
    block (the 037 probe-degrade precedent).
  Mechanics: a new `runImportProbe` runner on the 013 D2 seam (`OrchestratorRunners`, real impl
  wraps `pushApp` + `sync.py delete` via `runSyncPy`); `runTestAndFinish` invokes it and threads the
  note into `runReport` via a new `ReportOpts.probeNote` (the `importNote` precedent). NEVER feeds
  `lintClean`, never gates, never runs on the live path (the live test already IS the oracle).
  v1 is warn-only; promotion to a gate is **OQ1** after field FP measurement (020 discipline).
- **D3 · Recovery UX — point the user at the door that opens (locked).** HUONG_DAN §7 gains the row:
  *Import vào Dify báo lỗi* → copy NGUYÊN VĂN error → mở build → **"Request changes"** (KHÔNG phải
  Ask — Ask chỉ trả lời, không sửa file) → dán error + nói rõ đang import thì lỗi → build tự sửa →
  tải lại YAML. One matching line lands in §6 (Lưu ý quan trọng).
- **D4 · Copy-don't-recall snippet (locked).** `implement.md` step 4 gains ONE sub-bullet:
  **Environment variables:** entries use `name:` (+ `value_type`; `value` present, `''` OK) —
  NEVER `variable:` (start-node input shape; Dify import 400s `missing name`). The `{{KNOWLEDGE}}`
  line, banner, and checklist stay untouched (docs pins green unchanged).

## Non-goals

- No vector RAG / fine-tuning (the 46-item-corpus verdict stands — patterns + linters + oracle beat
  retrieval at this scale). No publish-/run-time validation mining (037's runnability family owns
  that). No gate promotion for the probe in v1. No Ask semantics change. No new linter script (the
  4-linter contract is pinned by tests and docs — D1 extends the first linter's internals).

## Acceptance criteria

1. *(D1)* Red fixture = today's incident file shape (`variable:` env-var) → `validate_workflow.py`
   exits non-zero and the message contains the `name:`-vs-`variable:` hint; green fixture = the
   one-key-fixed shape → exit 0. Same pair for `conversation_variables`. A `value:` key that is YAML
   null → red; `value: ''` → green (the exact `is None` mirror).
2. *(D1, no-FP sweep)* Every `templates/patterns/*.yml` and every existing `projects/**/workflows/*.yml`
   that linted clean before still lints clean (meta-workflow-builder's correct `name:` env vars are
   the natural green witness).
3. *(D2)* Fake-runner tests: static ④ with selfhost creds → `runImportProbe` called once, its note
   verbatim in `report.json.notes`; probe failure → note carries the (redacted) error and `ok` stays
   true (advisory), gate outcome unchanged; no creds → probe not called, `skipped` note absent or
   explicit per D2; live path → never called. Real-impl unit: the push→delete sequence fires in
   order with the probe app id (injected `runSyncPy` capture), and a failed push triggers NO delete.
4. *(D2, secrets)* A planted token in the probe's stderr/stdout never reaches report.json
   (`redactSecrets` — the 045 AC 3 pattern).
5. *(D3/D4)* HUONG_DAN row present; implement.md line present; docs-contract-pin +
   knowledge-inject byte-identity green with zero edits to those tests.
6. Full suites (server + pytest) green; LINTERS list byte-unchanged.

## Sequencing

- **S1** — D1 checks + red/green fixtures + pytest + AC 2 sweep.
- **S2** — D2 probe runner + threading + AC 3/4.
- **S3** — D3 HUONG_DAN + D4 snippet line + AC 5.

## Open questions

- **OQ1** — promote a probe FAILURE from advisory to a ④ gate flag once field data shows ~zero false
  positives (020: warn → measure → promote).
- **OQ2** — fold the `dify-import-gap-matrix` results (mining workflow) into D1b as concrete checks;
  r2 of this spec lists them with `vendor/dify-src` citations.
- **OQ3** — surface the probe note in the JA UI (i18n frame for `import-probe FAILED`, the 045
  NOTE_JA pattern) — bundle with OQ1's promotion or ship earlier if field users hit it often.

## Revision log

- r1 (2026-07-08) — initial draft, same day as the incident. Root cause empirically verified (API
  repro: 400 "missing name" → one-key fix → `status: completed`); Dify-source citation
  `api/factories/variable_factory.py`; incident YAML preserved as the S1 red fixture.
