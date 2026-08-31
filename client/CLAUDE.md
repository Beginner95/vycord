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

All claims re-verified against the tree on **2026-08-31** at M6 T13's commit —
the numbered citations in §§1–6 were re-derived from the shipped tree in that
commit, not carried forward. **Re-measure before trusting any of them again**:
this file has shipped stale line numbers in every milestone so far, and T13
alone found drift in the JS-injected table (all five rows), `--avatar-bg` /
`--avatar-ink`, `--presence-ring` (both ends), the icon census, `primitives.css`'s
length, the retune citation and all four shared-keyframe lines.

---

## 1. Tokens

`src/styles/tokens.css` is the only file that may contain a raw colour value.
It has **two** blocks. It had three until M6 T13; see the note after them.

Line numbers below were **re-derived from the tree at M6 T13's commit** (the
file is **429** lines). They have moved in every M6 task so far, and moved twice
*within* T3 — T2 added two `value-keyword-case` suppressions, T3 added four
tokens with their rationale comments, then a large `--danger` rationale block,
then that block grew again in review — so **run the grep, do not trust the
numbers**. An earlier revision of this section shipped figures stale by 26
against the very command below, and M6 T13's first attempt shipped figures stale
by **1** against it — measured before the last rewording of a comment inside the
file, which is a mistake this paragraph exists to prevent and did not.
**Re-run these after your final edit to `tokens.css`, not before it** — and note
they return **all four** figures below, not just the two openers. An earlier
revision documented a grep that matched only the `{` lines, so half of what the
section asserts had no command behind it:

```bash
wc -l client/src/styles/tokens.css
grep -n '^:root {\|^\[data-theme="dark"\] {\|^}' client/src/styles/tokens.css
```

The second prints four lines, in order: each block's **opening brace line**, then
its **closing brace line**. **The ranges below are those brace lines
themselves** — not the first and last declarations inside — so `:root` "5–329"
means `:root {` is on 5 and its `}` is on 329. `^}` matches only top-level
closers, so it also doubles as the block count: **two** hits is the end state,
and a third means the alias layer has been re-introduced.

1. `:root` (lines 5–329) — the **canonical** light-theme tokens.
2. `[data-theme="dark"]` (358–403) — dark overrides. Two families deliberately do
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

**There is no third block any more.** The `LEGACY ALIASES` layer — 47
pre-redesign names in 50 declarations, in a `:root, [data-theme="dark"]` rule
plus a trailing `[data-theme="dark"]` carrying three dark overrides — was
deleted whole by **M6 T13**, together with all 66 `var()` references to it. That
deletion **was** the spec §8 audit. **Do not re-introduce a compatibility layer.**

**The always-available check is `npx stylelint "src/**/*.css"` returning
nothing** (see §2 — the repo total is zero). That is the tracked gate: every
alias reference is a `csstools/value-no-unknown-custom-properties` error, because
`importFrom` names only this file and `base.css`.

The *detailed* instrument is `tools/alias-sentinel.mjs`, which reports
`0 unique / 0 declarations` with status `BLOCK-ABSENT`. **It lives in the
gitignored harness** (`.superpowers/sdd/<milestone>/tools/`, §8 — newest
milestone copy only), so it is a local check, not something a clean checkout can
run:

```bash
node .superpowers/sdd/<milestone>/tools/alias-sentinel.mjs \
     --expect 0/0 --expect-status BLOCK-ABSENT
```

**`--expect 0/0` alone is not a gate.** It passes on `BLOCK-ABSENT` (banner and
rules both gone — correct) *and* on `WINDOW-EMPTY` (rules gone, banner left
behind — a half-deletion). T13 hit `WINDOW-EMPTY` for real: its replacement
comment quoted the old banner text, the sentinel anchored on it, and the
count-only gate passed. Always pass `--expect-status`, and never write the
phrase `LEGACY ALIASES — DELETE IN M6` back into **`tokens.css`** — that string
is what the sentinel anchors on, so a prose mention of it there resurrects the
banner with no rules behind it.

**Write canonical names only.** VYC-82 reached for `--bg-hover`, `--text-primary`
and `--border-color` (`AttachmentTray.css:14,28,38,46,66`,
`MessageAttachments.css:24,58,61,65` on the trunk) — all three were aliases and
**none of them exists now**. A `var()` naming one is a stylelint error, not a
silent fallback: see the audit rule below.

**No raw colour values outside `tokens.css`, and there are now ZERO.** VYC-82
used `#5865f2`, `#d83c3e` and `#fff` (`AttachmentTray.css:19,52`,
`AudioPlayer.css:18,33`, `MediaLightbox.css:20,22` and others on the trunk). The
last four in the migrated tree — `Auth.css:90,127,140` and `TitleBar.css:34` —
were cleared by M6 T13, which is spec §9.4's half of the audit.

Unlike the alias rule, **stylelint does not check this one** — there is no rule
configured for it, so the check is a script in the gitignored harness (§8), local
only:

```bash
node .superpowers/sdd/<milestone>/tools/t13-raw-colour-gate.mjs
```

It covers **hex, the `rgb()/hsl()/lab()/oklch()` family, AND bare named colours**
(`color: white` is the species this codebase actually shipped), and it **strips
comments before counting** — §8.1's trap, which produced a wrong census three
separate times here, and which now matters more than ever because the tree
carries comments quoting the very literals that were removed. If the harness is
not to hand, the hand-equivalent is a comment-stripped grep for those three
families over `src/**/*.css` excluding `tokens.css`.

A tint derived from a token is **not** a raw value:
`color-mix(in srgb, var(--accent-500) 35%, transparent)` is how `Auth.css`
replaced two of the four, and `UserList.css:127,128` used the construct first.
Chrome serialises the result as `color(srgb …)` rather than `rgba(…)`; that is a
notation change, not a colour change (measured on painted pixels, two reads,
each with its own sensitivity floor). §9.4's **permanently exempt** non-CSS
allowlist is `utils/avatarColor.ts:5–12` (the 8-colour avatar palette §4.3
mandates), `AvatarCropModal.tsx:109,116` (`ctx.fillStyle`/`strokeStyle`, which
cannot read a custom property) and `Avatar.tsx:34` (the `#FFFFFF` fallback in
`var(--avatar-ink, #FFFFFF)`). One more site is exempt by nature: the checkmark
`data:` URI at `primitives.css:492` carries `stroke='white'` inside an inline
SVG, where no custom property can reach.

### Custom properties that cross the JS/CSS boundary

Stylelint's `csstools/value-no-unknown-custom-properties` only knows the
properties declared in `tokens.css` and `base.css` (`.stylelintrc.json`'s
`importFrom`). Two families escape it, in opposite directions:

**(a) JS-injected, CSS-consumed — five properties. A `var()` reference to one
MUST carry a fallback.**

Line numbers re-derived at M6 T13; every one of the five had drifted.

| Property | Injected at |
|---|---|
| `--speak-level` | `CallStage.tsx:313,368,1000,1055`, `CallUI.tsx:200,221` |
| `--slider-fill` | `AvatarCropModal.tsx:219`, `settings/AudioSettings.tsx:166` |
| `--meter-level` | `settings/AudioSettings.tsx:250` |
| `--call-stage-height` | `pages/AppPage.tsx:686` |
| `--avatar-color` | `Avatar.tsx:32` |

Measured, not assumed: `primitives.css:235,268` write `var(--slider-fill, 0%)` /
`var(--meter-level, 0%)` and lint clean.

**This was a live violation of the contract's own rule until M6 T3, and is now
closed.** `UserList.css:127,128` (`:111,112` before T3's own comment pushed them
down) used to write bare `var(--avatar-color)` inside `color-mix()` and produce
two `Unexpected custom property "--avatar-color"` errors — the last 2 of that
rule in the repo. **Note what this proves and keep it in mind before adding a
`color-mix`: the audit rule DOES see inside `color-mix()`**, so a tint derived
from a token is still checked. T3 gave both a fallback
(`var(--avatar-color, var(--accent))`) and moved the root `CLAUDE.md` gate figure
from 54 to **51** in the same commit, as this section used to instruct.

**There are zero `csstools/value-no-unknown-custom-properties` errors, and that
zero was M6 T13's audit gate.** So the rule cuts the other way: **do not add a
`var(--x, fallback)` anywhere you are not explicitly told to.** A gratuitous
fallback silences the rule without changing the lint total, so nothing catches
it.

**Both halves of that are measured, by break/restore, in T13's commit.** Deleting
the single declaration `--bg-hover` from `tokens.css` took stylelint from 8
errors to **10**, naming both of its consumers by line. Then adding a fallback at
one of them — `var(--bg-hover, red)` — took it to **9**: the site with the
fallback went silent while the site without it stayed flagged. Restored
immediately, `git diff --exit-code` clean; the broken state was never committed.
That is why the alias deletion could *be* the audit, and why one careless
fallback would have hidden a site from it.

**The rule is wider than "JS-injected": it is "not declared in `tokens.css` or
`base.css`."** The plugin knows only those two files, so a property declared in a
*component* stylesheet is equally invisible to it. Measured by break/restore:
removing the fallback at the **consumer**, `primitives.css:340` —
`var(--presence-ring)` instead of `var(--presence-ring, var(--canvas))` — makes
that line flag `Unexpected custom property "--presence-ring"`, even though the
property is declared at the **declaration site**,
`ChannelSidebar.css:367`. Restored immediately; the broken state was never
committed. (Two different files, two different numbers — and until M6 T13's fix
round they were coincidentally **both** `340`, which is why an earlier revision
of this paragraph read as though one number had been copied twice. It had not;
the declaration then moved to `:367` when that round added comment lines above
it.) (`--presence-ring` is **not** JS-injected — it is CSS-defined
and CSS-consumed. Documents that list it among the injected family are wrong.)

**(b) CSS-declared, JS-consumed — `--avatar-bg` and `--avatar-ink`.** Declared in
`UserList.css:115,116,127,128`, read only from `Avatar.tsx:33,34`. Stylelint
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
  51 → 38 → 8 → **0**: M6 T13 cleared the last 8, all
  `no-descending-specificity`, by ordering rules by ascending specificity rather
  than by suppressing them. **Stylelint is now GREEN over `src/**/*.css`, and
  that zero is the invariant for every rule, not just this one — any error is
  one you just added.**
- **Collapsing a compound to a single class changes specificity — measure the
  cascade, do not assume it.** M6 T10's plan table said
  `.server-icon.add` → `.server-icon-add`, i.e. (0,2,0) → (0,1,0). Measured with
  protocol-level `:hover` on scratch tiles: the hovered create tile's glyph flips
  from `--rail-create-ink` `rgb(74,222,150)` to `--rail-ink` `rgb(228,231,240)`,
  because `.server-icon:hover` (0,2,0) then outranks it; and at ≤768px the home
  tile's symbol flips from `--bg-primary`/`--brand-color` to the inverse, because
  `.server-icon.is-active .server-icon-symbol` (0,3,0) then outranks
  `.server-icon-home .server-icon-symbol` (0,2,0). It also *adds* three
  `no-descending-specificity` errors (measured at the time as 8 → 11; the
  baseline is **0** since M6 T13, so the same collapse would now read 0 → 3).
  So the rail variants are written
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

- **`lucide-react` only** (imported by 36 files). There is **zero** `<svg>` in
  `src/`. VYC-82 hand-inlined a paperclip path
  (`AttachmentButton.tsx:51` on the trunk).
- **`strokeWidth={1.8}` on every icon, and an explicit `size` on every icon.**
  Re-measured at M6 T13: **165** `strokeWidth=` occurrences, all `1.8`; **165**
  `size={N}` occurrences. A brace-aware scan of every lucide tag in `src/`
  (**164** delimited, including multi-line tags and tags with arrow-function
  props) found **zero** missing either prop and **zero** with a stroke width
  other than `1.8`. The 165/164 gap is still `Settings.tsx:67` —
  `<tab.icon size={16} strokeWidth={1.8} />`, a dynamic component reference no
  by-name scan can see; it carries both props correctly, so coverage is total.
  No exception exists; do not create the first one.
- Sizes are surface-density-dependent, not a
  fixed range: 10–15 for badges, chevrons and inline chips; 16–21 for standard
  controls (the common case); 22–28 for empty-state and hero glyphs. Match the
  neighbouring icon in the same surface rather than inventing a value.
- **No emoji-as-icon.** VYC-82 shipped `‹` (`MediaLightbox.tsx:83`), `⛶` and `📄`
  (`MessageAttachments.tsx:78,95`).

---

## 4. Primitives

`src/styles/primitives.css` (**701** lines, re-counted at M6 T13) owns the
shared vocabulary:

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

`.modal-overlay` (`primitives.css:344`) is `position: fixed; inset: 0;
z-index: var(--z-overlay)` + `var(--scrim)` + `blur(6px)` + centering +
`fade-in`.
`useModalFocus(active, containerRef, onClose)` (`hooks/useModalFocus.ts:73`)
buys: a place in the surface **stack** (Escape closes only the top-most — nested
modals are real: Settings → logout ConfirmModal), a Tab trap, `[data-autofocus]`
on open, and focus restore on close.

**Non-modal surfaces take `useEscapeDismiss(active, onEscape, blocking?)`
(`useModalFocus.ts:176`) instead — never a private `document` listener.** It buys
stack membership and nothing else: no Tab trap, no autofocus, no focus restore
(a popover stealing the caret out of the composer is the bug, not the fix).
M6 T11 moved five surfaces onto it — `ContextMenu`, `VolumeControlPopover`,
`ScreenSourcePicker`, `ScreenQualityPicker`, `useFloatingSelectionToolbar` —
each of which used to close on ANY Escape, including one aimed at a modal above
it. `blocking` defaults to **false** and only `.screen-picker-backdrop` raises
it; a blocking default would silently make a context menu swallow ⌘K.

**The stack arbitrates Tab as well as Escape.** `useModalFocus`'s handler asks
`isTopLayer` *before* it looks at the key, so a light layer pushed over an open
modal suspends that modal's Tab trap for as long as it lives. Unreachable today
(no `useEscapeDismiss` caller renders inside a modal) — do not make it reachable
without reading the note beside `layerStack`.

`isBlockingOverlayOpen()` (`useModalFocus.ts:242`) is what global hotkeys
consult, and **it reads the DOM**:

```ts
layerStack.some((l) => l.blocking) ||
document.querySelector(
  '.modal-overlay, .screen-picker-backdrop, .p2p-overlay.is-incoming',
) !== null
```

The DOM half is load-bearing until app-wide `useModalFocus`
adoption: **13** `.tsx` files put the `modal-overlay` class on an element (grep
without the leading dot — it never appears in a `className`), but only **5** call
`useModalFocus` (`Settings`, `CommandPalette`,
`ConfirmModal`, `MediaLightbox`, `FindServerModal`). Consumers of the gate:
`usePaletteHotkey.ts:70` (⌘K), `ChatArea.tsx:288` (Ctrl+Shift+F),
`useDismissOnOutside.ts:67`.

**This invariant had already been broken three times.** `.screen-picker-backdrop`
(`ScreenSourcePicker` / `ScreenQualityPicker`) is a fixed scrim at `--z-popover`
that deliberately opted out of the primitive — it is hard-coded into the selector
above as a result. Then VYC-82's `MediaLightbox` did it again: `.lightbox` with
`position: fixed; inset: 0; z-index: 1000` and no `.modal-overlay`, so ⌘K opened
the palette *behind* an open lightbox (M5.5 T4 fixed it). And
`.p2p-overlay.is-incoming` (`CallUI.css:8,17`, rendered at `CallUI.tsx:165`) had
been doing it all along — ⌘K opened the palette on top of an incoming 1:1 call.
M6 T11's review caught that one, and it is in the selector above now. **Note the
gate names the `.is-incoming` STATE, not the base rule**: `.p2p-overlay.is-active`
is the in-call view, has no scrim, and blocking ⌘K there would be a behaviour
change nobody asked for.

**M6 T11 made the convention checkable.**
`src/styles/__tests__/overlay-scrim-contract.test.ts` scans every `.css` file for
a `position: fixed` rule that covers the viewport in both axes, and fails unless
its selector carries `.modal-overlay` or sits in a three-entry allowlist whose
length is itself asserted, with each blocking entry required to appear in the gate
selector above.

**Its predicate is the load-bearing part, and the first version was too narrow.**
It required `inset: 0` or four zero offsets, and `.p2p-overlay` — `inset: 40px 0 0`,
40px down to clear the TitleBar — walked straight through it. It now accepts any
anchored box with **at most one non-zero edge**, resolving `inset` and its
longhands in source order. A predicate that recognises one geometry is a census
of that geometry, not of blocking scrims.

**It closes only the ⌘K half.** M5.5's CF-4b measured that dropping the
`useModalFocus` CALL while keeping the CLASS leaves the gate still returning
true, so neither the gate nor this test can see a modal with no Escape. That
half is still the adoption backlog.

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
  `primitives.css:672` records the one deliberate retune (0.3s → 0.22s) with its
  reason. Infinite loops and one-shot attention flashes are exempt and are the
  only things above the budget: `chat-shimmer` 1.2s, `msg-jump-flash` 2.2s,
  `p2p-pulse` 2.5s, `stage-eq-bar` / `message-search-spin` 0.7s.
- **`linear` is correct for continuous-value fills, and only those.** A meter or
  progress bar tracking a live number must not ease, or the bar lags the value:
  `primitives.css:272` (`.level-meter-fill`, `width 0.08s linear`) and
  `AttachmentTray.css:85` (`width 120ms linear`). Everything else uses
  `var(--ease-out)`.
- **Four shared keyframes live in `primitives.css`** — `fade-in` (:378),
  `scale-in` (:383), `modal-in` (:406), `slide-down` (:691). **Prefer reuse.**
  The comment at `:356` lists every live consumer, re-derived rather than carried
  forward; keep it accurate if you add or remove one. (All six line numbers in
  these two bullets were re-derived at M6 T13; five of the six had drifted.)
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
