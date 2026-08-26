# Redesign M3 — Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the group-call stage (board `1e`/`2e`) on the `stage` tokens — top bar with live pill + timer, responsive tile grid, name plates with mic/equalizer, level-driven speaking ring, labeled control bar with danger «Выйти» pill — plus the screen-share view + picker, the quality tooltip, the restyled 1:1 `CallUI` overlay, and the mobile voice banner (board `1f`).

**Architecture:** `CallStage.tsx` keeps its structure (store-driven, mounts only when the open channel is the call channel) but its JSX is re-skinned and `CallStage.css` is rewritten across three tasks (grid view → focused view → picker extraction), mirroring M2's carried-legacy-block approach so the app stays functional at every commit. `ScreenSharePicker` gets its own CSS file (closing the spec-§3 extraction hazard). `CallUI` is rewritten on a new `p2p-*` namespace. New shared code: `hooks/useMicLevel.ts` (extracted, not new — the existing speaking detection), `utils/callStage.ts` (timer format + grid class, TDD), `callStore.startedAt`. **No changes to `src/services/`** — the speaking ring and equalizer are driven by the already-existing `useMicLevel` analyser and the `> 0.05` threshold.

**Tech Stack:** React 19 + Vite + Zustand + plain per-component CSS, lucide-react icons, vitest, stylelint 17, CDP smoke harness with `--fake-media`.

**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` (§5 M3 bullet; §2 Voice UI, §3 current-state facts, §7 out of scope). Pixel source of truth: `design_handoff_discord_redesign/README.md` — section "6. Group call — option 1e (base) / 2e (speaking indication)" and the voice-banner block of "7. Mobile chat — option 1f". Also binding: `docs/superpowers/plans/2026-08-25-redesign-m2-closeout.md` (decisions 1–17, deferred-finding triage, stylelint baseline history, harness notes).

## Global Constraints

- Branch `redesign` only; one commit per task; **never** commit to `main`; **never** `git add -A` (`design_handoff_discord_redesign/` is untracked on purpose).
- No changes under `server/`; no API/WS contract changes; **no changes to `src/services/`** (WebRTC, noise cancellation, echo cancellation — M3 restyles, it does not touch the audio path); `src/types/index.ts` untouched; `client/e2e/` untouched (verified: those tests drive `groupCallService` directly and reference **no** UI selectors — class renames are safe). Legacy token aliases in `src/styles/tokens.css` stay until M6.
- All work under `client/`. Product copy is Russian; every new string lands in `src/i18n/locales/ru.ts` **and** `en.ts` together; `npm run check:i18n` stays exit 0 (its 4 ErrorBoundary warnings are M4's). Plural strings render via `tp()`/`useTp()` — `t()` renders the literal key for plural entries.
- Icons: lucide-react, `strokeWidth={1.8}`, 16–21px. No emoji as UI icons, no hand-inlined SVGs in touched code (CallStage/CallUI currently use both — all replaced).
- Animation budget ≤250ms ease-out for transitions. State loops (speaking ring 1.4s fallback, equalizer 0.7s, incoming-call pulse) are board-sanctioned loops, exempt like typing dots; M6 owns their `prefers-reduced-motion` handling.
- **Test delta-gate:** `npm test` baseline is RED by design — exactly 3 failures + 2 unhandled rejections, all in `src/services/__tests__/api.network-retry.test.ts`. Current shape: `Test Files 1 failed | 21 passed (22)`, `Tests 3 failed | 138 passed (141)`. Gate: no *other* file may fail; new tests must pass; never fix that file.
- **Stylelint delta-gate:** total from `npm run lint:css` must never exceed **531** (T13 confirmed zero headroom); every file M3 creates or rewrites must be individually 0 problems (`cd client && npx stylelint <file>`). Stylelint **must run from `client/`** — `importFrom` is cwd-relative and crashes with `ENOENT` from the repo root, which is not a lint result. `--formatter json` output goes to **stderr** — pipe with `2>&1`, never `2>/dev/null`. Do NOT mass-fix legacy files; M6 owns that sweep.
- Class names: multi-segment kebab-case with a component prefix; state modifiers `is-*`/`has-*`; **never** BEM `--`/`__` (the current CallStage/CallUI classes are full of both — all renamed). Singles allowlist is only `btn|input|kbd|modal|mention`.
- New/rewritten CSS files must use media-query **range syntax** (`(width <= 768px)`) — `media-feature-range-notation` requires it (closeout ruling 17; the Safari <16.4 exposure is an accepted, human-surfaced risk M6 resolves).
- JS-injected custom properties are invisible to stylelint's `importFrom` — every CSS reference to `--speak-level` (new, set inline from JSX) must be `var(--speak-level, 0)`.
- **Raw-value rule for M3-owned files:** after M3, `rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' CallStage.css CallUI.css ScreenSharePicker.css VoiceBanner.css VolumeControlPopover.css` must return **zero** rows — these files hold the largest raw-value concentrations in the codebase (20 hex + 40 rgba / 21 rgba) and M6's alias-deletion audit requires the codebase-wide grep outside `tokens.css` to come up empty.
- Visual verification: CDP harness `tools/smoke.mjs` (Task 1 copies it into this milestone's workspace). Flags: `--out --theme --anon --click --after --type-into/--type-text --fake-electron --probe --preload --push-ws --touch --fake-media`. `--fake-media` (synthetic mic/camera + auto-granted permission + autoplay) lets a smoke run **actually join a voice channel**; the fake mic emits a tone, so the local speaking path is live-verifiable. `--touch` = `setTouchEmulationEnabled` + `setDeviceMetricsOverride {mobile:true}`. WS injection uses `dispatchEvent`. Probe scripts may be async. Dev server: `cd client && npm run dev:vite` → http://localhost:3000 **exactly** (prod CORS allowlist; the 3001 fallback fails login with a CORS error that is not a bug). Test account `redesign_smoke@vycord.local` / `RedesignSmoke2026!`, throwaway server «Redesign Smoke» — production API, destructive testing only there. A **stale dev server invalidates visual evidence** — compare server start time against HEAD's commit timestamp before trusting any screenshot.
- **Fail-first probes (M2's process lesson, mandatory):** every verification probe must be written and run against the **pre-task** state first and must fail **loudly** there (e.g. "selector `.stage-grid` not found"), before its post-task pass is trusted. Six M2 probes gave false passes because their design never exercised the path under test. A probe that quietly records a string/null for a missing selector is broken — assert and throw.
- Electron cannot launch (npm 11 skipped its postinstall) — Electron-only paths (`api.toggleFullscreen`, `getScreenSources` source picker) are verified statically.

## Decisions ruled on while planning (binding for this milestone)

1. **Raw hex/rgba conversion happens in M3, not M6.** CallStage.css and CallUI.css are rewritten by M3, so the clean-file gate applies to them in full; deferring their ~80 raw values to M6 would mean M6 rewriting call CSS it doesn't own. A small **canonical stage token block** is added to `tokens.css` (Task 1) for the values the handoff specs verbatim; everything else maps to existing tokens. The stage is dark in **both** themes, so stage tokens are theme-invariant (`:root` only, no `[data-theme="dark"]` override). `tokens.css` changes are additions only — no alias touched.
2. **Class namespaces.** `CallStage.css` owns `stage-*`; the root class **`.call-stage` is retained as a documented exception** — it is the cross-file contract with `AppPage.css`'s split/fullscreen/mobile rules (lines 26, 57, 194–204) and is lint-legal; renaming it buys nothing and risks the split. `ScreenSharePicker.css` (new) owns `screen-picker-*` + `screen-quality-*` (two-segment namespaces, same precedent as M2's `sticker-picker-`). `CallUI.css` owns `p2p-*` (the 1:1 peer-call overlay). `CallDock.css` (`call-dock-*`) and `VolumeControlPopover.css` (`volume-popover-*`) keep their names. The current cross-file duplicates between CallStage.css and CallUI.css (`.mic-badge`, `.control-btn`, `.call-controls`, `.mic-btn-wrap`, `.speaking`, `.local-video`, `.end-call`) all disappear with the renames.
3. **Control-bar recipe is duplicated, not lifted to primitives.** CallUI's active-call control bar reuses the stage recipe's *values* under `p2p-*` names (~30 duplicated lines). `primitives.css` is not touched — M2's ruling 13 holds it flat at 21 violations, and M4 owns that layer; the T8 error-toast lift was a forced exception, this is not.
4. **Grid columns are class-driven, not inline-styled.** Board: 1 column ≤1 participant, 2 columns ≤4, 3 beyond. `stageGridClass(total)` (Task 2) returns `'is-solo' | '' | 'is-many'`; the inline `gridTemplateColumns` style is deleted. Adaptation: `@media (width <= 640px)` forces 1 column (two 16:9 tiles side-by-side at 390px would be unusably small; the board's `1e` is desktop-only).
5. **Timer needs `callStore.startedAt`** (`number | null`, set `Date.now()` on successful join, reset to `null` by `idle()`). Same authorized-scope-addition class as M2's `serversLoaded`. `stores/` is not `services/` — the constraint is untouched. CallUI's 1:1 timer keeps its existing local seconds counter (its call state never enters `callStore`).
6. **The speaking ring is level-driven via a CSS custom property.** Each tile sets `style={{'--speak-level': Math.min(1, level)}}` from the **existing** `useMicLevel` value and gets `is-speaking` at the existing `> 0.05` threshold. Ring: `box-shadow: 0 0 0 calc(2px + var(--speak-level, 0) * 4px) var(--speak-ring)` — the board's "ring radius maps level 0→1 to 2→6px" production note, implemented with zero new audio code. The board's 1.4s `ring` keyframe is the static-board fallback and is **not** shipped. The 3-bar equalizer in the name plate animates `stage-eq-bar` 0.7s staggered .12s (board-sanctioned loop).
7. **`useMicLevel` is extracted to `hooks/useMicLevel.ts`** — it is duplicated verbatim-modulo-one-dead-ref between CallStage.tsx and CallUI.tsx today. Extraction is a move of existing detection, not new audio code (CallStage's copy wins; CallUI's has an unused `ctxRef`). Both files import it.
8. **The mic-level halo on the mic button (`.mic-btn-wrap::before`) is dropped** in both CallStage and CallUI. The board's control bar has no halo; speaking feedback lives on the tiles (ring + equalizer + plate). The floating circular `.mic-badge` is absorbed into the name plate (mic icon / equalizer / `MicOff`).
9. **Top-bar content (board `1e`), adapted:** live pill («В ЭФИРЕ» + timer), title = `#channelName` (the «Групповой звонок» prefix is dropped — the live pill already carries the "this is a call" signal; `call.groupCallTitle` remains as the null-channel fallback), counter chip (existing `tp('call.participants', n)`), fullscreen 32×32. **`.header-screen-share-indicator` is dropped** — redundant with the share banner and the per-tile badge (its i18n key stays, M4-cleanup precedent). The mobile back button stays, restyled as `.stage-back-btn` (lucide `ArrowLeft`), 40×40 on mobile per the ≥40px floor.
10. **Top-bar fullscreen targets the whole stage.** New `stageRef` on the `.call-stage` root; browser path `requestFullscreen` on it, Electron path unchanged (`api.toggleFullscreen`); an `is-fullscreen` class lands on the root while active. `AppPage.css`'s `:has(.screen-share-main.is-fullscreen)` selectors are updated in Task 4 to the renamed `.stage-focus-main` **and** extended to also match `.call-stage.is-fullscreen` (Electron OS-fullscreen must still expand the stage over the chat split). The focused-view hover controls keep their own fullscreen button.
11. **The three `alert()` calls in the screen-share flow are replaced** with the shared `.error-toast` primitive (local `stageError` state + 5s auto-dismiss, mirroring CallUI's existing pattern). `alert()` cannot be restyled and a styled toast for the same job already exists. Strings unchanged.
12. **Tile corner layout** (the board specs only plate + state chip; the rest is existing functionality kept): name plate bottom-left; «камера выкл.» state chip bottom-right; connection indicator top-right (persistent); focus button top-right left of it (hover-revealed); volume button top-left (hover-revealed). All chips on `--stage-plate`/`--stage-chip` surfaces.
13. **Quality tooltip** (portaled to `document.body`) restyles onto the design system's theme-adaptive popover surface: `--canvas` bg, `--line` border, `--shadow-menu`, r10 — not stage-dark, because it floats above the app like every other popover. Level colors: good `--online`, medium `--warning` (new canonical token, Task 1), poor `--danger`, unknown `--muted-2`.
14. **Reconnecting banner** restyles token-only: bg `--stage-bar`, border `1px solid var(--warning)`, text `--warning` (solid amber bg would need a raw dark-ink literal, breaking the raw-value rule).
15. **Off/on states for control toggles** (board says only "off-state icons carry a slash"): `.is-off` = solid `--danger` bg, white icon, `MicOff`/`VideoOff`; screen toggle `.is-on` = solid `--accent` bg, white icon while sharing. Disabled = opacity .4 (unchanged behavior: mic disabled when `!isMicAvailable`, camera disabled while sharing).
16. **`call.youSuffix` value changes `'(Вы)'` → `'(вы)'`** (en `'(you)'`) — board `1e` name plates read "shaldashk (вы)"; lowercase matches the chat's «вы» chip.
17. **M2 open decision 1 — toast entrance 0.22s: CONFIRMED.** M3 owns CallUI and keeps the unified `.error-toast` recipe at 0.22s. **M2 open decision 2 — `--radius-row` on the toast: stays deferred to M6** (M3 does not touch the primitive).
18. **CallUI restyle scope:** incoming modal per the modal system (r16, `--shadow-modal`, 180ms `modalIn` entrance replacing the 0.3s `scaleIn`; 74px r26 `--accent-soft` squircle tile with a lucide `Phone`, pulse loop kept as kebab `p2p-pulse`); accept = solid `--online` `Phone`, reject = solid `--danger` `PhoneOff`, both 52px circles (round is correct — these are actions, not avatars); active overlay on `--stage`, local PiP 220×160 r14, plates + level-driven speaking rings identical in recipe to the stage, control bar = stage recipe minus the screen toggle. `top: 40px` (TitleBar) unchanged.
19. **Mobile voice banner (board `1f`), adapted to unified channels (spec §2):** shows in ChatArea (mobile widths only, CSS-gated) when the **current channel** has an active voice session (`voiceParticipants.get(channel.id)` non-empty). Button: «Войти» → `onJoinVoice(channel)` when not in this call; «К звонку» → `onShowCall()` when already in it. Desktop keeps the sidebar voice card + header join button; the banner is `display: none` above 768px.
20. **Rebase check, not rebase:** spec §8 wants a rebase on `main` at each milestone boundary; `main` has not moved since branch creation. Task 1 verifies `git log redesign..main` is empty and records that; no rebase task.

## File structure after M3

```
client/src/
  components/
    CallStage.tsx           (rewritten JSX: stage-* classes, top bar, plates, controls, toast)
    CallStage.css           (rewritten: stage-* + .call-stage root only)
    CallUI.tsx              (rewritten JSX: p2p-* classes, lucide icons)
    CallUI.css              (rewritten: p2p-*)
    ScreenSharePicker.tsx   (imports own CSS — extraction hazard closed)
    ScreenSharePicker.css   (new: screen-picker-* / screen-quality-*, restyled)
    VoiceBanner.tsx/.css    (new: voice-banner-* — board 1f, mobile-only)
    VolumeControlPopover.css (rewritten: token-only popover surface)
    ChatArea.tsx            (modified: renders VoiceBanner; new voiceParticipants prop)
  hooks/
    useMicLevel.ts          (new: extracted existing speaking detection)
  stores/
    callStore.ts            (modified: + startedAt)
  utils/
    callStage.ts            (new) + callStage.test.ts
  styles/
    tokens.css              (modified: + stage token block, --warning; NO alias changes)
  pages/
    AppPage.tsx             (modified: passes voiceParticipants to ChatArea)
    AppPage.css             (modified: fullscreen :has selectors only — legacy file, no sweep)
```

---

### Task 1: Workspace, harness, stage tokens, baselines

**Files:**
- Modify: `client/src/styles/tokens.css` (additions only, before the LEGACY ALIASES block)
- Not in git: milestone workspace + harness copy

**Interfaces:**
- Produces: the canonical stage tokens every later task's CSS consumes: `--stage-line`, `--stage-chip`, `--stage-toggle`, `--stage-bar`, `--stage-plate`, `--stage-ink`, `--stage-muted`, `--live-pill-bg`, `--live-pill-text`, `--speak-ring`, `--warning`. Also: recorded pre-M3 baselines (lint total, test shape, before-screenshots).

- [ ] **Step 1: Preserve the harness**

```bash
mkdir -p .superpowers/sdd/2026-08-25-redesign-m3-calls/tools
cp -R .superpowers/sdd/2026-08-25-redesign-m2-chat/tools/. .superpowers/sdd/2026-08-25-redesign-m3-calls/tools/
```

Known-stale probes (closeout, do not cite as evidence): `probe-t11-flow.js`'s `toastPresent` queries the deleted `.chat-error-toast`; `probe-servermenu.js` needs `--click .channel-header-menu --after 800`; `probe-chat.js:150` currently points correctly at `.composer-input` but silently records rather than failing when stale — re-verify before reuse.

- [ ] **Step 2: Verify branch state + main drift**

```bash
git rev-parse --abbrev-ref HEAD        # must be: redesign
git log --oneline redesign..main       # must be empty (decision 20); if NOT empty, STOP and surface
```

- [ ] **Step 3: Add the stage token block to `tokens.css`**

Insert immediately after the `/* ── Call stage ── */` group (which already holds `--stage`, `--stage-tile`, `--stage-tile-2`), extending that group — matching the file's alignment style:

```css
  /* Stage chrome is dark in BOTH themes (board 1e) — these do not flip in [data-theme="dark"]. */
  --stage-line:   rgba(255, 255, 255, 0.08);
  --stage-chip:   rgba(255, 255, 255, 0.08);
  --stage-toggle: rgba(255, 255, 255, 0.1);
  --stage-bar:    #171B26;
  --stage-plate:  rgba(6, 8, 14, 0.66);
  --stage-ink:    #FFFFFF;
  --stage-muted:  #C9CFDE;
  --live-pill-bg:   rgba(18, 183, 106, 0.14);
  --live-pill-text: #5BE39B;
  --speak-ring:     rgba(18, 183, 106, 0.55);
```

And in the `/* ── Status ── */` group, after `--danger-text`:

```css
  --warning: #F59E0B;
```

No `[data-theme="dark"]` entries for any of these. Do not touch the alias block.

- [ ] **Step 4: Record baselines (all from `client/`)**

```bash
cd client && npm run lint:css 2>&1 | tail -3     # total must still be ≤ 531 — record exact number
npx stylelint src/styles/tokens.css 2>&1 | tail -2   # must not have GAINED violations vs pre-edit (run before AND after the edit)
npx tsc --noEmit && npm test                     # RED baseline shape: 3 failures, all api.network-retry
npm run check:i18n                               # exit 0, 4 ErrorBoundary warnings
```

- [ ] **Step 5: Capture BEFORE screenshots of the call surfaces** (evidence anchor for every later fail-first probe)

Start `npm run dev:vite` (port 3000). Then:

```bash
node tools/smoke.mjs --fake-media --probe tools/probe-callstate.js --out m3t1-stage-before-light.png
node tools/smoke.mjs --fake-media --theme dark --out m3t1-stage-before-dark.png
```

(`probe-callstate.js` exists from M1/M2 — it joins voice on the smoke server; verify its selectors still match before trusting, per the harness rule. If it is stale, join by `--click` on the chat header's `.chat-voice-btn` instead and record that.)

- [ ] **Step 6: Commit**

```bash
git add client/src/styles/tokens.css
git commit -m "feat(redesign): canonical stage-chrome tokens + --warning (theme-invariant, board 1e)"
```

---

### Task 2: callStage utils (TDD) + `startedAt` + useMicLevel extraction

**Files:**
- Create: `client/src/utils/callStage.ts`, `client/src/utils/callStage.test.ts`, `client/src/hooks/useMicLevel.ts`
- Modify: `client/src/stores/callStore.ts`, `client/src/components/CallStage.tsx` (import swap only), `client/src/components/CallUI.tsx` (import swap only)

**Interfaces:**
- Produces:
  - `utils/callStage.ts`: `export function formatCallDuration(ms: number): string` — `'MM:SS'` zero-padded, hours roll over to `'H:MM:SS'` (unpadded hours); negative/NaN clamp to `'00:00'`. `export function stageGridClass(total: number): '' | 'is-solo' | 'is-many'` — `total <= 1` → `'is-solo'`, `total <= 4` → `''`, else `'is-many'`. `export const SPEAKING_THRESHOLD = 0.05;`
  - `hooks/useMicLevel.ts`: `export function useMicLevel(stream: MediaStream | null, isMuted: boolean): number` — byte-for-byte the current CallStage.tsx implementation (lines 20–61), comments included; CallUI's near-duplicate (with its dead `ctxRef`) is deleted.
  - `callStore.ts`: `startedAt: number | null` added to `CallState` and to the `idle()` defaults (`startedAt: null`); the `join` success `set(...)` (the one setting `status: 'connected'`) additionally sets `startedAt: Date.now()`.

- [ ] **Step 1: Write the failing tests** — `client/src/utils/callStage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatCallDuration, stageGridClass, SPEAKING_THRESHOLD } from './callStage';

describe('formatCallDuration', () => {
  it('zero → 00:00', () => expect(formatCallDuration(0)).toBe('00:00'));
  it('pads minutes and seconds', () => expect(formatCallDuration(64_000)).toBe('01:04'));
  it('12:04 like the board', () => expect(formatCallDuration(724_000)).toBe('12:04'));
  it('59:59 stays mm:ss', () => expect(formatCallDuration(3_599_000)).toBe('59:59'));
  it('hours roll over', () => expect(formatCallDuration(3_661_000)).toBe('1:01:01'));
  it('negative clamps to 00:00', () => expect(formatCallDuration(-5)).toBe('00:00'));
  it('NaN clamps to 00:00', () => expect(formatCallDuration(Number.NaN)).toBe('00:00'));
});

describe('stageGridClass (board 1e: 1 col ≤1, 2 cols ≤4, 3 beyond)', () => {
  it('solo', () => expect(stageGridClass(1)).toBe('is-solo'));
  it('2–4 → default two columns', () => {
    expect(stageGridClass(2)).toBe('');
    expect(stageGridClass(4)).toBe('');
  });
  it('5+ → three columns', () => expect(stageGridClass(5)).toBe('is-many'));
  it('threshold is the existing 0.05', () => expect(SPEAKING_THRESHOLD).toBe(0.05));
});
```

- [ ] **Step 2: Run to verify failure** — `cd client && npx vitest run src/utils/callStage.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `client/src/utils/callStage.ts`**

```ts
/** Board 1e top bar: "В ЭФИРЕ 12:04". mm:ss, rolling to h:mm:ss past an hour. */
export function formatCallDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Board 1e grid: 1 column ≤1 participant, 2 columns ≤4, 3 beyond. */
export function stageGridClass(total: number): '' | 'is-solo' | 'is-many' {
  if (total <= 1) return 'is-solo';
  if (total <= 4) return '';
  return 'is-many';
}

/** The existing speaking threshold (was inline `level > 0.05` in CallStage/CallUI). */
export const SPEAKING_THRESHOLD = 0.05;
```

- [ ] **Step 4: Extract `client/src/hooks/useMicLevel.ts`** — move CallStage.tsx's `useMicLevel` (lines 20–61, including both explanatory comments) into the new file with the imports it needs (`useState, useEffect, useRef` from react), `export`ed. In `CallStage.tsx`: delete the local copy, add `import { useMicLevel } from '@/hooks/useMicLevel';`. In `CallUI.tsx`: delete its local copy (lines 9–52), add the same import. No other changes to either file in this task.

- [ ] **Step 5: Add `startedAt` to `callStore.ts`** — `startedAt: number | null;` in the `CallState` interface (next to `status`); `startedAt: null,` in the `idle()` defaults object; in `join`'s success `set` (the one with `status: 'connected'`), add `startedAt: Date.now(),`.

- [ ] **Step 6: Gates**

```bash
cd client && npx vitest run src/utils/callStage.test.ts   # PASS
npx tsc --noEmit && npm test          # only api.network-retry fails; totals grow by this task's new tests
npm run lint:css 2>&1 | tail -3       # unchanged (no CSS touched)
```

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/callStage.ts client/src/utils/callStage.test.ts client/src/hooks/useMicLevel.ts client/src/stores/callStore.ts client/src/components/CallStage.tsx client/src/components/CallUI.tsx
git commit -m "feat(redesign): callStage utils (timer format, grid class) + callStore.startedAt + shared useMicLevel hook"
```

---

### Task 3: CallStage grid view — top bar, tiles, plates, speaking ring, control bar

The core of M3 (board `1e`/`2e`). Rewrites the grid-view JSX of `CallStage.tsx` and the corresponding portion of `CallStage.css`. **The focused-view (`screen-share-*`, `thumbnail-*`, `watch-share-*`) and picker (`screen-picker-*`, `screen-quality-*`) CSS blocks are carried verbatim at the bottom of the file** (M2 CONFLICT-1/2 precedent) so the app stays functional; Task 4 rewrites the former, Task 5 removes the latter. The clean-file gate binds only the rewritten portion for this task; enumerate the carried violations in the ledger.

**Files:**
- Modify: `client/src/components/CallStage.tsx` (grid view, header, controls, toast — focused-view JSX untouched except class-neutral wiring), **rewrite** `client/src/components/CallStage.css` (stage-* portion; legacy blocks carried at bottom), `client/src/i18n/locales/ru.ts` + `en.ts`

**Interfaces:**
- Consumes: `formatCallDuration`, `stageGridClass`, `SPEAKING_THRESHOLD` (Task 2), `useMicLevel` (Task 2), `startedAt` (Task 2), stage tokens (Task 1).
- Produces (Tasks 4/8 rely on these): class inventory `call-stage (root, kept), stage-topbar, stage-back-btn, stage-live-pill, stage-live-dot, stage-title, stage-topbar-right, stage-count-chip, stage-fullscreen-btn, stage-reconnecting, stage-grid (+ is-solo / is-many), stage-tile (+ is-speaking / is-camera-off), stage-tile-video (+ is-mirrored / is-screen), stage-tile-avatar, stage-plate, stage-plate-mic (+ is-muted), stage-eq, stage-state-chip, stage-share-badge, stage-focus-btn, stage-volume-btn, stage-conn (+ is-good/is-medium/is-poor/is-unknown), stage-conn-bar, stage-tip, stage-tip-head, stage-tip-dot, stage-tip-title, stage-tip-rows, stage-tip-row, stage-tip-key, stage-tip-val, stage-tip-arrow (+ is-* levels on stage-tip), stage-share-banner, stage-share-banner-text, stage-share-banner-btn, stage-share-banner-dismiss, stage-watch-overlay, stage-watch-btn, stage-controls, stage-ctl, stage-ctl-btn (+ is-off / is-on), stage-ctl-label, stage-ctl-divider, stage-leave-btn`. New component in file: `StageTimer` (reads `startedAt`, re-renders 1/s, renders `formatCallDuration(now - startedAt)`).
- i18n keys added (ru / en): `call.live: 'В ЭФИРЕ' / 'LIVE'`, `call.ctlMic: 'Микрофон' / 'Mic'`, `call.ctlCamera: 'Камера' / 'Camera'`, `call.ctlScreen: 'Экран' / 'Screen'`, `call.leaveLabel: 'Выйти' / 'Leave'`, `call.cameraOffChip: 'камера выкл.' / 'camera off'`; `call.youSuffix` value → `'(вы)'` / `'(you)'` (decision 16).

- [ ] **Step 1: Write the fail-first probe** `tools/probe-stage-grid.js` (async). It must: (a) assert `.stage-grid` exists — **throw loudly if absent** (this is the pre-task failure); (b) read `getComputedStyle(grid).gridTemplateColumns` and count columns; (c) inject synthetic remote participants into `callStore` and re-measure at totals 1, 3, and 5, expecting 1 / 2 / 3 columns. Store injection must resolve the store via the exact `performance` resource URL Chrome loaded (M2's Vite-HMR disconnected-store pitfall — a bare dynamic `import()` silently yields a disconnected instance). Synthetic participant: `{ userId: 'fake-<n>', stream: null }` appended to `participants` via `useCallStore.setState` — `stream: null` renders the camera-off avatar tile with a name plate, no WebRTC involved. Run it now against HEAD with `--fake-media` (which joins voice) and record the loud failure.

- [ ] **Step 2: i18n strings (ru + en together)** — add the six keys and change `youSuffix` as listed in Interfaces. Run `npm run check:i18n` → exit 0.

- [ ] **Step 3: Rewrite the grid-view JSX in `CallStage.tsx`**

Structural changes (behavioral wiring — handlers, effects, store subscriptions — all unchanged):
- Replace every emoji icon and the one inline SVG in the grid view with lucide: `ArrowLeft` (back, 18), `Maximize2`/`Minimize2` (fullscreen, 16), `Mic`/`MicOff` (16 controls / 12 in plates), `Video`/`VideoOff` (16), `MonitorUp` (screen toggle 16; share badges 12), `PhoneOff` (leave, 16), `Expand` (tile focus, 14), `Volume2` (tile volume, 14), `MonitorPlay` (watch overlay, 20). All `strokeWidth={1.8}`.
- Header → top bar:

```tsx
<div className="stage-topbar">
  {onMobileBackToChat && (
    <button className="stage-back-btn" onClick={onMobileBackToChat} aria-label={t('common.back')}>
      <ArrowLeft size={18} strokeWidth={1.8} />
    </button>
  )}
  <div className="stage-live-pill">
    <span className="stage-live-dot" />
    {t('call.live')} <StageTimer />
  </div>
  <h2 className="stage-title">{callChannelName ? `#${callChannelName}` : t('call.groupCallTitle')}</h2>
  <div className="stage-topbar-right">
    <span className="stage-count-chip">{tp('call.participants', totalParticipants)}</span>
    <button className="stage-fullscreen-btn" onClick={() => { void handleStageFullscreen(); }}
      aria-label={isFullscreen ? t('call.exitFullscreen') : t('call.fullscreen')}
      title={isFullscreen ? t('call.exitFullscreen') : t('call.fullscreen')}>
      {isFullscreen ? <Minimize2 size={16} strokeWidth={1.8} /> : <Maximize2 size={16} strokeWidth={1.8} />}
    </button>
  </div>
</div>
```

`StageTimer` (same file): `const startedAt = useCallStore((s) => s.startedAt);` + a 1s `setInterval` bumping a local `now` state; renders `formatCallDuration(now - (startedAt ?? now))`. `handleStageFullscreen`: same body as the current `handleFullscreen` but the browser-path container is the new `stageRef` (a ref on the root `.call-stage` div); keep the existing `handleFullscreen` for the focused view untouched this task (Task 4 unifies). Add `className={isFullscreen ? 'call-stage is-fullscreen' : 'call-stage'}` on the root. Delete the `.header-screen-share-indicator` span (decision 9).
- Grid: `<div className={`stage-grid ${stageGridClass(totalParticipants)}`.trim()}>` — inline `style` deleted.
- Tile (local shown; `RemoteParticipantTile`'s grid layout mirrors it exactly, with its volume/focus/watch extras):

```tsx
<div
  className={`stage-tile${isVideoOff && !isScreenSharing ? ' is-camera-off' : ''}${micLevel > SPEAKING_THRESHOLD ? ' is-speaking' : ''}`}
  style={{ '--speak-level': Math.min(1, micLevel) } as React.CSSProperties}
>
  <video ref={localVideoRef} autoPlay playsInline muted
    className={`stage-tile-video${isScreenSharing ? ' is-screen' : ' is-mirrored'}`} />
  {isVideoOff && !isScreenSharing && (
    <Avatar username={user?.username ?? '?'} url={user?.avatar_url} className="stage-tile-avatar" />
  )}
  {isScreenSharing && <div className="stage-share-badge"><MonitorUp size={12} strokeWidth={1.8} /> {t('call.sharingBadge')}</div>}
  <div className="stage-plate">
    {isMuted
      ? <span className="stage-plate-mic is-muted"><MicOff size={12} strokeWidth={1.8} /></span>
      : micLevel > SPEAKING_THRESHOLD
        ? <span className="stage-eq"><span /><span /><span /></span>
        : <span className="stage-plate-mic"><Mic size={12} strokeWidth={1.8} /></span>}
    <span>{user?.username} {t('call.youSuffix')}</span>
  </div>
  {isVideoOff && !isScreenSharing && <div className="stage-state-chip">{t('call.cameraOffChip')}</div>}
  <ConnectionIndicator metrics={localQuality} />
</div>
```

  In `RemoteParticipantTile` (grid layout): same skeleton; `is-camera-off` when `!participant.stream`; plate name is `displayName` (no suffix); `speaking = level > SPEAKING_THRESHOLD`; volume button becomes `stage-volume-btn` with `<Volume2 />`, focus becomes `stage-focus-btn` with `<Expand />`, watch overlay becomes `stage-watch-overlay`/`stage-watch-btn` with `<MonitorPlay />`. The `thumbnail` layout branch keeps its current classes untouched this task (Task 4 renames it).
- `ConnectionIndicator`: classes → `stage-conn` + `is-good|is-medium|is-poor|is-unknown`, bars `stage-conn-bar` (nth-child heights replace `--1/--2/--3` modifier classes); tooltip → `stage-tip*` per Interfaces. Logic untouched.
- Controls:

```tsx
<div className="stage-controls">
  <div className="stage-ctl">
    <button className={`stage-ctl-btn${isMuted ? ' is-off' : ''}`} onClick={handleToggleMute}
      disabled={!isMicAvailable}
      title={!isMicAvailable ? t('call.micUnavailable') : isMuted ? t('call.micOn') : t('call.micOff')}>
      {isMuted ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
    </button>
    <span className="stage-ctl-label">{t('call.ctlMic')}</span>
  </div>
  <div className="stage-ctl">
    <button className={`stage-ctl-btn${isVideoOff ? ' is-off' : ''}`} onClick={handleToggleVideo}
      disabled={isScreenSharing}
      title={isScreenSharing ? t('call.cameraUnavailableSharing') : isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}>
      {isVideoOff ? <VideoOff size={16} strokeWidth={1.8} /> : <Video size={16} strokeWidth={1.8} />}
    </button>
    <span className="stage-ctl-label">{t('call.ctlCamera')}</span>
  </div>
  <div className="stage-ctl">
    <button className={`stage-ctl-btn${isScreenSharing ? ' is-on' : ''}`}
      onClick={() => { void handleToggleScreenShare(); }}
      title={isScreenSharing ? t('call.stopScreenShare') : t('call.shareScreen')}>
      <MonitorUp size={16} strokeWidth={1.8} />
    </button>
    <span className="stage-ctl-label">{t('call.ctlScreen')}</span>
  </div>
  <div className="stage-ctl-divider" />
  <button className="stage-leave-btn" onClick={handleLeaveGroupCall} title={t('call.leaveCall')}>
    <PhoneOff size={16} strokeWidth={1.8} />
    {t('call.leaveLabel')}
  </button>
</div>
```

  The `mic-btn-wrap` halo wrapper is deleted (decision 8).
- Screen-share banner → `stage-share-banner` (MonitorUp 16 icon, text, `stage-share-banner-btn` «Смотреть», `stage-share-banner-dismiss` with lucide `X` 14). Reconnecting banner → `stage-reconnecting`. Replace the three `alert()` calls with `setStageError(t('call.…'))` — new local state `const [stageError, setStageError] = useState<string | null>(null);`, an effect clearing it after 5000ms, rendered as `{stageError && <div className="error-toast">{stageError}</div>}` (decision 11).

- [ ] **Step 4: Rewrite `CallStage.css` (stage portion)** — exact values (board `1e`/`2e`):

```css
/* ── Call stage — board 1e (base) / 2e (speaking). Root class .call-stage is
   the cross-file contract with AppPage.css's split/fullscreen/mobile rules —
   kept by decision 2 of the M3 plan. Everything else is stage-*. ── */
.call-stage {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--stage);
  position: relative;
}

/* ── Top bar: 56px, live pill + title + counter + fullscreen ── */
.stage-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--stage-line);
}

.stage-back-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: var(--radius-row);
  background: var(--stage-chip);
  color: var(--stage-ink);
  cursor: pointer;
}

.stage-live-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  background: var(--live-pill-bg);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--live-pill-text);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.stage-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--online);
  flex-shrink: 0;
}

.stage-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--stage-ink);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.stage-topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.stage-count-chip {
  padding: 7px 12px;
  border-radius: var(--radius-row);
  background: var(--stage-chip);
  font-size: 12px;
  font-weight: 600;
  color: var(--stage-muted);
  white-space: nowrap;
}

.stage-fullscreen-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--radius-row);
  background: var(--stage-chip);
  color: var(--stage-ink);
  cursor: pointer;
  transition: background var(--transition);
}

.stage-fullscreen-btn:hover {
  background: var(--stage-toggle);
}

.stage-reconnecting {
  position: absolute;
  top: 68px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  padding: 8px 16px;
  border-radius: var(--radius-row);
  border: 1px solid var(--warning);
  background: var(--stage-bar);
  color: var(--warning);
  font-size: 13px;
  font-weight: 600;
}

/* ── Tile grid: 1 col ≤1, 2 cols ≤4 (default), 3 cols 5+ ── */
.stage-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 18px;
  overflow: auto;
  align-content: start;
}

.stage-grid.is-solo {
  grid-template-columns: 1fr;
}

.stage-grid.is-many {
  grid-template-columns: 1fr 1fr 1fr;
}

/* ── Participant tile ── */
.stage-tile {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  border-radius: 14px;
  background: var(--stage-tile);
  overflow: hidden;
}

/* 2e: ring radius maps level 0→1 to 2→6px, driven by the real level.
   --speak-level is JS-injected (invisible to importFrom) — fallback required. */
.stage-tile.is-speaking {
  box-shadow: 0 0 0 calc(2px + var(--speak-level, 0) * 4px) var(--speak-ring);
}

.stage-tile-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.stage-tile-video.is-mirrored {
  transform: scaleX(-1);
}

.stage-tile-video.is-screen {
  transform: none;
}

.stage-tile.is-camera-off .stage-tile-video {
  visibility: hidden;
}

.call-stage .stage-tile-avatar {
  width: 74px;
  height: 74px;
  border-radius: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  z-index: 1;
  object-fit: cover;
}

/* ── Name plate: mic / equalizer + name ── */
.stage-plate {
  position: absolute;
  bottom: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: calc(100% - 20px);
  padding: 5px 10px;
  border-radius: var(--radius-row);
  background: var(--stage-plate);
  color: var(--stage-ink);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 2;
}

.stage-plate-mic {
  display: flex;
  align-items: center;
  color: var(--stage-muted);
}

.stage-plate-mic.is-muted {
  color: var(--danger);
}

/* 2e equalizer: bars 5→13px, 0.7s, staggered .12s */
.stage-eq {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 13px;
}

.stage-eq span {
  width: 2.5px;
  border-radius: 1px;
  background: var(--online);
  animation: stage-eq-bar 0.7s ease-in-out infinite;
}

.stage-eq span:nth-child(2) {
  animation-delay: 0.12s;
}

.stage-eq span:nth-child(3) {
  animation-delay: 0.24s;
}

@keyframes stage-eq-bar {
  0%, 100% { height: 5px; }
  50% { height: 13px; }
}

.stage-state-chip {
  position: absolute;
  bottom: 10px;
  right: 10px;
  padding: 4px 8px;
  border-radius: 7px;
  background: var(--stage-plate);
  font-size: 11px;
  font-weight: 600;
  color: var(--stage-muted);
  z-index: 2;
}

.stage-share-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 7px;
  background: var(--accent);
  color: var(--white);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  z-index: 2;
}

/* ── Hover chips on tiles ── */
.stage-focus-btn,
.stage-volume-btn {
  position: absolute;
  top: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: var(--stage-plate);
  color: var(--stage-ink);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition), background var(--transition);
  z-index: 3;
}

.stage-volume-btn {
  left: 8px;
}

.stage-focus-btn {
  right: 44px;
}

.stage-tile:hover .stage-focus-btn,
.stage-tile:hover .stage-volume-btn {
  opacity: 1;
}

.stage-focus-btn:hover,
.stage-volume-btn:hover {
  background: var(--accent);
}

/* ── Connection quality (bars persistent top-right; tooltip is a system popover) ── */
.stage-conn {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 28px;
  padding: 0 7px;
  border-radius: 7px;
  background: var(--stage-plate);
  cursor: help;
  z-index: 3;
}

.stage-conn-bar {
  width: 3px;
  margin-bottom: 7px;
  border-radius: 1px;
  background: currentcolor;
  opacity: 0.3;
}

.stage-conn-bar:nth-child(1) { height: 5px; }
.stage-conn-bar:nth-child(2) { height: 9px; }
.stage-conn-bar:nth-child(3) { height: 13px; }

.stage-conn.is-good { color: var(--online); }
.stage-conn.is-medium { color: var(--warning); }
.stage-conn.is-poor { color: var(--danger); }
.stage-conn.is-unknown { color: var(--muted-2); }
.stage-conn.is-good .stage-conn-bar { opacity: 1; }

.stage-conn.is-medium .stage-conn-bar:nth-child(1),
.stage-conn.is-medium .stage-conn-bar:nth-child(2) {
  opacity: 1;
}

.stage-conn.is-poor .stage-conn-bar:nth-child(1) {
  opacity: 1;
}

/* Tooltip portals to body — theme-adaptive popover surface, not stage-dark */
.stage-tip {
  position: fixed;
  transform: translate(-50%, -100%);
  z-index: 1200;
  min-width: 168px;
  padding: 10px 12px;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow-menu);
  color: var(--ink);
  pointer-events: none;
  animation: stage-tip-in 0.12s var(--ease-out);
}

@keyframes stage-tip-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-100% + 4px));
  }

  to {
    opacity: 1;
    transform: translate(-50%, -100%);
  }
}

.stage-tip-head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.stage-tip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: currentcolor;
}

.stage-tip-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}

.stage-tip-rows {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stage-tip-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.stage-tip-key {
  font-size: 12px;
  color: var(--muted);
}

.stage-tip-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.stage-tip-arrow {
  position: absolute;
  bottom: -5px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 10px;
  height: 10px;
  background: var(--canvas);
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.stage-tip.is-good { color: var(--online); }
.stage-tip.is-medium { color: var(--warning); }
.stage-tip.is-poor { color: var(--danger); }
.stage-tip.is-unknown { color: var(--muted-2); }

/* ── Share banner (someone is sharing, focus not open) ── */
.stage-share-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  background: var(--stage-bar);
  border-bottom: 1px solid var(--stage-line);
  color: var(--stage-ink);
  flex-shrink: 0;
}

.stage-share-banner-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stage-share-banner-btn {
  flex-shrink: 0;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-row);
  background: var(--accent);
  color: var(--white);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition);
}

.stage-share-banner-btn:hover {
  background: var(--accent-hover);
}

.stage-share-banner-dismiss {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--stage-muted);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.stage-share-banner-dismiss:hover {
  background: var(--stage-chip);
  color: var(--stage-ink);
}

.stage-watch-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--stage-plate);
  color: var(--stage-muted);
  z-index: 1;
}

.stage-watch-btn {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 7px;
  background: var(--accent);
  color: var(--white);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

/* ── Control bar: three labeled 46px toggles · divider · danger «Выйти» pill ── */
/* z-index needed: <video> GPU layers block pointer events on siblings without
   their own compositing layer in Electron. */
.stage-controls {
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 10px;
  width: max-content;
  max-width: calc(100% - 36px);
  margin: 0 auto 14px;
  padding: 10px;
  background: var(--stage-bar);
  border: 1px solid var(--stage-line);
  border-radius: var(--radius-bar);
  flex-shrink: 0;
}

.stage-ctl {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stage-ctl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border: none;
  border-radius: 14px;
  background: var(--stage-toggle);
  color: var(--stage-ink);
  cursor: pointer;
  transition: background var(--transition);
}

.stage-ctl-btn:hover {
  background: var(--stage-chip);
}

.stage-ctl-btn.is-off {
  background: var(--danger);
  color: var(--white);
}

.stage-ctl-btn.is-on {
  background: var(--accent);
  color: var(--white);
}

.stage-ctl-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

.stage-ctl-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--stage-muted);
}

.stage-ctl-divider {
  width: 1px;
  height: 40px;
  align-self: center;
  background: var(--stage-line);
}

.stage-leave-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 18px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--danger);
  color: var(--white);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: filter var(--transition);
}

.stage-leave-btn:hover {
  filter: brightness(1.08);
}

/* ── Mobile: back button appears; grid single-column ≤640 ── */
@media (width <= 768px) {
  .stage-back-btn {
    display: flex;
  }
}

@media (width <= 640px) {
  .stage-grid,
  .stage-grid.is-many {
    grid-template-columns: 1fr;
  }
}
```

Below this, keep the legacy blocks **verbatim** under a marker comment: `/* ═══ LEGACY (carried until T4/T5 of the M3 plan): focused view + thumbnails + pickers ═══ */` — the `.call-body`/`.call-video-area` layout rules, `.screen-share-view/-main/-thumbnails/...`, `.thumbnail-*`, `.watch-share-*` (still consumed by the untouched thumbnail branch), `.screen-picker-*`, `.screen-quality-*`, plus the old `.mic-badge` rules (the thumbnail JSX still emits them). Delete what nothing consumes anymore: the grid view no longer renders `.video-tile`/`.video-grid`/`.call-controls`/`.group-call-header`/`.mic-btn-wrap` — those rules go. **Known one-task interim:** `ConnectionIndicator` is shared between the grid and thumbnail branches, so its T3 rename (`conn-*` → `stage-conn*`/`stage-tip*`) means the untouched thumbnail branch emits the new classes while its old size overrides (`.thumbnail-tile .conn-indicator` etc.) are dead — the focused view's tiny conn bars render at grid size until Task 4 restyles that view. Delete the dead `.thumbnail-tile .conn-*` overrides now, record the interim in the ledger (mirror of M2's CONFLICT-1 carried-composer precedent).

- [ ] **Step 5: Stylelint check on the rewritten portion + totals**

```bash
cd client && npx stylelint src/components/CallStage.css 2>&1 | tail -5
```

Expected: only violations inside the LEGACY marker block (enumerate them in the ledger — the T6/CONFLICT-2 precedent); zero above the marker. `npm run lint:css 2>&1 | tail -3` → total ≤ 531 (deleting the old grid rules removes violations; the carried blocks keep theirs).

- [ ] **Step 6: Full gates** — `npx tsc --noEmit && npm test && npm run check:i18n` → delta-clean.

- [ ] **Step 7: Run the probes (must now pass) + screenshots**

```bash
node tools/smoke.mjs --fake-media --probe tools/probe-stage-grid.js
node tools/smoke.mjs --fake-media --probe tools/probe-stage-chrome.js   # write now: asserts topbar height 56, live-pill bg rgba(18,183,106,0.14) + text rgb(91,227,155), timer text matches /^\d{1,2}:\d{2}(:\d{2})?$/, count chip present, fullscreen btn 32×32, controls: three 46×46 r14 toggles + labels Микрофон/Камера/Экран + divider 1×40 + leave pill height 46 with text «Выйти»
node tools/smoke.mjs --fake-media --probe tools/probe-stage-speaking.js # write now: samples the LOCAL tile ~15× over 1.5s — asserts is-speaking present in ≥1 sample (fake mic emits a tone), that --speak-level on the tile takes ≥2 distinct values across samples, and that computed box-shadow spread varies with it; asserts the equalizer (.stage-eq) is rendered while speaking and .stage-plate-mic while not
node tools/smoke.mjs --fake-media --out m3t3-stage-light.png
node tools/smoke.mjs --fake-media --theme dark --out m3t3-stage-dark.png
node tools/smoke.mjs --fake-media --touch --out m3t3-stage-mobile.png   # back button visible, 40×40
```

`probe-stage-chrome.js` and `probe-stage-speaking.js` must also have been run against pre-task HEAD first (loud failure: selectors absent). If the tone-driven `is-speaking` never fires (fake-device tone amplitude too low for the 0.05 threshold), record that honestly and fall back to asserting `--speak-level` variance ≥ 0.005 plus a DOM-forced class check — do **not** claim the ring was exercised if it wasn't.

- [ ] **Step 8: Toast + reconnecting check** — probe: click the screen toggle in a **non-Electron** context cancels getDisplayMedia (headless auto-denies without `--fake-media`'s auto-grant; if it auto-grants, skip — the NotAllowedError path is silent by design and needs no toast). Simpler deterministic check: temporarily force `setStageError('test')` via probe-injected store? No — `stageError` is component-local. Instead verify statically that the three `alert(` call sites are gone (`rg -n 'alert\(' src/components/CallStage.tsx` → empty) and the toast JSX renders from `stageError`; the shared `.error-toast` recipe itself was probe-verified in M2. Record as reasoned-not-measured.

- [ ] **Step 9: Commit**

```bash
git add client/src/components/CallStage.tsx client/src/components/CallStage.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): call stage grid per board 1e/2e — top bar with live timer, tile plates, level-driven speaking ring, labeled control bar"
```

---

### Task 4: Focused screen-share view, thumbnail strip, stage fullscreen, volume popover

**Files:**
- Modify: `client/src/components/CallStage.tsx` (focused view + thumbnail branch JSX), `client/src/components/CallStage.css` (rewrite the carried focused-view/thumbnail legacy block; picker block remains), `client/src/pages/AppPage.css` (fullscreen `:has` selectors — surgical edit, legacy file), **rewrite** `client/src/components/VolumeControlPopover.css`

**Interfaces:**
- Consumes: Task 3's stage classes and tokens; `handleStageFullscreen`, `isFullscreen`, `stageRef`.
- Produces: classes `stage-focus, stage-focus-main (+ is-fullscreen), stage-focus-video, stage-focus-label, stage-focus-controls, stage-focus-ctrl-btn, stage-focus-badge, stage-thumbs, stage-thumb (+ is-focused / is-speaking), stage-thumb-label, stage-thumb-badge, stage-thumb-avatar`. `VolumeControlPopover` keeps its class names (`volume-popover*`) and API.

- [ ] **Step 1: Fail-first probe** `tools/probe-stage-focus.js` (async): with `--fake-media`, inject one synthetic participant (`stream: null`) via the HMR-safe store handle, then `setState({focusedUserId: 'fake-1'})`; assert `.stage-focus` and `.stage-focus-main` exist (loud fail pre-task), main bg computes to `rgb(14, 16, 23)` (`--stage`), thumbnail strip `.stage-thumbs` present with ≥2 tiles (local + fake), the fake (a known non-sharer) is `is-focused`, and its label text matches. Run against pre-task HEAD → loud failure recorded.

- [ ] **Step 2: Rewrite the focused-view + thumbnail JSX** — renames only, behavior identical:
  - `screen-share-view` → `stage-focus`; `screen-share-main` → `stage-focus-main` (keeps `is-fullscreen`); `screen-share-main-video` → `stage-focus-video`; `screen-share-main-label` → `stage-focus-label` (styled as a `stage-plate`); `screen-share-badge-sm` → `stage-focus-badge`; `screen-share-main-controls` → `stage-focus-controls`; `screen-share-ctrl-btn` → `stage-focus-ctrl-btn` with lucide `Maximize2`/`Minimize2` (fullscreen) and `LayoutGrid` (back to grid), 16px.
  - `thumbnail-tile` → `stage-thumb` (+ `is-focused`, `is-speaking` with the same `--speak-level` inline style), `thumbnail-label` → `stage-thumb-label`, `thumbnail-badge` → `stage-thumb-badge` (MonitorUp 10), `thumbnail-placeholder` → `stage-thumb-avatar` (a 32px r11 `Avatar`), watch overlay reuses Task 3's `stage-watch-overlay/-btn`. Mic state in thumbnails: the plate is too big — reuse `stage-plate-mic` sizing inside `stage-thumb-label` (Mic/MicOff 10px, equalizer omitted at thumb scale; `is-speaking` ring carries the signal).
  - Unify fullscreen: delete the now-duplicate `handleFullscreen`; the focused view's fullscreen button calls `handleStageFullscreen` too? **No** — keep the focused view's button targeting `.stage-focus-main` (fullscreening just the shared screen is the correct behavior there; the top bar's targets the whole stage). Rename the old `handleFullscreen` to `handleFocusFullscreen`, body unchanged (it already uses `screenShareMainRef`).

- [ ] **Step 3: Rewrite the carried focused/thumbnail CSS block** — key values:

```css
/* ── Focused / screen-share view ── */
.stage-focus {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.stage-focus-main {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  background: var(--stage);
  overflow: hidden;
}

.stage-focus-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.stage-focus-label {
  position: absolute;
  bottom: 14px;
  left: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: var(--radius-row);
  background: var(--stage-plate);
  color: var(--stage-ink);
  font-size: 12px;
  font-weight: 600;
  z-index: 5;
}

.stage-focus-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-chip);
  background: var(--accent);
  font-size: 11px;
  font-weight: 600;
}

.stage-focus-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 8px;
  opacity: 0;
  transition: opacity var(--transition);
  z-index: 10;
}

.stage-focus-main:hover .stage-focus-controls,
.stage-focus-main:fullscreen:hover .stage-focus-controls {
  opacity: 1;
}

.stage-focus-ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--stage-line);
  border-radius: var(--radius-row);
  background: var(--stage-plate);
  color: var(--stage-ink);
  cursor: pointer;
  transition: background var(--transition);
}

.stage-focus-ctrl-btn:hover {
  background: var(--accent);
}

.stage-focus-main.is-fullscreen .stage-focus-label {
  display: none;
}

.stage-focus-main:fullscreen {
  width: 100vw;
  height: 100vh;
}

/* ── Thumbnail strip ── */
.stage-thumbs {
  height: 110px;
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 8px 12px;
  overflow-x: auto;
  overflow-y: hidden;
  border-top: 1px solid var(--stage-line);
  flex-shrink: 0;
  scrollbar-width: thin;
}

.stage-thumb {
  position: relative;
  width: calc(94px * 16 / 9);
  height: 100%;
  flex-shrink: 0;
  border-radius: 10px;
  background: var(--stage-tile);
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow var(--transition);
}

.stage-thumb:hover {
  box-shadow: 0 0 0 2px var(--stage-toggle);
}

.stage-thumb.is-focused {
  box-shadow: 0 0 0 2px var(--accent);
}

.stage-thumb.is-speaking {
  box-shadow: 0 0 0 calc(2px + var(--speak-level, 0) * 4px) var(--speak-ring);
}

.stage-thumb video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.stage-thumb video.is-mirrored {
  transform: scaleX(-1);
}

.stage-thumb-avatar {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 32px;
  height: 32px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}

.stage-thumb-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  padding: 3px 5px;
  border-radius: var(--radius-chip);
  background: var(--accent);
  color: var(--white);
  z-index: 2;
}

.stage-thumb-label {
  position: absolute;
  bottom: 4px;
  left: 5px;
  right: 5px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: var(--radius-chip);
  background: var(--stage-plate);
  color: var(--stage-ink);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 2;
}

.stage-thumb .stage-volume-btn {
  width: 20px;
  height: 20px;
  top: 4px;
  left: 4px;
}

.stage-thumb .stage-conn {
  top: 4px;
  right: 4px;
  height: 20px;
  padding: 0 5px;
}

.stage-thumb .stage-conn-bar {
  width: 2px;
  margin-bottom: 4px;
}

.stage-thumb .stage-conn-bar:nth-child(1) { height: 3px; }
.stage-thumb .stage-conn-bar:nth-child(2) { height: 6px; }
.stage-thumb .stage-conn-bar:nth-child(3) { height: 9px; }
```

Also rewrite the small `.call-body`/`.call-video-area` layout wrappers as-is values-wise but with `background` removed (root paints `--stage`); they keep their names (lint-legal, purely structural). Old `.mic-badge`, `.conn-indicator--*`, `.conn-tooltip*`, `.thumbnail-*`, `.watch-share-*`, `.screen-share-*` rules are now consumer-free — delete them. After this task the only remaining legacy block is `.screen-picker-*`/`.screen-quality-*`.

- [ ] **Step 4: AppPage.css fullscreen selectors (surgical)** — update lines 57–65 to reference the renamed class and cover Electron stage-fullscreen:

```css
.channel-body:has(.stage-focus-main.is-fullscreen) .call-stage,
.channel-body:has(.call-stage.is-fullscreen) .call-stage {
  height: 100%;
  flex: 1 1 auto;
}

.channel-body:has(.stage-focus-main.is-fullscreen) > .call-split-handle,
.channel-body:has(.stage-focus-main.is-fullscreen) > .chat-area,
.channel-body:has(.call-stage.is-fullscreen) > .call-split-handle,
.channel-body:has(.call-stage.is-fullscreen) > .chat-area {
  display: none;
}
```

Verify AppPage.css gained no violations: `npx stylelint src/pages/AppPage.css 2>&1 | tail -2` before and after — counts equal.

- [ ] **Step 5: Rewrite `VolumeControlPopover.css`** (token-only; class names unchanged):

```css
.volume-popover {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: var(--radius-row);
  box-shadow: var(--shadow-popover);
  z-index: 1100;
  cursor: default;
}

.volume-popover-slider {
  width: 110px;
}

.volume-popover-value {
  min-width: 32px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 6: Gates + probes**

```bash
cd client && npx stylelint src/components/VolumeControlPopover.css   # 0 problems
npx stylelint src/components/CallStage.css 2>&1 | tail -5            # violations only inside the remaining picker legacy block
npm run lint:css 2>&1 | tail -3                                      # ≤ 531
npx tsc --noEmit && npm test && npm run check:i18n
node tools/smoke.mjs --fake-media --probe tools/probe-stage-focus.js # now passes
node tools/smoke.mjs --fake-media --probe tools/probe-stage-focus.js --theme dark --out m3t4-focus-dark.png
```

Fullscreen: probe clicks `.stage-fullscreen-btn`, asserts `.call-stage` gains `is-fullscreen` (state class) — if headless-Chrome `requestFullscreen` rejects without a user gesture, record it and verify the class toggle by invoking the handler via a trusted CDP `Input.dispatchMouseEvent` click (the harness `--click` flag does exactly this); the Electron `api.toggleFullscreen` branch is static-verified (read the diff, confirm the branch is unchanged from pre-M3 except the ref).

- [ ] **Step 7: Commit**

```bash
git add client/src/components/CallStage.tsx client/src/components/CallStage.css client/src/components/VolumeControlPopover.css client/src/pages/AppPage.css
git commit -m "feat(redesign): focused share view + thumbnail strip on stage tokens; whole-stage fullscreen from top bar"
```

---

### Task 5: ScreenSharePicker extraction + restyle

Closes the spec-§3 extraction hazard (`ScreenSharePicker.tsx` imports `CallStage.css`). After this task `CallStage.css` must be **fully clean — 0 problems, no exceptions** (the M2 Task-8 pattern) and raw-value-free.

**Files:**
- Create: `client/src/components/ScreenSharePicker.css`
- Modify: `client/src/components/ScreenSharePicker.tsx` (import swap + restyled markup), `client/src/components/CallStage.css` (delete the last legacy block)

**Interfaces:**
- Produces: `ScreenSourcePicker` / `ScreenQualityPicker` unchanged APIs; classes `screen-picker-backdrop, screen-picker-modal, screen-picker-header, screen-picker-close, screen-picker-section, screen-picker-section-label, screen-picker-grid, screen-picker-item, screen-picker-thumb, screen-picker-app-icon, screen-picker-name, screen-quality-modal, screen-quality-list, screen-quality-item, screen-quality-label, screen-quality-desc`.

- [ ] **Step 1: Fail-first probe** `tools/probe-screen-picker.js`: with `--fake-media` (non-Electron path), join voice, click the screen toggle (`.stage-ctl-btn` third instance — select via the `stage-controls` children index or the title attribute) → the **quality picker** opens first on the web path; assert `.screen-quality-modal` computed: border-radius 16px, bg `rgb(255, 255, 255)` light / `rgb(14, 16, 23)` dark (`--canvas`), header 15/700, three `.screen-quality-item` rows r10 with `--line-strong` border; press Escape / click backdrop → closed. Pre-task run: the modal opens but measures the OLD values (r12-ish `--radius-lg`, legacy shadows) — the probe must assert the NEW values so it **fails on the measurement**, not silently pass. Record the pre-task failure.

- [ ] **Step 2: Create `ScreenSharePicker.css`** — system modal treatment:

```css
/* ── Screen source / quality pickers — system modal surface ── */
.screen-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(16 19 34 / 40%);
  animation: screen-picker-fade 0.18s var(--ease-out);
}

@keyframes screen-picker-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.screen-picker-modal {
  width: min(780px, 92vw);
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-modal);
}

.screen-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}

.screen-picker-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.screen-picker-close:hover {
  background: var(--canvas-2);
  color: var(--ink);
}

.screen-picker-section {
  padding: 16px 20px 8px;
  overflow-y: auto;
}

.screen-picker-section-label {
  margin-bottom: 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted-2);
}

.screen-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  padding-bottom: 10px;
}

.screen-picker-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: var(--canvas-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-card);
  cursor: pointer;
  text-align: center;
  transition: border-color var(--transition), box-shadow var(--transition);
}

.screen-picker-item:hover {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.screen-picker-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 7px;
  background: var(--stage);
}

.screen-picker-app-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 7px;
}

.screen-picker-name {
  max-width: 100%;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.screen-quality-modal {
  width: min(360px, 92vw);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-modal);
}

.screen-quality-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.screen-quality-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: var(--canvas-2);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color var(--transition), box-shadow var(--transition);
}

.screen-quality-item:hover {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.screen-quality-label {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink);
}

.screen-quality-desc {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
```

(`rgb(16 19 34 / 40%)` is the overlay scrim — modern notation, config-standard-clean; it is a raw value **allowed nowhere else**: check whether `primitives.css`'s `.modal-overlay` already defines a scrim token/value and reuse that exact value if one exists — match the app-wide overlay, don't invent a second darkness.)

- [ ] **Step 3: Swap the import** — `ScreenSharePicker.tsx`: `import './CallStage.css';` → `import './ScreenSharePicker.css';`. Replace the `✕` text close buttons with lucide `X size={16} strokeWidth={1.8}`.

- [ ] **Step 4: Delete the last legacy block from `CallStage.css`** — the `.screen-picker-*`/`.screen-quality-*` rules and the LEGACY marker comment. Now:

```bash
cd client && npx stylelint src/components/CallStage.css     # 0 problems — no exceptions from here on
npx stylelint src/components/ScreenSharePicker.css          # 0 problems
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/CallStage.css src/components/ScreenSharePicker.css
# CallStage.css: zero rows. ScreenSharePicker.css: only the single sanctioned overlay-scrim value (or zero if the primitives token existed).
npm run lint:css 2>&1 | tail -3                             # ≤ 531 — should now be measurably BELOW it; record the new number
npx tsc --noEmit && npm test
```

- [ ] **Step 5: Probe passes + screenshots** — `node tools/smoke.mjs --fake-media --probe tools/probe-screen-picker.js --out m3t5-quality-light.png` and `--theme dark --out m3t5-quality-dark.png`. The Electron-only source picker (`getScreenSources`) cannot open here — verify its markup/CSS statically and record as reasoned-not-measured.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ScreenSharePicker.tsx client/src/components/ScreenSharePicker.css client/src/components/CallStage.css
git commit -m "feat(redesign): screen-share pickers extracted to own stylesheet, restyled as system modals; CallStage.css fully clean"
```

---

### Task 6: CallUI — the 1:1 overlay on `p2p-*`

**Files:**
- Modify: `client/src/components/CallUI.tsx` (JSX re-skin; all logic/effects/WS wiring untouched), **rewrite** `client/src/components/CallUI.css`
- Modify: `client/src/i18n/locales/ru.ts` + `en.ts` (only if a string is missing — expected: none; `call.incomingCall`, `call.userCalling`, `call.endCall` etc. exist)

**Interfaces:**
- Consumes: `useMicLevel` (Task 2), `SPEAKING_THRESHOLD`, stage tokens, `modalIn` keyframe (primitives, legacy-named — referencing it is the ConfirmModal precedent), `.error-toast` primitive (0.22s — decision 17 confirms).
- Produces: classes `p2p-overlay (+ is-incoming / is-active), p2p-modal, p2p-modal-tile, p2p-modal-title, p2p-modal-sub, p2p-actions, p2p-accept-btn, p2p-reject-btn, p2p-videos, p2p-remote (+ is-speaking), p2p-timer, p2p-timer-dot, p2p-local (+ is-speaking), p2p-local-label, p2p-plate, p2p-plate-mic (+ is-muted), p2p-controls, p2p-ctl, p2p-ctl-btn (+ is-off), p2p-ctl-label, p2p-ctl-divider, p2p-leave-btn`.

- [ ] **Step 1: Fail-first probe** `tools/probe-p2p.js` (async, no second account needed): dispatch the component's own window events —

```js
window.dispatchEvent(new CustomEvent('discrod:incoming_call', { detail: { call_id: 'probe', caller_id: 'probe' } }));
// assert .p2p-modal renders: width, border-radius 16px, --shadow-modal, tile 74×74 r26, accept/reject 52px circles with computed bg rgb(18,183,106) / rgb(231,68,74)
// then reject via click on .p2p-reject-btn, assert closed;
window.dispatchEvent(new CustomEvent('discrod:call_started', { detail: { call_id: 'probe' } }));
// assert .p2p-overlay.is-active: bg rgb(14,16,23), control bar present (two toggles + divider + .p2p-leave-btn with text «Выйти»), timer matches /^\d{2}:\d{2}$/, local PiP 220×160 r14
```

(`audioService.startRingtone` is already wrapped in try/catch; `callService.localStreamState` null just renders empty videos — fine for CSS assertions.) End by dispatching the calls away (click `.p2p-leave-btn` — `callService.endCall()` on a non-existent call is a no-op WS send; verify in the probe run that no crash results, and record). Run pre-task → loud failure (selectors absent).

- [ ] **Step 2: Re-skin the JSX** — mapping (logic untouched):
  - Incoming: overlay `p2p-overlay is-incoming` (scrim + blur kept); modal `p2p-modal` (340px, centered text); `p2p-modal-tile` 74px r26 `--accent-soft` bg with `<Phone size={28} strokeWidth={1.8} />` in `--accent-text`, pulse loop `p2p-pulse`; `<h2 className="p2p-modal-title">` 19/800; `<p className="p2p-modal-sub">` 13/`--muted`; actions: `p2p-reject-btn` (`PhoneOff` 20) + `p2p-accept-btn` (`Phone` 20), both `aria-label`ed with `t('call.rejectCall')`/`t('call.acceptCall')` — **check these keys exist; if not, add ru «Отклонить»/«Принять» + en 'Decline'/'Accept'**.
  - Active: overlay `p2p-overlay is-active`; remote `p2p-remote` (+ `is-speaking`, `--speak-level` inline from `remoteMicLevel`); timer `p2p-timer` (live-pill recipe: dot + `t('call.live')` + `<CallTimer />`); remote plate `p2p-plate` bottom-left with mic state (`Mic`/`MicOff` 12, `p2p-plate-mic is-muted` when `remoteMicMuted`) — replaces the floating `mic-badge`; local PiP `p2p-local` (+ `is-speaking`, `--speak-level` from `micLevel`) with `p2p-local-label`; controls per the stage recipe minus screen: mic ctl, camera ctl, divider, `p2p-leave-btn` («Выйти», `PhoneOff` 16, `title={t('call.endCall')}`). The `mic-btn-wrap` halo is deleted (decision 8). Error toast block unchanged (`.error-toast`).

- [ ] **Step 3: Rewrite `CallUI.css`** — the control-bar/plate/ring rules copy Task 3's stage recipe values under `p2p-*` names (decision 3). Distinct values: 

```css
.p2p-overlay {
  position: fixed;
  top: 40px; /* TitleBar */
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.p2p-overlay.is-incoming {
  background: rgb(16 19 34 / 40%);
  backdrop-filter: blur(10px);
}

.p2p-modal {
  width: 340px;
  padding: 32px 28px;
  text-align: center;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-modal);
  animation: modalIn 0.18s var(--ease-out);
}

.p2p-modal-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 74px;
  height: 74px;
  margin: 0 auto 18px;
  border-radius: 26px;
  background: var(--accent-soft);
  color: var(--accent-text);
  animation: p2p-pulse 2.5s ease-in-out infinite;
}

@keyframes p2p-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-border); }
  50% { box-shadow: 0 0 0 14px transparent; }
}

.p2p-modal-title {
  margin-bottom: 6px;
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.p2p-modal-sub {
  margin-bottom: 24px;
  font-size: 13px;
  color: var(--muted);
}

.p2p-actions {
  display: flex;
  justify-content: center;
  gap: 20px;
}

.p2p-accept-btn,
.p2p-reject-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  padding: 0;
  border: none;
  border-radius: 50%;
  color: var(--white);
  cursor: pointer;
  transition: transform var(--transition), filter var(--transition);
}

.p2p-accept-btn { background: var(--online); }
.p2p-reject-btn { background: var(--danger); }

.p2p-accept-btn:hover,
.p2p-reject-btn:hover {
  transform: scale(1.06);
  filter: brightness(1.08);
}

.p2p-overlay.is-active {
  flex-direction: column;
  background: var(--stage);
}
```

…plus: `p2p-videos`/`p2p-remote` (full-bleed, `--stage-tile` letterbox bg, `object-fit: cover`), `p2p-remote.is-speaking` inset ring `box-shadow: inset 0 0 0 calc(2px + var(--speak-level, 0) * 4px) var(--speak-ring)`, `p2p-timer` = live-pill recipe positioned `top: 16px; left: 16px; position: absolute; z-index: 2`, `p2p-local` 220×160 r14 absolute bottom-right-ish (`right: 24px; bottom: 96px` — clear of the control bar) with `border: 1px solid var(--stage-line)`, `--shadow-menu`, mirrored video, `p2p-local.is-speaking` outer ring (same formula), `p2p-local-label` = plate recipe at 11px, `p2p-plate`/`p2p-plate-mic` = stage plate recipe, `p2p-controls` = stage-controls recipe positioned `position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%); z-index: 1`, `p2p-ctl/-btn/-label/-divider/p2p-leave-btn` = exact stage values (46×46 r14 `--stage-toggle`, `.is-off` solid `--danger`, labels 10.5/600 `--stage-muted`, divider 1×40, leave pill r999 `--danger` 13/700). Every value token-only.

- [ ] **Step 4: Gates**

```bash
cd client && npx stylelint src/components/CallUI.css      # 0 problems
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/CallUI.css   # only the sanctioned overlay scrim (same value as Task 5's) — or zero
npm run lint:css 2>&1 | tail -3                           # ≤ recorded total
npx tsc --noEmit && npm test && npm run check:i18n
```

- [ ] **Step 5: Probe + screenshots** — `node tools/smoke.mjs --probe tools/probe-p2p.js --out m3t6-incoming-light.png`, `--theme dark --out m3t6-incoming-dark.png`, plus an active-overlay shot from the probe's second phase. Confirm the toast animation: `rg -n 'error-toast' src/components/CallUI.tsx` unchanged; the 0.22s recipe lives in primitives (decision 17 — nothing to change, record the confirmation in the ledger).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/CallUI.tsx client/src/components/CallUI.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): 1:1 call overlay on p2p-* — system incoming modal, stage-token active view, labeled control bar"
```

---

### Task 7: Mobile voice banner (board 1f)

**Files:**
- Create: `client/src/components/VoiceBanner.tsx`, `client/src/components/VoiceBanner.css`
- Modify: `client/src/components/ChatArea.tsx` (new prop + render), `client/src/pages/AppPage.tsx` (pass `voiceParticipants`), `client/src/i18n/locales/ru.ts` + `en.ts`

**Interfaces:**
- Consumes: `voiceParticipants: Map<string, string[]>` (AppPage state, already maintained by WS voice events), `members: MemberWithUser[]` (ChatArea already holds), `Avatar`, `useCallStore` `callChannelId` (ChatArea already subscribes).
- Produces: `VoiceBanner` props `{ channelName: string; participantIds: string[]; members: MemberWithUser[]; inThisCall: boolean; onJoin: () => void; onShowCall?: () => void }` — renders `null` when `participantIds.length === 0`. Classes: `voice-banner, voice-banner-avatars, voice-banner-avatar, voice-banner-text, voice-banner-btn`. i18n: `call.voiceBanner: 'В голосовом «{{channel}}» — {{count}}'` / `'In voice "{{channel}}" — {{count}}'`; `call.bannerJoin: 'Войти' / 'Join'`; `call.bannerGoToCall: 'К звонку' / 'To call'`.

- [ ] **Step 1: Fail-first probe** `tools/probe-voice-banner.js`: `--fake-media --touch` at mobile size (`--size 390x844`), navigate to a channel, push a synthetic voice-state WS event for another user id via the existing `tools/inject-voice-ws.js` pattern (WS injection via `dispatchEvent` — see the M1/M2 harness notes; verify that injector's event shape against the current `AppPage` voice handlers before trusting it) → assert `.voice-banner` exists (loud fail pre-task), measures: bg `--accent-soft` computed, border `--accent-border`, r12, text 12.5/700, button 32px solid accent with text «Войти». Also assert desktop absence: re-run without `--touch` at 1440×900 → `.voice-banner` has `display: none`. Run pre-task → loud failure.

- [ ] **Step 2: `VoiceBanner.tsx`**

```tsx
import { Avatar } from '@/components/Avatar';
import { useT } from '@/i18n';
import type { MemberWithUser } from '@/types';
import './VoiceBanner.css';

interface VoiceBannerProps {
  channelName: string;
  participantIds: string[];
  members: MemberWithUser[];
  inThisCall: boolean;
  onJoin: () => void;
  onShowCall?: () => void;
}

/** Board 1f: mobile-only voice banner — «В голосовом „Общий“ — 2» + join. */
export function VoiceBanner({ channelName, participantIds, members, inThisCall, onJoin, onShowCall }: VoiceBannerProps) {
  const t = useT();
  if (participantIds.length === 0) return null;
  const shown = participantIds.slice(0, 3);
  const action = inThisCall ? onShowCall : onJoin;
  return (
    <div className="voice-banner">
      <div className="voice-banner-avatars">
        {shown.map((id) => {
          const member = members.find((m) => m.user_id === id);
          return (
            <Avatar
              key={id}
              username={member?.username ?? id.slice(0, 8)}
              url={member?.avatar_url}
              className="voice-banner-avatar"
            />
          );
        })}
      </div>
      <span className="voice-banner-text">
        {t('call.voiceBanner', { channel: channelName, count: String(participantIds.length) })}
      </span>
      {action && (
        <button type="button" className="voice-banner-btn" onClick={action}>
          {inThisCall ? t('call.bannerGoToCall') : t('call.bannerJoin')}
        </button>
      )}
    </div>
  );
}
```

(Check `t()`'s param signature — M2 used `t('chat.quietBody', { channel: … })`; match its value type exactly.)

- [ ] **Step 3: `VoiceBanner.css`** — board 1f values, mobile-only:

```css
/* Board 1f voice banner — mobile-only; desktop has the sidebar voice card. */
.voice-banner {
  display: none;
  align-items: center;
  gap: 10px;
  margin: 10px 12px 0;
  padding: 10px 12px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: 12px;
  flex-shrink: 0;
}

@media (width <= 768px) {
  .voice-banner {
    display: flex;
  }
}

.voice-banner-avatars {
  display: flex;
  flex-shrink: 0;
}

.voice-banner .voice-banner-avatar {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  object-fit: cover;
  box-shadow: 0 0 0 1.5px var(--accent-soft);
}

.voice-banner-avatar + .voice-banner-avatar {
  margin-left: -6px;
}

.voice-banner-text {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--accent-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.voice-banner-btn {
  flex-shrink: 0;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-row);
  background: var(--accent);
  color: var(--white);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background var(--transition);
}

.voice-banner-btn:hover {
  background: var(--accent-hover);
}
```

(The avatar ring uses the banner's own bg color per the board's "1.5px banner-colored ring".)

- [ ] **Step 4: Wire it** — `AppPage.tsx`: pass `voiceParticipants={voiceParticipants}` to `<ChatArea …>`. `ChatArea.tsx`: add `voiceParticipants?: Map<string, string[]>` to props; render after the `.chat-header` close tag, before `.chat-messages`:

```tsx
<VoiceBanner
  channelName={channel.name}
  participantIds={voiceParticipants?.get(channel.id) ?? []}
  members={members}
  inThisCall={callChannelId === channel.id}
  onJoin={() => onJoinVoice?.(channel)}
  onShowCall={onShowCall}
/>
```

Note: when in this call on mobile, the user is on the `chat` panel when they see the banner (the stage lives on the `call` panel), so `onShowCall` is the correct action; on desktop the CSS hides the banner entirely.

- [ ] **Step 5: Gates + probes**

```bash
cd client && npx stylelint src/components/VoiceBanner.css   # 0 problems
npm run lint:css 2>&1 | tail -3 && npx tsc --noEmit && npm test && npm run check:i18n
node tools/smoke.mjs --fake-media --touch --size 390x844 --probe tools/probe-voice-banner.js --out m3t7-banner-light.png
node tools/smoke.mjs --fake-media --touch --size 390x844 --theme dark --probe tools/probe-voice-banner.js --out m3t7-banner-dark.png
node tools/smoke.mjs --probe tools/probe-voice-banner.js    # desktop: display none branch
```

- [ ] **Step 6: Commit**

```bash
git add client/src/components/VoiceBanner.tsx client/src/components/VoiceBanner.css client/src/components/ChatArea.tsx client/src/pages/AppPage.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): mobile voice banner per board 1f — accent-soft card with participants + join"
```

---

### Task 8: Final gate sweep + visual QA + ledger closeout numbers

No production code changes expected; fixes found here go into this task's commit (or a scoped fix commit if large — surface first).

**Files:** none planned (fixes only).

- [ ] **Step 1: Full static gates, recorded verbatim**

```bash
cd client && npm run lint:css 2>&1 | tail -3      # record final total; must be ≤ 531 (expected: below — CallStage/CallUI legacy violations died)
for f in CallStage.css CallUI.css ScreenSharePicker.css VoiceBanner.css VolumeControlPopover.css; do npx stylelint "src/components/$f" || echo "FAIL $f"; done   # each 0 problems
npx stylelint src/styles/tokens.css src/pages/AppPage.css 2>&1 | tail -2   # no gain vs Task-1/Task-4 recordings
npx tsc --noEmit
npm test                                          # only api.network-retry fails (3), 2 unhandled rejections there; new totals recorded
npm run check:i18n                                # exit 0, the 4 ErrorBoundary warnings only
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/CallStage.css src/components/CallUI.css src/components/ScreenSharePicker.css src/components/VoiceBanner.css src/components/VolumeControlPopover.css   # zero rows, or exactly the sanctioned overlay-scrim value(s) if primitives had no token
rg -n 'alert\(' src/components/CallStage.tsx      # zero rows
rg -n "mic-badge|conn-indicator|conn-tooltip|video-tile|thumbnail-tile|screen-share-main|control-btn|call-controls|mic-btn-wrap" src/components/ src/pages/  # zero rows — no orphaned old classes in JSX or CSS
```

- [ ] **Step 2: Bidirectional class scan** — for each M3-owned CSS file, every selector class must appear in some TSX and every `stage-*`/`p2p-*`/`voice-banner-*`/`screen-*` className in TSX must have a rule (the M2 final-review technique that caught `msg-mention-role`). Script it; record the result.

- [ ] **Step 3: Fresh-server visual QA, both themes** — restart the dev server (stale-server rule), then re-run every M3 probe at HEAD: `probe-stage-grid`, `probe-stage-chrome`, `probe-stage-speaking`, `probe-stage-focus`, `probe-screen-picker`, `probe-p2p`, `probe-voice-banner`. Screenshot set: stage grid light/dark, focused view dark, quality picker light/dark, incoming call light/dark, active 1:1 dark, mobile stage (`--touch`), mobile banner light/dark. Open `design_handoff_discord_redesign/Redesign.dc.html` sections `1e`/`2e`/`1f` side-by-side in Chrome and compare: top bar composition, tile/plate/ring anatomy, control bar anatomy, banner anatomy. List every deviation with a ruling (adapted / defect-fix-now / defer-M6).

- [ ] **Step 4: Cross-surface regression spot-check** — the M2 chat column and M1 shell must be untouched by M3's CSS deletions: re-run `tools/probe-chat.js` (verify its `.composer-input` selector is still current first) and `tools/probe-sidebar.js`; confirm `CallDock` renders (join voice, switch to another channel — the dock appears in the sidebar footer; screenshot).

- [ ] **Step 5: Record for the closeout** — final lint total and per-file numbers, test totals, the reasoned-not-measured list (expected: Electron fullscreen branch, Electron source picker, screen-share toast path, multi-party speaking ring on *remote* streams — the fake-participant injection has `stream: null`, so remote rings were never exercised with live audio; say so plainly), smoke-server residue added by M3 probes, and the confirmations of the two M2 open decisions (plan decisions 17).

- [ ] **Step 6: Commit** (only if fixes landed; otherwise no commit — the ledger records the sweep)

```bash
git add -u client/src
git commit -m "fix(redesign): M3 final-sweep fixes"   # only when non-empty; never git add -A
```

---

## Self-review notes (spec coverage)

Spec §5 M3 bullet → tasks: top bar (T3) · responsive tile grid 1/2/3 (T2+T3) · name plates with mic/equalizer (T3) · speaking ring from existing detection (T2 extraction + T3) · control bar with labels, divider, danger «Выйти» (T3) · screen-share view (T4) + picker (T5) · quality tooltip (T3) · CallUI overlay (T6) · mobile voice banner (T7). §2 Voice-UI adaptation honored in decision 19; §7 out-of-scope respected (no services/, no server/, no typing/reactions/badges). M3-specific hazards from the session brief: raw-value concentrations → decision 1 + Global-Constraints grep gate; ScreenSharePicker import hazard → T5; existing-speaking-detection-only → decisions 6–7; VYC-77 no-channel-type → decision 19 (state-driven banner). M2's two open decisions → decision 17.
