# Phase ② (revise) — Draft a spec change for review

> Body of ONE bounded step. The human asked for a change and chose to **see the plan before it is
> built**. You edit a DRAFT of the spec, describe the change in a few lines, then
> **STOP — do not touch the workflow, and do not begin Phase ③.**

> 🌐 **LANGUAGE — obey before anything else.** Your ENTIRE reply, from the very first character, is
> written in **the chat language**: the language named by the directive at the very TOP of this prompt if
> one is there, otherwise the language of `{{REQUIREMENT}}`. Do **not** emit a single sentence in any
> other language — not even an orienting lead-in like "I'll start by…". There is NO English preamble;
> token one is already in the chat language.

## Inputs
- `{{SPEC_PATH}}` — **the draft you edit.** A copy of the current spec, already on disk.
- `{{CURRENT_SPEC}}` — the LIVE spec. **Read-only. Never write to this path.**
- `{{WORKFLOW_PATH}}` — the workflow the spec describes. Read it: a plan that ignores what is actually
  built is a plan for a different app.
- The change request itself is in this prompt, under the change-request heading.

## Why this file is separate from `SPEC.md`

The human is deciding whether to spend a build run on your understanding of their request. Until they
approve, the live spec must be **byte-identical** to what it was. That is why you were handed a copy:
so "nothing changed yet" is a fact about the filesystem, not a promise about your behaviour.

If you write to `{{CURRENT_SPEC}}` you break the one guarantee this whole step exists to provide.

## Do

1. **Read all three inputs.** `{{CURRENT_SPEC}}` for what is specified today, `{{WORKFLOW_PATH}}` for
   what is actually built, and the request for what should differ.

2. **Edit `{{SPEC_PATH}}` in place.** Same rules as a normal spec update:
   - **Describe the state after the change**, not the change itself. If the threshold becomes 0.2, the
     node table says 0.2 — you do not add a line saying it *changed from* 0.5.
   - **Hunt down what the change makes untrue** and correct it where it stands. A new decision written
     correctly while the sentence it contradicts is left in place is a broken spec, and it is the most
     common way specs break.
   - **Do not add a new section** for the change, and do not append an amendment or decision block. The
     change belongs in the section that already covers that topic.
   - Do **not** add a change-log row. That happens when the change is approved and actually built, not
     when it is proposed — a log of things that might happen is not a log.

3. **Say what changed, in 3–6 lines.** This is the load-bearing part of your reply: it is what the
   human reads before clicking, and for most of them it is the *only* thing they read.
   - One idea per line, one sentence each.
   - **Plain words, not file coordinates.** 「受信後にかな判定で日本語以外を除外」 — not
     「node 1787… の code を書き換え」.
   - Say the effect, not the edit: what the workflow will DO differently.
   - Fewer than 3 lines means the change is probably too small to be worth a review round — say so.
     More than 6 and nobody reads it; if the change genuinely needs more, that is itself worth saying.

4. **If the request goes beyond what this workflow is for, say so FIRST.** Adding a whole new
   responsibility (a new integration, a second output channel, work that belongs to a different app)
   is not a spec revision — it is a different workflow. Describe what you would have to change, and
   let the human decide.

5. **If the request needs nothing changed in the spec**, say that plainly and change nothing. A
   request that only affects how the YAML is written — formatting, node titles the spec never lists —
   has no place in a document about behaviour. A no-op is a correct outcome here.

## Do NOT

- Do not touch `{{WORKFLOW_PATH}}` or any file under `workflows/`. Building is Phase ③, and it only
  runs if the human approves.
- Do not touch `{{CURRENT_SPEC}}`.
- Do not run the linters. There is no YAML to lint.
- Do not promise anything about implementability you have not checked. If a change looks like it may
  not be expressible in Dify, say that you are unsure rather than implying it is settled.

## Output

`{{SPEC_PATH}}`, edited — plus your 3–6 lines in chat.

## Stop

Present the lines, then STOP. The human approves, asks you to redraft, or drops it.
