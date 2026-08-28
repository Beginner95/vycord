# M4 (Modals, Menus, Settings) — closeout & handoff to M5/M6

**Status:** complete. 11 commits `41b93e8..08aa58f` on `redesign` — 10 task commits plus 1 whole-branch fix
wave. Task 11 was a zero-diff verification sweep and produced no commit, by design. The milestone's plan commit
`7096253` is the range's base. Not pushed; `main` untouched (`git log redesign..main` empty, re-verified at
close — plan decision 26).
**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` §5 M4 bullet.
**Plan:** `docs/superpowers/plans/2026-08-25-redesign-m4-modals.md` (Opus grand-reviewed before execution;
Global Constraints and decisions 1–27 binding).
**Inherited:** `docs/superpowers/plans/2026-08-25-redesign-m3-closeout.md` (21 rulings, harness corrections),
`docs/superpowers/plans/2026-08-25-redesign-m2-closeout.md` (17 rulings, stylelint history).
**Excluded scope, honoured:** `docs/superpowers/backlog/post-redesign-backlog.md` §1 — nothing in it was fixed.

Every task passed a task-scoped review. Tasks 1 and 10 passed with **no Critical or Important findings**;
Tasks 2, 3, 4, 5, 7, 8 and 9 each needed one fix round, and Tasks 2 and 9 needed two. The whole-branch review
(`7096253..80195fb`, opus, 10 commits) returned **"sound — ship after these fixes"** with **no Critical**, 2
Important and 8 Minor. Its four must-fix items plus one riding change landed in the fix wave `08aa58f`, and a
scoped re-review (`80195fb..08aa58f`) confirmed **all five addressed, no new breakage**.

This file exists because the SDD workspace (`.superpowers/sdd/2026-08-25-redesign-m4-modals/`) is gitignored and
dies with the session — the ledger's rulings, triage, deviations and harness notes are transcribed here before
they are lost, exactly as the M1, M2 and M3 closeouts did.

**Constraint compliance, independently confirmed at close:**
`git diff --stat 7096253..08aa58f -- server/ client/src/services/ client/src/types/index.ts client/e2e/` is
**empty**. No API or WS contract change. **`tokens.css` changed by exactly +4 / −0** — zero deletions, so the
LEGACY ALIASES block is provably untouched. Range totals: **50 files, +2174 / −1730**. All of M4's Global
Constraints held.

---

## Headline results

| Gate | M4 start | M4 close |
|---|---|---|
| `npm run lint:css` total | **271** | **196** (ceiling 531, never approached) |
| `npm run check:i18n` | **4 warnings** (since M1) | **ZERO warnings**, exit 0 |
| `window.confirm` in `client/src` | 4 sites | **zero rows** |
| bare `.primary` emitters | 6 | **zero rows** |
| `primitives.css` | 21 problems (held flat since M2) | **0, no exceptions** |
| M4-owned CSS files at 0 | — | **13 of 13** |
| Carried legacy blocks | — | **all three retired** |

The **check:i18n gate going to zero is the milestone's headline win.** It had stood at 4 `ErrorBoundary.tsx`
warnings since M1, through M2 and M3.

---

## What M4 shipped, against spec §5's M4 bullet

Spec §5: *"M4 — Modals, menus, settings (board `1d` + unspecced). Find-server modal (name search + invite code
merged into one field); settings modal (186px nav, new toggle/select/slider/level-meter, "Выйти" pinned bottom
in danger) covering profile/audio-NC/video/appearance; server & channel context menus; destructive confirmation
reused app-wide; then: manage invites, edit server/channel, create channel/server, sticker manager, avatar crop,
update banner, error boundary (strings moved into i18n)."*

Clause by clause. **Nothing is missing.**

| Clause | Status | Notes |
|---|---|---|
| Find-server modal, name + invite code **merged into one field** | **Landed** | T5. One `.input`; each debounced query fires `searchServers` **and** `previewInvite` in parallel via `Promise.allSettled`, preview rejection swallowed. 452px / r16 / 44px input — board-exact. |
| Settings modal 648px, nav 186px | **Landed** | T6. `--canvas-3` nav fill with `--line` right border. |
| — toggle / select / slider / level-meter primitives | **Landed** | T2 built them, T7 adopted them. 44×26 r13 toggle with 20px knob and `translateX(18px)` · 36px r9 select with a 14px JSX chevron · 150×6 r3 slider with a 16px knob · 6px r3 meter on `--online`. All board-exact. |
| — «Выйти» pinned bottom in danger | **Landed** | T6, `margin-top: auto; color: var(--danger)`, confirming through `ConfirmModal`. |
| — covering profile / audio-NC / video / appearance | **Landed** | T7; all four panes converted. |
| Server & channel context menus | **Landed** | T4. **Destructive separation is structural** — `ContextMenu` renders label → non-danger → separator → danger, so callers cannot bypass board 1d's "destructive always last and separated". 236px / r14 / caps label / separator inset 8px. |
| Destructive confirmation reused app-wide | **Landed, one qualification** | T3 hardened `ConfirmModal`; T3/T4/T9 swapped every call site. `rg 'window.confirm' src/` → **zero**. **Qualification:** invite revoke (`ManageInvitesModal`) still deletes on one click of a 30×30 icon, against the board's "Never delete without this step" — **byte-identical to base, inherited, not introduced**. |
| Manage invites | **Landed** | T8. `ManageInvitesModal.css` 7 → 0; three hand-inlined SVGs → lucide; expiry line via the existing `inviteExpiry` util. |
| Edit server | **Landed** | T8. 3 → 0; `.modal-header` pattern + `.btn` roles. |
| Edit channel · create channel · create server | **Landed, adapted** | T8. Role classes only — the board does not spec these separately; they inherit `.modal`/`.modal-actions` and keep their no-close-button shape, since board 1d puts close chips on the two big modals, not the small forms. |
| Sticker manager | **Landed** | T9. `StickerManager.css` 0; the **last `window.confirm` in the codebase** died here. |
| Avatar crop | **Landed** | T9. `AvatarCropModal.css` 8 → 0; zoom on `.slider-input`. See fix-wave item 1. |
| Update banner | **Landed** | T10. 3 → 0; BEM rename; accent-soft recipe. Renderer **measured** (see below). |
| Error boundary strings into i18n | **Landed** | T10. New `crash` section; **`check:i18n` 4 → 0**. |

**Two board-1d sub-clauses are undeliverable inside M4's scope walls, ruled at planning time and confirmed at
close:** the outline «Запрос» variant for closed servers (no join-request API exists; search filters
`is_private = false` at `server/internal/repository/postgres/server.go:298`) and the result-row meta
"4 участника · 2 канала" (`Server` in the scope-walled `types/index.ts` carries no counts). Every result row
gets the primary «Войти»; only the invite-preview row shows «участников: N». **The whole-branch review noted
T11's board table omitted these two rows — the code is right, the accounting was short. Corrected here.**

**Structural wins beyond the clause list:**
- **`primitives.css` reached 0 and every carried block is retired.** The layer had been *held flat* at 21
  problems since M2 by explicit ruling. M4 owned it, rewrote it, and closed it out.
- **The app has exactly one destructive-confirmation path.** No `window.confirm`, no catch-path `alert()`.
- **`check:i18n` is a real zero for the first time in the redesign.**

---

## Decisions that bind later work

Presented in the order each was bound. Every entry states what it costs if wrong. This is the complete list —
**24 rulings**, transcribed in full.

### Made before execution (pre-flight scan)

1. **(PF-1) `UserList.css:67` joins T2's rename ripple.** Plan decision 7's consumer list for
   `.user-avatar-wrap.online` named `primitives.css` and two TSX emitters but **missed a second CSS consumer** —
   `.user-item .user-avatar-wrap.online::after`, the member-list presence-dot size override. Renaming the
   emitter without it would have orphaned the rule and silently shrunk the dots. **Proven load-bearing:** T2's
   probe measures the dot at 11px, reachable only because the rule was renamed. **Cost if wrong:** one extra
   one-line file in T2's commit.
2. **(PF-2) `EmojiPicker.css:18` and `StickerPicker.css:17` join T2's keyframe ripple.** Decision 6's list
   omitted two live `animation: fadeIn` references. **A dangling `animation-name` is silent** — no error, no
   lint problem, just no animation — so this would have deleted two pickers' 120ms entrance with nothing to
   catch it. **Cost if wrong:** two extra one-line files.
3. **(PF-3) T11's two broad greps are scoped to M4-owned files at read time.** Hits outside get an owner
   recorded and are not fixed; substring-only matches are dismissed by token comparison. **Cost if wrong:** one
   triage pass.
4. **(PF-4) `.user-item.offline` is out of scope, recorded not fixed.** → M6's legacy sweep.
5. **(PF-5) `@keyframes slideInRight` is T10's, and must be MOVED and RENAMED.** Not in the plan. Its only
   consumer was the call-notif banner T10 extracts. Leaving it stranded a dead keyframe; moving it un-renamed
   would have made `CallNotifBanner.css` unable to reach 0. **Cost if wrong:** the banner loses a 200ms
   entrance, or a file misses its gate.
6. **(PF-6) Tasks editing `primitives.css` or a carried block restart the dev server before probing.** Vite HMR
   *re-injects a changed file*, which can put the base layer **after** component CSS and invert the source-order
   tie-breaks two M4 interims depend on. The Global Constraint covered only "a server predating HEAD".
   **Cost if wrong:** a tie-break probe measures the wrong cascade.
7. **(PF-7, verification not change) `--scrim` is `:root`-only with no dark override**, byte-equal to
   `.modal-overlay`'s old `rgba(16, 19, 34, 0.5)` — so T2's "overlay identical" claim holds in **both** themes.
8. **(PF-8, verification not change) `check-i18n.mjs` strips `//` and single-line `/* */`**, so the plan's
   mandated Russian code comments cannot trip it. **Caveat that later bit twice:** a **multi-line** `/* */`
   block is **not** stripped.

### Made during execution

9. **(T2-a) The form-primitive block relocation is ratified.** The brief said "append at the bottom"; appending
   put `.toggle-switch input` (0,1,1) after `.modal .form-group input` (0,2,1) and fired
   `no-descending-specificity`. The reviewer **reproduced it** — the brief's placement yields 5 problems, not 4.
   The published contract is unchanged and the relocation has **zero rendering consequence**. **Cost if wrong:**
   a cluster sits earlier in the file than the plan's prose describes.
10. **(T2-b) The `no-descending-specificity` claim was tested and SURVIVED — the first time on this branch.**
    M2 and M3 each disproved a copied instance. Both implementer and reviewer ran the counterfactual with a
    positive control: order A → 0 problems, order B → fires. **M6 should note the rule is context-dependent,
    not simply false.**
11. **(T2-c) The brief's second ripple grep is defective and was amended.** `(?<![a-zA-Z-])(online|danger)…`
    cannot pass, because the brief's own prescribed CSS contains the comment prose "online fill" and "separated
    danger last". The gate meant *class selectors*; `\.(online|danger)(?![a-zA-Z-])` is the correct form.
12. **(T2-d) The `.toggle-switch` collision is plan-anticipated, not a new defect** (plan line 1355), and its
    44×24 interim was converted from a T6 assumption into a **T2 measurement**.
13. **(T3-a) `useModalFocus`'s mount-order assumption is documented, not re-engineered.** React runs
    `useEffect` **child-before-parent**, so a parent and nested child activating in the **same commit** would
    invert the stack and let one Escape close both. Ruled: keep the plan-mandated logic (unreachable by every M4
    adopter), add a comment — because the plan defers app-wide adoption to **M6**, where an adopter could
    produce it. **Cost if wrong:** an M6 adopter gets one-Escape-closes-both, now documented at the push site.
14. **(T3-b) `ConfirmModal`'s overlay gets `stopPropagation`, fixed in T3 rather than in T6.** Once nested
    inside Settings' overlay, one backdrop click would have cancelled the confirm *and* closed Settings.
    Measured with an ancestor listener plus a fail-first counterfactual.
15. **(T4-a) The `ServerMenu` stale-state defect is fixed despite being brief-prescribed.** On a failed delete
    the component stayed mounted with `menuDismissed: true` while the anchor was still set, so for up to 5s the
    menu button was **dead** and the click silently discarded — or, on the rail, the anchor was silently
    **retargeted to a different server**. **Cost if wrong:** a new instance per anchor discards sub-modal state,
    which is correct since a new anchor means a new target.
16. **(T4-b) Two findings graded Minor were fixed because this commit introduced them** — a stuck
    channel-delete confirm and a double-submit window on both deletes. The double-submit guard is **local to the
    handlers**; adding a `busy` prop to `ConfirmModal` would have changed a contract T3 froze and T6/T9 consume.
17. **(T5-a) The footer-handoff focus defect is fixed in `useModalFocus`, inside T5's commit.** The passive-phase
    restore overrode the create-server modal's layout-phase `autoFocus`, landing focus on the **message
    composer behind the overlay** — a `<textarea>` that **sends on Enter**. So typing the new server's name and
    pressing Enter **posted a stray message to the live channel** while no server was created. **The trap in the
    obvious fix:** the naive predicate skips *every* restore, because the container is detached by cleanup time.
    The predicate must treat `body`/`null` as "focus is nowhere".
18. **(T5-b) The empty-state gap is fixed with explicit source ordering, and measured.** The reflex fix was
    (0,2,0) — identical specificity, placed *before* the legacy rule, so it would have silently done nothing.
    Forcing the card via a `serverStore` write **closed a gap M2 also had to leave open on this same card**.
19. **(T6-a) The nested `ConfirmModal` renders as a SIBLING of `.settings-modal` inside the shared overlay.**
    Ratified on three independently-verified grounds — most importantly that **nested, the backdrop assertion
    would pass vacuously**, since `.settings-modal`'s own `stopPropagation` would absorb the click whether or
    not `ConfirmModal` stopped it. The plan's feared z-index conflict **did not materialise**.
20. **(T7-a) The re-entrant mic-test defect is fixed despite the brief mandating the shape.** Without a pending
    guard, a second click while `getUserMedia` was in flight opened a **second capture**; if React coalesced
    both resolutions, the first stream was **never stopped — a hot microphone with no UI affordance to release
    it.** Fixed with a ref guard orthogonal to the mandated cleanup. **The coalesced branch is now unreachable
    by construction**, not merely untested.
21. **(T8-a) The header-margin regression is fixed in T8.** `.modal h2` (0,1,1) beats `.modal-title` (0,1,0), so
    `margin-bottom: 20px` applied to the new header pattern and rendered title-to-content at ~36px instead of
    16px. **Deleting `.modal h2`'s margin is NOT safe** — three modals still emit a bare `<h2>` and depend on it.
22. **(T9-a) The pre-existing sticker-validation i18n bug is fixed in T9.** `stickerUpload.ts` returns bare
    codes while both strings live under `errors.*`, and the **`as TKey` cast** is what defeated `tsc` — so
    **both** validation paths rendered a raw key to the user. Fixed at the call site with a `hasKey()` guard
    mirroring `apiErrorText`, so a future un-keyed code degrades to `errors.unknown` instead of showing an
    identifier.
23. **(T10-a) The brief's "fixed top-center position" for the call-notif banner is WRONG.** The old rules are
    `top: 16px; right: 16px` and the keyframe translates on `+X`. **The brief is the defect; the code is right.**
24. **(FW-1) The `AvatarCropModal` close chip is guarded during save.** It was the only one of three abort paths
    not inert while saving, so clicking X mid-upload unmounted the modal while the upload **still applied the
    new avatar** — and on failure the rejection landed on an unmounted component, showing the user **nothing**.
    **New in M4:** the chip did not exist at the base. T9 added it with `disabled`, then correctly removed that
    attribute (no `:disabled` rule, so it looked live while inert) — but the fix **restored clickability instead
    of inertness**, and the scoped re-review saw only a one-attribute diff, not the two sibling affordances.

---

## Awaiting the human

Three judgement calls the process deliberately left unsigned.

### 1. A stalled avatar upload is now a complete trap

Post-fix-wave, all three `AvatarCropModal` exits (overlay, close chip, Cancel) are inert while `saving` is true;
the component does **not** adopt `useModalFocus`, so there is **no Escape handler either**; and `services/api.ts`
has **no `AbortController`, timeout or `signal` anywhere**. If `uploadAvatar` hangs, the user has zero recourse
short of a reload.

**This is not a regression** — two of the three paths were already unconditionally inert before M4, and the fix
closed the third to stop a real bug (unmount-while-uploading still applying the avatar). But it is a real,
permanent trap, and the correct fix is a request timeout in `services/`, which M4's scope walls forbid.
**Owner: a services-layer decision, then whichever milestone gets the scope grant.**

### 2. The accessible-name gap is broader than any single task saw

On the Settings panes: **4 toggles, 2 range sliders and 5 selects carry no accessible name**, and the level
meter has no `role="progressbar"`. A screen-reader user hears "checkbox, unchecked" ×4, "slider, 50" with no
name, and "combo box" ×2 with no name on one pane. **Not a regression** — the pre-M4 markup was equally
unassociated, and the pattern is the plan-specified one used by all four panes.

M4 fixed the narrow half: `Settings` now carries `role="dialog"`, `aria-modal` and `aria-label`, closing an
asymmetry M4 itself created (the other two `useModalFocus` adopters had them from the start). The remaining gap
lives in the **primitives recipes**, which every future consumer inherits. **Owner: M6**, which reopens that
layer — one recipe-level change rather than eleven call-site changes.

### 3. Invite revoke still deletes without confirmation

`ManageInvitesModal` revokes on one click of a 30×30 icon, against board 1d's "Never delete without this step".
**Byte-identical to base — inherited, not introduced by M4** — and the spec clause M4 owns is "destructive
confirmation reused app-wide", which the milestone satisfied for every `window.confirm` site. Flagging it once
so the gap is a decision rather than an oversight. **Owner: board, then M6.**

---

## Deferred findings, triaged by owner

Items fixed in the whole-branch fix wave (`08aa58f`) are marked **RESOLVED**, so this stays a complete record.

### Resolved in the fix wave

- **The `AvatarCropModal` close chip during save** — ruling 24 above. **RESOLVED**, measured with a
  never-resolving `uploadAvatar` stub that failed loudly pre-fix.
- **`Settings` had no dialog semantics** while the other two `useModalFocus` adopters did. **RESOLVED**
  (`role="dialog"`, `aria-modal="true"`, `aria-label`), measured.
- **`.modal-header h2` won only by source order.** (0,1,1), identical to `.modal h2` — a reorder or merge would
  have silently restored the 16px regression **with no lint signal**. **RESOLVED** as `.modal .modal-header h2`
  (0,2,1), unconditional. All five `.modal-header` consumers verified to sit inside a `modal` element, so the
  added step never costs a match.
- **`Settings.tsx`'s multi-line Russian JSX comment.** The headline gate was passing **by content, not by
  shape** — T9 hardened the identical hazard and T6's instance was left. **RESOLVED**.
- **`CallNotifBanner`'s dismiss icon was 14px** where the other six `.modal-close-btn` consumers use 16.
  **RESOLVED**. Recorded **reasoned-not-measured**, with the reason verified: the probe asserts the chip's box,
  `aria-label` and `svg.lucide` presence but **never reads the icon's size**.

### M6 (polish, dark parity, responsive, alias deletion)

- **Accessible names on the `.toggle-switch` / `.select-wrap` / `.slider-input` recipes** — "Awaiting the human"
  item 2. Fix at the recipe.
- **`primitives.css`'s dead `.channel-type-options` block** (58 lines), orphaned by commit `4674032` **before M4
  began**. A genuine gap in T2's orphan claim: T2 verified no *new* orphans but did not sweep pre-existing ones.
  **Consequence beyond dead weight:** the keyframe-consumer comment lists `modal-in`'s live consumers as
  "`.modal` and the radio `::after`" — and that `::after` is **inside the dead block**. Correct the comment in
  the same change.
- **`--danger` has no dark value** and M4 introduced the tree's only two uses of it as a **foreground**
  (`.context-menu-item.is-danger`, `.settings-nav-logout`). Its siblings `--danger-soft`/`--danger-text` and all
  three `--online-*` do have dark values. In dark, `.settings-nav-logout` renders `#E7444A` at rest and jumps to
  `#FCA5A5` on hover — a colour shift that does not occur in light. Derived from `tokens.css`, not measured in a
  browser; every M4 probe asserts geometry, so "both themes PASS" would not have caught it.
- **`.setting-warning`'s amber-on-near-white is ~2.01:1** (AA needs 4.5:1). **Inherited** — at base it was
  ~2.09:1 — but M4 lost its dark tint: `--yellow-50` had a dark override, `--canvas-2` does not, and `--warning`
  has no dark value. This surface carries the NC-unsupported and mic-permission messages.
- **`.update-banner-dismiss` loses its own override on hover** — (0,1,0) against `.btn-ghost:hover`'s (0,2,0),
  which wins regardless of source order, so the button reverts to a canvas-2 pill in `--ink` — the exact state
  its comment says the override prevents.
- **`AppPage.tsx:603`'s `▶`/`◀` glyph-as-icon** — explicitly excluded by M1's own plan text; zero rows in the
  M4 range diff.
- **`.invites-code`'s three dead `overflow`/`text-overflow`/`white-space` declarations** — the wrapper lost
  `flex: 1; min-width: 0`, so the item cannot shrink below its content and the ellipsis can never fire.
- **`useModalFocus`'s `hasAttribute('disabled')`** vs the plan's `el.disabled` — equivalent for the elements in
  play.
- **Alias audit input:** **no `--danger-color` token exists anywhere in the tree.** `LinkDialog.css`'s two
  references were rendering their **fallback hex**, never a token. M4's rewrites also took `ErrorBoundary.css`
  and `UpdateBanner.css` fully off the legacy aliases — measured, so M6's sweep loses two files.
- **A grouped disclosed icon-size deviation.** Global Constraint §6 names a 16–21px band and M3's precedent text
  covers only *smaller* deviations, but the branch ships an **unrecorded ≥22px cohort**: new in M4 —
  `ErrorBoundary.tsx` `AlertTriangle size={28}`, `StickerManager.tsx` `ImagePlus size={28}` (both
  brief-mandated); pre-existing — `CallUI.tsx` `Phone size={28}`, `ChatArea.tsx` `Hash size={22}`,
  `MessageSearch` `SearchX size={22}`. Recorded as **adapted** so M6 inherits a decision, not a breach.
- **Correct a grep prescription before M6 inherits it:** `rg -nw 'search-empty'` **still matches**
  `message-search-empty`, because `-` is a non-word character and therefore a word boundary. The working form is
  `(?<![a-zA-Z0-9_-])search-empty(?![a-zA-Z0-9_-])`.

### Post-redesign backlog

- **A stalled avatar upload is a complete trap** — "Awaiting the human" item 1. Needs a `services/` timeout.
- **`ManageInvitesModal`'s unconditional `setInvites(list)` clobber race.** Verified real and verified
  **pre-existing** (byte-identical at base). Reachable — the create button renders during `loading` — and
  user-visible: a just-created invite vanishes. One-line fix, but landing a state-management change inside a
  CSS-conversion commit was the worse call. **The reasoning is worth keeping: the excluded-scope list is a floor
  on what must not be touched, not a licence for everything outside it.**
- **`ServerMenu` reads permissions via `useServerStore.getState()`** (non-reactive), so a permission change
  while the menu is open does not re-render it. Inherited drift — the old `ServerList` copy behaved identically.
- **`ContextMenu`'s outside-mousedown has no trigger exclusion** — pre-existing; T4's seq-key made it strictly
  better.
- **`apiService.previewInvite` does not `encodeURIComponent` its argument**, so a query containing `/` or `#`
  builds a malformed path. Every outcome is a rejection swallowed by `allSettled`. Scope-walled.
- **`useModalFocus`'s `splice(indexOf(token), 1)`** would remove the **last** element if `indexOf` returned −1.
  **Verified unreachable** — the token is a fresh `Symbol` pushed and popped by the same effect, and StrictMode's
  double-invoke stays balanced.
- **Invite revoke without confirmation** — "Awaiting the human" item 3.

### Harness debt (gitignored, ships nothing)

- `probe-chat.js` — two descriptive fields read with optional chaining and no `fail()`; continuation-row
  assertions no-op silently when the list is empty.
- `probe-t5fix-handoff-focus.js:35` — `composerSendsOnEnter = … || true`, **a field that cannot fail** printed
  inside measured JSON. Fix or delete before it is ever cited.
- `tools/probe-confirm-modal.js` — stale M2 residue, dead selectors, **zero `throw`**. Delete or rename so it is
  never mistaken for a gate.
- `probe-primitives-toggle.js`'s three recorded minors (`@media` blindness, conflated positive control, HMR
  double-inject) are **moot** — the collision it measured was retired by T7. Close them.

### No action

M2's `.chat-back-btn` / `msg-mention-role` items and M3's stage deferrals are unchanged by M4 and remain with
their existing owners.

---

## Stylelint baseline history

**605 → 531 (M2 close) → 271 (M3 close) → 196 (M4 close).**

M4 took the total from **271 to 196 — a 28% reduction** — and, like M3, did it by deleting legacy rules and
sweeping the files it owned, never by mass-fixing untouched files. The hold-line was "never above 531"; it was
never approached.

**Per-task progression:** 271 (T1) → 253 (T2) → 253 (T3) → 250 (T4) → 249 (T5) → 242 (T6) → 237 (T7) →
213 (T8) → 205 (T9) → 196 (T10) → 196 (T11, fix wave).

**Final per-file state, re-measured at close.** The total decomposes exactly across 8 files:

| File | Problems | Note |
|---|---|---|
| `tokens.css` | **118** | unchanged; all 4 added lines are clean modern notation |
| `ChannelSidebar.css` | **23** | untouched legacy |
| `UserList.css` | **16** | fell 17 → 16 on the `.online` → `.is-online` rename (ruling PF-1) |
| `ServerList.css` | **15** | fell 16 → 15; deletions only |
| `Auth.css` | **10** | untouched legacy |
| `MessageSearch.css` | **8** | untouched legacy (M5 restyles it) |
| `AppPage.css` | **4** | fell 7 → 4; deletions only — proved line by line, not by arithmetic |
| `TitleBar.css` | **2** | untouched legacy |

**All 13 M4-owned CSS files are individually 0:** `primitives.css`, `FindServerModal.css`, `Settings.css`,
`ProfileSettings.css`, `EditServerModal.css`, `ManageInvitesModal.css`, `LinkDialog.css`, `StickerManager.css`,
`AvatarCropModal.css`, `UpdateBanner.css`, `ErrorBoundary.css`, `CallNotifBanner.css`, `ChatArea.css`.
**No non-M4 file gained.**

**Raw-value gate:** `rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\('` over all 13 returns **zero rows**. The only sanctioned
permanent survivor is `primitives.css`'s checkbox check-mark data-URI (`stroke='white'`), which does not match
the grep anyway. **No sanctioned interim exception survives.**

### The carried-block lifecycle — all three retired

| Block | Carried | Enumerated violations | Retired |
|---|---|---|---|
| `primitives.css` `.modal-actions button` recipe | **T2 → T8** | 3× `selector-class-pattern` on the bare `.primary`, 1× `color-hex-length` on a raw `#FFFFFF` | **T8.** The container rule `.modal-actions` stayed live and unmarked; only the four descendant-button rules went, and the raw `#FFFFFF` — the file's only raw value — died with them. |
| `Settings.css` pane classes | **T6 → T7** | 3, all `rgba()`-notation on `.toggle-slider::before`'s shadow | **T7.** 136 lines, all 16 selectors, resolved by marker rather than line number. |
| `ServerList.css` `.search-empty` | **T5 → T8** | **0** — already multi-segment kebab | **T8.** The carry was about a dead *name*, not the count, which is why `ServerList.css` stayed at 15 across the deletion. |

**Operational notes, re-confirmed:**
- **`importFrom` is cwd-relative — stylelint must run from `client/`.** A repo-root run crashes with `ENOENT`,
  which looks like output rather than a crash.
- `--formatter json` writes to **stderr**; pipe with `2>&1`.
- **JS-injected custom properties are invisible to `importFrom`.** M4 added `--slider-fill` and `--meter-level`
  to that family (joining `--avatar-*`, `--speak-level`, `--call-stage-height`, `--presence-ring`). Every CSS
  reference carries its fallback.
- **`stylelint --fix` was never run on a file carrying a verbatim legacy block.** Proof it was not: the
  auto-fixable `color-hex-length` on the carried `#FFFFFF` survived until the block was deleted.

---

## Verification harness

`.superpowers/sdd/2026-08-25-redesign-m4-modals/tools/` holds the CDP smoke harness (not in git; **preserve for
M5** — it is the only copy, carried forward with `cp -R` each milestone). It is M3's tools dir plus M4's
additions.

### New mechanics discovered in M4

- **`getComputedStyle(el, '::-webkit-slider-runnable-track')` and `'::-webkit-slider-thumb'` return the HOST
  element's box, not the pseudo's.** Measured: the thumb reported 150px wide and the track 16px tall — the
  host's own dimensions. The slider gradient is therefore **not measurable** this way; the substitute is a live
  CSSOM assertion on the parsed rule plus the injected custom property. **By contrast `::before` is an AUTHOR
  pseudo and resolves normally** — which is why the toggle knob *was* measurable. That asymmetry is the reusable
  fact.
- **`--focus-emulation` (new, opt-in).** Headless Chrome reports `document.hasFocus() === false`, so `:focus`
  never matches and a focus-ring `box-shadow` reads `none` even when `activeElement` is correct.
  `Emulation.setFocusEmulationEnabled` fixes it. **Caution: it also makes `document.hasFocus()` permanently
  true**, so any probe asserting blur/background/idle behaviour would false-pass under it. **Keep it opt-in;
  never make it a default.**
- **`new Event('change')` does not bubble, and React 18 delegates `change` at the root** — file-injection probes
  need `{ bubbles: true }`.
- **A `--push-ws` string cannot satisfy a guard that compares against live state.** The call-notif handler
  guards on `p.server_id === currentServer?.id`, so the probe must read the id from the store and call
  `__pushWS` itself. That **satisfies** the guard rather than bypassing it; asserting `delivered !== 0` closes
  the "no socket" false-pass.
- **HMR can invert the base-layer cascade** by re-injecting a changed file after component CSS (ruling PF-6).

### Probes flagged for anyone reusing them

- **`probe-server-menu.js` was silently dead from T8 onward** — it selected `.manage-invites-modal`, a class T8
  deleted, and its failure message blamed a **nonexistent product defect**, so a reader would have mis-attributed
  it to shipped code. Phases C and D never ran. Repaired in T11. **No gate was open** — `probe-modal-sweep.js`
  phase B covered the same flow throughout.
- **`probe-chat.js` was structurally incapable of failing** until T1 repaired it (no `throw` in 182 lines). It
  is now a real gate, proven by four throwing counterfactuals.
- **That is two nominal gates in one milestone that were not gates.** Before citing any probe as evidence, check
  it can fail.
- `probe-callstate.js` remains inert and **banned as evidence**.

### Bidirectional class scan (the primary orphan gate)

**157 CSS classes → 0 real orphans; 366 TSX class tokens → 0 missing rules.** The whole-branch review ran three
further sweeps no task had: **primitive shadowing** (31 primitive names × all component CSS → **0**
redefinitions), **deleted-selector × surviving-emitter** (69 deleted class selectors → **0** still emitted), and
**dark-override coverage** (26 theme-relevant tokens → 4 without dark values, 2 intentional, 2 now M6 findings).
**Match class tokens, not substrings** — that trap fired three times across M3 and M4.

### Smoke-server residue, verified against the REST API rather than the DOM

**Final state:** 1 server intact · exactly **2 pre-existing invites** (all six T8 invites and both T11/fix-wave
invites confirmed **revoked**) · **1 sticker** (`t8seed68113`, dated 2026-08-26 — **M3-era, not M4's**) ·
3 pre-M4 channels · **18 probe messages** in `#general`.

**M4 created no servers, channels or stickers, and left no live invites.**

Two accounting corrections found at close: the residue was **under-recorded during execution** — 10 of those 18
messages came from `probe-chat.js` cross-surface runs that no task reported, because each task recorded only
residue it *intended* to create. **Lesson: residue accounting must cover every probe an invocation runs, not
only the probe the task is about.** And querying the REST API rather than inferring from the DOM is what
prevented a false "smoke server destroyed" conclusion in T9.

---

## Environment notes

- **`npm test` is RED at baseline**, unchanged from M1–M3: 3 tests in
  `src/services/__tests__/api.network-retry.test.ts` merged without their implementation, plus 2 unhandled
  rejections from the same file. M4's gate shape throughout: `Test Files 1 failed | 22 passed (23)` ·
  `Tests 3 failed | 149 passed (152)` · `Errors 2 errors`. **M4 added no vitest surface** (plan decision 23 —
  the env is `node`, jsdom is not installed, and DOM behaviour is fail-first CDP-probe-verified instead).
  **A test paste that says "same file" without the `FAIL` lines naming it is not evidence** — enforced at every
  task boundary.
- **`npx tsc --noEmit` is clean** and is the **real** ru/en parity gate. `client/tsconfig.json` sets
  `noUnusedLocals`, so unused-import removal is **compiler-proven**.
- **`npm run check:i18n` now prints ZERO warnings.** How it matches, for anyone extending it: it strips `//` and
  **single-line** `/* */` per line, then flags JSX text nodes, `placeholder|title|aria-label|alt="literal"` in
  `.tsx` only, and `alert('literal')`/`confirm('literal')` anywhere. **A multi-line `/* */` block is a
  structural blind spot** — M4 hit it twice and hardened both.
- **17 i18n keys were deleted across M4** (16 in T10, 1 in T9), ru+en together, each gated on an `rg` proving
  zero consumers. **Kept with verified consumers:** `server.joinByCode.memberCount` and `server.explore` (the
  rail tile's `title`). Plan decision 27's candidate list was **accurate** — a T10 report claim that
  `chat.deleteStickerConfirm` "never existed" was wrong; it existed at the M4 base and T9 swept it.
- **New i18n:** the `crash` section (9 keys), `server.findServer.*` (9), `settings.micTest*` (6),
  `common.logoutTitle`/`Body`, `chat.haveCode`, `chat.deleteSticker{Title,Body}`,
  `{server,channel}.delete{Title,Body}`, plus three pane-section labels. One **value change**:
  `server.editMenu` `'Редактировать'` → `'Настройки сервера'` (en `'Edit'` → `'Server settings'`), board-ruled.
- **Dev server must run on port 3000 exactly.** Production CORS allowlist. **Two stale servers were caught alive
  during M4** and killed before measurement — the rule works and is still needed.
- **Electron cannot launch** (`node_modules/electron/dist` is 292K; npm 11 skipped the postinstall; fixable with
  `npm install-scripts ls`).

---

## Reasoned-not-measured — the milestone's honest gaps

**Three plan decisions were SUPERSEDED by measurement**, which is unusual enough to state first:

- **Decision 17 said the crash render "cannot be exercised in this environment". It was measured.** T10 found a
  real render-phase throw: `AppPage.tsx` sets `voiceParticipants` from a WS payload with **no shape
  validation**, and `ChannelSidebar` calls `.map` on it, so a string value throws during render into the real
  `Sentry.ErrorBoundary`. The probe compares the card's text against **live `t('crash.*')`**, failing if `t()`
  echoes the key — which proves dictionary provenance rather than merely that something failed.
- **Decision 19's UpdateBanner is partly superseded: the RENDERER was measured**, via a preload stub that drives
  the **real** `window.electronAPI?.update` guard (asserted by checking the callbacks were *registered*), with
  the top offset read from the **live** `.title-bar` height.
- **The M2-era «У меня есть код» empty-state branch was measured** in T5 by forcing `serverStore` to
  `servers: []`, closing a gap M2 had to leave open on the same card.

**A plan premise was measured FALSE and is corrected here.** Grand-review finding I4 and the M3 closeout both
state `--fake-media`'s tone peaks at ~0.0065–0.0115, rounding to 1% every sample. **Two independent
measurements disagree:** the fill peaked at 31.4–64.3px of 150px (34–49%), and a from-scratch run on a bare page
measured `maxFreqLevel: 0.6796` (~68%) with time-domain peaks at **full scale 1.0**. **The mechanism:** Chrome's
fake source is a **full-scale periodic beep every ~450ms with a fast decay**, and `0.0065–0.0115` is the **decay
tail between beeps**; compounding that, the plan measured a **time-domain amplitude** while `useMicLevel` reads
a **frequency-domain byte average / 128**. **No future brief may carry the 1%-rounding sentence forward, and
M3's speaking-ring evidence and backlog §3d both rest on it and need re-checking.**

**What remains genuinely unmeasured:**

- **Real Electron behaviour** — the drag region and the real updater bridge. Correctly distinguished from the
  renderer, which was measured.
- **Icon identity.** Every probe asserts "*a* lucide of size N at stroke 1.8" — never *which* icon. Swapping
  `AlertTriangle` for `Bell` at the same size would pass all 50 crash-card assertions. Icon identity is closed
  by the **static diff**, not by probe.
- **Downstream probe assertions are post-task-only.** Every probe terminates at its **first** discriminator
  pre-task, so assertions after that point were never positive-controlled. §8's fail-first requirement is
  satisfied — all probes fail loudly pre-task — but the coverage is narrower than a naive reading suggests.
- **The successful-delete branch was never driven at either `ServerMenu` call site** — correctly, since this is
  the production API and `onDeleted` differs per parent.
- **Colour findings are derived from `tokens.css`, not from a browser** — the `--danger` dark gap and the
  `--warning` contrast ratio. Every M4 probe asserts geometry, so "both themes PASS" could not have caught them.
- **Screenshots are one end-of-run frame per invocation**, so most images show the resting app rather than the
  asserted state; hashing proved five nominally-distinct frames byte-identical. **Every board comparison rests
  on computed-style measurements, not pictures** — so no claim weakens, but the evidence *label* was wrong until
  corrected.
- **T7's `probe-settings-shell.js` baseline gap is unclosable** — the pre-T7 copy was gitignored and overwritten
  in place, so no diff can prove that updating its two by-design expectations did not weaken another assertion.
  Circumstantial evidence is strong (identical key set and order, unchanged thresholds, 61 `fail(` sites, zero
  commented-out assertions) but it is not proof.
- **T11's `probe-server-menu.js` repair** was closed by `shasum` byte-identity rather than a confirming re-run,
  because Node's `fetch` began timing out against the API while `curl` returned 200 for the identical request.
  Honest downgrade; the obstacle was evidenced.

---

## Process notes: what this milestone cost and what it bought

**The dominant defect class was not code — it was false claims about code.** M4 caught **nine false comments**
and **four false cost estimates**, and every one shared a root cause: *asserting a fact from surrounding idiom
instead of reading the declaration.* Three of the nine were produced by implementers who had, in the same task,
been told to trust greps over consumer lists.

**The countermeasure had to escalate twice:**
1. **A reviewer re-derives the claim from the file.** Caught seven of the nine.
2. **A reviewer runs the counterfactual.** Caught the ninth, which a re-read would have passed — the author had
   read the rule **correctly** and drawn a **wrong conclusion** from a correct premise. **Claims about behaviour
   need a counterfactual; claims about facts-on-disk need a re-read.**

**The false-cost-estimate class deserves its own name**, because it is subtler: *"X could not be measured
because Y"* reads as rigour and thereby **suppresses the question "is Y true?"**. In all four instances Y was
false and a cheap measurement existed — twice using a stubbing pattern already present in the milestone's own
harness. The rule adopted: **"X could not be measured because Y" must carry evidence for Y at the same standard
as a claim that X passed.**

**Five times an implementer caught an error in the plan text or in a controller dispatch and said so rather than
complying** — including two of my own rulings that were simply wrong (an anchor-derived `key` that would not
have changed at one call site; a focus-restore asymmetry that the probe's own output contradicted), and one
dispatch that was **self-contradictory** and could not be satisfied as written. **Three times an implementer
produced a better solution than the one prescribed** — an open-sequence key instead of an anchor key, a
`hasKey()` guard instead of a bare prefix, and `.modal-header h2 { margin-bottom: 0 }` instead of demoting an
`<h2>` that carried the dialog's only heading. **Instructing implementers to push back, and meaning it, was
worth more than any single review.**

**What the whole-branch seat bought, again.** M3's closeout argued that per-task review cannot catch defects
invisible in a diff. M4 reproduces the finding exactly: the whole-branch review's Important #1 —
`AvatarCropModal`'s unguarded close chip — was invisible to T9's scoped re-review because that seat saw a
**one-attribute diff** and could not see the **two sibling affordances** that made the asymmetry. Its second
Important, the accessible-name gap, is an **absence** spanning eleven controls across four files. Its
primitive-shadowing and deleted-selector sweeps are only meaningful across the whole range. **This seat is not a
formality.**

**Two probes in one milestone turned out to be incapable of doing their job** — one repaired at T1, one found
dead at T11 with a failure message that would have blamed shipped code for a harness fault. Combined with M2's
six false-passing probes, the standing lesson holds and should be applied before citing any probe: **check that
it can fail.**

**One process cost worth recording:** an implementer was terminated mid-task by an API spend limit. Recovery
cost one short resume, because the ledger-plus-report-file contract meant the work was durable outside the
agent's context. **A spend-limit kill is not a failed task** — this is precisely the failure mode the SDD ledger
exists for, and it worked.
