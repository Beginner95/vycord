# M6 — Polish & closure: closeout

**Milestone:** M6, the last of the vycord frontend redesign.
**Branch:** `redesign` (published at `origin/redesign` — never rebase).
**Range:** `5de16ee..9bf7cd4` — **15** commits, 65 files, +3395/−699 (`git rev-list --count`; the
spine in §1 has 15 rows. An earlier revision of this line said 16 and contradicted its own table.)
**Plan:** `2026-08-30-redesign-m6-polish.md` · **Evidence:** `m6-visual-qa-index.md` ·
**Baseline:** `m6-colour-baseline.json` · **Deltas:** `m6-colour-deltas.json`.

After this milestone the branch is releasable as a single version. What remains is not work but a
decision: how to integrate. See §9.

---

## 1. Commit spine

| Commit | Task |
|---|---|
| `d8d5c0e` | T1 — colour probe, committed baseline, harness repairs |
| `8201253` | T2 — `stylelint --fix` notation normalisation, 188 → 54 |
| `4f1556f` | T3 — dark-theme parity, 54 → 51 |
| `dbaaacf` | T4 — `primitives.css` reopened: 3 specificity bugs + dead block |
| `ceba0d9` | T5 — accessible names, level-meter role, chat `h1`, palette ARIA |
| `4a855e5` | T6 — reduced-motion policy replaces the blanket suppressor |
| `9e16111` | T7 — 900px migration for the `AppPage.css` shell pair |
| `f8ff94e` | T8 — responsive band system + close the 769–899 nav trap |
| `e96deb4` | T9 — class renames, the sweep's proving run, 51 → 38 |
| `f80a78c` | T10 — class renames, `ServerList` + `ChannelSidebar`, 38 → 8 |
| `ccd54cc` | T11 — overlays, fullscreen, Escape |
| `d76beba` | T12 — cosmetics and test debt |
| `c936baf` | T13 — delete the legacy aliases, run the spec §8 audit, 8 → **0** |
| `0f35792` | T14 — light visual QA, evidence index |
| `9bf7cd4` | **six defects found by manual QA** |

T13 was amended twice in place (`35187e9` → `682fb97` → `c936baf`) across two fix rounds.
`origin/redesign` (`2dc4974`) was verified an ancestor before and after each amend; **no published
history was rewritten.**

---

## 2. Gate trajectory, measured at both ends of every task

Both ends means: the task's base tree and its shipped tree, each measured via `git archive` into a
clean directory, never inferred from the previous task's number.

**Stylelint, `npx stylelint "src/**/*.css"` from `client/`:**

```
T1  188  (baseline)
T2   54  ← --fix, 71% of the debt was mechanical
T3   51  ← 2 value-no-unknown-custom-properties + 1 no-duplicate-selectors
T4–T8 51 (unchanged, verified both ends each task, not assumed)
T9   38  ← 13 selector-class-pattern
T10   8  ← 30 selector-class-pattern; the rule reaches 0 repo-wide
T11–T12 8 (unchanged, verified)
T13   0  ← 47 aliases + 66 references deleted, 4 raw colours, 8 no-descending-specificity reordered
```

**Zero is now an invariant, and that makes the gate stricter rather than laxer.** Before, a total
reached by a different mix could hide a new warning offsetting a cleared one. Now any output at all
is a regression you just introduced — there is no debt to subtract from and no arithmetic to do.

**Tests:** 36 files / 230 tests (227 passed) → **38 files / 257 tests (254 passed)**. +2 files,
+27 tests, all passing.

**`npm test` is RED at baseline by design** and has been since M1: exactly 3 tests in
`src/services/__tests__/api.network-retry.test.ts`, merged without their implementation. The gate is
that **no other file appears in a `FAIL` line**. It never did.

**Other gates at close:** `npx tsc --noEmit` exit 0 / **0 bytes** · `npm run check:i18n` clean ·
`alias-sentinel --expect 0/0 --expect-status BLOCK-ABSENT` PASS · zero raw colour outside
`tokens.css` · probe residue held flat throughout (`#general` 83 · `#second-smoke` 17 ·
`#t9-empty-channel` 0).

---

## 3. The spec §8 audit

The audit was not a report. **The deletion was the audit**: `csstools/value-no-unknown-custom-properties`
sees only `tokens.css` and `base.css`, so once the alias layer is gone, every surviving `var(--x)`
naming a deleted alias becomes a lint error. Passing lint at zero *is* the proof that no consumer was
missed.

47 alias names deleted, **66** references migrated across 6 files. The reviewer rebuilt the census
independently and also got 66 — a third instrument agreeing with the sentinel and the implementer.
The four aliases carrying *literals* rather than `var(--canonical)` — the only cases where
equivalence is not true by construction, and therefore the real risk — are byte-identical.

The plan predicted **70** references; the tree had 66. Measured, not assumed.

---

## 4. Decisions and who ruled them

**Provenance matters more than the decision.** A reader of the on-disk record must never encounter
invented authority.

- **Decisions 1–8 carry human provenance.** 5–8 were put to the human as explicit costed questions
  in the 2026-08-30 M6 planning session; **22–25** likewise, after the grand review. These were not
  re-litigated during execution.
- **Decisions 9–21 are the planner's.** They are not human rulings and must never be cited as such.
  They were overturnable by an implementer with a measurement, and two were.

### Decisions overturned by measurement during execution

- **Decision 6 (T3) — the plan's dark `--danger: #FCA5A5` was not applied.** Measured, it would have
  put white text on a pastel fill at **1.90:1** across 11 fill sites. `--danger` is 11 fill / 3
  border / 3 foreground. The override was declined and **its absence recorded as a decision**, which
  is the part that matters: an unapplied plan step is invisible unless someone writes down that it
  was considered and rejected.
- **Decision 10's rail rename table (T10) was unsafe as written.** Collapsing `.server-icon.add`
  (0,2,0) to a bare class loses two cascade ties — `.add:hover` declares no `color` — and lands lint
  on **11**, not 8. Shipped the compound `.server-icon.server-icon-add` instead, with both ties
  measured at protocol level.

---

## 5. Rulings made by the controller during execution

Each is recorded in the ledger in the required form — what was decided, why, and what it costs if
wrong. The load-bearing ones:

1. **T2's plan text contained a flat contradiction** — "leave `roboto`/`consolas` lowercase" and "0
   drift, no allowlist" cannot both hold against a byte comparator. Resolved by reverting all three
   identifiers with a `stylelint-disable-next-line` carrying the measured reason.
2. **T13's `.auth-error` border, `#EF4444` → `var(--danger)` `#E7444A`, approved on the record.** No
   plan decision covers it. §9.4 mandated clearing the raw value; no canonical token reproduces
   `#EF4444`; `--danger` is the error token; and minting a canonical `#EF4444` would perpetuate a
   legacy value in the milestone whose entire purpose is removing them. Disclosed in
   `m6-colour-deltas.json` and carried into visual QA.
3. **T14's capture matrix descoped**, on the human's direct instruction. Recorded in the evidence
   index as a scope ruling so a later reader cannot mistake the absence of screenshots for a gap.
4. **T14's brief anchors corrected before dispatch** — all three of decision 13's cited line numbers
   were stale, and `--radius-lg` no longer existed at all.

**Roughly eighteen controller errors were caught by implementers and reviewers.** That is not an
apology; it is the process working. Four are worth naming because each falsified something I had
asserted confidently:

- I claimed `--radius-lg` was one of the 81 baseline tokens. It is an **alias** — the baseline cannot
  see decision 13's +1px at all. The action stood (20 non-colour tokens would have thrown); the
  justification did not, and T13 needed **two** instruments rather than one.
- I reported the sweep guard exits 1. It exits **2**. I had piped to `grep`, which exits 1 on no
  match, while the guard writes only to stderr.
- I told T11 its Escape line numbers were stale. They were **two different anchors** — a key check
  and an `addEventListener` — and both were correct.
- I gave T13 a `:244/:245` "fix" for `isBlockingOverlayOpen()`. It is at `:242`; my number came from
  a selector line. The implementer refused it, correctly.

---

## 6. Corrections to the durable record

The plan's Appendix A recorded eight (C1–C8) plus C9 from the grand review. All were confirmed in
execution. **Additional corrections found while executing:**

| What the record said | Measured |
|---|---|
| 70 alias references | **66** |
| `--radius-lg` at `ServerList.css:208,253` | `:237,:287`, and by close `:233,:292` |
| `probe-primitives-toggle.js` among the assertion-less probes | deleted in T1; **38 of 140**, not ~45 of 143 |
| `#general` residue is 54% probe noise | **57.8%** |
| the message author field is `author_id` | `user_id` |
| `.stage-focus-ctrl-btn`'s 40px floor is open (T12) | already closed since `a3cc52e` |
| `electron/dist` is 292K | **236K** |
| board ids are nine | **eleven** (`1a`–`1f`, `2a`–`2e`) — and none draws the auth surface |

**And a correction to a claim this milestone itself created.** T13 documented, in capitals, that one
specificity reorder in `ChannelSidebar.css` was "only safe because of a neighbouring rule; delete or
weaken it and the dark focus state silently changes." **The reverse is true.** Shipped order is
D → P → DF; every element matching DF also matches P's first member, P precedes DF, and the values
are byte-identical, so **DF is inert**. The implementer's own control — new order, DF deleted — read
identically to the shipped tree. The reorder **removed** an order dependency rather than creating
one. The false claim had already propagated into the repo contract before it was caught.

---

## 7. What was reasoned rather than measured

Restated with narrowed scope, because the inherited list was partly overstated. **"X could not be
measured because Y" must carry evidence for Y at the same standard as a claim that X passed** — that
phrasing reads as rigour and thereby suppresses the question *is Y true?*

- **Electron — packaged behaviour only.** `dist` is **236K**, and `npm run dev` fails at launch. But
  `--fake-electron` plus the standing `titleBar` report block means the `electronAPI`-gated
  **renderer** branches *are* measurable, and were measured. Narrower than the inherited claim.
- **Remote participants and not-own-message rendering** — one test account. A second test account
  remains the single cheapest improvement available to this project's verification story.
- **Incoming calls are no longer wholly unmeasured.** The **UI half is now driven end to end**; the
  peer half remains unmeasured.
- **The speaking ring has never been driven by a real voice.** The M3-era claim that `--fake-media`'s
  tone peaks at **~0.0065–0.0115 is measured FALSE** — it is a full-scale periodic beep every ~450ms
  and that range is its decay tail; the original comparison also put a time-domain amplitude against
  a frequency-domain reader. **No document may carry that sentence forward.**
- **Four attachment surfaces have no fixture:** `AudioPlayer` entirely, `.video-play-btn`,
  `.video-mute-btn`, `.attachment-file*`.
- **`.server-icon img`** — decision 13's third site — has no element on the smoke account. Unread for
  fixture reasons, not code reasons.

---

## 8. The milestone's dominant failure mode

Two related classes account for most of the real findings, and both are worth carrying into whatever
follows.

### 8a. Instruments that answer a question nobody asked

Every one of these produced a *confident, well-formatted, wrong* result:

- A bare `rg` returned a **false zero** on the gitignored `.superpowers/` tree, and that zero went on
  to justify an instrument decision and survive into a commit. **A false zero from a skipped
  directory is indistinguishable from a real zero.** Search the harness with `--no-ignore` or `grep`.
- `--size 899.5x900` produced a **756px** viewport, and the probe printed a confident row about a
  width that was never rendered.
- `--size` does not govern the **fullscreen** viewport (headless screen is 800×600); T11 added
  `--screen`.
- The selector sweep's `argOf` read only the first flag, so **the plan's own T10 command would have
  swept 52 of 72 sites while printing a complete report.**
- A comments-only reproducer **missed the very defect it was written to demonstrate**.
- T12's line numbers were measured against the *base* tree rather than the commit — proved by
  arithmetic: the report said +434, `git show --stat` said 445, and the 11-line difference was
  `AppPage.tsx` itself.
- An icon census was contaminated because the commit's own JSX **comment** contained the literal it
  was grepping for.
- `stylelint --fix` silently lowercased `BlinkMacSystemFont`, which then renders at the width of a
  nonexistent font (483.28px vs 469.31px). **A rule auto-fixed is invisible to a residue check.**
- At 760px, `.chat-voice-btn` measures **0×0** because the shell boots on a different panel — and a
  centring probe reports `leftGap 0, rightGap 0`, which reads as perfectly centred. **An absent
  element measures as a pass.**

### 8b. Prose that contradicts the tree it ships in

T13 cost **three review passes on a diff whose runtime behaviour was correct in round zero.** All
seven findings across both fix rounds were documentation defects: an inverted safety claim, figures
stale at the moment of writing, documented output that no command produces (`tsc` emits 0 bytes; the
quoted string was the implementer's **terminal output filter**), and citations invalidated by their
own commit.

`--presence-ring`'s declaration moved **340 → 360 → 367** across two fix rounds — the second move
happening *while the round was fixing that very citation*. The mechanism is always identical:
**measure, then edit, then don't re-measure.**

The durable fix is not more careful numbers. It is what T13 finally adopted: **cite by selector, and
add "if the numbers disagree with the file, trust the selector."** That removes the defect class
rather than the instance. It also produced its first **false positive** within one task — an
orientation pass flagged `MessageSearch.css:245` as stale when `:245` is the selector line and
therefore the correct anchor. Worth knowing that the rule over-fires.

**On this milestone the durable record was a less reliable artifact than the code.**

---

## 9. The manual QA round — the milestone's most important result

After T14, with **stylelint at 0, `tsc` at 0, 38 test files, ~140 probes and five M5-certified gates
all green**, the human clicked through the app and found **six real defects. Not one was reachable by
any of those instruments.**

1. The attach popover was `left: 0` on `.composer-field` while its button sits second-from-right —
   the menu opened at the opposite end of the composer. Now 1px from the right edge.
2. **The mobile server list was unreadable in the light theme.** Under decision 23 the 76px rail
   becomes a full-screen list but kept `background: var(--rail)` — a near-black in **both** themes —
   while the rows it now contains paint `--ink`. **Dark theme looked correct only because `--rail`
   and `--canvas` are both near-black there**, which is a structural reason, not luck: any dark-only
   check passes this defect. That is a general hole in theme-pair testing.
3. The header voice button's icon was off-centre: the base rule declares `align-items` but no
   `justify-content` — harmless while auto-width, wrong once the mobile block fixes 40px and hides
   the label.
4. The settings modal was too narrow: 648px (board `1d`) → **760px**, a disclosed board deviation;
   of +112px a measured 110 land in `.settings-pane`.
5. The sidebar chevron was too small: gutter 16 → 22px **and** glyph 14 → 16 in the same change — the
   gutter width is the binding constraint on the glyph, so they move together or not at all.
6. The stop-call button carried its label *inside* as a pill while mic/camera/screen use `.stage-ctl`
   with the caption beneath. Now identical geometry to its siblings (46×46, label 4px below), keeping
   `--radius-pill` so hang-up stays distinguishable now that the text no longer does that job. This
   also settles backlog **§2c**, which had recorded the pill as an unruled board departure.

All six measured at the element, with the light/dark and desktop/mobile controls that make each read
non-vacuous. Gates after: stylelint 0 · `tsc` 0 · tests at the by-design baseline · i18n clean.
Human smoke-tested the result and confirmed.

**The conclusion is not "the automated suite is bad."** It is that the suite verifies what it was
pointed at, and a person clicking finds what nobody thought to point it at. The two are not
substitutes, and the cheapest verification improvement available to this project is not another
probe — it is a second test account (§7) and a human pass per milestone.

---

## 10. Final whole-branch review

Run over all 15 commits on the most capable model. **Verdict: nothing blocks handoff.** Gates
re-run independently on a clean tree: stylelint 0 bytes · `tsc` 0 bytes · `npm test` 38 files / 257
with `api.network-retry.test.ts` the only FAIL file · `check:i18n` clean with en/ru new keys 1:1.
Refs matched the root contract exactly. The alias migration, the twelve class renames, the
`ChannelSidebar` reorder and decision 13's radius were each re-derived from the shipped tree rather
than read from the diff.

**Six findings, five of them documentation. Two were introduced by the closing commits — mine.**

| # | Finding | Disposition |
|---|---|---|
| F1 | `--call-stage-height` cited at `AppPage.tsx:686`; actual **`:693`** | already fixed at `9a6fadb`, plus a grep that regenerates the whole table |
| F2 | `primitives.css` cited `Settings.css:14` for `modal-in`; actual **`:22`** | fixed |
| F3 | `ChatArea.tsx` cited `ChatArea.css:377/:381`; actual `:39` and `:395` — **stale before M6** | fixed, and **re-anchored by selector** |
| F4 | this closeout said "16 commits" while its own table listed 15 | fixed |
| F5 | `m6-colour-deltas.json` did not carry T15's three `ServerList` colour changes | fixed, with a note that geometry lives here in §9 |
| F6 | active mobile server row: dark ink on an indigo fill | **fixed** — see below |

**F1, F2 and F5 are the milestone's named failure mode recurring in the act of closing it.** F1 and F2
were caused by comment edits in `9bf7cd4` — the same commit that fixed six unrelated bugs — and F5 by
the fixes in that commit not being written into the ledger built to record exactly that class of
change. That is worth stating plainly rather than quietly correcting: **the person who documented
this failure mode four times then committed it twice more while writing the document about it.** The
remedy that works is not more care; it is the regenerating command, which is what F1's fix now
carries.

**F6 was a real accessibility defect and is fixed.** The active server row keeps
`background: var(--accent)` from the base `.server-icon.is-active` rule — the mobile override resets
only radius, shadow and border-left — so the row's own `color` is `--white`. But `.server-icon-name`
declares `--ink` **on itself**, which beats an inherited value at any specificity. Measured at the
rendered element at 760px: **light 2.93:1, dark 3.61:1** against AA's 4.5:1. It is **pre-existing** —
`5de16ee` already shipped it — and it is the *same species* as the manual-QA defect above, one row
over: a `--rail`-era assumption meeting page ink. Fixed with a (0,3,0) rule after the (0,1,0) one it
corrects; the name now reads white on the accent fill in both themes, and both clear AA.

**One thing that cannot be fixed, recorded so it does not mislead.** `c936baf`'s **commit message**
still carries the *inverted* safety claim about the `ChannelSidebar` reorder — "safe only because of a
neighbouring rule". The in-file note, both `CLAUDE.md` contracts and §6 of this document all carry the
corrected version (**DF is inert; the reorder removed an order dependency**), but the message is
immutable on a published branch. **A future reader grepping the log will find the false version.**
This paragraph is the only place that says so.

**One check the review could not perform:** it had no network, so its drift-gate read came from stale
remote refs. **I ran the gate with a real `git fetch --all --prune` at M6 close and it was empty** —
but the fetch is the gate, and its result expires. Re-run it before merging.

---

## 11. The integration decision — hand-off

**This is the only thing left, and it is a human call.**

- **Merge `origin/develop` into `redesign`, then open a PR into `develop`.**
- **Do NOT rebase.** `redesign` is published at `origin/redesign` and its history is shared;
  rebasing rewrites history other clones may hold.
- **The old instruction "rebase on `main` at that point (spec §8)" is superseded by spec amendment
  §9.1** and must not be followed. `main` is dormant, not the trunk — `origin/main` has not moved
  since the branch point.
- **The drift gate is `git fetch --all --prune && git log --oneline redesign..origin/develop`.** The
  `fetch` is load-bearing: without it the gate reads a stale remote-tracking ref and reports "no
  drift" whatever the trunk did. M5.5 found this gate had been structurally incapable of firing for
  five milestones.
- **Never `git add -A`.** `design_handoff_discord_redesign/` is untracked on purpose and is *not* in
  `.gitignore`.

Use `superpowers:finishing-a-development-branch`.
