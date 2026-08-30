# Redesign M5 — Command Palette: Closeout

**Range:** `f95e5a7..8aa1e75` — 13 commits on `redesign`.
**Executed:** 2026-08-29 → 2026-08-30, via `superpowers:subagent-driven-development`.
**Plan:** `2026-08-25-redesign-m5-palette.md` (Opus grand-reviewed before execution).
**Status: shipped.** Eight tasks · eight task reviews · four task fix rounds · one whole-branch review · one fix wave · one scoped re-review.

> The SDD workspace is gitignored and dies with the session. **This file is the only surviving record** of the rulings, corrections and measurements below.

---

## 1. Headline gates

| Gate | Before (`f95e5a7`) | After (`5592f98`) | Rule |
|---|---|---|---|
| `npm run lint:css` | **196** | **188** | never above 531; only falls |
| `MessageSearch.css` | 8 | **0** | M5-rewritten → must be 0 |
| `CommandPalette.css` | — | **0** | M5-created → must be 0 |
| `primitives.css` | 0 | **0**, absent from the diff | never reopened in M5 |
| `tokens.css` numstat | — | **`4  0`** | additions only; alias block provably untouched |
| `npx tsc --noEmit` | clean | clean | the real ru/en parity gate |
| `npm run check:i18n` | ZERO | **ZERO** | must stay at zero |
| `npm test` | `3 failed \| 149 passed (152)` | `3 failed \| 178 passed (181)` | RED **only** in `api.network-retry.test.ts` |
| `git log redesign..main` | empty | empty | re-verified twice |

**196 → 188 is measured at both ends, not inferred.** Task 8 linted the base tree via `git archive f95e5a7` and reproduced **196** with the identical seven-file decomposition, then re-derived the current **188**:

`tokens.css` 118 · `ChannelSidebar.css` 23 · `UserList.css` 16 · `ServerList.css` 15 · `Auth.css` 10 · `AppPage.css` 4 · `TitleBar.css` 2 = **188**

Both M5-owned CSS files are **absent** from that list. No non-M5 file gained a problem. **Those seven files are M6's** — do not mass-fix them earlier.

**Test-shape ratchet moved twice, legitimately.** 152 → 174 (T2) → 181 (T5). Per-file counts are **19 / 4 / 6** (`paletteFilter.test.ts` / `paletteStore.test.ts` / `searchSnippet.test.ts`), **not** the plan's projected 18 / 6 / 5 — T2's fix commits moved them after planning. Only the total matches. The gate was always stated as invariants, never as a magic number (ruling R10).

---

## 2. Spec §5 M5 clause table — 10 of 10 Landed

Quoting spec §5's M5 bullet:

> **M5 — Command palette** (board `2c`, scope adapted to the APIs). New component + `paletteStore`; `⌘K`/`Ctrl+K` global; groups ordered channels → messages → actions with **explicit scopes labeled in the group headers**… No cross-server fan-out. Full keyboard nav (`↑↓`, `↵`, `esc`); "show all results" row opens the restyled deep-search panel.

| # | Clause | Verdict | Evidence |
|---|---|---|---|
| 1 | New component + `paletteStore` | **Landed** | `CommandPalette.tsx` (295 lines, new); `stores/paletteStore.ts` (35, new); mounted `AppPage.tsx:751-759` |
| 2 | `⌘K`/`Ctrl+K` global | **Landed** | `hooks/usePaletteHotkey.ts:12-21`, installed at `AppPage.tsx:83`. **`e.code === 'KeyK'`, not `e.key`** — the UI is Russian and a Cyrillic layout reports `'л'` for that physical key |
| 3 | Groups ordered channels → messages → actions | **Landed** | `paletteFilter.ts:123-125`; order is not data-dependent; unit-gated |
| 4 | **Explicit scopes labelled in the group headers** | **Landed** | «Каналы — этот сервер» / «Сообщения — в этом канале» / «Действия»; uppercased by CSS (`CommandPalette.css:87`) so translators never hand-shout |
| 5 | Channels = current server, client-side filter | **Landed** | `useServerStore((s) => s.channels)` → `rankByName`; no network call on this path; `CAP_CHANNELS = 6` |
| 6 | Messages = per-channel API, 120ms debounce | **Landed** | `PALETTE_DEBOUNCE_MS = 120`; the deep panel deliberately stays at 300ms — it paginates a committed query while the palette previews one |
| 7 | Actions = global list | **Landed** | Seven actions; `CAP_ACTIONS = 7` is exactly the registry size, so an empty query can never silently truncate one |
| 8 | No cross-server fan-out | **Landed** | Structurally impossible: channels from the single-server store, messages from `currentChannel.id`. No `getServers`/`getChannels` call was added |
| 9 | Full keyboard nav (`↑↓`, `↵`, `esc`) | **Landed** | `moveSelection` wraps, unit-tested; Escape via `useModalFocus`'s stack rather than duplicated locally, so nested-modal ordering stays correct. **Keyboard navigation itself is complete.** ARIA is present but **not a conforming listbox** — see the note below; the clause is about keyboard nav, which landed |
| 10 | "Show all results" opens the restyled deep panel | **Landed** | Row emitted only when `messagesTotal > shown`; hands the query over the command channel; `key={searchSeed.id}` forces a fresh mount per handoff |

**Ten of ten: Landed.** The adaptations in §4 all sit *below* the spec's clause level — board-fidelity details the spec does not itself specify.

> **Precision correction on clause 9's ARIA, from the whole-branch review.** Decision 27 specified combobox + listbox + option, and those roles are all present — but the resulting tree is **not a conforming listbox**: `role="option"` elements sit inside unroled `.palette-group` divs rather than as `listbox` children or inside `role="group"`, and `.palette-group-label`, `.palette-status` and `.palette-empty` are unroled divs inside the listbox. Separately, `aria-expanded={model.rows.length > 0}` reads **false** while the messages group visibly renders «Ищем…» — the same rows-vs-groups confusion the fix wave repaired for the empty state, left in place here because `aria-expanded` on a combobox concerns available *options*, and status rows are not options. **The keyboard behaviour the clause asks for works**; the semantics are approximate. **M6 owns the tree**, alongside the accessible-name gaps it already inherits at the primitives recipes.

### M2 decision 6's two deferrals — both closed with an explicit answer

| Deferral | Answer |
|---|---|
| **The header ⌘K chip** (board `1c`, dark) | **Deliberately not shipped.** The chat header's search button opens the **deep panel** per spec §2, not the palette. A `⌘K` chip on a control that does not open the ⌘K palette is a false label — the exact defect class this project names as its dominant one. The palette advertises its own shortcut where board `2c` puts that copy, in its footer. **Awaiting the human** (§5). |
| **The full `MessageSearch` restyle** | **Shipped in Task 6.** 8 → 0, off the legacy aliases entirely, four inline SVGs → lucide, board `2a` empty state. |

---

## 3. Rulings made during execution

Every ruling states what it costs if wrong. These were recorded in the ledger as they were made.

| # | Ruling | Cost if wrong |
|---|---|---|
| **R1** | **The M5 base is `f95e5a7`, not the plan's `45f9e14`** — the branch carried one further docs-only commit (the RESUME file). | None; the range omits a commit containing no code. |
| **R2** | T5's instruction to add `currentChannel` to a `useMemo` dep list was redundant — it was already there. Add `onShowChat` only. | None. **Correction: my stated reason was false.** I wrote that "`react-hooks/exhaustive-deps` is the check either way" — **this repo has no ESLint at all**: no config at the root or in `client/`, no `lint` script (only `lint:css`), no eslint package in the dependencies. The ruling's *outcome* is right and the code is right; the tooling it invoked does not exist. Caught by the whole-branch reviewer. |
| **R3→R8** | T4's probe must **assert** the `MANAGE_CHANNELS` precondition, with a **named fallback** (`LinkDialog` first, then `StickerManager`/`EditChannelModal`/`ManageInvitesModal`) if the action row is absent. `canManageChannels` has **no owner fallback** — only `MANAGE_SERVER` does — so the phase that is the sole coverage for the DOM half of the ⌘K gate could otherwise vanish silently. | None; coverage preserved either way and the substitution disclosed. *(In the event: the bit was granted, no fallback needed.)* |
| **R4** | Reuse existing smoke messages before creating any; record every message any probe run creates. | Avoidable production residue. |
| **R6** | **Fail-first probes run BEFORE implementation by step reordering, NOT by `git stash`.** The plan told four tasks to implement first and then stash back to a "pre-task" tree — but **plain `git stash` does not stash untracked files**, and T3/T5 create untracked source files that would have survived it and contaminated the baseline. It is also destructive one directory from a 31M one-of-a-kind harness. | None; strictly safer and more faithful to the constraint's own wording. |
| **R7** | Every probe report names **which** assertion fired pre-task and marks everything below it post-task-only. | The closeout would claim fail-first coverage for assertions that only ever ran green. |
| **R9** | Probes mutate persisted state; assert preconditions, never assume them. **Narrowed by measurement:** each `smoke.mjs` run gets a fresh `mkdtemp` Chrome profile deleted in `finally`, so **`localStorage` cannot leak between runs**. **Server state can and does.** | An overstated hazard inherited by M6. |
| **R10** | The test gate is **invariants, not a magic number**: the 3 `FAIL` lines name only `api.network-retry.test.ts`, and the passing count only grows. | A correct task sent into a fix loop for a phantom regression. |
| **R11** | T7/T8 produce no or trivial diffs, so their reviewers target the **report**, not the diff. | A rubber-stamp on the milestone's verification evidence. |
| **R12** | The `from`-index unit test **could not fail** (single-group fixture → `from` always 0). Amended to a multi-group fixture, count held at 18. | Shipping the milestone's subtlest arithmetic behind a gate green by construction. |
| **R13** | Two more plan-mandated tests could not fail — the cap gate (empty query took the early-return path) and the tie-order gate (one item per bucket). Strengthened; **test count allowed to grow past 18**. | Shipping cap and tie-order behaviour with no gate at all. |
| **R14** | Three comment-accuracy findings from T3/T4 reviews carried into T7 rather than run as fix rounds. | Corrections land one task later. |
| **R15** | **The raw-value gate binds comments too, and the plan's own CSS comment violated it.** The brief's verbatim comment carried board hexes; token names substituted. Verified lossless — and *better*, since the hexes would have become false in dark. | The comment no longer quotes raw hexes; they are one lookup away. |
| **R16** | T3's `useModalFocus` adopter enumeration went stale the moment T3 shipped (the palette became a fourth adopter). Fixed in T4's round. | T4's range gains a one-line comment edit. |
| **R17** | **Three probe assertions covering decisions 18 and 21 could not fail.** `mark` carries UA-origin declarations for *both* colour and background, so the transparency check could never fire and the colour-equality check passed even with the declaration deleted. Repaired with a scratch-element token comparison; three break/restore controls. | A closeout claiming measured coverage for two decisions never measured. |
| **R18** | **The residue baseline was reconciled by the controller, not deferred.** The plan's "18 probe messages" is wrong; 43 existed at M4 close. Tasks 1–6 created **zero**. | A fabricated 25-message M5 residue in the closeout. |
| **R19** | The twin dead `object-fit: cover` in `MessageSearch.css` is fixed too, despite being outside T7's file list. | T7's commit touches a second file. |
| **R20** | **`probe-shell.js` and `probe-sidebar.js` have ZERO assertions.** The plan cited all three inherited probes as regression gates and was wrong about two. The cross-surface claim rests only on `probe-modal-sweep.js` and `probe-chat.js`. | Claiming coverage from probes that cannot fail. |
| **R21** | **`probe-chat.js` creates residue** — two messages per run, no cleanup. T7 ran it, so T7 created residue. Count it; do not delete. | A few messages attributed to the wrong milestone. |
| **R22** | T7's own new comment over-claimed a width↔touch coincidence the CSS does not enforce — the same species as the defect it had just fixed. Reworded; the decision itself stands. | One more documentation round. |
| **R23** | **T8 delivers closeout material; the controller writes the closeout.** The plan told T8 both to produce no commit and to draft a tracked file. | The closeout is written by the agent holding full milestone context — the right way round. |
| **R24** | **There is NO stroke deviation.** The handoff (`README.md:19`) specifies **"1.8–1.9px stroke"** — a **range**, not the single 1.9 that decision 20 argued against. The plan, my dispatches and Task 8 all held the same misreading. **This removes a disclosure rather than adding one**; M6 must not inherit decision 20 as a live deviation. | M6 re-opens a settled non-question. |
| **R25** | **The z-index summary was wrong a fifth time — in this file's own first draft.** Twelve declarations across seven distinct values, not "thirteen"/"eleven"; the thirteenth grep hit is a *comment*. Caught by the Task 8 reviewer before publication. **The entry-by-entry table was re-derived correctly three times; only the counts around it kept drifting.** | None now — the table content was verified entry-for-entry against an independent census. |
| **R26** | **The whole-branch fix wave ships five seam defects fixed, not deferred** (below). Four were invisible in any single task diff. | A milestone shipping a live modal-gate hole and a wrong-row-activates bug. |
| **R27** | **The no-test justification for fix-wave items 2 and 3 is PARKED, not fixed** (below) — there is no second fix wave. | M6 inherits a test-coverage gap and one existing test asserting a universal its module does not hold. |
| **R28** | **The SDD workspace is NOT deleted at close**, against the skill's default. `.superpowers/sdd/2026-08-25-redesign-m5-palette/tools/` is the **31M gitignored CDP harness and the only copy in existence**; M6 carries it forward with `cp -R`. Deleting it would destroy the instrument behind every visual claim in M5 and M6. Everything else in the workspace is transcribed into this file. | A stale workspace survives on disk; the alternative is an unrecoverable loss. |

---

## 3a. The whole-branch review and the fix wave

Every task in the range had already passed its own scoped review. The whole-branch seat then found **four defects that no per-task reviewer could have seen**, each living in the seam between two tasks or in unchanged code whose meaning changed when something around it moved. This is the fourth milestone running that this seat has paid for itself.

**All five items were fixed in a single wave (`8aa1e75`) and verified gone by a scoped re-review that executed the real `buildPalette` rather than reasoning from the report.**

| # | Defect | Seam | Fix |
|---|---|---|---|
| 1 | **`isBlockingOverlayOpen()` missed `.screen-picker-backdrop`** — a reachable, blocking, fixed-inset scrim on both platforms. ⌘K opened over it; Escape cancelled the user's screen-share pick. | Decision 8's DOM half vs. a surface M5 never touched | Selector widened to `'.modal-overlay, .screen-picker-backdrop'`; doc comment updated |
| 2 | **The palette rendered «Ничего не найдено» *simultaneously* with «Ищем…»** — and with an API error, contradicting itself until the query changed. | T3 wrote the guard when `rows.length === 0` really meant "nothing"; T5 introduced non-selectable status rows into a group | Guard on `model.groups.length === 0` |
| 3 | **An async message result silently reset the keyboard selection to row 0**, so **Enter activated the wrong row** — message rows splice in *between* channels and actions. | T3's reset was written against a synchronous model; T5 made the model async | Selection tracked by **row id**, not flat index; index clamping was explicitly rejected because the insertion is in the middle |
| 4 | **`MessageSearch` flashed the board-`2a` empty card on every palette handoff** — M5 turned a mid-typing flicker into the panel's opening frame | T5 deferred it; the handoff path is M5's headline feature | `loading` initialised from `initialQuery` |
| 5 | **`group.from + i` is a live trap** — `i` counts status rows, `from` counts only selectable ones; correct today *only* because no group mixes them | latent | One comment naming the precondition |

**Measured proof of fix 3**, from the re-review's execution of the real module: selecting `action-a` at index 1, then splicing in two message rows plus a show-all, moves it to index 3 — *"old index-tracking would activate `message-m1`; new id-tracking activates `action-a`"*. Stale-id fallback returns 0, never nothing. No dangling `aria-activedescendant` is reachable; `moveSelection` remains the sole wrap authority; hover and `scrollIntoView` intact.

**Parked residual (R27) — carried to M6, not fixed.** The wave added no unit test for fixes 2 and 3. The implementer's reason — the project runs vitest with `environment: 'node'`, has no jsdom/RTL and zero `.test.tsx` files — **is factually true and was verified**, but the re-reviewer showed it is *insufficient*: `moveSelection` is already pure selection-index arithmetic living in `paletteFilter.ts` with its own unit tests, so `selectedIndexOf(rows, selectedId)` and a `shouldShowEmptyState(model, query)` predicate are the module's own established pattern, not a reviewer's contrivance. It further demonstrated that **a one-word fixture change to the existing `paletteFilter.test.ts:117-129` goes RED today** (`messagesLoading: true` → `groups=3 rows=2`, invariant fails). Parked because the process allows exactly one fix wave. **This is the fifth M4/M5 instance of "X could not be tested because Y" where Y was true but a cheap measurement existed** — the pattern, not any single case, is the finding.

**Related, and now recorded rather than latent:** `paletteFilter.test.ts:117-129` asserts that `model.rows[group.from + i] === row` for *every* group and row — **a universal its own module does not satisfy** for status-bearing groups. It passes only because the fixture never builds one. It predates this wave.

**One severity downgrade worth carrying:** fix 3 reduced the residual risk of the fix-5 trap. Activation now reads `model.rows[selectedIndex]` from an id lookup, independent of `group.from + i`; only the *highlight* still uses the positional arithmetic. So a future violation of the precondition highlights the wrong row rather than firing the wrong action.

---

## 4. Adaptations and accepted defects

### Board-fidelity adaptations

1. **Board `2c`'s per-row server name is dropped** — the client holds one server's channels, so the column would print the same string on every row. Unreachable, not skipped. *(Awaiting the human.)*
2. **~~Icon strokes are 1.8 against the board's 1.9.~~ There is no stroke deviation — this "adaptation" was a misreading, held by the plan, by me, and by Task 8 alike.** The handoff (`README.md:19`) specifies **"1.8–1.9px stroke, 16–21px box"** — a **range**, not the single value 1.9 that decision 20 argued against. 1.8 sits inside it, so nothing was adapted and there is nothing to disclose. The measurement stands and is worth keeping: **145 of 145** `strokeWidth` occurrences across 29 `.tsx` files are 1.8, with zero other values anywhere on the branch. **This removes a disclosure rather than adding one** — M6 should not inherit decision 20 as a live deviation.
3. **Board `2a`'s suggestion chips are not shipped** — there is no query history, no trending endpoint, no saved-search store. The chips would be hardcoded strings.
4. **Board `2c`'s footer copy is not shipped below 640px.** All three hints wrapped at 390px (35.5px box against a 17.25px line-height), and «Открывается на ⌘K из любого места» is **false** on a touch device, not merely cramped. `.palette-hint-end` is hidden inside the **existing** `(width <= 640px)` block; no new breakpoint.
5. **The handoff contradicts itself, and the root cause is its own token table.** `README.md:145` calls the palette footer `canvas-2`; `Redesign.dc.html:118` gives `#FBFCFE`, which is `--canvas-3`. **`README.md:46` maps `canvas-2` onto two hexes**, the second being `--canvas-3`'s. The shipped code follows the hex (`CommandPalette.css:204`). Recorded so nobody "fixes" it back.
6. **Icon-size deviations** — these *are* real, because the 16–21 box band is the board's. All three follow the M3/M4 disclosed-deviation precedent: `X size={14}` (`MessageSearch.tsx:117`, below the band), `Search size={22}` (`:133`, above), and `SearchX size={22}` (`:147`, above, and **pre-existing** — verified unchanged at `git show f95e5a7:client/src/components/MessageSearch.tsx:171`). A branch-wide census puts them in ordinary company — sizes in use are 10, 12, 13, 14, 15, 16, 17, 18, **19**, 20, 21, 22, 28.

### Accepted defects, disclosed not fixed

7. **Decision 29 — the call stage's fullscreen has TWO distinct dead ends, not one. Both are accepted; M6 owns them.**

   **(a) The CSS variant, which decision 29 named.** `AppPage.css:67-72` sets `display: none` on `.chat-area` when the stage is fullscreen, so a palette `chat-search`/`chat-jump` command lands hidden. `onShowChat()` cannot help — it sets `mobilePanel`, which is not what hides the column here. Ruled accepted: reaching into M3's fullscreen state machine for a state the user entered deliberately is out of scope. **No probe claims otherwise** — verified.

   **(b) The Fullscreen-API variant, which the whole-branch review found and decision 29 missed — and it is the more visible of the two.** `CallStage.tsx:75-78` calls `container.requestFullscreen()` on `.call-stage`, promoting it to the **top layer**. `CommandPalette` mounts as a sibling of `.app-layout` (`AppPage.tsx:751`), so it is **not a descendant of the fullscreen element and paints behind the backdrop — invisible** — while still mounting, trapping focus, and flipping `isBlockingOverlayOpen()` true, which then blocks ⌘K from reopening it and kills Ctrl+Shift+F. So the palette is not merely ineffective; it is an invisible focus trap.

   **The codebase already knows this mechanism and already solves it elsewhere**: `CallStage.tsx:106-110` documents that the top layer shows only the fullscreen element and its descendants, and re-parents the quality tooltip into `document.fullscreenElement` on every hover to dodge exactly this. **The same solution generalises** — portal the palette into `document.fullscreenElement ?? document.body`, recomputing on `fullscreenchange`. Not done in M5: it is a structural change to the mount architecture, in M3's state machine, whose Electron half is reasoned-not-measured.

   **This — not (a) — is the M5 behaviour a user is most likely to hit and read as a bug.**
8. **Decision 25 — backlog contact, not fix.** The palette is a new caller of `handleSelectChannel` and inherits backlog §1c. M5 introduces neither the path nor the bug.
9. **Decision 8 — `isBlockingOverlayOpen()`'s DOM half is load-bearing, and the invariant it rests on was ALREADY BROKEN when M5's tasks finished.** The stack knows only its four adopters (`ConfirmModal`, `FindServerModal`, `Settings`, `CommandPalette`); the other eight modals are not adopters, so a stack-only gate would open the palette over them — including `CreateChannelModal`, which the palette itself opens.

   **The whole-branch review found the hole was not hypothetical.** `ScreenSourcePicker` and `ScreenQualityPicker` render **`.screen-picker-backdrop`** (`ScreenSharePicker.tsx:31,95`) — a `position: fixed; inset: 0` scrim with `backdrop-filter`, which its own file calls a system modal surface — carrying **neither** `.modal-overlay` **nor** `useModalFocus`. Reachable on both platforms (`CallStage.tsx:751` on the *non-Electron* branch for every screen-share start, `:758` after the Electron source pick). While open, ⌘K opened the palette over it, Ctrl+Shift+F toggled the panel behind it, and one Escape fired **both** the picker's own listeners (`ScreenSharePicker.tsx:24`, `:88` — cancelling the screen-share flow) and the palette's, so the user lost the pick they were making. **An earlier draft of this closeout asserted the invariant was "true at M5". That was false**, and the same document's z-index table named the offending selector two sections later.

   **Fixed in the fix wave**: the gate is now `document.querySelector('.modal-overlay, .screen-picker-backdrop')`. The re-reviewer confirmed the class appears at exactly two sites, both mounted only under a truthy guard inside a component that returns `null` when not in a group call, and that `ScreenSharePicker.css:12` has an enter-only animation with no exit transition — so no node lingers past unmount and the gate cannot jam permanently.

   **The invariant remains a convention, not a contract.** Any future fixed-inset scrim that rolls its own class reopens the hole silently. M6's `useModalFocus` adoption sweep should either make adoption the only source of truth (deleting the DOM half) or add a check that every such scrim carries `.modal-overlay`.

### The corrected z-index map

**Wrong in four separate places across this milestone.** Every entry below re-measured:

| Selector | z-index | File:line |
|---|---|---|
| `.modal-overlay` | 1000 | `primitives.css:342` |
| `.context-menu` | 1050 | `primitives.css:637` |
| **`.screen-picker-backdrop`** | 1100 | `ScreenSharePicker.css:5` |
| `.volume-popover` | 1100 | `VolumeControlPopover.css:14` |
| `.palette-overlay` | **1150** | `CommandPalette.css:15` |
| `.stage-tip` | 1200 | `CallStage.css:477` |

**`.screen-share-picker` does not exist anywhere in the codebase.** The M5 plan's decision 10 and the RESUME file both name it; both are wrong. The number 1100 was right; the selector was not.

**The five-entry map is a slice, not a census.** A full scan of `z-index >= 1000` across 38 CSS files returns **twelve declarations across seven distinct values** — additionally `CallUI.css:11` 1000, `FloatingQuoteButton.css:6` 1000, `CallNotifBanner.css:15` 2000, `primitives.css:729` 2000 (`.error-toast`), `ErrorBoundary.css:12` 9999, `UpdateBanner.css:19` 9999. Distinct values: 1000×3, 1050, 1100×2, 1150, 1200, 2000×2, 9999×2. **A thirteenth raw grep hit is not a declaration** — it is the comment at `AvatarCropModal.css:17` recording a since-removed `z-index: 2100`. The palette at 1150 sits **below** two 2000s and two 9999s — almost certainly correct, but never stated.

> **This map has now been wrong in FIVE places**, and the fifth was in an earlier draft of this very file: the plan's decision 10 and the RESUME file (wrong class name), one shipped CSS comment (fixed in T7), one controller dispatch (line number off by one), and this closeout's own first draft ("thirteen declarations", "eleven distinct integers"), caught by the Task 8 reviewer before publication. **The entry-by-entry table above is correct and was re-derived independently three times; the counts around it were the part that kept drifting.** That asymmetry — a correct table wrapped in a wrong summary — is worth remembering.

---

## 5. Awaiting the human

| # | Question |
|---|---|
| 1 | **The header search button keeps opening the deep panel**, so board `1c`'s dark-theme ⌘K chip is **not** shipped on it. If the board owner wants that button to become the palette entry, it is a two-line JSX + CSS change. |
| 2 | **Board `2c`'s per-row server name is dropped** as unreachable. |
| 3 | **Board `2c`'s footer copy is hidden below 640px** — the ⌘K hint is false on touch. |

---

## 6. Deferred findings, triaged by owner

### M6

- **`--hl-ink` is a no-op in light theme** — byte-identical to `--ink` (both `#101322`, `tokens.css:16` vs `:45`), so `mark { color: var(--hl-ink) }` does nothing in light and reads as an intentional value when it is not. **And the `--hl-*` dark values are interpolations, not board values.** Both ends of the pair want revisiting in the dark-parity pass.
- **The z-index tier wants a decision**: eleven distinct hand-picked integers, or a named token scale.
- **`@keyframes message-search-spin`** is an infinite loop — a `prefers-reduced-motion` target. The palette adds no loops.
- **`MessageSearch.css` is off the legacy aliases**, so M6's alias sweep loses a **third** file (after `ErrorBoundary.css` and `UpdateBanner.css`).
- **The five non-stack-aware document Escape listeners** (`ContextMenu.tsx:35`, `VolumeControlPopover.tsx:57`, `ScreenSharePicker.tsx:24` **and** `:88`, `useFloatingSelectionToolbar.ts:67`) remain M6's if it takes app-wide `useModalFocus` adoption.
- **Both fullscreen dead ends** (§4.7) — and (b), the Fullscreen-API top-layer variant, is the more visible. The fix generalises the tooltip's existing solution: portal the palette into `document.fullscreenElement ?? document.body`, recomputing on `fullscreenchange`.
- **Make the overlay contract explicit rather than discovered** (§4.9). "Is a blocking overlay open" is currently inferred from a class name that is convention, not contract, and it silently degrades whenever someone writes a new backdrop. M6's `useModalFocus` sweep should either make adoption the only source of truth (deleting the DOM half) or add a check that every `position: fixed; inset: 0` scrim carries `.modal-overlay`.
- **The palette's ARIA tree** (§2's precision note) — `role="option"` inside unroled group divs; `aria-expanded` computed from `rows` while status rows render.
- **The parked test residual** (R27) — `selectedIndexOf` and `shouldShowEmptyState` are natural pure extractions into `paletteFilter.ts`; and `paletteFilter.test.ts:117-129` asserts a universal its module does not satisfy for status-bearing groups.
- **`Ctrl+K` is `preventDefault`ed before the gate, unconditionally** (`usePaletteHotkey.ts:16-17`). The rationale is sound — a suppressed ⌘K must not fall through to the browser omnibox — but the consequence is that Ctrl+K is swallowed inside every text field app-wide, including the composer, where on macOS it is the system "kill to end of line" binding. Largely inherent to decision 8's choice of chord rather than a defect, but M6 should decide deliberately. A cheap mitigation exists: skip `preventDefault` when the target is editable *and* the gate will suppress the open anyway.
- **Three predicates now describe "is there content"** in `CommandPalette.tsx` — `model.groups.length` for the empty state, `model.rows.length` for `aria-expanded` and for `aria-activedescendant`. Defensible, now load-bearing, and undocumented. If the flat/grouped split survives, name the invariant on the type: `rows` = selectable only, `groups` = everything rendered.
- A seeded `MessageSearch` mount can paint the "nothing found" empty state for one frame — `loading` is set inside the effect (post-commit) while the render branch picks the empty tile. The same transient already exists when a user types the second character manually; M5 makes it the panel's opening frame. A `useState(initialQuery.trim().length >= MIN_QUERY_LEN)` initialiser closes it. **Reasoned, not measured.**

### Harness debt

- **`probe-chat.js` writes two messages per run and never cleans up**, unlike `probe-modal-sweep.js`. 30 messages across 15 runs — **65% of all probe residue on the branch**. Point it at a disposable channel or give it a cleanup pass.
- **`probe-shell.js` and `probe-sidebar.js` have zero assertions** yet were cited as regression gates. A regression would print and pass.
- **`probe-callstate.js` and `probe-confirm-modal.js`: 0 `throw`, 0 `fail(`** — verified, ban confirmed.
- **`probe-t11-flow.js:51`'s `toastPresent` can only return `false`** — it queries `.chat-error-toast`, deleted in favour of the shared `.error-toast` (`ChatArea.css:315-317` records the deletion).
- **`probe-t5fix-handoff-focus.js:35` contains `|| true`** — honest in its labelling, but not evidence.
- **`probe-palette-board.js:261-266`'s `heightMatchesOneRow` is an identity** — `.palette-footer` is `display: flex` with no wrap and no `min-height`, so its auto height *is* tallest-item + padding + border by construction. `wrapped` is the real gate, and it did fire.
- A unit test detects the `splitMatches` guard regression **by hanging, not by failing** — a synchronous infinite loop cannot be interrupted by vitest's timeout. It still cannot *pass* without the guard, so it is real coverage; recorded so a stalled run is recognised.

### Docs corrections

- The **RESUME file still names `.screen-share-picker`** and still carries the stale residue baseline. Both fixed in this closeout; the RESUME update accompanies it.
- **The M4 closeout's "18 probe messages" is wrong by 25.** Carry the corrected figure **and its mechanism**, or M6 will re-derive it a third time.
- **`last_channel_id`'s last writer is T7, not T5** — the value (`general`) is right, the attribution was not.

---

## 7. Reasoned, not measured

1. **Every Electron branch** — and here Y is *measured*, not asserted: `client/node_modules/electron/dist` is **236K** (not the 292K in inherited prose), containing **two files**; `path.txt` is **absent**, so `npx electron` cannot resolve a path at all; and the stub binary aborts in `dyld` before `main` (exit 134, `Library not loaded: @rpath/Electron Framework.framework`). Unlaunchable, established two independent ways. Declared version 41.2.0.
2. **Icon identity** — probes assert "a lucide of size N at stroke 1.8", never *which* icon. A `Plus` swapped for a `Minus` would pass every probe. Closed by the static diff.
3. **The `--hl-*` dark values** — interpolations; no board source exists.
4. **Assertions that run only post-task.** Every probe terminates at its first discriminator, so everything below was never exercised against broken code. Discriminators: T3 `⌘K did not open .palette-dialog` · T4 `no action row matched "настрой"` · T5 `no message rows for a seeded query` · T6 `panel still carries the raw legacy shadow` · T7 the 390px `wrapped` check. T1/T2 ran no assertions by design.
5. **The cross-surface no-regression claim is narrower than the plan stated.** The defensible claim: *`probe-modal-sweep.js` and `probe-chat.js` both PASS, with 171 throwing assertions between them and `continuation.count: 37` proving the conditional block genuinely ran.* That is real and sufficient — but it is not "the whole app was regression-tested".
6. **Only one of Task 7's ~60 board assertions is a proven gate** — the 390px `wrapped` check, which fired pre-fix. For the rest, "a deleted declaration falls through to the UA default and the assertion notices" is reasoned. **"Board 2c OK ×4" must not be read as sixty proven gates.**
7. **None of the five fix-wave changes was re-probed.** They are verified by reading, by an independent re-review that executed the real `buildPalette` against constructed models, and by `tsc` / stylelint / `npm test` / `check:i18n` — but **no CDP probe was run after `8aa1e75`.** That matters most for fix 1: the gate it repairs (`isBlockingOverlayOpen()`) is exactly what `probe-palette-actions.js` exists to exercise, and that probe was deliberately not re-run because it would have written smoke-server residue into the count §9 had just finished measuring. **So "all gates pass" covers types, lint and units — not browser behaviour — for the fix wave.** The first M6 probe run should exercise ⌘K against an open `.screen-picker-backdrop`, which closes this in one assertion.

### Measured this milestone — do NOT list these as reasoned

- **UA `mark` is `rgb(0,0,0)` on `rgb(255,255,0)` in BOTH light and `color-scheme: dark`** (Chrome 150.0.7871.186). Chrome does not substitute the `Mark`/`MarkText` system colours. This is *why* the original colour assertions could not fail in any theme.
- **`localStorage` cannot leak between probe runs** — fresh `mkdtemp` profile per invocation, removed in `finally` (`smoke.mjs:422`). **Server state can and does.**
- **`--border-color` aliases to `--line-strong`** (`tokens.css:204`), not black — so any `=== 'rgb(0, 0, 0)'` colour check is close to un-failable. Smoke, not evidence.
- **145/145 stroke consistency** — a full branch census.
- **The stylelint baseline at both ends** — `git archive` + lint, not arithmetic.
- **Every residue figure** — REST API, with the message dump and the server's own search `.total` cross-checked and agreeing on every cell.

---

## 8. Harness notes and new mechanics

**These override older prose.**

- **`smoke.mjs` REQUIRES `--out` and hard-exits 2 without one.** Every probe-only command the M5 plan prints (`node smoke.mjs --probe X --wait 4000`) is therefore **invalid as written**. Supply a throwaway `--out` path.
- **A failing probe does NOT make `smoke.mjs` exit non-zero** — `smoke.mjs:403` catches the throw, prints `PROBE ERROR:` and exits 0. **Evidence is the printed output, never the exit code.**
- **Each invocation creates a fresh `mkdtemp` Chrome profile and deletes it in `finally`** (`smoke.mjs:422`), so `localStorage` cannot cross runs.
- **⌘K cannot be driven by `--click`** — dispatch a `KeyboardEvent` with `code: 'KeyK'`, `metaKey: true`.
- **`--type-into` dispatches `Enter` after typing** — right for the deep panel, **wrong for the palette**, where Enter activates the selected row.
- **The app opens on the smoke user's persisted `last_channel_id`, not `#general`.** Navigate explicitly.
- **Assertion counts, verified by direct count:** `probe-modal-sweep.js` 3 `throw` / 136 `fail(` · `probe-chat.js` 2 / 35 · `probe-palette-board.js` 1 / 19 · `probe-palette-shell.js` 1 / 24 · `probe-palette-actions.js` 1 / 19 · `probe-palette-messages.js` 1 / 17 · `probe-palette-messages2.js` 1 / 18 · **`probe-shell.js` 0 / 0** · **`probe-sidebar.js` 0 / 0**.
- **The working pattern for asserting a token is live** is a **scratch element** — create it, set `background: var(--X)`, append so it computes, read the *computed* value, compare, remove. **Never** `getComputedStyle(documentElement).getPropertyValue('--X')`: that returns the *declared* value regardless of whether any rule consumes it, and returns hex against an `rgb()`, so the comparison is always-true.

---

## 9. Smoke-server state at M5 close

**Method — recorded so it survives, because the audit script did not.** A read-only Node script against `https://api.vycord.webvaha.ru` with `Origin: http://localhost:3000`. **The login `POST /api/v1/auth/login` is the only non-GET call**; everything else is a `GET`, and nothing was created, modified or deleted. Endpoint paths were taken from `client/src/services/api.ts` rather than guessed: `/api/v1/auth/me` (`:326`), `/api/v1/servers` (`:362`), `/api/v1/servers/{id}/channels` (`:470`), `/members` (`:474`), `/invites` (`:491`), `/stickers` (`:553`), `/api/v1/channels/{id}/messages?limit&offset` (`:524`), `/messages/search?q&limit&offset` (`:528`).

**Message counts were taken two independent ways** — a full paginated `getMessages` dump counted locally with a regex, *and* the server's own search `.total` — because M4 nearly produced a false "smoke server destroyed" conclusion by inferring from the DOM. **The two methods agree on every cell**, so no hyphen-tokenisation discrepancy exists. The whole audit was then re-run independently by the Task 8 reviewer, which reproduced every figure exactly.

| Item | M4's record | Measured at M5 close |
|---|---|---|
| Servers | 1 | **1** — «Redesign Smoke» |
| Channels | 3 | **3** — `general`, `second-smoke`, `t9-empty-channel` |
| Invites | 2 pre-existing | **2**, both `uses=0`, both dated 2026-08-25 |
| Stickers | 1 (`t8seed68113`) | **1**, `t8seed68113` |
| Probe messages in `#general` | **18** | **45** of 83 total — **M4's record is wrong by 25** |

**M5's total residue: exactly 2 messages**, both written by `probe-chat.js` during Task 7, timestamp-partitioned against the commit timeline. Tasks 1–6 created zero — confirmed by measurement, not only by the per-task record: the gap between `2026-08-28T17:29:58Z` and `2026-08-29T22:39:26Z` contains no probe message at all, and T1–T6's window sits entirely inside it.

**The 25-message gap is explained**: 28 of the 43 pre-M5 probe messages are `probe-a-`/`probe-b-` pairs from `probe-chat.js`, which alone more than covers it. No invite, channel, server or sticker leaked; `#t9-empty-channel` is still empty, so M4's empty-state fixture is intact.

**`#general` is now 54% probe noise (45 of 83) and drifting** by two per `probe-chat.js` run. Any future probe asserting on message counts or scroll position there is working against a moving fixture.

---

## 10. Process notes

1. **Every implementer pushed back at least once, and every one of those catches was real.** T2's found a plan-mandated unit test that could not fail. T3's found that `smoke.mjs` requires `--out`. T4's found the plan's own CSS comment violating the plan's own raw-value gate. T5's found the app opening on a persisted channel and the mark-colour assertion being theme-dependent. T6's found that a probe I claimed existed did not. T7's found two inherited probes with zero assertions, a twin dead declaration, and a wrong line number in my dispatch. T8's corrected four inherited numbers. **This was worth more than any single review.**
2. **Two of my own dispatches carried false claims**, both caught by implementers: I asserted a `mark` assertion existed in T6's brief when it did not, and gave a z-index line number off by one. Both are recorded above rather than quietly fixed. *The dominant defect class is not code — it is false claims about code, and the controller is not exempt.*
3. **"A probe is evidence only once it has been shown to fail against the broken version"** earned its place three more times this milestone: R12, R13 and R17 each repaired a gate that was green by construction, and R20 found two that could never have been gates at all. **Five instances in one milestone.**
4. **The break/restore counterfactual is the strongest available control** and it is cheap: temporarily delete the declaration, capture the `PROBE ERROR:`, restore, prove with `git diff --stat`. Used six times; never committed broken.
5. **A reviewer that measures beats a reviewer that reasons.** The T5 reviewer disproved an implementer's counterfactual by running headless Chrome to measure UA `mark` defaults. That single measurement invalidated three assertions across two tasks.
6. **The whole-branch seat and the report-targeted review seat are different jobs.** T7 and T8 produce little or no diff; reviewing their *diffs* would have rubber-stamped the milestone's entire verification story.
7. **The whole-branch seat paid for itself a fourth consecutive time, and every one of its four findings was a seam.** Two were *unchanged code whose meaning changed when something around it moved* (the empty-state guard and the selection reset, both written by T3 against a synchronous model that T5 made async); one was *a surface the milestone never touched* (`.screen-picker-backdrop`, which quietly falsified decision 8's central invariant); one was *the new mount point's own hazard* (the palette painting behind the fullscreen top layer). **None was visible in any single task diff, and all eight task reviews had already passed.**
8. **The generalisable question behind finding 4:** when a component moves to a new mount point, ask what its *old* ancestors were doing to it — and then ask the same of the new position. The lift in T4 was right precisely because someone measured `.channel-sidebar { display: none }`. Nobody asked the mirror question about `AppPage`'s root, and that is exactly where the fullscreen defect lived.
9. **"X could not be tested because Y" is now a five-instance pattern across M4 and M5**, and in every one Y was true-but-insufficient or simply false, with a cheap measurement available. The M5 residual (R27) is the clearest case yet: the reasoning was factually verified *and* a one-word change to an existing fixture would have gone RED. **Treat the phrasing itself as the smell**, independent of whether the specific Y checks out.
10. **The controller is not exempt from the dominant defect class.** Three of my own artifacts carried false claims that implementers or reviewers caught: a probe I said existed and did not, a z-index line number off by one, and a lint rule (`react-hooks/exhaustive-deps`) this repo does not have. All three are recorded above rather than quietly corrected.
