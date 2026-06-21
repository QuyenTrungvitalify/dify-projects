# T06 — SSE recovery / reconnect: reload mid-build restores phase/status/gate; parked builds persist

| Field | Value |
|---|---|
| **ID** | T06 |
| **Title** | SSE recovery / reconnect — reload mid-build restores phase/status/gate; parked builds persist |
| **Traces to** | AC#22 (SSE reconnect restores phase/status/gate; parked builds listed) |
| **Priority** | P0 |
| **Cost** | 0 build-turns when reusing a parked **BUILD‑A**; up to 1 short turn only if Step 2 has no live build to reload and you must start one. |

> Canonical strings & run guide: [00-README](00-README.md) (§4 String Dictionary is the single source of truth for every quoted string below).

---

## Preconditions

- App running and reachable at **http://127.0.0.1:4123** (host hardcoded to `127.0.0.1`; only the port is overridable). If the page does not load, **STOP and report** — do not proceed.
- A build is **parked at a gate** (`status: awaiting_confirm`). Per the build-reuse plan, **reuse BUILD‑A** parked at the **Analyze** gate (started by T02, parked for T03/T06/T07/T08/T09/T10). To confirm it is parked: the conversation shows the Analyze gate card with badge `Analyze complete` (title `Ready to write the spec`) and the buttons `Continue to Spec` · `Request changes` · `Discard build`.
  - If no parked build exists: start one from the empty composer with settings `Workflow: none (new)` · `Confirm: each step` · `Deploy: none`, requirement `R-fresh` (= `A workflow that takes a topic string as input and returns a one-paragraph summary of it.`), then **WAIT ≤300 s** (one real build-turn) for the Analyze gate card to appear. If the gate has not appeared after 300 s, **STOP and report** (do NOT click again — a 2nd click can 409 the turn-lock).
  - If neither a parked build exists nor can one be started (e.g. composer not interactive), **STOP and report**.
- Sidebar **"In progress"** section is visible and lists the parked build (this is the Lát‑6 / `GET /api/active` recovery surface). Note the build's name as shown in the sidebar so you can verify it after reload.

> Note on the connection dot: it is a 7px colored dot in the top-right (`var(--ok)` green when connected, faint grey when not). Its **`title` (hover tooltip) text** is the authoritative string — `Live` when connected, `Reconnecting…` when not (App.tsx:157). Read the dot's `title`/tooltip to assert; the green→grey→green color transition is the visual confirmation.

---

## Steps

### Step 1 — Reload while parked at a gate; the gate is restored (not lost)

1. **Observe:** the build is parked at the Analyze gate. Confirm visible: badge `Analyze complete`, title `Ready to write the spec`, summary `Requirement analyzed.` and `Continue to draft the spec, or request changes.`, and the three buttons `Continue to Spec` · `Request changes` · `Discard build`. Hover the top-right connection dot and confirm its tooltip reads `Live`. Record the current phase shown in the phase track (`Analyze` · `Spec` · `Implement` · `Test`).
2. **Act:** RELOAD the browser tab (full page reload). Do **NOT** click any gate button before, during, or after reload.
3. **Wait (≤30 s):** after reload, the SPA re-mounts and the SSE stream re-subscribes. Watch the connection dot: it first shows tooltip `Reconnecting…` (faint grey), then transitions to tooltip `Live` (green) once the stream is re-established. Poll up to 30 s for the dot tooltip to read `Live`.
4. **Assert:** after reconnect, the **SAME** phase/status/gate is restored (state re-fetched via `GET /api/tasks/:id`):
   - The Analyze gate card returns with the **same** badge `Analyze complete` and **same** title `Ready to write the spec`.
   - The **same** summary lines `Requirement analyzed.` and `Continue to draft the spec, or request changes.` are present.
   - The **same** buttons `Continue to Spec` · `Request changes` · `Discard build` are present and clickable.
   - The phase track still highlights the same phase recorded in step 1.1.
   - The gate is **NOT lost** — no error banner, no empty/blank conversation.

### Step 2 — Reload while a TURN is RUNNING; running state then gate restored

> This step spends part of one real build-turn (advancing the parked Analyze gate into the Spec turn). It is the intended, planned advance of BUILD‑A toward Spec — not wasted spend.

1. **Observe:** the Analyze gate card is present (from Step 1) with button `Continue to Spec`.
2. **Act:** click `Continue to Spec` **exactly once** so a Spec turn starts. Do **NOT** click it twice (a 2nd click can 409 the turn-lock).
3. **Wait (≤15 s):** poll the page until the running disclosure appears — the run disclosure shows `Running` (and the working detail `Working…`) and the gate buttons are gone. Confirm the connection dot tooltip is `Live`.
4. **Act:** while the turn is still `Running`, immediately RELOAD the browser tab.
5. **Wait (≤30 s):** the connection dot tooltip shows `Reconnecting…` then returns to `Live`.
6. **Assert (running restored):** after reconnect, the app restores the **running** state — the run disclosure again shows `Running` with `Working…`, and **no** gate buttons are present (the turn is still in flight). No error banner.
7. **Wait (≤300 s):** poll for the turn to settle. When it settles, the next gate card appears: the **Spec** gate with badge `Spec ready`, title `Spec drafted — review before I build`, summary `SPEC.md is editable in the panel — tweak it before implement (last-writer wins).`, and buttons `Implement this spec` · `Edit spec` · `Discard build`. If no gate (and no error banner) appears within 300 s, **STOP and report** (do NOT click anything).
8. **Assert (gate after settle):** the Spec gate is present exactly as above. (If instead the turn errored, you will see badge `Phase failed`; that is AC#19 territory — record it and proceed to Cleanup; reconnect itself still PASSES for this step because the running→terminal state was restored, not lost.)

### Step 3 — Parked builds persist in the sidebar after reload

1. **Observe:** before the most recent reload, note the build's name under the sidebar **`In progress`** section (header text exactly `In progress`). The parked build's row shows the status hint `gate` (the hint for `awaiting_confirm`).
2. **Act:** RELOAD the browser tab once more (do not click any gate).
3. **Wait (≤30 s):** connection dot tooltip `Reconnecting…` → `Live`. The sidebar re-fetches active builds (backed by `GET /api/active`).
4. **Assert:** the sidebar still shows the `In progress` section, and the **same** parked build row is still listed by the **same** name, with the same status hint (`gate` for a parked gate, or `running` if Step 2's turn is still in flight). The parked build is **NOT** dropped by the reload.

---

## Expected

Binding assertions (all must hold; strings exact, verbatim from [00-README](00-README.md) §4):

- **Connection dot:** tooltip `Reconnecting…` appears during reconnect and `Live` once re-established (App.tsx:157). The dot goes grey→green visually.
- **Step 1 (parked-gate restore):** after reload, the Analyze gate is re-rendered identically — badge `Analyze complete`, title `Ready to write the spec`, summaries `Requirement analyzed.` / `Continue to draft the spec, or request changes.`, buttons `Continue to Spec` · `Request changes` · `Discard build`. Same phase track highlight. No data lost.
- **Step 2 (running restore):** after reloading mid-turn, the run disclosure shows `Running` + `Working…` with no gate buttons, then on settle the **Spec** gate appears — badge `Spec ready`, title `Spec drafted — review before I build`, summary `SPEC.md is editable in the panel — tweak it before implement (last-writer wins).`, buttons `Implement this spec` · `Edit spec` · `Discard build`.
- **Step 3 (parked persists):** sidebar header `In progress` still present; the same build row still listed by the same name with status hint `gate` (or `running` if mid-turn).

---

## Negative / edge variants

- **Double quick reload:** while parked at the Analyze gate, RELOAD the tab **twice in quick succession** (reload, then reload again before the first fully settles).
  - **Wait (≤30 s):** dot tooltip → `Reconnecting…` → `Live`.
  - **Assert:** state is still fully restored — the Analyze gate card appears **exactly once** (no duplicate gate card, no duplicate run disclosure, no doubled summary lines). Buttons `Continue to Spec` · `Request changes` · `Discard build` appear once. No error banner.
- **Reload before first stream frame:** if the reload lands during the brief `Reconnecting…` window, the gate must still arrive once the stream connects — assert the dot reaches `Live` and the gate card is present (re-fetched via `GET /api/tasks/:id`), never a permanently blank conversation.

---

## Pass / Fail

**PASS** — all of the following are true:
- After every reload the connection dot tooltip reaches `Live` (within the stated timeout) having shown `Reconnecting…` first.
- Step 1: the parked Analyze gate is restored with the exact badge/title/summary/buttons listed in Expected; same phase highlight; nothing lost.
- Step 2: the running state (`Running` + `Working…`, no buttons) is restored after a mid-turn reload, and the Spec gate appears on settle with its exact strings (or an exact `Phase failed` error gate is restored — running→terminal state not lost).
- Step 3: the same parked build remains in the sidebar `In progress` section by the same name after reload.
- Negative: double quick reload yields exactly one gate card / one run disclosure (no duplicate disclosures).

**FAIL** — any of:
- After reload the conversation is blank / the gate card is missing / an error banner appears that was not present before reload.
- The restored badge/title/summary/button text differs **in any character** from the Expected strings (e.g. paraphrase, missing `…` ellipsis, wrong casing) — see [00-README](00-README.md) §4.
- The connection dot never returns to `Live` within 30 s.
- A reload drops the parked build from the sidebar `In progress` list.
- Double reload produces a duplicated gate card, duplicated run disclosure, or doubled summary lines.

**Evidence on FAIL:** capture a screenshot of the post-reload state (conversation + sidebar + connection dot tooltip). Quote the **exact text seen** versus the **exact expected** string from [00-README](00-README.md) §4 (badge / title / summary / button / `In progress` / dot tooltip). For the dot, record the observed `title` attribute value.

---

## Cleanup

- **Discard the build** only if T06 itself started a fresh build in Preconditions (i.e. BUILD‑A was not available to reuse): open the build, and at the current gate click `Discard build` (or use the sidebar hover-× with tooltip `Cancel this build`). Confirm the build leaves the `In progress` section. This leaves no parked turn holding context. (Cancel is non-destructive — `projects/` + `.runs/` stay on disk.)
- **If reusing BUILD‑A:** do **NOT** discard it — leave it for the downstream reuse chain (T07 artifacts, T09 patch, T08 discard variant, T10 done-composer). Note that Step 2 here advances BUILD‑A from the Analyze gate to the **Spec** gate; record the new parked phase (`Spec`) so the next test reuses the correct state. If the run is still in flight at end of test, wait for it to settle to a gate (≤300 s) before handing off so no turn-lock is left held.
- **No filesystem cleanup** is required from the browser. Any project scaffold / `.runs/` artifacts are server-side and are preserved on cancel by design.
- **Out of scope (NOT part of this browser test):** backend-restart recovery — a `running` build flipping to `status:error` with `interrupted by backend restart — phase re-runnable` while parked builds survive — is server-side and covered by **Recover‑CLI‑1** in the [00-README](00-README.md) §5 Appendix.
