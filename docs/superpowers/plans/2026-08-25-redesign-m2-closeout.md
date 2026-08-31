# M2 (Chat Column) — closeout & handoff to M4/M5/M6

**Status:** complete. 19 commits `f39e699..3ada3cc` on `redesign` (2 are docs-only — `8c99330` this
milestone's plan, `5007bfb` the M1 closeout — leaving 17 implementation/fix-wave commits). Not pushed;
`main` untouched.
**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` §5 M2 bullet.
**Plan:** `docs/superpowers/plans/2026-08-25-redesign-m2-chat.md`.

Every task passed a task-scoped review (several after one fix round). The whole-branch review
(`f39e699..de9a5a2`, opus, 18 commits) returned a fix wave of 8 items (1 Critical, several Important, plus
promoted one-liners); all 8 landed in `3ada3cc` and a scoped re-review (`de9a5a2..3ada3cc`) confirmed all 8
addressed at the defect level, no new Critical/Important breakage, verdict **"ready to hand to a human, with
caveats."** The two caveats are recorded verbatim below under "Awaiting the human," alongside a third,
higher-stakes business call the final review surfaced separately.

This file exists because the SDD workspace (`.superpowers/sdd/2026-08-25-redesign-m2-chat/`) is gitignored and
will be deleted after this task — the ledger's rulings, triage, and harness notes are transcribed here before
they are lost, exactly as the M1 closeout did for M1.

**Constraint compliance, independently confirmed by the final whole-branch review:** no changes under
`server/`, no changes to `src/services/`, `src/types/index.ts` untouched, no API/WS contract change, no legacy
token alias deleted from `tokens.css` — which changed by exactly **+4/−2** lines across the whole milestone. All
of M2's Global Constraints held.

**What M1 handed off, and its state now:** M1's closeout listed the cascade-order fix as M2's first job (done —
see below) and the header seam (58px vs 56px vs 58px across three files; closed in T6, `MessageSearch.css:4`
updated in the same task per plan decision 2). The rest of M1's "do these first or while in the file" list —
`.no-server-message`'s last legacy `--text-muted` alias, the orphaned `.chat-voice-btn.in-call` CSS, the fourth
hand-inlined back-arrow SVG, `.panel-icon-btn.is-off`'s missing `:hover` (T8 touched `primitives.css`, which
should prompt a fresh check) — is not mentioned anywhere in this milestone's ledger, one way or the other. State
that plainly: M2 neither fixed nor re-verified these; M4/M6 should treat them as still open, not as resolved by
omission.

**A note on completeness:** the ledger records 18 distinct `Ruling:` statements. One (the provisional
`.chat-back-btn` desktop-visibility call made before Task 6) is superseded in place by a more specific ruling
made just before Task 6 was dispatched, so the list below presents it once, noting the early form was
provisional. That leaves 17 distinct binding decisions, enumerated in full below.

---

## Hardening landed first: cascade order (Task 1)

The plan's Goal line names two hardening tasks that had to land before the restyle work: CSS cascade order and
the stylelint delta-gate (the latter has its own section below). The cascade fix is the most reusable fact in
this milestone and is easy to lose in a table keyed to spec clauses, so it gets its own paragraph.

M1's closeout handed M2 an open defect: `main.tsx` imported `App` before the `styles/*` base-layer imports, so
ES-module evaluation injected the whole component-CSS graph *before* tokens/base/primitives — at tied
specificity, `primitives.css` beat every component override (it had already killed one M1 rule). T1
(`2676efc`) reordered the imports and verified the fix twice over, independently, in two different artifacts:
- **Dev-side:** live DOM proof that `tokens.css`/`base.css`/`primitives.css` (`<style data-vite-dev-id>` indices
  6/7/8) precede the first `components/*.css` (index 10 of 40 injected tags), with zero cross-layer specificity
  ties found across every M1-probed surface.
- **Production bundle (T13, not in the original brief — added because Rollup derives emitted CSS order
  separately from Vite dev's injection order, so the dev proof alone would not have been sufficient):** in
  `dist/assets/index-D091NU8P.css`, tokens (@22178) → base (@25864) → primitives (@26715) → first component rule
  (@35957) → M2's own rules (@70836+). Every base-layer-unique marker occurs exactly once, inside the
  22070–33450 byte range, and no base-layer fragment reappears after the component boundary. The final
  whole-branch review independently re-ran this exact check and confirmed the same byte offsets.

**Standing fact for M3+:** component CSS reliably wins specificity ties against the base layer, confirmed in
both dev and the shipped production artifact. Anyone overriding `.btn`/`.modal`/`.kbd` (M4 will, repeatedly)
can rely on source order rather than fighting specificity.

---

## What M2 shipped, against spec §5's M2 bullet

Spec §5: *"M2 — Chat (board 1c column C, 2a, 2b, 1f). Single left-aligned metaphor (grid 42px 1fr, grouping
window 5 min — changed from today's 7), own message = own-msg-bg + 2px accent border + "вы" chip; header 58px;
date dividers; hover action popover (edit/delete/quote); delete via the new destructive-confirm modal (replaces
window.confirm); composer single field with Aa toggle hiding the formatting toolbar, accent send square, hint
line; restyled mention dropdown/emoji/sticker pickers; empty states; unread divider + viewport mark-read
(introduces the unreadStore); optimistic delivery states; enter animation (220ms) and skeleton loading; mobile
chat per 1f within the existing single-panel mobile model."*

Clause by clause:

| Clause | Status | Notes |
|---|---|---|
| Single left-aligned metaphor, grid `42px 1fr`, 5-min grouping | **Landed** | T3 (grouping util) + T6 (MessageRow). Measured `42px 750px` at the smoke-server viewport (750px = the flexible column) — exact match. |
| Own message: `own-msg-bg` + 2px accent border + "вы" chip | **Landed** | T6. T13 measured bg/border/chip colors as exact rgb matches to spec in both themes. |
| Header 58px | **Landed, adapted** | T6, per plan decision 2 (closes the M1-deferred 56/58/58 seam). **Adaptation:** the board's 1×20px divider + channel-topic text is dropped — `Channel` has no `topic` field (`types/index.ts:23-30`) and adding one is a backend change, out of scope per spec §1/§7 (ruling iii, pre-resolved before T6). The `.chat-header-divider` rule the plan's own class inventory lists was deliberately never shipped — dead CSS with no consumer was a flagged M1 defect and M2 did not repeat it. |
| Date dividers | **Landed** | T6, `DayDivider.css` restyle: 11.5px/600 `--muted-2` label, `--line` rules, `--canvas` background. |
| Hover action popover (edit/delete/quote) | **Landed, adapted** | T6. The board's popover is edit/delete/**react**; M2's is edit/delete/**quote** — a documented, plan-mandated substitution (plan line 1853: "popover edit/delete/quote (T6)"), not a slip. No react button ships. "Quote" = the composer prefill (`>` text), not a persisted reply relation. |
| Delete via destructive-confirm modal, replaces `window.confirm` | **Landed, scope-limited** | T5. Per plan decision 1, M2 replaces only the **message-delete** confirm. Server/channel-delete confirms in `ChannelSidebar.tsx`, `ServerList.tsx`, `StickerManager.tsx` stay on `window.confirm` until M4, which rebuilds those menu flows and dedupes the ChannelSidebar/ServerList duplicate anyway. `ConfirmModal` was built reusable so M4 only swaps call sites. |
| Composer single field, `Aa` toggle, accent send square, hint line | **Landed** | T7. Measured border-radius 14px, padding `8px 10px 8px 12px`, gap 10px; `Aa` 32×32/r9; send 34×34/r10/accent — all exact. |
| Restyled mention dropdown / emoji / sticker pickers | **Landed** | T6 (mention), T8 (emoji/sticker extracted into their own CSS files off ChatArea.css). |
| Empty states (2a) | **Landed, adapted (×3)** | T9. See "Empty-state adaptations" below — all three variants ship with a documented cut, per plan decision 5. |
| Unread divider + viewport mark-read, introduces `unreadStore` | **Landed** | T4 (store) + T10 (viewport wiring, IntersectionObserver). T10 also fixed a pre-existing cross-channel data-corruption bug it found in the plan's own verbatim Step 3 code (a stale observer notification could write one channel's `lastRead` mark under another channel's key on a plain switch) — see ruling below. |
| Optimistic delivery states | **Landed, adapted** | T3 (store fields: `sending`/`failed`) + T11 (wiring, retry, dark contrast). **Sticker send stays non-optimistic**: `onSendSticker` keeps T7's `Promise<boolean>` draft-guard signature because T11's optimistic path only covers text sends — a deliberate scope narrowing disclosed by T11, not an oversight. |
| Enter animation (220ms) + skeleton loading | **Landed** | T6. Enter animation is shape-derived (see ruling below, a mid-milestone fix), not driven by a since-deleted tracking variable the plan's own text pointed at. |
| Mobile chat per 1f | **Landed, 2 disclosed real deviations** | T12. Below the board's ≥40px touch-target floor, `.msg-action-btn` measures 28×28 (clears WCAG 2.5.8 AA at 24px, so this is a genuine accessibility shortfall, not just board-fidelity); `@media (hover: none)` has no width bound, so a touch-capable **wide** screen also gets the always-visible action row instead of only mobile widths. Both disclosed by T12 itself, both re-confirmed present at T13's final visual QA. |
| Header search button | **Landed, adapted** | Decision 6: stays icon-only 34×34 in M2; the board's dark-theme `⌘K` chip arrives with M5's command palette. |

**On the floating-quote toolbar — two different things, only one dropped.** The old UI had two floating-quote
affordances: an **edit-selection** one (quoting your own text mid-edit) and a **compose-selection** one
(quoting while typing a new message). The plan explicitly drops only the first — "the edit-selection
floating-quote toolbar is dropped — quoting your own text mid-edit was an artifact of the old UI; the popover
quote covers the use case" (plan line 937) — because MessageEditor's rewrite removed the old edit-path
selection-toolbar state entirely. The **second** one shipped: it was carried into the composer rewrite (T7,
renamed `chat-quote-float`), and T7's own review found it duplicated verbatim between `Composer.tsx` and
`ChatArea.tsx`, so a fix round (commit `068fb18`) extracted it into its own `FloatingQuoteButton.tsx` +
`FloatingQuoteButton.css`, imported by both call sites. That component is real, shipped, and lint-clean — it is
not the toolbar the plan cut.

**Empty-state adaptations (2a), per plan decision 5** — all three confirmed present, unchanged, at T13:
- Quiet-channel card: the "или закрепить правила канала" ghost link is dropped (no rules feature exists).
- No-servers card: only the primary «Создать сервер» button renders (wired to AppPage's existing modal). The
  secondary «У меня есть код» waits for M4's merged find-server modal; the rail's working search tile is
  adjacent in the meantime.
- No-search-results: restyle applies only to `MessageSearch`'s existing empty branch (the full `MessageSearch`
  restyle is M5's). Ships with **no suggestion chips**, and a single combined title+body string ("Ничего не
  найдено по запросу «…»") rather than the board's two-line title/body split — both are part of the same
  scope-limited restyle, not an unrelated slip (`task-9-report.md:21-29`).

**Feature-scope cuts (spec's feature-scope row, not the M2 bullet itself, but binding on this milestone):**
typing indicator, read receipts, reactions, attachment cards, and live unread/mention badges (sidebar bars,
rail counts) are all explicitly skipped — undeliverable client-side per spec §3, deferred to a backend phase.
None of these were evaluated as findings in T13's visual QA; their absence is expected, not a gap.

---

## Decisions that bind later work

Presented in the order each decision was bound to a task (pre-flight scan → T2 → T5 → T4 → T6 pre-dispatch →
T6 → T7 → T8 → T9 → T11/T12 carry-forward → final review), which is not the order the ledger's prose appears in
(the ledger runs T1→T8, jumps to the fix wave, descends T12→T9, then a block of decisions made *before* T6/T11/
T12 ran). Each entry states what it costs if wrong.

1. **(T2) `importFrom` is cwd-relative; stylelint must run from `client/`.** The plan's own mandated
   `.stylelintrc.json` text hard-crashes with `ENOENT` when invoked from the repo root — a real defect, but one
   in config text the plan mandates verbatim, so the T2 implementer had no scope to fix it. Kept the mandated
   JSON; enforced `cd client &&` in every later task's dispatch text; deferred the `.stylelintrc.cjs` +
   `__dirname`-resolved `importFrom` migration to M6. **Cost if wrong:** a later invocation from the wrong cwd
   sees a crash misread as "no violations" instead of a lint result.
2. **(T5, pre-resolved) The plan's Step 5 delete-button selector is garbled.** Resolved from the live pre-T6
   markup: the delete button is `.message-action-btn--danger`, inside `.message-actions` which is
   `display: none` until row hover — unreachable by a plain CDP `--click`. T5 triggers it from a probe script
   instead. **Cost if wrong:** one lost screenshot; the modal is still verifiable by forcing state.
3. **(T4) Three plan-mandated test/behavior findings are parked, none blocking M2:** (a) the brief's "markRead
   survives a corrupt localStorage payload" test does not actually exercise `load()`'s catch (which runs once
   at module import, before any `beforeEach`) — the guard is 10 obvious lines whose failure mode would break
   every dev run loudly and immediately; (b) lexicographic ISO-string compare (`created_at > mark.ts`) is sound
   for one uniform server clock, documented in the plan; (c) a `markRead` write to full/blocked localStorage is
   silently swallowed — deliberate per spec §4.4 so quota/private mode never breaks chat. **Cost if wrong:** (a)
   an untested 10-line guard; (b) divider anchors misplace if the API ever changes timestamp format; (c) none —
   this one is working as designed.
4. **(T6 pre-dispatch, i) `.chat-back-btn` desktop visibility.** Today's `ChatArea.css` hides
   `.mobile-back-btn`/`.mobile-call-btn`/`.mobile-members-btn` with `display: none` at base scope and turns them
   on only inside `@media (max-width: 768px)`. T6 mirrors that pattern for the replacements. This supersedes an
   earlier, more tentative version of the same call made during the pre-flight scan, before the live markup had
   been read. **Cost if wrong:** a stray 40px button in the desktop header, caught by screenshots.
5. **(T6 pre-dispatch, ii) Which mobile-replacement buttons stay hidden on desktop.** `.chat-back-btn` and
   `.chat-call-btn` stay desktop-hidden (mobile-only, as today — a mic button in the desktop header is not on
   the board and CallDock already covers it). `.chat-members-btn` becomes **visible on desktop** — the handoff
   README puts a 34×34 members-toggle button in column C's header, and M6's 1000–1200px breakpoint depends on
   it existing. **Cost if wrong:** one extra desktop header button, visible in screenshots and trivially hidden
   later.
6. **(T6 pre-dispatch, iii) Header divider/topic dropped.** Covered above in "What M2 shipped." **Cost if
   wrong:** dead CSS with no consumer, the exact class of defect M1 was flagged for.
7. **(T6, CONFLICT-1) The legacy composer stays alive in `ChatArea.tsx`/`.css` through Task 6's lifetime.**
   T6 keeps the old `.chat-input`/`.toolbar-btn`/old `.mention-dropdown`/composer JSX and handlers working,
   untouched, at the bottom of the rewritten file (mirroring how the emoji/sticker blocks were already carried);
   T7 deletes both. **Cost if wrong:** a little duplicated CSS for one task's lifetime, cleaned the next task.
8. **(T6, CONFLICT-2) The stylelint clean-file gate binds only the *rewritten* portion of `ChatArea.css` for
   Task 6.** The plan's Global Constraints say every file M2 creates or rewrites must be violation-free, but T6
   Step 9 explicitly keeps the legacy picker blocks at the bottom of the same file. Ruling: the gate binds the
   rewritten portion only, for Task 6 only; the carried-verbatim violations are enumerated in the ledger, and
   Task 8 Step 3 deletes them — after which the file must be fully clean with no exception. **Cost if wrong:**
   one task's lifetime of known, listed violations in one file.
9. **(T6) The `is-*` class-modifier mapping — load-bearing for every later task.** The plan's own class inventory
   spells state modifiers with a BEM `--` (`msg-row--own`, `msg-action-btn--danger`, `chat-skel-line--short`…),
   but decision 4's own mandated `selector-class-pattern` regex requires `is-*`/`has-*` for state and rejects a
   double dash outright — the plan contradicts itself. The regex wins, because it is the enforced gate. Binding
   mapping, used by every subsequent task and by this document:

   | Plan spelling | Shipped class |
   |---|---|
   | `msg-row--own` | `.msg-row.is-own` |
   | `msg-row--continuation` | `.msg-row.is-continuation` |
   | `msg-row--enter` | `.msg-row.is-entering` |
   | `msg-row--highlight` | `.msg-row.is-highlight` |
   | `msg-row--sending` | `.msg-row.is-sending` |
   | `msg-row--failed` | `.msg-row.is-failed` |
   | `msg-action-btn--danger` | `.msg-action-btn.is-danger` |
   | `chat-skel-line--short` | `.chat-skel-line-short` |
   | `chat-skel-line--long` | `.chat-skel-line-long` |
   | `msg-delivery--sending` | `.msg-delivery.is-sending` |
   | `msg-delivery--failed` | `.msg-delivery.is-failed` |

   Note the two skeleton-line names are **not** `is-*` state modifiers — they became a third kebab-case name
   segment instead, because "short"/"long" describe a variant, not a boolean state. **Cost if wrong:** the gate
   is otherwise unpassable — this is not a cosmetic option, one of the two names had to give. The whole-branch
   reviewer independently endorsed this mapping by name: "the regex was the right winner."
10. **(T6) The enter-animation reconciliation is shape-derived, not variable-driven.** T6's own review found the
    plan's animation-tracking approach (three manual `resetEnterTracking()` calls, later mitigated by a variable
    the plan's Step 5 for T11 also references) unreliable under fast channel switches. Fixed by having the seed
    effect detect wholesale list replacement (previous list not a prefix of the new one → reseed without
    animating) instead of trusting the manual resets. The alternative (an `AppPage` stale-response guard) was
    rejected because it would have silently fixed a **pre-existing**, out-of-scope race as a side effect — that
    race is recorded as a deferred finding below and was later fixed properly, in scope, by the fix wave.
    **Cost if wrong:** the deeper race stays open until someone owns it.
11. **(T7) `.composer` becomes `.composer-root` — load-bearing for T8 and T12.** The plan calls the composer
    wrapper `.composer`, but a bare single-segment class fails the mandated `selector-class-pattern` (allowlist
    is only `btn|input|kbd|modal|mention`), and the gate demands 0 problems on new files. Shipped as
    `.composer-root`. Downstream consequences, all resolved during M2: T8's brief text naming `.composer` as the
    picker anchor is stale prose only — the pickers already resolve via `offsetParent === composer-root`, so no
    CSS change was needed there; T12's mobile block, which the plan text writes as `.composer { padding … }`,
    had to target `.composer-root` instead; and `tools/probe-chat.js:150`, which originally selected
    `.chat-input textarea` (a class deleted in T7) and silently **recorded a string instead of failing** when
    that selector went stale, was repointed at `.composer-input` — confirmed still correctly pointed as of T13
    (see Harness section; this one is **not** currently stale). **Cost if wrong:** a name differing from the
    plan's prose; the gate is otherwise unpassable.
12. **(T8) `.error-toast` + its keyframe lifted into `primitives.css`.** ChatArea.css could not reach 0
    violations without this: 3 of its 11 remaining violations were `@keyframes slideDown` (naming), a
    rule-empty-line-before, and the `.error-toast` block itself — and it is a genuinely shared primitive, also
    consumed by `StickerManager.tsx` and `CallUI.tsx`. Lifted with the keyframe renamed kebab-case and every
    reference updated. **Cost if wrong:** a shared toast style lands in `primitives.css` one milestone before M4
    formally owns that layer — accepted, since the alternative was an unpassable gate.
13. **(T8) The `primitives.css` clean-file gate was self-corrected from 0 to "must not gain a violation."**
    An earlier T8 dispatch demanded 0 problems on `primitives.css`, which was wrong: it is an M0 file with 21
    pre-existing violations M2 neither creates nor rewrites, and the plan's Global Constraints say not to
    mass-fix legacy files. Corrected gate: the four picker/ChatArea files must be 0; `primitives.css` must simply
    not gain a violation (verified 21 → 21 both directions), and the newly-moved-in `.error-toast` block must
    land clean on its own terms. T8 fixed none of the 21 pre-existing ones. **Cost if wrong:** the lint total
    stays ~13 higher than it could be until M6 — this is the intended, accepted cost, not an error. The
    whole-branch reviewer independently endorsed this corrected gate by name, honoring "M6 owns the sweep."
14. **(T9) `serversLoaded` added to `serverStore` — an authorized scope change beyond the brief.** T9 found that
    `servers` starts empty and is fetched asynchronously with no loading gate, so for ~100–350ms on every cold
    start the new "no servers" empty-state card asserted something false to users who do have servers. Added
    `serversLoaded: boolean` + `setServersLoaded`, set `true` in a `finally` around AppPage's `loadServers` fetch
    (true on failure too, so a failed fetch cannot hang the UI blank), gated the card on
    `serversLoaded && servers.length === 0`. **Cost if wrong:** one more field in `serverStore` than the plan
    anticipated, and a blank chat column for ~300ms on cold start instead of a false card — judged the better
    trade.
15. **(T11/T12 carry-forward, found before dispatch) T11's optimistic send would have visibly broken T6's enter
    animation.** `replaceMessage(tempId, serverMsg)` keeps the same list length while only the last id changes,
    which T6's shape-detection (decision 10 above) reads as a non-append reconciliation and clears the whole
    `enteredIds` set — so a row just sent has `is-entering` stripped mid-fade on every send whose HTTP response
    lands inside the 220ms window (routine). The plan's own mitigation text pointed at a tracking variable T6 had
    already deleted. T11 was required to treat a same-length single-position id swap as a reconciliation instead:
    update the id-tracking ref in place without clearing `enteredIds`. **Cost if wrong:** a visible animation
    glitch on every single message sent — the fourth false-pass shape this milestone would have produced, since
    a post-hoc probe check reads clean either way; T11's probe had to sample *during* the 220ms window.
16. **(T11/T12 carry-forward) Two pre-found defects in the plan's own touch block, fixed before they could ship
    broken.** (a) `.msg-actions` escapes `.msg-row`'s `grid: 42px 1fr` only via `position: absolute`; the plan's
    `@media (hover: none)` block sets `position: static`, which would auto-place it into the 42px gutter track
    instead of the content column — needs an explicit `grid-column: 2`. (b) `.msg-row:hover .msg-actions` is
    declared before the media-query override, and `@media` adds no specificity, risking
    `no-descending-specificity` — the exact rule class whose Task-2 rationale cites the M1 dark+touch join-pill
    regression. **Cost if wrong:** a hard gate failure (MessageRow.css must stay at 0 problems) or a
    genuinely broken touch layout, not just a lint nit.
17. **(Final review) The media-query range-syntax recommendation was declined for this branch — surfaced to the
    human, and higher-stakes than it first reads.** The reviewer suggested changing M2's three
    `@media (width <= 768px)` blocks to `(max-width: 768px)` to match six sibling files, because on Safari <16.4
    the range syntax silently no-ops while the siblings still apply — producing a **hybrid** broken mobile
    layout, not a gracefully-degraded desktop one. Declined because `stylelint-config-standard`'s
    `media-feature-range-notation` rule actively *requires* the range form (it is one of the recorded 605-baseline
    violations in legacy files), so switching M2's blocks would breach the "0 problems on every M2 file" gate
    unless the rule is flipped repo-wide — which changes the recorded baseline and contradicts "M6 owns the
    legacy sweep." Electron 41 (the primary shipping target) is modern Chromium; range syntax has been in Safari
    since March 2023. M6 rewrites all of these blocks anyway for the 768→900 breakpoint migration and can unify
    syntax and lint config in that one decision. **Cost if wrong: the web client on iOS Safari <16.4 gets a
    hybrid mobile layout until M6 ships.** This is a browser-support business call, not an engineering default —
    see "Awaiting the human" below.

---

## Awaiting the human

Three judgement calls were explicitly left unsigned by the process, in ascending order of stakes:

1. **Toast animation duration.** Unifying `.error-toast` onto one canonical recipe (fix 5, below) sped
   `CallUI`'s and `StickerManager`'s toast entrance from 0.3s to 0.22s — a behavior change to two **non-M2**
   components, made to fit M2's binding ≤250ms chat animation budget. An alternative existed (a
   `ChatArea`-scoped `animation-duration` override) at the cost of re-adding one chat-specific rule instead of
   sharing one. Every other value in the merged recipe is byte-identical, checked in both themes.
2. **`--radius-row` used on a toast.** Value-correct (9px, identical to the `--radius-md` alias it replaced) but
   semantically odd on a non-row element. Deferred to M6's token-naming pass.
3. **The media-query range-syntax call (ruling 17, above).** This is the one worth reading first: it is a
   live browser-support risk on shipped mobile CSS (iOS Safari <16.4 gets a hybrid, not graceful, broken mobile
   layout) rather than an internal-naming question, and it was explicitly marked in the ledger as "a
   browser-support business call — surfaced to the human."

---

## Deferred findings, triaged by owner

The whole-branch reviewer's parked-findings table is the backbone of this section — the ledger says the
closeout is built from it, so it is carried across close to verbatim, with the scoped re-review's follow-on
observations appended where they belong. Items already fixed in the M2 fix wave (commit `3ada3cc`) are marked
**RESOLVED** rather than dropped, so this document stays a complete record of what was found, not just what
remains open.

### User-visible correctness risks (read this part even if nothing else)

Two are prominent because they are silent data loss, not polish, and both are still open at M2 close:

- **Lost draft on a failed send.** Pre-T11, a failed send left the user's text in the composer (T7's
  `Promise<boolean>` draft guard). Post-T11, the composer clears synchronously on submit and the only copy of
  the text lives in the transient `failed` row — and `AppPage` replaces the whole `messages` array on channel
  switch, so navigating away silently discards it. This is inherited store architecture (T3/T6), outside T11's
  scope to fix, and the fix wave explicitly declined to restore it ("the lost draft is not restored to the
  composer — that stays deferred, per instruction"). **Owner: M4/M6** — needs a store-architecture decision,
  not a local patch.
- **Catch-path residue: a rejected fetch for the still-current channel still paints the previous channel's
  messages.** Found by the scoped re-review, in `AppPage.tsx:543-544`. The fix-2 stale-response guard (below)
  only guards the success path; if the fetch **rejects** while the channel is still current, `messages` still
  holds the *previous* channel's list, so the unread anchor latches off the wrong channel and old rows paint
  under the new header. Byte-identical before and after the fix — a different mechanism from the race that was
  fixed. The finding's other candidate remedy, "clear `messages` before awaiting," would have closed this one
  too; the guard remedy that shipped does not. **Owner: M4/M6.**

Two more in the same class, lower-severity but worth carrying forward together:

- **Pre-existing: a POST that succeeds after a channel switch still no-ops its `replaceMessage`.** The message
  lands on the server but is invisible client-side until a refetch. `handleChannelRemoved`/`handleServerRemoved`
  compare against closure-captured state rather than `getState()`. Not introduced by M2. **Owner: M4/M6.**
- **Fix 1's narrow residual edge, deliberately left out of the fix wave's scope.** If `channel` becomes `null`
  between a send and its rejection (last channel deleted, server removed), `ChatArea` early-returns before the
  toast can render, so the failure has nowhere to surface. Same class as the lost-draft finding above.
  **Owner: M4/M6.**

### M4 (modals, menus, settings — before `ConfirmModal` is reused for server/channel deletes)

- **RESOLVED in the fix wave:** the silent-send-failure Critical (fix 1) and the failed-row dismiss affordance
  (fix 3) both touch paths M4 will extend when it wires more delete/retry flows — read fixes 1 and 3 below
  before extending them.
- **`ConfirmModal` autofocuses the DESTRUCTIVE button**, so a stray Enter deletes. Plan-mandated verbatim — a
  plan defect, not an implementation one — but M4 reuses this component where the same keystroke costs far more
  (server/channel deletes). Standard practice is to focus Cancel. Also absent: a focus trap and focus restore on
  close.
- `ConfirmModal`'s Esc-listener effect re-subscribes on every parent re-render while open (functionally inert
  today; a `useCallback` at the call site fixes it — revisit if M4 reuses the modal in a render-heavy surface).
- The emoji/sticker pickers sit ~24px higher than the board shows, because the containing block now includes the
  hint line (T8 owns those blocks) — a design call, not a defect, but M4/M5 should know it's there before
  reusing the picker anchor pattern elsewhere.
- `onQuote` was offered on sticker messages (a bare `> ` insert made no sense) — **RESOLVED in the fix wave**
  (fix 6a): quote is now gated on `!msg.sticker_id`, and the popover wrapper itself is gated on
  `!msg.sticker_id || isOwn` so a not-own sticker row's popover can't render with zero children while still
  painting a background/border/shadow. The not-own branch is reasoned (both remaining children require
  `isOwn === false` to be absent), not measured — the single-account smoke server has no second account to
  exercise it empirically.

### M5 (command palette)

No deferred *findings* land here — the header search button staying icon-only and the full `MessageSearch`
restyle waiting for M5 are documented scope adaptations (see "What M2 shipped"), not open defects.

### M6 (polish, dark parity, responsive, alias deletion)

- **Media-query syntax** (`(width <= 768px)` vs six siblings' `(max-width: 768px)`) — ruling 17 above; owned by
  M6's 768→900 breakpoint migration, which rewrites these blocks anyway.
- **`.stylelintrc.cjs` / `importFrom` cwd-relative migration** — CI runs from `client/`, so the hazard is
  ad-hoc invocations only, but M6 owns the general CSS-tooling sweep.
- **Two weak tests, names overstating coverage:** `messageStore.test.ts`'s "can set and clear deliveryState"
  never asserts the clear case; `unreadStore.test.ts`'s "survives a corrupt payload" is vacuous twice over
  (doesn't reach `load()`'s catch). ~4 lines each. A third, related but not in the final review's table:
  `messageGroups.test.ts`'s "window is 5 minutes" is a tautological constant check — acceptable as an
  interface-lock guard, not incorrect, just weaker than its name implies.
- `load()`'s catch (unreadStore) is untested — failure mode is a throw at module import, which breaks every dev
  run loudly, so this is low urgency.
- Lexicographic ISO-string timestamp compare — sound for one uniform server clock (ruling 3b above).
- `as any` in `setup.ts:32` (redundant under the outer cast); `MessageEditorProps` passes 16 props to consume 5;
  delete-clears-the-enter-baseline (any message deletion clears the whole `enteredIds` set, snapping a still-
  animating row ~200ms early — cosmetic, low-frequency); T11's `diffCount ≥ 2` batch case (two in-flight sends
  resolving in the same React batch re-triggers the same bug class ruling 15 fixed for N=1); the divider
  silently disappears if its anchor message is deleted mid-visit.
- localStorage write per incoming message — a synchronous `JSON.stringify` of the whole map on every arrival;
  short-circuiting when the id already equals the mark is ~2 lines.
- `<h2>` where the old quiet-channel state used `<h1>` — the chat column now has **no `h1` at all**; one line in
  M6's heading-outline pass.
- Duplicated 56px/r18 empty-state tile magnitudes (no shared token); unspecced `min(100%, 340px)` card width;
  duplicate `<h3 className="chat-header-name">` discriminated only by DOM position (a11y-safe — the inactive one
  is `display: none` and leaves the accessibility tree — but a modifier class would read better); inert
  `flex-shrink: 0` on `.chat-header-actions` (measured-inert defensive code).
- `msg-mention-role` is emitted with no matching CSS rule — pre-existing at `f39e699`, carried through the
  `is-*` rename unchanged; confirmed by the final review's bidirectional class scan as the only orphaned-class
  finding across all 11 M2 CSS files.
- `msg-jump-flash` animates background to `transparent`, stripping an own-message row's tint for 2.2s.
- **NEW for M6:** M2 introduced the chat column's first infinite-loop animation (`chat-shimmer 1.2s infinite`,
  the skeleton loader) — a concrete target for M6's `prefers-reduced-motion` pass.
- `--text-muted` legacy alias remaining in `MessageSearch.css:170` (M5 restyles that file next, but the alias
  itself is M6's to delete).
- CSS comment at `MessageRow.css:204-211` — **RESOLVED in the fix wave** (fix 6b): it asserted a rule ordering
  "would trip `no-descending-specificity`," which two independent counterfactual tests under stylelint 17.14.1 +
  config-standard showed does not actually fire for that selector pair across the `@media` boundary. The ordering
  itself was kept (it's still good practice); only the justification comment was corrected — "a wrong comment is
  worse than no comment" was the reviewer's phrase, and this fix was promoted out of the parked list for exactly
  that reason.
- Skeleton shimmer compounding — **RESOLVED in the fix wave** (fix 6c): `.chat-skel-row` was dropped from the
  `chat-shimmer` selector list; opacity was multiplying down three nested layers (0.55 × 0.55 ≈ 0.30 actual
  trough instead of the declared 0.55) because the parent row and its children all animated in sync.

### Closed, not deferred

T7's missing in-flight submit guard (a fast double-Enter could send twice) is closed, not carried forward:
T11's `submittingRef` + optimistic send close the window as a side effect of unrelated work.

### No action

T4(c)'s silently-swallowed `markRead` write on a full localStorage quota (deliberate per spec §4.4); npm's
transitive dependency dedupe (`postcss`/`nanoid`/`hasown` patch bumps, normal, lock committed); `showSendError`'s
small unrequested de-duplication of four identical call sites; composer draft lost when `channel` becomes `null`
(only reachable via a zero-channel server or a deleted current channel — narrow enough that it's tracked as the
correctness-risk item above, not separately actioned).

---

## Stylelint baseline history

**605 → 546 (T6) → 542 (T7) → 531 (T8) → held at 531 through T9, T10, T11, T12, the fix wave, and both final
reviews.** T13's gate sweep confirmed 531 **with zero headroom** — any future change anywhere in `src/**/*.css`
that adds even one new violation breaches the hold-line.

**Initial baseline (605 problems, 605 errors, 0 warnings), per rule:**

| Rule | Count |
|---|---|
| `selector-class-pattern` | 162 |
| `color-function-notation` | 108 |
| `color-function-alias-notation` | 108 |
| `alpha-value-notation` | 106 |
| `no-descending-specificity` | 23 |
| `declaration-block-single-line-max-declarations` | 19 |
| `rule-empty-line-before` | 17 |
| `custom-property-empty-line-before` | 11 |
| `color-hex-length` | 9 |
| `media-feature-range-notation` | 7 |
| `comment-empty-line-before` | 7 |
| `value-keyword-case` | 6 |
| `keyframes-name-pattern` | 6 |
| `no-duplicate-selectors` | 3 |
| `font-family-name-quotes` | 3 |
| `csstools/value-no-unknown-custom-properties` | 2 |
| `property-no-vendor-prefix` | 2 |
| `declaration-block-no-redundant-longhand-properties` | 2 |
| `shorthand-property-no-redundant-values` | 2 |
| `at-rule-empty-line-before` | 1 |
| `declaration-property-value-keyword-no-deprecated` | 1 |

(Note: the plan's own Task-2 narrative predicted `no-descending-specificity` would dominate the baseline — it
does not, at 23 vs. `selector-class-pattern`'s 162. Narrative-only mismatch; no rule or gate was affected.)

**Two standing gate lines, both still true at HEAD:**
1. The total from `npm run lint:css` must never increase past 531.
2. Every file M2 creates or rewrites must be individually clean (`cd client && npx stylelint <file>` → 0
   problems). Verified at T13 for all 11 M2-owned CSS files: `ChatArea.css`, `MessageRow.css`, `Composer.css`,
   `FormattingToolbar.css`, `MentionDropdown.css`, `ConfirmModal.css`, `EmojiPicker.css`, `StickerPicker.css`,
   `StickerManager.css`, `FloatingQuoteButton.css`, `DayDivider.css`.

**Operational notes for M3+:**
- `importFrom` paths in `.stylelintrc.json` are cwd-relative — stylelint must run from `client/`
  (`cd client && npx stylelint ...`); from the repo root the whole run crashes with `ENOENT` (ruling 1 above).
- Stylelint writes `--formatter json` output to **stderr** when there are errors, so a per-rule aggregation
  command needs `2>&1 | node ...`, not `2>/dev/null` — the latter silently drops the output being parsed.
- JS-injected custom properties (`--avatar-color`, `--avatar-bg`, `--avatar-ink`, `--call-stage-height`,
  `--presence-ring`) are invisible to `importFrom`; the 2 existing `csstools/value-no-unknown-custom-properties`
  violations in the baseline are these. New CSS referencing them must use `var(--x, fallback)` or be ruled on
  individually.
- `primitives.css` is held flat at 21 → 21 under the corrected T8 gate (ruling 13 above), not swept to 0 — it is
  an M0 file M2 neither creates nor rewrites, and M6 owns the legacy-file sweep. Its 8 cross-file residual
  violations, captured by T8 as debt for this closeout: 3× `keyframes-name-pattern`
  (`fadeIn`/`scaleIn`/`modalIn`, referenced from `AvatarCropModal`/`ContextMenu`/`CallUI`/`Settings`/
  `ConfirmModal` CSS) and 5× `selector-class-pattern` on bare `.online`/`.primary` (consumed by
  `ChannelSidebar`/`UserList`/`AppPage`/`EditChannelModal`/`EditServerModal`/`CreateChannelModal`/
  `ManageInvitesModal`).

---

## Verification harness

`.superpowers/sdd/2026-08-25-redesign-m2-chat/tools/` holds the CDP smoke harness M2 was verified with (not in
git; preserve for M3). Additions and gotchas from this milestone:

- **`probe-cascade-order.js`, `probe-tie-scan.js`** (T1) — verify the base style layer (tokens/base/primitives)
  precedes component CSS in DOM injection order, and scan for cross-layer specificity ties. Deferred minor:
  `probe-tie-scan.js` treats `:not(...)` as flat weight-1, which is not spec-accurate for CSS specificity — it
  is a supplementary scanner only; add a comment if reused in a later milestone.
- **Async-probe support in `smoke.mjs`** (added during T5). The harness's `--probe` wrapper was originally
  synchronous (`JSON.stringify((${probeSrc}), null, 2)`), so an async-IIFE probe returning a still-pending
  `Promise` stringified to `{}` — a `Promise` object has no enumerable own properties, so the wrapper silently
  reported an empty result instead of failing. Fixed by wrapping in `(async () => { ... await ... })()`. This
  is backward-compatible with every synchronous probe already in the tools dir (awaiting a non-promise value is
  a no-op). Needed because interaction sequences — open modal, press Esc, assert closed, reopen, click overlay,
  assert closed again, reopen, actually delete — can't be expressed as a single synchronous `--click`.
- **`--touch`** (from M1, still load-bearing in M2) — emulates a coarse, hover-incapable pointer via
  `Emulation.setTouchEmulationEnabled` + `setDeviceMetricsOverride {mobile:true}` (not
  `setEmitTouchEventsForMouse` or `setEmulatedMedia`, which do not change the media features). Required for
  every M2 mobile/touch verification (T12, T13's mobile screenshots) and for exercising `@media (hover: none)`.
- **`probe-servermenu.js` only works with `--click .channel-header-menu --after 800`** — undocumented in its
  originating brief; recorded here so a future invocation doesn't waste a run rediscovering it.
- **Vite-HMR disconnected-store pitfall** (T9). Editing `serverStore.ts` makes Vite HMR bake a cache-busting
  query into the app's compiled import, so a bare-path dynamic `import()` inside a probe can silently resolve to
  a **disconnected** store instance and report nonsense with no error. Fix: match the exact `performance`
  resource URL Chrome actually loaded, not a bare module path.
- **T13's new probes** (gitignored, not committed): `probe-t13-empty-channel.js`, `probe-t13-unread-divider.js`,
  `probe-t13-composer-geom.js` (verification), and for the fix wave — `probe-t13-send-switch.js`,
  `probe-t13-stale-switch.js`, `probe-t13-toast.js`, `probe-t13-css-fixes.js`, `probe-t13-sticker-actions.js`,
  `probe-t13-discard-shot.js`, `probe-t13-toast-shot.js`, `probe-t13-restore-race.js` +
  `preload-t13-delay-restore.js`. Every fix-wave probe was written and run against the **pre-fix** commit
  (`de9a5a2`) first and required to fail loudly there before being trusted — see the process note below.
- **Two probes flagged for anyone reusing them:**
  - `tools/probe-chat.js:150` **is not currently stale** — it was repointed from the deleted `.chat-input
    textarea` to `.composer-input` per the T7 `.composer-root` rename (ruling 11), and T13 independently verified
    the file's current content before trusting it. Recorded here only because an earlier ledger entry described
    it as needing a fix; that fix has landed. Confirm the selector again before reuse in M3+, since it silently
    records a string instead of failing when it goes stale — that failure mode, not this specific selector, is
    the real hazard.
  - `tools/probe-t11-flow.js`'s `toastPresent` check queries `.chat-error-toast`, a class the fix wave deleted
    outright (fix 5 unified it onto `.error-toast`). This query is now **permanently false** and must not be
    cited as regression evidence by anyone re-running that probe as-is.
- **Smoke-server residue**, worth knowing before writing the next probe against the same throwaway account: the
  fix wave's probes left real messages and 3 sticker messages on «Redesign Smoke», `#second-smoke` now holds 4
  messages (not the 2 some earlier probes hardcoded), and `last_channel_id` for the smoke account now points at
  `general`. `probe-t13-restore-race.js`'s `rows <= 5` upper bound will need raising if more probes write to
  that channel. `probe-t13-stale-switch.js` was hardened mid-wave to measure per-channel counts rather than
  hardcode them, specifically because of this drift.

---

## Environment notes

- **`npm test` is RED at baseline**, unchanged from M1: 3 tests in
  `src/services/__tests__/api.network-retry.test.ts` were merged without their implementation, plus 2 unhandled
  rejections originating solely there. M2's gate is the identical shape throughout:
  `Test Files 1 failed | 21 passed (22)`, `Tests 3 failed | 138 passed (141)`, `Errors 2 errors`, all three
  `FAIL` lines and both rejection stack traces confined to that one file. Out of scope for M2 (and M1) by
  explicit Global Constraint; re-verified at every task boundary and again at the fix-wave commit.
- **Dev server must run on port 3000 exactly.** Production CORS allowlist; port 3001 fallback makes login fail
  with a CORS error that looks like a bug but isn't. Test account `redesign_smoke@vycord.local` on the
  throwaway server «Redesign Smoke» — this is the production API, so testing there is destructive-safe only
  because that server exists for exactly this purpose.
- **Electron cannot launch** — npm 11's `allowScripts` skipped its postinstall, so `node_modules/electron/dist`
  is 292K instead of ~250MB. Fixable with `npm install-scripts ls` in `client/` if ever needed. M2 touched
  nothing under `electron/`.
- **`npm run check:i18n` prints 4 heuristic warnings for `ErrorBoundary.tsx` and exits 0** — unchanged from M1,
  still M4's strings to fix when it owns that component.
- A **stale dev server invalidates cascade-order and visual-QA evidence.** Both T1 (original verification) and
  T13 (final gate sweep) hit this: Vite HMR does not reorder already-injected `<style>` tags, so a server that
  predates the commit under test must be restarted before any dev-side CSS-order or visual claim is trusted.
  T13 confirmed this by comparing server-start time against `HEAD`'s commit timestamp before proceeding.

---

## Process note: false-pass probes, and what caught them

The fix-wave report states plainly: **"Six M2 probes previously gave false passes because their design never
exercised the path under test."** That count is the fix-wave author's own tally across the whole milestone's
ledger, not something this document independently re-derives; the concrete instances traceable in the ledger and
task reports are:

- **T6's first verification probe** used a 120ms fetch gap and reported `peakEntering: 0` against still-broken
  enter-animation code — the sample was taken *after* the animation window had already closed. The implementer
  self-caught this and committed a corrected probe using a 25ms gap, which fails loudly on an empty target
  channel.
- **`tools/probe-chat.js`'s selector** recorded a string for a deleted DOM node (`.chat-input textarea`, removed
  in T7) instead of failing when the selector stopped matching — a probe going quietly wrong rather than loudly
  wrong.
- **`tools/probe-t11-flow.js`'s `toastPresent` check** queries a class (`.chat-error-toast`) the fix wave later
  deleted; it is now permanently `false` and would read as a clean regression check while actually testing
  nothing.
- **T13's own `probe-t13-stale-switch.js` counterfactual**, on its first run at HEAD, reported "CORRECT
  CHANNEL'S MESSAGES" — but only because `last_channel_id` had drifted to the same channel the probe clicks, so
  there was no race left to lose. The precondition, not the fix, had silently changed. Discarded and re-run with
  the precondition explicitly re-established and asserted (`atProbeStart.header === "general"`).
- T6's jump-to-message / back-to-latest correctness separately rests on **code + server-query reasoning**
  (`GetAround` is target-centered, `server/internal/repository/postgres/message.go:273`), not on probe evidence
  — the probe's `newlyEntering: []` samples happened to hit a genuine no-op case and never exercised the
  replacement path. This is disclosed in the ledger as a reasoned-not-measured claim, not silently assumed.

**What caught the pattern:** the fix wave's practice of writing every probe against the **pre-fix** commit
first and requiring it to fail loudly there, before trusting a post-fix pass. An unfixed tree that quietly
passes is the signature of exactly this failure mode, and it is only observable if the counterfactual is run at
all — the T13 stale-switch instance above is itself an example of the method working: a false pass was caught
*because* a counterfactual was run, not despite it.

**Lesson for M3–M6:** treat "the probe passed" as insufficient on its own. A probe is only evidence once it has
been shown to fail against the broken version of the code it is meant to catch. Several other findings in this
document are explicitly marked reasoned-rather-than-measured for the same reason it matters here to be honest
about the distinction — fix 6a's not-own-sticker branch (single-account smoke server, no second account to
exercise it), the mention-dropdown layout risk closed statically rather than by probe (absolutely-positioned, so
provably not a sixth flex item), and the wide-viewport-plus-touch combination for the unbounded
`(hover: none)` query, never separately tested. None of these are claimed as measured; all are logged as
arguments.
