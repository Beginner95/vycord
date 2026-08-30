# VYCORD — repo contract

Repo-wide facts only. Client-specific rules live in `client/CLAUDE.md`; read that
one too before touching anything under `client/`.

Every claim below was re-verified against the tree on **2026-08-30** at
`bab71ef`. Where a number can drift, it is dated — re-measure, do not assume.

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
  had been structurally incapable of firing for five milestones.) As of
  2026-08-30 the gate is empty: `redesign` contains all of `origin/develop`
  (`a328a11`).
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

Run from `client/`. Expected results as of 2026-08-30, re-measured at M6 T3:

```bash
npx tsc --noEmit                 # exit 0, no output
npm run check:i18n               # "непереведённых строк не найдено."
npm run lint:css 2>&1 | tail -3  # ✖ 51 problems
npm test 2>&1 | tail -6          # Test Files 1 failed | 35 passed (36)
                                 # Tests      3 failed | 227 passed (230)
```

**`npm test` is RED at baseline and has been since M1.** Exactly 3 tests in
`src/services/__tests__/api.network-retry.test.ts` were merged without their
implementation:

- `request(): retries once after fetch() itself rejects, and succeeds`
- `request(): propagates the error if the retry also fails (no infinite retry)`
- `requestForm(): retries once after fetch() itself rejects, and succeeds`

**Never "fix" that file** to make the suite green — the retry behaviour it
asserts does not exist, and writing it is a behaviour change nobody asked for.
The gate is that **no other file appears in a `FAIL` line**.

The `51` is a **dated baseline, not an invariant** — it has moved twice in M6
alone: `188` → `54` (T2's `stylelint --fix` notation normalisation) → `51` (T3
cleared the 2 `csstools/value-no-unknown-custom-properties` in `UserList.css` and
suppressed the 1 `no-duplicate-selectors` in `tokens.css`). Re-measure rather than
reasoning arithmetically from it.

The earlier note that "118 of the 188 live in `src/styles/tokens.css`" is **no
longer true and no longer the right warning**: `tokens.css` now lints clean, and
T2's rewrite is what removed those. As measured at M6 T3, all 51 are in five
files and split across exactly two rules:

| Rule | Count | Where |
|---|---|---|
| `selector-class-pattern` | 43 | `ChannelSidebar.css` 16 · `ServerList.css` 14 · `UserList.css` 12 · `TitleBar.css` 1 |
| `no-descending-specificity` | 8 | `ChannelSidebar.css` 6 · `UserList.css` 1 · `Auth.css` 1 |

Check the **breakdown**, not just the total: a total reached by a different mix
hides a new warning offsetting a cleared one. M6 T13 moves this figure again when
it deletes the legacy-alias block.

## Never `git add -A`

`design_handoff_discord_redesign/` is untracked and is **not** in `.gitignore` —
it is deliberately outside version control while remaining on disk. `git add -A`
or `git add .` from the repo root sweeps it in. Always `git add` explicit paths.
