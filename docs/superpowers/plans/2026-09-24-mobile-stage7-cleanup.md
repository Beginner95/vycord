# Mobile Stage 7 — Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the pre-redesign mobile model (`data-mobile-panel`, `onMobileBack*`,
component-level legacy breakpoints), empty the breakpoint allowlist, and reconcile the
spec's coverage table (§10) — with the desktop (`≥900px`) staying pixel-identical and
without regressing the 769–899px call-tile controls.

**Architecture:** Pure deletion/migration stage — no new features. Every removal is
backed by evidence that the code is unreachable: `AppPage.tsx` mounts `DesktopShell`
only at `≥900px` (`useIsMobile`, same `(width < 900px)` query as the CSS), so everything
that targets `.app-layout` below 900px, and every prop only ever passed by that removed
model, is dead. The one exception found during research is a *shared* CSS rule
(`.stage-focus-btn`/`.stage-volume-btn`/`.stage-share-badge` in `CallStage.css`): those
classes are rendered by `RemoteParticipantTile`, which `MobileCallScreen` mounts on mobile,
so that rule is **migrated** to `< 900px`, not deleted.

**Tech Stack:** React 19, Vite 8, TS, Zustand 5, Vitest, RTL, plain per-component CSS.

**Spec:** `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md` (§9 item 7,
§10 coverage table, §12a, "Этап 4 — отложено" — the recorded `CallStage.css` warning)

## Global Constraints

- Breakpoint literal is exactly `(width < 900px)` / `(width >= 900px)`; after this stage
  `LEGACY` in `client/src/styles/__tests__/breakpoint-contract.test.ts` is `{}`.
- Desktop (`≥900px`) pixel-identical. Frozen DOM snapshots (`*.dom.test.tsx`) are the safety
  net; a snapshot may change ONLY where a task explicitly says which nodes disappear.
- **Never delete a CSS rule whose classes are rendered by a component that mounts under
  `.mobile-shell`** (`RemoteParticipantTile`, `ChatArea`, `MobileCallScreen` children).
  Migrate its breakpoint instead. Check with `grep -rn "<class>" client/src --include=*.tsx`.
- No numeric z-index literals; role tokens only. Touch targets ≥44×44 where touched.
- Never edit `client/src/test/api.network-retry.test.ts`.
- Gates (run from `client/`): `npx tsc --noEmit` and `npx stylelint "src/**/*.css"` produce
  zero bytes; `npm run check:i18n` → «непереведённых строк не найдено»; `npm test -- --run`
  fails exactly 3 tests, all in `api.network-retry.test.ts`.
- Repo test conventions: `@testing-library/jest-dom` is NOT installed (use `.toBeTruthy()`);
  jsdom lacks `matchMedia` (local `vi.hoisted` stub) and `Element.prototype.scrollTo`.
- Implementers never `git commit` (the user commits).

## Decisions

**D1 — `AppPage.css`'s whole `@media (width < 900px)` block (lines ≈183–266) is deleted
wholesale**, not just the `data-mobile-panel` selectors. It contains the panel model, the
`.title-bar`/`.sidebar-gutter` hides, and the "M6 T8 navigation affordances" sub-block —
all of it targets `.app-layout`, which only `DesktopShell` renders, and `DesktopShell`
never mounts below 900px (`DesktopShell.tsx:83-85` says so itself). No JS/TSX sets
`data-mobile-panel` anywhere (research grep: only this CSS file mentions it).

**D2 — `onMobileBack*` removal is JSX+type+CSS together, per component.** No live call site
passes these props (`DesktopShell` and `ChatScreen` do not); only two tests pass mocks.
Removing the prop makes the `.mobile-back-btn`/`.chat-back-btn`/`.stage-back-btn` classes
unrenderable, so their CSS (base rules and `@media` blocks) goes in the same task.

**D3 — The hidden mobile-header wrappers go too.** `HomeView` (`.home-view-mobile-header`)
and `UserList` (`.user-list-mobile-header`) wrap a title `<span>` that is `display: none`
on desktop and never mounted under `.mobile-shell`. They exist only for the removed panel
model. Removing them changes the frozen `UserList` snapshots by exactly those hidden nodes
(pixel-neutral). `ChannelSidebar`'s `.channel-header` is a real desktop header — only its
back button goes. Cost if wrong: trivial re-add of a `display: none` div.

**D4 — Not in scope: `onShowCall` / `onShowMembers` / `.chat-call-btn` / `.chat-members-btn`.**
These are different props (not `onMobileBack*`); `ChatScreen` still passes `onShowCall`.
`MobileShell.css`'s affordance rule keeps those two selectors untouched; only selectors
belonging to removed elements are dropped.

**D5 — `CallStage.css` legacy blocks are handled per class, traced against
`RemoteParticipantTile.tsx` (shared with `MobileCallScreen`) and `CallStage.tsx` (desktop-only):**

| line ≈ | condition | classes | fate |
|---|---|---|---|
| 125 | `<= 768px` | `.stage-fullscreen-btn` | delete (CallStage-only) |
| 421 | `<= 768px` | `.stage-focus-btn`, `.stage-volume-btn`, `.stage-share-badge` | **migrate → `< 900px`** (shared with `RemoteParticipantTile`) |
| 649 | `<= 768px` | `.stage-share-banner-dismiss` | delete (CallStage-only) |
| 786 | `<= 768px` | `.stage-back-btn` | delete with `onMobileBackToChat` (Task 4) |
| 792 | `<= 640px` | `.stage-grid` | delete (CallStage-only; mobile uses `.mcs-grid`) |
| 913 | `<= 768px` | `.stage-focus-controls` | delete (CallStage-only) |
| 943 | `<= 768px` | `.stage-focus-ctrl-btn` | delete (CallStage-only) |

Migrating line 421 also *fixes* the recorded 769–899px degradation for these tile controls.

**D6 — The other four legacy blocks are deleted outright:** `ChannelSidebar.css:382`,
`CommandPalette.css:224` (palette is not mounted on mobile: `showPalette={false}`),
`FriendsPanel.css:203`, `ServerList.css:201`. Research confirmed no `mobile/` file imports
`FriendsPanel`/`ServerList`/`CommandPalette`; `ChannelSidebar` is only mentioned in comments.

**D7 — Rows 88/89 (`UpdateBanner`, `ErrorBoundary`) are verification-only.** Both components
exist; "план" meant "not yet checked at mobile width".

**D8 — This is the last stage, so §10 is *reconciled*, not deferred.** Every non-✅ row gets
either real evidence, or a final "accepted, permanent" note; leftovers from all per-stage
"отложено" sections move into one final follow-ups list in §13.

## File Structure

| File | Change |
|---|---|
| `client/src/components/__tests__/ChatArea.dom.test.tsx`, `UserList.dom.test.tsx` (+ their snapshots) | Task 1: stop passing `onMobileBack` mock; regenerate snapshots |
| `client/src/components/__tests__/ChannelSidebar.dom.test.tsx`, `HomeView.dom.test.tsx` (new, + snapshots) | Task 1: new frozen DOM |
| `client/src/pages/AppPage.css` | Task 2: delete the dead `@media (width < 900px)` block |
| `client/src/components/{HomeView,ChatArea,UserList,ChannelSidebar}.tsx` + `.css` | Task 3: drop `onMobileBack`, back buttons, mobile-header wrappers, their CSS |
| `client/src/components/CallStage.tsx` + `.css` | Task 4: drop `onMobileBackToChat`; per-D5 CSS |
| `client/src/components/{ChannelSidebar,CommandPalette,FriendsPanel}.css`, `ServerList.css` | Task 5: delete legacy blocks |
| `client/src/mobile/MobileShell.css` | Task 6: trim dead selectors + stale comment |
| `client/src/styles/__tests__/breakpoint-contract.test.ts` | Task 6: `LEGACY = {}`, non-vacuity fixed |
| `client/src/styles/__tests__/legacy-mobile-model.test.ts` (new) | Task 6: guard against reintroduction |
| `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md` | Task 7: §10 reconcile, §13 follow-ups |

---

### Task 1: Freeze the real production DOM before touching anything

**Files:**
- Modify: `client/src/components/__tests__/ChatArea.dom.test.tsx`, `UserList.dom.test.tsx`
- Regenerate: their `__snapshots__/ChatArea.*.html`, `UserList.*.html`
- Create: `client/src/components/__tests__/ChannelSidebar.dom.test.tsx`, `HomeView.dom.test.tsx` (+ snapshots)

**Interfaces:** Produces the byte-level baseline every later task must keep identical.

The existing `ChatArea`/`UserList` tests pass an `onMobileBack` mock, which no production code
does — so their snapshots contain a back button that never ships. Fix that first, so the
baseline is the *real* DOM.

- [ ] **Step 1: Drop the mock prop from the two existing tests.**
  In `ChatArea.dom.test.tsx` remove `, onMobileBack: vi.fn()` from `props()`. In
  `UserList.dom.test.tsx` change `<UserList onMobileBack={vi.fn()} voiceParticipants=… />`
  to `<UserList voiceParticipants=… />`.
- [ ] **Step 2: Regenerate and inspect.** From `client/`:
  `npx vitest run src/components/__tests__/ChatArea.dom.test.tsx src/components/__tests__/UserList.dom.test.tsx -u`
  then `git diff --stat client/src/components/__tests__/__snapshots__`. Read the diff: it must
  consist ONLY of removed `<button class="chat-back-btn" …>` / `<button class="mobile-back-btn" …>`
  elements. Anything else = stop and report.
- [ ] **Step 3: New `ChannelSidebar.dom.test.tsx`** — mirror the store seeding style of
  `UserList.dom.test.tsx`; snapshot two states: a server with channels, and `server={null}`
  (the "Дом" state). Use `toMatchFileSnapshot('./__snapshots__/ChannelSidebar.<name>.html')` with
  `normalizeHtml` if the neighbouring tests use it.
- [ ] **Step 4: New `HomeView.dom.test.tsx`** — one snapshot of `<HomeView />` (needs `MemoryRouter`
  and friend/online stores seeded as `FriendsPanel` requires; read `FriendsPanel.tsx` for the
  stores it reads). If the render proves impractically heavy, report it and fall back to
  asserting the presence of `.home-view` and `.home-view-mobile-header` — say so explicitly.
- [ ] **Step 5: Run the four files twice** (`npx vitest run …`) to prove the snapshots are stable.

---

### Task 2: Delete the dead `AppPage.css` mobile block

**Files:** Modify `client/src/pages/AppPage.css`

- [ ] **Step 1:** Delete the entire `@media (width < 900px) { … }` block that begins at
  `.app-page .title-bar { display: none; }` and ends with the
  `.app-layout .home-view-mobile-header { display: flex; }` rule (≈ lines 183–266), including
  the long M6 T8 comment. Leave the other `@media` blocks (`width >= 900px` ≈142/161 and the
  `900px <= width < 1200px` / `width < 1200px` desktop bands at ≈297/310) untouched.
- [ ] **Step 2:** Confirm nothing else referenced it:
  `grep -rn "data-mobile-panel" client/src` must return only comments in files handled by later
  tasks (report any TSX/TS hit — there should be none).
- [ ] **Step 3:** `npx stylelint "src/**/*.css"`, `npx tsc --noEmit`, and the Task 1 dom tests: all green, no snapshot diff.

---

### Task 3: Remove `onMobileBack` from `HomeView`, `ChatArea`, `UserList`, `ChannelSidebar`

**Files:** the four `.tsx` and their `.css` (`HomeView.css`, `ChatArea.css`, `UserList.css`,
`ChannelSidebar.css`), plus the two tests from Task 1.

- [ ] **Step 1 — TSX.** In each component delete: the `onMobileBack?: () => void` prop type,
  its destructuring, and every `{onMobileBack && (<button …>…</button>)}` block
  (`HomeView` ×1, `ChatArea` ×2 — the `!channel` branch and the `header === undefined` branch,
  `UserList` ×1, `ChannelSidebar` ×2). Remove now-unused imports (`ChevronLeft` where it was only
  used by the back button — check each file; `ChannelSidebar` and `UserList` may still use it or
  other icons). Per D3, also delete the `.home-view-mobile-header` wrapper `<div>` in `HomeView`
  (keep `<FriendsPanel …/>`) and the `.user-list-mobile-header` wrapper `<div>` in `UserList`
  (with its `<span>{t('chat.members')}</span>`); check the `t('chat.members')` /
  `t('server.home')` keys are still used elsewhere so `check:i18n` stays clean.
- [ ] **Step 2 — CSS.** Delete the rules that can no longer match:
  `.mobile-back-btn` (+ `:hover`) in `ChannelSidebar.css`; `.chat-back-btn` (+ `:hover`, and its
  entries in the `@media` blocks around `ChatArea.css:378-396` — keep `.chat-call-btn` there
  untouched, D4) in `ChatArea.css`; `.user-list-mobile-header` in `UserList.css`;
  `.home-view-mobile-header` in `HomeView.css`; and the comments that describe them.
  Before deleting each selector run `grep -rn "<class>" client/src --include=*.tsx` and confirm
  zero remaining renderers.
- [ ] **Step 3 — tests.** `ChatArea.dom.test.tsx` / `UserList.dom.test.tsx` already stopped passing
  the prop (Task 1). Update any other test that passes `onMobileBack`
  (`grep -rn onMobileBack client/src`).
- [ ] **Step 4 — expected snapshot deltas.** `ChatArea.*` and `ChannelSidebar.*` snapshots must be
  BYTE-IDENTICAL to Task 1's. `UserList.*` and `HomeView.*` change by exactly the removal of the
  hidden `.user-list-mobile-header` / `.home-view-mobile-header` subtree — update those snapshots
  with `-u` and read the diff to confirm nothing else moved.
- [ ] **Step 5 — mobile regression.** `npx vitest run src/mobile` — `ChatScreen` reuses `ChatArea`.
- [ ] **Step 6 — gates:** tsc, stylelint, `check:i18n`.

---

### Task 4: `CallStage` — remove `onMobileBackToChat`, apply the D5 table

**Files:** `client/src/components/CallStage.tsx`, `client/src/components/CallStage.css`

- [ ] **Step 1 — TSX.** Remove the `onMobileBackToChat` prop (type, destructuring, the
  `.stage-back-btn` `<button>` block near `.stage-topbar`), its explanatory comment, and the
  `ArrowLeft` import if unused. Check `GuestCallView.tsx` / other callers don't pass it.
- [ ] **Step 2 — CSS, per the D5 table.**
  - Delete the base `.stage-back-btn { … }` rule (≈ line 29) and the comment at ≈97 that refers
    to it (reword if the comment also explains something still live), and the `@media (width <= 768px) { .stage-back-btn … }` block (≈786).
  - Delete the `@media (width <= 768px)` blocks whose only content is CallStage-only classes:
    `.stage-fullscreen-btn` (≈125), `.stage-share-banner-dismiss` (≈649),
    `.stage-focus-controls` (≈913), `.stage-focus-ctrl-btn` (≈943), and the
    `@media (width <= 640px) { .stage-grid … }` block (≈792). Before each, re-run
    `grep -rn "<class>" client/src --include=*.tsx` and confirm the only renderer is `CallStage.tsx`.
  - **Migrate, do not delete,** the block at ≈421: change `@media (width <= 768px)` to
    `@media (width < 900px)`. Keep its declarations and its comment (edit the comment if it
    mentions 768).
- [ ] **Step 3 — verify.** `CallStage.dom.test.tsx` snapshots byte-identical; `npx vitest run src/mobile src/components`.
- [ ] **Step 4 — evidence for the shared rule.** With the visual harness (`client/tools/verify/README.md`)
  or a jsdom-free CSS read, confirm `.stage-volume-btn` / `.stage-focus-btn` resolve to
  `opacity: 1; 40×40` at 850px wide inside `MobileCallScreen` (this was the recorded degradation);
  report honestly if the harness is unavailable.

---

### Task 5: Delete the other legacy breakpoint blocks

**Files:** `ChannelSidebar.css` (≈382), `CommandPalette.css` (≈224), `FriendsPanel.css` (≈203), `ServerList.css` (≈201)

- [ ] **Step 1:** For each file read the `@media (width <= 768px|640px)` block; confirm every class in
  it belongs to a component that only `DesktopShell` (or the never-mounted-on-mobile palette) renders
  (`grep -rn` for each class across `client/src --include=*.tsx`, and `grep -rn "from '@/components/<Name>'" client/src/mobile`).
  If any class turns out to be rendered under `.mobile-shell`, do NOT delete — migrate to `(width < 900px)` and report.
- [ ] **Step 2:** Delete the blocks (and any comment describing them).
- [ ] **Step 3:** `npx vitest run` for `CommandPalette.dom.test.tsx`, `ChannelSidebar.dom.test.tsx` (snapshots unchanged); gates.

---

### Task 6: Empty the allowlist, guard against regressions, trim stale comments

**Files:** `client/src/styles/__tests__/breakpoint-contract.test.ts`,
`client/src/styles/__tests__/legacy-mobile-model.test.ts` (new), `client/src/mobile/MobileShell.css`

- [ ] **Step 1 — `breakpoint-contract.test.ts`:** set `LEGACY = {}` (keep the constant so a future
  exception has a home, and update the docstring — "Этап 7 опустошает его" becomes past tense).
  The non-vacuity test currently asserts the scanner still sees `'width <= 768px'`, which no longer
  exists; rewrite it to feed the extraction function a literal CSS string containing
  `@media (width <= 768px) {}` and assert it is reported — read the file first to reuse its helper.
- [ ] **Step 2 — guard test.** Create `legacy-mobile-model.test.ts`: recursively read every
  `.ts/.tsx/.css` under `client/src` except this file and `node_modules`, and assert none contains
  `data-mobile-panel`, `onMobileBack`, `mobile-back-btn`, `chat-back-btn`, `stage-back-btn`,
  `user-list-mobile-header`, or `home-view-mobile-header`. Mirror the fs-walking helper style of
  `breakpoint-contract.test.ts`. Fix any remaining hit (comments included) or, if it is a legitimate
  unrelated use, narrow the pattern and say why in the report.
- [ ] **Step 3 — `MobileShell.css`:** in the "navigation affordances" comma-list remove
  `.mobile-shell .mobile-back-btn`, `.chat-back-btn`, `.stage-back-btn`, `.user-list-mobile-header`;
  keep `.chat-call-btn` and `.chat-members-btn` (D4) and fix the comment above the rule so it names
  only what remains. In the comment above `.mobile-screen > .chat-area` drop the dangling
  «и .call-stage» mention (no `.call-stage` rule exists there).
- [ ] **Step 4 — `public/favicon.svg` (spec §8).** It is the default Vite logo. Run
  `grep -rn "favicon.svg" client --include=*.{html,ts,tsx,css,json,mjs,cjs} --exclude-dir=node_modules --exclude-dir=dist`
  and check `client/package.json` (`build.files`, electron-builder config). If nothing references it,
  delete `client/public/favicon.svg` and run `npm run build` from `client/` to confirm the build still
  passes; if anything references it, leave it and record that in the report (it moves to §13 follow-ups).
- [ ] **Step 5:** `npx vitest run src/styles` green; full gates.

---

### Task 7: Reconcile §10, close the spec, acceptance

**Files:** `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`

- [ ] **Step 1 — gates:** tsc, stylelint, `check:i18n`, `npm test -- --run` (3 failures, all `api.network-retry`).
- [ ] **Step 2 — desktop identity.** `git diff` of `DesktopShell.tsx`, `AppPage.tsx` is empty; all frozen
  DOM snapshots pass; harness spot-check at 1280×800 of the call stage / chat / members panel if available
  (compare AE against a pre-stage checkout of the same states, or report the gap).
- [ ] **Step 3 — rows 88/89.** Using the harness with store fixtures, render `ErrorBoundary`'s fallback
  and (if it can be shown on web) `UpdateBanner` at ~390px width; confirm no horizontal overflow and
  readable text. Fix only trivial CSS defects; otherwise record them. Mark the rows with the evidence.
- [ ] **Step 4 — reconcile every non-✅ row** (research list: 3, 14, 16, 20, 52, 67, 68, 69, 76, 86,
  88, 89, 95a, 96). Row 96 becomes ✅ (`LEGACY` empty, guard test). Row 92: reword the
  «`@media (width <= 768px)`-фоллбек» phrase to the migrated `< 900px` rule. For each remaining row
  either add evidence or replace ⏳/«частично» with a final «принято» note plus the reason
  (device-only checks, needs live backend, etc.). No row may stay «план».
- [ ] **Step 5 — §13.** Add a final "Итоговые follow-ups" list consolidating leftovers from the
  per-stage «отложено» sections that are real work (e.g. the guest «вы» badge id-prefix bug, real
  unread previews, swipe-to-quote, `CLAUDE.md` stale section, PWA icon source ≥512, device-only
  verifications). Mark the per-stage sections as historical. Add a short "Этап 7 — отложено и найдено
  по пути" section with anything found during this stage, plus the note that the authenticated call
  screen likely double-applies the top safe-area inset (`MobileShell` + `.mcs-topbar`).
- [ ] **Step 6:** Update row 97 with the stage-7 clause: what changed on desktop-visible files
  (none visually; snapshots byte-identical except the two hidden-header subtrees).
