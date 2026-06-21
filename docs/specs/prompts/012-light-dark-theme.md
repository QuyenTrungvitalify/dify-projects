# Implementation Prompt — Light/Dark theme toggle (builder app)

> Copy-paste vào fresh session. Builds on the merged 009/010/011 builder app. ~Half a day.
> Mục tiêu: thêm nút **bật/tắt Light ↔ Dark** ở góc phải `chat-top`, theo đúng `docs/design/design-v2`.

---

You are adding a **light theme** (with a toggle) to the Spec 009 Dify Workflow Builder web SPA
(`apps/builder/web`, Preact + Vite). The app is currently **dark-only**. The new design ships a full
dual-theme token set; your job is to port the *theme infrastructure* into the live app **without
regressing** any recent work (the spec-editor toolbar/preview/split, gate strips, `gs-link`, etc.).

## Repo & files

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects` (app lives in `apps/builder/`).
- **Design source of truth (READ FIRST — this is the spec):**
  - `docs/design/design-v2/Dify Workflow Builder.html` — the **pre-paint theme script** (`<head>`).
  - `docs/design/design-v2/components/surface-blocks.css` — dark `:root` tokens + the
    **`:root[data-theme="light"]`** block (~line 892). This light block is the deliverable's core data.
  - `docs/design/design-v2/components/app.jsx` (lines ~40–46, ~252–256) — the theme state + `toggleTheme`
    + the toggle button markup (a `ghost-pill` with `<I.sun/>`/`<I.moon/>`).
  - `docs/design/design-v2/components/icons.jsx` (lines ~39–40) — the `sun` + `moon` SVG glyphs.
- **Live files you will edit:**
  - `apps/builder/web/src/index.html` — add the pre-paint script.
  - `apps/builder/web/src/styles/surface-blocks.css` — add tokens + light block + tokenize hardcoded colors.
  - `apps/builder/web/src/components/Icon.tsx` — add `sun` + `moon`.
  - `apps/builder/web/src/components/App.tsx` — theme state + toggle button in `.chat-top-right`.

> **DO NOT** wholesale-copy `design-v2/.../surface-blocks.css` over the live CSS — the live file has
> diverged (recent spec-editor + `gs-link` work the design file doesn't have). Port only the theme bits.

## Why this works (the design)

The whole UI already paints from CSS variables. Swapping the **values** of those variables under a
`:root[data-theme="light"]` selector restyles everything for free — *as long as no component rule
hardcodes a color*. So the work is: (1) define the light values, (2) ensure every theme-relevant color
in component rules reads a token. Geometry/type/radii are theme-independent and stay shared.

---

## Step 1 — Pre-paint theme script (no flash)

In `apps/builder/web/src/index.html`, add this **inside `<head>`, before any stylesheet/module** (copy
the logic from `design-v2/Dify Workflow Builder.html`). It must run before first paint so the correct
theme is set on `<html data-theme>` before CSS applies:

```html
<script>
  /* Set theme BEFORE first paint to avoid a flash of the wrong theme.
     Priority: saved choice (localStorage) → system preference → dark default. */
  (function () {
    try {
      var saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") {
        document.documentElement.dataset.theme = saved;
      } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
        document.documentElement.dataset.theme = "light";
      } else {
        document.documentElement.dataset.theme = "dark";
      }
    } catch (e) {
      document.documentElement.dataset.theme = "dark";
    }
  })();
</script>
```

## Step 2 — CSS tokens (`surface-blocks.css`)

### 2a. Add the tokens the live dark `:root` is missing

The live `:root` lacks tokens the light block (and tokenization in 2c) will reference. Add these to the
existing dark `:root` (values from `design-v2`'s dark `:root`; `--bg-chip` already exists — don't dupe):

```css
  /* text sitting ON accent / danger fills */
  --on-accent: #15140f;
  --on-danger: #faf2ee;
  /* elevated modal surfaces */
  --bg-modal:       #1c1b18;
  --bg-modal-hover: #2e2b27;
  /* raised translucent tints (light overlays on dark) */
  --tint-1: rgba(255, 255, 255, 0.008);
  --tint-2: rgba(255, 255, 255, 0.012);
  --tint-3: rgba(255, 255, 255, 0.015);
  --scroll-thumb:       rgba(255, 255, 255, 0.07);
  --scroll-thumb-hover: rgba(255, 255, 255, 0.13);
  /* scrim behind modals */
  --scrim:  rgba(8, 7, 6, 0.6);
  --code-num: oklch(0.74 0.066 150);
```

Optionally add `color-scheme: dark;` to the dark `:root` so native controls (caret, default scrollbars)
match.

### 2b. Add the light theme block

Paste the **entire `:root[data-theme="light"]{ … }`** block from
`design-v2/components/surface-blocks.css` (~line 892) into the live CSS, immediately after the dark
`:root{…}` block. It redefines every color token (surfaces, borders, warm-gray text, lower-L accent,
semantics, mono chip, diff, on-accent/on-danger, modal, inverted tints, scrim, light shadows).
Optionally append `color-scheme: light;` inside it.

### 2c. Tokenize the hardcoded colors in component rules

These rules hardcode dark colors and will **not** swap. Replace each with the token (search-and-replace
across the file — there are a few duplicates):

| Find (hardcoded) | Replace with | Where it appears |
|---|---|---|
| `rgba(255,255,255,0.07)` (scrollbar thumb) | `var(--scroll-thumb)` | `*::-webkit-scrollbar-thumb` |
| `rgba(255,255,255,0.13)` (scrollbar hover) | `var(--scroll-thumb-hover)` | `…-thumb:hover` |
| `rgba(255,255,255,0.008)` | `var(--tint-1)` | `.gate-foot` |
| `rgba(255,255,255,0.012)` | `var(--tint-2)` | `.disc-detail`, `.diff-line.empty`, modal-list gradient |
| `rgba(255,255,255,0.015)` | `var(--tint-3)` | `.composer:focus-within` box-shadow |
| `#15140f` | `var(--on-accent)` | `.phase-step.active .phase-num`, `.composer-send.ready` |
| `#14130f` | `var(--on-accent)` | `.btn.primary` |
| `#faf2ee` | `var(--on-danger)` | `.btn.danger` |
| `rgba(8, 7, 6, 0.6)` | `var(--scrim)` | `.modal-overlay` |
| `#1c1b18` | `var(--bg-modal)` | modal surface(s) (~2 spots) |

> After 2c, grep for leftover hardcoded colors **outside** the two `:root` blocks and confirm none
> remain that should theme-swap:
> `awk 'NR>FIRST_COMPONENT_LINE' surface-blocks.css | grep -nE '#[0-9a-fA-F]{3,6}|rgba\([0-9]' | grep -v 'var(--'`
> (a stray `transparent`/`currentColor` is fine; a literal hex/white-rgba is a miss).

> **Note (no action needed):** the recent spec-editor additions (`.spec-tab`, `.spec-toolbar`, `.stb*`,
> `.spec-mode`, `.spec-preview`, `.spec-split`) and the `gs-link` pill already use tokens — they swap for
> free. Just **verify them visually** in light mode (Step 5).

## Step 3 — Icons (`Icon.tsx`)

Add `sun` + `moon` to the `I` glyph map (same `Svg` wrapper, paths from `design-v2/components/icons.jsx`):

```tsx
  sun:  (p) => <Svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4l1.4-1.4M17 7l1.4-1.4"/></Svg>,
  moon: (p) => <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/></Svg>,
```

## Step 4 — Toggle button + state (`App.tsx`)

This is **Preact**, not React — import hooks from `preact/hooks` (`useState`, `useEffect`); do not copy
the design's `React.use`/`use` alias. Add near the top of the root component:

```tsx
// theme: initial value already set on <html> pre-mount by the index.html script.
const [theme, setTheme] = useState<'light' | 'dark'>(
  () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
);
useEffect(() => {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
}, [theme]);
const toggleTheme = (): void => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
```

Then add the button as the **first** child of `.chat-top-right` (so it sits at the right edge of
`chat-top`). Keep it **always visible** — do NOT gate it on `view === 'conversation'`; the toggle should
work in the empty/new-task view too:

```tsx
<button className="ghost-pill" onClick={toggleTheme}
  title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
  aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}>
  {theme === 'light' ? <I.sun /> : <I.moon />}
</button>
```

`.ghost-pill` already exists in the live CSS, so no new button styling is needed.

---

## Acceptance criteria

1. A sun/moon `ghost-pill` button shows at the right of `chat-top`, in **both** the empty and
   conversation views.
2. Clicking it flips light ↔ dark and the **entire** UI restyles — sidebar, chat, composer, gates, gate
   strips, artifact panel (spec editor + toolbar + preview + split), diff, modal, lint rows, scrollbars —
   with **no** dark-only remnants in light mode.
3. The choice **persists** across reload (`localStorage['theme']`).
4. First load with no saved choice follows the **OS** preference, and there is **no flash** of the wrong
   theme on load (pre-paint script working).
5. The icon reflects current state (moon while dark, sun while light) with matching `title`/`aria-label`.
6. Web build + tests green: `cd apps/builder/web && npm run build && npm test`.
7. Contrast sanity in light mode: body text, muted text, mono identifier chips, accent links, and
   on-accent button labels are all legible (no light-on-light).

## Verify

```bash
cd apps/builder/web
npm run build && npm test            # tsc + vite build + vitest must pass
npm run dev                          # then in the browser:
#  • toggle dark↔light; confirm every surface swaps
#  • reload → theme persists
#  • clear localStorage 'theme' + set OS to light → loads light, no flash
#  • open the Artifact panel → Spec tab: check Edit / Preview / Split + the B/I/S toolbar in light
#  • open the create-project modal + a diff → check modal scrim + diff add/del colors in light
```

## Gotchas

- **Don't** wholesale-replace the live CSS with the design-v2 file (it predates recent spec-editor work).
- The accent is `oklch(...)`; the light block intentionally **lowers L** for contrast on the off-white
  canvas — keep the design-v2 light values, don't reuse the dark accent.
- `--bg-chip` already exists in the live dark `:root` — don't duplicate it.
- If any third-party/native control still looks dark in light mode, add `color-scheme: light;` to the
  light block (and `dark` to the dark `:root`).
- Theme state is pure UI — keep it local to the root component (do **not** thread it through `store.ts`
  or the server). Persistence is `localStorage` only.

## Out of scope

- A third "system/auto" follow-OS-live mode (v1 is a binary toggle; OS pref only seeds the first load).
- Per-component theme overrides or a theme settings panel.
- Any server/`store.ts` change.
