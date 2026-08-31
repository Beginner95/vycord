# Visual verification harness

The **engine** for verifying the client visually: `smoke.mjs` drives the system
Chrome over CDP, logs a smoke user in, seeds localStorage for the
`localhost:3000` dev origin, screenshots the app, and injects probe scripts
into the live page.

Only the engine is committed, deliberately. Probes are **written per task** —
copy `probe-template.js`, point it at what you are changing, delete it when the
task ships. The redesign accumulated ~200 probes and their measured fate was:
selectors rot within one milestone, dead probes keep printing green-looking
output, and auditing an old probe costs more than writing a fresh one. Do not
build a probe library here.

## Setup

Credentials come from the environment — this directory is committed, so they
are never hardcoded:

```bash
export VYCORD_SMOKE_EMAIL=...      # smoke-account login
export VYCORD_SMOKE_PASSWORD=...
export VYCORD_SMOKE_API=...        # optional; defaults to the prod API host
```

Put them in `client/tools/verify/.env` (gitignored) and `source` it, or export
them in your shell. `--anon` runs need none of this.

Start the dev server with **`npm run dev:vite`** from `client/` — `npm run dev`
dies here (Electron's postinstall was skipped; `concurrently -k` then kills
vite too). **A stale dev server silently invalidates every screenshot and probe
result**: confirm the server postdates the commit you think you are looking at.

## Usage

```bash
node smoke.mjs --out shot.png [flags]
```

| Flag | Effect |
|---|---|
| `--out <file.png>` | screenshot target (required) |
| `--theme light\|dark` | theme to seed (default light) |
| `--path /app` | route (default `/`) |
| `--wait <ms>` / `--after <ms>` / `--after2 <ms>` | settle delays |
| `--anon` | skip login (auth screens) |
| `--size WxH` / `--screen WxH` | viewport / screen-info |
| `--touch` | touch emulation |
| `--reduced-motion` / `--focus-emulation` | media emulation |
| `--click <sel>` / `--click2 <sel>` | click before shooting |
| `--type-into <sel>` + `--type-text <s>` | type before shooting |
| `--force-hover <sel>` / `--force-state <sel:state>` | CDP-forced pseudo-states |
| `--fake-media` | fake mic/cam (a full-scale beep every ~450 ms — NOT quiet) |
| `--fake-electron` | stub `window.electronAPI` (renderer branches only) |
| `--push-ws <file>` | inject WS events (e.g. `inject-voice-ws.js` for voice/call states) |
| `--eval-file <file>` / `--preload <file>` | arbitrary page / preload script |
| `--probe <file>` `--probe2 <file>` `--probe3 <file>` | inject probes, in order |

## Writing probes — the rules that were paid for

- **Start from `probe-template.js`.** Async IIFE, returns a summary object,
  every assertion goes through a **throwing** `fail()`.
- **A probe is evidence only once you have watched it fail against a broken
  page.** Break the thing on purpose, see it throw, then trust it. A probe
  that only collects and returns results is a reporter — reporters were cited
  as regression gates during the redesign and asserted nothing.
- **Assert presence before geometry.** A `display:none` element measures 0×0,
  and 0×0 arithmetic can read as a pass ("gaps equal → centred").
- **Dependent probes go in ONE invocation.** The `--probe` → `--probe2` →
  `--probe3` slots run in the same page session without reloading (that is the
  point: `requestFullscreen` and friends consume transient user activation).
  Two separate `smoke.mjs` runs cannot hand state to each other.
- **Probes that log in talk to a real server.** Anything that posts messages
  leaves residue on the smoke account — clean up in the probe, or point
  `VYCORD_SMOKE_API` at a local server.
- Machine checks come first, they are cheaper: `npx tsc --noEmit`, stylelint,
  and the tests (see `client/docs/verification.md`). The harness is for what
  those cannot see — and for what *it* cannot see, click through the app;
  that is what found the defects the probes missed.

## The old probe corpus

The redesign's ~200 probes and ~400 evidence screenshots live (untracked,
gitignored) in `.superpowers/sdd/2026-08-30-redesign-m6-polish/tools/` on the
machine that ran M6, and in `docs/superpowers/` history. They are archaeology:
unaudited, two rival assertion conventions, some assert nothing. Reach for one
as raw material if it saves you typing — never cite one as a gate without
re-verifying it fails when it should.
