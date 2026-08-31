# `client/` — design-system contract

Read `../CLAUDE.md` first for repo-wide facts (trunk, gates, `npm test` baseline).

This is a **contract, not a tutorial**. Every rule below exists because it was
broken and the breakage was measured. Rules with no measured consequence are
deliberately absent.

Its empirical source is **VYC-82** — a natural experiment. Another developer
built six components (`MessageAttachments`, `AttachmentTray`, `AttachmentButton`,
`VideoPlayer`, `AudioPlayer`, `MediaLightbox`) on `develop` with no redesign
context. What they got wrong is exactly what fails to transmit without this
file, so each rule cites the divergence it prevents. Divergences are quoted from
the trunk as it stood at the merge, which is still readable — **note the paths
are repo-relative, not `client/`-relative**:

```bash
git show a328a11:client/src/components/AttachmentTray.css
```

Not every trunk-authored file is a VYC-82 divergence; where a rule concerns code
that arrived from a different trunk ticket, the rule says so.

All claims re-verified against the tree on **2026-08-30** at `bab71ef`.

---

## 1. Tokens

`src/styles/tokens.css` is the only file that may contain a raw colour value.
It has three blocks:

Line numbers below were **re-derived from the tree at M6 T3's final commit** (the
file is **413** lines). They have moved in every M6 task so far, and moved twice
*within* T3 — T2 added two `value-keyword-case` suppressions, T3 added four
tokens with their rationale comments, then a large `--danger` rationale block,
then that block grew again in review — so **run the grep, do not trust the
numbers**. An earlier revision of this section shipped figures stale by 26
against the very command below, which is how this warning got written:

```bash
grep -n '^:root {\|^\[data-theme="dark"\] {\|^:root, \[data-theme="dark"\] {' client/src/styles/tokens.css
```

1. `:root` (lines 5–269) — the **canonical** light-theme tokens.
2. `[data-theme="dark"]` (298–343) — dark overrides. Two families deliberately do
   **not** appear here and must not be added: `--stage-*` and `--media-*` sit on
   ground that is dark in both themes (a call stage, a photo, the lightbox
   scrim). Their comments say so; read them before "fixing" the omission.
   `--stage-accent`, `--stage-accent-hover` and `--stage-danger` (M6 T3) are part
   of that family. `--stage-accent` `#6366F1` and `--stage-accent-hover` `#818CF8`
   are the dark theme's `--accent` / `--accent-hover`. **`--stage-danger`
   `#FCA5A5` is the dark `--danger-text`, not a dark `--danger`** — there is no
   dark `--danger`, by decision (see the comment beside that token; a dark
   override was measured and ruled out). Do not read this line as licence to add
   one.
   Conversely, **`--warning-text` IS theme-split on purpose** (M6 T3): `#B45309`
   on `:root`, `#F59E0B` here. It exists to fix a **light**-theme contrast
   failure on `.setting-warning` (2.01:1 → 4.69:1), and the dark override exists
   only to stop that light value regressing dark from 8.16:1 to 3.49:1. Do not
   "simplify" it to a single value — measured, both directions.
3. **`LEGACY ALIASES — DELETE IN M6`** (350–413, in two rules: 350–398 plus a
   trailing `[data-theme="dark"]` at 409–413; `alias-sentinel.mjs` reports this
   span independently and is the better source) — every pre-redesign name
   (`--bg-*`, `--text-*`, `--border-*`, `--brand-*`, `--green-*`/`--red-*`/
   `--yellow-*`/`--blue-*`, `--shadow-sm|md|lg|xl`, `--radius-sm|md|lg|xl|full`)
   mapped onto the new system so unmigrated CSS keeps rendering. It is scheduled
   for deletion in M6 together with its trailing `[data-theme="dark"]` block.

**Write canonical names only.** VYC-82 reached for `--bg-hover`, `--text-primary`
and `--border-color` (`AttachmentTray.css:14,28,38,46,66`,
`MessageAttachments.css:24,58,61,65` on the trunk) — all three are
aliases. When M6 deletes the block, alias users lose their values silently.

**No raw colour values outside `tokens.css`.** VYC-82 used `#5865f2`, `#d83c3e`
and `#fff` (`AttachmentTray.css:19,52`, `AudioPlayer.css:18,33`,
`MediaLightbox.css:20,22` and others on the trunk). Four raw-value sites remain
in the migrated tree — `Auth.css:90,127,140` and `TitleBar.css:34` — and they are
**M6's job**, not a licence to add more.

### Custom properties that cross the JS/CSS boundary

Stylelint's `csstools/value-no-unknown-custom-properties` only knows the
properties declared in `tokens.css` and `base.css` (`.stylelintrc.json`'s
`importFrom`). Two families escape it, in opposite directions:

**(a) JS-injected, CSS-consumed — five properties. A `var()` reference to one
MUST carry a fallback.**

| Property | Injected at |
|---|---|
| `--speak-level` | `CallStage.tsx:288,343,942,997`, `CallUI.tsx:200,221` |
| `--slider-fill` | `AvatarCropModal.tsx:218`, `settings/AudioSettings.tsx:162` |
| `--meter-level` | `settings/AudioSettings.tsx:235` |
| `--call-stage-height` | `pages/AppPage.tsx:643` |
| `--avatar-color` | `Avatar.tsx:32` |

Measured, not assumed: `primitives.css:235,268` write `var(--slider-fill, 0%)` /
`var(--meter-level, 0%)` and lint clean.

**This was a live violation of the contract's own rule until M6 T3, and is now
closed.** `UserList.css:111,112` used to write bare `var(--avatar-color)` inside
`color-mix()` and produce two `Unexpected custom property "--avatar-color"`
errors — the last 2 of that rule in the repo. T3 gave both a fallback
(`var(--avatar-color, var(--accent))`) and moved the root `CLAUDE.md` gate figure
from 54 to **51** in the same commit, as this section used to instruct.

**There are now zero `csstools/value-no-unknown-custom-properties` errors, and
that zero is M6 T13's audit gate.** So the rule now cuts the other way: **do not
add a `var(--x, fallback)` anywhere you are not explicitly told to.** A gratuitous
fallback silences the very rule T13 uses to find unmigrated properties, and it
does so without changing the lint total, so nothing catches it.

**The rule is wider than "JS-injected": it is "not declared in `tokens.css` or
`base.css`."** The plugin knows only those two files, so a property declared in a
*component* stylesheet is equally invisible to it. Measured by break/restore:
removing the fallback at `primitives.css:330` — `var(--presence-ring)` instead of
`var(--presence-ring, var(--canvas))` — makes that line flag
`Unexpected custom property "--presence-ring"`, even though `--presence-ring` is
declared in `ChannelSidebar.css:271`. Restored immediately; the broken state was
never committed. (`--presence-ring` is **not** JS-injected — it is CSS-defined
and CSS-consumed. Documents that list it among the injected family are wrong.)

**(b) CSS-declared, JS-consumed — `--avatar-bg` and `--avatar-ink`.** Declared in
`UserList.css:106,107,111,112`, read only from `Avatar.tsx:33,34`. Stylelint
never sees the `var()` at all. **Renaming either declaration breaks the member
list's avatars with no lint error, no type error and no failing test.** Grep
`src/**/*.tsx` before touching a custom property that no `.css` file reads.

---

## 2. Class names

`.stylelintrc.json`'s `selector-class-pattern` admits exactly three shapes:

```
^(?:btn|input|kbd|modal|mention)$          single-segment allowlist (primitives only)
^(?:is|has)-[a-z0-9]+(?:-[a-z0-9]+)*$      state modifiers
^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$            multi-segment kebab-case
```

- **`btn`, `input`, `kbd`, `modal`, `mention` are the whole single-segment
  allowlist.** Nothing else may be one word. VYC-82's overlay was `.lightbox`
  (`MediaLightbox.css:1` on the trunk); it is `.modal-overlay .lightbox-root`
  now.
- **State goes through `is-*` / `has-*`.** VYC-82 wrote
  `` `toolbar-btn${open ? ' active' : ''}` `` (`AttachmentButton.tsx:45`); the
  redesign writes `is-active`.
- **Never BEM.** VYC-82 shipped `.attachment-cell--wide`
  (`MessageAttachments.css:14`) and `.lightbox-nav--prev` / `--next`
  (`MediaLightbox.css:34,35`). The `--` shape passes no rule here and reads as a
  foreign convention.
- **The regex cannot enforce the component prefix — you must.** `count-1` …
  `count-4` are valid multi-segment kebab and were still wrong, because they read
  as global. They are `attachment-count-1` … `attachment-count-4` now
  (`MessageAttachments.tsx:62`, `MessageAttachments.css:13,17–19,72–74`). One
  namespace, one owner file.
- **`selector-class-pattern` is now at ZERO, and that zero is the invariant.**
  It was **43** for most of the redesign — `ChannelSidebar.css` 16,
  `ServerList.css` 14, `UserList.css` 12, `TitleBar.css` 1 — all of them
  **single-segment names** (`.channel`, `.active`, `.add`, `.home`, `.search`,
  `.close`, `.list`, `.small`, `.offline`, `.username`, `.current`, `.off`) in
  files that were otherwise thoroughly migrated: `ChannelSidebar.css` declares
  `--presence-ring`, carries M2-era rationale comments and uses canonical tokens
  throughout. Token migration and class-name migration are separate axes.
  **M6 T9** cleared `UserList.css` and `TitleBar.css` (13); **M6 T10** cleared
  `ChannelSidebar.css` and `ServerList.css` (30). The whole repo total went
  51 → 38 → **8**, and those 8 are all `no-descending-specificity`. **There is
  no remaining debt on this rule, so any new error is one you just added.**
- **Collapsing a compound to a single class changes specificity — measure the
  cascade, do not assume it.** M6 T10's plan table said
  `.server-icon.add` → `.server-icon-add`, i.e. (0,2,0) → (0,1,0). Measured with
  protocol-level `:hover` on scratch tiles: the hovered create tile's glyph flips
  from `--rail-create-ink` `rgb(74,222,150)` to `--rail-ink` `rgb(228,231,240)`,
  because `.server-icon:hover` (0,2,0) then outranks it; and at ≤768px the home
  tile's symbol flips from `--bg-primary`/`--brand-color` to the inverse, because
  `.server-icon.is-active .server-icon-symbol` (0,3,0) then outranks
  `.server-icon-home .server-icon-symbol` (0,2,0). It also *adds* three
  `no-descending-specificity` errors (8 → 11). So the rail variants are written
  as **`.server-icon.server-icon-home`** (and `-add`, `-search`) — the offending
  single-segment name is gone, specificity and source order are byte-identical,
  and `probe-t10-cascade.js` + `t10-scratch.js` are the measurement. T9's
  `.user-avatar.list` → `.user-avatar-list` collapse was safe only because no
  bare `.user-avatar` rule existed and nothing tied against it.

### Classes that carry no CSS rule on purpose

`composer-attach-btn` and `composer-attach-input` (`AttachmentButton.tsx:100,118`)
appear in **no stylesheet**. They are **identity hooks** so the CDP probes can
address the attach button and drive its `<input type="file">` (`smoke.mjs` has no
`setFileInputFiles`). The button's styling comes entirely from
`composer-icon-btn` (`Composer.css:62`). They are not residue — do not delete
them without re-pointing `tools/probe-attachments*.js`.

### Any class rename must sweep the harness

`.superpowers/` is gitignored, so **nothing gates `tools/*.js`**. When T5 renamed
`.lightbox` → `.lightbox-root`, four probes addressed the old class and some of
those uses were *negative* preconditions that would have gone permanently true —
e.g. `probe-attach-escape.js:50`,
`out.lightboxClosedByEscape = !document.querySelector('.lightbox')`, which would
have passed forever with no error, no failing test and no visual difference.
Sweep `__tests__/` **and** `.superpowers/sdd/*/tools/*.js`.

`tools/selector-sweep.mjs` automates most of that sweep (emissions, `querySelector`
family, `classList` arguments, whole-`className` writes, literal `class=` in
injected markup, CSS selector sites, and prose/comment references). **It sweeps
ONE class per run — pass two `--class` flags and it exits 2 rather than answering
for the first one only.** Three channels remain a hand-read obligation, and each
has drawn blood:

- **Selectors held in variables.** M6 T10's rename missed
  `const railSel = '.server-icon:not(.home):not(.add):not(.search)'` in four
  probes, because no dot-anchored rewrite matches `:not(.home)` and the sweep
  reports the *call* (`querySelectorAll(railSel)`) as unresolvable. Found only by
  grepping every quoted string for the class token.
- **Markup in a data table.** `probe-dark-parity.js`'s fixtures are
  `[html, selector]` pairs assigned to `innerHTML` through a variable, so the
  literal `class="…"` is invisible to the sweep's markup channel.
- **Prose without a leading dot.** The prose scan matches the token `.name`; a
  comment saying "the off state" carries nothing to match. Read the sentences
  *around* each prose hit.

---

## 3. Icons

- **`lucide-react` only** (imported by 35 files). There is **zero** `<svg>` in
  `src/`. VYC-82 hand-inlined a paperclip path
  (`AttachmentButton.tsx:51` on the trunk).
- **`strokeWidth={1.8}` on every icon, and an explicit `size` on every icon.**
  163 `strokeWidth=` occurrences, all `1.8`; 163 `size={N}` occurrences. A
  brace-aware scan of every lucide tag in `src/` (162 delimited, including
  multi-line tags and tags with arrow-function props) found **zero** missing
  either prop and **zero** with a stroke width other than `1.8`. The 163/162 gap
  is `Settings.tsx:67` — `<tab.icon size={16} strokeWidth={1.8} />`, a dynamic
  component reference no by-name scan can see; it carries both props correctly,
  so coverage is total. No exception exists; do not create the first one.
- Sizes are surface-density-dependent, not a
  fixed range: 10–15 for badges, chevrons and inline chips; 16–21 for standard
  controls (the common case); 22–28 for empty-state and hero glyphs. Match the
  neighbouring icon in the same surface rather than inventing a value.
- **No emoji-as-icon.** VYC-82 shipped `‹` (`MediaLightbox.tsx:83`), `⛶` and `📄`
  (`MessageAttachments.tsx:78,95`).

---

## 4. Primitives

`src/styles/primitives.css` (744 lines) owns the shared vocabulary:

`.btn` + `.btn-primary|-secondary|-ghost|-danger|-danger-soft` · `.input` ·
`.kbd` · `.toggle-switch` / `.toggle-track` · `.select-wrap` / `.select-control` /
`.select-chevron` · `.slider-input` · `.level-meter` + `-fill` / `-caption` ·
`.panel-icon-btn` · `.user-avatar-wrap` (presence dot) · `.modal-overlay` /
`.modal` / `.modal-header` / `.modal-title` / `.modal-actions` / `.modal-error` /
`.modal-close-btn` · `.context-menu` + items · `.error-toast` · the four shared
keyframes (§6).

**Reuse before you write.** If a surface needs a button, a slider or a modal
shell, adopt the primitive and override the delta.

**Cascade fact.** `main.tsx:9–11` injects `tokens.css` → `base.css` →
`primitives.css` before any component stylesheet, so **component CSS wins
equal-specificity ties against primitives by source order.** Verified in M2 in
dev *and* in the production bundle, and re-measured in M5.5 T5 by a break/restore
control (removing `MediaLightbox.css`'s scrim rule let the primitive's
`var(--scrim)` take over — `rgba(16,19,34,0.5)` instead of `0.88`).

That said, **prefer to win on specificity when the override matters.** T5 moved
the lightbox scrim to `.modal-overlay.lightbox-root` (0,2,0) precisely so the
override no longer depends on file order. Source order is a fact you can rely on
to diagnose; specificity is what you should ship.

---

## 5. Overlays

**Every blocking scrim carries `.modal-overlay` and adopts `useModalFocus`.**

`.modal-overlay` (`primitives.css:334`) is `position: fixed; inset: 0;
z-index: 1000` + `var(--scrim)` + `blur(6px)` + centering + `fade-in`.
`useModalFocus(active, containerRef, onClose)` (`hooks/useModalFocus.ts:15`)
buys: a modal **stack** (Escape closes only the top-most — nested modals are
real: Settings → logout ConfirmModal), a Tab trap, `[data-autofocus]` on open,
and focus restore on close.

`isBlockingOverlayOpen()` (`useModalFocus.ts:109`) is what global hotkeys
consult, and **it reads the DOM**:

```ts
modalStack.length > 0 ||
document.querySelector('.modal-overlay, .screen-picker-backdrop') !== null
```

The DOM half is load-bearing until M6 finishes app-wide `useModalFocus`
adoption: **13** `.tsx` files put the `modal-overlay` class on an element (grep
without the leading dot — it never appears in a `className`), but only **5** call
`useModalFocus` (`Settings`, `CommandPalette`,
`ConfirmModal`, `MediaLightbox`, `FindServerModal`). Consumers of the gate:
`usePaletteHotkey.ts:17` (⌘K), `ChatArea.tsx:288` (Ctrl+Shift+F),
`useDismissOnOutside.ts:60`.

**This invariant has already been broken twice.** `.screen-picker-backdrop`
(`ScreenSourcePicker` / `ScreenQualityPicker`) is a fixed scrim at z-index 1100
that deliberately opted out of the primitive — it is hard-coded into the selector
above as a result. Then VYC-82's `MediaLightbox` did it again: `.lightbox` with
`position: fixed; inset: 0; z-index: 1000` and no `.modal-overlay`, so ⌘K opened
the palette *behind* an open lightbox. M5.5 T4 fixed it. **If you add a third,
add it to the selector or fix it properly — do not leave it invisible.**

**Escape goes through the modal stack, not a private listener.** VYC-82's
`MediaLightbox` registered its own bubble-phase
`document.addEventListener('keydown', onKey)` (`MediaLightbox.tsx:55` on
the trunk, no capture flag, no `stopPropagation`) — which meant it had no
stack membership and no nesting order.

### The popover hook

`useDismissOnOutside` (`hooks/useDismissOnOutside.ts`) has **exactly three call
sites**: `EmojiPicker.tsx:15`, `StickerPicker.tsx:16`,
`AttachmentButton.tsx:50`.

**Provenance, because this file otherwise reads as "VYC-82 got it wrong": the
hook is trunk-authored, not redesign-authored.** It does not exist on the
redesign branch before the M5.5 merge
(`git cat-file -e d559bad:client/src/hooks/useDismissOnOutside.ts` fails) and
arrived with **VYC-81** (`28b8884`), already carrying
`document.addEventListener('keydown', handleKeyDown, true)` plus
`preventDefault()` / `stopPropagation()`. VYC-82 did not write the capture-phase
swallower — it *called* it from the wrong place. Two hard-won rules govern it:

1. **It registers a capture-phase document `keydown` that `preventDefault()`s and
   `stopPropagation()`s Escape (`:61–62,66`). Subscribe it only while its surface
   is mounted.** VYC-82 called it from `AttachmentButton`'s always-mounted
   component body. The moment M5.5 T3 mounted that button in the Composer, an
   app-wide Escape swallower went live for the whole lifetime of the channel:
   `MediaLightbox`, `useModalFocus`, `MessageSearch`, the message editor's cancel
   and the mention dropdown all stopped receiving the key. Measured: a synthetic
   Escape was seen 1× at document-capture and 0× at document-bubble, while a
   letter key was seen 1× at both. **No console error, no failing test, no visual
   difference.** The fix was to split the popover into its own component
   (`AttachPicker`), so the subscription lives exactly as long as the surface
   that wants Escape.
2. **A button that opens a dismissible surface must `stopPropagation()` in its own
   `onMouseDown`.** The hook dismisses on *bubble-phase* `mousedown`; without the
   opt-out, clicking an open picker's toggle dismisses it here and the toggle's
   `onClick` immediately re-opens it — the picker can never close itself. Every
   such toggle carries it: `AttachmentButton.tsx:88`, Composer's sticker and
   emoji buttons, FormattingToolbar's emoji button.

The hook also bails out of Escape entirely when `isBlockingOverlayOpen()` is
true (`:60`), so a modal raised over an open picker still closes. That deferral
is sound **only because all three call sites render outside any
`.modal-overlay`.** A picker rendered *inside* a modal would silently lose its
Escape.

---

## 6. Motion

- **Enter/exit motion is ≤250ms with `var(--ease-out)`.** `--transition` is
  `0.16s var(--ease-out)`; observed durations are 0.08–0.22s.
  `primitives.css:715` records the one deliberate retune (0.3s → 0.22s) with its
  reason. Infinite loops and one-shot attention flashes are exempt and are the
  only things above the budget: `chat-shimmer` 1.2s, `msg-jump-flash` 2.2s,
  `p2p-pulse` 2.5s, `stage-eq-bar` / `message-search-spin` 0.7s.
- **`linear` is correct for continuous-value fills, and only those.** A meter or
  progress bar tracking a live number must not ease, or the bar lags the value:
  `primitives.css:272` (`.level-meter-fill`, `width 0.08s linear`) and
  `AttachmentTray.css:83` (`width 120ms linear`). Everything else uses
  `var(--ease-out)`.
- **Four shared keyframes live in `primitives.css`** — `fade-in` (:362),
  `scale-in` (:367), `modal-in` (:390), `slide-down` (:734). **Prefer reuse.**
  The comment at `:346` lists every live consumer, re-derived rather than carried
  forward; keep it accurate if you add or remove one.
- Keyframe names are kebab-case (`keyframes-name-pattern`, M4 T2) and
  component-scoped ones carry the component prefix (`stage-eq-bar`,
  `message-search-spin`, `error-boundary-fade-in`).

---

## 7. i18n

- **`src/i18n/locales/ru.ts` is the source dictionary.** It ends with
  `export type Dictionary = typeof ru`. `en.ts` is declared
  `export const en: Dictionary`, so **`tsc` is the real gate** — a key added to
  `ru` and missed in `en` is a type error, and a key removed from `ru` makes
  `en`'s excess a type error. Both files change in the same commit, always.
- **`npm run check:i18n` is a heuristic, not a proof.** Its own header says so
  (`scripts/check-i18n.mjs:1–4`): it greps for user-facing text that was never
  wrapped in `t()`, produces false positives, and is deliberately kept out of the
  build. It must stay green, but it is not what proves the dictionaries agree.
- **Plurals go through `tp()` / `useTp()`** (`i18n/index.ts:70,81`), which use
  `Intl.PluralRules` — Russian has `one`/`few`/`many`, so a hand-written
  `count === 1 ? … : …` is wrong in the source language.
- `useT()` / `useTp()` in components (reactive, re-render on locale change);
  `t` / `tp` only in services, where hooks are unavailable
  (`i18n/index.ts:67–68`).

---

## 8. Verification

The CDP screenshot/probe harness lives at
`.superpowers/sdd/<milestone>/tools/`.

- **It is gitignored** (`.gitignore:44` — the whole `.superpowers/` tree), **~33M**,
  and each milestone carries a copy forward. **The newest copy is the only
  current one**; earlier milestones' `tools/` are frozen snapshots. Nothing gates
  any of it — see §2's rename sweep.
- **`--out <file.png>` is mandatory**: `smoke.mjs:32–35` prints
  `missing --out <file.png>` and `process.exit(2)` without it.
- **A failing probe still exits 0.** `smoke.mjs:403` wraps the probe in
  `try { … } catch (e) { return 'PROBE ERROR: ' + e.message }` and prints the
  result; `process.exitCode = 1` is set only when the *harness* fails
  (`:418–419`). **Evidence is the printed output, never the exit code.**
- **The probe file is evaluated as an expression** — it is interpolated into
  `(await (${probeSrc}))`. It must be an IIFE, typically
  `(async () => { … return out; })()`.
- **A probe is evidence only once it has been shown to fail against the broken
  code it is meant to catch.** Break, run, observe the failure, restore, re-run.
  A probe that has only ever been green proves nothing about what it asserts.
- **To assert a token is live, use the scratch-element pattern**:

  ```js
  const scratch = (decl, prop, classes) => {
    const el = document.createElement('div');
    if (classes) el.className = classes;
    el.style.cssText = decl;
    document.body.appendChild(el);
    const v = getComputedStyle(el)[prop];
    el.remove();
    return v;
  };
  const tokenColor = (name) => scratch(`background: var(${name});`, 'backgroundColor');
  ```

  **Never**
  `getComputedStyle(document.documentElement).getPropertyValue('--X')`: it
  returns the **declared** string whether or not anything consumes it, and
  compares a hex literal against the `rgb()` the element actually computed — so
  the check is always-true. Add a negative control
  (`tokenColor('--token-that-does-not-exist')`) so a comparison of two identical
  "nothing resolved" strings cannot pass silently.

### Counting messages

`api.getMessages(channelId, limit = 50, offset = 0)` (`services/api.ts:524`)
takes **`limit`/`offset` only — there is no `before` cursor.** A `before=` param
is silently ignored and the call re-reports page 1. The default `limit` of 50
means an unpaginated read of an 83-message channel returns 50 regardless of what
happened. Paginate explicitly before counting anything against that API.
