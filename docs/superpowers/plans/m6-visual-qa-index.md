# M6 Task 14 — visual QA evidence index

Commit under review: `c936baf` (M6 T13, the alias deletion / spec §8 audit).
Measured 2026-08-31. Full working notes are untracked at
`.superpowers/sdd/2026-08-30-redesign-m6-polish/` — `.gitignore:44` is `.superpowers/`,
which is why this index exists as the tracked artifact rather than the report itself.

## Scope — deliberately light

**The board-by-board capture matrix was dropped by decision**, not skipped by omission: eleven board
ids × two themes is hours of agent time to produce screenshots a person can arbitrate faster by
clicking. What ran here is the complement — the checks a human clicking cannot perform. The
click-list below is the handover for the rest, and the two board deviations in it are **recorded
deviations, not defects**.

Anyone reading this later: absence of a capture matrix in this milestone is a scope ruling, not a
gap in the record.

## Environment

Dev server restarted before measuring: vite up on port **3000** at `2026-08-31 14:20:43`, against a
HEAD committed `12:10:01` — **the server postdates HEAD.** Stale dev servers were found alive four
times in this milestone (T3, T5, T9, T10) and silently invalidate every visual claim.

**`npm run dev` cannot start the server in this environment.** It runs vite and Electron under
`concurrently -k`; Electron throws `Electron failed to install correctly` (npm 11's `allowScripts`
skipped its postinstall, so `node_modules/electron/dist` is **236K** instead of ~250MB) and `-k`
kills vite with it. Use **`npm run dev:vite`**. This is new — every prior task's instruction to
"restart the dev server" was written without it.

## Gates

| Gate | Result |
|---|---|
| `npx stylelint "src/**/*.css"` (from `client/`) | exit 0, **0 bytes** — zero is an invariant; any output is newly added |
| `npx tsc --noEmit` | exit 0, **0 bytes** (`wc -c`, unfiltered) |
| `npm test` | Test Files 1 failed \| 37 passed (38) · Tests 3 failed \| 254 passed (257) |
| `npm test` — FAIL files | `src/services/__tests__/api.network-retry.test.ts` **only** |

`npm test` is RED at baseline **by design** and has been since M1: those 3 tests were merged without
their implementation. The gate is that no *other* file appears in a `FAIL` line. It does not.

## The palette gate — T13's unexecuted repair, now executed

`probe-palette-messages2.js` is one of five M5-certified gates and was found **already broken before
T13**: M6 T3 moved the rule it asserts on to `--hl-bg`/`--hl-ink` and nobody re-pointed it. T13
repaired it but the repair was **reasoned, never run**, and was promoted to this task.

```
node smoke.mjs --out <shot>.png --path /app \
  --probe  ./probe-palette-messages.js \
  --probe2 ./probe-palette-messages2.js
```

```
PROBE:  { "verdict": "palette messages OK", "channel": "general" }
PROBE2: { "verdict": "palette messages OK (probe2: deep-panel highlight, 7th action, chat-jump)",
          "channel": "general" }
```

**One invocation, not two.** `smoke.mjs:541` runs the `probe`/`probe2` slots as separate
`Runtime.evaluate` calls in the *same page session without reloading*, and
`probe-palette-messages2.js:40` hard-fails on `'deep panel from probe1 is not open — run probe1
first'`. Two separate runs fail on a precondition and look exactly like the repair being broken — a
false negative on the very gate this task existed to close. **The file has no `1` in its name**;
`probe-palette-messages1.js` does not exist.

The same run also reported **`legacyAliasesResurrected: []`** — a runtime confirmation of the T13
alias deletion, independent of the static sentinel.

## Decision 13's +1px — measured where it exists

`--radius-lg` (12px) was one of the 47 aliases T13 deleted. The canonical scale is
6/9/10/11/13/14/16/18/999 and has **no 12px step**, so the +1px is `--radius-tile` = 13px.

Probe: `probe-t14-radius.js` (untracked, with the negative control built in).

| Read | `.server-icon-symbol` | `.server-list` width | `(width <= 768px)` |
|---|---|---|---|
| **760×900** (positive) | **13px** | 760px | true |
| **1440×900** (control) | **0px** | 76px | false |

`--radius-tile` resolves to `13px` and `--danger` to `#E7444A` at both widths.

**Two of decision 13's three sites do not exist at desktop width.** `m6-colour-deltas.json` records
`.server-icon-symbol` and `.server-icon img` inside `@media (width <= 768px)`; the 1440 read confirms
it — 0px, no radius rule applies at all. **A desktop-only check would truthfully report "no change"
and that reads as a pass.** The ≤768px pass is not an extra; it is the only place two of the three
sites can be seen. Only `.auth-card::before` changes at every width.

The control moved as it should — `.server-list` is a 76px rail at desktop and a 760px full-width
panel at 760px — so the read is measuring the media query, not viewport noise.

## Cannot measure — narrowed, with evidence for each "cannot"

"X could not be measured because Y" must carry evidence for Y at the same standard as a claim that X
passed. That phrasing reads as rigour and thereby suppresses the question *is Y true?* — in all four
M4 instances Y was false and a cheap measurement existed. Two entries inherited from the brief were
overstated and are narrowed here.

- **`.server-icon img` — no element.** The probe reports `present.img: false` at both widths: the
  smoke account's server has no uploaded icon, so the site has no element to compute. This is the
  one decision-13 site that remains unread, and the reason is the fixture, not the code.
- **Electron — packaged behaviour only.** `dist` is **236K** (the brief said 292K; direction right,
  number wrong), and `npm run dev` proves it fails at launch. But `smoke.mjs --fake-electron` plus
  the standing `titleBar` report block means the `electronAPI`-gated **renderer** branches *are*
  measurable — and were measured this run (`titleBar` height 40px, background `rgb(255,255,255)`).
  Only packaged behaviour is unmeasured.
- **Remote participants, incoming calls, not-own-message rendering — one test account.** A second
  test account remains the single cheapest improvement available to this project's verification
  story. Note for the closeout: `inject-voice-ws.js` + `--push-ws` + `probe-p2p-incoming-shot.js`
  may make "one test account" the wrong reason for the *incoming-call* surface specifically — the UI
  half is now driven end to end; the peer half is not.
- **The speaking ring has never been driven by a real voice.** The M3-era claim that `--fake-media`'s
  tone peaks at ~0.0065–0.0115 is **measured false** — it is a full-scale periodic beep every ~450ms
  and that range is its decay tail; the original comparison also put a time-domain amplitude against
  a frequency-domain reader. **That sentence must not be carried forward again.**
- **Four attachment surfaces with no fixture:** `AudioPlayer` entirely, `.video-play-btn`,
  `.video-mute-btn`, `.attachment-file*`. Neither attachments probe references them.

## Click-list — what a person should look at

Each item names where it is visible, because several are invisible at the default viewport.

**Disclosed deltas**
- **+1px radius**, decision 13 — `.server-icon-symbol` and `.server-icon img` **only below 768px**
  (narrow the window; at desktop there is nothing to see), `.auth-card::before` at every width.
- **Auth focus-ring alpha**, decision 14 — `Auth.css:70`.
- **`.auth-error` border hue** — `#EF4444` → `var(--danger)` `#E7444A`, `Auth.css:153`. **Approved on
  the record by the controller during T13; no plan decision covers it.** §9.4 mandated clearing the
  raw value, no canonical token reproduces `#EF4444`, and minting one would have perpetuated a legacy
  value in the milestone whose purpose is removing them. Recorded in `m6-colour-deltas.json`.
- Both **accent-ramp gradients** (decision 15) · the three call-surface **`--stage-danger`** sites
  (decision 6) · the call stage's ten **`--stage-accent`** sites (decision 2) ·
  **`.setting-warning`**'s light foreground (T3).

**Expected non-matches — flagging these as defects means the plan was not read; passing silently
over them means the board was not**
- **Decision 23** — below 900px the app ships the **mobile single-panel model**, not board `1f`'s
  drawer. A recorded deviation.
- **Decision 7** — board `1c`'s dark-theme ⌘K chip is **not** on the header search button, because
  that button opens the deep panel.

**The auth surface has no board at all.** The bundle carries **eleven** ids — `1a 1b 1c 1d 1e 1f
2a 2b 2c 2d 2e` — and the M6 plan's Task 14 text lists only nine, omitting `1a` and `1b`. None draws
auth, so three of the deltas above (`.auth-card::before`, the focus ring, the `.auth-error` hue) live
on a screen the board never drew. They are element-verified with **no board reference**; nothing
arbitrates their appearance except a person's eye.

**Known and accepted, not defects**
- The **769–899px band** renders desktop styling — decision 5's disclosed, accepted cost
  (`AppPage.css:114`).
- `min(110px, 25%)` yields a ~52px strip at narrow widths.
- `.stage-tile-footer` took a DOM change in an earlier task.
- `.chat-members-btn` hides at ≥1200px.
- The members button's **`aria-expanded` was raised as a board question and never settled** — open
  for the closeout.

## One correction to the record

`probe-palette-messages2.js:47` cites `MessageSearch.css:245` for
`.message-search-result-text mark`. An orientation pass flagged this as stale, on the grounds that
the rule "is at `:248`/`:249`". **That is a false positive and the citation stands.** `:245` is the
selector line — the correct rule-level anchor; `color: var(--hl-ink)` and `background: var(--hl-bg)`
sit at `:248`–`:249` *inside* it. A rule is not located at its declaration lines, and rewriting it
would invert the trust-the-selector hardening T13 adopted after four genuine stale-citation defects.

Worth recording as the citation lesson's first over-application: a rule learned from real defects
began generating false ones.
