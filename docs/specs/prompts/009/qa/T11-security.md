# T11 — Security: cross-origin POST/PATCH/PUT → 403; server bound to 127.0.0.1 only

> Canonical run guide + String Dictionary: [00-README](00-README.md). All quoted strings below are verbatim from that dictionary / app source — assert them character-for-character.

> ⚠️ **RUNNER — read first: this is a TERMINAL/CLI test, NOT a Chrome-browser-agent test.**
> Do **not** hand this file to the Claude Chrome extension. A browser **cannot forge the `Origin` header** from an in-page `fetch()` (it silently sends a same-origin request — empirically confirmed), so the cross-origin 403 checks (Steps 1–2), the LAN-binding half of Step 4, and the cross-origin GET negative are **impossible from the browser**. Run the `curl`/`ipconfig` commands in a **real shell** — a human operator, or any shell-capable runner. If you only have a browser, the most you can confirm is the same-origin/read-path subset (Step 3, loopback Step 4a, same-origin GET); everything else is **inconclusive, not pass**.

| Field | Value |
|---|---|
| **ID** | T11 |
| **Title** | Security: cross-origin POST/PATCH/PUT → 403; server bound to 127.0.0.1 only |
| **Traces to** | AC#23 (cross-origin 403 + 127.0.0.1 binding). The confinement-revert (Sec‑CLI‑2), token-isolation (Sec‑CLI‑3), and permission-mode non-hang (Sec‑CLI‑1) clauses of AC#23/#10 are **CLI/server-side**, referenced in the [Appendix cross-links](#appendix-cli-cross-links-not-browser-testable) — not browser-testable. |
| **Priority** | P0 |
| **Cost** | **0 build-turns** (curl-driven; no Analyze/Spec/Implement turn is ever started — every check is read-only or a rejected request that never reaches the task machine). |

---

## Preconditions

- App running and reachable on the loopback origin **http://127.0.0.1:4123** (host hardcoded to `127.0.0.1`; only the *port* is overridable via `BUILDER_PORT`). Source: [00-README §1.1](00-README.md#11-preconditions-human-one-time) / `apps/builder/server/index.ts:82–84,283`.
- **A real terminal/shell is available to the runner** (human operator or shell-capable agent) to run `curl` and `ipconfig`/`ip`. **Why terminal, not in-page fetch:** browsers forbid scripts from freely setting the `Origin` header, so a cross-origin `Origin` cannot be forged from an in-page `fetch()` — the browser silently downgrades it to a same-origin request. These checks must run as **terminal/CLI commands** that read back the HTTP status and body. The Chrome browser agent **cannot** run this test (see the RUNNER banner above).
- No build needs to exist. The task ids `123` used below are intentionally **non-existent** — the origin gate is a Fastify `onRequest` hook that runs **before** any task lookup (`apps/builder/server/index.ts:215–220`), so a 403 is returned regardless of whether the task exists.

If the app is not reachable on http://127.0.0.1:4123 (step 4's loopback `/health` is not `200`), **STOP and report** — do not proceed; the rest of the asserts would be meaningless.

---

## Steps

Each step is **observe → act → wait(≤timeout) → assert**. `curl` returns synchronously; the per-command wait timeout is **≤10 s** (no build turn is involved — if a command hangs beyond 10 s, treat it as a network/route failure and STOP+report). Run commands literally; do not add or strip headers.

### Step 1 — CROSS-ORIGIN POST → 403 + exact body

- **observe:** terminal ready; app is up.
- **act (status):** run
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:4123/api/tasks \
    -H "Origin: http://evil.example" -H "Content-Type: application/json" -d '{"requirement":"x"}'
  ```
- **wait (≤10 s):** command returns a single line.
- **assert:** the printed status is exactly `403`.
- **act (body):** run
  ```bash
  curl -s -X POST http://127.0.0.1:4123/api/tasks \
    -H "Origin: http://evil.example" -H "Content-Type: application/json" -d '{"requirement":"x"}'
  ```
- **wait (≤10 s):** command returns a JSON line.
- **assert:** the body is exactly `{"error":"origin not allowed"}` (the dictionary string `origin not allowed`, 403 — [00-README §4.8](00-README.md#48-backend-messages-status-banners--4xx-bodies--tasksts-uits-indexts) / `index.ts:217–218`). The cross-origin POST was rejected by the `onRequest` hook **before** any turn could start — so this spends **0** model turns.

### Step 2 — CROSS-ORIGIN PATCH and PUT → 403 (before any task lookup)

- **observe:** still on the terminal.
- **act (PATCH status):** run
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://127.0.0.1:4123/api/tasks/123 \
    -H "Origin: http://evil.example" -H "Content-Type: application/json" -d '{"confirm_mode":"auto"}'
  ```
- **wait (≤10 s):** single line returned.
- **assert:** status is exactly `403`.
- **act (PATCH body):** run the same `PATCH` without `-o /dev/null -w` (i.e. `curl -s -X PATCH … -d '{"confirm_mode":"auto"}'`).
- **assert:** body is exactly `{"error":"origin not allowed"}`. Note: this is the *origin* error, **not** `confirm_mode is required` and **not** any task-not-found error — proving the origin check runs first, before task `123` is ever looked up.
- **act (PUT status):** run
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://127.0.0.1:4123/api/tasks/123/spec \
    -H "Origin: http://evil.example" -H "Content-Type: text/plain" --data-binary 'pwned'
  ```
- **wait (≤10 s):** single line returned.
- **assert:** status is exactly `403`.
- **act (PUT body):** run the same `PUT` without `-o /dev/null -w`.
- **assert:** body is exactly `{"error":"origin not allowed"}` (the gate covers `POST`/`PUT`/`DELETE`/`PATCH`; `index.ts:216`).

### Step 3 — SAME-ORIGIN allowed (origin passes; reaches validation)

- **observe:** terminal.
- **act:** repeat the POST but with the loopback origin:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:4123/api/tasks \
    -H "Origin: http://127.0.0.1:4123" -H "Content-Type: application/json" -d '{}'
  ```
- **wait (≤10 s):** single line returned.
- **assert:** the status is **NOT** `403`. With the empty body `{}` (no `requirement`) it is `400` and the body is the dictionary string `requirement is required` (400, [00-README §4.8](00-README.md#48-backend-messages-status-banners--4xx-bodies--tasksts-uits-indexts) / `tasks.ts:99`). Confirm the body:
  ```bash
  curl -s -X POST http://127.0.0.1:4123/api/tasks \
    -H "Origin: http://127.0.0.1:4123" -H "Content-Type: application/json" -d '{}'
  ```
  → expect exactly `{"error":"requirement is required"}`. Any non-403 status (400 here, or 200/201 if a valid body were sent) proves the same-origin request **passed** the gate. The empty body means **no build turn starts** — cost stays 0.
- **assert (no turn started):** because the body was rejected at validation, no Analyze turn was spawned. (Optional sanity: `curl -s http://127.0.0.1:4123/api/active` should NOT now list a brand-new running task created by this step.)

### Step 4 — 127.0.0.1-ONLY BINDING (loopback up, LAN refused)

- **observe:** terminal.
- **act (loopback health):** run
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4123/health
  ```
- **wait (≤10 s):** single line.
- **assert:** status is exactly `200` (server is up and bootstrapped on loopback). *(If the repo bootstrap is missing the body would be `503`; that is App‑CLI‑1's concern, not this test — but the connection itself must succeed on 127.0.0.1.)*
- **act (find LAN IP):** on macOS run `ipconfig getifaddr en0` (try `en1` if `en0` is empty); on Linux run `ip -4 addr show | grep -oE 'inet 192\.168\.[0-9.]+' | head -1`. Capture the LAN IP as `<LAN-IP>` (a `192.168.*` / `10.*` / `172.16–31.*` address — **not** `127.0.0.1`).
  - If the machine genuinely has **no** non-loopback IPv4 (e.g. offline), the binding assertion cannot be exercised; record that and treat this sub-check as **N/A (skipped)**, not a pass or fail.
- **act (LAN health):** run
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" --connect-timeout 5 http://<LAN-IP>:4123/health
  ```
- **wait (≤10 s):** command returns (connection refused returns fast; a black-holed route returns near the 5 s connect-timeout).
- **assert:** the request **fails to connect** — `curl` exits non-zero with `Connection refused` / `Couldn't connect to server` / `Connection timed out` (printed status will be `000` because no HTTP response is received). The server is bound to `127.0.0.1` only (`index.ts:82` `HOST = '127.0.0.1'`, hardcoded — **never** `0.0.0.0`, **not** env-overridable), so it is unreachable on the LAN IP. A `200` (or any HTTP status) from `<LAN-IP>:4123/health` is a **FAIL** (the server is wrongly bound LAN-wide).

### Step 5 — CLI cross-links (server-side; reference only)

- **observe:** no terminal action — these are documented in the [Appendix](#appendix-cli-cross-links-not-browser-testable) below.
- **assert:** the three server-side security clauses are acknowledged as **not browser/terminal-testable here** and are owned by their named CLI checks (Sec‑CLI‑1/2/3). No browser or curl assertion is made for them in this file.

---

## Expected

The binding assertions (all exact):

1. `POST /api/tasks` with `Origin: http://evil.example` → HTTP **403**, body exactly `{"error":"origin not allowed"}`.
2. `PATCH /api/tasks/123` with `Origin: http://evil.example` → HTTP **403**, body exactly `{"error":"origin not allowed"}` (origin check precedes task lookup — not `confirm_mode is required`, not task-not-found).
3. `PUT /api/tasks/123/spec` with `Origin: http://evil.example` → HTTP **403**, body exactly `{"error":"origin not allowed"}`.
4. `POST /api/tasks` with `Origin: http://127.0.0.1:4123` and `{}` → **NOT 403** (it is **400** with body exactly `{"error":"requirement is required"}`); origin passed.
5. `GET /health` on `http://127.0.0.1:4123` → **200**.
6. `GET /health` on `http://<LAN-IP>:4123` → **no connection** (curl non-zero exit; `Connection refused` / timeout; status `000`). Server bound to `127.0.0.1` only.
7. **Negative/edge:** `GET /api/active` with a cross-origin `Origin` → **NOT 403** (reads are intentionally ungated).

Zero build-turns spent across the whole test.

---

## Negative / edge variants

- **Read endpoint is intentionally open (no origin gate).** A `GET` is not a mutating method, so the `onRequest` gate (`index.ts:216`, `POST||PUT||DELETE||PATCH`) skips it — reads are the dumb-renderer surface and carry no CSRF risk.
  - **act:**
    ```bash
    curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4123/api/active -H "Origin: http://evil.example"
    ```
  - **wait (≤10 s):** single line.
  - **assert:** status is **NOT** `403` (expect `200`; the cross-origin `Origin` on a GET is ignored). A `403` here would be a regression (over-gating reads).
- **Undefined Origin (curl with no `-H Origin`) is allowed by design.** Re-running step 3's POST with **no** `Origin` header must also be NOT 403 (it will be `400 requirement is required` for `{}`), because `isOriginAllowed(undefined)` returns true for curl/same-origin EventSource (`plugins/sse-origin-check.ts:28`). This is expected, not a hole — the threat model is a *malicious browser page on another origin*, which cannot suppress its `Origin`.
- **`localhost` alias is also allowed.** `Origin: http://localhost:4123` is in the allowlist (`sse-origin-check.ts:21–22`); a POST with it → NOT 403. (Optional; assert only if exercised.)
- **DELETE is gated too.** If exercised, `DELETE` with `Origin: http://evil.example` → 403 `{"error":"origin not allowed"}` (the gate includes `DELETE`).

---

## Pass / Fail

**PASS** — binary, all must hold:
- Cross-origin `POST /api/tasks`, `PATCH /api/tasks/123`, `PUT /api/tasks/123/spec` each return **403** with body **exactly** `{"error":"origin not allowed"}`.
- Same-origin `POST /api/tasks` `{}` returns **NOT 403** (specifically **400** `{"error":"requirement is required"}`).
- Loopback `GET /health` returns **200**; LAN-IP `GET /health` **fails to connect** (or the LAN sub-check is recorded N/A only if no non-loopback IPv4 exists).
- Cross-origin `GET /api/active` returns **NOT 403** (read endpoint ungated).
- No build-turn was started (cost 0).

**FAIL** — any of:
- Any cross-origin mutating request returns a status other than 403, or a body other than `{"error":"origin not allowed"}`.
- The same-origin POST returns 403 (gate wrongly blocks the app's own origin).
- LAN-IP `/health` returns **any** HTTP status (server bound LAN-wide / `0.0.0.0`).
- Cross-origin `GET /api/active` returns 403 (reads wrongly gated).

**Evidence on FAIL:** capture the terminal output (the full `curl -i` headers + body if needed) and **quote the exact status and body seen vs expected**, e.g. *"seen `{"error":"task not found"}` status 404; expected `{"error":"origin not allowed"}` status 403"* — and note the exact command run. For the binding failure, paste the `<LAN-IP>` used and the `curl` exit + status.

---

## Cleanup

- **None.** No build was started; no task, project (`projects/`), or run (`.runs/`) artifact was created. The cross-origin requests were rejected at the origin gate; the same-origin request failed validation (`{}` → `requirement is required`) before spawning a turn. There is no parked turn, no turn-lock to release, and no filesystem state to revert.

---

## Appendix: CLI cross-links (NOT browser-testable here)

These AC#23/#10 clauses are server-side and are owned by named CLI/manual checks in [00-README §5 Appendix](00-README.md#appendix-not-browser-testable) — referenced for traceability only; **no** browser or curl assertion is made for them in this file:

- **Sec‑CLI‑1** — no turn hangs on a permission prompt (`claude` spawned `--permission-mode acceptEdits --setting-sources local`; turn exits 0 without prompting). AC#10.
- **Sec‑CLI‑2** — confinement-revert of an out-of-scope write **including opaque Bash** (e.g. `python -c "open('tools/x','w')"`); after the turn `git status` shows no `tools/x` and the task → `status:error` with `confinement breach (reverted): tools/x`. AC#23.
- **Sec‑CLI‑3** — the Dify token is **never** in a turn / SSE / `.runs` JSON (`grep -rs SENTINEL apps/builder/.runs/` → zero hits; `/stream` redacted). AC#23.
