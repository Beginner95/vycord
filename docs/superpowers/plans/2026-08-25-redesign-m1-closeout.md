# M1 (App Shell) — closeout & handoff to M2/M4/M6

**Status:** complete. 9 commits, `0a84b43..f39e699` on `redesign`. Not pushed; `main` untouched.
**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` §5 M1 bullet.
**Plan:** `docs/superpowers/plans/2026-08-25-redesign-m1-app-shell.md`.

Every task passed a task-scoped review; the whole-branch review (opus) returned 0 Critical,
2 Important, 12 Minor, and all 5 fix-now items were fixed in `f39e699` and re-reviewed clean.
This file exists because the SDD workspace is gitignored — the triage below is the part later
milestones need and would otherwise be lost.

## Decisions made during M1 that bind later work

1. **Avatar palette is single-sourced in JS** (`src/utils/avatarColor.ts`). The unused
   `--avatar-1..8` tokens were deleted. `Avatar.tsx` renders its fallback with an inline
   `--avatar-color` and paints `background: var(--avatar-bg, var(--avatar-color))` /
   `color: var(--avatar-ink, #FFFFFF)`, so CSS can re-theme an avatar without JS theme awareness.
   First consumer: the offline-in-dark treatment at `UserList.css` (spec §4.3, ~30% alpha) —
   verified rendering `rgb(232,89,12)` at exactly 0.3 alpha.
2. **Type-scale custom properties landed** in `base.css` (`--fs-title|heading|body|label|caption|
   group`, `--ls-group`), closing the spec §4.1-vs-§5 gap. In-between handoff values (12.5px, 13px,
   10.5px…) stay literal in component CSS by design. `--fs-title` and `--fs-body` are currently
   unconsumed — they are for M2/M4.
3. **Voice UI is state-driven, not type-driven** (spec §2, VYC-77). Any channel with voice
   participants renders the voice card; all others keep a quiet join affordance. There is no
   «ГОЛОСОВЫЕ» group and no channel type.
4. **Mic states are bounded by spec §7.** `micStateFor` returns `null` for any channel that is not
   your own active call, because `remoteMicMuted` is only populated for the call you are in.
   Rendering mic state for other sessions needs a backend change that §7 forbids. Do not "fix" this
   client-side by assuming a default.
5. **Invite expiry is derived, never hardcoded.** `server/internal/usecase/invite.go:30-34` never
   sets `ExpiresAt`, so invites from this backend carry no `expires_at` and the card reads
   «Ссылка не истекает». The board's literal «Ссылка живёт 7 дней» would be false against this
   server. `inviteExpiry`'s `{kind:'days'}` branch is contract-valid and unit-tested — not dead code.

## Deferred findings, triaged by owner

### M2 (chat column) — do these first or while in the file
- **Reorder `src/main.tsx` imports before touching `ChatArea.css`.** `main.tsx:3` imports `App`
  while the `styles/*` imports come after, so ES-module evaluation injects the whole component-CSS
  graph BEFORE tokens/base/primitives. At tied specificity `primitives.css` therefore beats every
  component override. This already killed one rule in M1 (`.invite-card-btn { height: 32px }` lost
  to `.btn { height: 34px }`; fixed by raising to `.invite-card .invite-card-btn`). M2 will want to
  override `.btn`/`.modal`/`.kbd` repeatedly. Deliberately not done at M1 close: it is a global
  cascade change and M1 had no re-probe budget left; M2 re-verifies computed values anyway.
- `.no-server-message` (`ChannelSidebar.css`) is the last M1-surface desktop rule still on a legacy
  alias (`--text-muted`). One word.
- Header seam: `ChatArea.css` header is 56px, sidebar is 58px, board column C says 58px. M2 closes it.
- `.chat-voice-btn.in-call` (`ChatArea.tsx`) has no CSS anywhere — pre-existing orphan, free cleanup.
- `ChatArea.tsx` still has a fourth hand-inlined back-arrow SVG at `strokeWidth="2.5"` (spec §4.2).
- `.panel-icon-btn.is-off` has no explicit `:hover`; its stable appearance depends on source order.
  Re-check if M2 reorders/extends `primitives.css`.
- `voiceChannelNameFor` first-match-wins is untested for a multi-entry map (unreachable from the
  server; one extra test case if anyone is in the file).
- Avatar's `--avatar-bg`/`--avatar-ink` contract has no unit test (it is exercised by real CSS and
  browser-verified in both themes).

### M4 (modals, menus, settings)
- **The sidebar header chevron opens a server context menu that M1 built** (board `1d` = M4 scope;
  kept because an inert chevron is a dead affordance). It leaves two debts: a NEW `window.confirm`
  call site — which M4's bullet exists to replace with the destructive-confirm modal — and a verbatim
  duplicate of `ServerList.tsx`'s delete flow. Dedupe both when M4 builds the real menu.
- `hasServerMenu`'s `isOwner` term is subsumed by `canManageServer`.
- `inviteExpiry` clamps an already-expired invite to `{days:1}`; an `{kind:'expired'}` variant is
  more honest and belongs with manage-invites.
- Clipboard failures are swallowed and the UI still says «Скопировано» (same convention as
  `ManageInvitesModal` — fix both together).
- The invite card creates a NEW invite each time after a server switch; `listInvites`-first would
  reuse. Orphans are listable/revocable in `ManageInvitesModal`.
- Invite-card stale-response path is a silent no-op with no user feedback.

### M6 (polish, dark parity, responsive, alias deletion)
- Dark `.panel-icon-btn` uses `--canvas` (#0E1017), darker than the `--panel-footer` (#0F131D) strip
  it sits on, so footer/CallDock buttons read recessed. Dark-parity pass.
- `--danger-soft` / `--danger-text` dark values are "refine in M6" interpolations — M2's optimistic
  "не отправлено · повторить" chip is a dark surface, so refine early or accept a placeholder.
- Mobile blocks still use legacy aliases throughout (ServerList 19 uses, UserList 7, ChannelSidebar 4)
  plus the explore modal's 24 (M4's surface).
- Mobile `.user-list-mobile-header { position: sticky }` is inert since scrolling moved to
  `.user-list-scroll` — no visual regression, just dead.
- Mobile `.server-icon.add/.search .server-icon-symbol` font-size rules are inert over `<svg>`.
- `.server-icon.search:hover` duplicates `.server-icon:hover` verbatim.
- Off-scale radii: `7px` in `ChannelSidebar.css` and `UserList.css` (handoff scale is 6 · 8–9 ·
  10–11 · 12–14 · 15–18 · 999).
- `.rail-bottom` separator uses `--rail-line` (.14); board specifies .12 for that border.
- Stale comment in `ChannelSidebar.css` arguing against `--radius-full` — M0 redefined that alias to
  999px, so the comment is now wrong; `--radius-pill` is the intended token.
- Icon sizes 14px and 15px sit below spec §4.2's stated 16–21px range (the 15px `Plus` is
  board-mandated; the 14px ones are extrapolations). Stroke width is 1.8 across all 20 lucide icons.
- `as CSSProperties` cast in `Avatar.tsx` also disables checking of the standard properties.
- `.panel-icon-btn` has no `:focus-visible` (inherited gap; the global ring in `base.css` applies).
- No ARIA live region on the invite-card error or the copied-state label.
- `::selection` legibility regression inherited from M0 (still awaiting the user's design call).

## Verification harness (NOT in git — lives in the gitignored SDD workspace)

`.superpowers/sdd/2026-08-25-redesign-m1-app-shell/tools/` holds the CDP smoke harness M1 was
verified with. Preserve it for M2. Flags added during M1, with the reason each exists:
- `--probe <file.js>` — evaluate a per-task DOM assertion file and print JSON.
- `--preload <file.js>` + `--push-ws '<type>:<json>'` — record the app's WebSocket before any page
  script runs, then dispatch a real server-shaped frame at it. This is how the voice card was
  verified without an SFU. Note `websocket.ts` binds via `addEventListener`, so the injector must
  use `dispatchEvent`, not `.onmessage`.
- `--after <ms>` — post-click settle (the old hardcoded 1500ms is too short for anything async).
- `--touch` — emulate a coarse, hover-incapable pointer so `@media (hover: none)` branches apply.
  **This closed a real blind spot:** every M1 probe before it ran with a hover-capable pointer, which
  is why a dark+touch regression survived seven task reviews. Note that
  `Emulation.setEmitTouchEventsForMouse` and `Emulation.setEmulatedMedia {features:[hover/pointer]}`
  do NOT change the media features; `setTouchEmulationEnabled` + `setDeviceMetricsOverride
  {mobile:true}` does.
- `--fake-media` — synthetic mic/camera. Present but insufficient: a headless SFU join never
  completes on this machine, so live-call UI (CallDock, in-call mic states) is still code-read only.

## Environment notes carried forward

- `npm test` is RED at baseline: 3 tests in `src/services/__tests__/api.network-retry.test.ts` were
  merged without their implementation. M1's correct gate is `Test Files 1 failed | 18 passed (19)`,
  `Tests 3 failed | 122 passed (125)`. That file also emits 2 unhandled rejections — proven to
  originate solely there.
- Electron cannot launch (npm 11 `allowScripts` skipped its postinstall; `node_modules/electron/dist`
  is 292K, not ~250MB). Fix with `npm install-scripts ls` in `client/` if needed. M1 touched nothing
  under `electron/`.
- `npm run check:i18n` prints 4 heuristic warnings for `ErrorBoundary.tsx` and exits 0 — M4's strings.
