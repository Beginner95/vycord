# Design system — rules for UI work

The binding rules for anything visual under `client/`. Verification (gates,
harness, evidence rules) is in [`verification.md`](verification.md). History —
why each rule exists, with measurements — lives in
`docs/superpowers/plans/2026-08-30-redesign-m6-closeout.md` and the M0–M6 plans;
this file states only the rules themselves.

## Order of work for a new component

1. Pick tokens **by role, not by eye** — see the token map below. No raw
   colours outside `tokens.css`, no 12px radius, no `z-index` literals.
2. Name classes `component-thing`; state is `is-*` / `has-*`.
3. Reuse the primitives (`btn`, `input`, `modal`, `kbd`, `mention`, toggles,
   sliders, menus) before writing a control.
4. If it floats above the page, follow the overlay contract below — never roll
   your own backdrop or Escape listener.
5. Motion through `--transition` / `--ease-out`; honour `prefers-reduced-motion`
   by dropping loops and keeping fades.
6. Every user-visible string translated, ru + en, in the same commit.
7. Ship green (see `verification.md`) — then **click through what you built, in
   both themes, at a narrow width**. The gates only verify what they were
   pointed at; the last milestone's six real defects were all found by a person
   clicking, none by an instrument.

## Tokens

`src/styles/tokens.css` is the **only** file that may contain a raw colour
value. It has exactly two blocks: `:root` (canonical light theme) and
`[data-theme="dark"]` (dark overrides). There is deliberately no alias/compat
layer — **never re-introduce one**; every removed legacy name would come back
as a stylelint error anyway.

### The map — pick by role

- **Surfaces, back to front:** `--canvas` page · `--canvas-2` raised/hover
  block · `--canvas-3` recessed (settings nav, palette footer) · `--panel`
  (+ `--panel-line`, `--panel-footer`) · `--composer` · `--rail` the 76px
  server rail.
- **`--rail-*` is near-black in BOTH themes.** Its ink family (`--rail-ink`,
  `--rail-muted`, `--rail-item`, `--rail-item-hover`, `--rail-line`,
  `--rail-create-bg`, `--rail-create-ink`) is built for that dark ground and
  will not read on `--canvas`. If rail markup ever sits on a page background
  (the mobile full-screen server list does), override the fill **and** the ink
  together — half of that was a shipped bug, invisible in dark theme because
  `--rail` and `--canvas` are both near-black there.
- **Text:** `--ink` body · `--muted` secondary · `--muted-2` tertiary ·
  `--faint` placeholder. `--white` is ink **on a coloured fill**, not a surface.
- **Lines:** `--line` default hairline · `--line-strong` control edges
  (inputs, composer).
- **Accent & status:** `--accent` / `--accent-hover` fills, `--accent-text`
  for text, `--accent-soft` tinted bg, `--accent-border` tinted edge;
  `--accent-300/400/500` are gradient ramp stops only. Same shape for status:
  `--online`/`-soft`/`-text`, `--danger`/`-soft`/`-text`,
  `--warning`/`--warning-text`.
- **`--danger` has NO dark override, by decision** (white on a dark pastel
  fails contrast across its fill sites). Dark-readable danger *foreground* is
  `--danger-text`. `--warning-text` IS theme-split on purpose — don't
  "simplify" either direction.
- **Theme-invariant families — never add dark overrides:** `--stage-*` (call
  stage) and `--media-*` (photo/lightbox chrome) sit on ground that is dark in
  both themes. On the stage use `--stage-accent` / `--stage-accent-hover` /
  `--stage-danger`, not the theme-switching `--accent` family.
- **Radii — fixed scale, no gaps to fill:** `--radius-chip` 6 · `--radius-row`
  9 · `--radius-btn` 10 · `--radius-card` 11 · `--radius-tile` 13 ·
  `--radius-composer` 14 · `--radius-modal` 16 · `--radius-bar` 18 ·
  `--radius-pill` 999. **There is no 12px step and none may be added** — pick
  the nearest and note it if it matters.
- **Z-index — always a token:** `--z-overlay` 1000 · `--z-menu` 1050 ·
  `--z-popover` 1100 · `--z-palette` 1150 · `--z-tooltip` 1200 · `--z-toast`
  2000 · `--z-crash` 9999. `--z-menu` sits **above** `--z-overlay`
  deliberately: a context menu opened from inside a modal must clear its scrim.
- **Motion:** `--transition` (0.16s) and `--ease-out`.
- **Depth:** `--shadow-row/-card/-popover/-menu/-modal/-palette`, named for the
  surface that wears them; `--focus-ring` (theme-split alpha); `--scrim`.
- **Type:** `--font-sans`, `--font-mono` only. `BlinkMacSystemFont` inside
  `--font-sans` is case-sensitive and carries a `stylelint-disable` so `--fix`
  cannot lowercase it — keep the disable.

### Raw values and tints

Zero raw colour values exist outside `tokens.css`. A tint derived from a token
is fine: `color-mix(in srgb, var(--accent-500) 35%, transparent)`. The
permanent non-CSS exemptions: `utils/avatarColor.ts` (the 8-colour avatar
palette), canvas `fillStyle`/`strokeStyle` in `AvatarCropModal.tsx`, the
`#FFFFFF` fallback in `Avatar.tsx`, and the inline-SVG `data:` URI checkmark in
`primitives.css` (no custom property can reach any of them).

### Custom properties crossing the JS/CSS boundary

Stylelint's `csstools/value-no-unknown-custom-properties` knows only
`tokens.css` and `base.css`, so:

- **JS-injected properties** (`--speak-level`, `--slider-fill`,
  `--meter-level`, `--call-stage-height`, `--avatar-color`) are invisible to
  it — a `var()` reading one **must carry a fallback**. Regenerate the current
  injection sites with:
  ```bash
  cd client && grep -rn -- "--speak-level\|--slider-fill\|--meter-level\|--call-stage-height\|--avatar-color" src --include='*.tsx'
  ```
- **Everywhere else, do not add a `var(--x, fallback)` you were not explicitly
  told to add.** A gratuitous fallback silently exempts that site from the
  audit rule that keeps the token system closed. Same for properties declared
  in a *component* stylesheet (e.g. `--presence-ring`) — the plugin can't see
  those declarations either, so their consumers carry fallbacks.
- **CSS-declared, JS-read:** `--avatar-bg` / `--avatar-ink` are declared in
  `UserList.css` and read only by `Avatar.tsx`. Renaming them breaks avatars
  with no lint, type, or test error — grep `src/**/*.tsx` before touching a
  custom property no `.css` file reads.

## Class names

`selector-class-pattern` admits exactly three shapes:

```
^(?:btn|input|kbd|modal|mention)$          single-segment allowlist (primitives only)
^(?:is|has)-[a-z0-9]+(?:-[a-z0-9]+)*$      state modifiers
^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$            multi-segment kebab-case
```

- Nothing outside the five-name allowlist may be one word. Never BEM (`--`).
- The regex cannot enforce the component prefix — you must: `attachment-count-1`,
  not `count-1`. One namespace, one owner file.
- **Collapsing a compound selector to a single class changes specificity —
  measure the cascade before "simplifying".** Files that depend on compound
  ties say so in comments beside the rules (`ServerList.css` is the canonical
  example); believe them.
- `composer-attach-btn` / `composer-attach-input` carry **no CSS on purpose**
  — they are identity hooks for test/probe tooling. Don't delete them.
- **Any class rename must sweep beyond `src/`**: `__tests__/` and any probe
  scripts in use. Selectors held in variables, markup in data tables, and
  prose references don't match a naive dot-anchored grep.

## Icons

- `lucide-react` only; zero hand-inlined `<svg>` in `src/`, no emoji-as-icon.
- **Every icon: explicit `size` and `strokeWidth={1.8}`.** No exceptions exist;
  do not create the first.
- Size by surface density: 10–15 badges/chevrons/chips, 16–21 standard
  controls, 22–28 empty-state/hero. Match the neighbouring icon.

## Primitives

`src/styles/primitives.css` owns the shared vocabulary: `.btn` +
`-primary|-secondary|-ghost|-danger|-danger-soft`, `.input`, `.kbd`,
`.toggle-switch`, `.select-wrap`, `.slider-input`, `.level-meter`,
`.panel-icon-btn`, `.user-avatar-wrap`, `.modal-overlay` / `.modal` family,
`.context-menu`, `.error-toast`, and the four shared keyframes (`fade-in`,
`scale-in`, `modal-in`, `slide-down` — a comment there lists live consumers;
keep it accurate).

**Reuse before you write**; adopt the primitive and override the delta.
Component CSS loads after primitives, so it wins equal-specificity ties by
source order — but **prefer to win on specificity** for overrides that matter,
so the result doesn't depend on file order.

## Overlays

The densest area of the codebase. The contract:

- **Every blocking scrim carries `.modal-overlay` and adopts
  `useModalFocus(active, containerRef, onClose)`** — which buys stack
  membership (Escape closes only the top-most; nested modals are real), a Tab
  trap, `[data-autofocus]`, and focus restore.
- **Non-modal floating surfaces take `useEscapeDismiss(active, onEscape,
  blocking?)`** — stack membership and nothing else. Never a private
  `document` keydown listener. `blocking` defaults to false; raising it makes
  the surface swallow global hotkeys, so only genuinely blocking scrims do.
- `isBlockingOverlayOpen()` (`hooks/useModalFocus.ts`) is what global hotkeys
  (⌘K, Ctrl+Shift+F) consult, and its DOM-querying half is **load-bearing**:
  a full-viewport fixed surface that skips `.modal-overlay` must be added to
  its selector (as `.screen-picker-backdrop` and `.p2p-overlay.is-incoming`
  were) or hotkeys will open on top of it. Note the p2p entry names the
  `.is-incoming` **state** — the in-call view has no scrim and must not block.
- `src/styles/__tests__/overlay-scrim-contract.test.ts` enforces the class
  half of this (any viewport-covering `position: fixed` rule must carry
  `.modal-overlay` or sit in its asserted allowlist). It cannot see a modal
  that has the class but dropped the hook — that half is on you.
- **`useDismissOnOutside`** (pickers/popovers): it registers a capture-phase
  document keydown that swallows Escape, so (1) it may only be subscribed
  while its surface is mounted — mount the popover as its own component, never
  call the hook from an always-mounted parent; (2) the toggle button that
  opens the surface must `stopPropagation()` in its own `onMouseDown`, or the
  bubble-phase dismiss and the click re-open cancel out; (3) its call sites
  must render outside any `.modal-overlay`, or they silently lose Escape.

## Motion

- Enter/exit ≤250 ms with `var(--ease-out)`; `--transition` is the default.
  Only infinite loops and one-shot attention flashes may exceed the budget.
- `linear` is correct **only** for fills tracking a live value (meters,
  progress); easing there makes the bar lag the number.
- Reuse the four shared keyframes before minting one. Keyframe names are
  kebab-case; component-scoped ones carry the component prefix.
- `prefers-reduced-motion`: drop loops, keep fades — not blanket suppression.

## i18n

- `src/i18n/locales/ru.ts` is the source dictionary
  (`export type Dictionary = typeof ru`); `en.ts` is typed against it, so
  **`tsc` is the real gate** — both files change in the same commit, always.
- `npm run check:i18n` is a heuristic sweep for unwrapped user-facing text;
  keep it green but don't treat it as proof.
- Plurals go through `tp()` / `useTp()` (`Intl.PluralRules` — Russian has
  one/few/many; a `count === 1 ? … : …` is wrong in the source language).
- `useT()` / `useTp()` in components (reactive); bare `t` / `tp` only in
  services where hooks are unavailable.
