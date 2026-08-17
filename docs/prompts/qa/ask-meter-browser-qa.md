# Browser QA — the ask meter, the answer that survives, and the export ledger

Paste everything under **THE PROMPT** into Claude in Chrome. It drives the real UI, so it verifies the
half that unit tests cannot: what a person actually sees.

## Before you start

1. Start the builder in dev mode (the meter only renders under `?dev=1`):

   ```bash
   cd apps/builder && BUILDER_DEV=1 BUILDER_PORT=4180 npx tsx server/index.ts
   ```

2. Open the builder with `?dev=1` once, in the Chrome the extension drives — **use whatever port yours
   actually runs on** (the first QA run found it on `127.0.0.1:4123`, not the 4180 above; tell the agent
   the real URL).
3. Have ONE finished build available (a task at ④ or `done`). T5–T7 need it.
4. **Prefer a build you created recently.** An old, heavily-asked build carries a large session history,
   and its first question of the day pays to re-cache all of it — real, but it swamps the numbers this
   script is reading. The first QA run hit exactly that: an $8.86 one-line question.

**Cost**: the script sends **7 real questions**. On a small workflow that is roughly $0.5–1.5 of your
own quota. Keep the questions as short as written — the point is the plumbing, not the answers.

**What this canNOT check, by construction** (do not let the agent claim otherwise): whether older
attachments lost their "read them" invitation, and what the seed contains. Those live in the prompt sent
to the model, which never reaches the browser. The export ledger in T8 is the closest observable proxy;
the rest is covered by the server test suite.

---

## THE PROMPT

> You are testing a local web app at `http://localhost:<PORT>/?dev=1` (ask for the real port if it is
> not given — it is not always 4180). Work through the cases below **in
> order**. This is a real app spending real money, so send exactly the questions written — no extras, no
> retries unless a case says to.
>
> **Report honestly. A case you could not run is `SKIPPED` with the reason; a case that failed is `FAIL`
> with what you actually saw. Never write PASS for something you did not observe.** Quote real strings
> from the page rather than describing them.
>
> Some answers take up to a minute. Wait for the bubble's header to stop showing a spinner before judging
> — when it is done the header reads `Answered` / `回答済み`. The whole UI may be in Japanese, sidebar
> sections included: *Chat*/`チャット`, *Distill*/`蒸留`, *Build*/`ビルド`.
>
> ---
>
> **T1 — the cost meter appears under an answer**
> Open a finished build (sidebar → a task under *Build* that shows ④ or done). In the composer, send:
> `Workflow này có mấy node?`
> When the answer settles, look directly beneath it for a small grey monospace line.
> PASS if it exists and has this shape: `<model> · in <n> · cache <n> read (<n>%) · <n> written · out <n> · <n> turn(s) · <n>s · $<n>`.
> Quote the line verbatim. FAIL if there is no such line, or if any field reads `—` or `NaN`.
>
> **T2 — the model shown is the model that answered** (the bug this was built to catch)
> Start a NEW chat (the *Chat* / `チャット` section → new). Read the model chip under the input; if it
> says **Haiku**, switch it to **Opus** first — a Haiku chip cannot disagree with a Haiku housekeeping
> model, so the case would prove nothing. Write down what the chip says. Send exactly: `hello`
> When the answer settles, read the meter line's first field.
> PASS if the model in the meter matches the family on the chip (chip `Opus` → meter starts `opus-…`).
> **FAIL if they disagree** — quote both. This is the first turn of a session, where a second model does
> the app's housekeeping, and the meter must still name the one that wrote the answer.
>
> **T3 — the meter survives a reload, in a chat**
> Stay on that chat. Hard-reload the page (Cmd/Ctrl+Shift+R). Wait for the conversation to come back.
> PASS if the same answer is there AND its meter line is still underneath, with the same numbers.
> FAIL if the answer returns without the meter. Quote the line before and after.
>
> **T4 — the meter survives leaving and returning, in a build**
> Go back to the build from T1. Click away to a different task in the sidebar, then click back.
> PASS if the T1 answer and its meter are both still there.
>
> **T5 — an answer that finishes while you are elsewhere is not lost**
> On the build, send: `Node đầu tiên tên gì?`
> **Immediately** (do not wait for the answer) click a different task in the sidebar. Wait ~60 seconds.
> Click back to the build.
> PASS if the answer is present and has text in it.
> FAIL if you find an empty answer bubble marked as answered/回答済み — that is the exact defect this
> was built to fix. Say which you saw.
>
> **T6 — code blocks can be copied**
> On the build, send: `Viết cho tôi một đoạn code python in ra 1 đến 5.`
> When the answer settles, find the fenced code block and its **Copy** button (top-right of the block).
> Click it. PASS if a confirmation appears (a tick) AND the clipboard holds exactly the code on screen —
> read it back with `navigator.clipboard.readText()`, not a synthetic Ctrl+V, which most automation
> harnesses cannot deliver. Say which method you used. Clear the composer afterwards WITHOUT sending.
> If the clipboard is blocked in your environment, that is `SKIPPED` with the reason — not a FAIL.
>
> **T7 — a settings menu never opens where it cannot be seen**
> Go to the new-build surface (the button that starts a new build). Type a LONG requirement into the
> input — paste any paragraph 20+ lines tall, so the area scrolls. Scroll down so the model chip sits
> near the top edge of its scrolling area. Click the chip.
> PASS if the whole menu is visible and every option is reachable (scroll inside the menu if needed).
> FAIL if the menu is clipped or opens off-screen. Do not send this build — clear the input afterwards.
>
> **T8 — the export carries the evidence**
> Back on the build, click **Export** in the top bar, then **Download zip** (`zipをダウンロード` if the
> UI is in Japanese) — it is a menu, not a single button. Let the zip download, then list the files
> inside it.
> PASS if it contains BOTH `ask-ledger.md` and `chat.jsonl`.
> Then open `ask-ledger.md` and paste its FULL contents into your report — the table and the
> "Reading this" section. Do not summarise it; the numbers are the point.
>
> ---
>
> **Report format** — one block, nothing else:
>
> ```
> T1 <PASS|FAIL|SKIPPED> — <the meter line you saw, verbatim>
> T2 <PASS|FAIL|SKIPPED> — chip said <x>, meter said <y>
> T3 <PASS|FAIL|SKIPPED> — before: <line> / after reload: <line>
> T4 <PASS|FAIL|SKIPPED> — <what you saw>
> T5 <PASS|FAIL|SKIPPED> — <answer present with text? or empty bubble?>
> T6 <PASS|FAIL|SKIPPED> — <tick appeared? pasted text matched?>
> T7 <PASS|FAIL|SKIPPED> — <menu fully visible? clipped?>
> T8 <PASS|FAIL|SKIPPED> — files: <list> ; ledger:
> <paste ask-ledger.md here>
>
> ANYTHING ELSE I NOTICED: <free text — layout, wording, anything that looked wrong>
> ANYTHING I COULD NOT CHECK: <free text>
> ```

---

## After the run

Send back the report block **and** the exported zip (or just `ask-ledger.md`). The ledger is what says
whether the seed optimisation is still holding in your real use: prompt size per question, how much came
from cache, and whether the cost curve is flat or climbing.
