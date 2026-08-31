# vycord Frontend Redesign — RESUME HERE

**Written:** 2026-08-29 at the end of the M5 planning session; rewritten 2026-08-30 at M5.5 close;
**rewritten again 2026-08-31 at M6 close.**
**Purpose:** the single document that lets a cold session pick this work up. It carries the current stage, the
binding constraints, the measured debt register, and the exact prompt to run next. Every number in it was
re-measured on **2026-08-30 against `redesign` at `18322a8`** (M5.5's last code/docs commit) unless the line
says otherwise. Where a figure was measured earlier and not re-measured here, the line says when and by what.

**State: EVERY MILESTONE HAS SHIPPED. M0–M5, M5.5 and M6 are all closed. The branch is releasable as a
single version, and what remains is not work — it is the integration decision (§0).**

> **Corrections in the M5.5 rewrite.** M5.5 re-measured this file and found several load-bearing claims false:
> the branch's push state, the drift gate's target, the "only copy" harness claim, the icon size constraint,
> the alias census, the JS-injected custom-property family, and §7's closing rebase instruction.
>
> **Corrections in this M6 rewrite.** M6's plan Appendix A falsified eight more (C1–C8), and execution
> falsified further figures still. **Every one is corrected in place below, at the line that carried it** —
> `.setting-warning`'s mechanism (§6c), the `--danger` foreground count (§6c), the Escape-listener line
> numbers (§6c), the "~117 declarations" figure (§7.2), and `probe-composer.js`'s characterisation (§5). If
> you are diffing against an older version, **assume the old numbers are wrong rather than that the tree
> moved** — that has been true at every rewrite so far.
>
> **The single most repeated defect in this project's record is a number that was correct when measured and
> stale when shipped.** M6 hit it four times in one task. Cite by selector or by name wherever you can, and
> when you must cite a line, re-measure it **after your last edit**, not before.

---

## §0. START HERE — the next action

**THE REDESIGN IS DONE. There is no next milestone.** M6 shipped on 2026-08-31 at **`9bf7cd4`**;
its closeout is `docs/superpowers/plans/2026-08-30-redesign-m6-closeout.md` and is the document to
read before anything in this file.

**The only remaining action is a human decision: how to integrate.**

- **Merge `origin/develop` into `redesign`, then open a PR into `develop`.**
- **Do NOT rebase.** `redesign` is published at `origin/redesign` and its history is shared.
- The old instruction *"rebase on `main` at that point (spec §8)"* is **superseded by spec amendment
  §9.1**. `main` is dormant, not the trunk.
- **Run the drift gate first, with the fetch:**
  `git fetch --all --prune && git log --oneline redesign..origin/develop`. The fetch **is** the
  gate — see §1 for why a gate without it cannot fire.
- Use `superpowers:finishing-a-development-branch`.

**Do not start new work from this file.** Everything M6 declined lives in
`docs/superpowers/backlog/post-redesign-backlog.md`, and its §1 was excluded from every milestone by
ruling — that exclusion expires with the redesign, so those items are now ordinary backlog, not
forbidden ground.

### What M6 closed

The spec §8 audit, by deleting the thing it audits: **47 legacy aliases and all 66 references gone**,
stylelint **188 → 0**, and zero is now an *invariant* rather than a target — any output at all is a
regression you just introduced. Tests went 230 → **257**. Full trajectory, decisions, rulings and
corrections are in the closeout.

### The one thing to carry forward above all others

After M6 T14 — with **stylelint at 0, `tsc` at 0, 38 test files, ~140 probes and five certified gates
all green** — a human clicked through the app and found **six real defects. Not one was reachable by
any of those instruments.** One of them, the mobile server list rendering dark-on-dark in the light
theme, was invisible to every check *for a structural reason*: `--rail` and `--canvas` are both
near-black in the dark theme, so the surface looked correct there and any dark-only check passes it.

The lesson is not that the suite is bad. It is that **a suite verifies what it was pointed at, and a
person clicking finds what nobody thought to point it at.** Budget a human pass; it is cheaper than
another probe and it found more.

**Harness note.** The M6 workspace at `.superpowers/sdd/2026-08-30-redesign-m6-polish/tools/` is the
newest superset and is gitignored, so it is in no commit. It is **not** the only copy — see §5. If
you start post-redesign work, carry it forward with `cp -R` as every milestone has.

---

## §1. Current stage

| | |
|---|---|
| Branch | `redesign`, **published**. `origin/redesign` exists at **`2dc4974`** (M4's closeout) and is an **ancestor** of local `redesign`. **Never rebase this branch** — it merges from the trunk (spec amendment §9.1) |
| HEAD | **M6's last commit or later** — `9bf7cd4` was M6's final code commit, and this file's own rewrite plus a closeout commit sit on top of it. **Run `git log --oneline -1`; do not trust a SHA written here.** That instruction has been load-bearing at every rewrite |
| **Trunk** | **`develop`**, not `main`. `origin/develop` was at `a328a11` when M5.5 merged it and is now fully contained in `redesign` |
| **Drift gate** | **`git fetch --all --prune && git log redesign..origin/develop`** — the fetch is part of the gate, not a precondition someone may skip. Currently **empty** (re-verified 2026-08-30 after a real fetch) |
| `main` | **dormant.** `origin/main` is `d17bddd` and has not moved since the branch point; local `main` is `fbd6861`, three docs-only commits ahead of it (the redesign spec), and is an **ancestor of `redesign`**. So `git log redesign..main` is empty **by construction** and always was |
| Working tree | clean apart from the intentionally untracked `design_handoff_discord_redesign/` |
| Delivery model | one long-lived branch, milestone PRs, released as a single version — **no mixed-design releases** |

> **The old gate could not fire.** Five milestones ran `git log redesign..main` and recorded "empty" as
> evidence of no drift. `main` is an ancestor of `redesign`, so that range is empty regardless of what any
> remote does; and (reported at M5.5 T1, not re-verifiable now that a fetch has run) `.git/FETCH_HEAD` had
> never been written, so no remote state had ever been consulted at all. Meanwhile the trunk had taken six
> commits. **A gate whose output cannot change is not a gate** — the same rule §5 applies to probes.

| Milestone | State | Range |
|---|---|---|
| **M0** Foundation | shipped | — |
| **M1** App shell | shipped | closeout: `2026-08-25-redesign-m1-closeout.md` |
| **M2** Chat | shipped | 19 commits `f39e699..3ada3cc` |
| **M3** Calls | shipped | 8 commits `f07c7d1..a3cc52e` |
| **M4** Modals/menus/settings | shipped | 11 commits `41b93e8..08aa58f`; closed out at `2dc4974` |
| **M5** Command palette | shipped | 13 commits `f95e5a7..8aa1e75`; closeout `2026-08-25-redesign-m5-closeout.md` |
| **M5.5** Trunk integration + attachments restyle | **shipped** | `d559bad` plan · **`88d3287`** merge (parents `d559bad` + `a328a11`) · `4b6f3d5` T3 port · `b251fb8` T4 seams · `bab71ef` T5 restyle · `18322a8` T6 docs · then T7's rewrite of this file, and a closeout commit if one was made |
| **M6** Polish & closure | **shipped — the last milestone** | 16 commits `5de16ee..9bf7cd4`, 65 files, +3395/−699; closeout `2026-08-30-redesign-m6-closeout.md`. **Supersedes §7** |

**What M5.5 was.** `origin/develop` had taken six commits since the branch point — `cb6af4d` (VYC-80, WS
reconnect), `1aab040` (its merge), `28b8884` (VYC-81, picker close/focus), `36bed80` (its merge), `9239a83`
(VYC-82, file upload in chat), `a328a11` (VYC-83, message broker) — merge base `d17bddd`. M5.5 merged them,
ported the attachment wiring onto the redesign's component split, fixed the seams the two stacks created, and
restyled the six arriving components onto the design system. It implements **no** M6 clause, by design.

---

## §2. Document map — what to read and what supersedes what

**Precedence, highest first:** this file and the newest closeout → the two `CLAUDE.md` contracts → the spec
(including its §9 amendment) → older closeouts → older plans. A plan's text is *superseded* by its own
closeout wherever they disagree; four milestones running have found plan text that was factually wrong.

1. **`CLAUDE.md` (repo root) and `client/CLAUDE.md`** — the agent-facing design-system contract, written and
   committed at M5.5 T6 (`18322a8`). Tokens, class names, icons, primitives, overlays, motion, i18n, harness.
   Every claim in them was measured against the tree, and T6's report records five claims it found false in
   its own brief. **Read these before touching CSS.**
2. `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` — **the contract.** §5's milestone bullets
   are the clause lists each milestone must satisfy; §2 scope decisions, §3 current-state facts (incl. the
   server-side constraints), §4 architecture, §6 testing, §7 out of scope.
   **§9 is the 2026-08-30 amendment** and supersedes: §8's rebase-on-`main` instruction (9.1), §2/§7's reading
   for the six arriving attachment surfaces (9.2), the scope wall's meaning under a merge (9.3), and the
   raw-value audit gate's scope (9.4).
3. The **M5.5 closeout** (`docs/superpowers/plans/`, dated 2026-08-30) — the merge's eight conflict
   resolutions, the execution rulings, the residue forensics and the whole-branch review's findings.
   *Written by the controller from T7's closeout material; if it is not on disk, the material did not survive
   the session and this file plus the two `CLAUDE.md`s are the durable record.*
4. `docs/superpowers/plans/2026-08-25-redesign-m5-closeout.md` — the M5 rulings table, the harness truth, the
   corrected z-index census, the residue forensics, the whole-branch review's four seam findings, and the
   deferred-finding triage. **Supersedes all older text**, including several M4 facts it corrects.
5. `docs/superpowers/plans/2026-08-25-redesign-m4-closeout.md` — 24 rulings, deferred-finding triage, and the
   process notes on false comments and false cost estimates. **Two of its records are known wrong:** the
   "18 probe messages" residue figure (43 at its close, 45 today) and the `.screen-share-picker` class name.
6. `docs/superpowers/plans/2026-08-25-redesign-m3-closeout.md` — 21 rulings + harness corrections.
7. `docs/superpowers/plans/2026-08-25-redesign-m2-closeout.md` — 17 rulings + the stylelint baseline history
   and the cascade-order fact every later milestone leans on.
8. `docs/superpowers/plans/2026-08-25-redesign-m1-closeout.md` — M1's rulings; its four carried nits are still
   open (§6).
9. `docs/superpowers/backlog/post-redesign-backlog.md` — **excluded scope.** Nothing in its §1 may be planned
   or fixed by a redesign milestone. Its §2b (the stage accent) is **now answered** — see §7.
10. `docs/superpowers/plans/2026-08-25-redesign-m5-palette.md` — **executed; superseded by its closeout.** Its
    decision 10 (wrong z-index class name), its Task 6 step text, its residue baseline, its Task 7 Step 3
    probe citations, and every probe-only harness command it prints are all known-wrong. Read the closeout.
11. `docs/superpowers/plans/2026-08-30-redesign-m5.5-trunk-integration.md` — **executed; superseded by its
    closeout.** Its "no `AbortController`, timeout or `signal` anywhere in `services/api.ts`" line is
    literally true of those three identifiers and **materially misleading** (see §6d).
12. **Pixel truth:** `design_handoff_discord_redesign/README.md` (token tables + per-screen specs) and
    `Redesign.dc.html` (the board; open in a browser). Board option ids: `1c` main screen, `1d` modals/menus,
    `1e` call, `1f` mobile, `2a` empty states, `2b` unread/typing/avatars, `2c` ⌘K palette, `2d` dark theme,
    `2e` speaking indication. **This bundle is untracked on purpose — never `git add -A`.**

---

## §3. Global constraints (binding on every remaining milestone)

- Branch `redesign` only; **one commit per task**; never commit to `main`; **never `git add -A`**.
  **Never rebase `redesign`** — it is published (§1). Integrate trunk by merging `origin/develop`.
- **No changes under `server/`.** No API or WebSocket contract changes. **No changes to
  `client/src/services/`**; `client/src/types/index.ts` untouched; `client/e2e/` untouched.
  Per spec §9.3 this means **no redesign-authored changes**: trunk changes to those paths arriving via a merge
  are not violations.
- **Legacy token aliases in `src/styles/tokens.css` stay until M6.** Until then `tokens.css` changes are
  **additions only** — verify `+N / −0` at every milestone close, which is what proves the alias block is
  untouched. M6 deletes the block and therefore **retires this invariant** (§7 records its replacement).
- All work under `client/`. Product copy is Russian; every new string lands in `i18n/locales/ru.ts` **and**
  `en.ts` together. `npx tsc --noEmit` is the **real** parity gate (`en` is typed against `ru`'s `Dictionary`).
  Plurals render through `tp()`/`useTp()` — `t()` renders the literal key for a plural entry.
- **Icons — the constraint, restated truthfully (measured 2026-08-30).** The old wording,
  *"`lucide-react`, `strokeWidth={1.8}`, 16–21px, sizes outside the band must each be recorded"*, was **false
  and had been for five milestones**. There is no size band and there never was one in the tree. The three
  invariants that actually hold, verified by a brace-aware per-tag scan over **162 lucide tags in 35 files**:
  1. **`lucide-react` only** — every icon comes from it; there are **zero hand-inlined `<svg>` in `src/`**.
  2. **`strokeWidth={1.8}` on every icon** — 162/162, no exceptions.
  3. **An explicit `size={N}` on every icon** — 162/162; no icon relies on the default.

  The actual distribution is **13 distinct sizes from 10 to 28**: 10×6 · 12×11 · 13×1 · 14×13 · 15×20 ·
  16×67 · 17×19 · 18×9 · 19×1 · 20×8 · 21×1 · 22×3 · 28×3. **57 of the 162 sit outside 16–21**, spread over
  16 files. Size is a per-surface design decision; match the surrounding surface and do not "record a
  deviation". *(A naive `rg -o "strokeWidth=\{1\.8\}"` reports **163**, not 162: `Settings.tsx:67` renders
  `<tab.icon size={16} strokeWidth={1.8} />` from a variable, which a per-tag scan keyed on imported names
  does not see. Both figures are right about different things — do not "correct" one into the other.)*
- Class names: multi-segment kebab-case with a component prefix; state modifiers `is-*`/`has-*`; **never** BEM
  `--`/`__`. The single-segment allowlist is exactly `btn|input|kbd|modal|mention` (`.stylelintrc.json`).
- **Any class rename must sweep `.superpowers/sdd/<milestone>/tools/*.js`.** The harness is gitignored and
  ungated, so a rename that leaves a stale selector behind produces no error and no failing test — it just
  stops being able to fail. M5.5 hit this twice (§6e).
- New CSS uses media-query **range syntax** (`(width <= 768px)`) — `media-feature-range-notation` requires it.
  **This is now ruled, not open**: the syntax is kept, the 5 remaining legacy blocks migrate to it in M6, and
  iOS Safari <16.4 is an **accepted cost** (human ruling, 2026-08-30 M6 planning session — §7).
- Animation budget ≤250ms ease-out. Shared keyframes are `fade-in`, `scale-in`, `modal-in`, `slide-down` in
  `primitives.css`; all keyframe names in `client/src` are currently unique. Prefer reusing them to adding one.
- **Fail-first probes are mandatory.** Every probe is run against the pre-task state and must fail loudly there
  before its pass is trusted. Assert the precondition, never assume it.
- **Pair every negative precondition with a positive one wherever the state is achievable** — assert present →
  act → assert absent. A bare `!document.querySelector('.x')` goes permanently true the moment `.x` is renamed
  or deleted, and nothing tells you (§6e).
- **Before citing any probe, check that it can fail** (§5).

---

## §4. Environment and gates

### Gate state, measured 2026-08-30 at `18322a8` — **post-integration**

| Gate | Value | Rule |
|---|---|---|
| `npm run lint:css` total | **188** | never above **531**; it should only fall |
| Files individually 0 | all M5.5-, M5-, M4- and M3-owned | every file a milestone creates or rewrites must be 0 |
| `npm run check:i18n` | **ZERO warnings**, exit 0 | must stay at zero — M4 earned this |
| `npx tsc --noEmit` | clean, exit 0 | the real ru/en parity gate |
| `npm test` | **RED by design** — `Test Files 1 failed \| 35 passed (36)` · `Tests 3 failed \| 227 passed (230)` · 2 errors | RED **only** in `api.network-retry.test.ts`; see below |
| `git fetch --all --prune && git log redesign..origin/develop` | empty | re-check each milestone — **this replaces the old `..main` gate** |

**The 188 decomposes across 7 files** — the same seven as before the merge, with the same per-file counts:
`tokens.css` 118 · `ChannelSidebar.css` 23 · `UserList.css` 16 · `ServerList.css` 15 · `Auth.css` 10 ·
`AppPage.css` 4 · `TitleBar.css` 2. **These are M6's** — M6 takes them to 0 (§7).

**By rule** (measured with `stylelint -f json`, 2026-08-30): `selector-class-pattern` 43 ·
`alpha-value-notation` 36 · `color-function-alias-notation` 36 · `color-function-notation` 36 ·
`custom-property-empty-line-before` 11 · `no-descending-specificity` 8 · `color-hex-length` 5 ·
`media-feature-range-notation` 5 · `value-keyword-case` 3 · `comment-empty-line-before` 2 ·
`csstools/value-no-unknown-custom-properties` 2 · `no-duplicate-selectors` 1.

**`188 → 220 → 188` is not "nothing happened."** The merge took the total to **220**: the five CSS files
arriving from develop (`MediaLightbox.css` 11, `VideoPlayer.css` 9, `MessageAttachments.css` 6,
`AudioPlayer.css` 3, `AttachmentTray.css` 3) contributed all +32, and every redesign-authored file held its
baseline exactly. T5's restyle drove all five to **0**. The end-state distribution is byte-for-byte the
pre-merge one, which is the proof that the restyle finished rather than that the merge was inert.

**Pre-integration record (do not delete — M6 needs both ends).** At `8aa1e75` (M5 close), before the merge:
lint 188 across the same 7 files · `tsc` clean · i18n zero · `npm test`
`Test Files 1 failed | 25 passed (26)` · `Tests 3 failed | 178 passed (181)` · 2 errors.
Baseline history: 531 (M2 start) → 196 (M4 close) → 188 (M5 close) → 220 (merge) → **188** (M5.5 close).

> **How to measure a lint delta, and it is a rule, not a nicety.** M5's 196 → 188 was measured at **both
> ends** — the base tree was linted via **`git archive f95e5a7`** into a scratch checkout and run there, **not
> inferred by arithmetic** from the current number minus the files touched. M5.5 did the same across the
> merge, which is the only reason the +32 could be attributed to five specific arriving files rather than
> assumed. **M6 must do this for its own deltas**: it moves 188 → 0 across at least four tasks, and an
> arithmetic-only claim at any one of them is unfalsifiable.

**M5's own test files are 19 / 4 / 6** (re-verified 2026-08-30) — `utils/paletteFilter.test.ts` **19**,
`stores/__tests__/paletteStore.test.ts` **4**, `utils/searchSnippet.test.ts` **6**. (The M5 *plan* projected
**18 / 4 / 6** — `2026-08-25-redesign-m5-palette.md:503,604,1686`. Only `paletteFilter` moved, 18 → 19; the
other two landed exactly as projected. So the per-file claim held twice and the **totals** are what diverged:
28 projected against 29 measured. The earlier note here said "18/6/5 … only the total matched" — inherited
verbatim from the pre-M5.5 RESUME and wrong in both halves; corrected 2026-08-30. Carried because it is the
worked example of the rule above: a projected count is not a measured one — and a *carried* count is not one
either.)

**`npm test` is RED at baseline and always has been.** Three tests in
`src/services/__tests__/api.network-retry.test.ts` were merged without their implementation, plus 2 unhandled
rejections from the same file. **The +10 test files and +49 passing tests between M5 and M5.5 are develop's**,
arriving with the merge. **Never fix that file** (it is under the `services/` scope wall). The gate is: no
*other* file fails, new tests pass, and **a paste that says "same file" without the `FAIL` lines naming it is
not evidence.** Adding test files legitimately changes the counts — record the new shape when it happens and
compare forward against that.

### Running things

- **Stylelint must run from `client/`.** `importFrom` is cwd-relative; a repo-root run crashes with `ENOENT`,
  **which looks like output rather than a crash.** `--formatter json` writes to **stderr** — pipe with `2>&1`,
  never `2>/dev/null`.
- **JS-injected custom properties are invisible to `importFrom`** and every CSS reference to one must carry a
  fallback (`var(--slider-fill, 0%)`) or it adds a lint violation. **The family is FIVE, not seven**
  (re-measured 2026-08-30 — every member is set through a React inline `style` object; there is no
  `setProperty` call anywhere in `src/`):

  | property | injected at |
  |---|---|
  | `--speak-level` | `CallUI.tsx:200,221`; `CallStage.tsx:288,343,942,997` |
  | `--slider-fill` | `AudioSettings.tsx:162`; `AvatarCropModal.tsx:218` |
  | `--avatar-color` | `Avatar.tsx:32` |
  | `--meter-level` | `AudioSettings.tsx:235` |
  | `--call-stage-height` | `AppPage.tsx:643` |

  **`--presence-ring` is NOT in this family** — it is CSS-defined at `ChannelSidebar.css:271` and consumed at
  `primitives.css:330`. It was listed as JS-injected for four milestones and never was.
- **`--avatar-bg` / `--avatar-ink` are the mirror image, and are a different hazard.** They are **declared in
  CSS** (`UserList.css:106,107,111,112`) and **consumed in JS** (`Avatar.tsx:33,34`, as
  `var(--avatar-bg, var(--avatar-color))` / `var(--avatar-ink, #FFFFFF)` inside a `style` object). **No CSS
  file `var()`s either name.** So renaming either one breaks avatar colouring with **no lint error, no type
  error and no failing test** — the CSS side looks like a dead declaration and the JS side is a string.
  *(`UserList.css:111,112` are 2 of the 188: `csstools/value-no-unknown-custom-properties` fires on
  `var(--avatar-color)` because that name is JS-injected. Fixing it is a 2-line fallback that drops the total
  to 186 and falsifies the gate table above — M6-owned, do not do it in passing.)*
- **`--emoji-cols` is a dead reference** — read at `EmojiPicker.css:24` as
  `repeat(var(--emoji-cols, 8), 1fr)` and **never set anywhere**, in CSS or JS. Its fallback is what hides it
  from lint. Same species as the dead `55%` fallback at `AppPage.css:27` (`--call-stage-height` is set
  unconditionally at `AppPage.tsx:643`). Both read as guards that guard nothing.
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
  **But do not rely on it for a contested override**: M5.5 R6.1 found the lightbox scrim winning only because
  of `main.tsx`'s import order, and re-anchored it on specificity (`.modal-overlay.lightbox-root`, 0,2,0).
- **`main.tsx` imports the style layer before the component graph.** Do not reorder it.
- **Server-side, verified:** `SendToChannel` delivers `chat_message` only to clients whose `CurrentChannelID`
  matches, so **live unread/mention badges cannot be computed client-side**; channels have **no type**
  (VYC-77 / migration 017); message search is **per-channel only**; the client holds only the active server's
  channel list.
- **`getMessages` takes `limit` / `offset` only — there is NO `before` cursor** (`api.ts:524`). A `before=`
  parameter is **silently ignored** and the server re-reports page 1. **Default `limit` is 50**, so an
  unpaginated read of `#general` (83 messages) returns 50 *regardless of what happened to it*. Any residue
  figure taken with an unpaginated read is a saturated gauge, not a measurement (§9).

---

## §5. Verification harness — the truth table

The harness lives at `.superpowers/sdd/<milestone>/tools/` and is **gitignored**. **It is NOT the only copy** —
every SDD workspace since M1 still carries one, and they were never deleted:

| workspace | `tools/` size | entries |
|---|---|---|
| M1 app-shell | 2.4M | 40 |
| M2 chat | — | 171 |
| M3 calls | — | 306 |
| M4 modals | — | 439 |
| M5 palette | 33M | 462 |
| **M5.5 trunk-integration** | **33M** | **475** ← newest superset; `cp -R` from this one |

Each milestone carries it forward with `cp -R` in Task 1. Losing all of them would cost every visual claim its
instrument; losing one costs nothing. **Do not delete a workspace at close** (M5 R28, D16).

**These corrections override older plan text. They were each learned the hard way.**

- **`--out` is MANDATORY, not merely the screenshot flag.** `smoke.mjs` hard-exits **2** without one, so every
  probe-only command printed in the M2–M5 plans (`node smoke.mjs --probe X --wait 4000`) is **invalid as
  written**. Supply a throwaway `--out` path when you do not want the image. *(New in M5.)*
- **Each invocation creates a fresh `mkdtemp` Chrome profile and deletes it in `finally`** (`smoke.mjs:422`),
  so **`localStorage` cannot leak between probe runs**. **Server-side state can and does** — `last_channel_id`,
  channels, messages, invites, stickers, **and now uploaded attachments**. Assert server preconditions; you may
  ignore browser-storage ones.
- **The app opens on the smoke user's persisted `last_channel_id`, not `#general`.** Navigate explicitly.
- **To assert that a token is actually consumed by a rule, use a SCRATCH ELEMENT** — create one, set
  `background: var(--X)`, append it so it computes, read the **computed** value, compare, remove.
  **Never `getComputedStyle(documentElement).getPropertyValue('--X')`**: that returns the *declared* value
  regardless of whether any rule consumes it, and returns hex against an `rgb()`, so the comparison is
  always-true. *(The working form for M6's computed-colour probe.)*
- **`mark` carries UA-origin declarations for BOTH `color` and `background-color`** — measured as
  `rgb(0,0,0)` on `rgb(255,255,0)` in **both** light and `color-scheme: dark` (Chrome 150). So a
  "background is transparent" check on a `mark` can never fire, and a "colour differs from surrounding text"
  check passes even when the declaration is deleted.
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

**Probes that cannot be trusted** (check before citing, always).

| Probe | `fail(` | Status |
|---|---|---|
| `probe-shell.js` | **0** | **Pure reporter — asserts nothing.** The M5 plan cited it as a regression gate and was wrong. M6 gives it real gates (§7 ruling 1) |
| `probe-sidebar.js` | **0** | **Pure reporter — asserts nothing.** Same; same fix |
| `probe-callstate.js` | 0 | inert, **banned as evidence** |
| `probe-confirm-modal.js` | 0 | stale M2 residue, dead selectors |
| **`probe-lightbox-escape.js`** | **0** | **Pure reporter — asserts nothing.** Its own line 1 says *"M5.5 T3 diagnostic (round 3)"*: it registers a capture and a bubble listener, dispatches Escape and **returns a counter object**. It did its job — it is what localised the Escape swallow — but it is a diagnostic, not a gate. **The gate for that fix is `probe-attach-escape.js` (17 `fail()`).** *(New in M5.5.)* |
| `probe-t5fix-handoff-focus.js` | — | `:35` is `… \|\| true`, a field that cannot fail |
| `probe-t11-flow.js` | — | `toastPresent` queries `.chat-error-toast`, deleted in favour of the shared `.error-toast` — permanently false |
| **`probe-composer.js`** | ~90 `check()` | **REPAIRED by M6 T1 — see the corrected note below.** *(New in M5.5.)* |
| `probe-modal-sweep.js` | **136** | real gate, 6 phases; **cleans up the invite it creates** |
| `probe-chat.js` | **35** | real gate — **but see the residue warning below**, and its continuation-row assertions no-op on an empty list, so cite `continuation.count` as proof the block ran |
| `probe-palette-*.js` (5 files) | 17–24 each | M5's, all real gates |
| `probe-attachments.js` **39** · `probe-attachments-send.js` **26** · `probe-attach-escape.js` **17** · `probe-overlay-contract.js` **9** / `…2.js` **11** / `…3.js` **15** / `…4.js` **11** | as listed | M5.5's, all real gates — every assertion routed through a throwing `fail()`. **Counts re-derived 2026-08-30; `probe-lightbox-escape.js` is NOT in this set** (see above) |

> **`probe-composer.js` — CORRECTED (M6 plan Appendix A C6), then REPAIRED (M6 T1).** The defect was real
> and the diagnosis was right: the file called `document.querySelector('.link-dialog-submit').click()`, a
> class introduced pre-redesign by `3621256` and **deleted by M4's `ea7b52c` (2026-08-28)**, which moved the
> link dialog onto the `btn` roles. It was a raw `querySelector`, not the file's null-tolerant `q()` helper,
> so it threw `TypeError` on null.
>
> **Two things this file previously said about it were wrong, and both mattered:**
>
> 1. **"Silently dead" — it was not silent.** The file uses **deferred flush**, not a throwing `fail()`. The
>    throw was swallowed by `smoke.mjs` into a **`PROBE ERROR:` string**, which is loud. What made it
>    dangerous was not silence but that a reader had to *notice* the error line among the output.
> 2. **"48 of 88 assertions have never executed" understates it in one direction and overstates it in
>    another.** Counted by occurrence at `dc0a873`: **41 above `:193`, 48 at or below, 89 total** (`:17` is
>    the definition, `check = (`, and contains no `check(`). The 41 above **did execute** — but with deferred
>    flush they **died with `out`**, so the true figure is **0 of 89 producing a readable verdict**, not 48
>    of 88.
>
> **M6 T1 repaired it**: `:219` now reads `q('.link-dialog .modal-actions .btn.btn-primary').click()`, through
> the null-tolerant helper. The file currently carries ~90 lines with `check(` — 41 above `:193`, 49 at or
> below. It is the same species as the `.lightbox` rename in §6e — a class rename disarming an ungated
> harness — and the general rule stands: **a probe is evidence only once it has been shown to fail against the
> broken version of the code it is meant to catch.**

> **`probe-chat.js` WRITES TWO MESSAGES TO THE PRODUCTION SMOKE SERVER PER RUN AND NEVER CLEANS UP** — it
> accounts for 4 of M5.5's 6 probe-written messages and the great bulk of `#general`'s noise. Point it at a
> disposable channel or give it a cleanup pass before running it casually.

**Two nominal gates in M4 turned out not to be gates**, on top of M2's six false-passing probes and M5.5's
dead `probe-composer.js`. The standing rule: *a probe is evidence only once it has been shown to fail against
the broken version of the code it is meant to catch.*

---

## §6. Debt register

Consolidated from the M1–M5.5 closeouts and the backlog. **Items marked (measured 08-30) were re-verified
against the tree on 2026-08-30;** the rest are carried as recorded and are flagged as such.

### 6a. Discharged — no action needed

**By M5:** `MessageSearch.css` 8 → 0 and off the legacy aliases ✔ · the four hand-inlined SVGs in
`MessageSearch.tsx` ✔ · board `2a`'s two-line empty state ✔ · the header ⌘K chip question ✔ · the
`Ctrl+Shift+F` document listener becoming overlay-aware ✔.

**By M5.5:** the six arriving attachment components restyled onto canonical tokens and lucide, all five new CSS
files 188→0 ✔ · `MediaLightbox` brought inside the overlay contract (`.modal-overlay.lightbox-root`, adopting
`useModalFocus`) ✔ · the four-path picker-toggle opt-out ✔ · **the trunk's app-wide Escape swallower fixed**
(§6e) ✔ · the `.lightbox` → `.lightbox-root` single-segment rename ✔.

### 6b. Owned by M6 — the alias sweep — **DISCHARGED 2026-08-31 at `c936baf`**

> **This whole subsection is closed.** All **47** alias names are deleted and all **66** references
> migrated across 6 files (the figure below says 70; **it is 66** — measured, not predicted). Stylelint
> reached **0** and *is the proof*: `csstools/value-no-unknown-custom-properties` sees only `tokens.css`
> and `base.css`, so once the alias layer is gone, any surviving `var()` naming a deleted alias is a
> parse-based error. **Passing at zero is the audit.**
>
> Kept below for provenance and for the mechanism, not as open work. Two cautions survive the discharge:
> **a `var(--x, fallback)` silences that rule**, so never add a fallback you were not told to add; and
> **the harness is not covered by it** — the audit gate is sufficient over `src/`, not over
> `.superpowers/`, which is why T13 needed a separate harness sweep.

**Measured alias inventory (08-30), `var()` references per file, comments excluded.** The alias block declares
**47 names** at `tokens.css:178–230`, inside the `:root, [data-theme="dark"]` rule that spans **`:177–231`**;
the **3 dark overrides** are a second rule at **`:235–239`**. 47 + 3 = **50 declarations**, which is the figure
the `+N / −0` invariant protects. *(Cite `:178–230` for the names. The M5-close file said `:163–225` and an
earlier M5.5 draft said `:177–229`; both under-count, the latter by exactly one — `--radius-full` sits on
`:230`.)*

| File | Alias refs | Note |
|---|---|---|
| `styles/tokens.css` | (50 declarations) | **this is the alias block itself — deleting it is the milestone task** |
| `pages/Auth.css` | **30** | never touched by the redesign; the largest remaining consumer; also carries 3 of the 4 raw-colour sites |
| `components/ServerList.css` | **19** | |
| `pages/AppPage.css` | **7** | |
| `components/UserList.css` | **7** | |
| `components/ChannelSidebar.css` | **5** | includes `.no-server-message`'s `--text-muted` (the M1 item) |
| `components/settings/ProfileSettings.css` | **2** | **M4-rewritten and still on aliases** |
| **TOTAL** | **70 across 6 files** | **all fallback-free** — no reference uses `var(--x, fallback)`, which matters for the audit (§7) |

> **Three files previously on this list are at ZERO and must not be re-inherited as offenders:**
> `styles/primitives.css` (listed as 6), `components/LinkDialog.css` (listed as 2), and
> `components/MessageSearch.css` (37, taken off by M5). Also `ErrorBoundary.css` and `UpdateBanner.css`.
>
> **The old totals were wrong by the comment trap.** M5's file said 71 across 6 files with `ChannelSidebar` at
> 6 and `ProfileSettings` at 7; M5.5 T1 reproduced 71 with the same naive grep. The real figure is **70**:
> `ChannelSidebar.css:138` is `border-radius: 999px; /* не var(--radius-full): … */` — a **comment**. A
> `var(--name` grep that does not strip `/* … */` counts prose. This is §8.1's trap, and it has now produced a
> wrong census three separate times. **Strip comments before counting.**
>
> Also inherited and still true: **no `--danger-color` token exists anywhere in the tree**.

**The alias deletion doubles as the audit** (spec §8, as amended by §9.4). §7 records M6's instrument decision:
the gate is **stylelint**, not `rg`.

### 6c. Owned by M6 — everything else — **DISCHARGED 2026-08-31, with the exceptions named inline**

> **M6 executed this subsection.** Each item below now carries its outcome where the outcome differs from
> what was planned — read the inline **CORRECTED** and **RESOLVED** notes, because in three cases the fix
> that shipped is *not* the fix this section proposed, and in one case (`--danger`) the right answer was
> to **decline** the planned change and record the declining as a decision.
>
> What did **not** discharge is listed in §7 of the closeout, `2026-08-30-redesign-m6-closeout.md`:
> everything that could only be reasoned rather than measured in this environment. That list is now
> **narrower** than the one this file used to carry — two of its entries were overstated.

**Dark-theme parity**
- **`--danger` has no dark value** (measured 08-29: `tokens.css` defines `--danger` only in `:root`, while its
  siblings `--danger-soft`/`--danger-text` and all three `--online-*` do have dark overrides).
  **CORRECTED (Appendix A C3): "the tree's only two uses of it as a foreground" was false — there are 8
  `color: var(--danger)` sites and 22 CSS consumers in total.** Three sit on stage ground and collided with
  the stage-accent ruling; a fourth, `.stage-tip.is-poor`, only *looks* like one, because `.stage-tip` sets
  `background: var(--canvas)` and is theme-adaptive.
  **RESOLVED by M6 T3, and the resolution was to decline the planned fix.** The plan's dark
  `--danger: #FCA5A5` was **not applied**: measured, it puts white on a pastel fill at **1.90:1** across 11
  fill sites. `--danger` breaks down as **11 fill / 3 border / 3 foreground**, and an override tuned for the
  foreground minority wrecks the fill majority. The absence is recorded as a decision, not an oversight.
- **`.setting-warning`'s amber-on-near-white is ~2.01:1** (AA needs 4.5:1); inherited (~2.09:1 at base).
  **CORRECTED (Appendix A C2): the recorded ratio was right and its MECHANISM was wrong.** The rule
  **never references `--yellow-50`**, and **`--canvas-2` DOES have a dark override**. Measured: light
  **2.01:1**, dark **8.16:1** — so the defect is **light-only** and the remedy inverts from what this file
  used to imply. **Fixed in M6 T3** by moving only the foreground to `--warning-text` (4.69:1 on light) and
  leaving the amber border alone, a 1px border not being text. `--warning-text` then needed a dark override
  of its own — back to the amber, 8.16:1 — which the plan had said would not be required, and which stopped
  being true the moment a `color` started reading it in both themes.
  This surface carries the NC-unsupported and mic-permission messages.
- **The call stage's accent — RULED, no longer open.** It is **theme-invariant**, pinned to the dark value
  `#6366F1` via a new `--stage-accent` on `:root` only; the **10** `--accent`/`--accent-hover` sites on the
  stage switch to it. *(Human ruling, 2026-08-30 M6 planning session — §7 ruling 2. Closes §6f #3 and backlog
  §2b.)* **The site count is 10, not the 12 this file carried since M3 close** (measured 08-30, comments
  stripped): **all 10 are in `CallStage.css`** — `var(--accent)` at `:352, :419, :595, :654, :713, :835,
  :903, :962, :1008` and `var(--accent-hover)` at `:604`. **`CallUI.css` and `AppPage.css` contain neither.**
  The inherited 12 was never true and was carried verbatim across three RESUME revisions without
  re-measurement; note that `--stage-` appears exactly 12 times in `tokens.css`, which is a plausible origin
  for the confusion and is a different quantity. Backlog §2b still says 12 — **it is wrong; this line
  supersedes it.**
- **`--hl-bg`/`--hl-ink` need work at BOTH ends.** Their **dark** values are interpolations, not board values —
  the board gives no dark highlight pair. And **`--hl-ink` is byte-identical to `--ink` in LIGHT theme** (both
  `#101322`, `tokens.css:16` vs `:45`), so `mark { color: var(--hl-ink) }` is **inert in light** and reads as an
  intentional value when it is not one.
- Colour findings across the branch are **derived from `tokens.css`, not measured in a browser** — every probe
  to date asserts geometry, so "both themes PASS" would not have caught any of these. §7's instrument decision
  is the fix.

**Responsive** — the spec's target: ≥1200px four columns · 1000–1200px member list hidden behind the header
toggle · <900px sidebar drawer · <640px mobile. **Both sides of the current 768/769px pair migrate to the
900px boundary.** The range-syntax / iOS-Safari-<16.4 question that migration used to raise is **ruled** (§3,
§7 ruling 3): range syntax is kept and the 5 remaining legacy blocks migrate to it. Known responsive defects to
fold in: `.p2p-modal`'s hard `width: 340px`; the top-bar title truncating to `#g…` at 390–420px;
`@media (hover: none)` having no width bound, so a touch-capable *wide* screen gets the always-visible message
action row; `.msg-action-btn` at 28×28 against the board's ≥40px touch floor (clears WCAG 2.5.8's 24px, so it
is a shortfall, not a violation).

**Accessibility**
- **The accessible-name gap is real: on the Settings panes, 4 toggles, 2 range sliders and 5 selects carry no
  accessible name, and the level meter has no `role="progressbar"`.** *(The old wording — "fix at the recipe in
  `primitives.css` — one change, not eleven call sites" — is **false**, verified 08-30: `primitives.css` is a
  stylesheet, ARIA is not CSS, and the file has no JSX counterpart. There is no recipe layer to fix it at.)*
  **Ruled**: ~13 call-site `aria-label`s reusing existing i18n keys, plus `role="progressbar"` on the level
  meter — not a new JSX primitives layer (§7 ruling 4).
- The chat column has **no `h1` at all** (`<h2>` where the old quiet-channel state used `<h1>`).
- **The palette's ARIA tree is not a conforming listbox** — `role="option"` sits inside unroled `.palette-group`
  divs, and `aria-expanded` is computed from selectable rows while status rows render. Keyboard nav works; the
  semantics are approximate. Lands with M6's accessible-name work.

**Motion** — `prefers-reduced-motion`. There are exactly **four** `infinite` declarations in the tree
(measured 08-30): `message-search-spin` 0.7s (`MessageSearch.css:175`), `stage-eq-bar` 0.7s
(`CallStage.css:304`), `chat-shimmer` 1.2s (`ChatArea.css:220`), `p2p-pulse` 2.5s (`CallUI.css:43`).
**`p2p-pulse` IS the incoming-call pulse** — it animates `.p2p-modal-tile`, the P2P call modal's avatar tile.
The older "five loops" list double-counted it. Also: the ≤250ms ease-out budget audit.

> **`base.css:85`'s blanket reduce block already kills fades**, with
> `animation-duration: 0.01ms !important` + `animation-iteration-count: 1 !important` +
> `transition-duration: 0.01ms !important` on `*, *::before, *::after`. So M6's reduced-motion clause
> **loosens a hammer into a policy** — strictly riskier than adding coverage, because the failure mode is
> *motion returning* rather than *motion not being suppressed*. Its probe must assert **both** halves: loops
> stopped **and** a named entrance still animating opacity.

**Dead code and cosmetics** (each recorded by the milestone that found it)
- **`primitives.css`'s `.channel-type-options` block — `:442–499`, no TSX emitter** (re-verified 08-30;
  orphaned by commit `4674032` *before* M4 began). **Consequence beyond dead weight:** the keyframe-consumer
  comment at **`:355`** lists `modal-in`'s live consumers as "`.modal` and the radio `::after`", and that
  `::after` is *inside the dead block* — correct the comment in the same change.
- **`.panel-icon-btn.is-off` has no `:hover`.** `.panel-icon-btn:hover` (0,1,0) sets colour only and loses to
  `.is-off` (0,2,0), so an off button visibly does nothing on hover. M1 item, still open.
- **`AppPage.tsx:610` renders `▶`/`◀` as glyph-icons** (re-measured 08-30 — the old `:603` is stale) —
  explicitly excluded by M1's own plan.
- **`.chat-members-btn` is inert above 768px** (measured 08-30). `AppPage.tsx:659` **always** passes
  `onShowMembers`, which sets `mobilePanel`; every `data-mobile-panel` rule (`AppPage.css:117–141`) lives
  inside **`@media (max-width: 768px)` at `AppPage.css:102`** — quoted in its **actual legacy form**, because
  it is literally one of the 5 blocks §7 ruling 3 schedules for migration to range syntax. *(The button's own
  sizing rule is in a different block, `ChatArea.css:349`, which is already `@media (width <= 768px)`. So the
  two halves of this defect sit in blocks written in two different notations.)* Above 768px the click does
  nothing visible. **Migrating the breakpoint alone *widens* the dead range to 900px.** It is the natural home
  for the spec's 1000–1200px member-list toggle.
- **`.update-banner-dismiss` loses its own override on hover** — (0,1,0) against `.btn-ghost:hover`'s (0,2,0),
  which wins regardless of source order, so the button reverts to exactly the state its comment says the
  override prevents.
- **`.invites-code` carries `overflow`/`text-overflow`/`white-space` that can never fire** — M4 recorded the
  cause as a wrapper that lost `flex: 1; min-width: 0`. **Re-derive the wrapper selector before fixing; the
  class name in the M4 note does not exist in the file today.**
- `msg-mention-role` is emitted with no matching CSS rule (pre-existing since before M2).
- `msg-jump-flash` animates background to `transparent`, stripping an own-message row's tint for 2.2s.
- The two dead fallbacks: `--emoji-cols` at `EmojiPicker.css:24` and `55%` at `AppPage.css:27` (§4).
- `.stage-focus-label` hard-clips with no ellipsis; `.stage-plate`/`.stage-state-chip` overlap by 8px on a
  265px tile; the share badge/focus button overlap at 641–768px (**never measured by anyone**);
  `.stage-tip-arrow` no longer points at its chip when the tooltip is clamped; `.stage-focus-ctrl-btn` is
  36×36 against decision 22's 40px floor; a screen-share error toast is invisible during focus fullscreen.
- **~~A grouped icon-size deviation record exists and must be carried, not re-litigated.~~ VOID.** That item
  existed only because §3 claimed a 16–21px band. **There is no band** (§3, measured 08-30: 13 sizes, 10→28,
  57 of 162 tags outside it). The ≥22px cohort, M3's `size={10}`×6 / `12`×10 / `14`×3, and the `.fmt-btn`
  `size={15}` item are **not deviations and need no record**. Do not re-file them.
- **Two weak tests whose names overstate them:** `messageStore.test.ts`'s "can set and clear deliveryState"
  never asserts the clear case; `unreadStore.test.ts`'s "survives a corrupt payload" is vacuous twice over (it
  never reaches `load()`'s catch, which runs at module import before any `beforeEach`). ~4 lines each.
- **`useModalFocus.ts:96–98`'s docstring is HALF stale — fix only the half that is.** Re-measured 08-30:
  **13 `.modal-overlay` renderers · 5 `useModalFocus` adopters · 8 others.** The docstring says the stack
  knows «ровно ConfirmModal, FindServerModal, Settings и CommandPalette» (now **five** — T4 added
  `MediaLightbox`, which is both a renderer and an adopter) «остальные **восемь** модалок» (**still exactly
  8** — the renderer count and the adopter count rose together). **Fix «четыре» → «пять» and leave «восемь»
  alone.** A review during M5.5 proposed "5 and nine"; nine is wrong, and acting on it would have injected a
  *new* false claim while fixing a stale one.
- **`isBlockingOverlayOpen()`'s DOM half is load-bearing** until M6 finishes app-wide `useModalFocus`
  adoption — it holds only while *every* modal renders `.modal-overlay` (true today across all 13 renderers).
  The five non-stack-aware document Escape listeners are M6's if it takes that adoption.
  **CORRECTED (Appendix A C8): all five line numbers this file carried were stale.** They were recorded as
  `ContextMenu.tsx:35`, `VolumeControlPopover.tsx:57`, `ScreenSharePicker.tsx:24`/`:88`,
  `useFloatingSelectionToolbar.ts:67`; **measured, they are `:38`, `:61`, `:26`/`:90`, `:77`.** Anchor by
  symbol, not by line — M6 T11 found that two "stale" Escape citations in a dispatch were in fact **two
  different anchors** (a key check and an `addEventListener`) and both correct, so a line-number mismatch is
  not by itself proof of staleness. **`useDismissOnOutside` is now stack-aware** (M5.5 T4) and is not on that
  list.
- **`isBlockingOverlayOpen()`'s invariant is a convention, not a contract**, and it was already broken once:
  `.screen-picker-backdrop` is a fixed-inset blocking scrim carrying neither `.modal-overlay` nor
  `useModalFocus`. M5's fix wave widened the selector, but **any future backdrop that rolls its own class
  reopens the hole silently.** M6's `useModalFocus` sweep should either make adoption the only source of truth
  (deleting the DOM half) or add a check that every such scrim carries `.modal-overlay`.
- **The z-index census, re-measured 2026-08-30 at `18322a8`. TWELVE declarations at ≥1000 across SEVEN
  distinct values, with 1000 appearing three times:**
  `.modal-overlay` 1000 (`primitives.css:342`) · `CallUI.css:11` 1000 · `FloatingQuoteButton.css:6` 1000 ·
  `.context-menu` 1050 (`primitives.css:637`) · **`.screen-picker-backdrop`** 1100 (`ScreenSharePicker.css:5`) ·
  `.volume-popover` 1100 (`VolumeControlPopover.css:14`) · `.palette-overlay` 1150 (`CommandPalette.css:15`) ·
  `.stage-tip` 1200 (`CallStage.css:477`) · `CallNotifBanner.css:15` 2000 · `.error-toast` 2000
  (`primitives.css:729`) · `ErrorBoundary.css:12` 9999 · `UpdateBanner.css:19` 9999.
  **`MediaLightbox.css` declares no `z-index`** — it inherits 1000 from the primitive, which is T4's D8
  contract. *(It was 13 declarations / 1000×4 between the merge and T4's deletion of the lightbox's own
  `z-index`. **Do not write "the census is now 13".** This census's summary counts drifted wrong five separate
  times during M5 while its entry table stayed right; `.screen-share-picker` DOES NOT EXIST and never did.)*
  M6 should decide whether these want a named token scale.
- **The call stage's fullscreen has TWO dead ends, not one.** (a) the CSS variant — `AppPage.css:67-72` sets
  `display: none` on `.chat-area`, so a palette chat command lands hidden. (b) **the Fullscreen-API variant,
  which is worse:** `CallStage.tsx:75-78` promotes `.call-stage` to the **top layer**, and the palette mounts
  as a sibling of `.app-layout`, so it **paints behind the backdrop — invisible** — while still mounting,
  trapping focus and flipping `isBlockingOverlayOpen()` true (which then blocks ⌘K from reopening it and kills
  Ctrl+Shift+F). **The codebase already solves this elsewhere**: `CallStage.tsx:106-110` re-parents the quality
  tooltip into `document.fullscreenElement` on hover. Generalise it — portal the palette into
  `document.fullscreenElement ?? document.body`, recomputing on `fullscreenchange`.
- **`Ctrl+K` is `preventDefault`ed before the gate, unconditionally** (`usePaletteHotkey.ts:16-17`), so it is
  swallowed in every text field app-wide — including the composer, where on macOS it is "kill to end of line".
  Largely inherent to the chord choice; M6 should rule deliberately.
- **A test-coverage gap parked from M5's fix wave:** `selectedIndexOf(rows, selectedId)` and
  `shouldShowEmptyState(model, query)` are natural pure extractions into `paletteFilter.ts`. Also,
  `paletteFilter.test.ts:117-129` **asserts a universal its own module does not satisfy** for status-bearing
  groups — it passes only because the fixture never builds one, and a one-word change
  (`messagesLoading: true`) turns it RED today.
- **New from M5.5: `ChatArea` re-renders on every upload progress tick.** `ChatArea.tsx:90` calls
  `useAttachmentUpload(channel?.id)`, which subscribes to the `drafts` slice (`useAttachmentUpload.ts:25`),
  but `ChatArea` uses **only** `uploads.addFiles` (one call site, `:113`). Accepted as the alternative to
  prop-drilling a second hook through the tree; **backlog-only**, but worth doing eventually because
  `ChatArea` is the heaviest tree in the app. A selector-scoped `addFiles`-only hook is the shape.
- **New from M5.5: `composer-attach-btn` has no CSS rule anywhere.** It is an identity hook for the harness,
  not a style hook. Do not "fix" it by adding a rule; do not delete it either.

**Corrections M6 must not re-inherit wrong**
- **`no-descending-specificity` is context-dependent, not false.** M2 and M3 each disproved a copied instance
  (the rule buckets by at-rule context, so a top-level `:hover` and a rule inside `@media` are never compared),
  but M4 tested a third instance and it **fired**, as did M5.5's single instance. Test the counterfactual with
  a positive control; never copy the justification.
- **`rg -nw 'search-empty'` still matches `message-search-empty`**, because `-` is a non-word character. The
  working form is `(?<![a-zA-Z0-9_-])name(?![a-zA-Z0-9_-])` (needs `rg -P`). **Match class tokens, not
  substrings** — that trap fired three times across M3 and M4.
- **Strip `/* … */` before counting anything in CSS.** The alias census was wrong three times because a grep
  counted a comment (§6b).

### 6d. Post-redesign backlog — **the exclusion has now expired**

> **This exclusion was scoped to the redesign milestones, and the redesign is finished.** It was never a
> judgement that these items don't matter — it was a scope fence: they need a `services/`- or
> store-architecture grant the spec withheld. With M6 shipped there is no milestone left for them to be
> excluded from, so **they are ordinary backlog now**, to be prioritised on their merits. The sentence
> below is kept because it still describes why they were fenced off, not because the fence still stands.

These need a `services/`- or store-architecture scope grant that the spec forbids. **Do not fix them inside a
redesign milestone**; if you touch their neighbourhood, record the contact and move on. Full detail lives in
`docs/superpowers/backlog/post-redesign-backlog.md`.

- **Board `1e`'s camera-off tile treatment never renders for a connected peer** (backlog §1a). Two shipped
  board deliverables are dead for everyone but yourself.
- **Lost draft on a failed send** (§1b) — silent user data loss.
- **A rejected fetch for the still-current channel paints the previous channel's messages** (§1c,
  `AppPage.tsx`). M5's palette became a new caller of `handleSelectChannel` and therefore inherits this.
- **A POST that succeeds after a channel switch no-ops its `replaceMessage`** (§1d).
- **A send failure has nowhere to surface if the channel becomes null** (§1e).
- **`services/api.ts` has no request timeout and no cancellable `request()`/`requestForm()`** (§1f, added by
  M5.5) — which is why **a stalled avatar upload is a complete trap**: all three exits of `AvatarCropModal`
  are inert while `saving`, the modal does not adopt `useModalFocus` so there is no Escape either, and
  `uploadAvatar` goes through the fetch-based `requestForm`, which takes no `signal`.
  **Do NOT extend this to attachment upload** — `uploadAttachment` uses `XMLHttpRequest`, returns
  `{ promise, abort }`, and its `abort()` is wired through `attachmentStore`'s `draft.abort` into
  `useAttachmentUpload.cancel`. That path works. See backlog §1f for the measured detail.
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

**The harness is gitignored AND ungated.** No test, no lint rule and no CI step reads `tools/`. That makes it
the one place on this branch where a change can be silently wrong forever. Two mechanisms, both found in M5.5:

1. **A class rename disarms a probe with no signal.** T5's `.lightbox` → `.lightbox-root` rename had to
   re-point **17 selector sites across 4 probe files**, and **two of them were *negative* preconditions that
   would have gone permanently true** — e.g. `probe-attach-escape.js:50`'s
   `out.lightboxClosedByEscape = !document.querySelector('.lightbox')`. No error, no failing test; the probe
   simply stops being able to fail. Three other sites used `?? fail(…)` and would have failed loudly — that
   asymmetry is the whole lesson. **Two standing rules follow, both now in §3:** any class rename must sweep
   `tools/*.js`; and **pair every negative precondition with a positive one wherever the state is
   achievable.**
2. **`probe-composer.js:193` — the dead gate.** See §5. **48 of its 88 assertions have never executed** since
   M4's `ea7b52c`. **Highest-priority harness repair on the branch.**

Repair or delete before anything cites them: **`probe-composer.js:193`** · **`probe-chat.js`'s uncleaned
2-messages-per-run residue** and its no-op-on-empty continuation assertions · **`probe-shell.js` and
`probe-sidebar.js`, which have ZERO assertions yet were cited as regression gates** (M6 ruling 1 gives them
real gates) · `probe-t5fix-handoff-focus.js:35`'s `|| true` · `probe-confirm-modal.js`,
`probe-callstate.js` **and `probe-lightbox-escape.js`** (zero `throw`s — delete, or rename to
`diag-*` so they are never mistaken for gates; the last one is M5.5's and its diagnostic value is
spent now that `probe-attach-escape.js` guards the same fix) ·
`probe-t11-flow.js:51`'s permanently-false `toastPresent` · **`probe-palette-board.js:261-266`'s
`heightMatchesOneRow`, which is an identity that cannot fail** · `probe-palette-actions.js:84`'s restore
click, the one call not routed through `fail()` · `probe-primitives-toggle.js`'s three recorded minors are
**moot** (the collision it measured was retired by M4 T7) — close them.

### 6f. Awaiting a human — decisions nobody should make unilaterally

*(Entries 3 and 9 were here and are now **RULED** — moved to §7 with their provenance. Do not re-open them,
and do not read their answers as anyone's unilateral call.)*

| # | Question | Owner once decided |
|---|---|---|
| 1 | **The header search button keeps opening the deep panel, so board `1c`'s dark-theme ⌘K chip is NOT shipped on it** (M5 decision 7). A `⌘K` chip on a control that does not open the ⌘K palette would be a false label. If you want that button to become the palette entry instead, it is a two-line change. | M6 |
| 2 | **Board `2c`'s per-row server name is dropped** as unreachable — the client holds one server's channels, so it would be a constant (M5 decision 2). | M6 |
| 2b | **Board `2c`'s footer copy is hidden below 640px** — all three hints wrapped at 390px, and «Открывается на ⌘K из любого места» is *false* on a touch device, not merely cramped (M5). | M6 |
| 2c | **The handoff contradicts itself on the palette footer**: `README.md:145` says `canvas-2`, `Redesign.dc.html:118` gives `#FBFCFE` = `--canvas-3`. Root cause: `README.md:46` maps `canvas-2` onto two hexes. **The shipped code follows the hex.** Someone should fix the handoff. | board |
| 4 | **The focused screen-share view is 126.59px tall in the default split.** Read the three corrections in the backlog (§2a) before touching it — the obvious fix is wrong, and the largest lever is the thumbnail strip, not the split. | M6 |
| 5 | ~~**The call's leave button is a pill, not r14**~~ — **SETTLED 2026-08-31 at `9bf7cd4`.** Manual QA found the real defect was not the radius but that this was the only control in the bar carrying its label *inside*, as a pill, while mic/camera/screen use `.stage-ctl` with the caption beneath. It now takes the same shape — 46×46 matching its siblings exactly, label 4px below — and **keeps `--radius-pill`**, so it renders as a circle. That is deliberate: the radius is what keeps hang-up distinguishable now that the text no longer does that job. | **closed** |
| 6 | **Invite revoke still deletes without confirmation**, against board `1d`'s "never delete without this step". Byte-identical to base — inherited, not introduced. | board, then M6 |
| 7 | **Three non-M3 components' modal entrance changed** (scale `.92` → `.95`) when a duplicate keyframe was deleted. Sign-off, not work. | sign-off |
| 8 | **Toast entrance sped 0.3s → 0.22s** for two non-M2 components when the recipe was unified. Sign-off. | sign-off |

---

## §7. M6 — the inherited brief

> **SUPERSEDED 2026-08-30 by `plans/2026-08-30-redesign-m6-polish.md`.** This section is the record of
> what M6 *inherited*, kept for provenance. It is **not current fact**: the plan's Appendix A falsifies
> eight figures below by measurement, including §7.2's "~117 declarations", §6c's `.setting-warning`
> mechanism, §6c's `--danger` foreground count, §5's `probe-composer.js` characterisation and §6c's
> Escape-listener line numbers. The four rulings in §7.1 **do** stand — they are the plan's decisions
> 1–4. Read the plan for anything you intend to act on.

M6 was **designed** during the 2026-08-30 M6 design session but deliberately **not planned**, because every
one of its baselines moved at the trunk merge. What follows is what that session produced. Re-measure anything
you act on; the shape is inherited, the numbers are dated.

**Spec §5's M6 bullet is the clause list:** dark-theme parity on every surface (`2d`) · responsive per design
(≥1200 / 1000–1200 / <900 / <640, migrating the 768/769 pair to 900) · `prefers-reduced-motion` (drop loops,
keep fades) · animation-budget audit (≤250ms ease-out) · i18n additions ru+en with `check:i18n` green ·
**delete the token alias block** · final visual QA side-by-side with `Redesign.dc.html` per screen.

In practice M6 is **that clause list plus the whole of §6b and §6c** — expect it to be the largest milestone
since M2.

### 7.1 Four decisions already ruled by the human

**Provenance, stated explicitly because a reader must never see invented authority (§8.6).** Each of the four
below was put to the human as an **explicit question with costed options** during the **2026-08-30 M6 planning
session**, and each answer recorded here is **the option they chose**. Two of them (2 and 3) previously sat in
§6f, the *"awaiting a human"* table, and have been moved out. They are settled; do not re-litigate them, and
do not attribute them to a planner or an implementer.

1. **Lint goes to 0.** Including the **43 `selector-class-pattern`** renames. Measured distribution
   (2026-08-30, `stylelint -f json`, re-verified at T7): **`ChannelSidebar.css` 16 · `ServerList.css` 14 ·
   `UserList.css` 12 · `TitleBar.css` 1 = 43.** `Auth.css` and `AppPage.css` carry **zero** of them — they sit
   in the 188 under other rules. The offenders are single-segment names: `.channel`, `.active`, `.add`,
   `.home`, `.search`, `.close`, `.list`, `.small`, `.offline`, `.username`, `.current`, `.off`.
   **The renames force giving `probe-shell.js` and `probe-sidebar.js` real gates** — they currently have
   **zero** assertions and address exactly these classes — which also discharges the §6e harness debt.
   *Cost if wrong:* a rename sweep that misses a harness selector produces a probe that can no longer fail
   (§6e mechanism 1). Sweep `tools/*.js` in the same task, and pair every negative precondition.
2. **The call stage's accent is theme-invariant.** Pinned to the dark value **`#6366F1`** via a new
   `--stage-accent` on `:root` only; the **10** `--accent`/`--accent-hover` sites on the stage switch to it —
   **all 10 in `CallStage.css`**, enumerated in §6c. Closes §6f #3 and backlog §2b. *Cost if wrong:* the
   stage's accent stops responding to theme on a surface whose every other token is already `:root`-only — a
   consistency win that is trivially reversible, since it is one token definition and 10 references.
   **Do not use the "12" that appears in the M5-close RESUME and in backlog §2b** — it was never true
   (§6c).
3. **Media-query range syntax is kept.** The **5** remaining legacy blocks migrate to it, and **iOS Safari
   <16.4 is an accepted cost**. They are, enumerated (measured 08-30, and they are exactly the 5
   `media-feature-range-notation` errors in the 188): **`AppPage.css:96`** `(min-width: 769px)` ·
   **`AppPage.css:102`** `(max-width: 768px)` · **`UserList.css:186`** · **`ChannelSidebar.css:323`** ·
   **`ServerList.css:134`**, the last three all `(max-width: 768px)`. Note all five are also 768/769 blocks,
   so this migration and the 900 migration touch the same code — sequence them together.
   Closes §6f #9 and settles M2 ruling 17. *Cost if wrong:* the web client gets a
   *hybrid* broken mobile layout, not a graceful one, on those versions. This was the costed option and it was
   chosen with that cost stated.
4. **Accessible names land as ~13 call-site `aria-label`s** reusing existing i18n keys, plus
   `role="progressbar"` on the level meter — **not** a new JSX primitives layer. *Cost if wrong:* ~13 sites to
   keep in sync instead of one; the alternative (a primitives JSX layer) is a new architectural surface in the
   last milestone, which is the larger risk. Note this ruling is also the one that retires §6c's old
   "fix at the recipe" claim, which was false (`primitives.css` is CSS; ARIA is not).

### 7.2 Three instrument decisions

- **The colour probe is a before/after computed snapshot over every token in both themes**, not threshold
  assertions. It **replaces the `+N / −0` numstat invariant** (§3), which M6 retires when it deletes the alias
  block, and it guards the `stylelint --fix` notation rewrite of ~117 declarations in `tokens.css`. Build it
  first; M5's `resolveVar` scratch-element pattern (§5) is the working form.
  **CORRECTED (Appendix A C1): "~117 declarations" is wrong.** `--fix` changes **50 lines** in `tokens.css`;
  the three colour rules fire on **33 distinct declarations** across **48 distinct warning lines**. Repo-wide
  it took lint **188 → 54**, so **71% of the whole debt was mechanical**. The probe was still the right
  instrument — but note what it could *not* see, which M6 T2 found the hard way: `--fix` also auto-fixed
  `value-keyword-case`, **silently lowercasing `BlinkMacSystemFont`**, which then renders at the width of a
  nonexistent font (483.28px vs 469.31px). **A rule that `--fix` repairs is invisible to a residue check** —
  the check only sees what remains.
- **The audit gate is stylelint, not `rg`.** `csstools/value-no-unknown-custom-properties` fires on a plain
  `color: var(--unknown)` — verified with a positive control — and `importFrom` is scoped to `tokens.css` +
  `base.css`, so **deleting the 47 alias names makes every surviving CSS reference a parse-based error that
  comments cannot fool.** Two conditions: **a `var(--x, fallback)` silences the rule**, and **no current
  reference uses one** (verified 2026-08-30 across all 70 — §6b). **None may be introduced during the sweep.**
- **The raw-value gate is scoped to `*.css`** with the named allowlist (spec amendment §9.4:
  `utils/avatarColor.ts:5–12`, `AvatarCropModal.tsx:109,116`, `Avatar.tsx:34` are permanently exempt). Four
  CSS sites remain: `Auth.css:90,127,140` and `TitleBar.css:34`.

### 7.3 M6's 14-task shape, in dependency order

1. colour probe + harness repair
2. `tokens.css` normalisation + dark parity
3. reopen `primitives.css` — the dead `.channel-type-options` block at `:442–499` **and** the `modal-in`
   consumer comment at `:355` that cites it
4. accessible names + ARIA
5. reduced-motion policy
6. the 900 migration
7. new bands + the member-list toggle
8. structural — fullscreen portal, overlay contract, Escape listeners
9–10. class renames ×2
11. cosmetics + test debt
12. **alias deletion + audit**
13. final visual QA
14. closeout material

### 7.4 Two findings that shape M6's sequencing (measured 2026-08-30, re-verified at M5.5 T7)

- **`.chat-members-btn` is inert above 768px** — the natural home for the spec's 1000–1200px member-list
  toggle, and migrating the breakpoint alone *widens* the dead range. Detail in §6c.
- **`base.css:85`'s blanket reduce block already kills fades**, so M6's reduced-motion clause **loosens a
  hammer into a policy** — strictly riskier than adding coverage. Its probe must assert both halves. Detail
  in §6c.

### 7.5 How to plan it

- Plan it the way M4 and M5 were planned: `superpowers:brainstorming` → `superpowers:writing-plans`, numbered
  binding decisions each stating **what it costs if wrong**, Global Constraints copied forward from §3 with the
  alias-deletion exception flipped on, then a grand review before execution.
- **The alias deletion is the audit** — sequence it late (task 12), and gate it on stylelint per §7.2.
- Decide up front whether M6 also answers §6f's remaining items 1, 2, 2b and 4, since several are one-liners
  once a human rules.

**After M6:** the branch is releasable as a single version. `superpowers:finishing-a-development-branch`
covers the integration decision. **Integrate by merging `origin/develop` and then opening a PR into it — do
NOT rebase.** `redesign` is published at `origin/redesign` and its history is shared. The old instruction here,
*"rebase on `main` at that point (spec §8)"*, is **superseded by spec amendment §9.1** and must not be
followed: `main` is not the trunk, and rebasing a published branch rewrites shared history.

---

## §8. Process rules that earned their place

These are not ceremony. Each was bought with a defect that shipped or nearly shipped.

1. **The dominant defect class is not code — it is false claims about code.** M4 alone caught nine false
   comments and four false cost estimates; M5.5 caught five in a single task's brief plus three of the
   controller's own figures. Every one shared a root cause: *asserting a fact from surrounding idiom instead of
   reading the declaration.* **Claims about facts-on-disk need a re-read; claims about behaviour need a
   counterfactual.** A re-read is not enough for the second kind.
   **Corollary, measured across M5.5: the mechanism is summarisation, not analysis.** Three separate times an
   agent's **prose about its work was wrong where its work was right** — a report claiming the capture-phase
   hook was "redesign-owned" (the file it wrote was correct and the hook is VYC-81's), a review "correcting"
   the `useModalFocus` docstring to "5 and nine" (it is 5 and 8, and acting on it would have injected a new
   false claim while fixing a stale one), and a review giving a six-file distribution for the 43 lint errors
   (it is four). **Each was settled by measuring, not by arbitrating between reports.** When two records
   disagree, run the command.
2. **"X could not be measured because Y" must carry evidence for Y at the same standard as a claim that X
   passed.** That phrasing reads as rigour and thereby suppresses the question "is Y true?". In all four M4
   instances Y was false and a cheap measurement existed.
3. **Check that a probe can fail before citing it.** Two nominal gates in M4, six false passes in M2, and
   `probe-composer.js`'s 48 dead assertions in M5.5 (§5). **A gate whose output cannot change is not a gate**
   — which is also what was wrong with `git log redesign..main` for five milestones (§1).
4. **The whole-branch review seat is not a formality.** Four milestones running, it has found defects no
   per-task reviewer could see, because each was invisible in a diff: an *unchanged line*, an *absence* across
   four media blocks, a *cascade interaction* between two rules changed in different tasks, a mount point's new
   ancestor. **Seams are where a merge and a port meet an existing stack** — M5.5 had more of them than any
   milestone since M2.
5. **Instruct implementers to push back, and mean it.** M4: five times an implementer caught an error in the
   plan or in a dispatch and said so rather than complying. **M5.5: every single implementer caught a real
   error in the plan or in a dispatch, including two of the controller's own figures.** **This was worth more
   than any single review.**
6. **Record every ruling in the ledger as it is made**, not only in the prompt that carries it, **and record
   who ruled it.** A reviewer reading only the on-disk record must never see invented authority — which is why
   §7.1 states the provenance of all four human rulings explicitly.
7. **Residue accounting covers every probe an invocation runs**, not only the probe the task is about — and it
   is done **against the REST API, not the DOM**, and **paginated** (§4, §9). Inferring from the DOM nearly
   produced a false "smoke server destroyed" conclusion in M4; an unpaginated read produced a saturated
   `50 → 50` gauge in M5.5.
8. **Transcribe the closeout before the session ends.** The SDD workspace is gitignored and dies with the
   session; anything not written into `docs/superpowers/` is lost. This is also why a spend-limit kill
   mid-task is *not* a failed task — the ledger-plus-report-file contract made M4's one occurrence cost a
   single short resume.
9. **A correction to a prior report must be tighter than what it corrects.** M5.5 produced three corrections
   that were themselves wrong or overstated. Before writing "X is wrong, it is Y", measure Y.
10. **`rg` silently does not search `.superpowers/`, and a false zero is indistinguishable from a real
    one.** *(New at M6 planning, 2026-08-30.)* The harness is gitignored, and **ripgrep honours
    `.gitignore` by default** — so `rg <pattern> .superpowers/…/tools/` returns **nothing**, prints no
    warning and exits 0. Neither `--hidden` alone nor passing the directory as an explicit path
    defeats it; it needs **`--no-ignore`**, or plain `grep`. The M6 plan asserted "zero alias
    references in the harness" from exactly this, used it to justify an instrument decision, and
    shipped it into a commit; the grand review caught it by running `grep`.
    **This is §5's "a gate whose output cannot change is not a gate" in a new place** — not a probe
    that stopped asserting, but a *search that stopped searching*. **Every zero any milestone measured
    against `.superpowers/` with a bare `rg` is suspect and should be re-run.**
    *(The counts that were right — M6's 77 rename selector sites — reproduced exactly under
    `--no-ignore --hidden`. The instrument is not always wrong; it is **silently** wrong, which is
    worse.)*

---

## §9. Smoke-server state (so the next probe author is not surprised)

**Provenance:** the message counts below were measured at **T5 (`bab71ef`)** against the REST API with
**paginated** reads (`limit=100`, looping until a short page), and cross-checked at T4 the same way. **T6 and
T7 ran no probe and made no write**, so they are unchanged at `18322a8` — but they were **not re-measured at
T7**. The server census (servers/channels/invites/stickers/members) was measured at **T1** and re-confirmed
unchanged at T4.

**1 server** («Redesign Smoke») · **3 channels** (`general`, `second-smoke`, `t9-empty-channel`) · exactly
**2 invites**, both `uses=0`, both dated 2026-08-25 · **1 sticker** (`t8seed68113`) · **1 member** ·
`last_channel_id` → `general`.

| channel | M5 close | M5.5 close | delta |
|---|---|---|---|
| `#general` | 83 (45 matching `probe`) | **83** (45 matching `probe`) | **0** |
| `#second-smoke` | 4 (1 probe) | **11** | **+7** |
| `#t9-empty-channel` | **0** | **0** | 0 — M4's empty-state fixture is intact |

All seven new messages are in `#second-smoke` and every one is attributed by content and timestamp: **+1** is
T3's own manual send-path pass (the only message on the branch carrying an attachment), **+4** are two
`probe-chat.js` runs (`probe-a-`/`probe-b-` pairs), **+2** are two runs of a **locally patched copy** of
`probe-composer.js`. **The patch did not persist** — the standing file still throws at `:193` (§5), which is
what keeps that debt item live.

### Counting method, and its limits

Counted **against the REST API, not the DOM**, and **paginated**. Three failure modes to avoid:

- **`getMessages` defaults to `limit=50`.** An unpaginated read of `#general` returns **50 regardless of what
  happened to it**. M5.5 T3 reported `#general` as `50 → 50`; the *delta* was right (an unchanged channel
  reads 50 both times) but the *figure* was a truncation artifact. To be precise about what the truncation
  does: `limit=50, offset=0` returns the most **recent** 50, so a new message *does* appear in the page and
  pushes the oldest out — the count stays 50 while the contents shift. **The gauge is uninformative about the
  count, not blind to writes.**
- **There is no `before` cursor.** A `before=<id>` parameter is **silently ignored** and the server re-reports
  page 1. An early M5.5 counter used one and reported `#general` as 100 — 50 counted twice. **Use `offset`.**
- **The search API's `.total` is a valid second method** and agreed with the paginated dump on every cell at
  T1, but it is **per-channel only** and matches a substring, so it answers "how many match `probe`", not
  "how many messages exist".

### A new residue species: uploaded blobs

**Exactly one attachment exists server-side**, created by T3's send-path pass:

| field | value |
|---|---|
| file | `m55-t3-pass.png`, **149 bytes**, `image/png`, 16×16 |
| channel | `#second-smoke`, on an **empty-content** message |
| thumb | **present** → a second, derived storage object exists |

**It is never reclaimed.** `ListSweepable` (`repository/postgres/attachment.go:186–195`) is
`WHERE (message_id IS NULL AND created_at < $1) OR (expires_at IS NOT NULL AND expires_at < $2)`. Its
`message_id` **is set** (it was sent), so the orphan branch excludes it; and the free plan seeds
`retention_days = NULL` (`migrations/018_attachments_and_plans.up.sql`), so `expires_at` is NULL and the
retention branch is unreachable. **A sent attachment on the free plan persists for the life of the message.**
**No metered quota was consumed** — `max_total_bytes` is NULL, so `TotalBytesByUser` is never checked against
a ceiling. The only cost is disk.

*(The related client-side finding, `onDiscard` orphaning blobs, is **bounded and self-healing** and is not a
leak: a discarded failed row's attachments still have `message_id` NULL, which is the **same predicate** the
janitor's orphan branch and `deleteAttachment` both use, so they are reclaimed after `OrphanAge` = 24h at no
metered cost. A ≤24h deferral. Do not record it as "an attached-but-messageless blob".)*

**`#general` is 54% probe noise and drifting.** Any future probe asserting on message counts or scroll
position there is working against a moving fixture. Fix `probe-chat.js` before relying on it, and prefer
`#second-smoke` for anything that writes.

**A single test account means three branches have been reasoned about rather than measured:** remote
participants, incoming calls, and not-own-message rendering. **A second test account would close all three** —
it is the single cheapest improvement available to this project's verification story.
