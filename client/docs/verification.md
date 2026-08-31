# Verification — gates, traps, evidence

How to prove a `client/` change is good. Design rules are in
[`design-system.md`](design-system.md).

## Environment facts (skipping these costs an hour)

- **Every npm/npx/node command runs from `client/`.** There is no root
  `package.json`, and stylelint's `importFrom` resolves relative to the cwd —
  a run from the repo root dies with an ENOENT stack that *looks like* lint
  output but isn't.
- **Start the dev server with `npm run dev:vite`, never `npm run dev`.** The
  `dev` script also launches Electron, which cannot start here (its
  postinstall was skipped; `dist` is a few hundred KB, not ~250MB), and
  `concurrently -k` kills vite along with it.
- **A stale dev server silently invalidates every visual claim.** Before
  trusting anything on :3000, confirm the server postdates the commit you
  think you are looking at.

## The gates

Run from `client/`. Expected results:

| Command | Invariant |
|---|---|
| `npx tsc --noEmit` | exit 0, **literally zero bytes** of output |
| `npx stylelint "src/**/*.css"` | exit 0, **literally zero bytes** of output |
| `npm run check:i18n` | «непереведённых строк не найдено.» |
| `npm test` | **exactly** 3 failures, all in `api.network-retry.test.ts` |

- "Zero bytes" means zero bytes (`> f 2>&1; wc -c f` → 0). If your terminal
  prints something like "No errors found", that is your output filter talking,
  not the tool — never record filter output as expected output.
- **Stylelint's zero is an invariant: any error is one you just added.** Two of
  its rules are load-bearing audits, not style preferences:
  - `csstools/value-no-unknown-custom-properties` is what keeps the deleted
    legacy-alias layer deleted. **A `var(--x, fallback)` silences it** — see
    design-system.md before adding any fallback.
  - `no-descending-specificity` was cleared by **reordering, not
    suppressing**, and one ordering (in `ChannelSidebar.css`, documented
    beside the rules) decides a real cascade tie. Don't reorder it back.
  - Want a machine-readable count? `npx stylelint "src/**/*.css" -f json 2>&1`
    — that formatter writes to **stderr**.
- **`npm test` is RED at baseline by design** and has been since M1: the 3
  failing tests in `src/services/__tests__/api.network-retry.test.ts` assert
  retry behaviour that was never implemented. **Never "fix" that file** — the
  gate is that no *other* file appears in a `FAIL` line.

## Visual verification

The CDP screenshot/probe harness lives at **`client/tools/verify/`** — read
its [README](../tools/verify/README.md) for setup (env-var credentials), flags,
and how to write a probe. Probes are written per task from
`tools/verify/probe-template.js`, not accumulated into a library.

Evidence rules that outlive any particular probe:

- **A failing probe still exits 0** — `smoke.mjs` catches probe errors and
  prints them (`PROBE ERROR: …`). Evidence is the printed output, never the
  exit code.
- **A probe is evidence only once it has been shown to fail** against the
  broken state it exists to catch. Break, observe the failure, restore.
- **To assert a token is live, resolve it on a scratch element** —
  `getComputedStyle(el)` after setting `background: var(--x)` — and include a
  negative control (a token that doesn't exist). Reading
  `getPropertyValue('--x')` off `:root` returns the declared string whether or
  not anything consumes it, and an always-true check is worse than none.
- **Assert presence before geometry.** A `display:none` element measures 0×0,
  and 0×0 arithmetic can read as a pass.
- Machine gates first, harness second, and finally **click through the change
  in both themes and at a narrow width** — the instruments only ever verify
  what they were pointed at.

## Counting against the API

`api.getMessages(channelId, limit = 50, offset = 0)` takes `limit`/`offset`
only — a `before=` param is silently ignored and the call re-reports page 1,
and the default limit of 50 caps any unpaginated read. Paginate explicitly
before counting anything.
