# Spec 061 — Post-import checklist for tool workflows: tell the user, in plain language, what's left to do after importing

**Status**: **Implemented** (2026-07-16 — S1 shipped): the plain-language tool checklist is live in
`report.ts` (`hasToolNode`/`toolLabels`/`toolInstallNote` — jargon-free, wording-stable) + a NOTE_JA
frame in `i18n.ts`; it REPLACES the "add the plugin hash" jargon line for tool workflows. 5 new
node:test; typecheck clean. **Objectively verified against the spec-063 oracle**: the new checklist
PASSES `comprehension` (0 jargon) where the old note FAILED (4 jargon). A 5-agent impl-review folded 3
fixes: names EVERY tool (not just the first — multi-tool no longer dropped), per-tool-node label/key
scoping (not a whole-doc sweep), and `hasToolNode` tolerating a trailing comment. S2 (skill proposes
tools by default) remains optional/deferred. — r3, 2026-07-16 — **rescoped from L to S after a live reproduction**. r1/r2
assumed the Builder couldn't build tool nodes and designed a whole "install-or-alternative
conversation" + hash-injection stack. A live each_step run (task 1784174040711, "scrape a URL and
summarize") disproved that: the Builder builds a **valid, lint-clean tool node** when asked, with an
**honest `# TODO: hash`** (no fabrication), and Dify **accepts the import** (import-probe OK — not a
hard-fail). The ONLY thing the non-technical user actually hits is that the ④ report explains the
remaining work in **developer jargon** ("plugin hash / dependencies TODO / add before deploying")
instead of plain post-import steps. So this spec shrinks to that one fix. Claude authors; user
implements.
**Effort**: **S** (S1 report note ≈ S, S2 optional skill nudge ≈ S).
**Depends on**: spec 037 (`report.ts` note machinery + `hasUnresolvedPluginTodo`), spec 057
(`TRIGGER_ENTRY_NOTE` — the wording-stable + NOTE_JA-localized note pattern this copies), spec 049
(import-probe — the evidence Dify accepts the DSL).

## What the live reproduction actually found (the evidence base)

Driving the Builder as a real user (each_step, "WebページのURLを…スクレイピングして…要約する"):

| Question | Reproduced result |
|---|---|
| Does ① propose a tool by default? | **No** — it falls back to `http-request` + `code` (a secondary gap, see S2). |
| When the user asks for a tool, can it? | **Yes** — ① → `tool` node immediately. |
| Does it know the specific tool + identifier? | **Yes** — Jina Reader (`provider_id: jina`, `tool_name: jina_reader`, `provider_type: builtin`), sourced from a corpus example. |
| Does ③ build a valid tool node? | **Yes** — full `tool_configurations`/`tool_parameters`, **all 4 linters pass**. |
| Does it fabricate the plugin hash? | **No** — leaves `dependencies: []` + `# TODO: add jina tool plugin hash`, and notes "Jina needs an API key." |
| Does Dify reject the import? | **No** — `import-probe: OK — Dify accepted this DSL`. The plugin is needed at RUN time, not import time. |
| So what does the user actually hit? | The ④ report's note: *"…plugin hash (dependencies TODO). Advisory — does not block the build … add the plugin hash before deploying."* — **jargon a non-technical user can't act on.** |

**Conclusion:** the machinery is fine. The gap is one honest sentence of developer-speak where the
user needed a plain checklist. That is the whole spec.

## Goal

**G1 — "after I import it, I know exactly what's left before I can test."** For a workflow whose tool
node has an unresolved plugin, the ④ report replaces the jargon line with a plain-language,
tool-named **post-import checklist**: install the plugin, set up its credentials if it needs any,
then run — localized to Japanese, zero `provider_id`/`hash`/`dependencies` jargon.

**G2 (optional) — "I didn't have to know to ask for a tool."** The skill proposes a tool node by
default for scrape/search intents instead of the http+code workaround (the secondary gap the repro
found). Independent of G1; can ship later.

## Non-goals

- **NOT the install-or-alternative conversation** (r1/r2's S4) — the repro shows it's unneeded: Dify
  imports fine, and the ② Spec already surfaces the tool choice on its own.
- **NOT hash auto-injection for tools** (r1/r2's S3) — the honest `# TODO` + the post-import
  checklist is enough; the plugin is a one-time user install, not something to inject per build.
- **NOT blocking the build** — like every runnability note, it's advisory; the YAML is still produced.
- **NOT a new tool-knowledge doc or a `sync.py tools` probe** — the checklist names the tool from the
  node the Builder already wrote; a tiny curated "needs-API-key?" hint is all the extra knowledge
  needed.

## Design

### S1 — the plain-language post-import checklist note (S) ← the whole spec

In `report.ts`, when the workflow has a `tool` node with an unresolved plugin (reuse
`hasUnresolvedPluginTodo`; add a sibling that also confirms a `type: tool` node exists), push a
**dedicated note** built like `TRIGGER_ENTRY_NOTE` (spec 057): a wording-stable string in `report.ts`
+ a `NOTE_JA` frame in `i18n.ts` that translates the WHOLE message (not the jargon needs-join). It
REPLACES the current "plugin hash (dependencies TODO) … add the plugin hash before deploying" clause
for tool workflows.

The note names the tool(s) — read `tool_label`/`provider_name`/`tool_name` from the `tool` node the
Builder already wrote — and lists the steps:

> **This workflow uses the *Jina Reader* tool. After importing into Dify, finish these before you
> test:**
> 1. **Install the plugin** — Studio → Plugins → Marketplace → search "Jina" → Install.
> 2. **Set it up** — Jina Reader needs an API key; open the tool node and enter it.
> 3. **Run / Test** the workflow. *(The model is filled automatically at test — nothing to do there.)*

- Step 2 is conditional on a tiny curated **needs-credentials** hint (jina/tavily/… need a key;
  duckduckgo/webscraper/time do not). Unknown tool → a generic "if the tool needs an API key or
  login, set it up in the node." Never invent a specific credential requirement.
- Multiple tool nodes → one checklist per distinct tool.
- Wording-stable (a unit test pins the English + asserts the JA frame localizes the whole thing);
  **zero** `provider_id`/`hash`/`dependencies` tokens reach the user.
- The existing model/auto-inject line (043) and the trigger note (057) stay as-is and compose.

### S2 — (optional) nudge the skill to propose a tool by default (S)

`analyze.md`/`spec.md`: for a scrape / read-a-page / web-search intent, propose a `tool` node instead
of the `http-request`+`code` workaround the repro saw by default; name the tool in plain language and
add "tool" to the node vocabulary lists. This removes the need for the user to say "use a tool" — but
it's INDEPENDENT of G1 and can ship on its own timeline. (Translate stays a plain LLM node — no tool.)

### S3 — docs (XS)

A `docs/specs/README.md` row; one line in `docs/plugin-capabilities.md` for the tiny
needs-credentials hint list (extend the EXISTING doc, don't mint a new one). No hook count pins
touched.

## Acceptance criteria

1. **The checklist replaces the jargon (headline).** A tool workflow with an unresolved plugin →
   the ④ report note is the plain-language, tool-named post-import checklist (install → set up if
   keyed → run), with **zero** `provider_id`/`hash`/`dependencies` tokens. Reproduced against the
   repro build (task 1784174040711 shape). Unit test on the wording-stable string.
2. **It localizes whole.** The JA `NOTE_JA` frame translates the entire checklist (no literal
   English tool-field leak, unlike the current needs-join). Unit test on the frame.
3. **Credential step is honest.** A keyed tool (jina/tavily) → the "set up an API key" step appears;
   a keyless tool (duckduckgo) → it does not; an unknown tool → the generic "if it needs a key…"
   wording. Never a fabricated specific requirement. Unit-tested over the curated hint map.
4. **Advisory, not blocking.** The note never flips lint/verdict; the build still completes (same
   contract as every runnability note).
5. **(S2, if shipped)** A scrape/search prompt makes ① propose a `tool` node, not http+code —
   checkable via the e2e harness (`workflow.grep_present: ["type: tool"]`); translate → `type: llm`.
6. No regression: `pytest`, builder `npm test`, drift tests, `check_agents_refs` all green; the
   existing 037 model note + 057 trigger note still compose correctly.

## References

- Live reproduction: Builder run **1784174040711** (each_step) — valid Jina tool node, honest
  `# TODO` hash, import-probe OK, jargon report note. The evidence this whole rescope rests on.
- [037](037-builder-runnability-preflight-and-workspace-facts.md) — `report.ts` notes +
  `hasUnresolvedPluginTodo`; [057](057-trigger-entry-support.md) — `TRIGGER_ENTRY_NOTE` +
  `NOTE_JA` frame (the exact pattern S1 copies); [049](049-dify-import-blocker-defense.md) —
  import-probe (Dify accepts the DSL).
- `apps/builder/server/lib/report.ts` (note assembly), `apps/builder/web/src/lib/i18n.ts` (NOTE_JA
  frames), `apps/builder/server/lib/runnability.ts` (the current jargon needs-join this replaces for
  tool workflows).
