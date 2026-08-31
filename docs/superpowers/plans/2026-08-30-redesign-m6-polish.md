# Redesign M6 — Polish & Closure: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final milestone of the vycord frontend redesign — dark-theme parity, the
responsive band system, reduced-motion policy, accessible names, the class-name migration and the
deletion of the legacy token alias block — leaving `redesign` releasable as a single version with
`lint:css` at **0**.

**Architecture:** Fifteen tasks in dependency order. Task 1 builds the instruments (a
computed-colour probe whose baseline is committed outside the gitignored workspace, plus the harness
repairs the later tasks depend on). Task 2 is a single repo-wide `stylelint --fix` that resolves 71%
of the lint debt mechanically under the colour probe's guard. Tasks 3–12 are the design work. Task
13 deletes the alias block, which **is** the spec's §8 audit. Tasks 14–15 are visual QA and closeout.

**Tech Stack:** React 19 · Vite 8 · Zustand 5 · TypeScript · plain per-component CSS · `lucide-react`
· stylelint 16 (+ `@csstools/stylelint-plugin`) · Vitest · a CDP screenshot/probe harness
(`smoke.mjs`) run against Chrome.

**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` — §5's **M6** bullet is the
clause list. §9 is the 2026-08-30 amendment and **supersedes §8's rebase-on-`main` instruction**
(9.1), the reading of §2/§7 for the six arriving attachment surfaces (9.2), the scope wall's meaning
under a merge (9.3), and the raw-value audit gate's scope (9.4).

**Inherited context, binding:** `REDESIGN-RESUME.md` (§7 is M6's brief) · `CLAUDE.md` (repo root) and
`client/CLAUDE.md` (the design-system contract) · `plans/2026-08-30-redesign-m5.5-closeout.md` ·
`plans/2026-08-25-redesign-m5-closeout.md` · `backlog/post-redesign-backlog.md` (**excluded scope** —
nothing in its §1 may be planned or fixed here).

---

## Provenance of this plan's numbers

Every figure below was **re-measured on 2026-08-30 against `redesign` at `dc0a873`**, comments
stripped, unless the line says otherwise. The full measurement ledger — including the eight
corrections this plan makes to the durable record — is reproduced in **Appendix A**. Where this plan
and any inherited document disagree on a number, **this plan was measured later**; re-run the command
before believing either (RESUME §8.1).

**Drift gate at plan time:** `git fetch --all --prune && git log redesign..origin/develop` → **empty**
(the fetch ran; it is part of the gate, not a precondition). `redesign` `dc0a873` ·
`origin/redesign` `2dc4974` · `origin/develop` `a328a11` · `origin/main` `d17bddd`.

---

## Global Constraints

Copied forward from RESUME §3. Every task's requirements implicitly include this section.
**The alias-deletion exception is flipped ON for this milestone** — see the last bullet.

- Branch **`redesign` only**; **one commit per task**; never commit to `main`; **never `git add -A`**
  (`design_handoff_discord_redesign/` is untracked on purpose and is *not* in `.gitignore`).
- **Never rebase `redesign`** — it is published at `origin/redesign`. Integrate trunk by **merging**
  `origin/develop` (spec §9.1).
- **No changes under `server/`.** No API or WebSocket contract changes. **No changes to
  `client/src/services/`**; `client/src/types/index.ts` untouched; `client/e2e/` untouched. Per spec
  §9.3 this means *no redesign-authored changes*; trunk changes arriving via a merge are not
  violations.
- All work under `client/`. Product copy is Russian; **every new string lands in `i18n/locales/ru.ts`
  and `en.ts` together**. `npx tsc --noEmit` is the **real** parity gate (`en` is typed against `ru`'s
  `Dictionary`). Plurals render through `tp()`/`useTp()` — `t()` renders the literal key for a plural
  entry.
- **Icons:** `lucide-react` only (zero hand-inlined `<svg>` in `src/`); `strokeWidth={1.8}` on every
  icon; an explicit `size={N}` on every icon. **There is no size band** — 13 distinct sizes from 10 to
  28 exist and 57 of 162 tags sit outside 16–21. Match the neighbouring icon in the same surface; do
  **not** "record a deviation".
- **Class names:** multi-segment kebab-case with a component prefix; state modifiers `is-*`/`has-*`;
  **never** BEM `--`/`__`. The single-segment allowlist is exactly `btn|input|kbd|modal|mention`.
- **Any class rename must sweep `.superpowers/sdd/<milestone>/tools/*.js`.** The harness is gitignored
  and ungated: a rename that leaves a stale selector produces no error and no failing test — the probe
  just stops being able to fail.
- **Search the harness with `rg --no-ignore --hidden`, or with `grep`. Never with a bare `rg`.**
  `.superpowers/` is gitignored and ripgrep honours `.gitignore` by default, so a plain `rg` **returns
  nothing and reports a false zero** — which is indistinguishable from a real zero. `--hidden` alone
  does not defeat it, and neither does passing the directory as an explicit path. This plan shipped a
  false "zero alias references in the harness" from exactly this (Appendix A, C9).
- **Pair every negative precondition with a positive one** wherever the state is achievable — assert
  present → act → assert absent. A bare `!document.querySelector('.x')` goes permanently true the
  moment `.x` is renamed.
- New CSS uses media-query **range syntax** (`(width <= 768px)`). iOS Safari <16.4 is an **accepted
  cost** (human ruling, decision 3).
- **Animation budget ≤250ms `var(--ease-out)`.** Shared keyframes are `fade-in`, `scale-in`,
  `modal-in`, `slide-down` in `primitives.css`. Prefer reuse. `linear` is correct **only** for
  continuous-value fills (`.level-meter-fill`, upload progress).
- **Fail-first probes are mandatory.** Every probe is run against the pre-task state and must fail
  loudly there before its pass is trusted. **Before citing any probe, check that it can fail.**
- **Stylelint runs from `client/`, never the repo root** — `importFrom` is cwd-relative and a root run
  crashes with `ENOENT` **in a way that looks like output**. `--formatter json` writes to **stderr**;
  pipe with `2>&1`, never `2>/dev/null`.
- **`npm test` is RED at baseline by design** — exactly 3 tests in
  `src/services/__tests__/api.network-retry.test.ts` plus 2 unhandled rejections from the same file.
  **Never "fix" that file.** The gate is that **no other file appears in a `FAIL` line**.
- ~~**Legacy token aliases stay until M6; `tokens.css` changes are additions only (`+N / −0`).**~~
  **RETIRED BY THIS MILESTONE — decision 4.** M6 deletes the alias block, and task 2's `--fix` edits
  20 lint errors *inside* it. The replacement invariant is the **alias sentinel** (decision 4).

---

## Numbered binding decisions

Each states **what it costs if wrong**.

- **Decisions 1–4** — inherited human rulings from the 2026-08-30 M6 *design* session (RESUME §7.1).
- **Decisions 5–8** — human rulings from the 2026-08-30 M6 *planning* session.
- **Decisions 22–25** — human rulings from the same session, taken **after the grand review** surfaced
  four questions the plan had answered by accident, by silence, or by deferring into execution.
- **Decisions 9–21** — **planner calls.** These may be overturned by an implementer **with a
  measurement**.

**Do not re-litigate 1–8 or 22–25.**

### Human rulings — inherited (RESUME §7.1)

**1. Lint goes to 0, including the 43 `selector-class-pattern` renames.**
Distribution re-verified 2026-08-30: `ChannelSidebar.css` 16 · `ServerList.css` 14 · `UserList.css`
12 · `TitleBar.css` 1 = 43. `Auth.css` and `AppPage.css` carry **zero** of them. The 12 distinct
offenders are `.channel .active .small .current .off` · `.home .add .search` · `.offline .list
.username` · `.close`.
*Cost if wrong:* a rename sweep that misses a harness selector produces a probe that can no longer
fail. Mitigated by decision 11's instrument and tasks 9/10's ordering.

**2. The call stage's accent is theme-invariant** — pinned to the dark value **`#6366F1`** via a new
`--stage-accent` on `:root` only. The **10** `--accent`/`--accent-hover` sites switch to it; all 10
are in `CallStage.css` (`:352, :419, :595, :654, :713, :835, :903, :962, :1008` and `--accent-hover`
at `:604`) — re-verified 2026-08-30. `CallUI.css` and `AppPage.css` contain **zero**.
*Cost if wrong:* the stage's accent stops responding to theme on a surface whose every other token is
already `:root`-only — trivially reversible (one definition, 10 references).
**Do not use the "12" in backlog §2b — it was never true.**

**3. Media-query range syntax is kept; the 5 legacy blocks migrate to it; iOS Safari <16.4 is an
accepted cost.** The five are `AppPage.css:96` (`min-width: 769px`), `AppPage.css:102`,
`ChannelSidebar.css:323`, `ServerList.css:134`, `UserList.css:186` — exactly the 5
`media-feature-range-notation` errors.
**Measured refinement:** all five are resolved by task 2's `stylelint --fix`, so the *notation*
migration is free. **Notation and boundary are orthogonal** (decision 5).
*Cost if wrong:* the web client gets a *hybrid* broken mobile layout, not a graceful one, on those
versions. This was the costed option and it was chosen with that cost stated.

**4. Accessible names land as call-site `aria-label`s reusing existing i18n keys, plus
`role="progressbar"` on the level meter — not a new JSX primitives layer.**
*Cost if wrong:* ~13 sites to keep in sync instead of one; the alternative is a new architectural
surface in the last milestone, which is the larger risk. This ruling also retires §6c's old "fix at
the recipe in `primitives.css`" claim, which was false — `primitives.css` is a stylesheet and ARIA is
not CSS.

### Human rulings — this planning session (2026-08-30)

**5. The 900px migration is the `AppPage.css` pair ONLY.**
`AppPage.css:96` (`min-width: 769px`, hides the sidebar block on desktop) and `AppPage.css:102` (the
entire mobile single-panel model) are **verified complementary** — they are "the current 768/769px
breakpoint pair" spec §5 names. The other **17** blocks at that boundary keep 768:
`CallStage.css:125,396,624,757,865,895` · `ChatArea.css:349` · `Composer.css:127` ·
`MediaLightbox.css:116` · `MessageAttachments.css:66` · `MessageRow.css:313` · `MessageSearch.css:274`
· `VideoPlayer.css:95` · `VoiceBanner.css:14`.
**Decision 3 and decision 5 are orthogonal.** Three of decision 3's five blocks
(`ChannelSidebar.css:323`, `ServerList.css:134`, `UserList.css:186`) change **notation only and keep
768**. Only `AppPage.css`'s two change **both**.
*Cost if wrong:* component tweaks stay tuned for 768 while the shell switches at 900, leaving a
768–900 band where the shell is mobile but components are desktop. The alternative — moving all 19 —
is an unrequested behaviour change on 14 lint-clean blocks including four trunk surfaces M5.5 just
certified at lint 0, two of which (`AudioPlayer`, `VideoPlayer`) have **no fixture**.

**6. `--stage-danger: #FCA5A5` on `:root` only — THREE sites, and it is an AA fix, not a preference.**
`--danger` has 8 **foreground** sites (not the "only two" the record claims — Appendix A, C3). Four
looked like stage sites; **only three are**:

| site | ground | takes |
|---|---|---|
| `CallStage.css:279` `.stage-plate-mic.is-muted` | `--stage-plate` over `--stage-tile` | `--stage-danger` |
| `CallStage.css:460` `.stage-conn.is-poor` | absolute over `--stage-tile` / `--stage` | `--stage-danger` |
| `CallUI.css:192` `.p2p-plate-mic.is-muted` | the p2p plate | `--stage-danger` |
| **`CallStage.css:564` `.stage-tip.is-poor`** | **`background: var(--canvas)` (`:480`)** | **keeps `--danger`** |

`.stage-tip` is a **theme-adaptive** surface, not stage ground — `tokens.css`'s own `--stage-*`
comment already says so and applies the identical carve-out to `--online`: *"Theme-adaptive surfaces
(`.stage-tip` on `--canvas`, the p2p incoming modal) keep `--online`."* Follow that precedent exactly.

**The value is a measured AA fix. Bind every ratio to its ground — the two colours are not measured
against the same background:**

| ground | `#E7444A` | `#FCA5A5` |
|---|---|---|
| `--stage-tile` `#1A1E2B` | **4.21:1 — below AA** | 8.75:1 |
| `--stage-tile-2` `#20252F` | **3.89:1 — below AA** | 8.09:1 |
| `--stage` `#0E1017` | 4.82:1 | 10.01:1 |
| `--stage-plate` over `--stage-tile` (`#0D0F18`) | 4.85:1 | 10.07:1 |

So this is a **disclosed, deliberate colour change on three call-surface sites**, and task 14 must
check it against board `1e`.
*Cost if wrong:* one token definition and three references to revert. The alternative — pinning
`--stage-danger: #E7444A` to move zero pixels — is **rejected**: it would ship a known AA failure on
the stage out of the milestone whose clause is dark-theme parity.

**7. The chat header's search button keeps opening the deep `MessageSearch` panel. No ⌘K chip.**
Closes RESUME §6f #1. Board `1c`'s dark-theme ⌘K chip stays unshipped **by decision, not omission** —
a ⌘K chip on a control that does not open ⌘K would be a false label.
*Cost if wrong:* a board element ships unshipped in the last milestone with no further chance to
revisit. The alternative costs users the one-click route to per-channel deep search.

**8. The focused screen-share height is fixed by collapsing the thumbnail strip.**
Closes RESUME §6f #4 via backlog §2a's own analysis: `.stage-thumbs` (`CallStage.css:920–921`,
`height: 110px`) is **41% of the stage chrome** and is the largest single lever. The two remedies
backlog §2a rules **out** stay out: `height: max(var(--call-stage-height, 55%), 75%)` is wrong
because the drag handle clamps to 20–80% (**`AppPage.tsx:139`** — backlog §2a's `:130` is the
persistence guard, a different expression with the same two numbers), and the split itself is
user-draggable by design.
*Cost if wrong:* the thumbnail strip becomes conditional, so a user in a short stage loses participant
thumbnails — reversible in one rule.

### Human rulings — post-grand-review (2026-08-30)

The grand review surfaced four questions the plan had answered by accident, by silence, or by
deferring into execution. Each was put to the human as an explicit costed question. **These are
rulings, not planner calls.**

**22. The member-list band runs `900px ≤ width < 1200px`, closing the spec's 900–999px hole.**
Spec §5 names ≥1200, 1000–1200, <900 and <640 — and is **silent on 900–999px**. The review found the
plan's first band sketch answered it by accident, letting all four columns return at 900–999 while
1000–1200 hid the member list: **more columns at 950px than at 1100px**, an inversion. The band now
meets the mobile model exactly at 900, with no gap.
*Cost if wrong:* a 950px window gets a treatment the board drew for 1000–1200 — the only reading with
no discontinuity, against an alternative that shipped the inversion.

**23. The `<900px` "sidebar drawer" clause is satisfied by the existing mobile single-panel model,
recorded as a formal deviation from board `1f`.**
The tree switches whole panels via `data-mobile-panel`; that is **not** a drawer, and the plan
originally treated the two as equivalent **silently**. It is M2's model, it works, and **every mobile
probe on the branch asserts against it** (`probe-t12-mobile.js`, `probe-stage-mobile.js`).
*Cost if wrong:* the board's drawer treatment never ships — as a **recorded deliberate departure**
rather than an unnoticed gap. **Task 14 must carry this ruling** so board QA has an answer rather
than a surprise.

**24. The CSS-fullscreen dead end is fixed, not declined.**
A palette chat command must exit CSS-fullscreen so the chat column is visible, symmetric with the
portal fix for the Fullscreen-API variant. Task 11 probed both and fixed one, which left the task
**unable to close** — its own fail-first would still fail afterwards.
*Cost if wrong:* a user in CSS fullscreen who runs a chat command is dropped out of fullscreen, which
is the outcome asking for chat implies.

**25. `AppPage.tsx:610`'s `▶`/`◀` become lucide chevrons.**
The last emoji-as-icon in the tree, excluded by M1's own plan and open ever since.
`ChevronRight`/`ChevronLeft`, `strokeWidth={1.8}`, explicit `size` matched to the neighbouring
surface. **Re-measure the line number** — the record's old `:603` was already stale once.
*Cost if wrong:* a small visual change on the sidebar collapse control, against shipping
`client/CLAUDE.md`'s "no emoji-as-icon" contract with a permanent documented exception.

### Planner decisions

**9. The colour probe's baseline is committed to git, outside `.superpowers/`.**
`docs/superpowers/plans/m6-colour-baseline.json`, captured in task 1 **before any `tokens.css`
edit**, holding all **81** canonical `:root` tokens × **2** themes as **computed** values via the
scratch-element pattern.
*Cost if wrong:* the SDD workspace is gitignored and dies with the session (RESUME §8.8). A
before/after gate whose "before" is lost is **not a gate** — it degrades into an unfalsifiable
assertion at exactly the task (2) that rewrites 50 declarations.

**10. The `+N / −0` numstat invariant is replaced by the alias sentinel.**
At **every task close from task 2 through task 12**, run the sentinel and assert **47 unique names /
50 declarations**. From task 13 on, assert **0**.
*Cost if wrong:* `--fix` edits 20 warnings inside the alias block at task 2, so the old invariant
cannot survive; without a replacement the block is **ungated for eleven tasks** while the colour probe
checks only values, not block integrity.

**11. The rename instrument is selector-context extraction, never token grep.**
Token grep is catastrophic here: `channel` is **254** TSX hits and **246** harness hits, `current`
233, `username` 84, `close` 64/82 — almost all variable names and property accesses. Extracting only
`className` string emissions and `querySelector*`/`closest`/`matches`/`classList.*` arguments gives
the true radius: **12 emission sites in 4 owner components, 77 harness selector sites, 0 test-file
sites**.
*Cost if wrong:* an `sd`-style token sweep renames `channel.id`, `location.search` and `Set.add`
across 500 sites and destroys the application. This is the single highest-consequence instrument
choice in the milestone.

**12. `probe-composer.js` converts to the throwing `fail()` convention.**
It currently uses deferred flush (`FAIL[]` + `out.VERDICT`) and **never throws**, so `smoke.mjs`
surfaces nothing unless a reader inspects `out.VERDICT`.
*Cost if wrong:* two conventions coexist in one `tools/` directory and the §5 truth table's `fail(`
census silently misclassifies five files. Task 1 exists to make gates fail loudly; keeping a
second convention defeats it.

**13. `--radius-lg` (12px) maps to `--radius-tile` (13px).**
The canonical radius scale is 6/9/10/11/13/14/16/18/999 — **there is no 12px**. Its three sites are
all square tiles: `ServerList.css:208` and `:253` (40×40 mobile-drawer server tiles) and
`Auth.css:139` (the 48×48 logo tile). `--radius-tile` is the semantically correct member.
*Cost if wrong:* a **+1px** radius change on three small surfaces. The alternative — adding a
canonical 12px token — perpetuates a legacy value inside the design system in the milestone whose
whole purpose is removing legacy values. Task 14 checks all three surfaces against the board.

**14. `--brand-subtle` migrates by adopting the whole `var(--focus-ring)` declaration.**
`Auth.css:67` is `box-shadow: 0 0 0 3px var(--brand-subtle)`; `--focus-ring` is
`0 0 0 3px rgba(79, 70, 229, 0.13)` with a dark override of `rgba(99, 102, 241, 0.25)`. Replace the
whole declaration with `box-shadow: var(--focus-ring);`.
*Cost if wrong:* a **disclosed** alpha change on the auth input focus ring — light 0.10 → 0.13, dark
0.15 → 0.25. This is the *correct* direction: it puts auth on the same focus ring as the rest of the
app, and it is the only migration that preserves a dark override the alias carried.

**15. Three canonical accent-ramp tokens are added: `--accent-300`, `--accent-400`, `--accent-500`.**
`--brand-300` `#A5B4FC`, `--brand-400` `#818CF8` and `--brand-500` `#6366F1` are raw-valued aliases
with live consumers (two decorative gradients: `Auth.css:138`, `ProfileSettings.css:36`). They carry
**no dark override**, so the new tokens are declared on `:root` **only**.
*Cost if wrong:* three new names in the canonical block instead of two gradients hard-coding hex —
which would violate "no raw colour outside `tokens.css`" and fail task 13's own raw-value gate.

**16. Accessible names cover the 11 Settings-pane sites AND the 4 sliders outside them.**
Panes: 4 checkboxes (`AudioSettings.tsx:103,121,139,214`), 1 range (`:156`), 5 selects
(`VideoSettings:16`, `ProfileSettings:116`, `AudioSettings:262,277`, `AppearanceSettings:19`), 1 level
meter (`:234`) = **11**. Plus `AudioPlayer.tsx:54`, `VideoPlayer.tsx:79`,
`VolumeControlPopover.tsx:81`, `AvatarCropModal.tsx:209` = **15 sites**.
*Cost if wrong:* four more `aria-label`s and up to four new i18n key pairs. The record's "2 range
sliders on the Settings panes" is **1**; leaving the other four unnamed would ship a milestone whose
clause is "accessible names" with a third of the app's sliders unnamed.

**17. The reduced-motion clause loosens `base.css:85` into a policy, and its probe asserts BOTH
halves.** The blanket block already kills fades with three `!important` declarations on
`*, *::before, *::after`, so this clause is **strictly riskier than adding coverage** — the failure
mode is *motion returning*, not *motion not suppressed*. There is also a **second, pre-existing**
`prefers-reduced-motion` block at `ChannelSidebar.css:227–236` that must be reconciled.
*Cost if wrong:* a user who asked the OS to reduce motion gets motion back. The probe must assert
loops stopped **and** a named entrance still animating opacity, or it cannot detect the regression it
exists to prevent.

**18. Tasks 9 and 10 split by harness risk, not by file count.**
Task 9 = `UserList.css` + `TitleBar.css` (13 errors, **5** harness selector sites, 0 `classList`
sites) as the instrument's proving run. Task 10 = `ServerList.css` + `ChannelSidebar.css` (30 errors,
**72** harness sites including all 9 `classList` sites). The two files in task 10 **cannot be split**
— they share `.active`.
*Cost if wrong:* the instrument's first real use is against `.channel` (45 harness sites) instead of
`.close` (0), so an instrument defect is discovered at maximum blast radius.

**19. Renames (tasks 9–10) precede the alias deletion (task 13).**
Three of the four rename files are also alias consumers — `ServerList.css` 19, `UserList.css` 7,
`ChannelSidebar.css` 5.
*Cost if wrong:* those three files get touched twice with the audit gate already armed, and a rename
regression surfaces as an alias-audit failure, mis-attributing the defect.

**20. The z-index census gets a named token scale in `tokens.css`.**
RESUME §6c leaves this open ("M6 should decide whether these want a named token scale"). Re-measured
2026-08-30: **12 declarations at ≥1000 across 7 distinct values, with 1000 appearing three times** —
`.modal-overlay` 1000 (`primitives.css:342`) · `CallUI.css:11` 1000 · `FloatingQuoteButton.css:6` 1000
· `.context-menu` 1050 (`primitives.css:637`) · `.screen-picker-backdrop` 1100
(`ScreenSharePicker.css:5`) · `.volume-popover` 1100 (`VolumeControlPopover.css:14`) ·
`.palette-overlay` 1150 (`CommandPalette.css:15`) · `.stage-tip` 1200 (`CallStage.css:477`) ·
`CallNotifBanner.css:15` 2000 · `.error-toast` 2000 (`primitives.css:729`) · `ErrorBoundary.css:12`
9999 · `UpdateBanner.css:19` 9999. **`MediaLightbox.css` declares no `z-index`** — it inherits 1000
from the primitive, which is M5.5 T4's D8 contract, and must stay that way.
Introduce `--z-overlay: 1000`, `--z-menu: 1050`, `--z-popover: 1100`, `--z-palette: 1150`,
`--z-tooltip: 1200`, `--z-toast: 2000`, `--z-crash: 9999` and repoint all 12. **Values do not change.**
*Cost if wrong:* seven new tokens and 12 references, all value-preserving and mechanically reversible.
The alternative leaves the last milestone shipping a layering system that can only be understood by
grepping seven magic numbers across nine files.
**Do not write "the census is now 13" anywhere** — that summary drifted wrong five separate times
during M5 while the entry table stayed right, and `.screen-share-picker` does not exist and never did.

**21. The `no-descending-specificity` 8 are deferred to task 13.**
The rule buckets by at-rule context, so instances are **not** interchangeable: M2 and M3 each
disproved a copied instance, **but M4 tested a third and it fired**, as did M5.5's.
*Cost if wrong:* tasks 4–12 change specificity in several files, so fixing these early means fixing
them twice. **Test the counterfactual with a positive control at each of the 8; never copy a
justification.**
**The "8" is measured AT task 13, never carried from task 2.** Tasks 3–12 add declarations to files
whose current lint is **0** (`CallStage.css`, `CallUI.css`, `Settings.css`, `primitives.css`,
`MessageRow.css`) and change specificity in several, so the count can move either way — a new
`custom-property-empty-line-before` or `no-descending-specificity` in one of them is entirely
possible. **The lint trajectory in the task table is a projection, not a contract.** E2 requires
measuring both ends at every task; a task whose measured number differs from the projection has
**found something**, not failed. Record the difference and carry the measured number forward.

---

## What M6 does NOT do

- **Backlog §1 in full** — every item needs a `services/` or store-architecture scope grant the spec
  withholds. This explicitly includes **§1f** (no request timeout, uncancellable
  `request()`/`requestForm()`, and the resulting avatar-upload no-exit trap). Do not "restore" a
  cancel path for attachment upload — `uploadAttachment` uses `XMLHttpRequest`, returns
  `{ promise, abort }`, and **that path already works**.
- **`api.network-retry.test.ts`** stays red. Never touch it.
- **The 17 non-pair 768 blocks** keep their boundary (decision 5).
- **RESUME §6f #2 and #2b** are recorded as already-ruled with no work: board `2c`'s per-row server
  name stays dropped (the client holds one server's channels, so it would be a constant), and the
  palette footer copy stays hidden below 640px (all three hints wrapped at 390px and «Открывается на
  ⌘K из любого места» is *false* on a touch device).
- **§6f #2c, #5, #7, #8** stay board/sign-off items.
- **§6f #6 (invite revoke without confirmation)** stays **board-owned**. It is byte-identical to base
  and the backlog assigns the call to the human, not to a milestone.
- **`composer-attach-btn` / `composer-attach-input`** carry no CSS rule **on purpose** — they are
  identity hooks for the probes. Do not add a rule; do not delete them.
- **`ChatArea` re-rendering on every upload progress tick** — `ChatArea.tsx:90` calls
  `useAttachmentUpload(channel?.id)`, which subscribes to the `drafts` slice, while `ChatArea` uses
  **only** `uploads.addFiles` (one call site, `:113`). Accepted at M5.5 as the alternative to
  prop-drilling a second hook through the tree. **Backlog-only**, though worth doing eventually
  because `ChatArea` is the heaviest tree in the app; a selector-scoped `addFiles`-only hook is the
  shape.
- **`onDiscard` orphaning attachment blobs** is **bounded and self-healing**, not a leak: a discarded
  failed row's attachments still have `message_id IS NULL`, the same predicate the janitor's orphan
  branch and `deleteAttachment` use, so they are reclaimed after `OrphanAge` = 24h at no metered cost.
  A ≤24h deferral. **Do not record it as "an attached-but-messageless blob".**

---

## File structure

**Modified — CSS**

| File | Tasks | Responsibility in M6 |
|---|---|---|
| `src/styles/tokens.css` | 2, 3, 11, 13 | notation normalisation; `--stage-accent`/`--stage-danger`/`--warning-text`/`--accent-300..500`; the `--z-*` scale; **alias block deleted** |
| `src/styles/base.css` | 6 | reduced-motion policy replaces the blanket hammer |
| `src/styles/primitives.css` | 4, 6, 13 | dead `.channel-type-options` block removed; `:355` comment corrected; `.panel-icon-btn.is-off` hover |
| `src/pages/AppPage.css` | 2, 7, 8, 13 | the 900 pair; the new bands; 7 alias refs |
| `src/pages/Auth.css` | 2, 13 | 30 alias refs (the largest consumer) + 3 of the 4 raw-colour sites |
| `src/components/ServerList.css` | 2, 10, 13 | 14 renames + 19 alias refs |
| `src/components/ChannelSidebar.css` | 2, 6, 10, 13 | 16 renames + 5 alias refs + the second reduced-motion block |
| `src/components/UserList.css` | 2, 3, 9, 13 | 12 renames + 7 alias refs + the 2 unknown-custom-property errors |
| `src/components/TitleBar.css` | 2, 9, 13 | 1 rename + the 4th raw-colour site |
| `src/components/CallStage.css` | 3, 8, 12 | 10 accent sites → `--stage-accent`; 3 danger sites; `.stage-thumbs` collapse |
| `src/components/CallUI.css` | 3, 8 | 1 danger site; `.p2p-modal` hard width |
| `src/components/Settings.css` | 3 | `.setting-warning` light-theme contrast |
| `src/components/settings/ProfileSettings.css` | 2, 13 | 2 alias refs |
| `src/components/MessageRow.css` | 8, 12 | `.msg-action-btn` touch target; `@media (hover: none)` width bound |

**Modified — TSX/TS**

| File | Tasks |
|---|---|
| `src/components/settings/{AudioSettings,VideoSettings,ProfileSettings,AppearanceSettings}.tsx` | 5 |
| `src/components/{AudioPlayer,VideoPlayer,VolumeControlPopover,AvatarCropModal}.tsx` | 5 |
| `src/components/{ServerList,UserList,TitleBar,ChannelSidebar}.tsx` | 9, 10 |
| `src/components/{ContextMenu,VolumeControlPopover,ScreenSharePicker}.tsx`, `src/hooks/useFloatingSelectionToolbar.ts` | 11 |
| `src/components/CommandPalette.tsx`, `src/hooks/{usePaletteHotkey,useModalFocus}.ts` | 11, 12 |
| `src/components/ChatArea.tsx` | 5 (the `h1`) |
| `src/i18n/locales/{ru,en}.ts` | 5 (together, always) |
| `src/utils/paletteFilter.ts` + `src/utils/paletteFilter.test.ts` | 12 |
| `src/stores/__tests__/{messageStore,unreadStore}.test.ts` | 12 |

**Created**

| File | Task | Tracked? |
|---|---|---|
| `docs/superpowers/plans/m6-colour-baseline.json` | 1 | **yes — committed** (decision 9) |
| `docs/superpowers/plans/2026-08-30-redesign-m6-closeout.md` | 15 | yes |
| `.superpowers/sdd/2026-08-30-redesign-m6-polish/tools/` | 1 | no — gitignored |
| `<tools>/probe-colour-tokens.js` | 1 | no — gitignored |
| `<tools>/probe-dark-parity.js` | 3 | no — gitignored |
| `<tools>/probe-a11y-names.js` | 5 | no — gitignored |
| `<tools>/probe-reduced-motion.js` | 6 | no — gitignored |
| `<tools>/probe-bands.js` | 8 | no — gitignored |
| `<tools>/probe-classnames.js` | 9 | no — gitignored |
| `<tools>/alias-sentinel.mjs`, `<tools>/selector-sweep.mjs` | 1 | no — gitignored |

---

## The task envelope

Every task follows this envelope. Task-specific steps are listed **inside** it; the envelope itself is
not repeated per task, but **each of its steps is mandatory**.

**E1. Re-measure the task's own preconditions.** Never inherit a number from this plan without
re-running its command. This plan's figures are dated 2026-08-30 at `dc0a873`.

**E2. Capture the base-tree lint at BOTH ends.** Before editing:
```bash
cd /Users/nm/Projects/experiments/vycord
git archive <base-sha> | (mkdir -p /tmp/m6-base-<task> && tar -x -C /tmp/m6-base-<task>)
ln -sfn "$(pwd)/client/node_modules" /tmp/m6-base-<task>/client/node_modules
cd /tmp/m6-base-<task>/client && npx stylelint "src/**/*.css" -f json 2>&1 | tail -1
```
**An arithmetic-only lint claim is unfalsifiable and is not accepted** (RESUME §4). M5 and M5.5 both
measured both ends; that is the only reason their deltas could be attributed.

**E3. Fail-first.** Run the task's probe against the pre-task tree and **observe it fail loudly**.
Paste the failure text into the task report. A probe that has only ever been green proves nothing.
**A failing probe still exits 0** (`smoke.mjs:403` catches into a `PROBE ERROR:` string) — evidence is
the printed output, never the exit code.

**E4. Implement.**

**E5. Run the four gates from `client/`:**
```bash
cd /Users/nm/Projects/experiments/vycord/client
npx stylelint "src/**/*.css" -f json 2>&1 | tail -1     # never from the repo root
npx tsc --noEmit                                          # exit 0, no output
npm run check:i18n                                        # «непереведённых строк не найдено.»
npm test 2>&1 | tail -8                                   # RED only in api.network-retry.test.ts
```
**A paste that says "same file" without the `FAIL` lines naming it is not evidence.**

**E6. Run the alias sentinel** (decision 10):
```bash
node .superpowers/sdd/2026-08-30-redesign-m6-polish/tools/alias-sentinel.mjs
# tasks 2–12 → "47 unique / 50 declarations"   tasks 13+ → "0 / 0"
```

**E7. Residue accounting.** Count **against the REST API, not the DOM**, and **paginated**
(`limit=100`, offset-walked). `getMessages` takes `limit`/`offset` only — **there is no `before`
cursor**; a `before=` parameter is silently ignored and the server re-reports page 1. The default
`limit` of 50 makes an unpaginated read of `#general` return 50 **regardless of what happened**.
Cover **every probe the task ran**, not only the task's own. Prefer `#second-smoke` for anything that
writes; `#t9-empty-channel` is M4's empty-state fixture and must stay at **0**.

**E8. Commit — one commit per task, explicit paths, never `git add -A`.**

**E9. Write `task-N-report.md` into the SDD workspace, and transcribe anything durable into
`docs/superpowers/` before the session ends.** The workspace is gitignored and dies with the session.

**Standing instruction to every implementer: push back.** In M4 five implementers caught errors in
the plan or in a dispatch; **in M5.5 every single implementer did, including two of the controller's
own figures.** If a number here disagrees with the tree, **the tree wins** — record the correction and
proceed.

---

## Task 1: Instruments

**Files:**
- Create: `.superpowers/sdd/2026-08-30-redesign-m6-polish/tools/` (via `cp -R`)
- Create: `<tools>/probe-colour-tokens.js`, `<tools>/alias-sentinel.mjs`, `<tools>/selector-sweep.mjs`
- Create: `docs/superpowers/plans/m6-colour-baseline.json` — **tracked**
- Modify: `<tools>/probe-composer.js` (`:193` + convention), `<tools>/probe-shell.js`,
  `<tools>/probe-sidebar.js`
- Rename: `<tools>/probe-{callstate,confirm-modal,lightbox-escape}.js` → `diag-*.js`

**Interfaces:**
- **Produces** `tokenColor(name) → string` and `scratch(decl, prop, classes) → string` — the
  scratch-element helpers every later colour assertion uses.
- **Produces** `m6-colour-baseline.json`: `{ "light": { "--accent": "rgb(79, 70, 229)", … },
  "dark": { … } }` — 81 keys per theme, computed values, consumed by tasks 2, 3 and 13.
- **Produces** `alias-sentinel.mjs` printing `<unique> unique / <decls> declarations` — consumed by
  E6 in every later task.
- **Produces** `selector-sweep.mjs --class <name>` listing `className` emissions and
  `querySelector*`/`closest`/`matches`/`classList.*` sites — consumed by tasks 9 and 10.

- [ ] **Step 1: Carry the harness forward**

```bash
cd /Users/nm/Projects/experiments/vycord
mkdir -p .superpowers/sdd/2026-08-30-redesign-m6-polish
cp -R .superpowers/sdd/2026-08-30-redesign-m5.5-trunk-integration/tools \
      .superpowers/sdd/2026-08-30-redesign-m6-polish/tools
du -sh .superpowers/sdd/2026-08-30-redesign-m6-polish/tools   # expect ~33M
find .superpowers/sdd/2026-08-30-redesign-m6-polish/tools | wc -l
```
Expected: ~33M. Entry count was **477** on 2026-08-30 (the RESUME says 475 — a +2 drift, **noted, not
chased, not load-bearing**). **Do NOT delete the M5.5 workspace** (M5 R28/D16): all six SDD workspaces
hold a copy, and losing one costs nothing while losing all of them costs every visual claim its
instrument.

- [ ] **Step 2: Write the colour probe**

`<tools>/probe-colour-tokens.js`. It must be an **IIFE** — `smoke.mjs` interpolates the file into
`(await (${probeSrc}))`.

```js
(async () => {
  const scratch = (decl, prop, classes) => {
    const el = document.createElement('div');
    if (classes) el.className = classes;
    el.style.cssText = decl;
    document.body.appendChild(el);
    const v = getComputedStyle(el)[prop];
    el.remove();
    return v;
  };
  const tokenColor = (n) => scratch(`background: var(${n});`, 'backgroundColor');

  // Negative control: a name that cannot resolve. Every real token must DIFFER
  // from this, or two identical "nothing resolved" strings compare equal and
  // the whole snapshot passes silently.
  const NOTHING = tokenColor('--m6-token-that-does-not-exist');

  const NAMES = [/* the 81 canonical :root names, injected by the caller */];
  const out = { control: NOTHING, theme: document.documentElement.dataset.theme || 'light', tokens: {} };
  const unresolved = [];
  for (const n of NAMES) {
    const v = tokenColor(n);
    out.tokens[n] = v;
    if (v === NOTHING) unresolved.push(n);
  }
  if (unresolved.length) {
    throw new Error('COLOUR PROBE: these tokens resolve to nothing — ' + unresolved.join(', '));
  }
  return out;
})()
```

**Never** use `getComputedStyle(document.documentElement).getPropertyValue('--X')`: it returns the
**declared string** whether or not any rule consumes it, and compares a hex literal against the
`rgb()` an element actually computes — so the check is **always-true**.

- [ ] **Step 3: Prove the colour probe can fail**

Break one token deliberately (rename `--accent` to `--accent-x` in `tokens.css`), **restart the dev
server** (Vite HMR can re-inject a changed base-layer file *after* component CSS and invert the
cascade), run the probe, and observe:

```
PROBE ERROR: COLOUR PROBE: these tokens resolve to nothing — --accent
```

Restore, prove restoration with `git diff --exit-code client/src/styles/tokens.css`, re-run, observe a
clean snapshot. **The broken state is never committed.**

- [ ] **Step 4: Capture the committed baseline**

Dev server on **port 3000 exactly** (`cd client && npm run dev:vite`) — the production CORS allowlist
means a 3001/3002 fallback fails login with a CORS error that **looks like a bug and is not**. Kill
stale servers first; a server predating HEAD invalidates the capture.

```bash
cd /Users/nm/Projects/experiments/vycord/.superpowers/sdd/2026-08-30-redesign-m6-polish/tools
node smoke.mjs --theme light --probe probe-colour-tokens.js --out /tmp/m6-base-light.png --wait 4000
node smoke.mjs --theme dark  --probe probe-colour-tokens.js --out /tmp/m6-base-dark.png  --wait 4000
```
`--out` is **mandatory** — `smoke.mjs:32–35` hard-exits **2** without it, which is why every
probe-only command printed in the M2–M5 plans is invalid as written. Supply a throwaway path.

Merge both into `docs/superpowers/plans/m6-colour-baseline.json` and verify: **81 keys per theme**,
`control` present and distinct from every token.

- [ ] **Step 5: Repair `probe-composer.js` — both halves**

Half one, the dead line. `probe-composer.js:193` is
`document.querySelector('.link-dialog-submit').click();`. **That class does not exist in `src/`** —
it was introduced by `3621256` and deleted by M4's `ea7b52c`, which moved the link dialog onto the
`btn` roles. The only surviving mention is a *comment* at `LinkDialog.css:16`. Re-point it at what
`LinkDialog.tsx` renders today — `.btn.btn-primary` inside `.modal-actions` — and route it through
the file's null-tolerant `q()` helper rather than a raw `querySelector`.

Half two, the convention (decision 12). The file uses deferred flush and **never throws**:

```js
const FAIL = [];
const check = (name, actual, expected) => { … FAIL.push(…); return actual; };
…
out.VERDICT = FAIL.length === 0 ? 'PASS' : 'FAIL (' + FAIL.length + ')';
```

Convert to the throwing house convention so `smoke.mjs` surfaces failures without a reader inspecting
`VERDICT`.

**Restate the figure in the report, and count it rather than deriving it.** The record says "48 of its
88 assertions have never executed". Measured by occurrence, not by arithmetic: **41 `check(` above
`:193`, 48 at/below, 89 total.** (`:17` is the *definition*, written `const check = (name, …` — it
contains no `check(` and is therefore **not** in the 89.) The 41 above *do* execute, but their results
**die with `out`** when the `TypeError` is swallowed into a `PROBE ERROR:` string. Net: **0 of 89
produce a readable verdict** — and the failure is **loud**, not silent. What was silent is that nobody
ran it.

*An earlier draft of this plan said 40/88 — inheriting the RESUME's 88 and deriving 40 by subtraction,
which is exactly the move E2 forbids. The grand review caught it. §8.9: a correction must be tighter
than what it corrects.*

- [ ] **Step 6: Give `probe-shell.js` and `probe-sidebar.js` real gates**

Both have **zero** `fail(`, `throw`, `VERDICT` and `FAIL.push` — pure reporters, and both were cited
as regression gates. They address exactly the classes tasks 9–10 rename, so this is a **precondition
for task 10**, not a favour to it. Route every recorded key/value pair through a throwing
`fail()`, following `tools/probe-screen-picker.js`'s correct pattern.

**Pair every negative precondition with a positive one** — assert present → act → assert absent.

- [ ] **Step 7: Rename the diagnostics**

`probe-callstate.js`, `probe-confirm-modal.js`, `probe-lightbox-escape.js` → `diag-*.js`. All three
have zero assertions of any kind. `probe-lightbox-escape.js`'s own line 1 says *"M5.5 T3 diagnostic
(round 3)"*; its diagnostic value is spent now that `probe-attach-escape.js` (17 `fail()`) guards the
same fix. M5.5 **nearly certified it as a gate** in the one table whose entire function is separating
the two.

Note in the report: **143 `probe-*.js` files exist** and the §5 truth table covers ~20. Exactly **43**
have no assertion machinery at all — no `fail(`, no `throw`, no `VERDICT`, no `FAIL.push`. Renaming
three is a convention beachhead, not a completed audit.

- [ ] **Step 7b: Discharge the rest of §6e's named harness debt**

Each of these is a probe that cannot fail in the way its name implies. Repair or delete **before
anything cites them**:

- **`probe-chat.js`** — **writes two messages to the production smoke server per run and never cleans
  up.** It accounts for 4 of M5.5's 6 probe-written messages and the bulk of `#general`'s noise. Point
  it at `#second-smoke` or give it a cleanup pass. Its continuation-row assertions also **no-op on an
  empty list**, so cite `continuation.count` as proof the block ran.
- **`probe-t5fix-handoff-focus.js:35`** — the field is `… || true`, which cannot fail.
- **`probe-t11-flow.js:51`** — `toastPresent` queries `.chat-error-toast`, deleted in favour of the
  shared `.error-toast`; permanently false.
- **`probe-palette-board.js:261–266`** — `heightMatchesOneRow` is an identity that cannot fail.
- **`probe-palette-actions.js:84`** — the restore click is the one call not routed through `fail()`.
- **`probe-primitives-toggle.js`** — its three recorded minors are **moot** (the collision it measured
  was retired by M4 T7). Close them rather than carrying them.

**`#general` is 54% probe noise and drifting.** Any probe asserting on message counts or scroll
position there is working against a moving fixture.

- [ ] **Step 8: Write the colour comparator — the half the probe does not cover**

`probe-colour-tokens.js` throws only when a token resolves to **nothing** (step 3 proves that mode).
But the gates that matter — task 2's "all 81 byte-identical to the baseline" and task 13's "nothing
changed except the disclosed deltas" — are a **diff**, and a diff nobody is specified to run is
`probe-chat.js`'s original sin rebuilt at the milestone's most important verification: **a renamed
token throws, a mangled value does not.**

Write `compare-colours.mjs <baseline.json> <captured.json> [--allow deltas.json]`. It **exits
non-zero and prints every drift** not named in the allowlist. Prove it can fail **on a value change,
not a name change**: edit one token's value in a scratch copy of the baseline, run the comparator,
observe the throw, discard the scratch copy.

- [ ] **Step 9: Write `alias-sentinel.mjs` — anchored on the banner, never on line numbers**

**Do not hard-code lines 177–239.** Tasks 3 and 11 both insert tokens *above* the alias block
(`--stage-accent`, `--stage-danger`, `--warning-text`, dark `--danger`, seven `--z-*` plus a comment),
shifting it ~10+ lines down. A fixed window would then straddle the canonical dark block while
truncating the alias block — and the failure mode that matters is not the false alarm, it is the
window **coincidentally still counting 47/50**: a gate that stopped gating, inside the very instrument
decision 10 introduces to *replace* a retired gate.

Anchor on the `LEGACY ALIASES — DELETE IN M6` banner and parse to the end of the trailing
`[data-theme="dark"]` rule. **Strip `/* … */` before counting** — the comment trap produced a wrong
alias census for four separate parties. Distinguish **"block absent → 0 / 0"** from **"window empty"**;
they are the same number and opposite meanings.

**Fail-first it, like everything else:** delete one alias line in a scratch copy, assert the sentinel
reports **46 unique / 49 declarations**, discard the copy.

- [ ] **Step 10: Write `selector-sweep.mjs`**

Reports, separately:
1. `className` string emissions in `src/**/*.tsx` — **including conditional fragments**
2. `querySelector`/`querySelectorAll`/`closest`/`matches` arguments in `tools/**/*.js` **and `src/**`**
   (measured zero in `src/` today, so the pattern is free insurance)
3. `classList.{add,remove,toggle,contains}` arguments in both

It must **never** report bare token matches. **Run it with `--no-ignore --hidden` semantics or plain
`grep`** — see the warning in task 13 step 1.

**Two positive controls, because one is not enough:**
- `.channel` — the easy case, a plain template head. Token grep says 254 TSX / 246 harness; the sweep
  must say **1 emission** (`ChannelSidebar.tsx:250`) and **45 harness selector sites**.
- `active` — **the hard case, and the one task 10 depends on.** It appears only as a *conditional
  fragment*: `` `channel${isActive ? ' active' : ''}` `` (`ChannelSidebar.tsx:250`) and
  `ServerList.tsx:45,55`. A sweep that handles template heads but misses fragments would report
  **0 emissions** here and look like it worked. Expect **3 emissions**, 11 selector + 9 `classList`
  harness sites.

- [ ] **Step 11: Gates, sentinel, residue, commit**

Envelope E5–E8. Lint must still be **188** — this task changes no CSS.

```bash
cd /Users/nm/Projects/experiments/vycord
git add docs/superpowers/plans/m6-colour-baseline.json docs/superpowers/plans/2026-08-30-redesign-m6-polish.md
git commit -m "test(redesign): M6 T1 — colour probe, committed baseline, harness repairs"
```

---

## Task 2: Notation normalisation

**Base SHA for E2:** task 1's commit.

**Files:** Modify `src/styles/tokens.css`, `src/pages/{AppPage,Auth}.css`,
`src/components/{ChannelSidebar,ServerList,UserList,TitleBar}.css` — all via `stylelint --fix`.

**Interfaces:**
- **Consumes** `m6-colour-baseline.json` and `probe-colour-tokens.js` from task 1.
- **Produces** a tree at lint **54**, and the retirement of the `+N / −0` invariant.

- [ ] **Step 1: Capture the pre-fix lint at both ends (E2)**

Expected on the base tree: **188**, distributed `tokens.css` 118 · `ChannelSidebar` 23 · `UserList` 16
· `ServerList` 15 · `Auth` 10 · `AppPage` 4 · `TitleBar` 2.

- [ ] **Step 2: Run the fix**

```bash
cd /Users/nm/Projects/experiments/vycord/client
npx stylelint "src/**/*.css" --fix 2>&1 | tail -2
```
Expected: `✖ 54 problems (54 errors, 0 warnings)`.

- [ ] **Step 3: Verify the residue is exactly the four expected categories**

```bash
npx stylelint "src/**/*.css" -f json 2>&1 | tail -1 | python3 -c "
import json,sys,collections
d=json.loads(sys.stdin.read()); r=collections.Counter()
for f in d:
    for w in f['warnings']: r[w['rule']]+=1
print(sum(r.values()), dict(r))"
```
Expected exactly:
```
54 {'selector-class-pattern': 43, 'no-descending-specificity': 8,
    'csstools/value-no-unknown-custom-properties': 2, 'no-duplicate-selectors': 1}
```
**If any other rule appears, stop** — `--fix` did something this plan did not predict.

- [ ] **Step 4: Prove the rewrite is value-preserving — and know what the proof does NOT cover**

Restart the dev server (HMR cascade inversion), then re-run the colour probe in **both** themes and
run `compare-colours.mjs` against `m6-colour-baseline.json`. **Every one of the 81 tokens must be
byte-identical in both themes.**

**Scope, stated honestly:** the 81-token snapshot covers `tokens.css`'s custom properties. `--fix`
also rewrites colour notation **inside the six component files** — `Auth.css:90,127,140`'s `rgba()`
shadows and borders among them — and those are *declarations*, not tokens, so **the snapshot never
sees them.** The rewrite is mechanically value-preserving, but "prove the rewrite is value-preserving"
overstates the instrument. **Spot-check one rewritten declaration per component file** by reading its
computed value before and after, and record which files were spot-checked rather than snapshotted.

The rewrites are notation-only — `#FFFFFF` → `#FFF`, `rgba(255, 255, 255, 0.07)` →
`rgb(255 255 255 / 7%)`, `alpha-value-notation` `0.07` → `7%`. **50 lines change in `tokens.css`**
and it goes **118 → 1** (`no-duplicate-selectors`, which `--fix` cannot resolve).

**Record the corrected figure.** RESUME §7.2 says the probe "guards the `stylelint --fix` notation
rewrite of **~117 declarations**". That counted *warnings*, not declarations. Measured: the three
colour rules fire on **33 distinct declaration lines**; there are **48 distinct warning lines**; and
`--fix` changes **50 lines** total. The record over-states by ~3.5×.

- [ ] **Step 5: Retire `+N / −0`; install the sentinel**

```bash
git diff --numstat client/src/styles/tokens.css
```
This will **not** be `+N / −0` — and that is expected, not a violation: **20 of `tokens.css`'s 118
warnings sit inside the alias block** (`:177–239`), so `--fix` edits it. Record the numstat, note the
invariant's retirement, and from here on run the sentinel (E6) instead:

```
47 unique / 50 declarations
```

- [ ] **Step 6: Note that decision 3 is now discharged for free**

All **5** `media-feature-range-notation` errors are `--fix`-resolved, so
`ChannelSidebar.css:323`, `ServerList.css:134` and `UserList.css:186` are now range syntax **and still
768** — exactly what decision 5 requires. Only `AppPage.css`'s two blocks still need a boundary
change, in task 7.

- [ ] **Step 7: Gates, sentinel, residue, commit (E5–E8)**

```bash
git add client/src/styles/tokens.css client/src/pages/AppPage.css client/src/pages/Auth.css \
        client/src/components/ChannelSidebar.css client/src/components/ServerList.css \
        client/src/components/UserList.css client/src/components/TitleBar.css
git commit -m "style(redesign): M6 T2 — stylelint --fix notation normalisation, 188 → 54"
```

---

## Task 3: Dark-theme parity

**Files:** Modify `src/styles/tokens.css`, `src/components/CallStage.css`,
`src/components/CallUI.css`, `src/components/Settings.css`, `src/components/UserList.css`

**Interfaces:**
- **Produces** `--stage-accent`, `--stage-danger`, `--warning-text` on `:root`; a dark `--danger`;
  refined `--hl-bg`/`--hl-ink`.
- **Produces** a tree at lint **51**.

- [ ] **Step 1: Fail-first — the parity probe**

Extend `probe-colour-tokens.js` into `probe-dark-parity.js` asserting, in dark theme:
`tokenColor('--danger') !== tokenColor('--danger')`-in-light; `--stage-accent` identical in both
themes; and the computed `color`/`background-color` of a scratch `.setting-warning` meeting 4.5:1.
Run it pre-task and observe it fail on all three.

- [ ] **Step 2: `--stage-accent` (decision 2)**

Add to `:root` **only**, adjacent to the existing `--stage-*` family whose comment already explains
why it does not appear under `[data-theme="dark"]`:

```css
  --stage-accent: #6366F1; /* board 1e: the stage is dark in BOTH themes, so its
                              accent is pinned to the dark value — human ruling,
                              2026-08-30 M6 planning session (decision 2). */
```

Switch the **10** sites in `CallStage.css` — `var(--accent)` at `:352, :419, :595, :654, :713, :835,
:903, :962, :1008` and `var(--accent-hover)` at `:604`. **Re-measure the line numbers**; task 2 did
not touch `CallStage.css`, but verify rather than assume. `CallUI.css` and `AppPage.css` contain
**zero** accent references — confirm with a comment-stripped grep, and **do not use backlog §2b's
"12"**, which was never true.

- [ ] **Step 3: `--stage-danger` (decision 6), then a dark `--danger`**

```css
  --stage-danger: #FCA5A5; /* Stage chrome is dark in BOTH themes, so its danger
                              foreground cannot follow --danger's light value.
                              Measured on --stage-tile: #E7444A is 4.21:1, BELOW
                              AA's 4.5:1; #FCA5A5 is 8.75:1. (On --stage-tile-2
                              #E7444A is worse still, 3.89:1.) Deliberate,
                              disclosed colour change on three sites — see
                              decision 6. */
```

Switch **three** sites — `CallStage.css:279` (`.stage-plate-mic.is-muted`), `:460`
(`.stage-conn.is-poor`), `CallUI.css:192` (`.p2p-plate-mic.is-muted`).

**`CallStage.css:564` (`.stage-tip.is-poor`) KEEPS `--danger`.** `.stage-tip` sets
`background: var(--canvas)` at `CallStage.css:480` — it is a theme-adaptive surface, not stage ground,
and `tokens.css`'s `--stage-*` comment already applies the identical carve-out to `--online`. Putting
a stage token on it would put a dark-ground colour on a light-ground popover.

Then add the dark override:

```css
[data-theme="dark"] {
  --danger: #FCA5A5;
}
```

**Record the corrected census.** RESUME §6c says M4 introduced "the tree's **only two** uses of
`--danger` as a foreground". Measured: **8** `color: var(--danger)` sites — the two named
(`primitives.css:695` `.context-menu-item.is-danger`, `Settings.css:73` `.settings-nav-logout`) plus
`CallStage.css:279,460,564`, `CallUI.css:192`, `ChannelSidebar.css:458`
(`.voice-participant-mic.off`), `MessageRow.css:130` (`.msg-mention-everyone`). Plus 14 `background`
sites; 22 CSS consumers total.

After this step the two sites the record *does* name stop shifting `#E7444A` → `#FCA5A5` on hover in
dark.

- [ ] **Step 4: `.setting-warning` — the light-theme fix**

**The recorded mechanism is false; re-read before acting.** RESUME §6c says the surface "lost its dark
tint — `--yellow-50` has a dark override, `--canvas-2` does not." Measured at `Settings.css:142–152`:

```css
.setting-warning {
  border: 1px solid var(--warning);
  background: var(--canvas-2);
  color: var(--warning);
}
```

It **does not reference `--yellow-50` at all**, and **`--canvas-2` DOES have a dark override**
(`tokens.css:146`, `#151926`). Computed contrast: light `#F59E0B` on `#F6F7FB` = **2.01:1** (which is
exactly the recorded figure — the *ratio* was right and only its *mechanism* was wrong); dark
`#F59E0B` on `#151926` = **8.16:1**, comfortably AA.

**The deficiency is light-theme-only.** Add a light-side foreground token and use it for `color`
**only** — the `border` stays on `--warning`, because a 1px border is not text and the amber border is
the surface's whole visual identity:

```css
  --warning:      #F59E0B; /* border + the dark-theme foreground */
  --warning-text: #B45309; /* light-theme foreground: 4.69:1 on --canvas-2.
                              --warning itself is 2.01:1 there. NO dark override
                              needed — #F59E0B on dark --canvas-2 is 8.16:1. */
```

`#B45309` is **measured at 4.69:1**, not asserted. If the probe disagrees, `#A16207` measures 4.60:1
as a fallback; anything lighter than those fails. Verify in **both** themes — the dark side must not
regress, and it takes no override, so the probe should show dark unchanged at 8.16:1.

This surface carries the NC-unsupported and mic-permission messages.

- [ ] **Step 5: `--hl-bg` / `--hl-ink` at both ends**

`--hl-ink` is **byte-identical to `--ink` in LIGHT** (both `#101322`, `tokens.css:45` vs `:16`), so
`mark { color: var(--hl-ink) }` is **inert in light** and reads as an intentional value when it is
not one. Set a light `--hl-ink` that is genuinely distinct on `--hl-bg` `#FEF3C7`.

**The dark end is a ruling, not an action.** The dark pair are interpolations because **the board
gives no dark highlight pair at all** — there is nothing to migrate toward, and inventing one in the
final milestone would be a planner substituting for the board. **Keep the dark interpolations, and
record that as the decision** rather than leaving `/* refine in M6 */` to imply unfinished work. Drop
the marker on both regardless: a marker naming the milestone it survived is a false comment.

*(This is why step 6's board-`2d` review list excludes the pair — not an oversight.)*

**The probe cannot assert this on a `mark` element.** `mark` carries **UA-origin declarations for
both `color` and `background-color`** — measured `rgb(0,0,0)` on `rgb(255,255,0)` in **both** light
and `color-scheme: dark` (Chrome 150). So "background is transparent" can never fire and "colour
differs from surrounding text" passes **even when the declaration is deleted**. Assert on a scratch
`<div>` carrying the highlight class instead.

- [ ] **Step 6: The remaining `/* refine in M6 */` markers**

`tokens.css` dark block carries them on `--own-msg-bg`, `--muted-2`, `--canvas-2`, `--canvas-3`,
`--chip-bg`, `--track-bg`. Review each against board `2d`, adjust or keep, and **delete the marker
either way** — a marker surviving the milestone it names is a false comment.

- [ ] **Step 7: The 2 `csstools/value-no-unknown-custom-properties`**

`UserList.css:111,112` write bare `var(--avatar-color)` inside `color-mix()`. `--avatar-color` is
JS-injected (`Avatar.tsx:32`) so `importFrom` cannot see it. Add fallbacks:
`color-mix(in srgb, var(--avatar-color, var(--accent)) 30%, transparent)`.

**Note the adjacent hazard and do not trip it:** `--avatar-bg` and `--avatar-ink` are declared at
`UserList.css:106,107,111,112` and consumed **only** from `Avatar.tsx:33,34`. **No CSS file `var()`s
either name**, so renaming either breaks the member list's avatars with no lint error, no type error
and no failing test. Touch the values, never the names.

**Update `client/CLAUDE.md` §1 in THIS commit, not at task 13.** That file documents these two lines
as a **live** violation of its own rule and says so explicitly: *"Fix it as M6 work, and update the
root file in the same commit."* Fixing them here while deferring the doc to task 13 would leave the
committed contract false on disk for ten tasks. Update `client/CLAUDE.md` §1 and the root
`CLAUDE.md`'s gate figure together with the fix; task 13 updates them again for the alias block.

- [ ] **Step 8: The 1 `no-duplicate-selectors` — SUPPRESS it, do not merge it**

**Do not "merge the duplicated rule by hand".** Measured: the warning is
**`tokens.css:235`, `Duplicate selector "[data-theme="dark"]", first used at line 126`** — the
duplicate is **the alias block's own trailing dark rule**. Merging it into the canonical dark block
would:
- move the 3 alias dark overrides **out** of the alias block, so the sentinel reads **47 / 47** and
  contradicts this task's own closing expectation of 47 / 50; **and**
- put them outside task 13's deletion range, so `--brand-subtle`'s dark override survives the
  deletion — changing Auth's dark focus ring **ten tasks before** decision 14 migrates it.

Suppress instead, so the warning dies with the block it belongs to:

```css
/* stylelint-disable-next-line no-duplicate-selectors -- deliberate: this rule is
   part of the LEGACY ALIASES block and is deleted whole in M6 T13. Merging it
   into the canonical dark block at :126 would move three alias overrides out of
   the block and out of T13's deletion range. */
[data-theme="dark"] {
```

**This changes the lint trajectory: task 3 closes at 51, and task 13 clears this warning by deleting
the rule rather than by fixing it.** The three expectations — lint 51, sentinel 47/50, and task 13's
deletion range — cannot all hold under a merge; they all hold under a suppression.

- [ ] **Step 9: Gates, sentinel, residue, commit**

Lint must be **51** (43 class-pattern + 8 descending-specificity). Colour probe re-run in both themes;
**the baseline diff is now expected to show deliberate changes** — enumerate every changed token in the
report with its reason. Sentinel still `47 unique / 50 declarations`.

---

## Task 4: `primitives.css` reopened

**Files:** Modify `src/styles/primitives.css`, `src/components/UpdateBanner.css`

- [ ] **Step 1: Fail-first**

Assert `document.styleSheets` contains a `.modal .channel-type-options` rule (positive precondition)
and that `.panel-icon-btn.is-off:hover` computes the same colour as `.panel-icon-btn.is-off` at rest
(the defect). Both must hold pre-task.

- [ ] **Step 2: Delete the dead `.channel-type-options` block**

`primitives.css:442–499` — **7 rules, no TSX emitter anywhere in `src/`** (re-verified; orphaned by
commit `4674032`, *before* M4 began, when VYC-77 dropped `channels.type`). Re-measure the line range
before cutting; tasks 2 and 3 did not touch this file, but verify.

- [ ] **Step 3: Correct the `modal-in` consumer comment — the same change, not a follow-up**

The keyframe-consumer comment at **`:355`** lists `modal-in`'s live consumers as
«`.modal` and the radio `::after`» — and **that `::after` is `:492`, inside the block step 2 just
deleted**. Leaving it would create a false comment in the milestone that deletes its referent. The
comment's own text says it was «RE-DERIVED … every line number below was re-checked, not carried
forward» — honour that: re-derive with
`rg -n 'fade-in|scale-in|modal-in' src/` and rewrite from the result.

- [ ] **Step 4: `.panel-icon-btn.is-off` hover**

`.panel-icon-btn:hover` (0,1,0) sets colour only and **loses to `.is-off`** (0,2,0), so an off button
visibly does nothing on hover. An M1 item, still open. Fix by raising the hover selector's
specificity — `.panel-icon-btn.is-off:hover` — **not** by adding `!important`.

- [ ] **Step 5: `.update-banner-dismiss` loses its own override on hover**

(0,1,0) against `.btn-ghost:hover`'s (0,2,0), which wins **regardless of source order**, so the button
reverts to exactly the state its comment says the override prevents. Fix the specificity and correct
the comment.

**Do not lean on source order here.** Component CSS reliably wins *equal-specificity* ties against the
base layer (proven in dev and in the production bundle), but M5.5 R6.1 found the lightbox scrim
winning **only** because of `main.tsx`'s import order and re-anchored it on specificity. Source order
is a fact you may use to diagnose; specificity is what you ship.

- [ ] **Step 6: Gates, sentinel, residue, commit**

Lint stays **51**. **Restart the dev server before probing** — this task edits `primitives.css`, and
Vite HMR can re-inject a changed base-layer file *after* component CSS and invert the cascade.

---

## Task 5: Accessible names and ARIA

**Files:** Modify `src/components/settings/{AudioSettings,VideoSettings,ProfileSettings,AppearanceSettings}.tsx`,
`src/components/{AudioPlayer,VideoPlayer,VolumeControlPopover,AvatarCropModal,ChatArea,CommandPalette}.tsx`,
`src/i18n/locales/{ru,en}.ts`

**Interfaces:**
- **Consumes** existing `settings.*` i18n keys wherever one already names the control (decision 4).
- **Produces** new ru+en key pairs only where no existing key fits.

- [ ] **Step 1: Fail-first — `probe-a11y-names.js`**

For every one of the 15 sites, compute the accessible name via `aria-label` →
`aria-labelledby` → wrapping `<label>` → `title`, and `fail()` on empty. Also assert the level meter
has no `role`. Run pre-task; expect **15 failures + 1**.

- [ ] **Step 2: The 11 Settings-pane sites**

4 checkboxes `AudioSettings.tsx:103,121,139,214` · 1 range `:156` · 5 selects `VideoSettings:16`,
`ProfileSettings:116`, `AudioSettings:262,277`, `AppearanceSettings:19` · 1 level meter `:234`.

Each already sits beside a `.setting-row-title` rendering a `t('settings.…')` key — **reuse that key**
rather than adding one. Example, for the volume slider whose row title is `t('settings.volume')`:

```tsx
<input
  type="range"
  className="slider-input"
  aria-label={t('settings.volume')}
  min="0" max="1" step="0.05"
  …
/>
```

**Correct the record in the report:** RESUME §6c says "2 range sliders" on the Settings panes.
There is **1**.

- [ ] **Step 3: The level meter (decision 4's second half)**

`AttachmentTray.tsx:63` is the tree's only existing `role="progressbar"` and establishes the pattern —
but **it is a precedent for the role, not a template to copy literally**: it carries only
`role="progressbar"` and `aria-valuenow`, with no `aria-valuemin`/`aria-valuemax`/`aria-label`. The
snippet below is the complete form; use it, and consider back-filling the tray's own attributes if
task 5 has room.

```tsx
<div
  className="level-meter"
  role="progressbar"
  aria-valuenow={Math.round(level * 100)}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-label={t('settings.inputLevel')}
>
```
`settings.inputLevel` already exists — `AudioSettings.tsx:239` renders it as the caption.

- [ ] **Step 4: The 4 sliders outside the panes (decision 16)**

`AudioPlayer.tsx:54`, `VideoPlayer.tsx:79`, `VolumeControlPopover.tsx:81`, `AvatarCropModal.tsx:209`.
Add new ru+en key pairs where none fits, e.g. `chat.seekPosition`, `chat.playerVolume`,
`call.participantVolume`, `profile.cropZoom`. **Both dictionaries in the same edit** — `ru.ts` ends
with `export type Dictionary = typeof ru` and `en.ts` is declared `export const en: Dictionary`, so a
key in one and not the other is a **`tsc` error**, which is the real parity gate.

- [ ] **Step 5: The chat column's missing `h1`**

The chat column has **no `h1` at all** — the only `<h1>`s in `src/` are `LoginPage.tsx:44`,
`RegisterPage.tsx:53`, `ErrorBoundary.tsx:45`.

**Be precise about which element, because there are two and they are different states.**
`ChatArea.tsx:41` is the **empty-state** title (`.chat-empty-title`); the **persistent channel header**
is a separate element that renders whenever a channel is open. A document should carry exactly one
`h1` in **both** states, so:

- **The persistent channel header becomes the `h1`** — it is the document's subject whenever a channel
  is open, which is the overwhelmingly common state.
- **`.chat-empty-title` stays an `h2`.** It renders only when no channel is selected; promoting it too
  would give the no-channel state an `h1` that names an absence, and promoting *both* would produce
  two `h1`s whenever the empty state renders inside an open channel.

Verify no CSS rule keyed on the old tag is orphaned, and assert in the probe that **exactly one `h1`
exists in each of the two states** — not merely that one exists.

- [ ] **Step 6: The palette's ARIA tree**

`role="option"` sits inside **unroled** `.palette-group` divs, and `aria-expanded` is computed from
selectable rows while status rows render. Keyboard navigation works; the semantics are approximate.
Give each group `role="group"` with an `aria-labelledby` pointing at its header, and compute
`aria-expanded` from the rendered row set. **Do not restructure the keyboard model** — M5 shipped it
and it works.

- [ ] **Step 7: Gates, sentinel, residue, commit**

`npx tsc --noEmit` is the gate that proves ru/en parity. `npm run check:i18n` must stay at **zero
warnings** — M4 earned that, and it is a heuristic (its own header says so), not the proof.

---

## Task 6: Reduced-motion policy

**Files:** Modify `src/styles/base.css`, `src/components/ChannelSidebar.css`

- [ ] **Step 1: Fail-first — and this probe must assert BOTH halves (decision 17)**

`base.css:85`'s blanket block **already kills fades** with
`animation-duration: 0.01ms !important` + `animation-iteration-count: 1 !important` +
`transition-duration: 0.01ms !important` on `*, *::before, *::after`. So this clause **loosens a
hammer into a policy** — strictly riskier than adding coverage, because the failure mode is *motion
returning*, not *motion not being suppressed*.

`probe-reduced-motion.js` must therefore assert, under `--focus-emulation`-free emulated
`prefers-reduced-motion: reduce`:
1. **Loops stopped** — each of the four `infinite` animations has `animation-play-state: paused` or an
   iteration count of 1.
2. **A named entrance still animates opacity** — mount a `.modal` and assert its computed
   `animation-name` is `modal-in` **and** its `animation-duration` is >0.01ms.

A probe asserting only (1) passes on today's hammer and cannot detect the regression this task risks.

- [ ] **Step 2: Rewrite `base.css:85` as a policy**

Target the four loops by name rather than `*`, and leave one-shot entrances alone. The four `infinite`
declarations are exactly (measured, comments stripped): `stage-eq-bar` 0.7s
(`CallStage.css:304`), `p2p-pulse` 2.5s (`CallUI.css:43`), `chat-shimmer` 1.2s
(`ChatArea.css:220`), `message-search-spin` 0.7s (`MessageSearch.css:175`).

**`p2p-pulse` IS the incoming-call pulse** — it animates `.p2p-modal-tile`. The older "five loops"
list double-counted it; there are four.

Keep `transition-duration` suppression for movement but preserve opacity transitions.

- [ ] **Step 3: Reconcile the second, pre-existing block**

**`ChannelSidebar.css:227–236` is already a `prefers-reduced-motion` block** — it sets
`transition: none` on `.channel-join-voice` / `.channel-join-voice-label` and `transform: none` on
`:active`. The record never mentions it, so this clause is **not greenfield**. Decide whether it is
subsumed by the new policy; if so delete it, if not leave it and say why in the comment.

`CallStage.css:297` carries a comment anticipating this sweep — re-read it and keep it accurate.

- [ ] **Step 4: The ≤250ms animation-budget audit**

Enumerate every `animation:` and `transition:` duration in `src/**/*.css`. Observed durations are
0.08–0.22s; `--transition` is `0.16s var(--ease-out)`. The only legitimate exceedances are the four
loops plus the one-shot `msg-jump-flash` 2.2s. `primitives.css:715` records the one deliberate retune
(0.3s → 0.22s) with its reason — leave it. **`linear` is correct only for continuous-value fills**
(`primitives.css:272` `.level-meter-fill`, `AttachmentTray.css:83` upload progress); flag any other
`linear`.

- [ ] **Step 5: Gates, sentinel, residue, commit**

Restart the dev server — this task edits `base.css`.

---

## Task 7: The 900px migration

**Files:** Modify `src/pages/AppPage.css`

- [ ] **Step 1: Fail-first**

At viewport width 850, assert the desktop sidebar-collapse rules apply (they should, pre-task, since
the boundary is 769) and the mobile panel rules do not. Post-task both flip.

- [ ] **Step 2: Migrate the pair, and only the pair (decision 5)**

Task 2 already converted these to range syntax. Change the boundary:

```css
@media (width >= 900px) { …the sidebar-collapse rules… }   /* was min-width: 769px */
…
@media (width <= 899px) { …the entire mobile single-panel model… }  /* was max-width: 768px */
```

**Leave the other 17 blocks at 768** — enumerated in decision 5. Add a comment on each of the two
blocks recording that the pair moved and the component blocks deliberately did not.

- [ ] **Step 3: Record the consequence this creates for task 8**

`.chat-members-btn` is **inert above 768px**: `AppPage.tsx:659` **always** passes `onShowMembers`,
which sets `mobilePanel`, but every `data-mobile-panel` rule (`AppPage.css:117–141`) lives inside the
block this step just widened. **Migrating the breakpoint alone therefore *widens* the dead range to
900px.** Task 8 closes it — do not ship task 7 as the end of the story, and say so in the report.

Note the defect's two halves sit in blocks written in two different notations: the button's own sizing
rule is at `ChatArea.css:349`, already `@media (width <= 768px)` and **not** part of the pair.

- [ ] **Step 4: Gates, sentinel, residue, commit**

---

## Task 8: The band system and the member-list toggle

**Files:** Modify `src/pages/AppPage.css`, `src/components/{UserList,ChatArea,MessageRow,CallUI,CallStage}.css`,
`src/pages/AppPage.tsx`

**Interfaces:** **Consumes** task 7's 900px pair. **Produces** the spec's four bands.

- [ ] **Step 1: Fail-first — `probe-bands.js` at FIVE widths, and 950 is the load-bearing one**

Drive `--size WxH` at **1280×900**, **1100×900**, **950×900**, **850×900** and **600×900**, asserting
the exact column set at each. Pre-task, the member-list band does not exist and 850 shows a dead
members button.

**950 exists because the plan's own first sketch was wrong there and its own first probe could not
see it.** A four-width probe at 1280/1100/850/600 steps straight over the 900–999 gap, so it would
have gone green on a layout that showed more columns at 950px than at 1100px. Assert **explicitly**
that the column count is monotonic across the five widths — never increasing as the viewport narrows.
A band probe that samples only inside the bands it knows about cannot discover a band it does not.

- [ ] **Step 2: The four bands (spec §5)**

Spec §3's target widths are **rail 76 / sidebar 252 / chat flex / member list 236** (the pre-redesign
values were 72 / 260 / flex / 240). Express the bands in range syntax, in `AppPage.css`, adjacent to
the pair task 7 migrated:

```css
/* ≥1200: all four columns. This is the base layout — no media query needed;
   the bands below are subtractive. */

/* 900–1199: member list leaves the flow and is revealed by .chat-members-btn.
   The LOWER BOUND IS 900, NOT 1000 (decision 22). Spec §5 names 1000–1200 and
   is silent on 900–999; bounding this at 1000 would let all four columns
   return at 900–999, i.e. MORE columns at 950px than at 1100px. 900 meets the
   mobile model exactly, leaving no gap. */
@media (900px <= width < 1200px) {
  .app-layout .user-list { display: none; }
  .app-layout[data-members-open="1"] .user-list { display: flex; }
}

/* <900: the mobile single-panel model that task 7 moved to `width <= 899px`
   owns this range. Per decision 23 this SATISFIES spec §5's "sidebar drawer"
   clause as a RECORDED DEVIATION from board 1f — it is panel-switching, not a
   drawer. Do not add a competing rule here; extend the existing block, or the
   two will fight on specificity. */
```

**Do not add a fifth boundary.** `<640px` is already served by `CommandPalette.css:223` and
`CallStage.css:763`; the mobile layout below 640 is M2's and ships as-is.

**Verify no rule ends up depending on source order to win.** Component CSS beats primitives at equal
specificity by import order, but M5.5 R6.1 found a scrim winning *only* because of that and re-anchored
it on specificity. Ship specificity.

- [ ] **Step 3: Make `.chat-members-btn` live in the 1000–1200 band**

This is the natural home for the spec's member-list toggle and it closes the dead range task 7
widened. The button must toggle the member list on desktop in that band while keeping its existing
mobile-panel behaviour below 900.

- [ ] **Step 4: Bound `@media (hover: none)`**

Two blocks — `ChannelSidebar.css:203` and `MessageRow.css:214` — have **no width bound**, so a
touch-capable *wide* screen gets the always-visible message action row. Add a width bound consistent
with the new bands.

- [ ] **Step 5: The three recorded responsive defects**

- `.p2p-modal`'s hard `width: 340px` (`CallUI.css`) — make it fluid with a max.
- The top-bar title truncating to `#g…` at 390–420px.
- `.msg-action-btn` at **28×28** against the board's ≥40px touch floor. It **clears WCAG 2.5.8's 24px
  minimum**, so this is a **shortfall against the board, not an accessibility violation** — size it up
  inside the touch media block and say which standard each number answers to.

- [ ] **Step 6: Gates, sentinel, residue, commit**

---

## Task 9: Class renames — the proving run

**Files:** Modify `src/components/UserList.css`, `src/components/UserList.tsx`,
`src/components/TitleBar.css`, `src/components/TitleBar.tsx`, `<tools>/*.js`

**Interfaces:** **Consumes** `selector-sweep.mjs` from task 1. **Produces** the sweep's first
validated use, at minimum blast radius (decision 18).

- [ ] **Step 1: Fail-first — `probe-classnames.js`, paired preconditions**

For each renamed class, assert **present → act → absent**, never a bare negative. A bare
`!document.querySelector('.x')` goes permanently true the moment `.x` is renamed — which is exactly
how M5.5's `.lightbox` rename silently disarmed two probes.

- [ ] **Step 2: Run the sweep and confirm the measured radius**

```bash
node <tools>/selector-sweep.mjs --class offline --class list --class username --class close
```
Expected: **13 lint errors** across the two files; emissions at `UserList.tsx:122,124,127` and
`TitleBar.tsx:31`; harness selector sites `.username` 4, `.list` 1, `.close` 0, `.offline` 0 = **5**;
**0 `classList` sites; 0 test-file sites**.

- [ ] **Step 3: Rename**

`UserList.css` (12 errors at `:45,50,54,80,89,105,110,115`) and `TitleBar.css` (1 at `:32`):

| old | new | note |
|---|---|---|
| `.user-item:not(.offline)` | `.user-item:not(.is-offline)` | state modifier |
| `.user-avatar.list` | `.user-avatar-list` | variant, not state |
| `.username` | `.user-name` | needs a component prefix |
| `.title-bar button.close` | `.title-bar button.title-bar-close` | needs a component prefix |

`.user-avatar.list` also appears as `className="user-avatar list"` on the shared `Avatar` component
(`UserList.tsx:124`) — check `Avatar.tsx` appends rather than replaces the `className` prop before
assuming the emission site is the only one.

- [ ] **Step 4: Sweep the harness in the SAME task**

Re-point all 5 selector sites. **`.superpowers/` is gitignored and nothing gates `tools/*.js`**, so a
missed selector produces no error and no failing test — the probe just stops being able to fail.

- [ ] **Step 5: Re-run `probe-shell.js` and `probe-sidebar.js`**

Task 1 gave them real gates precisely so this task has something that can fail. Confirm they still
pass, and confirm by counterfactual that they *would* fail: revert one rename, observe the throw,
restore, prove restoration with `git diff --exit-code`.

- [ ] **Step 6: Gates, sentinel, residue, commit**

Lint **51 → 38**.

---

## Task 10: Class renames — `ServerList` and `ChannelSidebar`

**Files:** Modify `src/components/{ServerList,ChannelSidebar}.{css,tsx}`, `<tools>/*.js`

**Interfaces:** **Consumes** task 9's validated sweep. These two files **cannot be split** — they
share `.active`.

- [ ] **Step 1: Fail-first, paired preconditions, as task 9**

- [ ] **Step 2: Run the sweep; expect the large radius**

```bash
node <tools>/selector-sweep.mjs --class channel --class active --class small \
                                --class current --class off --class home --class add --class search
```
Expected: **30 lint errors**; emissions at `ServerList.tsx:45,55,76,80` and
`ChannelSidebar.tsx:209,233,250,278`; harness **72 sites** — `.channel` 45, `.active` 11 selector + 9
`classList`, `.search` 3, `.add` 2, `.small` 1, `.home` 1; `.current` and `.off` **0**.

**Sanity-check the instrument before trusting it here.** Token grep reports `channel` at 254 TSX /
246 harness hits — almost all `channel.id`, `channelId`, `CurrentChannelID`. If the sweep's numbers
drift toward the token-grep numbers, the sweep is broken; stop.

- [ ] **Step 3: Rename**

`ServerList.css` (14 errors at `:54,63,69,73,90,95,100,105,198,217,232,237,243`) and
`ChannelSidebar.css` (16 at `:99,113,163,172,178,238,243,250,255,274,352,375,457`):

| old | new |
|---|---|
| `.server-icon.active` | `.server-icon.is-active` |
| `.server-icon.home` / `.add` / `.search` | `.server-icon-home` / `-add` / `-search` |
| `.channel` | `.channel-row` |
| `.channel.active` | `.channel-row.is-active` |
| `.user-avatar.small` | `.user-avatar-small` |
| `.voice-card.current` | `.voice-card.is-current` |
| `.voice-participant-mic.off` | `.voice-participant-mic.is-off` |

`.channel` → `.channel-row` is the largest single change: 45 harness selector sites and one emission
(`ChannelSidebar.tsx:250`, `` className={`channel${isActive ? ' active' : ''}`} ``).

- [ ] **Step 4: Sweep the harness — all 72 sites, including the 9 `classList` calls**

`classList` arguments carry **no leading dot**, so a dot-anchored regex misses them entirely. Sweep
both forms.

- [ ] **Step 5: Counterfactual**

Revert one rename in each file, observe both probes throw, restore, prove with
`git diff --exit-code`. Never commit the broken state.

- [ ] **Step 6: Gates, sentinel, residue, commit**

Lint **38 → 8** (`no-descending-specificity` only). If a rename *created* a new
`no-descending-specificity`, record it — the count is a projection, and E2 requires measuring both
ends.

---

## Task 11: Structural — overlays, fullscreen, Escape

**Files:** Modify `src/components/CommandPalette.tsx`, `src/hooks/{useModalFocus,usePaletteHotkey}.ts`,
`src/components/{ContextMenu,VolumeControlPopover,ScreenSharePicker}.tsx`,
`src/hooks/useFloatingSelectionToolbar.ts`, `src/styles/{tokens,primitives}.css`,
`src/components/{CallUI,CallStage,CallNotifBanner,CommandPalette,ErrorBoundary,FloatingQuoteButton,ScreenSharePicker,UpdateBanner,VolumeControlPopover}.css`

- [ ] **Step 1: Fail-first — the fullscreen palette**

The call stage's fullscreen has **two** dead ends, not one:
- **(a) the CSS variant** — `AppPage.css:67–72` sets `display: none` on `.chat-area`, so a palette
  chat command lands hidden.
- **(b) the Fullscreen-API variant, which is worse** — `CallStage.tsx:75–78` promotes `.call-stage`
  to the **top layer**, and the palette mounts as a sibling of `.app-layout`, so it **paints behind
  the backdrop — invisible** — while still mounting, trapping focus and flipping
  `isBlockingOverlayOpen()` true, which then blocks ⌘K from reopening it and kills Ctrl+Shift+F.

Probe both. Note `--click` is `el.click()` with **no user activation**, so anything gated on transient
activation (notably `requestFullscreen`) rejects on that path — `userGesture: true` exists only at the
probe-eval call site, and `--probe2`/`--probe3` each run in their own `Runtime.evaluate`, which is the
only way to spend more than one activation.

- [ ] **Step 2: Fix (b) — portal the palette into the fullscreen element**

**The codebase already solves this elsewhere** — `CallStage.tsx:106–110` re-parents the quality
tooltip into `document.fullscreenElement` on hover. Generalise it: portal the palette into
`document.fullscreenElement ?? document.body`, recomputing on `fullscreenchange`.

Chromium keeps a **fullscreen element stack**, and the viewport resizes a frame *after*
`fullscreenchange` — settle before measuring.

- [ ] **Step 2b: Fix (a) — exit CSS fullscreen on palette chat navigation (decision 24)**

`AppPage.css:67–72` sets `display: none` on `.chat-area` in the CSS-fullscreen state, so a palette
chat command lands on a hidden column. When a palette command navigates to chat, clear that state.

**This step exists because step 1 probes both dead ends.** An earlier draft probed both and fixed only
(b), which left the task unable to close: its own fail-first would still have failed afterwards. A
task whose probe asserts more than its steps deliver is a task that must either grow the fix or narrow
the probe — never one that ships with a known-failing assertion re-labelled as expected.

- [ ] **Step 3: Close the `isBlockingOverlayOpen()` hole**

```ts
modalStack.length > 0 ||
document.querySelector('.modal-overlay, .screen-picker-backdrop') !== null
```
The DOM half is **load-bearing** until app-wide `useModalFocus` adoption — it holds only while every
modal renders `.modal-overlay`, true today across all **13** renderers against **5** adopters. But the
invariant is a **convention, not a contract**, and was already broken twice:
`.screen-picker-backdrop` is hard-coded into the selector for exactly that reason, and VYC-82's
`MediaLightbox` did it again.

**Take the second option: add a check that every fixed-inset blocking scrim carries
`.modal-overlay`.** The two are **not** equal-cost, and an earlier draft's "pick one and say which"
wrongly implied they were. Deleting the DOM half requires all **8** non-adopter modals to adopt
`useModalFocus` — files outside this task's list, each gaining a Tab trap, `[data-autofocus]`
behaviour and focus restore, late in the final milestone. That is a new behavioural surface, not a
cleanup. The scrim check is small, closes the hole this task is about, and leaves the adoption
sweep as an honest backlog item.

If you disagree after measuring, say so with the measurement — but do not size option A by assumption.

**M5.5's CF-4b is the counterfactual that matters:** removing the `useModalFocus` call while keeping
the class left **the ⌘K gate still passing** — the class alone satisfies the gate. A probe asserting
only ⌘K would ship a lightbox with no Escape.

- [ ] **Step 4: The five non-stack-aware document Escape listeners**

**The record's line numbers are stale — re-measured 2026-08-30:**

| listener | record says | actually |
|---|---|---|
| `ContextMenu.tsx` | `:35` | **`:38`** |
| `VolumeControlPopover.tsx` | `:57` | **`:61`** |
| `ScreenSharePicker.tsx` | `:24` and `:88` | **`:26` and `:90`** |
| `useFloatingSelectionToolbar.ts` | `:67` | **`:77`** |

`useDismissOnOutside` is **now stack-aware** (M5.5 T4) and is **not** on this list. Route the five
through the modal stack so Escape closes only the top-most surface.

- [ ] **Step 5: Rule on `Ctrl+K` deliberately**

`usePaletteHotkey.ts:16–17` calls `e.preventDefault()` **before** the gate, unconditionally, so
`Ctrl+K` is swallowed in every text field app-wide — including the composer, where on macOS it is
"kill to end of line". The existing comment explains why (an un-prevented ⌘K falls through to the
browser address bar). Largely inherent to the chord choice. **Rule deliberately and record the
ruling** — narrowing `preventDefault` to non-editable targets is the obvious middle path.

- [ ] **Step 6: The z-index token scale (decision 20)**

Add to `tokens.css` `:root`, on the same theme-invariant footing as the radii:

```css
  /* ── Layering ── Re-derived from the tree at M6 T11; 12 declarations across
     7 values. MediaLightbox deliberately declares none — it inherits
     --z-overlay from .modal-overlay (M5.5 T4 D8). Keep that. */
  --z-overlay: 1000;
  --z-menu:    1050;
  --z-popover: 1100;
  --z-palette: 1150;
  --z-tooltip: 1200;
  --z-toast:   2000;
  --z-crash:   9999;
```

Repoint all 12 declarations enumerated in decision 20. **Values do not change**, so the only
acceptable visual delta is none — verify by probing the paint order of a palette raised over a modal
over a context menu.

`.screen-picker-backdrop` at 1100 takes `--z-popover` and remains hard-coded in
`isBlockingOverlayOpen()`'s selector until step 3's ruling says otherwise. Note in the report that
tokenising the value does **not** fix the convention hole step 3 addresses — they are separate
problems on the same line.

- [ ] **Step 7: Gates, sentinel, residue, commit**

---

## Task 12: Cosmetics and test debt

**Files:** Modify `src/components/CallStage.css`, `src/pages/{AppPage.css}`,
`src/components/{EmojiPicker,ManageInvitesModal}.css`, `src/hooks/useModalFocus.ts`,
`src/utils/paletteFilter.ts`, `src/utils/paletteFilter.test.ts`,
`src/stores/__tests__/{messageStore,unreadStore}.test.ts`

- [ ] **Step 1: Collapse `.stage-thumbs` when the stage is short (decision 8)**

`CallStage.css:920–921` is `.stage-thumbs { height: 110px; … }`. At 1440×900 the stage is ~394px and
chrome is 56 (top bar) + ~101 (control bar) + **110 (thumbs)** = 267px — the strip is **41% of the
chrome** and the largest single lever.

**Do not** use `height: max(var(--call-stage-height, 55%), 75%)`: the drag handle clamps to 20–80% at
**`AppPage.tsx:139`** (`Math.min(80, Math.max(20, pct))`), so that rule collapses the effective range
inside a focus view to 75–80% and destroys the draggability the whole park relies on.

*(Backlog §2a cites `:130` for this clamp. **`:130` is the persistence guard**,
`saved >= 20 && saved <= 80 ? saved : 55` — a different expression with the same two numbers.
Re-measured 2026-08-30.)*

- [ ] **Step 2: The dead fallbacks**

- `--emoji-cols` at `EmojiPicker.css:24` — read as `repeat(var(--emoji-cols, 8), 1fr)` and **never set
  anywhere**, in CSS or JS. Its fallback is what hides it from lint.
- The `55%` fallback at `AppPage.css:27` — `--call-stage-height` is set **unconditionally** at
  `AppPage.tsx:643`.

Both read as guards that guard nothing. Remove the indirection or make the variable real; say which.

- [ ] **Step 3: `.invites-code` — re-derive before fixing**

It carries `overflow`/`text-overflow`/`white-space` that can never fire. M4 recorded the cause as a
wrapper that lost `flex: 1; min-width: 0` — **but the class name in the M4 note does not exist in the
file today.** Re-derive the wrapper selector from the current tree before touching anything.

- [ ] **Step 4: The remaining recorded cosmetics**

`msg-mention-role` is emitted with no matching CSS rule (pre-existing since before M2) ·
`msg-jump-flash` animates background to `transparent`, stripping an own-message row's tint for 2.2s ·
`.stage-focus-label` hard-clips with no ellipsis · `.stage-plate`/`.stage-state-chip` overlap by 8px
on a 265px tile · the share badge / focus button overlap at 641–768px (**never measured by anyone** —
measure it or say you did not) · `.stage-tip-arrow` no longer points at its chip when the tooltip is
clamped · `.stage-focus-ctrl-btn` is 36×36 against **M3's 40px touch floor** (M3's plan decision 22 —
*not* a decision in this plan; this plan's decision 22 is the member-list band) · a screen-share error
toast is invisible during focus fullscreen.

- [ ] **Step 4b: Replace the `▶`/`◀` glyph-icons with lucide chevrons (decision 25)**

`AppPage.tsx:610` renders `▶`/`◀` as glyph-icons — the **last emoji-as-icon in the tree**, excluded by
M1's own plan and open ever since. Replace with `ChevronRight`/`ChevronLeft`, `strokeWidth={1.8}`, an
explicit `size` matched to the neighbouring icon in that surface.

**Re-measure the line number before editing** — the record carried `:603` for this item until it was
corrected to `:610` on 2026-08-30, and tasks 7, 8 and 11 all touch `AppPage.tsx` before this one.

- [ ] **Step 5: `useModalFocus.ts` docstring — fix ONLY the half that is stale**

Re-measured 2026-08-30: **13 `.modal-overlay` renderers · 5 `useModalFocus` adopters · 8 others**.

The docstring already reads «ровно ConfirmModal, FindServerModal, Settings, CommandPalette и
MediaLightbox» and «остальные **восемь** модалок» — so **verify before editing**. A review during M5.5
proposed "5 and nine"; **nine is wrong**, and acting on it would have injected a *new* false claim
while fixing a stale one. If both halves already read 5 and 8, **change nothing** and record that.

- [ ] **Step 6: The test debt**

- `messageStore.test.ts`'s "can set and clear deliveryState" **never asserts the clear case** (~4 lines).
- `unreadStore.test.ts`'s "survives a corrupt payload" is **vacuous twice over** — it never reaches
  `load()`'s catch, which runs at **module import**, before any `beforeEach`. Low urgency: the failure
  mode is a throw at import, which breaks every dev run loudly.
- `paletteFilter.test.ts:117–129` **asserts a universal its own module does not satisfy** for
  status-bearing groups. It passes only because the fixture never builds one — a one-word change
  (`messagesLoading: true`) turns it **RED today**. Fix the module or narrow the assertion; say which.
- Extract `selectedIndexOf(rows, selectedId)` and `shouldShowEmptyState(model, query)` into
  `paletteFilter.ts` as pure functions with tests.

**Record the new test-count shape** — adding test files legitimately changes the totals, and every
later comparison is against the new shape. M5's own files are **19 / 4 / 6** (`paletteFilter` 19,
`paletteStore` 4, `searchSnippet` 6).

- [ ] **Step 7: Gates, sentinel, residue, commit**

Lint stays **8**.

---

## Task 13: Alias deletion — this IS the audit

**Files:** Modify `src/styles/tokens.css`, `src/pages/{Auth,AppPage}.css`,
`src/components/{ServerList,UserList,ChannelSidebar,TitleBar}.css`,
`src/components/settings/ProfileSettings.css`

**Interfaces:** **Consumes** the colour baseline (task 1) and the sentinel (decision 10).
**Produces** lint **0** and the spec §8 audit, as amended by §9.4.

- [ ] **Step 1: Understand why stylelint is the gate, and confirm the condition still holds**

`csstools/value-no-unknown-custom-properties` fires on a plain `color: var(--unknown)` — verified with
a positive control — and `importFrom` is scoped to `tokens.css` + `base.css`. So **deleting the 47
alias names makes every surviving reference a parse-based error that comments cannot fool.**

**Measured support the record does not have (Appendix A):** there are **zero** alias references in
`*.ts`/`*.tsx`, and **no canonical token depends on an alias**. So within `src/`, the alias surface is
**100% CSS**, which is what makes stylelint sufficient over `src/` rather than merely chosen.

**The one standing condition: a `var(--x, fallback)` silences the rule, and none of the 70 uses one.**
Re-verify, and **introduce none during the sweep.** A single fallback added in passing turns that site
silent.

**BUT stylelint cannot see the harness, and the harness DOES consume aliases.** The grand review
caught this and it is a genuine hole:

| site | what it does |
|---|---|
| `probe-palette-messages2.js:49` | `resolveVar('background-color', 'var(--brand-subtle)')` — an **expected value** |
| `probe-palette-messages2.js:50` | `resolveVar('color', 'var(--text-primary)')` — an **expected value** |
| `smoke.mjs:351` | `getPropertyValue('--bg-primary')` into every run's report |
| `probe-primitives-cascade.js:28,40` | `getPropertyValue('--radius-md')`, and a `br.includes('--radius-md')` branch |
| `probe-t13-toast.js:68` | `getPropertyValue('--radius-md')` |

`probe-palette-messages2.js` is one of the **five M5 palette probes RESUME §5 certifies as real
gates**. After this task deletes the 47 names, its two expectations resolve to nothing and the gate
**breaks or goes vacuous** — in a gitignored, ungated directory. That is mechanism-for-mechanism the
§6e disarm task 1 exists to repair.

**So task 13 sweeps `tools/` for all 47 names, under the same rule as the rename tasks.** Comment-only
hits (`probe-attachments.js:181`, `probe-callnotif.js:18`, `probe-t9-dropzone-error.js:7`,
`probe-screen-picker.js:11`, `probe-updatebanner.js:9`, `probe-server-menu.js:7`,
`probe-modal-sweep.js:400`) need no code change but **should be corrected** — a probe comment naming a
deleted token is a false comment in a file nothing gates.

> **Search the harness with `rg --no-ignore --hidden`, or use `grep`.** `.superpowers/` is
> **gitignored**, so a plain `rg` **silently returns nothing** and reports a false zero. This plan
> asserted "zero alias references in the harness" for exactly that reason, and the claim survived
> into a commit. **A false zero from a skipped directory is indistinguishable from a real zero.**

- [ ] **Step 2: Migrate the 28 live aliases**

**28 of the 47 names are referenced; 19 are dead and delete with no migration work.** The 70
references distribute `Auth.css` 30 · `ServerList.css` 19 · `AppPage.css` 7 · `UserList.css` 7 ·
`ChannelSidebar.css` 5 · `ProfileSettings.css` 2.

**Direct mappings** (the alias's own definition names the canonical target):

| alias | → | alias | → |
|---|---|---|---|
| `--text-primary` | `--ink` | `--bg-secondary` | `--panel` |
| `--text-secondary` | `--muted` | `--bg-elevated` | `--canvas` |
| `--text-muted` | `--muted-2` | `--brand-color` | `--accent` |
| `--text-inverse` | `--white` | `--brand-hover` | `--accent-hover` |
| `--border-color` | `--line-strong` | `--brand-50` | `--accent-soft` |
| `--border-subtle` | `--line` | `--brand-600` | `--accent` |
| `--bg-primary` | `--canvas` | `--green-50` | `--online-soft` |
| `--bg-base` | `--canvas-2` | `--green-color` | `--online` |
| `--bg-hover` | `--canvas-2` | `--red-50` | `--danger-soft` |
| `--shadow-lg` | `--shadow-menu` | `--red-600` | `--danger-text` |

**Radii** — map onto the canonical scale (6/9/10/11/13/14/16/18/999):
`--radius-sm` 6px → `--radius-chip` · `--radius-md` 9px → `--radius-row` · `--radius-xl` 16px →
`--radius-modal` · **`--radius-lg` 12px → `--radius-tile` 13px (decision 13, a +1px change on three
square-tile surfaces: `ServerList.css:208`, `:253`, `Auth.css:139`)**.

**The three non-mechanical migrations:**
- **`--brand-subtle`** (`Auth.css:67`) → replace the whole declaration with
  `box-shadow: var(--focus-ring);` (decision 14). This is the only alias whose **dark override**
  matters, and `--focus-ring` is the only canonical token that carries one.
- **`--brand-300` / `--brand-500`** (`ProfileSettings.css:36`) and **`--brand-400`**
  (`Auth.css:138`) → new `--accent-300` `#A5B4FC`, `--accent-400` `#818CF8`, `--accent-500` `#6366F1`
  on `:root` **only** (decision 15). They carry no dark override today; declaring them `:root`-only
  preserves that exactly.

**The 19 dead names**, deleted with no migration: `--bg-tertiary --bg-active --brand-100 --brand-200
--brand-700 --green-500 --green-600 --red-500 --red-color --yellow-50 --yellow-500 --yellow-color
--blue-500 --blue-color --text-link --shadow-sm --shadow-md --shadow-xl --radius-full`.

Note **no `--danger-color` token exists anywhere in the tree** — do not invent one.

- [ ] **Step 3: Delete the block**

`tokens.css:172–239` — the banner comment, the `:root, [data-theme="dark"]` rule at `:177–231`, and
the trailing `[data-theme="dark"]` rule at `:235–239` carrying the 3 dark overrides. **Re-measure the
range**; tasks 2, 3 and 11 all edited this file.

**All three dark overrides delete cleanly, so the block's deletion changes no dark rendering by
itself.** `--yellow-50` and `--brand-100` have **zero consumers** (both are in the dead 19), and
`--brand-subtle`'s single consumer is handled by decision 14, which replaces it with `--focus-ring` —
the one canonical token that carries its own dark override. The audit gate cannot tell you this,
because a name with no consumers produces no error; it is worth stating so a reader does not have to
re-derive it.

- [ ] **Step 4: Run the audit — and make it fail first**

Before deleting, **temporarily delete only one alias name** with live consumers (e.g. `--bg-hover`,
3 sites), run stylelint, and observe:
```
Unexpected custom property "--bg-hover"   csstools/value-no-unknown-custom-properties
```
That is the positive control proving the gate can fire. Restore, then do the real deletion.

- [ ] **Step 5: The raw-value half of the gate (spec §9.4)**

Scoped to `*.css` with a **permanently exempt** non-CSS allowlist: `utils/avatarColor.ts:5–12` (the
8-colour avatar palette §4.3 mandates), `AvatarCropModal.tsx:109,116` (`ctx.fillStyle` /
`ctx.strokeStyle`, which cannot read a CSS custom property), `Avatar.tsx:34` (the `#FFFFFF` fallback
in `var(--avatar-ink, #FFFFFF)`).

**Four CSS sites remain and are M6's:** `TitleBar.css:34` (`color: #FFFFFF` → `var(--white)`) and
`Auth.css:90,127,140` (three `rgba()` box-shadow/border values). Clear all four. **Strip comments
before grepping** — this is §8.1's trap and it produced a wrong census three separate times.

- [ ] **Step 6: The 8 `no-descending-specificity` (decision 21)**

**Test each with a positive control; never copy a justification.** The rule buckets by at-rule
context, so a top-level `:hover` and a rule inside `@media` are never compared — M2 and M3 each
disproved a copied instance, but **M4 tested a third and it fired**, as did M5.5's.

- [ ] **Step 7: Colour probe, both themes, against the committed baseline**

This is the milestone's most important verification. Every canonical token must still resolve, and
every **deliberate** change since task 1 must be enumerable. Deleting 47 names must change **nothing**
except the three disclosed deltas (decisions 13, 14, 15).

- [ ] **Step 8: Gates, sentinel, residue, commit**

```bash
npx stylelint "src/**/*.css" -f json 2>&1 | tail -1   # 0
node <tools>/alias-sentinel.mjs                        # 0 / 0
```

Update the gate tables in **`CLAUDE.md` (repo root)** and **`client/CLAUDE.md`** in this same commit —
both name 188 as a dated baseline, `client/CLAUDE.md` §1 documents the 2 `UserList.css` violations as
live (task 3 fixed them), and §1's alias-block description becomes historical. `client/CLAUDE.md`
explicitly asks for this: *"Fix it as M6 work, and update the root file in the same commit."*

---

## Task 14: Final visual QA

**Files:** none — evidence only.

- [~] **Step 1: Open the board** — *handed to manual QA (see `m6-visual-qa-index.md`). The bundle's
  ids were enumerated from the file (**eleven**: `1a 1b 1c 1d 1e 1f 2a–2e` — the list below omits
  `1a` and `1b`), and **no board draws the auth surface**, so three Step-3 deltas have no board
  reference at all. The side-by-side comparison itself is a person's job by ruling.*

`design_handoff_discord_redesign/Redesign.dc.html` in Chrome, and the app at **port 3000 exactly**,
side by side. Board option ids: `1c` main screen · `1d` modals/menus · `1e` call · `1f` mobile ·
`2a` empty states · `2b` unread/typing/avatars · `2c` ⌘K palette · `2d` dark theme · `2e` speaking
indication.

**This bundle is untracked on purpose — never `git add -A`.**

- [~] **Step 2: Per-screen, both themes** — *DESCOPED BY RULING, not skipped. Eleven ids × two themes
  is hours of capture to produce screenshots a person arbitrates faster by clicking. The dev-server
  requirement was still honoured and is the load-bearing half: vite restarted on :3000 at 14:20:43
  against a HEAD of 12:10:01, so nothing measured here came from a stale server. **`npm run dev`
  cannot start it in this environment** — Electron fails to launch and `concurrently -k` kills vite
  with it; use `npm run dev:vite`.*

Capture both themes for every board id. **`--out` is mandatory.** Restart the dev server first and
confirm no stale server predates HEAD — three were alive at M3 start and two mid-M4, and a stale
server invalidates every visual claim.

- [x] **Step 3: Check every disclosed delta, and carry the two board deviations** — *decision 13
  measured at both ends (**13px at 760px, 0px at 1440** — two of its three sites live inside
  `@media (width <= 768px)` and **do not exist at desktop**, so a desktop-only check reports "no
  change" and that reads as a pass). `.server-icon img` has no element on the smoke account and is
  labelled unread. The remaining deltas and both deviations are itemised for manual QA in
  `m6-visual-qa-index.md`. The line numbers below are stale — see that file.*

**Disclosed colour/geometry deltas:** `ServerList.css:208`, `ServerList.css:253`, `Auth.css:139` at
+1px radius (decision 13); the auth input focus ring at its new alpha (decision 14); both accent-ramp
gradients (decision 15); the **three** call-surface `--stage-danger` sites (decision 6); the call
stage's ten `--stage-accent` sites (decision 2); `.setting-warning`'s light foreground (task 3).

**Two rulings mean the board and the app will not match, and that is expected — carry them into QA
rather than discovering them here:**
- **Decision 23** — `<900px` ships the mobile single-panel model, **not** board `1f`'s drawer. A
  recorded deviation.
- **Decision 7** — board `1c`'s dark-theme ⌘K chip is **not** on the header search button, because
  that button opens the deep panel.

A QA pass that flags these as defects has not read its own plan; a QA pass that silently passes over
them has not read the board.

- [x] **Step 4: Label what cannot be measured, and give evidence for the "cannot"** — *two entries
  below were overstated and are narrowed in `m6-visual-qa-index.md`: `electron/dist` is **236K**, not
  292K, and only **packaged** behaviour is unmeasurable — the `electronAPI`-gated renderer branches
  are measurable and were measured. The falsified `--fake-media` amplitude range is not carried
  forward.*

**"X could not be measured because Y" must carry evidence for Y at the same standard as a claim that
X passed** — that phrasing reads as rigour and thereby suppresses "is Y true?". In all four M4
instances Y was false and a cheap measurement existed.

Known-unmeasurable in this environment, carried so nobody assumes otherwise:
- **Every Electron branch** — Electron cannot launch (npm 11's `allowScripts` skipped its postinstall,
  so `node_modules/electron/dist` is 292K instead of ~250MB; fixable with `npm install-scripts ls` in
  `client/`).
- **Remote participants, incoming calls, not-own-message rendering** — one test account. **A second
  test account remains the single cheapest improvement available to this project's verification
  story.**
- **The speaking ring has never been driven by a real voice.** And **the M3-era claim that
  `--fake-media`'s tone peaks at ~0.0065–0.0115 is measured FALSE** — it is a full-scale periodic beep
  every ~450ms and that range is its decay tail; the plan also compared a time-domain amplitude
  against a frequency-domain reader. **No brief may carry the 1%-rounding sentence forward.**
- Four attachment surfaces with no fixture: `AudioPlayer` entirely, `.video-play-btn`,
  `.video-mute-btn`, `.attachment-file*`.

- [x] **Step 5: Commit the evidence index** — *`docs/superpowers/plans/m6-visual-qa-index.md`.
  `.gitignore:44` is `.superpowers/`, so the working report is untrackable and cannot itself be the
  committed artifact; the index is tracked beside `m6-colour-baseline.json` and
  `m6-colour-deltas.json`, the only precedent in the tree. Also records the palette gate finally
  **running** (`--probe` + `--probe2` in ONE invocation — two runs fail on a precondition and look
  like T13's repair is broken).*

---

## Task 15: Closeout

**Files:** Create `docs/superpowers/plans/2026-08-30-redesign-m6-closeout.md`; modify
`docs/superpowers/REDESIGN-RESUME.md`, `docs/superpowers/backlog/post-redesign-backlog.md`

- [x] **Step 1: Write the closeout** — *`2026-08-30-redesign-m6-closeout.md`.*

Commit spine · every ruling with **who ruled it** and its cost · fail-first evidence per task · the
188 → 0 trajectory **measured at both ends at every step** · residue · corrections to our own record ·
what was reasoned rather than measured.

**Record every ruling in the ledger as it is made, and record who ruled it** — a reviewer reading only
the on-disk record must never see invented authority. The four human rulings 5–8 in this plan were put
to the human as explicit costed questions in the 2026-08-30 M6 planning session, as were **22–25**
after the grand review; **decisions 9–21 are
the planner's** and must not be attributed to the human.

- [x] **Step 2: Rewrite the RESUME for a post-M6 world** — *all five falsified claims corrected AT the line that carried them, not in a footnote. §0 now carries the integration decision instead of an execution prompt.*

State that all milestones have shipped, the branch is releasable, and what remains is the integration
decision. Carry forward the debt register minus everything M6 discharged. **Correct §6c's
`.setting-warning` mechanism, §6c's `--danger` foreground count, §7.2's "~117 declarations", §5's
`probe-composer.js` characterisation, and §6c's Escape-listener line numbers** — all falsified here
(Appendix A).

- [x] **Step 3: Update the backlog** — *§2a and §2b closed by decisions 8 and 2 (and its "12" is 10); §2c settled by manual QA; §3a's "only copy" and §3d's electron/`--fake-media` figures corrected; §2e and §2f added for what M6 declined; §6d's exclusion marked expired.*

Backlog §2b still says **12** stage accent sites — **it is 10**, and decision 2 closes the question
entirely. §2a closes via decision 8. Move anything M6 declined into §1 with its reason. **Backlog
§3a's claim that the harness is "the only copy" is false** — all six SDD workspaces hold one.

- [x] **Step 4: Transcribe before the session ends** — *the gitignored ledger's content lives in the closeout and the QA index; nothing load-bearing remains only in `.superpowers/`.*

The SDD workspace is gitignored and dies with the session; **anything not written into
`docs/superpowers/` is lost.**

- [x] **Step 5: Final gate sweep and commit** — *stylelint 0 bytes · `tsc` 0 bytes · `npm test` 3 failed/254 passed with `api.network-retry.test.ts` the only FAIL file · `check:i18n` clean. Commits `9bf7cd4` (code) and `ef9cd1e` (docs).*

- [~] **Step 6: Hand off the integration decision** — *handed off, NOT executed. Merging a trunk and opening a PR are outward-facing acts on shared history and are the human's call, not the agent's. The instruction is recorded in the closeout §10 and RESUME §0: merge `origin/develop`, PR into it, **never rebase**.*

Use `superpowers:finishing-a-development-branch`. **Integrate by merging `origin/develop` and then
opening a PR into it — do NOT rebase.** `redesign` is published at `origin/redesign` and its history
is shared. The old instruction *"rebase on `main` at that point (spec §8)"* is **superseded by spec
amendment §9.1** and must not be followed: `main` is not the trunk, and rebasing a published branch
rewrites shared history.

---

## Appendix A — corrections this plan makes to the durable record

Measured 2026-08-30 at `dc0a873`, comments stripped. Each falsifies a load-bearing claim.

| # | Claim in the record | Measured | Where it bites |
|---|---|---|---|
| **C1** | §7.2: the colour probe guards "`--fix`'s rewrite of **~117 declarations** in `tokens.css`" | **50 lines changed**; the 3 colour rules fire on **33 distinct declarations**; 48 distinct warning lines. Repo-wide, `--fix` takes **188 → 54** — 71% of the debt is mechanical | Task 2 |
| **C2** | §6c: `.setting-warning` "lost its dark tint — `--yellow-50` has a dark override, `--canvas-2` does not" | The rule **never references `--yellow-50`**, and **`--canvas-2` DOES** have a dark override (`tokens.css:146`). Light **2.01:1** (the recorded ratio was right; only its mechanism was wrong), **dark 8.16:1**. The defect is **light-only**; the remedy inverts | Task 3 |
| **C3** | §6c: M4 introduced "the tree's **only two** uses of `--danger` as a foreground" | **8** `color: var(--danger)` sites; 22 CSS consumers total. **3 sit on stage ground** and collide with ruling 2; a 4th (`.stage-tip.is-poor`) only looks like one — `.stage-tip` sets `background: var(--canvas)` at `CallStage.css:480` and is theme-adaptive | Decision 6, task 3 |
| **C4** | §5/§7: "both sides of the 768/769px pair migrate to 900", implying the 5 legacy blocks | **19** blocks sit at that boundary; **14 already use range syntax**. The *pair* is `AppPage.css:96`/`:102`, verified complementary. Notation and boundary are orthogonal | Decision 5, tasks 2/7 |
| **C5** | §6c/§7.4: the reduced-motion clause treats `base.css:85` as the only such block | **`ChannelSidebar.css:227–236` is a second, pre-existing `prefers-reduced-motion` block** | Decision 17, task 6 |
| **C6** | §5: `probe-composer.js` is "silently dead from line 193 down — 48 of 88 assertions have never executed" | It uses **deferred flush**, not throwing `fail()`. Counted by occurrence: **41 above `:193`, 48 at/below, 89 total** (`:17` is the definition, `check = (`, and contains no `check(`). The 41 above **execute but die with `out`**. Net **0 of 89** produce a readable verdict — and the failure is **loud** (`PROBE ERROR:`) | Decision 12, task 1 |
| **C7** | §6c: "on the Settings panes, 4 toggles, **2 range sliders** and 5 selects" | **1** range on the panes (11 sites total); **5** `type="range"` exist tree-wide | Decision 16, task 5 |
| **C8** | §6c: the five non-stack-aware Escape listeners at `ContextMenu.tsx:35`, `VolumeControlPopover.tsx:57`, `ScreenSharePicker.tsx:24`/`:88`, `useFloatingSelectionToolbar.ts:67` | **All five line numbers are stale**: `:38`, `:61`, `:26`/`:90`, `:77` | Task 11 |

**New facts with no prior claim to correct:**
- **Zero alias references in `*.ts`/`*.tsx`, and no canonical token depends on an alias.** Within
  `src/`, the alias surface is 100% CSS — which is what makes stylelint sufficient as the audit gate
  **over `src/`** (task 13).

> **C9 — a correction to THIS PLAN, found by the grand review.** An earlier version of the line above
> also claimed **"zero in the harness"**. **That is false.** The harness consumes aliases at
> `probe-palette-messages2.js:49,50` (as **expected values**, in one of the five palette probes
> RESUME §5 certifies as *real gates*), `smoke.mjs:351`, `probe-primitives-cascade.js:28,40` and
> `probe-t13-toast.js:68`, plus seven comment-only mentions. Task 13 gained a harness sweep as a
> result.
>
> **The mechanism is worth more than the fact.** The claim came from `rg <pattern> .superpowers/…`,
> which returned nothing — because **`.superpowers/` is gitignored and ripgrep honours `.gitignore`
> by default**, so the directory was never searched. Neither `--hidden` alone nor an explicit path
> argument defeats this; it needs `--no-ignore`, or `grep`. **A false zero from a skipped directory is
> indistinguishable from a real zero**, and it went on to justify an instrument decision and survive
> into a commit. This is the §6e disarm mechanism wearing a new hat: not a probe that stopped
> asserting, but a *search* that stopped searching. **Search the harness with
> `rg --no-ignore --hidden`, or with `grep`. Never with a bare `rg`.**
- **28 of the 47 alias names are live; 19 are dead** and delete with no migration.
- **143 `probe-*.js` files** exist (the §5 truth table covers ~20); ~45 have no assertion machinery of
  any kind; **two** assertion conventions coexist.
- **77 harness selector sites** and **0 test-file sites** across the 12 renamed classes; `.off`,
  `.offline`, `.current`, `.close` have **zero** harness sites, which is why task 9 goes first.
- Harness is **477 entries**, not the recorded 475. Noted, not chased.

**Confirmed unchanged, so do not re-measure on suspicion:** 47/50 alias declarations · 70 references
across 6 files, all fallback-free · 43 class-pattern errors in the 4 named files · **10** accent sites
all in `CallStage.css` · 4 `infinite` declarations · 4 raw-colour CSS sites · **12** z-index
declarations across 7 values (**not 13**) · `.channel-type-options` at `primitives.css:442–499` with
no emitter · all four gate baselines.
