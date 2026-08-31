# `client/` — start here

Read `../CLAUDE.md` first for repo-wide facts (layout, branches, gates).

React 19 + Vite 8 + Zustand 5 + TypeScript, plain per-component CSS,
`lucide-react` icons, Vitest. Packaged with Electron.

## Router

| If you are… | Read |
|---|---|
| Touching anything visual — tokens, CSS, components, overlays, motion, i18n | [`docs/design-system.md`](docs/design-system.md) |
| Verifying a change — gates, screenshots, probes, evidence rules | [`docs/verification.md`](docs/verification.md) |
| Running the visual harness | [`tools/verify/README.md`](tools/verify/README.md) |
| After the *why* behind a rule (measurements, history) | `../docs/superpowers/plans/2026-08-30-redesign-m6-closeout.md` and the M0–M6 plans |

## The four facts that cost the most when skipped

1. **Every npm/npx/node command runs from `client/`** — there is no root
   `package.json`, and stylelint from the repo root dies with an ENOENT stack
   that looks like lint output.
2. **Dev server: `npm run dev:vite`** for browser work — `npm run dev` also
   launches Electron under `concurrently -k`, so an Electron that fails to
   start in your environment takes vite down with it. A stale dev server
   silently invalidates every visual claim — check it postdates your commit.
3. **Gates: `npx tsc --noEmit` and `npx stylelint "src/**/*.css"` must produce
   zero bytes; `npm test` fails exactly 3 tests, all in
   `api.network-retry.test.ts`, by design — never "fix" that file.** Details
   and traps: `docs/verification.md`.
4. **Design is a closed system**: canonical tokens only (no raw colours, no
   12px radius, no z-index literals, no unrequested `var()` fallbacks),
   `component-thing` class names, primitives before new controls, the overlay
   contract for anything floating. Details: `docs/design-system.md`.

When you finish something visual: gates green, then **click through it in both
themes at a narrow width** — the instruments only verify what they were
pointed at.
