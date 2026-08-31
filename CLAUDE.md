# VYCORD — repo contract

Repo-wide facts only. Client-specific rules live in `client/CLAUDE.md`; read that
one too before touching anything under `client/`.

Every claim below was re-verified against the tree on **2026-08-31**, at M6's
close (`e608a0d`). Where a number can drift, it is dated — re-measure, do not
assume.

> **Project state: the frontend redesign is FINISHED.** M0–M6 have all shipped on
> the `redesign` branch; the closeout is
> `docs/superpowers/plans/2026-08-30-redesign-m6-closeout.md`. **The branch has
> not been integrated** — that is a human decision, and the instruction is in
> §0 of `docs/superpowers/REDESIGN-RESUME.md`: merge `origin/develop`, open a PR
> into it, **never rebase**. Until that happens, `redesign` is where the current
> UI lives and `develop` is not.

## Layout

| Path | What |
|---|---|
| `client/` | React 19 + Vite 8 + Zustand 5 + TypeScript, packaged with Electron |
| `server/` | Go (`module github.com/vycord/server`) |
| `deploy/` | deploy scripts, nginx config, coturn hooks |
| `docs/superpowers/` | `specs/`, `plans/`, `backlog/`, `REDESIGN-RESUME.md` |
| `design_handoff_discord_redesign/` | design boards — **untracked on purpose** |

**There is no root `package.json`.** Every `npm` / `npx` / `node` command runs
from `client/`. This is not a style preference: `.stylelintrc.json` sets
`importFrom: ["src/styles/tokens.css", "src/styles/base.css"]`, which stylelint
resolves **relative to the cwd**, so a run from the repo root dies with
`Error: ENOENT: no such file or directory, open '<repo>/src/styles/tokens.css'`
followed by a stack trace. That failure prints on stdout/stderr and looks like
lint output; it is not. Always `cd client` first, and pipe `2>&1`.

**Start the dev server with `npm run dev:vite`, not `npm run dev`.** The `dev`
script runs vite and Electron under `concurrently -k`; Electron throws
`Electron failed to install correctly` here — npm 11's `allowScripts` skipped its
postinstall, so `node_modules/electron/dist` is **236K** instead of ~250MB — and
`-k` then kills vite along with it, so the server never comes up. Fixable for
real with `npm install-scripts ls` in `client/`, if you need Electron itself.

**A stale dev server invalidates every visual claim you make**, and one was found
alive four separate times during M6. Restart it, and check that it postdates the
commit you think you are looking at.

## Branches

- **`develop` is the trunk. `main` is dormant.** `origin/main` is
  `d17bddd` and is an ancestor of `redesign` — it has not moved since the branch
  point. Branch new work from **`origin/develop`**: there is no local `develop`
  in this clone, so `git checkout -b <name> develop` fails and
  `git checkout -b <name> origin/develop` is the working form.
- Local `main` (`fbd6861`) is `origin/main` + 3 unpushed redesign-doc commits,
  all of them ancestors of `redesign`. It is the branch point, not a target.
- **The drift gate is:**
  ```bash
  git fetch --all --prune && git log --oneline redesign..origin/develop
  ```
  The `fetch` is load-bearing — without it the gate reads a stale remote-tracking
  ref and reports "no drift" whatever the trunk did. (M5.5 T1/T2 found this gate
  had been structurally incapable of firing for five milestones.) **Re-run with a
  real fetch on 2026-08-31 at M6 close: still empty** — `redesign` contains all
  of `origin/develop` (`a328a11`).
- **`redesign` is long-lived and published.** `origin/redesign` exists at
  `2dc4974` and is an ancestor of local `redesign`. It releases as a single
  version. **Never rebase it** — merge from `origin/develop` instead. Any
  document telling you the branch is unpushed is out of date; check
  `git rev-parse origin/redesign` before believing it.

## Gates

### Server (Go)

Driven by the root `Makefile`, which `cd server` internally — run them from the
repo root:

```bash
make test    # cd server && go test -v ./...
make vet     # cd server && go vet ./...
make lint    # cd server && golangci-lint run
make build   # cd server && go build -o ../bin/server ./cmd/api
```

**No baseline is recorded for these.** The Go toolchain is not installed in the
environment this file was written in (`which go` → not found), and the
`redesign` branch authors no Go changes, so the numbers were never measured.
Measure them yourself before treating any result as a regression.

### Client

Run from `client/`. Expected results as of 2026-08-31, re-measured at M6 T13:

```bash
npx tsc --noEmit                    # exit 0, no output
npm run check:i18n                  # "непереведённых строк не найдено."
npx stylelint "src/**/*.css"        # exit 0, no output
npm test 2>&1 | tail -6             # Test Files 1 failed | 37 passed (38)
                                    # Tests      3 failed | 254 passed (257)
```

**Both "no output" lines mean literally zero bytes** — measured with
`npx tsc --noEmit > f 2>&1; wc -c f` → `0`. If your terminal prints something
like `TypeScript: No errors found`, that is **your output filter, not `tsc`**;
do not write it into this file as expected output. (It was, once, by M6 T13, and
was corrected in the same commit.)

The stylelint line is `npx stylelint` rather than `npm run lint:css` on purpose:
the npm script prints a two-line banner of its own, so `npm run lint:css | tail -3`
shows the banner and a blank line even when stylelint is silent — output that
looks like a result and is not.

**`npm test` is RED at baseline and has been since M1.** Exactly 3 tests in
`src/services/__tests__/api.network-retry.test.ts` were merged without their
implementation:

- `request(): retries once after fetch() itself rejects, and succeeds`
- `request(): propagates the error if the retry also fails (no infinite retry)`
- `requestForm(): retries once after fetch() itself rejects, and succeeds`

**Never "fix" that file** to make the suite green — the retry behaviour it
asserts does not exist, and writing it is a behaviour change nobody asked for.
The gate is that **no other file appears in a `FAIL` line**.

**The stylelint number is now ZERO, and unlike every figure before it, zero IS
an invariant.** It moved four times in M6: `188` → `54` (T2's
`stylelint --fix` notation normalisation) → `51` (T3 cleared the 2
`csstools/value-no-unknown-custom-properties` in `UserList.css` and suppressed
the 1 `no-duplicate-selectors` in `tokens.css`) → `8` (T9 and T10 cleared 43
`selector-class-pattern`) → **`0`** (T13 deleted the 47 legacy aliases with all
66 references, cleared the last 4 raw colour values, and reordered the 8
`no-descending-specificity` rules by ascending specificity).

Because it is zero, **any error is one you just added** — there is no debt to
subtract from and no arithmetic to do. Two of the rules at zero are load-bearing
audits rather than style preferences, and both are documented in
`client/CLAUDE.md` §1:

- `csstools/value-no-unknown-custom-properties` is what keeps the legacy-alias
  layer deleted. It only sees `tokens.css` and `base.css`, and **a
  `var(--x, fallback)` silences it** — so do not add a fallback you were not
  explicitly told to add.
- `no-descending-specificity` was cleared by **reordering, not suppressing**. One
  of those reorders changes which rule wins a real equal-specificity tie — and
  that is the point: it makes `ChannelSidebar.css`'s dark focus state resolve
  correctly on its own, where before it depended on a lower rule to correct it.
  The ordering note in that file names the three rules and the measurement. Do
  not reorder them back.

The per-rule breakdown that used to live here is gone with the errors it counted.
For the record, the last non-zero census — measured at M6 T3, then cleared by T9,
T10 and T13 — was:

| Rule | Count at M6 T3 | Where | Cleared by |
|---|---|---|---|
| `selector-class-pattern` | 43 | `ChannelSidebar.css` 16 · `ServerList.css` 14 · `UserList.css` 12 · `TitleBar.css` 1 | T9 (13), T10 (30) |
| `no-descending-specificity` | 8 | `ChannelSidebar.css` 6 · `UserList.css` 1 · `Auth.css` 1 | T13 (8) |

**With the total at zero there is no breakdown to check, which makes the gate
simpler and stricter, not laxer.** Previously a total reached by a different mix
could hide a new warning offsetting a cleared one; now any output at all is a
regression. Run it with `-f json` and pipe `2>&1` — that formatter writes to
**stderr** — if you want a count rather than a diff of the human output.

## Never `git add -A`

`design_handoff_discord_redesign/` is untracked and is **not** in `.gitignore` —
it is deliberately outside version control while remaining on disk. `git add -A`
or `git add .` from the repo root sweeps it in. Always `git add` explicit paths.
