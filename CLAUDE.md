# VYCORD — repo contract

Repo-wide facts only. Anything under `client/` — design system, gates,
verification — is routed by `client/CLAUDE.md`; read it before touching the
client.

> **Project state: the frontend redesign is FINISHED** (M0–M6 shipped on the
> `redesign` branch; closeout at
> `docs/superpowers/plans/2026-08-30-redesign-m6-closeout.md`). **The branch is
> not yet integrated** — that is a human decision: merge `origin/develop` into
> `redesign`, open a PR into `develop`, **never rebase** (see
> `docs/superpowers/REDESIGN-RESUME.md` §0). Until then `redesign` is where the
> current UI lives and `develop` is not.

## Layout

| Path | What |
|---|---|
| `client/` | React 19 + Vite 8 + Zustand 5 + TypeScript, packaged with Electron |
| `client/docs/` | design-system and verification rules for UI work |
| `client/tools/verify/` | CDP visual-verification harness (engine only; see its README) |
| `server/` | Go (`module github.com/vycord/server`) |
| `deploy/` | deploy scripts, nginx config, coturn hooks |
| `docs/superpowers/` | `specs/`, `plans/`, `backlog/`, `REDESIGN-RESUME.md` |
| `design_handoff_discord_redesign/` | design boards — **untracked on purpose** |

**There is no root `package.json`** — every `npm` / `npx` / `node` command runs
from `client/` (stylelint's config resolves paths against the cwd and dies from
the repo root with a stack that looks like lint output). Dev server:
`npm run dev:vite`, not `npm run dev`. Both traps are detailed in
`client/docs/verification.md`.

## Branches

- **`develop` is the trunk. `main` is dormant** (`origin/main` has not moved
  since the branch point). There is no local `develop` in this clone, so new
  work branches with `git checkout -b <name> origin/develop`.
- **The drift gate** — the `fetch` is load-bearing; without it the gate reads a
  stale remote-tracking ref and reports "no drift" regardless:
  ```bash
  git fetch --all --prune && git log --oneline redesign..origin/develop
  ```
  (Empty at M6 close, 2026-08-31 — a result that expires; re-run it.)
- **`redesign` is long-lived and published** (`origin/redesign` exists). It
  releases as a single version. **Never rebase it** — merge from
  `origin/develop`. Any document claiming the branch is unpushed is out of
  date; check `git rev-parse origin/redesign` before believing it.

## Gates

### Server (Go)

Driven by the root `Makefile` (it `cd server` internally — run from repo root):
`make test` · `make vet` · `make lint` · `make build`. **No baseline is
recorded**: the Go toolchain was absent in the environment this file was
written in and the redesign authored no Go changes. Measure before treating any
result as a regression.

### Client

Run from `client/`; full detail and traps in `client/docs/verification.md`:

| Command | Invariant |
|---|---|
| `npx tsc --noEmit` | exit 0, zero bytes of output |
| `npx stylelint "src/**/*.css"` | exit 0, zero bytes — **zero is an invariant; any error is yours** |
| `npm run check:i18n` | «непереведённых строк не найдено.» |
| `npm test` | RED by design: exactly 3 failures, all in `api.network-retry.test.ts` — **never "fix" that file**; the gate is that no other file fails |

## Never `git add -A`

`design_handoff_discord_redesign/` is untracked and **not** in `.gitignore` —
deliberately outside version control while staying on disk. `git add -A` or
`git add .` from the repo root sweeps it in. Always `git add` explicit paths.
