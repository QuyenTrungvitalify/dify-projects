/**
 * language.ts — the CHAT-language layer: which language the model answers the human in.
 *
 * A LEAF module on purpose: it imports nothing, so every layer (phases, orchestrator, ask, and
 * `state/task.ts` itself) can use it without an import cycle — `phases.ts` already imports
 * `state/task.ts`, so the pin could not live there once task creation needed to normalize the setting.
 *
 * The whole point of this file is ONE boundary: `chatLang` steers the CONVERSATION; the deliverable
 * keeps the requirement's language. See {@link languagePin}.
 */
/**
 * The CHAT language: what the model writes its conversational prose in. `auto` = infer from what the
 * user actually types (see {@link resolveLang}); `vi`/`ja` are the user's explicit setting, which always
 * beats inference. There is deliberately no `'en'`: with no signal the pin is '' and the English-authored
 * phase prompts already read as English.
 *
 * This governs the CONVERSATION only. Everything that ships inside the deliverable — node title/desc,
 * the LLM prompts in the workflow, notification bodies, sheet column names, the SPEC.md body — keeps the
 * REQUIREMENT's language, because that is the customer's language. A VN team building for a JP client
 * chats in Vietnamese and hands over Japanese; collapsing the two breaks the handover.
 */
export type ChatLang = 'auto' | 'vi' | 'ja';

/** Coerce any wire/disk value to a {@link ChatLang}; anything unrecognized (incl. undefined, an old
 *  task.json with no field) reads as 'auto' — the pre-existing behavior. */
export function normalizeChatLang(v: unknown): ChatLang {
  return v === 'vi' || v === 'ja' ? v : 'auto';
}

/**
 * Script-detect one piece of user text. '' when nothing distinctive is present.
 *
 * VIETNAMESE IS CHECKED FIRST, ON PURPOSE. Real Vietnamese messages here embed Japanese nouns mid
 * sentence ("phần 合流後 chính là phần 共通ワークフロー C…"), so a kana-first test misfires to Japanese on
 * text a human would call unmistakably Vietnamese. The reverse — a Japanese sentence carrying Vietnamese
 * diacritics — does not occur in this workspace. Diacritics are the signal: U+1EA0–U+1EF9 (a block
 * essentially only Vietnamese uses), the modified base letters ăâđêôơư, and the precomposed accented
 * vowels shared with other Latin languages. Unaccented Vietnamese ("lam giup t cai nay") is NOT
 * detectable and returns '' by design — the explicit setting is the way out.
 */
export function detectLang(text: string | null | undefined): 'vi' | 'ja' | '' {
  if (!text) return '';
  if (/[Ạ-ỹăâđêôơưĂÂĐÊÔƠƯàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵÀÁẢÃẠÈÉẺẼẸÌÍỈĨỊÒÓỎÕỌÙÚỦŨỤỲÝỶỸỴ]/.test(text)) return 'vi';
  // Hiragana (぀-ゟ) or Katakana (゠-ヿ) ⇒ Japanese (kana is unique to Japanese — no Chinese false-positive).
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'ja';
  return '';
}

/** Everything that can tell us what language to answer in, in priority order — see {@link resolveLang}. */
export interface LangInputs {
  /** The user's explicit setting, carried on the task ('auto' | 'vi' | 'ja'). */
  chatLang?: string | null;
  /** The text the user typed THIS turn (a /reply change request, an ask, a consult message). */
  latest?: string | null;
  /** `task.langHint` — the language of the most recent user message that carried a signal. */
  hint?: string | null;
  /** The original requirement (the first message). */
  requirement?: string | null;
}

/**
 * Resolve the chat language as a CHAIN — first signal wins. Each rung exists because dropping it
 * reintroduces a bug we have already seen:
 *
 *  1. explicit setting     — a VN message can embed kana, so inference alone misfires (that is the whole
 *                            reason the setting exists); the setting must therefore outrank it.
 *  2. this turn's text     — the original bug: a reply pinned off the REQUIREMENT answered a Vietnamese
 *                            message in Japanese for 12 turns straight because the requirement had
 *                            Japanese headings.
 *  3. the sticky hint      — a Continue past a gate is a FRESH turn carrying no user text at all. Without
 *                            this rung the same task answers VI on reply turns and JA on continue turns.
 *  4. the requirement      — back-compat: before this existed, EVERY turn pinned off the requirement. A
 *                            Japanese task whose user replies "OK" (or pastes a node id / an English
 *                            stack trace) must keep its Japanese pin, not fall back to no pin at all.
 *  5. nothing              — '' (the English-authored prompts read as English).
 */
export function resolveLang(o: LangInputs): 'vi' | 'ja' | '' {
  const set = normalizeChatLang(o.chatLang);
  if (set !== 'auto') return set;
  return detectLang(o.latest) || (o.hint === 'vi' || o.hint === 'ja' ? o.hint : '') || detectLang(o.requirement);
}

/**
 * A native-language directive that PINS the turn's chat language, prepended to the final prompt (fresh
 * AND /reply) at the orchestrator seam, and to every ask/consult prompt. Layer 1 of the reply-language
 * guard: an in-prompt English "## Output language" banner alone still let the model open with an English
 * orienting preamble ("The seed path is empty… Let me verify…"). A directive written IN the target
 * language anchors the model far harder — models mirror the language of their most prominent instruction
 * — so it stops the English lead-in at token one. Pure.
 *
 * The Japanese pin is kept BYTE-IDENTICAL to what shipped before the chat-language setting existed:
 * anyone who does not opt in must see exactly today's behavior. The Vietnamese pin carries one extra
 * clause the Japanese one has no use for — the chat/artifact boundary — because Vietnamese chat over a
 * Japanese requirement is precisely the case where the model would otherwise "helpfully" translate the
 * deliverable's strings too.
 */
export function languagePin(o: LangInputs): string {
  const lang = resolveLang(o);
  if (lang === 'ja') {
    return (
      '【最重要・言語】この応答は、最初の文字からすべて日本語で書いてください。' +
      '英語の前置き（例:「The seed path is empty…」「Let me…」「I\'ll start by…」）は一切禁止です。' +
      'まず日本語で考え、英語で書いてから訳すことは絶対にしないでください。' +
      'コード・ノードID・YAMLキー・{{#…#}}参照などの機械識別子のみ ASCII のまま残します。\n\n'
    );
  }
  if (lang === 'vi') {
    return (
      '【QUAN TRỌNG — NGÔN NGỮ】Trả lời toàn bộ bằng tiếng Việt ngay từ ký tự đầu tiên. ' +
      'Cấm mọi mở đầu tiếng Anh ("Let me…", "I\'ll start by…") hoặc tiếng Nhật. ' +
      'Không viết bằng ngôn ngữ khác rồi dịch. ' +
      'CHỈ giữ nguyên: định danh máy (code, node ID, YAML key, tham chiếu {{#…#}}) bằng ASCII, ' +
      'và các chuỗi sẽ nằm BÊN TRONG artifact bàn giao (title/desc của node, prompt LLM, ' +
      'message thông báo, tên cột sheet, thân SPEC.md) — những chuỗi đó theo ngôn ngữ của ' +
      'requirement, KHÔNG dịch sang tiếng Việt.\n\n'
    );
  }
  return '';
}
