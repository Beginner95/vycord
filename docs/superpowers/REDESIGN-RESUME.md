# vycord Frontend Redesign — RESUME HERE

**Written:** 2026-08-29, at the end of the M5 planning session.
**Purpose:** the single document that lets a cold session pick this work up. It carries the current stage, the
binding constraints, the measured debt register, and the exact prompt to run next. Every number in it was
re-measured on 2026-08-29 against `redesign` at `45f9e14` unless the line says otherwise.

**State: M0–M4 shipped. M5 is planned and grand-reviewed but NOT executed. M6 is not planned yet.**

---

## §0. START HERE — the next action

The next action is **executing M5**. The plan is written, Opus grand-reviewed, and committed. Paste the block
below into a fresh session. Nothing else needs to be prepared first.

```
Execute the M5 milestone (Command palette) of the vycord frontend redesign at
/Users/nm/Projects/experiments/vycord using superpowers:subagent-driven-development.

Plan: docs/superpowers/plans/2026-08-25-redesign-m5-palette.md — Opus grand-reviewed
before execution; its Global Constraints and decisions 1–29 are BINDING. Read it in
full before dispatching anything, including the "Review provenance" section at the end.

Read docs/superpowers/REDESIGN-RESUME.md first for the environment, the harness truth
table, the gate numbers and the debt register. Where it and older plan text disagree,
the RESUME file and the M4 closeout win.

State: branch redesign, HEAD 45f9e14 (the M5 plan commit — it is the range's base), not
pushed, main untouched (verify `git log redesign..main` is empty in Task 1; if it is not
empty, STOP and surface). Working tree clean apart from the intentionally untracked
design_handoff_discord_redesign/.

Also binding as inherited context:
- docs/superpowers/specs/2026-08-25-frontend-redesign-design.md (§5's M5 bullet is the
  clause list; §2, §3, §4.4, §6, §7)
- docs/superpowers/plans/2026-08-25-redesign-m4-closeout.md (24 rulings; supersedes older
  text), and the M3 and M2 closeouts it inherits from
- docs/superpowers/backlog/post-redesign-backlog.md — EXCLUDED scope. Plan and fix nothing
  from its §1; if a task brushes one of those items, record the contact and move on.

Execution rules:
- One commit per task; branch redesign only; never `git add -A`.
- Task 1 MUST `cp -R` the harness forward from
  .superpowers/sdd/2026-08-25-redesign-m4-modals/tools/ — it is gitignored, 31M, and the
  ONLY copy. If it is lost, every visual claim in M5 and M6 loses its instrument.
- Every probe is written and run against the PRE-task state first and must fail loudly
  there. A failing probe does NOT make smoke.mjs exit non-zero — it prints "PROBE ERROR:"
  and exits 0, so evidence is the printed output, never the exit code. Before citing any
  inherited probe, check that it can fail; the plan lists the ones that cannot.
- Gates at every task boundary, all run from client/: `npm run lint:css` (196 → 188,
  never above 531; stylelint from client/ ONLY — a repo-root run is an ENOENT crash, not
  a lint result), every M5-created/rewritten file individually 0 problems, the raw-value
  grep at zero rows, `npx tsc --noEmit` clean, `npm run check:i18n` at ZERO, and
  `npm test` RED only in api.network-retry.test.ts. M5 Task 2 legitimately changes the
  test shape — record its exact numbers and compare later tasks against those. Every test
  paste must show the FAIL lines naming the file.
- Dev server: cd client && npm run dev:vite → port 3000 EXACTLY; kill stale servers; a
  server predating HEAD invalidates visual evidence; a task that edits a base-layer file
  restarts the server before probing.
- Test account redesign_smoke@vycord.local / RedesignSmoke2026!, server «Redesign Smoke».
  Residue accounting must cover every probe an invocation runs, not only the probe the
  task is about.
- Instruct every implementer to PUSH BACK when the plan is wrong rather than comply. M4
  had five such catches, including two of the controller's own rulings, and three cases
  where the implementer produced a better solution than the prescribed one.
- Record every ruling in the ledger AS IT IS MADE, not only in the prompt that carries it
  — a reviewer reading only the on-disk record must not see invented authority.

Finish with a whole-branch review of the full range, a fix wave if it returns findings, a
scoped re-review of that wave, and then transcribe everything into
docs/superpowers/plans/2026-08-25-redesign-m5-closeout.md — the SDD workspace is
gitignored and dies with the session, so anything not transcribed is LOST. The M5 plan's
"What the closeout must record" section lists the pre-agreed contents. Then update
docs/superpowers/REDESIGN-RESUME.md: move M5 to shipped, refresh the gate numbers, and
fold any new debt into §6.
```

**After M5 ships, the next action is planning M6** — see §7, which already carries its scope and its inputs.

---

## §1. Current stage

| | |
|---|---|
| Branch | `redesign`, **not pushed** |
| HEAD | `45f9e14` — *docs(redesign): M5 plan* |
| `main` | untouched; `git log redesign..main` is **empty** (re-verified 2026-08-29) |
| Working tree | clean apart from the intentionally untracked `design_handoff_discord_redesign/` |
| Delivery model | one long-lived branch, milestone PRs, released as a single version — **no mixed-design releases** |

| Milestone | State | Range |
|---|---|---|
| **M0** Foundation | shipped | — |
| **M1** App shell | shipped | closeout: `2026-08-25-redesign-m1-closeout.md` |
| **M2** Chat | shipped | 19 commits `f39e699..3ada3cc` |
| **M3** Calls | shipped | 8 commits `f07c7d1..a3cc52e` |
| **M4** Modals/menus/settings | shipped | 11 commits `41b93e8..08aa58f`; closed out at `2dc4974` |
| **M5** Command palette | **planned, grand-reviewed, NOT executed** | plan commit `45f9e14` |
| **M6** Polish & closure | **not planned** | scope in §7 |

---

## §2. Document map — what to read and what supersedes what

**Precedence, highest first:** this file and the newest closeout → the spec → older closeouts → older plans.
A plan's text is *superseded* by its own closeout wherever they disagree; three milestones running have found
plan text that was factually wrong.

1. `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` — **the contract.** §5's milestone bullets
   are the clause lists each milestone must satisfy; §2 scope decisions, §3 current-state facts (incl. the
   server-side constraints), §4 architecture, §6 testing, §7 out of scope.
2. `docs/superpowers/plans/2026-08-25-redesign-m4-closeout.md` — **24 rulings, the freshest harness truth,**
   deferred-finding triage, reasoned-not-measured list, and the process notes on false comments and false cost
   estimates. Supersedes older text.
3. `docs/superpowers/plans/2026-08-25-redesign-m3-closeout.md` — 21 rulings + harness corrections.
4. `docs/superpowers/plans/2026-08-25-redesign-m2-closeout.md` — 17 rulings + the stylelint baseline history
   and the cascade-order fact every later milestone leans on.
5. `docs/superpowers/plans/2026-08-25-redesign-m1-closeout.md` — M1's rulings; its four carried nits are still
   open (§6).
6. `docs/superpowers/backlog/post-redesign-backlog.md` — **excluded scope.** Nothing in its §1 may be planned
   or fixed by a redesign milestone.
7. `docs/superpowers/plans/2026-08-25-redesign-m5-palette.md` — the next thing to execute.
8. **Pixel truth:** `design_handoff_discord_redesign/README.md` (token tables + per-screen specs) and
   `Redesign.dc.html` (the board; open in a browser). Board option ids: `1c` main screen, `1d` modals/menus,
   `1e` call, `1f` mobile, `2a` empty states, `2b` unread/typing/avatars, `2c` ⌘K palette, `2d` dark theme,
   `2e` speaking indication. **This bundle is untracked on purpose — never `git add -A`.**

---

## §3. Global constraints (binding on every remaining milestone)

- Branch `redesign` only; **one commit per task**; never commit to `main`; **never `git add -A`**.
- **No changes under `server/`.** No API or WebSocket contract changes. **No changes to
  `client/src/services/`**; `client/src/types/index.ts` untouched; `client/e2e/` untouched.
- **Legacy token aliases in `src/styles/tokens.css` stay until M6.** Until then `tokens.css` changes are
  **additions only** — verify `+N / −0` at every milestone close, which is what proves the alias block is
  untouched. M6 deletes the block (§7).
- All work under `client/`. Product copy is Russian; every new string lands in `i18n/locales/ru.ts` **and**
  `en.ts` together. `npx tsc --noEmit` is the **real** parity gate (`en` is typed against `ru`'s `Dictionary`).
  Plurals render through `tp()`/`useTp()` — `t()` renders the literal key for a plural entry.
- Icons: `lucide-react`, `strokeWidth={1.8}`, 16–21px. Sizes outside the band are permitted but **each must be
  recorded** (M3 set the precedent; M4 disclosed a ≥22px cohort). No emoji as UI icons, no hand-inlined SVGs in
  touched code.
- Class names: multi-segment kebab-case with a component prefix; state modifiers `is-*`/`has-*`; **never** BEM
  `--`/`__`. The single-segment allowlist is exactly `btn|input|kbd|modal|mention` (`.stylelintrc.json`).
- New CSS uses media-query **range syntax** (`(width <= 768px)`) — `media-feature-range-notation` requires it.
  The accepted cost is iOS Safari <16.4 (M2 ruling 17); M6 resolves it.
- Animation budget ≤250ms ease-out. Shared keyframes are `fade-in`, `scale-in`, `modal-in`, `slide-down` in
  `primitives.css`; all keyframe names in `client/src` are currently unique. Prefer reusing them to adding one.
- **Fail-first probes are mandatory.** Every probe is run against the pre-task state and must fail loudly there
  before its pass is trusted. Assert the precondition, never assume it.
- **Before citing any probe, check that it can fail** (§5).

---

## §4. Environment and gates

### Gate state, measured 2026-08-29 at `45f9e14`

| Gate | Value | Rule |
|---|---|---|
| `npm run lint:css` total | **196** | never above **531**; it should only fall. M5 takes it to 188. |
| Files individually 0 | all 13 M4-owned + all M3-owned | every file a milestone creates or rewrites must be 0 |
| `npm run check:i18n` | **ZERO warnings**, exit 0 | must stay at zero — M4 earned this |
| `npx tsc --noEmit` | clean | the real ru/en parity gate |
| `npm test` | **RED by design** | see below |
| `git log redesign..main` | empty | re-check each milestone |

**Remaining stylelint total decomposes across 7 files** (M5 removes `MessageSearch.css`'s 8):
`tokens.css` 118 · `ChannelSidebar.css` 23 · `UserList.css` 16 · `ServerList.css` 15 · `Auth.css` 10 ·
`MessageSearch.css` 8 · `AppPage.css` 4 · `TitleBar.css` 2. **These are M6's** — do not mass-fix them earlier.

**`npm test` is RED at baseline and always has been.** Three tests in
`src/services/__tests__/api.network-retry.test.ts` were merged without their implementation, plus 2 unhandled
rejections from the same file. Current shape: `Test Files 1 failed | 22 passed (23)` ·
`Tests 3 failed | 149 passed (152)` · `Errors 2 errors`. **Never fix that file** (it is under the `services/`
scope wall). The gate is: no *other* file fails, new tests pass, and **a paste that says "same file" without
the `FAIL` lines naming it is not evidence.** Adding test files legitimately changes the counts — record the
new shape when it happens and compare forward against that.

### Running things

- **Stylelint must run from `client/`.** `importFrom` is cwd-relative; a repo-root run crashes with `ENOENT`,
  **which looks like output rather than a crash.** `--formatter json` writes to **stderr** — pipe with `2>&1`,
  never `2>/dev/null`.
- **JS-injected custom properties are invisible to `importFrom`.** The family is `--avatar-*`, `--speak-level`,
  `--call-stage-height`, `--presence-ring`, `--slider-fill`, `--meter-level`. Every CSS reference to one must
  carry a fallback (`var(--slider-fill, 0%)`) or it adds a lint violation.
- **Dev server: `cd client && npm run dev:vite` → port 3000 EXACTLY.** The production CORS allowlist means a
  3001/3002 fallback fails login with a CORS error that looks like a bug and is not. **Kill stale servers** —
  three were alive at M3 start, two mid-M4. A server predating HEAD invalidates visual evidence.
- **Vite HMR can invert the base-layer cascade** by re-injecting a changed file after component CSS. Any task
  that edits `tokens.css`/`base.css`/`primitives.css` must restart the server before probing.
- Test account `redesign_smoke@vycord.local` / `RedesignSmoke2026!`, throwaway server «Redesign Smoke». This is
  the **production API** — destructive testing only there.
- **Electron cannot launch:** npm 11's `allowScripts` skipped its postinstall, so `node_modules/electron/dist`
  is 292K instead of ~250MB. Fixable with `npm install-scripts ls` in `client/`. Until someone does, **every
  Electron branch is reasoned-not-measured** and must be labelled so.

### Standing architectural facts

- **Component CSS reliably wins specificity ties against the base layer** — proven in dev *and* in the shipped
  production bundle (M2 T1). Anyone overriding `.btn`/`.modal`/`.kbd` can rely on source order.
- **`main.tsx` imports the style layer before the component graph.** Do not reorder it.
- **Server-side, verified:** `SendToChannel` delivers `chat_message` only to clients whose `CurrentChannelID`
  matches, so **live unread/mention badges cannot be computed client-side**; channels have **no type**
  (VYC-77 / migration 017); message search is **per-channel only**; the client holds only the active server's
  channel list.

---

## §5. Verification harness — the truth table

The harness lives at `.superpowers/sdd/<milestone>/tools/`, is **gitignored**, is ~31M, and **is the only
copy**. Each milestone carries it forward with `cp -R` in Task 1. Newest copy:
`.superpowers/sdd/2026-08-25-redesign-m4-modals/tools/`. **If it is lost, every visual claim loses its
instrument.**

**These corrections override older plan text. They were each learned the hard way.**

- **`--out <file.png>` is the screenshot flag**, not `--shot`. Full argument set: `--out`, `--theme`, `--path`,
  `--wait`, `--anon`, `--click` + `--after` (default 1500ms), `--click2` + `--after2` (default 800ms),
  `--size WxH` (default `1440x900`), `--touch`, `--fake-media`, `--focus-emulation`, `--fake-electron`,
  `--preload`, `--push-ws`, `--type-into` + `--type-text`, `--probe` / `--probe2` / `--probe3`.
- **A failing probe does NOT make `smoke.mjs` exit non-zero.** `smoke.mjs:403` wraps the probe in
  `try { … } catch (e) { return 'PROBE ERROR: ' + e.message }`. **Evidence is the printed output, never the
  exit code.** The probe file is evaluated as an **expression**, so it must be an IIFE. `--probe2`/`--probe3`
  run after `--probe`, each in its own `Runtime.evaluate` — the only way to spend more than one transient user
  activation.
- **`--click` is `el.click()` with no user activation.** Anything gated on transient activation (notably
  `requestFullscreen`) rejects on that path. `userGesture: true` exists only at the probe-eval call site.
- **`--type-into` dispatches `Enter` after typing** and then sleeps 2500ms. Right for the search panel, wrong
  for anything where Enter activates a selection.
- **`--fake-media` fakes devices and auto-grants permission but joins nothing.** Drive joins explicitly with
  `--click .chat-voice-btn --after 9000`; `--after 6000` is unreliable (three failed joins observed).
- **`--push-ws` is inert without `--preload tools/inject-voice-ws.js`**, fires before `--click`/`--probe`, and
  **cannot satisfy a guard that compares against live state** — read the id from the store and call `__pushWS`.
- **`--focus-emulation` is opt-in and makes `document.hasFocus()` permanently true.** Needed for focus-ring
  assertions; never default it, and never use it on a probe asserting blur/idle behaviour.
- **`getComputedStyle(el, '::-webkit-slider-*')` returns the HOST box**, not the pseudo's. Author pseudos
  (`::before`) resolve normally. That asymmetry is the reusable fact.
- **`new Event('change')` does not bubble** and React 18 delegates at the root — synthesized events need
  `{ bubbles: true }`.
- **Chromium keeps a fullscreen element stack**; swapping targets needs exit-then-request. The viewport resizes
  a frame *after* `fullscreenchange`. `opacity: 0` does **not** remove an element from hit-testing.
- **The M3-era claim that `--fake-media`'s tone peaks at ~0.0065–0.0115 is measured FALSE.** It is a full-scale
  periodic beep every ~450ms and that range is its decay tail; the plan also compared a time-domain amplitude
  against a frequency-domain reader. **No brief may carry the 1%-rounding sentence forward.** M3's speaking-ring
  evidence and backlog §3d both rest on it and need re-checking.

**Probes that cannot be trusted** (check before citing, always):
`probe-callstate.js` — inert, **banned as evidence**. `probe-confirm-modal.js` — stale M2 residue, dead
selectors, **zero `throw`**. `probe-t5fix-handoff-focus.js:35` — `… || true`, a field that cannot fail.
`probe-t11-flow.js` — `toastPresent` queries a deleted class, permanently false. `probe-chat.js` — a real gate
since M4 T1, **but** two descriptive fields are optional-chained with no `fail()` and its continuation-row
assertions no-op on an empty list. Reference implementation of a correct probe: `probe-screen-picker.js` (22
`fail(` sites, every assertion thrown, none merely recorded).

**Two nominal gates in M4 turned out not to be gates**, on top of M2's six false-passing probes. The standing
rule: *a probe is evidence only once it has been shown to fail against the broken version of the code it is
meant to catch.*

---

## §6. Debt register

Consolidated from the M1–M4 closeouts, the backlog and the M5 plan. **Every item marked (measured 08-29) was
re-verified against the tree on 2026-08-29;** the rest are carried as recorded and are flagged as such.

### 6a. Owned by M5 (already planned — no action needed here)

`MessageSearch.css` 8 → 0 and off the legacy aliases · the four hand-inlined SVGs in `MessageSearch.tsx` ·
board `2a`'s two-line empty state · the header ⌘K chip question, closed with an explicit answer · the
`Ctrl+Shift+F` document listener becoming overlay-aware.

### 6b. Owned by M6 — the alias sweep

**Measured alias inventory (08-29), references per file.** This replaces the inherited list, which was stale:

| File | Alias refs | Note |
|---|---|---|
| `styles/tokens.css` | 50 | **this is the alias block itself — deleting it is the milestone task** |
| `components/MessageSearch.css` | 37 | **M5 removes this file from the list** |
| `pages/Auth.css` | 30 | never touched by the redesign; the largest remaining consumer |
| `components/ServerList.css` | 19 | |
| `pages/AppPage.css` | 7 | |
| `components/settings/ProfileSettings.css` | 7 | **M4-rewritten and still on aliases** |
| `components/UserList.css` | 7 | |
| `components/ChannelSidebar.css` | 6 | includes `.no-server-message`'s `--text-muted` (the M1 item) |
| `styles/primitives.css` | 6 | **M4-owned, at 0 problems, still consumes `--shadow-lg`/`--red-500`/`--radius-md`** |
| `components/LinkDialog.css` | 2 | **M4-rewritten and still on aliases** |

> **Correction to the M4 closeout:** it recorded that M4's rewrites took `ErrorBoundary.css` and
> `UpdateBanner.css` fully off the aliases — true, both are absent from the list above. But it did **not**
> notice that three other M4-touched files (`ProfileSettings.css`, `LinkDialog.css`, `primitives.css`) still
> carry references. M6 must not assume "M4-owned" means "alias-free".
>
> Also inherited and still true: **no `--danger-color` token exists anywhere in the tree**, so `LinkDialog.css`'s
> references to it were always rendering their fallback hex, never a token.

**The alias deletion doubles as the audit** (spec §8): after deleting the block, a grep for old token names
**and** a grep for raw hex/`rgba()` outside `tokens.css` must both come up empty. The name grep alone misses
raw values.

### 6c. Owned by M6 — everything else

**Dark-theme parity**
- **`--danger` has no dark value** (measured 08-29: `tokens.css` defines `--danger` only in `:root`, while its
  siblings `--danger-soft`/`--danger-text` and all three `--online-*` do have dark overrides). M4 introduced
  the tree's only two uses of it as a *foreground* — `.context-menu-item.is-danger` and
  `.settings-nav-logout` — so in dark those render `#E7444A` at rest and jump to `#FCA5A5` on hover, a shift
  that does not occur in light.
- **`.setting-warning`'s amber-on-near-white is ~2.01:1** (AA needs 4.5:1); inherited (~2.09:1 at base) but M4
  lost its dark tint — `--yellow-50` has a dark override, `--canvas-2` does not, `--warning` has no dark value.
  This surface carries the NC-unsupported and mic-permission messages.
- **Is the call stage's accent theme-invariant or not?** 12 sites use `--accent`/`--accent-hover` on a stage
  whose every other token is `:root`-only. The handoff gives no separate dark-stage accent — **this one has no
  board answer and needs a human** (backlog §2b).
- M5 adds `--hl-bg`/`--hl-ink`; their dark values are **interpolations**, not board values.
- Colour findings across the branch are **derived from `tokens.css`, not measured in a browser** — every probe
  to date asserts geometry, so "both themes PASS" would not have caught any of these.

**Responsive** — the spec's target: ≥1200px four columns · 1000–1200px member list hidden behind the header
toggle · <900px sidebar drawer · <640px mobile. **Both sides of the current 768/769px pair migrate to the
900px boundary.** That migration rewrites every existing media block, which is where the range-syntax /
iOS-Safari-<16.4 question (M2 ruling 17) gets resolved. Known responsive defects to fold in: `.p2p-modal`'s
hard `width: 340px`; the top-bar title truncating to `#g…` at 390–420px; `@media (hover: none)` having no
width bound, so a touch-capable *wide* screen gets the always-visible message action row; `.msg-action-btn` at
28×28 against the board's ≥40px touch floor (clears WCAG 2.5.8's 24px, so it is a shortfall, not a violation).

**Accessibility**
- **The accessible-name gap lives in the primitives recipes**, which every consumer inherits: on the Settings
  panes, 4 toggles, 2 range sliders and 5 selects carry no accessible name, and the level meter has no
  `role="progressbar"`. **Fix at the recipe — one change, not eleven call sites.**
- The chat column has **no `h1` at all** (`<h2>` where the old quiet-channel state used `<h1>`).

**Motion** — `prefers-reduced-motion`. `base.css` already carries a blanket reduce block; the pass is about the
**looping** animations: `chat-shimmer` (1.2s), `stage-eq-bar` (0.7s staggered), `p2p-pulse` (2.5s), the
incoming-call pulse, and `message-search-spin`. Drop loops, keep opacity fades. Also: the ≤250ms ease-out
budget audit.

**Dead code and cosmetics** (each recorded by the milestone that found it)
- **`primitives.css`'s `.channel-type-options` block — 7 rules, ~58 lines, no TSX emitter** (measured 08-29;
  orphaned by commit `4674032` *before* M4 began). **Consequence beyond dead weight:** the keyframe-consumer
  comment lists `modal-in`'s live consumers as "`.modal` and the radio `::after`", and that `::after` is
  *inside the dead block* — correct the comment in the same change.
- **`.panel-icon-btn.is-off` has no `:hover`** (measured 08-29). `.panel-icon-btn:hover` (0,1,0) sets colour
  only and loses to `.is-off` (0,2,0), so an off button visibly does nothing on hover. M1 item, still open.
- **`AppPage.tsx:603` renders `▶`/`◀` as glyph-icons** (measured 08-29) — explicitly excluded by M1's own plan.
- **`.update-banner-dismiss` loses its own override on hover** — (0,1,0) against `.btn-ghost:hover`'s (0,2,0),
  which wins regardless of source order, so the button reverts to exactly the state its comment says the
  override prevents.
- **`.invites-code` carries `overflow`/`text-overflow`/`white-space` that can never fire** (the triple is
  present, measured 08-29) — M4 recorded the cause as a wrapper that lost `flex: 1; min-width: 0`. **Re-derive
  the wrapper selector before fixing; the class name in the M4 note does not exist in the file today.**
- `msg-mention-role` is emitted with no matching CSS rule (pre-existing since before M2).
- `msg-jump-flash` animates background to `transparent`, stripping an own-message row's tint for 2.2s.
- The dead `55%` fallback at `AppPage.css:26` — `--call-stage-height` is set unconditionally, so the fallback
  reads as a guard that does not exist.
- `.stage-focus-label` hard-clips with no ellipsis; `.stage-plate`/`.stage-state-chip` overlap by 8px on a
  265px tile; the share badge/focus button overlap at 641–768px (**never measured by anyone**);
  `.stage-tip-arrow` no longer points at its chip when the tooltip is clamped; `.stage-focus-ctrl-btn` is
  36×36 against decision 22's 40px floor; a screen-share error toast is invisible during focus fullscreen.
- **A grouped icon-size deviation record exists and must be carried, not re-litigated:** an unrecorded ≥22px
  cohort (`AlertTriangle 28`, `ImagePlus 28`, `Phone 28`, `Hash 22`, `SearchX 22`) plus M3's `size={10}`×6,
  `12`×10, `14`×3. Recorded as **adapted**.
- **Two weak tests whose names overstate them:** `messageStore.test.ts`'s "can set and clear deliveryState"
  never asserts the clear case; `unreadStore.test.ts`'s "survives a corrupt payload" is vacuous twice over (it
  never reaches `load()`'s catch, which runs at module import before any `beforeEach`). ~4 lines each.
- **New from the M5 plan:** `isBlockingOverlayOpen()`'s DOM half is load-bearing until M6 finishes app-wide
  `useModalFocus` adoption — it holds only while *every* modal renders `.modal-overlay` (true today across all
  ten modal components plus `AppPage`'s inline one). The five non-stack-aware document Escape listeners
  (`ContextMenu.tsx:35`, `VolumeControlPopover.tsx:57`, `ScreenSharePicker.tsx:24` **and** `:88`,
  `useFloatingSelectionToolbar.ts:67`) are M6's if it takes that adoption. The z-index tier is crowded —
  1050 context menu · 1100 screen-share picker **and** volume popover · 1150 palette · 1200 stage tooltip ·
  2000 toast and call banner · 9999 update banner and error boundary — and may want a named scale.
- **New from the M5 plan:** with the call stage fullscreen on **desktop**, a palette chat command lands in a
  `display: none` chat area (`AppPage.css:67-72`). Accepted for M5, M6 owns it.

**Corrections M6 must not re-inherit wrong**
- **`no-descending-specificity` is context-dependent, not false.** M2 and M3 each disproved a copied instance
  (the rule buckets by at-rule context, so a top-level `:hover` and a rule inside `@media` are never compared),
  but M4 tested a third instance and it **fired**. Test the counterfactual with a positive control; never copy
  the justification.
- **`rg -nw 'search-empty'` still matches `message-search-empty`**, because `-` is a non-word character. The
  working form is `(?<![a-zA-Z0-9_-])name(?![a-zA-Z0-9_-])`. **Match class tokens, not substrings** — that trap
  fired three times across M3 and M4.

### 6d. Post-redesign backlog — EXCLUDED from every milestone

These need a `services/`- or store-architecture scope grant that the spec forbids. **Do not fix them inside a
redesign milestone**; if you touch their neighbourhood, record the contact and move on. Full detail lives in
`docs/superpowers/backlog/post-redesign-backlog.md`.

- **Board `1e`'s camera-off tile treatment never renders for a connected peer.** Two shipped board deliverables
  are dead for everyone but yourself. Needs a camera signal in `RemoteParticipant` fed from the services layer.
- **Lost draft on a failed send** — silent user data loss. Needs a draft-persistence decision.
- **A rejected fetch for the still-current channel paints the previous channel's messages** (`AppPage.tsx:543`).
  M5's palette becomes a new caller of `handleSelectChannel` and therefore inherits this — it does not
  introduce it.
- **A POST that succeeds after a channel switch no-ops its `replaceMessage`** — the message lands on the server
  and is invisible until a refetch.
- **A send failure has nowhere to surface if the channel becomes null.**
- **A stalled avatar upload is a complete trap.** All three exits are inert while saving, `AvatarCropModal` does
  not adopt `useModalFocus` so there is no Escape either, and `services/api.ts` has **no `AbortController`,
  timeout or `signal` anywhere.** The correct fix is a request timeout in `services/`.
- **`ManageInvitesModal`'s unconditional `setInvites(list)` clobber race** — a just-created invite vanishes.
  One-line fix, verified pre-existing. *The reasoning is worth keeping: the excluded-scope list is a floor on
  what must not be touched, not a licence for everything outside it.*
- **`ServerMenu` reads permissions via `getState()`** (non-reactive), so a permission change while the menu is
  open does not re-render it.
- **`ContextMenu`'s outside-mousedown has no trigger exclusion.**
- **`apiService.previewInvite` does not `encodeURIComponent` its argument.**
- **The `npm test` RED baseline has been red since M1.** Either implement the retry logic those three tests
  describe or delete them — *a permanently red suite trains people to ignore red.*

### 6e. Harness debt (gitignored, ships nothing)

Repair or delete before anything cites them: `probe-chat.js`'s two optional-chained fields and its
no-op-on-empty continuation assertions · `probe-t5fix-handoff-focus.js:35`'s `|| true` ·
`probe-confirm-modal.js` (zero `throw`s — delete or rename so it is never mistaken for a gate) ·
`probe-primitives-toggle.js`'s three recorded minors are **moot** (the collision it measured was retired by
M4 T7) — close them.

### 6f. Awaiting a human — decisions nobody should make unilaterally

| # | Question | Owner once decided |
|---|---|---|
| 1 | **The header search button keeps opening the deep panel, so board `1c`'s dark-theme ⌘K chip is NOT shipped on it** (M5 decision 7). If you want that button to become the palette entry instead, it is a two-line change. | M6 |
| 2 | **Board `2c`'s per-row server name is dropped** as unreachable — the client holds one server's channels, so it would be a constant (M5 decision 2). | M6 |
| 3 | **Is the call stage's accent theme-invariant?** No board answer exists. | M6 dark pass |
| 4 | **The focused screen-share view is 126.59px tall in the default split.** Read the three corrections in the backlog before touching it — the obvious fix is wrong, and the largest lever is the thumbnail strip, not the split. | M6 |
| 5 | **The call's leave button is a pill, not r14** — the most visible board departure in M3, never formally ruled. | board |
| 6 | **Invite revoke still deletes without confirmation**, against board `1d`'s "never delete without this step". Byte-identical to base — inherited, not introduced. | board, then M6 |
| 7 | **Three non-M3 components' modal entrance changed** (scale `.92` → `.95`) when a duplicate keyframe was deleted. Sign-off, not work. | sign-off |
| 8 | **Toast entrance sped 0.3s → 0.22s** for two non-M2 components when the recipe was unified. Sign-off. | sign-off |
| 9 | **Media-query range syntax vs iOS Safari <16.4** — the web client gets a *hybrid* broken mobile layout, not a graceful one, on those versions. A browser-support business call. | M6 |

---

## §7. M6 — scope, and how to plan it

**Spec §5's M6 bullet is the clause list:** dark-theme parity on every surface (`2d`) · responsive per design
(≥1200 / 1000–1200 / <900 / <640, migrating the 768/769 pair to 900) · `prefers-reduced-motion` (drop loops,
keep fades) · animation-budget audit (≤250ms ease-out) · i18n additions ru+en with `check:i18n` green ·
**delete the token alias block** · final visual QA side-by-side with `Redesign.dc.html` per screen.

In practice M6 is **that clause list plus the whole of §6b and §6c**, which is a lot — expect it to be the
largest milestone since M2. When planning it:

- Plan it the way M4 and M5 were planned: `superpowers:brainstorming` → `superpowers:writing-plans`, numbered
  binding decisions each stating **what it costs if wrong**, Global Constraints copied forward from §3 with the
  alias-deletion exception flipped on, then a grand review before execution.
- **The alias deletion is the audit** — sequence it late, and gate it on both greps coming up empty.
- **M6 is the milestone that reopens `primitives.css`**, so the accessible-name recipes, the dead
  `.channel-type-options` block and its wrong keyframe comment all land there together.
- **Colour work needs a new kind of probe.** Every probe on this branch asserts geometry; the dark-parity
  findings in §6c were derived from `tokens.css` and would not have been caught. M6 should build a
  computed-colour probe early and run it in both themes.
- Decide up front whether M6 also fixes §6f items 1–2, since both are one-liners once a human answers.

**After M6:** the branch is releasable as a single version. `superpowers:finishing-a-development-branch`
covers the integration decision. Rebase on `main` at that point (spec §8) — it has not moved since branch
creation, but re-check.

---

## §8. Process rules that earned their place

These are not ceremony. Each was bought with a defect that shipped or nearly shipped.

1. **The dominant defect class is not code — it is false claims about code.** M4 alone caught nine false
   comments and four false cost estimates. Every one shared a root cause: *asserting a fact from surrounding
   idiom instead of reading the declaration.* **Claims about facts-on-disk need a re-read; claims about
   behaviour need a counterfactual.** A re-read is not enough for the second kind — M4's ninth false comment
   was written by someone who had read the rule correctly and drawn a wrong conclusion from it.
2. **"X could not be measured because Y" must carry evidence for Y at the same standard as a claim that X
   passed.** That phrasing reads as rigour and thereby suppresses the question "is Y true?". In all four M4
   instances Y was false and a cheap measurement existed — twice using a stubbing pattern already present in
   the milestone's own harness.
3. **Check that a probe can fail before citing it.** Two nominal gates in M4, six false passes in M2.
4. **The whole-branch review seat is not a formality.** Three milestones running, it has found defects no
   per-task reviewer could see, because each was invisible in a diff: an *unchanged line* (the camera-off
   predicate), an *absence* across four media blocks (the missing touch exit), a *cascade interaction* between
   two rules changed in different tasks, and a one-attribute diff whose meaning lived in two sibling
   affordances the scoped reviewer never saw.
5. **Instruct implementers to push back, and mean it.** M4: five times an implementer caught an error in the
   plan or in a dispatch and said so rather than complying — including two controller rulings that were simply
   wrong and one dispatch that was self-contradictory. Three times an implementer produced a better solution
   than the prescribed one. **This was worth more than any single review.**
6. **Record every ruling in the ledger as it is made**, not only in the prompt that carries it. A reviewer
   reading only the on-disk record must never see invented authority.
7. **Residue accounting covers every probe an invocation runs**, not only the probe the task is about — and it
   is done **against the REST API, not the DOM**. Inferring from the DOM nearly produced a false "smoke server
   destroyed" conclusion in M4.
8. **Transcribe the closeout before the session ends.** The SDD workspace is gitignored and dies with the
   session; anything not written into `docs/superpowers/plans/*-closeout.md` is lost. This is also why a
   spend-limit kill mid-task is *not* a failed task — the ledger-plus-report-file contract made M4's one
   occurrence cost a single short resume.

---

## §9. Smoke-server state (so the next probe author is not surprised)

As of M4 close, verified against the REST API rather than the DOM: **1 server** («Redesign Smoke») · exactly
**2 pre-existing invites** · **1 sticker** (`t8seed68113`, dated 2026-08-26, M3-era) · **3 pre-M4 channels** ·
**18 probe messages** in `#general`. M4 created no servers, channels or stickers and left no live invites.
`last_channel_id` points at `general`.

**A single test account means three branches have been reasoned about rather than measured:** remote
participants, incoming calls, and not-own-message rendering. **A second test account would close all three** —
it is the single cheapest improvement available to this project's verification story.
