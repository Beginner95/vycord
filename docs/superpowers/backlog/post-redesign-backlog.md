# Post-redesign backlog

**Created:** 2026-08-27, at the close of M3 (Calls).
**Purpose:** things the frontend redesign will **not** fix, parked here so they are handled once M4–M6 land.

## What is and isn't in this file

**In:** items with no redesign-milestone owner — correctness and data-flow bugs the redesign inherited and
repeatedly, deliberately declined; decisions that need a human before anyone can execute; and tooling debt.

**Out:** anything a redesign milestone still owns. Those stay in their closeouts so they are not lost:

- **M4 owns** — `ConfirmModal` autofocusing the destructive button (confirmed still live at
  `ConfirmModal.tsx:37`) and its missing focus trap / focus restore; its Esc-listener re-subscribing on every
  parent re-render; the `window.confirm` call sites in `ChannelSidebar` / `ServerList` / `StickerManager`;
  `ErrorBoundary`'s hardcoded Russian strings and the 4 `check:i18n` warnings they cause; the dead
  `call.screenSharingActive` key; `primitives.css` (held flat since M2 — M4 is the milestone that owns that
  layer).
- **M6 owns** — the legacy `--text-muted` alias (still live in at least `ChannelSidebar.css:55`,
  `ErrorBoundary.css:76,139`, `MessageSearch.css:46,67`) and the rest of the alias-deletion sweep; the
  media-query range-syntax / iOS Safari <16.4 question (M2 ruling 17); `prefers-reduced-motion` for the four
  looping animations (`chat-shimmer`, `stage-eq-bar`, `message-search-spin`, and `p2p-pulse` — which *is* the
  incoming-call pulse, not a fifth entry; RESUME §6c carries the measured list); the
  responsive 768→900 migration; the ~15 cosmetic call-surface deferrals catalogued in the M3 closeout.

**Closed, contrary to an earlier record:** M1's closeout listed an *orphaned* `.chat-voice-btn.in-call` rule.
M2's `is-*` rename incidentally gave it an emitter — `ChatArea.css:107` is `.chat-voice-btn.is-in-call` and
`ChatArea.tsx:549` emits it. Not orphaned; do not re-file it.

---

## 1. Correctness and data-flow bugs the redesign inherited and declined

These are **not restyle work**. Every milestone that touched their neighbourhood explicitly declined them
because a real fix needs a store-architecture or services-layer decision, which spec §1/§7 place outside the
redesign entirely. M3 neither fixed nor re-verified them.

### 1a. Board `1e`'s camera-off tile treatment never renders for a connected peer

The 74px avatar and the «камера выкл.» state chip — two of M3's new board deliverables — are gated on
`!participant.stream` (`CallStage.tsx:342`). But `callStore.ts:233-243` sets `stream` as soon as *any* track
arrives, and `groupCall.ts:1393-1401` publishes a dummy 16×16 **disabled** video track so the sender SSRC
exists in the first SDP. So `participant.stream` is non-null for every connected peer regardless of camera
state, and `is-camera-off` is true only during connection setup — never for a peer sitting in a call with
their camera off, which `groupCall.ts:336` makes the **default** ("Video starts disabled"). Remote tiles show
an empty `<video>` over `--stage-tile` with a name plate and nothing else.

The tell is the asymmetry: the local tile uses `isVideoOff && !isScreenSharing` and renders correctly.

**Not a regression** — the predicate is byte-identical to the pre-M3 `.video-off` / 📷 placeholder condition.
**Why it can't be patched locally:** `RemoteParticipant` (`callStore.ts:11-14`) carries no camera signal, and
reading `getVideoTracks().some(t => t.enabled)` at render time is correct only at render time — nothing
re-renders when a remote track's `enabled` flips. The real fix is a store field fed from the services layer.

**Needs:** a services/store scope grant. **Impact:** high — a shipped board deliverable is dead for everyone
but yourself.

### 1b. Lost draft on a failed send

Pre-M2-T11 a failed send left the user's text in the composer. Post-T11 the composer clears synchronously on
submit and the only copy lives in the transient `failed` row — and `AppPage` replaces the whole `messages`
array on channel switch, so navigating away **silently discards it**. Inherited store architecture; M2's fix
wave explicitly declined to restore it.

**Needs:** a store-architecture decision (draft persistence). **Impact:** silent user data loss.

### 1c. A rejected fetch for the still-current channel paints the previous channel's messages

`AppPage.tsx:543` (catch path confirmed still present). M2's stale-response guard covers only the success
path; if the fetch **rejects** while the channel is still current, `messages` still holds the *previous*
channel's list, so the unread anchor latches off the wrong channel and old rows paint under the new header.
The finding's other candidate remedy — "clear `messages` before awaiting" — would have closed this too; the
guard that shipped does not.

**Impact:** wrong messages under a correct header, plus a mis-anchored unread divider.

### 1d. A POST that succeeds after a channel switch still no-ops its `replaceMessage`

The message lands on the server but is invisible client-side until a refetch.
`handleChannelRemoved` / `handleServerRemoved` compare against closure-captured state rather than
`getState()`. **Pre-existing, not introduced by the redesign.**

### 1e. A send failure has nowhere to surface if the channel becomes null

If `channel` becomes `null` between a send and its rejection (last channel deleted, server removed),
`ChatArea` early-returns before the toast can render. Deliberately left out of M2's fix-wave scope. Same class
as 1b.

### 1f. `services/api.ts` has no request timeout, and `request()`/`requestForm()` are uncancellable

*Added 2026-08-30 at the close of M5.5 (trunk integration). Measured against `redesign@18322a8`.*

Three separate facts, deliberately separated because a coarser statement of them is misleading:

**(a) There is no PER-REQUEST timeout anywhere in `api.ts`.** No `AbortSignal.timeout`, no deadline on any
`fetch`, no server-side deadline surfaced to the client. Every request waits for the network stack to give up,
which on a stalled TCP connection can be minutes. Worded precisely on purpose: `api.ts` **does** call
`setTimeout` (`:59,141`), but only to schedule the access-token refresh — it bounds no request. "No
`setTimeout` in `api.ts`" would be the same literally-checkable-and-false shape this entry exists to correct.

**(b) The fetch-based `request()` and `requestForm()` take no `signal`,** so **every non-upload request in the
app is uncancellable** — nothing can abort a navigation-triggered fetch, a `getMessages`, an invite create, or
an avatar upload. There is no plumbing to pass one: `RequestInit` is constructed inside the method and no
caller can reach it.

**(c) The concrete user-visible trap is the avatar upload, and it is a complete one.** `uploadAvatar` →
`requestForm('/api/v1/users/me/avatar')` (`api.ts:339,342`). `AvatarCropModal` disables all three of its exits
while `saving` — the overlay click (`:171`), the header close (`:186`) and the cancel button (`:228`) — and
the modal does **not** adopt `useModalFocus`, so there is no Escape path either. A stalled avatar upload
therefore leaves the user with no way out of the modal except reloading the page. This is the item RESUME §6d
points at.

**What this is NOT, and the reason the entry is worded this way.** The M5.5 plan recorded that develop's
VYC-82 "shipped file upload on top of no `AbortController`, timeout or `signal` anywhere in `services/api.ts`,
so a stalled upload has no cancel path." That is literally true of those three identifiers and **materially
misleading**: **attachment upload has a working cancel path.** `uploadAttachment` (`api.ts:601`) deliberately
uses `XMLHttpRequest` rather than `fetch` — for upload progress — and returns `{ promise, abort }`
(`:605,661-663`); `abort()` is stored on the draft in `attachmentStore` (`attachmentStore.ts:12`) and invoked
by `useAttachmentUpload.cancel` (`useAttachmentUpload.ts:74-78`), which also handles the resulting
`upload_aborted` `ApiError` (`:40`). Anyone fixing this must not "restore" a cancel path that already exists.

**The fix** is a timeout plus an `AbortSignal` parameter threaded through `request()`/`requestForm()`, and
`AvatarCropModal` adopting `useModalFocus` so its Escape works. Both halves need a **`services/` scope grant**,
which spec §1 (fixed REST/WS contracts) and §7 (services out of scope) withhold from every redesign milestone —
so no redesign milestone may do it, including M6.

**Needs:** a `services/` scope grant. **Impact:** medium — a modal with no exit, reachable by any user on a bad
connection.

---

## 2. Decisions that need you before anyone can execute

Each of these has an obvious executor inside the redesign (mostly M6), but none of them is an engineering
default — they are product/board calls. Answer them and the work is small.

### 2a. ~~The focused screen-share view is 126.59px tall in the default split~~ — **CLOSED by M6 decision 8**

> **Decided (human ruling, 2026-08-30 M6 planning session): `.stage-thumbs` collapses.** That takes the
> largest lever named below — the strip is 41% of the stage's chrome — without touching the split, and so
> without breaking the draggability that made the obvious fix wrong. The three corrections below are kept
> because they explain *why* the fix is the strip and not the split; a future reader tempted to "just raise
> the height" needs them.

M3's marquee T4 deliverable, effectively unreadable at the 55% default; the solo tile overflows the same way.
Both trace to `.channel-body .call-stage { height: var(--call-stage-height, 55%) }` (`AppPage.css:26-27`).

Substantially pre-existing (the same overflow was measured pre-M3 with the old `.video-grid`; old chrome
~138px vs M3's ~155px), the split is user-draggable, and M3 *added* the two fullscreen affordances that solve
it — which is why it was parked rather than patched. **Three corrections anyone fixing it must have:**

- The obvious fix — `height: max(var(--call-stage-height, 55%), 75%)` — **is wrong**: the drag handle clamps
  to 20–80% (`AppPage.tsx:130`), so that rule collapses the effective range inside a focus view to 75–80%,
  destroying the draggability the park relies on.
- The `55%` fallback at `AppPage.css:26` is **dead code** — the variable is set unconditionally at
  `AppPage.tsx:632`.
- **The largest single lever is the thumbnail strip, not the split.** At 1440×900 the stage is ~394px and
  chrome is 56 (top bar) + ~101 (control bar) + **110 (`.stage-thumbs`)** = 267px. The strip is 41% of the
  chrome, and its `height: 110px` lives in `CallStage.css` — collapsing or shrinking it when the stage is
  short touches nothing else.

**Executor once decided:** M6.

### 2b. ~~Is the stage's accent theme-invariant or not?~~ — **CLOSED by M6 decision 2**

> **Decided: theme-invariant**, pinned to the dark value `#6366F1` via `--stage-accent` on `:root` only.
> **And the count in the paragraph below is wrong: it is 10 sites, not 12.** All ten are in `CallStage.css`.
> The 12 was never true — it was carried verbatim across three RESUME revisions without re-measurement, and
> `--stage-` happening to appear exactly 12 times in `tokens.css` is a plausible origin for the confusion
> and is a different quantity entirely.

Plan decision 25(b) makes the call stage theme-invariant (`--stage-*` on `:root` only, because board `1e`'s
stage is dark in both themes). Every `--stage-*` value does match across themes — but **12 sites** use
`--accent`/`--accent-hover` (share badge, focused-thumb ring, watch button, `is-on` toggle, banner button,
hover states), which flips `#6366F1` ↔ `#4F46E5`. The handoff gives **no separate dark-stage accent**, so
unlike the `--online` half of the same family (which the board *did* answer, and M3 fixed) this has no
board answer. Either the stage's accent should be invariant like the rest of its chrome, or the accent is
deliberately the one theme-responsive element on a theme-invariant surface.

**Executor once decided:** M6's dark-parity pass.

### 2c. ~~The call's leave button is a pill, not r14~~ — **SETTLED 2026-08-31 at `9bf7cd4`**

M3 shipped `--radius-pill` (r999) where a literal reading of board `1e`'s grid gives a rounded rectangle.
It was never formally ruled — it came through as plan text and nobody challenged it.

> **A human clicking through the app at M6 close found the real defect, and it was not the radius.** The
> button was the only control in the bar carrying its label *inside* it, as a text pill, while mic / camera /
> screen-share all use `.stage-ctl` — icon-only button with `.stage-ctl-label` beneath. Fixed: the label moved
> out, and the button is now **46×46, geometrically identical to its siblings**, with the caption 4px below
> (measured; sibling also 4px).
>
> **The pill radius was kept, deliberately.** With the text gone, the radius is what still distinguishes
> hang-up from the three rounded-square toggles — so the board departure this item recorded is now
> *load-bearing* rather than incidental. If anyone revisits it, that is the trade to weigh: r14 would make
> hang-up look like a toggle.

### 2d. Three non-M3 components' modal entrance changed

Deleting `CallUI.css`'s duplicate `@keyframes scaleIn` (scale `.92`) de-shadowed `primitives.css`'s
(scale `.95`) for `ContextMenu`, `Settings` and `AvatarCropModal`. Unavoidable within M3's scope (plan
decision 17 barred `primitives.css` from the commit, and re-adding a duplicate global keyframe would
re-violate the namespace goal the rewrite existed for). Bounded: all 16 keyframe names in `client/src` are
now unique, and the other four deleted keyframes have no surviving consumer.

Structurally identical to M2's `.error-toast` case, which sped two non-M2 components from 0.3s to 0.22s and
was recorded the same way. **Sign-off, not work** — unless you want the old value back.

### 2e. `--danger` still has no dark override, and that is a decision

M6's plan called for `--danger: #FCA5A5` in the dark theme. **T3 measured it and declined to apply it.**
`--danger` is used as **11 fill / 3 border / 3 foreground**; a pastel tuned for the three foreground sites
puts white text on a pastel fill at **1.90:1** across the eleven fill sites. An override that fixes the
minority wrecks the majority.

So the dark-theme behaviour this file and the RESUME both flagged — `--danger` foregrounds rendering `#E7444A`
at rest and jumping to `#FCA5A5` on hover, a shift that does not occur in light — **is still present, on
purpose.** Closing it properly needs the fill and foreground roles split into two tokens, which is a token-API
change nobody asked M6 to make. **Recorded so the absence reads as a decision and not an oversight** — that
distinction is the whole reason this entry exists.

### 2f. The 769–899px band renders desktop component styling

M6 decision 5 moved **only** the `AppPage.css` shell pair from the 768/769 boundary to 900. The **17 component
blocks** still sitting at 768/769 (`CallStage.css` ×6, `ChannelSidebar.css`, `ChatArea.css`, `Composer.css`,
`MediaLightbox.css`, `MessageAttachments.css`, `MessageRow.css`, `MessageSearch.css`, `ServerList.css`,
`UserList.css`, `VideoPlayer.css`, `VoiceBanner.css`) deliberately did not move.

**The cost is disclosed and accepted:** between 769 and 899px the shell is in its mobile single-panel model
while the components inside it paint desktop styling. Moving all nineteen would have been an unrequested
behaviour change across lint-clean blocks the previous milestone had just certified, several with no smoke
fixture to catch a regression.

**M6 did close the navigation half of this** (T8): the band was not merely ugly, it was a **trap** — the panel
opened with no header and no back button. The *styling* half is what remains, and it is what this entry is.

---

## 3. Tooling and test debt

### 3a. `tools/probe-chat.js` cannot fail — and it is the nominal cross-surface gate

182 lines with **no `verdict`, no `fail(`, no `throw`**. Every assertion is a recorded key/value pair read by
eye; a missing selector records `undefined`/`'absent'` and the run still succeeds. M2's closeout already
flagged this file's failure mode and it was not repaired. It is the nominal regression gate for M2's chat
column and **it is not a gate**.

**This one is cheap and M4–M6 benefit immediately**, so consider pulling it forward rather than waiting: the
file already uses an `X`/`expectedX` convention — add `const fail = (m) => { throw new Error(m); };` (the
pattern `tools/probe-screen-picker.js` uses correctly, 15 assertions, none recorded) and route those pairs
through it.

**CORRECTED — "the only copy" is false, and it was false when written.** Each milestone carries the harness
forward with `cp -R` rather than moving it, so **every SDD workspace still holds one**; the newest superset is
`.superpowers/sdd/2026-08-30-redesign-m6-polish/tools/`. They are all gitignored and in no commit, so the
*collection* is still one `git clean -fdx` from gone — but losing one workspace loses nothing. The practical
risk is different from the one this paragraph described: not deletion, but **drift**, since each copy is
independently repaired and the older ones silently rot.

**Also note this file's own §3a claim aged badly in a second way:** `probe-composer.js`, described elsewhere
as "silently dead", was **repaired by M6 T1** — and its failure was never silent (it surfaced as a loud
`PROBE ERROR:`), while the true damage was worse than recorded: with deferred flush, **0 of 89 assertions
produced a readable verdict**, not 48 of 88.

### 3b. The `npm test` RED baseline has been red since M1

3 tests in `src/services/__tests__/api.network-retry.test.ts` were merged without their implementation, plus
2 unhandled rejections originating solely there. Every milestone has treated the exact shape as a delta-gate
and forbidden touching the file. Someone should either implement the retry logic the tests describe or delete
them — a permanently red suite trains people to ignore red.

### 3c. Weak tests carried from M2

`messageStore.test.ts`'s "can set and clear deliveryState" never asserts the clear case;
`unreadStore.test.ts`'s "survives a corrupt payload" is vacuous twice over (it never reaches `load()`'s
catch, which runs at module import before any `beforeEach`). ~4 lines each. `unreadStore`'s `load()` catch is
untested; its failure mode is a throw at module import, which breaks every dev run loudly, so it is low
urgency.

### 3d. Evidence the redesign could never gather in this environment

Carried so nobody assumes these were verified:

- **The speaking ring has never been driven by a real voice.** That part stands. **But the reason recorded
  here for three milestones is measured FALSE and must not be repeated:** `--fake-media`'s tone does *not*
  peak at ~0.0065–0.0115. It is a **full-scale periodic beep every ~450ms**, and that range is its decay
  tail. The original comparison also put a **time-domain amplitude against a frequency-domain reader**, so
  the two numbers were never commensurable in the first place. Whatever keeps `is-speaking` from firing, it
  is not the tone being quiet.
  The level→radius mapping, the `var(--speak-level, 0)` fallback and the forced-class ring were all measured;
  the JSX-conditional equalizer inside a live plate was not.
  **Cheapest closure:** one dev-only run that drives `micLevel` above threshold (or temporarily lowers the
  threshold) and reads the mounted `.stage-plate`. Forcing the CSS class will **not** do it — and neither
  will reasoning from the falsified amplitude above.
- **Remote speaking rings are structurally unreachable** with the current harness — injected synthetic
  participants carry `stream: null`.
- **The focused screen-share view was exercised as layout only** — a single-account smoke server has no
  second peer, so no real screen stream has ever rendered in it.
- **Electron: PACKAGED behaviour is unmeasured — the renderer branches are not.** Narrowed at M6 T14, where
  the blanket "every Electron branch" claim turned out to be overstated. Electron cannot launch (npm 11's
  `allowScripts` skipped its postinstall, so `node_modules/electron/dist` is **236K** — not the 292K recorded
  here for three milestones — instead of ~250MB; fixable with `npm install-scripts ls` in `client/`). **But
  `smoke.mjs --fake-electron` plus the standing `titleBar` report block does drive the `electronAPI`-gated
  renderer branches, and M6 measured them.** What remains unmeasurable is packaged behaviour, including M3
  ruling T4-e's platform-dependent fullscreen glyph semantics, which someone with a working build should
  check in one pass.
  **Practical consequence for anyone running the app:** `npm run dev` **cannot start the dev server in this
  environment** — it runs vite and Electron under `concurrently -k`, Electron throws
  `Electron failed to install correctly`, and `-k` kills vite with it. Use **`npm run dev:vite`**. Every
  milestone's "restart the dev server" instruction was written without knowing this.
- **A second test account** would close the remote-participant, incoming-call and not-own-message branches
  that three milestones have now had to reason about instead of measure.
