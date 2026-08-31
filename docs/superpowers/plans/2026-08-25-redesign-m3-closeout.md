# M3 (Calls) — closeout & handoff to M4/M5/M6

**Status:** complete. 8 commits `f07c7d1..a3cc52e` on `redesign` — all eight are implementation (7 task
commits + 1 whole-branch fix wave); unlike M2 there are no docs-only commits in the range, because this
milestone's plan commit `ea66b78` is the range's base. Not pushed; `main` untouched.
**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` §5 M3 bullet.
**Plan:** `docs/superpowers/plans/2026-08-25-redesign-m3-calls.md` (Opus grand-reviewed before execution;
decisions 1–25 binding).
**Inherited:** `docs/superpowers/plans/2026-08-25-redesign-m2-closeout.md` (17 rulings, harness notes,
stylelint baseline history).

Every task passed a task-scoped review; Tasks 2, 5, 6, 7 passed with **zero findings at every severity**,
Task 4 needed two fix rounds. The whole-branch review (`ea66b78..15ed807`, opus, 7 commits, read in seven
chunked passes) returned **"ready with caveats"** with **no Critical**. Its five actionable findings landed in
`a3cc52e` and a scoped re-review (`15ed807..a3cc52e`, opus) confirmed **all five addressed, no new breakage**.

This file exists because the SDD workspace (`.superpowers/sdd/2026-08-25-redesign-m3-calls/`) is gitignored
and dies with the session — the ledger's rulings, triage, deviations and harness notes are transcribed here
before they are lost, exactly as the M1 and M2 closeouts did.

**Constraint compliance, independently confirmed by the whole-branch reviewer and re-confirmed at close:**
no changes under `server/`, `client/src/services/`, `client/src/types/index.ts`, or `client/e2e/`
(`git diff --stat` over those four paths: empty). No API or WS contract change — `rg` for
`apiService.`/`wsService.`/`fetch(`/`/api/` over the whole 4610-line diff returns **zero rows**, and the
`wsService.send/on` event-name set in `CallStage.tsx` + `CallUI.tsx` is byte-identical to `ea66b78`.
**No legacy token alias deleted:** `tokens.css` changed by exactly **+20 / −0** — zero deletions, so the
alias block is provably untouched. All of M3's Global Constraints held.

**What M2 handed off, and its state now:** M2's two open decisions are both resolved — decision 1
(toast entrance 0.22s) is **confirmed and closed** by M3 plan decision 17, with `primitives.css` untouched;
decision 2 (`--radius-row` on the toast) **stays deferred to M6**, as M2 specified. M2's own carried-forward
list — the lost-draft-on-failed-send store-architecture question, the catch-path residue at
`AppPage.tsx:543-544`, the POST-after-channel-switch no-op, `ConfirmModal` autofocusing the destructive
button, `msg-mention-role`'s missing rule, and M1's four remaining nits — is **not mentioned anywhere in this
milestone's ledger, one way or the other**. State that plainly: M3 neither fixed nor re-verified any of them;
M4/M6 should treat them as still open, not as resolved by omission.

---

## What M3 shipped, against spec §5's M3 bullet

Spec §5: *"M3 — Calls (board `1e`, `2e`). CallStage on `stage` tokens: top bar (live pill + timer, counter,
fullscreen), responsive tile grid (1/2/3 columns by participant count), name plates with mic/equalizer,
speaking ring driven by real audio levels (existing speaking detection), control bar (three toggles with
labels, divider, danger "Выйти" pill); screen-share view + picker; quality tooltip; `CallUI` 1:1 overlay
restyled; mobile voice banner."*

Clause by clause. **Nothing is missing.**

| Clause | Status | Notes |
|---|---|---|
| Top bar — live pill + timer | **Landed** | T3. `stage-live-pill` + `StageTimer`; `formatCallDuration` is TDD'd (`utils/callStage.test.ts`, 7 cases incl. hour rollover, negative and NaN clamps). |
| Top bar — participant counter | **Landed** | T3, plural via `tp('call.participants', n)` — `call.participants` is a `plural()` entry, so `t()` would have rendered the literal key. |
| Top bar — fullscreen | **Landed** | T3 (whole-stage target) + T4 (`AppPage.css` layout consumer). See "Fullscreen" below — it is the subtlest logic in the milestone. |
| Responsive tile grid 1/2/3 columns | **Landed** | `stageGridClass()` is TDD'd; class-driven per plan decision 4, inline `gridTemplateColumns` deleted. Plus a `≤640px` single-column override (the board's `1e` is desktop-only; two 16:9 tiles at 390px would be unusable). |
| Name plates with mic / equalizer | **Landed, adapted** | T3. Equalizer height 13px — boards `1e` and `2e` disagree (12 vs 14). Two real plate defects were found and fixed in the fix wave (equalizer flicker, ellipsis on a flex container). |
| Speaking ring from real audio levels | **Landed** | Level-driven via a CSS custom property: `--speak-level` injected from the **existing** `useMicLevel`, ring `calc(2px + var(--speak-level, 0) * 4px)` — the board's "0→1 maps to 2→6px" production note, with **zero new audio code**. The board's 1.4s `ring` keyframe is the static-board fallback and was deliberately not shipped. **Read the evidence caveat below — this was never driven by a real voice.** |
| Control bar — three labelled toggles, divider, danger «Выйти» pill | **Landed, adapted** | T3. **Adaptation:** the leave button is `--radius-pill` (r999), not the board's r14. This is the single most visible board departure and was **never formally ruled** — see "Awaiting the human". |
| Screen-share view + picker | **Landed** | T4 (focused view + thumbnail strip) + T5 (pickers extracted to `ScreenSharePicker.css`, closing the spec-§3 extraction hazard). See "Awaiting the human" for its height and its touch-exit history. |
| Quality tooltip | **Landed** | T3, portaled to `document.body` on a theme-adaptive popover surface per plan decision 13 (`--canvas`, not stage-dark — it floats above the app like every other popover). T4 added fullscreen-aware host re-resolution and a viewport clamp. |
| `CallUI` 1:1 overlay restyled | **Landed** | T6, on a new `p2p-*` namespace. `CallUI.css` went 79 violations → **0** and all 21 raw `rgba` are gone. |
| Mobile voice banner | **Landed, adapted** | T7, per board `1f`. **Adaptation (spec §2 / plan decision 19):** driven by *state*, not channel type — VYC-77 dropped `channels.type`, so the banner shows when the currently-open channel has an active voice session. Desktop keeps the sidebar voice card and header join button; the banner is `display: none` above 768px. |

**Two structural wins beyond the clause list:**

- **The spec-§3 extraction hazard is closed.** `ScreenSharePicker.tsx` no longer imports `CallStage.css`.
- **The two largest raw-value concentrations in the codebase are eliminated.** Spec §3 named
  `CallStage.css` (~20 hex + ~40 rgba) and `CallUI.css` (~21 rgba); both are now raw-value-free. M6's
  alias-deletion audit inherits a materially smaller job.

---

## Decisions that bind later work

Presented in the order each was bound. Every entry states what it costs if wrong. This is the complete
list — 21 rulings, transcribed in full.

### Made before execution (pre-flight scan)

1. **(P1) Fullscreen is a two-target enum, and the plan contradicted itself about it.** Plan decision 24
   replaces the `isFullscreen` boolean with `fullscreenTarget: 'stage' | 'focus' | null`, but Task 3's own
   text also said to leave the focused view's `handleFullscreen` "untouched" — impossible, since it calls the
   deleted setter. Ruling: T3 adapts it minimally (setter calls become `setFullscreenTarget('focus'|null)`,
   body and ref unchanged) and the focused view's `is-fullscreen` binds to `fullscreenTarget === 'focus'`,
   never to a derived boolean. **Later superseded in part by T4-c** (below) — read the two together.
   **Cost if wrong:** two call sites differ from the plan's prose for one task.
2. **(P2, verification not change) Every `t()`/`tp()` key the plan's JSX referenced beyond the 11 new ones
   already existed** in `ru.ts` — 31 keys checked by reading the `call:` block. Only `call.acceptCall` and
   `call.rejectCall` were absent; T6 added them. **Cost if wrong:** a literal key rendering in the UI.
3. **(P3, verification not change) `--call-stage-height` is consumed by `AppPage.css:26-27`, not by
   `CallStage.css`** — set inline from `AppPage.tsx:632`. T3's rewritten `.call-stage` (which declares no
   height) therefore could not break the call/chat split. **Cost if wrong:** the split collapses.
   *This became load-bearing later — see T8-a.*
4. **(P4) Assert the precondition, never assume it.** Every probe must read which channel is open before
   joining, read the participant total *before* injecting synthetic participants, and measure counts rather
   than hardcoding them. Direct response to M2's `probe-t13-stale-switch` false pass, where
   `last_channel_id` drift — not the code — made the probe green. **Cost if wrong:** a probe passes for the
   wrong reason and the claim behind it is void.
5. **(P5) Specificity justifications must be tested, not copied.** See "The `no-descending-specificity`
   claim" below — this ruling paid for itself twice. **Cost if wrong:** a false comment ships.
6. **(P6) A dev server predating HEAD invalidates visual evidence.** Compare the Vite server's start time
   against HEAD's commit time before any screenshot or computed-style probe, and restart if older.
   **Cost if wrong:** a visual claim rests on stale injected CSS.
7. **(P-T1-a / P-T1-b, Task 1 only)** `--warning: #F59E0B` was compared against `--yellow-500` per plan
   decision 25(b) — **identical, no discrepancy**. Task 1's "BEFORE" screenshots are labelled
   *"pre-restyle at commit 1"*, not "pre-M3", because they were captured after the additions-only token
   commit. **Cost if wrong:** a mislabelled evidence anchor.

### Made during execution

8. **(T3-a) Two declarations beyond the brief's verbatim CSS are ratified**, both measured defects, neither
   touching notation or rule ordering: `grid-auto-rows: max-content` on `.stage-grid` (without it, at 5
   participants the `auto` tracks squeeze to 93.3px while `aspect-ratio` tiles stay 149px, so row 2 paints
   42px inside row 1), and `flex-shrink: 0` on `.stage-back-btn` (as a flex item with only a width basis it
   floored at its 18px icon, collapsing decision 22's ≥40px touch target). **Cost if wrong:** two extra
   declarations, one diff hunk each.
9. **(T3-b) The `fullscreenchange` listener derives its target** (`el === stageRef.current ? 'stage' :
   'focus'`) rather than only nulling on exit. The pre-change browser path had **no** state setter at all —
   the listener was the sole route — so a null-only listener would have silently broken `AppPage.css`'s
   `:has(.screen-share-main.is-fullscreen)` contract. **Cost if wrong:** the two fullscreen targets could
   swap their state class; both still exit correctly, since the exit path reads `document.fullscreenElement`.
10. **(T3-c) The `.mic-badge*` legacy rules were kept through T3**, resolving a contradiction between the
    brief's Step 4 ("keep them — the thumbnail JSX still emits them", which is true) and its own decision-25(d)
    note listing them for deletion. Consequence: **decision 25(d)'s disclosed CallUI interim was narrower than
    predicted** — only `.call-controls`, `.control-btn*` and `.mic-btn-wrap` were affected, and CallUI defines
    all three itself, so it recovered its own values rather than losing styling. T4 deleted the rules once its
    rewrite removed the emitters. **Cost if wrong:** three dead rule blocks for one task.
11. **(T3-f, harness) `--after 6000` is not a reliable join delay** — three failed joins were observed at
    that value. Every call-surface run uses `--after 9000` or more, and **a screenshot is not evidence unless
    an asserting probe ran on the same invocation.** **Cost if wrong:** a screenshot of a non-joined app read
    as evidence.
12. **(T4-a) `.stage-thumb-badge` gets `right: 28px`** — it sat at exactly the same `top/right: 4px` as
    `.stage-conn` with a lower z-index, so on any sharing thumbnail that also has quality metrics — i.e. every
    real sharer — the share indicator rendered as an illegible smear behind a 66%-opaque plate. Precision for
    the record: it was **overlapped**, not "occluded"; `elementFromPoint` proved pointer-unreachability, not
    invisibility. **Cost if wrong:** one declaration deviating from the brief's thumb-scale override.
13. **(T4-b) T4's staging was extended by one file** to include `VolumeControlPopover.tsx`, which carried the
    **identical** body-portal bug that carry-forward 2 fixed in `ConnectionIndicator`. No later task staged
    that file, so deferring meant nobody owned it. **Cost if wrong:** one extra file in T4's commit; the
    alternative was a real bug with no owner.
14. **(T4-c, supersedes part of P1) The top-bar fullscreen button binds `fullscreenTarget === 'stage'`,**
    mirroring the focus button's rebinding to `=== 'focus'`. P1 predated that rebinding, and one-sided
    symmetry is worse than either consistent choice. Same finding's second half: `handleFocusFullscreen`
    branches on `fullscreenTarget === 'focus'` rather than `document.fullscreenElement`, so the button does
    what its glyph promises. **Cost if wrong:** a glyph mislabels in a state neither button is measured in;
    both still exit correctly.
15. **(T4-d, harness — the plan text is WRONG) The `--click` flag is not a trusted CDP click.** The plan and
    briefs describe it as one; `smoke.mjs:236,253` call `el.click()` inside `Runtime.evaluate` with **no user
    activation**, so `requestFullscreen` rejects on that path. T4 added `userGesture: true` at the probe-eval
    call site (`smoke.mjs:385`) **only**, leaving the `--click` join path on the default — which is what made
    a genuine fullscreen transition measurable rather than a simulated class toggle. **Cost if wrong:** a
    fullscreen claim resting on a simulated toggle.
16. **(T4-e, narrows T4-c) The fullscreen glyph must reflect what its own button's action does.** Browser
    path: per-target. **Electron path: `fullscreenTarget !== null`**, because Electron has exactly one
    window-level fullscreen and `api.toggleFullscreen()` is unconditional — otherwise entering via the focus
    button leaves `target === 'focus'`, the top bar renders "enter", and clicking it exits. The re-reviewer
    built the truth table and confirmed the predicate **reduces exactly** to the measured browser behaviour
    across all three states. The `is-fullscreen` **classes** deliberately stay per-target on both platforms:
    widening them would set both and break the one-`:has()`-variant invariant. **Electron cannot launch here
    — this ruling and its verification are reasoned-not-measured on both sides.** **Cost if wrong:** a wrong
    glyph on one platform; the action is correct in every case.
17. **(T6-a) `.p2p-modal`'s hard `width: 340px` stays**, deferred to M6's responsive sweep. The legacy rule
    was `max-width: 380px; width: 90%`, so this is a real narrowing, but it only bites below a ~340px
    viewport and no supported target is that narrow (board reference 390px; touch probes 360px).
    **Cost if wrong:** horizontal overflow on a viewport narrower than the design targets.
18. **(T6-b) The `scaleIn` de-shadowing is accepted and surfaced** — see "Awaiting the human".
19. **(T8-z, process) Task 8 produced no diff, so it got no separate review seat.** Its verification claims
    were folded into the whole-branch review's brief instead, with an explicit instruction not to take its
    numbers on trust. The whole-branch reviewer reproduced every one and found no inflation.
    **Cost if wrong:** one fewer review seat on a task that changed no code.
20. **(T8-a) The focused view's height in the default split is parked** — see "Awaiting the human", item 1.
21. **(Fix wave, FW-1) The share badge's 40px lane is permanent, not hover-scoped.** The hover-only
    alternative was rejected on a sharper mechanism than the finding stated: **`opacity: 0` does not remove
    an element from hit-testing**, so a hover-scoped fix would leave the volume chip stealing the badge's hit
    test at rest. Accepted side effect: on the **local** tile — which has no volume chip — the badge's resting
    inset moves from 10px to 40px. `:has()` is already sanctioned in this codebase (`AppPage.css:61-70`), so
    `.stage-tile:has(.stage-volume-btn) .stage-share-badge` is available as a refinement if the human wants
    the local tile's alignment back. **Cost if wrong:** a 30px cosmetic inset drift on your own sharing tile.

---

## Awaiting the human

Five judgement calls the process deliberately left unsigned, in descending order of stakes. **Read the first
two before anything else** — they are the two places where an M3 deliverable does not work the way the board
draws it, and neither has a fix an implementer should have picked unilaterally.

### 1. Board `1e`'s camera-off tile treatment never renders for a connected peer

The 74px avatar and the «камера выкл.» chip — two of M3's new board deliverables — are gated on
`!participant.stream` (`CallStage.tsx:342`). But `callStore.ts:233-243` sets `stream` as soon as *any* track
arrives, and `groupCall.ts:1393-1401` publishes a dummy 16×16 **disabled** video track so the sender SSRC
exists in the first SDP. So `participant.stream` is non-null for every connected peer regardless of camera
state, and `is-camera-off` is true only during connection setup — never for a peer sitting in the call with
their camera off, which `groupCall.ts:336` makes the **default** ("Video starts disabled"). Other people's
tiles show an empty `<video>` over `--stage-tile` with a name plate and nothing else. The tell is the
asymmetry: the local tile uses `isVideoOff && !isScreenSharing` and renders correctly.

**This is not a regression** — the predicate is byte-identical to the pre-M3 `.video-off` / 📷 placeholder
condition, and every per-task review saw only an unchanged line. But M3 built two new board deliverables on
it. **A correct fix needs a camera signal that does not exist**: `RemoteParticipant` (`callStore.ts:11-14`)
carries none, and reading `getVideoTracks().some(t => t.enabled)` at render time is correct only at render
time — nothing re-renders when a remote track's `enabled` flips. The real fix is a store field fed from the
services layer, which M3's constraints forbid touching. **Owner: a backend/services phase, or M4 with an
explicit scope grant.**

### 2. The focused screen-share view is 126.59px tall in the default split

T4's marquee deliverable, effectively unreadable at the 55% default. The solo tile overflows the same way.
Both trace to `.channel-body .call-stage { height: var(--call-stage-height, 55%) }` (`AppPage.css:26-27`).

Parked rather than patched, on four grounds: it is **substantially pre-existing** (T3 measured the same
overflow pre-task with the old `.video-grid`; old chrome ~138px vs M3's ~155px, so M3 worsened a short view
by ~17px rather than creating one); the split is **user-draggable** (`.call-split-handle`); M3 *added* the two
fullscreen affordances that solve it; and what fraction a focused stage should occupy is a **board/layout
decision**.

**Three corrections the whole-branch reviewer supplied, which anyone fixing this must have:**
- The obvious candidate fix — `height: max(var(--call-stage-height, 55%), 75%)` — **is wrong**: the drag
  handle clamps to 20–80% (`AppPage.tsx:130`), so that rule would collapse the effective range inside a focus
  view to 75–80%, destroying the very draggability the park leans on.
- The `55%` fallback at `AppPage.css:26` is **dead code** — `--call-stage-height` is set unconditionally at
  `AppPage.tsx:632` from a `useState` defaulting to 55.
- **The largest single lever is the thumbnail strip**, not the split: at 1440×900 the stage is ~394px and
  chrome is 56 (top bar) + ~101 (control bar) + **110 (`.stage-thumbs`)** = 267px. The strip is 41% of the
  chrome, and `CallStage.css`'s `height: 110px` is inside M3's own files. Collapsing or shrinking it when the
  stage is short touches nothing else.

**Owner: human decision, then M6.**

### 3. `--accent` is theme-scoped, so the stage is not fully theme-invariant

Plan decision 25(b) makes the stage chrome theme-invariant (`--stage-*` on `:root` only). Every `--stage-*`
value does match across themes — but **12 sites** use `--accent`/`--accent-hover` (share badge, focused-thumb
ring, watch button, `is-on` toggle, banner button, hover states), which flips `#6366F1` ↔ `#4F46E5`. The
handoff gives **no separate dark-stage accent**, so unlike the `--online` half of the same family (fixed in
the fix wave — see below) this genuinely has no board answer. Either the stage's accent should be invariant
like the rest of its chrome, or the accent is deliberately the one theme-responsive element on a
theme-invariant surface. **Owner: board, then M6's dark-parity pass.**

### 4. The leave button is a pill, not r14

The board's control bar specifies a `danger` pill button; M3 shipped `--radius-pill` (r999) where a literal
reading of the board's r14 grid would give a rounded rectangle. It is the single most visible board
departure in the milestone and **was never formally ruled** — it came through as plan text and nobody
challenged it. Flagging it so the human sees it once. **Owner: board.**

### 5. Three non-M3 components' modal entrance animation changed

Deleting `CallUI.css`'s duplicate `@keyframes scaleIn` (scale `.92`) de-shadowed `primitives.css`'s
(scale `.95`) for `ContextMenu`, `Settings` and `AvatarCropModal`. Mechanism verified: `main.tsx:11` injects
`primitives.css` before `main.tsx:12` pulls App's graph → `AppPage.tsx:13` → `CallUI.css`, so CallUI's copy
was injected later and won the global keyframe-name tie. **Unavoidable in scope** — plan decision 17 bars
`primitives.css` from the commit, and re-adding a duplicate global keyframe would re-violate the namespace
goal the rewrite exists for. Bounded: all 16 keyframe names in `client/src` are now unique, and the other
four deleted keyframes have no surviving consumer.

This is **structurally identical to M2's `.error-toast` case** (which sped two non-M2 components from 0.3s
to 0.22s) and is recorded the same way. Arguably more defensible: M2 moved two components onto a value M2
chose; this moves three onto the primitive they were accidentally being denied.

---

## Deferred findings, triaged by owner

Items fixed in the whole-branch fix wave (`a3cc52e`) are marked **RESOLVED** rather than dropped, so this
stays a complete record of what was found, not just what remains.

### Resolved in the fix wave

- **The focused share view had no visible exit on touch.** `.stage-focus-controls` was `opacity: 0`, revealed
  only by `:hover`, and neither it nor `.stage-focus-ctrl-btn` appeared in any `@media (width <= 768px)`
  block — so on touch, "back to grid" and focus-fullscreen were invisible, while `.stage-back-btn` returned to
  the chat panel leaving `focusedUserId` set. **RESOLVED**; decision 22's touch floor is now internally
  consistent.
- **The share-badge overlap fix was mobile-only, behind a false comment.** T4 fixed the ≤768px case
  (measured 30.9% overlap) but desktop hover was live: `.stage-tile:hover .stage-volume-btn` reveals a
  z-index-3 chip over the badge's left ~26px, taking the hit test — and the in-code comment asserted
  "Desktop is untouched: there the chip rests at `opacity: 0`", true only when not hovering, and a sharing
  tile is exactly what a user hovers. **RESOLVED**, CSS and comment both. This was the **third** false-comment
  instance on this branch and the only one the milestone did not catch itself.
- **`--online` rendered the light-theme green on the always-dark stage.** Four sites
  (`.stage-live-dot`, `.stage-eq span`, `.stage-conn.is-good`, `.p2p-timer-dot`) used `var(--online)`, which
  flips `#12B76A` → `#4ADE96`. **The board already answers this** — the handoff token table reads
  `online | #12B76A (dark accent #4ADE96)` and the stage is a dark surface — so it was a decision-25(b)
  contract breach with a known correct answer, not a board question. **RESOLVED** via a new
  `--stage-online: #4ADE96` (`:root` only, no dark override) and four call-site swaps.
  **Deliberately NOT swapped, and correct:** `.stage-tip.is-good` and `.p2p-accept-btn` keep `--online`,
  because both sit on theme-*adaptive* surfaces (`--canvas`) — the quality tooltip per plan decision 13, the
  incoming-call modal as a system modal. Verified against the surfaces, not the comments.
- **The equalizer flickered in one bar at a time.** `.stage-eq span` had no base `height`; with
  `animation-delay: 0.12s`/`0.24s` and default `animation-fill-mode: none`, bars 2 and 3 computed
  `height: auto` → 0 during their delay windows. **RESOLVED** with `height: 5px` on the base rule — chosen
  over `animation-fill-mode: backwards` because it survives M6's `prefers-reduced-motion` sweep, where
  `backwards` would collapse the bars to 0.
- **`text-overflow: ellipsis` on a flex container.** `.stage-plate` and `.stage-thumb-label` are
  `display: flex` while carrying the ellipsis triple, with the name in a child `<span>` — so long names hard-
  clipped. **RESOLVED** via `min-width: 0` on the containers and a new `.stage-name` rule (1 rule, 4
  emitters — both plates and both thumb labels).

### M4 (modals, menus, settings)

- **`call.screenSharingActive` is now a dead key** in both locales — plan decision 9 removed
  `.header-screen-share-indicator`, its only consumer, and says the key stays. Verified dead: no consumer
  outside the locale files. `check:i18n` is a hardcoded-Russian-string heuristic and cannot see unused keys.
- **`primitives.css` is still held flat** at its M2 count. M3 did not touch it (plan decision 3 explicitly
  duplicates ~30 lines of control-bar recipe under `p2p-*` names rather than lifting to that layer). M4 owns it.
- Before extending any call-surface flow, read decisions 14 and 16 above — the fullscreen design is the
  subtlest logic in the milestone and its Electron half is unmeasured.

### M6 (polish, dark parity, responsive, alias deletion)

- **`--accent` theme-scoping on stage chrome** (12 sites) — "Awaiting the human" item 3.
- **`.p2p-modal`'s hard `width: 340px`** — ruling 17.
- **`.stage-focus-ctrl-btn` is 36×36** where decision 22's floor is 40px. Its *invisibility* on touch was the
  real defect and is fixed; the size is brief-mandated and remains a **new** disclosed exemption beyond
  decision 22's thumb-scale one.
- **`.stage-focus-label` hard-clips with no ellipsis** — `.stage-focus-main { overflow: hidden }` clips it and
  it has no ellipsis of its own. *(The fix wave's report claimed "neither clips at all" about this and
  `.p2p-plate`; the re-reviewer showed both justifications were wrong — `.p2p-plate` has no name span at all
  and needs nothing, while `.stage-focus-label` genuinely does clip. Neither is in scope; the correction is
  recorded so M6 does not inherit the wrong reason.)*
- **`.stage-plate` / `.stage-state-chip` overlap by 8px** on a 265px tile at 3-column width. Interacts with
  "Awaiting the human" item 1: for remotes the state chip never renders at all, so the overlap is currently
  reachable only on your own camera-off tile with a long name.
- **At 641–768px with `is-many` at 3 columns (~220px tile), the badge's right edge passes
  `.stage-focus-btn`'s left edge.** Pre-existing (T4's `left: 52px` block is byte-identical across the fix
  diff), a real narrow-window overlap, **never measured by anyone**.
- **`.stage-tip-arrow` no longer points at its chip when the tooltip is clamped** — new from the fix that made
  the tooltip visible in fullscreen at all. Visibility beats arrow alignment.
- **The top-bar title truncates to `#g…` at 390–420px** because the live pill and count chip take layout
  precedence. A deliberate priority (touch targets over title) with an ugly result.
- **A screen-share error toast is invisible during focus fullscreen** — `.error-toast` renders as a child of
  `.call-stage` but outside `.stage-focus-main`, and the top layer paints only the fullscreen element and its
  descendants. Same class as the tooltip/popover bugs T4 fixed. Extremely narrow (all three `setStageError`
  paths are Electron-only or need a rejected `getDisplayMedia`).
- **Icon sizes fall outside the stated 16–21px range** without a grouped deviation record: `size={10}` ×6,
  `size={12}` ×10, `size={14}` ×3, `size={28}` ×1. Each is defensible in context (a 16px mic glyph will not
  fit a 12px-text name plate; the 28px `Phone` sits in a 74px incoming-call tile). Recorded here as **adapted**,
  so M6 inherits it as a decision rather than an unnoticed breach.
- **The dead `55%` fallback** at `AppPage.css:26` — harmless, but it reads as a guard that does not exist.
- **New infinite-loop animations for the `prefers-reduced-motion` pass:** `stage-eq-bar` (0.7s, staggered
  0.12s) and `p2p-pulse` (2.5s). Both are board-sanctioned loops, exempt from the ≤250ms budget like M2's
  typing dots and its `chat-shimmer`.
- **Media-query range syntax** — M3 added six more `(width <= …)` blocks, inheriting M2 ruling 17's
  browser-support exposure (iOS Safari <16.4 silently no-ops the range form). M6's 768→900 migration rewrites
  them anyway.

### No action

The `400 Bad Request` console noise during probe runs is **probe-induced** by synthetic participant IDs, not
a product defect. `probe-callstate.js` remains inert and is banned as evidence.

---

## Stylelint baseline history

**605 → 531 (M2 close) → 434 (M3 T3) → 365 (T4) → 350 (T5) → 271 (T6) → 271 (T7, T8, fix wave).**

M3 took the total from **531 to 271 — a 49% reduction**, and did it by deleting legacy rules rather than by
sweeping legacy files. The hold-line was "never above 531"; it was never approached.

**Final per-file state, re-measured at close from `client/`:**

| File | Problems | Note |
|---|---|---|
| `CallStage.css` | **0** | rewritten across T3/T4/T5; was ~181 |
| `CallUI.css` | **0** | rewritten in T6; was 79 |
| `ScreenSharePicker.css` | **0** | new in T5 |
| `VoiceBanner.css` | **0** | new in T7 |
| `VolumeControlPopover.css` | **0** | rewritten in T4 |
| `tokens.css` | **118** | unchanged — all 20 added lines are clean modern notation |
| `AppPage.css` | **7** | unchanged — surgical `:has()` edit only, none of the 7 inside the edited region |

**Raw-value gate:** `rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\('` over the five M3-owned CSS files returns
**zero rows, literally**. The overlay scrim is tokenized as `--scrim: rgb(16 19 34 / 50%)` (plan decision 21),
matching `primitives.css`'s `.modal-overlay`. **No sanctioned exception was used.**

**Two standing gate lines, both true at HEAD:**
1. The total from `npm run lint:css` must never increase past 531 (currently 271).
2. Every file M3 created or rewrote is individually clean.

**Operational notes, carried forward and re-confirmed:**
- **`importFrom` is cwd-relative — stylelint must run from `client/`.** A repo-root run crashes with `ENOENT`.
  This was re-hit accidentally during the closeout's own gate sweep, which is a useful reminder that the
  failure looks like output, not like a crash, if you are not reading closely.
- `--formatter json` output goes to **stderr** — pipe with `2>&1`, never `2>/dev/null`.
- **JS-injected custom properties are invisible to `importFrom`.** M3 added `--speak-level` to that family
  (joining `--avatar-*`, `--call-stage-height`, `--presence-ring`). All four CSS references carry the
  `var(--speak-level, 0)` fallback; a bare reference would add a
  `csstools/value-no-unknown-custom-properties` violation.
- **`stylelint --fix` was deliberately never run** on the carried-legacy files — 138 of `CallStage.css`'s
  original 181 problems were auto-fixable, and a fix pass would have rewritten the carried block and
  destroyed "verbatim".

---

## The `no-descending-specificity` claim — a plan assertion, disproved twice

The plan mandated CSS comments asserting that placing an `@media` block after a `:hover` rule "would trip
`no-descending-specificity`". **That claim is false in this repo**, and ruling P5 required it to be tested
rather than copied.

**T3's counterfactual, with positive controls:** moving each `@media` block after its `:hover` rule left the
file at exactly the same violation count, and `no-descending-specificity` appeared in none of the outputs. A
positive control — the same pair *without* the `@media` wrapper — **does** fire. So the rule is live in this
config and **buckets by at-rule context**: a top-level `:hover` rule and a rule inside `@media` are never
compared. The ordering was kept (it is good grouping) and the comments were corrected to say what actually
happens. The fix wave re-ran the same counterfactual on its own additions and reproduced the result
independently, including the positive control.

**T4's case was different and the claim was true there** — a plain descending-specificity pair with no
`@media` involved — and the implementer found the brief's block was still one error short of clean, fixing it
with a measured `.call-stage` prefix rather than reporting the brief as correct.

This is the **second milestone** in which this exact class of claim has been disproved: M2's fix wave
corrected the same thing at `MessageRow.css:204-211`, on the grounds that "a wrong comment is worse than no
comment". **M6 should stop propagating it.**

---

## Verification harness

`.superpowers/sdd/2026-08-25-redesign-m3-calls/tools/` holds the CDP smoke harness (not in git; **preserve
for M4**). It is a copy of M2's tools dir plus M3's additions. Corrections and additions from this milestone,
several of which contradict the plan's own text:

### Corrections to the plan's harness description

- **`--fake-media` does NOT join a call.** It fakes devices, auto-grants permission and enables autoplay,
  making a headless join *possible*. Every call-surface run must drive the join explicitly with
  `--click .chat-voice-btn --after 9000`.
- **`--after 6000` is unreliable** — three failed joins observed. Use 9000+.
- **`--click` is NOT a trusted CDP click** (ruling 15). It is `el.click()` inside `Runtime.evaluate` with no
  user activation, so anything gated on transient activation (notably `requestFullscreen`) rejects on that
  path. `userGesture: true` is set at the probe-eval call site (`smoke.mjs:385`) only.
- **`--push-ws` is inert without `--preload tools/inject-voice-ws.js`** — bare, it prints
  `NO __pushWS (missing --preload?)` and does nothing — and it fires **before** `--click`/`--probe`.
- **`probe-callstate.js` is inert** — six lines of read-only DOM sampling, no join, no assertions. It runs
  green against any state. Banned as evidence; do not resurrect it.

### New mechanics discovered in M3

- **React overwrites an inline `--speak-level` on a live tile within a frame.** A probe must force the value
  and read it in the same task, or it will read React's value back.
- **Chromium maintains a fullscreen *element stack*.** Calling `requestFullscreen` on a second element while
  one is already fullscreen does not cleanly swap — a subsequent `exitFullscreen()` pops back to the first
  element instead of exiting. M3's focus/stage fullscreen swap uses an **exit-then-request** sequence
  (awaiting the exit) because measurement forced it; reasoning alone had produced the wrong design.
- **The viewport resizes a frame *after* `fullscreenchange`.** A portaled tooltip must re-clamp on `resize`,
  not only on `fullscreenchange`, or it lands off-screen.
- **`opacity: 0` does not remove an element from hit-testing** — a hover-revealed chip steals pointer events
  from what is under it even at rest.

### Probe inventory (all M3 probes were run against pre-task HEAD first and failed loudly there)

`probe-stage-grid.js`, `probe-stage-chrome.js`, `probe-stage-speaking.js`, `probe-stage-mobile.js`,
`probe-stage-focus.js`, `probe-stage-fs.js`, `probe-screen-picker.js`, `probe-p2p.js`,
`probe-voice-banner.js`, plus T4's fix probes (`probe-t4-fix-a/b/c.js`, `probe-t4-tile-badge.js`,
`probe-t4-grid-rows.js`, `probe-t4-cf4.js`, `probe-t4-fsbtn.js`, `probe-t4-shot.js`,
`probe-t4-thumb-sharer.js`) and the fix wave's.

House pattern, used correctly throughout: `const fail = (m) => { throw new Error(m); };` with **every**
assertion routed through it. `probe-screen-picker.js` is the reference implementation — 15 assertions, none
recorded, all thrown.

### Probes flagged for anyone reusing them

- **`tools/probe-chat.js` CANNOT FAIL.** 182 lines, **no `verdict`, no `fail(`, no `throw`** — every assertion
  is a recorded key/value pair read by eye, and a missing selector records `undefined`/`'absent'` while the
  run still succeeds. M2's closeout already flagged this file's failure mode; it was not repaired. It is the
  nominal cross-surface regression gate for M2's chat column and **it is not a gate**. Cheap closure for M4:
  it already uses an `X`/`expectedX` convention — add the `fail` helper and route those pairs through it.
- `tools/probe-t11-flow.js`'s `toastPresent` queries the deleted `.chat-error-toast` and is **permanently
  false**. Do not cite it as regression evidence.
- `tools/probe-servermenu.js` needs `--click .channel-header-menu --after 800`.

### Why the "untouched" claim for M1/M2 does not rest on `probe-chat.js`

The whole-branch reviewer ran three static checks that are strictly stronger than any probe, and they exhaust
the mechanisms by which deleting CSS in one file can change rendering in another:

1. **M3 touched exactly 7 stylesheets** — the five M3-owned files plus `AppPage.css` and `tokens.css`. **No M1
   or M2 stylesheet is in the diff at all.**
2. **Of the 71 class names M3 deleted** from `CallStage.css` + `CallUI.css`, **zero** are referenced anywhere
   else in `client/src`. (The two apparent hits, `call-btn` and `volume-btn`, are substring matches inside
   `chat-call-btn` and `stage-volume-btn` — the substring trap that bit two earlier M3 scans.)
3. **All 16 `@keyframes` names in `client/src` are unique.** Of the five deleted, only `scaleIn` had a
   surviving consumer — which is precisely "Awaiting the human" item 5.

The old files contained no non-class global selectors, so class names and global at-rule names were the only
two vectors. **Say this rather than citing the probe.**

### Bidirectional class scan (the primary orphan gate)

**124 CSS classes → 0 orphans; 99 TSX class tokens → 0 missing rules.** The 6 non-literal classes trace to
`stageGridClass()` and `computeQualityLevel()`. This is the technique that caught `msg-mention-role` in M2;
it is clean here. **Match class tokens, not substrings** — that trap produced two false hits during M3.

### Smoke-server residue

The throwaway account's `#general` on «Redesign Smoke» still carries M2's test messages (`A-anim-…`,
`t11-retry-dbl-…`), which appear in the chat backdrop of **every** M3 screenshot. That is inherited backend
state, not M3 output. M3's probes added no persistent messages — its injections were client-side store writes
(synthetic participants with `stream: null`) and dispatched window events, neither of which touches the
server. `last_channel_id` still points at `general`.

---

## Environment notes

- **`npm test` is RED at baseline**, unchanged from M1 and M2: 3 tests in
  `src/services/__tests__/api.network-retry.test.ts` were merged without their implementation, plus 2
  unhandled rejections originating solely there. M3's gate shape throughout:
  `Test Files 1 failed | 22 passed (23)` · `Tests 3 failed | 149 passed (152)` · `Errors 2 errors`.
  The file count rose 22 → 23 and the passing count 138 → 149 at T2, which added
  `utils/callStage.test.ts` (**11 tests, all passing**). Out of scope by explicit Global Constraint;
  re-verified at every task boundary and at the fix-wave commit. **A test paste that says "same file" without
  the `FAIL` lines naming the file is not evidence** — that was enforced from T4 onward.
- **`npx tsc --noEmit` is clean** and is the **real** ru/en parity gate: `en` is typed against `ru`'s
  `Dictionary`, so a missing English key is a type error. `npm run check:i18n` is a hardcoded-Russian-string
  heuristic only; it exits 0 with the same 4 `ErrorBoundary.tsx` warnings M1 and M2 saw, still M4's.
- **11 new i18n keys**, all in `ru.ts` and `en.ts` together: `call.live`, `ctlMic`, `ctlCamera`, `ctlScreen`,
  `leaveLabel`, `cameraOffChip` (T3); `acceptCall`, `rejectCall` (T6); `voiceBanner`, `bannerJoin`,
  `bannerGoToCall` (T7). Plus one **value change**: `call.youSuffix` `'(Вы)'` → `'(вы)'` (en `'(you)'`) per
  plan decision 16, matching the chat's «вы» chip.
- **Dev server must run on port 3000 exactly.** Production CORS allowlist; the 3001/3002 fallback makes login
  fail with a CORS error that looks like a bug but is not. Test account `redesign_smoke@vycord.local` on
  «Redesign Smoke» — the production API, destructive-safe only because that server exists for this.
- **Three stale Vite servers were found alive at M3 start** — two from the M2 session (Aug 25) and one from
  Aug 26 — and were killed in T1's fix round. Ruling P6 was applied at every visual task thereafter.
- **Electron cannot launch** — npm 11's `allowScripts` skipped its postinstall, so `node_modules/electron/dist`
  is 292K instead of ~250MB. Fixable with `npm install-scripts ls` in `client/`. M3 touched nothing under
  `electron/`, and **every Electron branch in this milestone is reasoned-not-measured** (see below).

---

## Reasoned-not-measured — the milestone's honest gaps

State these plainly; several bear directly on M3's marquee features.

- **The speaking ring was NEVER exercised end-to-end by a real voice.** `--fake-media`'s synthetic mic peaks
  at **0.0065 / 0.0101 / 0.0115** across three independent 15-sample runs — with `isMuted: false` and a live
  stream carrying one enabled audio track, so this is genuinely amplitude, not a muted join — against the
  existing `SPEAKING_THRESHOLD` of **0.05**. `is-speaking` therefore never fired from the tone and React never
  emitted `.stage-eq`.
  **What WAS measured:** `--speak-level` is live (7–12 distinct values per run); the ring rule resolves and
  scales 2px→6px; `var(--speak-level, 0)` falls back correctly; forcing `is-speaking` on the real mounted tile
  switches its box-shadow from `none` to `--speak-ring`; the equalizer's CSS is correct on detached markup.
  **Mitigating context:** the 0.05 threshold itself is *not* an M3 question — `SPEAKING_THRESHOLD` is
  byte-identical to the `level > 0.05` literals it replaced, which were already shipping and already driving
  the old `.mic-badge--speaking`. So the *trigger* is proven in production; only the two things hanging off it
  are new, and the harder of those two (the level→radius mapping) is covered. The residual gap is narrow: the
  equalizer's composition inside a live plate. **The cheapest closure for M4: one dev-only run that drives
  `micLevel` above threshold — or temporarily lowers `SPEAKING_THRESHOLD` — and reads the mounted
  `.stage-plate`. Forcing the CSS class will NOT do it: the equalizer is conditional in JSX, not in CSS.**
  (The equalizer flicker fixed in the fix wave is exactly the kind of defect that run would have caught.)
- **`is-speaking` on remote tiles is structurally unreachable in this harness** — injected synthetic
  participants carry `stream: null`, so `useMicLevel(null, …)` returns 0. No remote ring was ever exercised.
- **The focused screen-share view was exercised as LAYOUT ONLY.** A single-account smoke server has no second
  peer; the view is driven by injecting a synthetic participant and setting `focusedUserId`. **No real screen
  stream ever rendered in it**, in any task or in the fix wave.
- **Every Electron branch:** `api.toggleFullscreen` (both handlers), the Electron-only `getScreenSources`
  source picker, and the whole of ruling 16's platform-dependent glyph semantics. Someone with a working
  Electron build should check ruling 16 in one pass: enter fullscreen via the focused view's button, then look
  at the top bar's glyph and click it.
- **The screen-share toast path.** `rg -n 'alert\(' src/components/CallStage.tsx` is literally empty and the
  three former `alert()` call sites now set `stageError`, rendered as `.error-toast` and cleared by a 5000ms
  effect. All three are Electron-only or need a rejected `getDisplayMedia`, and `stageError` is
  component-local so it cannot be driven from the store. `.error-toast` itself was probe-verified in M2.
- **The mirror fullscreen transition** (focus-fullscreen → top bar → stage-fullscreen) is asserted as glyph
  state but was never driven as a transition — reasoned from symmetry.
- **`object-fit: cover` on `.stage-thumb-avatar`** — inert on the letter-fallback `<div>`, correct on the
  `<img>` branch, but no smoke-server participant has an `avatar_url`, so the `<img>` path was never exercised.
- **F3's dark-theme half** is a provable no-op (`--online` is already `#4ADE96` there), so its probe refuses to
  run in dark by design.

---

## Process note: what the fail-first discipline bought this milestone

M2's lesson — "a probe is only evidence once it has been shown to fail against the broken version of the code
it is meant to catch" — was made a hard rule for M3 (ruling P4 plus the fail-first constraint). It paid out
four times, and in three of those cases **measurement overruled reasoning that looked correct**:

1. **The fullscreen swap.** The naive design (branch on `document.fullscreenElement`) passed code review and
   failed observation: Chromium's fullscreen element stack made `exitFullscreen()` pop back to the stage
   instead of exiting. The exit-then-request design exists because a measurement demanded it.
2. **The tooltip clamp.** Clamping alone was insufficient — the viewport resizes a frame *after*
   `fullscreenchange` — and the portal host really had been resolved only at mount. Neither would have been
   found by reading the code.
3. **A parked finding turned out to be live.** T3's tile-scale badge/chip overlap was parked as mandated
   geometry; when the fix round was told to *measure* it rather than inherit the reading, it reproduced at
   **30.9% overlap** in the exact state decision 22 forces — and the probe refused to run unless the chip
   actually computed `opacity: 1`, so the "before" number was taken in the real state, not a contrived one.
4. **The plan's own harness description was wrong** (ruling 15) and its `no-descending-specificity`
   justification was false (twice). Both were caught by running the counterfactual instead of copying the
   claim.

**The one that got away, and what it teaches:** the whole-branch review found three defects that no per-task
gate could have seen — the camera-off predicate that never fires for a connected peer, the missing touch exit
from the focused view, and the desktop half of the badge overlap. All three share a shape: **a per-task
reviewer sees only the diff, and each of these was invisible in the diff.** The camera-off predicate was an
*unchanged line*; the touch exit was an *absence* from four media blocks; the badge overlap was a *cascade
interaction* between two rules changed in different tasks. Per-task review cannot catch that class. The
whole-branch review is not a formality — it is the only seat that sees the milestone as a system.

**Also worth carrying:** the T1 reviewer flagged two ruling citations it could not find on record. They were
real — issued verbatim in the dispatch — but existed nowhere durable, so a reviewer reading only the on-disk
record saw invented authority. That was a **controller** bookkeeping failure, not an implementer one, and the
fix was to record every ruling in the ledger as it is made rather than only in the prompt that carries it.
This document is the end state of that discipline.
