# Redesign M4 — Modals, Menus, Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the app's modal/menu layer to board `1d`: the merged one-field find-server modal, the settings modal (186px nav, new toggle/select/slider/level-meter primitives, danger «Выйти» pinned bottom), server & channel context menus (caps label, icons, separated destructive row), and the hardened `ConfirmModal` reused for every destructive action — then sweep the unspecced modal/banner surfaces (manage invites, edit/create server & channel, sticker manager, avatar crop, link dialog, update banner, call-notif banner, error boundary onto i18n), killing every `window.confirm`, every catch-path `alert()`, and every remaining emoji-as-icon on these surfaces. `primitives.css` — M4's layer, held flat at 21 violations since M2 — is swept to 0.

**Architecture:** `primitives.css` is rewritten first (Task 2): modal-shell header/close pattern, the four new form primitives, kebab keyframe renames with every consumer reference updated in the same commit, and the bare `.online`/`.danger` modifiers renamed to `is-*` with their emitters. The legacy `.modal-actions button` recipe is **carried in a marked block** until the last hand-rolled modal converts to `.btn` roles (Task 8 deletes it — that is where primitives.css reaches 0, not Task 2). New shared code: `hooks/useModalFocus.ts` (focus trap + restore + Esc, replacing ConfirmModal's re-subscribing effect), `components/ServerMenu.tsx` (dedupes the ChannelSidebar/ServerList server-menu flow), `components/FindServerModal.tsx` (lifted to AppPage so the rail tile and the chat empty-state both open it), `components/CallNotifBanner.tsx` (extracted from AppPage). The context-menu recipe moves into `primitives.css` per spec §4.1 and `ContextMenu.css` is deleted. No store changes; no API/WS changes; every data limitation of the board (join-request button, result-row counts) is ruled on below from read-only backend facts.

**Tech Stack:** React 19 + Vite + Zustand + plain per-component CSS, lucide-react icons, vitest (node env — no jsdom; DOM behavior is probe-verified), stylelint 17, CDP smoke harness.

**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` (§5 M4 bullet; §2 scope decisions, §3 current-state facts, §4.1 primitives layer, §7 out of scope). Pixel source of truth: `design_handoff_discord_redesign/README.md` — section "5. Modals, context menu, confirmation — option 1d" plus the toggle/select/slider/level-meter rows of "Design tokens". Also binding: `docs/superpowers/plans/2026-08-25-redesign-m3-closeout.md` (21 rulings, M4 triage, harness corrections), `docs/superpowers/plans/2026-08-25-redesign-m2-closeout.md` (17 rulings, stylelint history, ConfirmModal findings). `docs/superpowers/backlog/post-redesign-backlog.md` is **excluded scope** — nothing in its §1 (camera-off predicate, lost draft, catch-path repaint, stale-POST no-op, null-channel toast) is planned here; if a task brushes against one of them, record the contact in the ledger and move on.

## Global Constraints

- Branch `redesign` only; one commit per task; **never** commit to `main`; **never** `git add -A` (`design_handoff_discord_redesign/` is untracked on purpose).
- No changes under `server/`; no API/WS contract changes; **no changes to `src/services/`** (the mic-test meter uses `getUserMedia` from the settings component plus the existing `hooks/useMicLevel.ts` — zero services edits); `src/types/index.ts` untouched; `client/e2e/` untouched. Legacy token aliases in `src/styles/tokens.css` stay until M6 — `tokens.css` changes are **additions only**.
- All work under `client/`. Product copy is Russian; every new string lands in `src/i18n/locales/ru.ts` **and** `en.ts` together. `npx tsc --noEmit` is the real ru/en parity gate (`en` is typed against `ru`'s `Dictionary`); `npm run check:i18n` is a hardcoded-Russian-string heuristic that currently prints **4 ErrorBoundary warnings — M4 takes them to 0** (Task 10) and it must never grow. Plural strings render via `tp()`/`useTp()` — `t()` renders the literal key for plural entries.
- Icons: lucide-react, `strokeWidth={1.8}`, 16–21px (smaller sizes inside chips/rows are permitted as M3's disclosed-deviation precedent; record each). No emoji as UI icons, no hand-inlined SVGs in touched code — ManageInvitesModal's three inline SVGs, the 🖼️/🔍/⚠️/🔔/💬/📞/➡️/⬅️ instances and every `✕` text close button on M4 surfaces are all replaced.
- Animation budget ≤250ms ease-out. Modal entrance stays the 180ms `modal-in` pattern (opacity + 4px rise); menu entrance 120ms.
- **Test delta-gate:** `npm test` baseline is RED by design — exactly 3 failures + 2 unhandled rejections, all in `src/services/__tests__/api.network-retry.test.ts`. Current shape: `Test Files 1 failed | 22 passed (23)` · `Tests 3 failed | 149 passed (152)` · `Errors 2 errors`. Gate: no *other* file may fail; new tests must pass; never fix that file. **A test paste that says "same file" without the `FAIL` lines naming the file is not evidence.**
- **Stylelint delta-gate:** total from `npm run lint:css` must never exceed **531** (current total: **271** — record the exact number at every task boundary; it should only fall). Every file M4 creates or rewrites must be individually 0 problems (`cd client && npx stylelint <file>`), with two scheduled exceptions ruled below: `primitives.css` carries the marked `.modal-actions` legacy block until Task 8, and `ServerList.css` carries `.search-empty` until Task 8 (both M2-CONFLICT-1 precedent, enumerated in the ledger). Stylelint **must run from `client/`** — `importFrom` is cwd-relative and crashes with `ENOENT` from the repo root, **which is not a lint result**. `--formatter json` output goes to **stderr** — pipe with `2>&1`, never `2>/dev/null`. Do NOT mass-fix legacy files (`ChannelSidebar.css`, `ServerList.css`, `AppPage.css`, `ChatArea.css` get surgical edits/deletions only; deletions that remove violations are welcome, rewrites of untouched rules are not).
- Class names: multi-segment kebab-case with a component prefix; state modifiers `is-*`/`has-*`; **never** BEM `--`/`__` (`update-banner__dismiss` is renamed). Singles allowlist is only `btn|input|kbd|modal|mention`.
- New/rewritten CSS uses media-query **range syntax** (`(width <= 768px)`) — `media-feature-range-notation` requires it (M2 ruling 17's accepted Safari <16.4 exposure; M6 resolves).
- JS-injected custom properties are invisible to stylelint's `importFrom` — every CSS reference to `--slider-fill` and `--meter-level` (new, set inline from JSX) must carry a fallback: `var(--slider-fill, 0%)`, `var(--meter-level, 0%)`.
- **Raw-value rule for M4-owned files:** after M4, `rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' <file>` must return **zero rows, literally** for every file M4 creates or rewrites: `primitives.css`, `FindServerModal.css`, `Settings.css`, `ProfileSettings.css`, `EditServerModal.css`, `ManageInvitesModal.css`, `LinkDialog.css`, `StickerManager.css`, `AvatarCropModal.css`, `UpdateBanner.css`, `ErrorBoundary.css`, `CallNotifBanner.css`. (Data-URI SVGs with `%23`-escaped colors or bare `white` do not match the grep — the checkbox check-mark data-URI is the one sanctioned survivor, ruled below.)
- Visual verification: CDP harness `tools/smoke.mjs` — **Task 1 copies it forward from the M3 workspace; it is gitignored and the only copy.** Corrections that override older plan texts (M3 closeout "Verification harness"): `--click` is `el.click()` with **no user activation** (anything needing transient activation rejects; `userGesture: true` exists only at the probe-eval call site, `smoke.mjs:385`); `--fake-media` fakes devices and auto-grants permission but joins nothing; `--after 6000` is unreliable — use **9000+** for any call-surface run; `--push-ws` is inert without `--preload tools/inject-voice-ws.js` and fires before `--click`/`--probe`; `probe-callstate.js` is inert and **banned as evidence**; `probe-chat.js` **cannot fail until Task 1 repairs it**. Probe scripts may be async and must **throw** on any missed assertion — never record a boolean and move on. Native dialogs (`window.confirm`/`alert`) **block the CDP session** — any probe near a legacy confirm path must poison them first (`window.confirm = () => { throw new Error('window.confirm called'); }`), which doubles as the fail-first signal.
- Dev server: `cd client && npm run dev:vite` → http://localhost:3000 **exactly** (prod CORS allowlist; a 3001/3002 fallback fails login with a CORS error that is not a bug). Test account `redesign_smoke@vycord.local` / `RedesignSmoke2026!`, throwaway server «Redesign Smoke» — production API, destructive testing only there. **A dev server predating HEAD invalidates visual evidence** — compare server start time against HEAD's commit timestamp before trusting any screenshot, and kill stale servers (three were found alive at M3 start).
- **Fail-first probes (mandatory):** every verification probe must be written and run against the **pre-task** state first and must fail **loudly** there, before its post-task pass is trusted. Assert the precondition, never assume it (M3 ruling P4): read which modal/menu is open, read counts before asserting them.
- Electron cannot launch (npm 11 skipped its postinstall; `node_modules/electron/dist` is 292K) — `UpdateBanner` and every other Electron-only branch is verified statically and recorded as **reasoned-not-measured**.

## Decisions ruled on while planning (binding for this milestone)

1. **The board's «Запрос» (request-to-join) button is undeliverable and is not shipped.** `server/internal/repository/postgres/server.go:298`: search is `WHERE s.name ILIKE $1 AND s.is_private = false` — private servers never appear in results, and no join-request API exists (spec §1/§7: no backend changes). Every find-server result row gets the primary «Войти» action. **Cost if wrong:** a board affordance is absent; adding it later is additive.
2. **The board's "4 участника · 2 канала" result-row meta is undeliverable and is dropped.** `Server` (`types/index.ts:13-21`) carries no counts; only `InvitePreview` has `member_count`. Search rows render avatar + name only; the invite-preview row renders «участников: N» via the **existing** `server.joinByCode.memberCount` key. **Cost if wrong:** thinner result rows than the board draws; no data is invented.
3. **Merged-field mechanics (spec §2: one field, not two):** a single input, 300ms debounce; each debounced query fires `apiService.searchServers(q)` and `apiService.previewInvite(q)` **in parallel** (`Promise.allSettled`); a preview rejection is swallowed (an arbitrary string 404s — expected), a preview hit renders as a distinguished row above the «РЕЗУЛЬТАТЫ» group. No code-shape heuristics, no keyboard result navigation (M5's palette owns that pattern). **Cost if wrong:** one no-op 404 per debounced keystroke batch — harmless, server-verified cheap.
4. **`FindServerModal` is a new component owned by AppPage.** ServerList's built-in explore modal (two fields, preview flow) dies; ServerList gets an `onOpenFindServer` prop for the rail search tile; ChatArea's no-servers empty state gains the M2-promised secondary «У меня есть код» outline button wired to the same open callback. Footer «Создать свой» chains to the existing create-server modal (`onCreateServer`). **Cost if wrong:** the modal opens from one fewer place; wiring is two props.
5. **`primitives.css` is swept to 0 in M4 (human-ruled, supersedes M2 ruling 13's hold-flat for this milestone).** The sweep is staged: Task 2 rewrites the file clean **except** a marked `/* ═══ LEGACY (carried until T8): .modal-actions button recipe ═══ */` block that keeps the bare `.primary` selectors alive while hand-rolled modals still emit them; Task 8 converts the last emitter and deletes the block — **0 problems, no exceptions, from Task 8 on.** **Cost if wrong:** ~3 enumerated violations live for six tasks; the alternative was unstyled modal buttons mid-milestone.
6. **Keyframe renames land with every consumer in one commit (Task 2):** `fadeIn`→`fade-in`, `scaleIn`→`scale-in`, `modalIn`→`modal-in`. Consumers to update in the same commit (verified by grep at planning time): `primitives.css` itself (`.modal-overlay`, `.modal`, the radio `::after`), `ConfirmModal.css:9`, `CallUI.css` (`.p2p-modal`), `Settings.css:11,24`, `ContextMenu.css:13`, `AvatarCropModal.css` (its `fadeIn`/`scaleIn` refs). All 16 keyframe names in `client/src` are currently unique (M3 closeout) — renames cannot collide. **Cost if wrong:** a modal loses its entrance animation for one task's lifetime; nothing breaks functionally.
7. **Bare single-segment modifiers in primitives are renamed with their emitters (Task 2):** `.user-avatar-wrap.online` → `.user-avatar-wrap.is-online` (emitters `ChannelSidebar.tsx:266`, `UserList.tsx:123`); `.panel-icon-btn.danger` → `.panel-icon-btn.is-danger` (emitters `ChannelSidebar.tsx:287`, `CallDock.tsx:56`). `.panel-icon-btn.is-off` is already compliant. The `.modal-actions button.primary` selectors are the carried block (decision 5). **Cost if wrong:** a styling gap on the sidebar footer/dock caught by the bidirectional class scan.
8. **`useModalFocus` replaces ConfirmModal's Esc effect and adds trap + restore — with a stacking contract.** Signature: `useModalFocus(active: boolean, containerRef: RefObject<HTMLElement | null>, onClose?: () => void): void`. `onClose` is kept in a ref updated every render, so the listener subscribes **once per open** — closing M2's re-subscription finding at its root rather than demanding `useCallback` at every call site. On activate: saves `document.activeElement`, focuses `[data-autofocus]` (else the first focusable); Tab/Shift+Tab cycle inside the container; Escape calls the ref'd `onClose`; on deactivate: restores focus if the saved element is still in the document. **Stacking (grand-review C1):** a module-level stack of instance tokens makes only the **top-most active instance** handle Escape/Tab — nested modals are real in M4 (Settings hosts its logout `ConfirmModal`), and without the stack one Escape closes both, since the bottom modal's listener registered first and fires first (`stopImmediatePropagation` cannot fix registration order). Standard stacking semantics are the ruled intent: Escape on a nested confirm closes only the confirm. Adopters in M4: `ConfirmModal` (always), `FindServerModal`, `Settings`. Other modals keep their current behavior — app-wide adoption is deferred, recorded for M6. **Cost if wrong:** focus behavior differs between hardened and legacy modals for the rest of the redesign — visible only to keyboard users, and strictly better than today everywhere it lands.
9. **ConfirmModal autofocuses Cancel, not the destructive button** (M2's finding: a stray Enter must not delete a server). `data-autofocus` goes on the Cancel button; the `autoFocus` attribute on the danger button is removed. API (`open/title/body/confirmLabel/onConfirm/onCancel`) is unchanged — existing ChatArea usage keeps working untouched. **Cost if wrong:** Enter-to-confirm costs one extra Tab; that is the intended trade.
10. **Both logout affordances live (human-ruled):** the sidebar footer button stays, and Settings gains the board-mandated «Выйти» row pinned to the nav bottom in danger. Both confirm through `ConfirmModal` (new keys `common.logoutTitle`/`common.logoutBody`, confirmLabel = existing `common.logout`); the hand-rolled yes/no modal in `ChannelSidebar.tsx:298-310` dies in Task 3. `Settings` gains an `onLogout?: () => void` prop threaded from ChannelSidebar's existing prop. **Cost if wrong:** a redundant affordance — the board's own footer keeps a settings-adjacent cluster, so redundancy is board-plausible.
11. **The level meter is live, behind a mic-test button (human-ruled).** A «Проверка микрофона» row in AudioSettings: pressing «Проверить» runs `navigator.mediaDevices.getUserMedia({ audio: true })` in the component, feeds the stream to the **existing** `useMicLevel(stream, false)`, renders `--meter-level: ${Math.round(level * 100)}%` inline on the meter; «Остановить» (and unmount) stops all tracks. Failure renders `settings.micTestError` as a `.setting-warning`. Zero `src/services/` changes. **Cost if wrong:** a capture leak — bounded by the unmount cleanup the task's probe asserts.
12. **Device selects stay inert, restyled.** The input/output/camera selects render one hardcoded option today; wiring real device enumeration into calls requires `services/` changes (out of scope §7). Restyled onto the new select primitive, behavior unchanged, recorded as **adapted**. **Cost if wrong:** a select that looks functional but has one option — exactly today's shipped behavior in new clothes.
13. **The context-menu recipe lands in `primitives.css` and `ContextMenu.css` is deleted** (spec §4.1 lists the context menu as a primitives-layer item; the component keeps no styles of its own). `ContextMenu` API extends: items gain `icon?: ReactNode`; the component gains `label?: string` (caps header); **the separated-destructive rule becomes structural** — the component renders non-danger items, then, if any `danger` items exist, a separator and the danger group last. Callers cannot violate board 1d's "destructive is always last and separated" by construction. `.context-menu-item.danger` → `.is-danger`. **Cost if wrong:** menus that intentionally wanted a mid-list destructive row can't have one — no such menu exists or is planned.
14. **`ServerMenu.tsx` dedupes the server-menu flow.** One component owning the ContextMenu items (Пригласить / Настройки сервера / Удалить сервер with permission gating), the `EditServerModal` + `ManageInvitesModal` renders, the delete `ConfirmModal`, and the delete API call + error toast. Props: `{ server: Server; user: User | null; anchor: { x: number; y: number }; onClose: () => void; onDeleted: (serverId: string) => void }`. ChannelSidebar (chevron button, anchored below the rect) and ServerList (right-click, anchored at cursor) both render it; their duplicated `handleDeleteServer`, menu-item arrays, and modal renders are deleted. **Cost if wrong:** one more indirection layer; the duplicate flow it replaces has already drifted once (permission-gate expressions differ subtly between the two copies today).
15. **Catch-path `alert()` dies with `window.confirm`.** The three sites (`ChannelSidebar.tsx:81,95`, `ServerList.tsx:104`) currently `alert(apiErrorText(...))` on a failed delete; they become component-local `.error-toast` state with a 5s auto-dismiss (M3's `stageError` pattern; the toast primitive is `position: fixed`, so it renders correctly from the sidebar). **Cost if wrong:** a delete failure surfaces as a styled toast instead of a native dialog — strictly better; the toast recipe is M2-probe-verified.
16. **New destructive-confirm copy is title+body per board 1d, replacing the single-string confirms.** New keys (ru shown; en mirrors): `server.deleteTitle: 'Удалить «{{name}}»?'` / `server.deleteBody: 'Сервер, его каналы и сообщения будут удалены навсегда. Это действие нельзя отменить.'`; `channel.deleteTitle: 'Удалить «{{name}}»?'` / `channel.deleteBody: 'Канал и все его сообщения будут удалены навсегда.'`; `chat.deleteStickerTitle: 'Удалить стикер «{{name}}»?'` / `chat.deleteStickerBody: 'Стикер станет недоступен всем участникам сервера.'`. The old `*.deleteConfirm` keys (and already-dead `chat.deleteConfirm`) are deleted in Task 10, not at swap time, so each task's diff stays surgical. **Cost if wrong:** dead keys live for a few tasks — invisible to users, caught by the Task 10 sweep.
17. **ErrorBoundary uses the i18n module** (new `crash` section: `title`, `body`, `reload`, `copyId`, `eventId: 'ID: {{id}}'`, `feedbackSummary`, `feedbackPlaceholder`, `feedbackSend`, `feedbackSent`). The i18n module and `localeStore` are independent of the crashed React tree — `CrashFallback` is a fresh component mounted by Sentry's boundary, and `useT` reads a plain zustand store; if *that* import graph is broken the app never booted at all. The crash *rendering* cannot be exercised in this environment (no jsdom, no crash hook) — verified statically, recorded reasoned-not-measured; the **measurable** gate is `npm run check:i18n` going 4 warnings → 0. **Cost if wrong:** a crash screen that itself crashes — mitigated by `CrashFallback` having no dependencies beyond `useT` + lucide.
18. **`CallNotifBanner` is extracted from AppPage** (new component + CSS; the 🔔/`✕` JSX at `AppPage.tsx:707-737` and the `.call-notif-*` rules in `AppPage.css` move out; AppPage.css only loses rules — its count must not gain). Props: `{ callerName: string; channelName: string; onJoin: () => void; onDismiss: () => void }`. Icons: `PhoneIncoming` 16, `X` 14. **Cost if wrong:** one extra file; the alternative (restyling inside a legacy CSS file under a no-sweep rule) is worse.
19. **UpdateBanner is Electron-only → statically verified.** `update-banner__dismiss` → `update-banner-dismiss` (BEM ban); token-only restyle on the accent-soft banner recipe (VoiceBanner's family); `window.electronAPI?.update` guard means the banner never renders in the browser harness. Recorded reasoned-not-measured, like every Electron branch since M1. **Cost if wrong:** a mis-styled banner visible only in a packaged Electron build; values are token-copies of a probe-verified recipe.
20. **New tokens (Task 1, additions only, before the LEGACY ALIASES block):** `--chip-bg: #F2F4F9` (board 1d's close-button / kbd-chip surface; dark `rgb(255 255 255 / 8%)`, marked refine-in-M6) and `--track-bg: #E9ECF5` (board's toggle-off-adjacent slider/meter track; dark `rgb(255 255 255 / 12%)`, refine-in-M6). `.kbd` moves from `--canvas-2` (#F6F7FB) to `--chip-bg` (#F2F4F9) — the board specs #F2F4F9 for the palette's `esc` chip. `--own-chip-bg` also equals #E9ECF5 but names the chat «вы» chip; reusing it on a slider track repeats M2's `--radius-row`-on-a-toast smell — a second token with the right name costs one line. **Cost if wrong:** two tokens M6's naming pass may merge.
21. **The checkbox check-mark data-URI survives as the one sanctioned non-token color.** `primitives.css`'s `input[type="checkbox"]:checked` embeds `stroke='white'` in a data-URI SVG — a constant white check on an accent fill, correct in both themes, invisible to the raw-value grep, and irreplaceable without an extra DOM element per checkbox. The select chevron does **not** get this treatment — the select primitive is a `.select-wrap` wrapper with a lucide `ChevronDown` in JSX (`pointer-events: none`), so it inherits `currentColor` and theme-adapts. **Cost if wrong:** one embedded literal; a dark-theme checkbox would need it anyway.
22. **`.search-empty` is carried in `ServerList.css` until Task 8.** Deleting ServerList's explore-modal rules in Task 5 would strand `ManageInvitesModal.tsx:82`, which still emits `search-empty` until its Task 8 rewrite renames it (`invites-empty`). Task 5 deletes every other explore rule; Task 8 deletes `.search-empty` with the last emitter. **Cost if wrong:** one rule lives three tasks past its surface; enumerated in the ledger.
23. **No new vitest surface except `utils` if a pure function falls out; DOM behavior is probe-verified.** The vitest environment is `node` with a hand-stubbed `window`/`document` (`src/test/setup.ts`) and **jsdom is not installed** — testing `useModalFocus` or modal rendering would mean a new devDependency and an environment change, which risks the RED-baseline shape for marginal value. Focus behavior, menu structure, and modal geometry are asserted by fail-first CDP probes against the real DOM instead. **Cost if wrong:** regressions in the hook surface only via probes/manual QA, not unit tests — accepted, consistent with M2/M3 practice.
24. **Settings dimensions: board wins.** Modal 648px (today 760), nav 186px (today 180), header ~20px 24px with a 30×30 close button, right pane 20px 24px, `max-height: 82vh` kept from today (the board draws no height cap; 82vh is the shipped behavior). Nav icons: `User`, `Volume2`, `Video`, `Palette` 16px; logout row `LogOut` 16px. **Cost if wrong:** fixed-size drift from the board, caught by the settings probe's computed-style assertions.
25. **Slider/meter fills are JS-injected custom properties** (`--slider-fill`, `--meter-level` as percentages, set inline from JSX), mirroring M3's `--speak-level` precedent: the track is a `linear-gradient(to right, var(--accent) var(--slider-fill, 0%), var(--track-bg) var(--slider-fill, 0%))`. Native `input[type=range]` keeps browser thumb semantics with `::-webkit-slider-thumb` styling (16px white knob, 2px accent border) — no custom drag code. **Cost if wrong:** a visual-only fill artifact; behavior is the native range input's.
26. **Rebase check, not rebase:** spec §8 wants a rebase on `main` at each milestone boundary; `main` has not moved since branch creation (0 commits ahead at plan time). Task 1 verifies `git log redesign..main` is empty and records it; if it is NOT empty, STOP and surface. **Cost if wrong:** none — it is a check.
27. **Dead-key sweep is Task 10 and grep-gated.** Deleted (ru+en together, `tsc` enforcing parity): `call.screenSharingActive` (M3-orphaned), `chat.deleteConfirm` (already dead at plan time — ChatArea uses `deleteTitle`/`deleteBody`), `server.deleteConfirm`, `channel.deleteConfirm`, `chat.deleteStickerConfirm`, `common.logoutConfirm`, and whichever of the old explore keys (`server.searchPlaceholder`, `server.search`, `server.searching`, `server.noneFound`, `server.orSeparator`, `server.join`, `server.joinByCode.label`, `server.joinByCode.placeholder`, `server.joinByCode.preview`) have zero consumers after Task 5 — **each deletion requires an `rg` proving zero consumers first**; `server.joinByCode.memberCount` is known-kept (decision 2). **Cost if wrong:** a live key deleted = tsc/`t()` failure caught at the gate; a dead key kept = M6 inherits it.

## File structure after M4

```
client/src/
  components/
    FindServerModal.tsx/.css   (new: find-server-* — board 1d merged single field)
    ServerMenu.tsx             (new: shared server context-menu flow, no own CSS)
    CallNotifBanner.tsx/.css   (new: call-notif-* extracted from AppPage)
    ContextMenu.tsx            (rewritten API: icons, label, structural danger group; ContextMenu.css DELETED)
    ConfirmModal.tsx           (hardened: useModalFocus, Cancel autofocus; .css untouched — already clean)
    Settings.tsx/.css          (rewritten: 648px/186px shell, icon nav, pinned danger «Выйти»)
    settings/
      ProfileSettings.tsx/.css (restyled: btn roles, select primitive)
      AudioSettings.tsx        (rewritten: de-emoji'd, de-inlined, toggle/select/slider primitives, mic-test + level meter)
      VideoSettings.tsx        (select primitive)
      AppearanceSettings.tsx   (select primitive)
    EditServerModal.tsx/.css   (restyled: modal shell + btn roles)
    EditChannelModal.tsx       (restyled: btn roles; styled by primitives only)
    CreateChannelModal.tsx     (restyled: btn roles; styled by primitives only)
    ManageInvitesModal.tsx/.css (rewritten: invites-* namespace, lucide icons, expiry via inviteExpiry)
    LinkDialog.tsx/.css        (restyled: modal tokens, btn roles; 5 raw hex die)
    StickerManager.tsx/.css    (restyled: btn roles, ConfirmModal delete, lucide dropzone)
    AvatarCropModal.tsx/.css   (restyled: modal shell, slider primitive for zoom, lucide)
    UpdateBanner.tsx/.css      (restyled: tokens, BEM rename — Electron-only, static verify)
    ErrorBoundary.tsx/.css     (restyled + i18n via new `crash` section)
    ChannelSidebar.tsx         (modified: ServerMenu, ConfirmModal deletes/logout, error toast; .css untouched)
    ServerList.tsx             (modified: ServerMenu, onOpenFindServer; .css: explore rules deleted, .search-empty carried to T8)
    ChatArea.tsx               (modified: «У меня есть код» empty-state button + onFindServer prop)
  hooks/
    useModalFocus.ts           (new: trap + restore + Esc via ref'd onClose)
  styles/
    primitives.css             (rewritten: modal shell/header/close, context menu, toggle/select/slider/level-meter, kbd on --chip-bg; swept to 0 at T8)
    tokens.css                 (modified: + --chip-bg, --track-bg; NO alias changes)
  pages/
    AppPage.tsx                (modified: FindServerModal host, CallNotifBanner, btn-role create-server modal)
    AppPage.css                (modified: call-notif rules deleted only — legacy file, no sweep)
  i18n/locales/ru.ts + en.ts   (new sections/keys per tasks; dead keys deleted in T10)
```

---
### Task 1: Workspace, harness (incl. probe-chat repair), tokens, baselines

**Files:**
- Modify: `client/src/styles/tokens.css` (additions only, before the LEGACY ALIASES block)
- Not in git: milestone workspace + harness copy; `tools/probe-chat.js` repair

**Interfaces:**
- Produces: `--chip-bg`, `--track-bg` tokens (decision 20); a **repaired, throwing** `probe-chat.js` (the cross-surface gate for Tasks 4/5/11); recorded pre-M4 baselines (lint total, per-file counts for every file M4 will touch, test shape, check:i18n warning count = 4, BEFORE screenshots).

- [ ] **Step 1: Preserve the harness**

```bash
mkdir -p .superpowers/sdd/2026-08-25-redesign-m4-modals/tools
cp -R .superpowers/sdd/2026-08-25-redesign-m3-calls/tools/. .superpowers/sdd/2026-08-25-redesign-m4-modals/tools/
```

Known-stale/broken probes (M3 closeout, do not cite as evidence): `probe-callstate.js` inert — banned; `probe-t11-flow.js`'s `toastPresent` permanently false; `probe-servermenu.js` needs `--click .channel-header-menu --after 800`; **`probe-chat.js` cannot fail — repaired next step.**

- [ ] **Step 2: Repair `probe-chat.js` (fail-first for the repair itself)**

The file records `X`/`expectedX` pairs with no `throw`. Add the house helper and route every recorded pair through it, per the reference implementation `probe-screen-picker.js`:

```js
const fail = (m) => { throw new Error(m); };
// for each recorded pair:  if (x !== expectedX) fail(`chat probe: ${name} = ${JSON.stringify(x)}, expected ${JSON.stringify(expectedX)}`);
// for each selector read:  const el = document.querySelector(sel) ?? fail(`chat probe: selector ${sel} not found`);
```

Prove the repair works by breaking it: run once with one expectation deliberately inverted → must throw; revert the inversion; run clean against HEAD → passes. Record both runs. (Without this counterfactual the repair is as unverified as the original.)

- [ ] **Step 3: Verify branch state + main drift (decision 26)**

```bash
git rev-parse --abbrev-ref HEAD        # must be: redesign
git log --oneline redesign..main       # must be empty; if NOT empty, STOP and surface
```

- [ ] **Step 4: Add the two tokens to `tokens.css`**

In the `/* ── Lines & surfaces ── */` group of `:root`, after `--white`:

```css
  --chip-bg:  #F2F4F9; /* board 1d: modal close button, kbd chip */
  --track-bg: #E9ECF5; /* board 1d: slider / level-meter track */
```

In the `[data-theme="dark"]` block, after `--row-hover`:

```css
  --chip-bg:  rgb(255 255 255 / 8%);  /* refine in M6 */
  --track-bg: rgb(255 255 255 / 12%); /* refine in M6 */
```

Modern notation on purpose (M3 Task-1 precedent: legacy `rgba()` commas trip three lint rules each). No `[data-theme]` alias changes; do not touch the LEGACY ALIASES block.

- [ ] **Step 5: Record baselines (all from `client/`)**

```bash
cd client && npm run lint:css 2>&1 | tail -3     # record exact total (expected 271)
npx stylelint src/styles/tokens.css 2>&1 | tail -2   # run BEFORE and AFTER the edit — must not gain
for f in src/styles/primitives.css src/components/ContextMenu.css src/components/Settings.css \
  src/components/settings/ProfileSettings.css src/components/EditServerModal.css \
  src/components/ManageInvitesModal.css src/components/LinkDialog.css src/components/StickerManager.css \
  src/components/AvatarCropModal.css src/components/UpdateBanner.css src/components/ErrorBoundary.css \
  src/components/ServerList.css src/components/ChannelSidebar.css src/pages/AppPage.css; do
  echo "== $f: $(npx stylelint "$f" 2>&1 | rg -o '[0-9]+ problems?' | head -1)"; done
# planning-time reference: primitives 21 · ContextMenu 3 · Settings 10 · ProfileSettings 2 · EditServerModal 3
#   · ManageInvites 7 · LinkDialog 10 · StickerManager 0 · AvatarCrop 8 · UpdateBanner 3 · ErrorBoundary 3
#   · ServerList 16 · ChannelSidebar 23 · AppPage 7
npx tsc --noEmit && npm test                     # RED shape: 3 failures + 2 rejections, api.network-retry only
npm run check:i18n                               # exit 0, exactly 4 ErrorBoundary warnings — record
```

- [ ] **Step 6: BEFORE screenshots** (dev server fresh, port 3000; evidence anchor for fail-first probes)

```bash
node tools/smoke.mjs --out m4t1-before-settings.png --probe tools/probe-open-settings.js
# probe-open-settings.js (write now, reusable): clicks the first button inside '.user-actions',
#   waits 400ms, asserts '.settings-modal' exists (throws otherwise) — on HEAD it exists (old styling).
node tools/smoke.mjs --click .server-icon.search --after 800 --out m4t1-before-explore.png
node tools/smoke.mjs --click .channel-header-menu --after 800 --out m4t1-before-servermenu.png
node tools/smoke.mjs --theme dark --out m4t1-before-settings-dark.png --probe tools/probe-open-settings.js
```

- [ ] **Step 7: Commit**

```bash
git add client/src/styles/tokens.css
git commit -m "feat(redesign): chip/track surface tokens for board 1d modal chrome"
```

---

### Task 2: primitives.css rewrite — modal shell, form primitives, rename ripple

The layer task. After it, `primitives.css` is clean except the single marked legacy block (decision 5), and every keyframe/modifier rename consumer is updated in this same commit (decisions 6–7).

**Files:**
- **Rewrite:** `client/src/styles/primitives.css`
- Modify (reference updates only, one line each unless noted): `client/src/components/ConfirmModal.css` (`modalIn`→`modal-in`), `client/src/components/CallUI.css` (`modalIn`→`modal-in`), `client/src/components/Settings.css` (`fadeIn`/`scaleIn` refs), `client/src/components/ContextMenu.css` (`scaleIn` ref), `client/src/components/AvatarCropModal.css` (`fadeIn`/`scaleIn` refs), `client/src/components/ChannelSidebar.tsx` (`online`→`is-online`, `danger`→`is-danger`), `client/src/components/UserList.tsx` (`online`→`is-online`), `client/src/components/CallDock.tsx` (`danger`→`is-danger`)

**Interfaces:**
- Consumes: `--chip-bg`, `--track-bg` (Task 1), `--scrim` (M3 token — replaces `.modal-overlay`'s raw `rgba(16, 19, 34, 0.5)`).
- Produces (later tasks rely on these exact names):
  - Kept as-is: `.btn` + `btn-primary/secondary/ghost/danger-soft/danger`, `.input`, `.panel-icon-btn` (+ `is-off`, **`is-danger`**), `.user-avatar-wrap` (+ **`is-online`**), `.modal-overlay`, `.modal`, `.modal-actions`, `.modal-error`, `.modal .form-group` family, `.error-toast` + `slide-down`.
  - New: `.modal-header`, `.modal-title`, `.modal-sub`, `.modal-close-btn` (30×30, r9, `--chip-bg`, lucide `X` 16); `.context-menu`, `.context-menu-label`, `.context-menu-item` (+ `is-danger`), `.context-menu-separator`; `.toggle-switch`, `.toggle-track` (44×26, r13); `.select-wrap`, `.select-control`, `.select-chevron` (36px, r9); `.slider-input` (150×6, accent fill via `--slider-fill`); `.level-meter`, `.level-meter-fill` (via `--meter-level`), `.level-meter-caption`.
  - Keyframes: `fade-in`, `scale-in`, `modal-in` (renamed), `slide-down` (kept).

- [ ] **Step 1: Fail-first probe** `tools/probe-primitives.js` (async): asserts, on a mounted modal (open the create-server modal: click the rail `+` tile — `.server-icon.add`), that `.modal-overlay`'s computed `background-color` is `rgba(16, 19, 34, 0.5)` **via `var(--scrim)`** — assert by *setting* `document.documentElement.style.setProperty('--scrim', 'rgb(255 0 0 / 50%)')` and re-reading: post-task the overlay turns red (token-driven), pre-task it stays put (raw literal) → **pre-task loud failure**. Also asserts `getComputedStyle` finds `animation-name: modal-in` on `.modal` (pre-task: `modalIn` → fails). Run against HEAD, record the failure.

- [ ] **Step 2: Rewrite `primitives.css`.** Keep every existing recipe's *values* (they are already board-correct from M0/M2) while fixing notation and structure. The complete change inventory — everything else is carried byte-equivalent:

  1. `.btn-primary`, `.btn-danger-soft:hover`, `.btn-danger` — `#FFFFFF` → `var(--white)` (3 sites).
  2. `.modal-overlay` — `background: rgba(16, 19, 34, 0.5)` → `background: var(--scrim)`; `animation: fadeIn` → `fade-in`.
  3. Keyframes renamed: `fadeIn`→`fade-in`, `scaleIn`→`scale-in`, `modalIn`→`modal-in` (3 internal refs: `.modal`, radio `::after`, overlay). Update the stale comment above them — it names CallUI.css as a consumer of `scaleIn`, which M3 made false; the new comment lists the real consumers (`Settings.css`, `ContextMenu.css`, `AvatarCropModal.css`, `ConfirmModal.css`, `CallUI.css` for `modal-in`) and will shrink as tasks rewrite them.
  4. `.user-avatar-wrap.online::after` → `.user-avatar-wrap.is-online::after`; `.panel-icon-btn.danger:hover` → `.panel-icon-btn.is-danger:hover`.
  5. `.kbd` — `background: var(--canvas-2)` → `var(--chip-bg)` (decision 20).
  6. Radio/checkbox blocks: drop `-webkit-appearance: none` (the `appearance` longhand suffices in every shipping target; the vendor prefix is 2 of the 21 violations); `transition: all var(--transition)` stays (not a violation). The checkbox check data-URI stays (decision 21).
  7. New blocks appended (modal header pattern · context menu · form primitives):

```css
/* ── Modal header pattern (board 1d): title block + 30×30 close chip ── */
.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.modal-title {
  font-size: 19px;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.modal-sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--muted);
}

.modal-close-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: var(--radius-row);
  background: var(--chip-bg);
  color: var(--muted);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.modal-close-btn:hover {
  background: var(--line);
  color: var(--ink);
}

/* ── Context menu (board 1d): r14, menu shadow, caps label, separated danger last ── */
.context-menu {
  position: fixed;
  z-index: 1050;
  min-width: 236px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow-menu);
  animation: scale-in 0.12s var(--ease-out);
}

.context-menu-label {
  padding: 6px 10px 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  transition: background var(--transition);
}

/* :disabled BEFORE the :hover rule: its key selector strips to (0,2,0) vs the
   hover's (0,3,0) — the other order trips no-descending-specificity (measured
   under the real config by the plan review, finding I1). */
.context-menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.context-menu-item:hover:not(:disabled) {
  background: var(--canvas-2);
}

.context-menu-item.is-danger {
  color: var(--danger);
}

.context-menu-item.is-danger:hover:not(:disabled) {
  background: var(--danger-soft);
}

.context-menu-separator {
  height: 1px;
  margin: 4px 8px;
  background: var(--line);
}

/* ── Toggle (board: 44×26 r13, on accent / off line-strong, 20px knob, 160ms) ── */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 26px;
  flex-shrink: 0;
}

.toggle-switch input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
}

.toggle-track {
  position: absolute;
  inset: 0;
  border-radius: 13px;
  background: var(--line-strong);
  transition: background 0.16s var(--ease-out);
  pointer-events: none;
}

.toggle-track::before {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--white);
  box-shadow: var(--shadow-row);
  transition: transform 0.16s var(--ease-out);
}

.toggle-switch input:checked + .toggle-track {
  background: var(--accent);
}

.toggle-switch input:checked + .toggle-track::before {
  transform: translateX(18px);
}

.toggle-switch input:disabled + .toggle-track {
  opacity: 0.35;
}

.toggle-switch input:focus-visible + .toggle-track {
  box-shadow: var(--focus-ring);
}

/* ── Select (board: 36px, r9, line-strong outline, chevron 14px in JSX) ── */
.select-wrap {
  position: relative;
  display: inline-flex;
}

.select-control {
  height: 36px;
  min-width: 180px;
  padding: 0 32px 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-row);
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  appearance: none;
  transition: border-color var(--transition), box-shadow var(--transition);
}

.select-control:hover {
  border-color: var(--muted-2);
}

.select-control:focus-visible {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.select-chevron {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  display: flex;
  color: var(--muted-2);
  pointer-events: none;
}

/* ── Slider (board: 150×6 r3 track, accent fill, 16px white knob w/ 2px accent border).
   --slider-fill is JS-injected (invisible to importFrom) — fallback required. ── */
.slider-input {
  width: 150px;
  height: 16px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.slider-input::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--accent) var(--slider-fill, 0%), var(--track-bg) var(--slider-fill, 0%));
}

.slider-input::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--white);
  border: 2px solid var(--accent);
  box-shadow: var(--shadow-row);
}

.slider-input:focus-visible {
  outline: none;
}

.slider-input:focus-visible::-webkit-slider-thumb {
  box-shadow: var(--focus-ring);
}

/* ── Level meter (board: 6px r3 track, online fill, caption 11.5/600 muted-2).
   --meter-level is JS-injected — fallback required. ── */
.level-meter {
  width: 150px;
  height: 6px;
  border-radius: 3px;
  background: var(--track-bg);
  overflow: hidden;
}

.level-meter-fill {
  width: var(--meter-level, 0%);
  height: 100%;
  border-radius: 3px;
  background: var(--online);
  transition: width 0.08s linear;
}

.level-meter-caption {
  margin-top: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted-2);
}
```

  8. The `.modal-actions` block (all three rules: `.modal-actions button`, `:not(.primary):hover`, `button.primary` + its hover) moves to the **bottom** of the file under `/* ═══ LEGACY (carried until T8 of the M4 plan): hand-rolled .modal-actions button recipe — emitters convert to .btn roles in T3/T5/T8 ═══ */`. Enumerate its violations in the ledger (expected: the bare `.primary` selector-class-pattern hits), **and note the block also carries a raw `#FFFFFF` inside `.modal-actions button.primary`** — a 4th raw white beyond the three Step 2 converts, legal only because the block dies in T8; listing it now is what makes T8's zero-rows raw-value gate planned rather than lucky (grand-review M4).

  Firefox note: `::-moz-range-track`/`::-moz-range-thumb` twins are deliberately **omitted** — Electron 41 + Chrome are the shipping targets, the app has no other `-moz-` styling, and stylelint's `no-duplicate-selectors` stays quieter; record as adapted.

- [ ] **Step 3: Update every rename consumer (same commit, decisions 6–7)** — `ConfirmModal.css:9` `modalIn`→`modal-in`; `CallUI.css` `.p2p-modal` `modalIn`→`modal-in`; `Settings.css:11` `fadeIn`→`fade-in`, `:24` `scaleIn`→`scale-in`; `ContextMenu.css:13` `scaleIn`→`scale-in`; `AvatarCropModal.css` both refs; `ChannelSidebar.tsx:266` `"user-avatar-wrap online"`→`"user-avatar-wrap is-online"`, `:287` `"panel-icon-btn danger"`→`"panel-icon-btn is-danger"`; `UserList.tsx:123` template `' online'`→`' is-online'`; `CallDock.tsx:56` `"panel-icon-btn danger"`→`"panel-icon-btn is-danger"`. Then verify nothing else referenced the old names:

```bash
cd client && rg -n 'fadeIn|scaleIn|modalIn' src/       # zero rows
rg -n --pcre2 '(?<![a-zA-Z-])(online|danger)(?![a-zA-Z-])' src/styles/primitives.css   # zero rows (only is-* forms remain)
```

- [ ] **Step 4: Gates**

```bash
cd client && npx stylelint src/styles/primitives.css 2>&1 | tail -3
# expected: ONLY the enumerated legacy-block violations (record the exact list); zero above the marker
npx stylelint src/components/ConfirmModal.css src/components/CallUI.css 2>&1 | tail -2   # both still 0
npm run lint:css 2>&1 | tail -3     # total ≤ recorded T1 number (renames fix violations, must not add)
npx tsc --noEmit && npm test        # delta-clean
```

- [ ] **Step 5: Probe + visual spot-check** — `node tools/smoke.mjs --click .server-icon.add --after 600 --probe tools/probe-primitives.js` → passes. Screenshot the create-server modal light/dark (`m4t2-modal-light.png`, `--theme dark m4t2-modal-dark.png`) — buttons/inputs unchanged visually, overlay identical (scrim value byte-equal). Sidebar footer + CallDock: presence dot and danger hover still render (`is-*` renames took) — screenshot `m4t2-footer.png`.

- [ ] **Step 6: Commit**

```bash
git add client/src/styles/primitives.css client/src/components/ConfirmModal.css client/src/components/CallUI.css client/src/components/Settings.css client/src/components/ContextMenu.css client/src/components/AvatarCropModal.css client/src/components/ChannelSidebar.tsx client/src/components/UserList.tsx client/src/components/CallDock.tsx
git commit -m "feat(redesign): primitives layer rebuilt — modal header pattern, context-menu recipe, toggle/select/slider/level-meter; kebab keyframes + is-* modifiers with all consumers"
```

---

### Task 3: useModalFocus + ConfirmModal hardening + logout confirms

**Files:**
- Create: `client/src/hooks/useModalFocus.ts`
- Modify: `client/src/components/ConfirmModal.tsx`, `client/src/components/ChannelSidebar.tsx`, `client/src/components/Settings.tsx` *(hook adoption only — the visual rewrite is Task 6)*, `client/src/i18n/locales/ru.ts` + `en.ts`

**Interfaces:**
- Consumes: `.btn` roles, `.confirm-modal` CSS (already board-correct from M2 — no CSS change).
- Produces:
  - `hooks/useModalFocus.ts`: `export function useModalFocus(active: boolean, containerRef: React.RefObject<HTMLElement | null>, onClose?: () => void): void` — behavior per decision 8. Focusable query: `'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'` filtered by `!el.disabled`.
  - `ConfirmModal`: same props; Cancel carries `data-autofocus`; the local Esc effect is deleted (the hook owns Esc).
  - i18n: `common.logoutTitle: 'Выйти из аккаунта?' / 'Log out?'`, `common.logoutBody: 'Вы сможете снова войти в любой момент.' / 'You can sign back in at any time.'`.

- [ ] **Step 1: Fail-first probe** `tools/probe-confirm-focus.js` (async). Drive ChatArea's existing message-delete confirm (M2 T5 pattern — the hover popover is CSS-hidden, so dispatch from the probe): first `document.querySelector('.composer-input').focus()` (so restore has a real target to return to — clicking via `el.click()` leaves `activeElement` at `body`, making a restore assertion vacuous otherwise), then find an own `.msg-row`, `el.querySelector('.msg-action-btn.is-danger')` after forcing `.msg-actions` visible via inline style, click it; then assert **all four**, throwing on each miss: (a) `document.activeElement.classList.contains('btn-secondary')` — Cancel focused; (b) from Cancel dispatch **Shift+Tab** → assert focus wrapped to the danger button, then dispatch **Tab** → assert focus wrapped back to Cancel (grand-review I2: with exactly two focusables, only boundary wraps are hook-driven — a plain forward Tab from the first element is mid-container and the hook correctly does nothing, so asserting it would fail post-task); (c) dispatch Escape → `.confirm-modal` gone; (d) `document.activeElement` is `.composer-input` again (restore to the pre-open focus). Pre-task run at HEAD: (a) fails loudly — the danger button holds focus (`ConfirmModal.tsx:37`). Record it. *(Note: synthetic Tab `KeyboardEvent`s do not move focus natively — the **hook** moves it in its keydown handler, which is exactly what (b) measures. Pre-task, no handler exists → focus does not move → loud fail.)*

- [ ] **Step 2: Write the hook**

```ts
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Стек активных модалок: Escape/Tab обрабатывает только верхняя. Вложенные
// модалки реальны (Settings → ConfirmModal выхода) — без стека один Escape
// закрыл бы обе, потому что слушатель нижней зарегистрирован раньше.
const modalStack: symbol[] = [];

/** Modal focus contract (board 1d + M2 deferred findings): trap Tab inside the
 * container, focus [data-autofocus] on open, close on Escape (top-most modal
 * only), restore focus on close. onClose lives in a ref so the listener binds
 * once per open — parent re-renders must not re-subscribe (the M2 ConfirmModal
 * finding). */
export function useModalFocus(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose?: () => void,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const token = Symbol('modal');
    modalStack.push(token);
    const prev = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const focusables = () =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => !el.hasAttribute('disabled'),
      );
    const initial =
      container?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
    initial?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return; // not the top modal
      if (e.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !container?.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !container?.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(token), 1);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [active, containerRef]);
}
```

- [ ] **Step 3: Harden `ConfirmModal.tsx`** — delete the local Esc `useEffect` (lines 17–24) and the `useEffect` import if now unused; add `const ref = useRef<HTMLDivElement>(null);` + `useModalFocus(open, ref, onCancel);`; put `ref` on the `.confirm-modal` div; move autofocus: Cancel button gains `data-autofocus`, the danger button **loses `autoFocus`** (decision 9).

- [ ] **Step 4: Swap the logout confirms** — add the two i18n keys (ru+en). In `ChannelSidebar.tsx`: delete the hand-rolled `confirmLogout` modal JSX (lines 298–310) and render instead:

```tsx
<ConfirmModal
  open={confirmLogout}
  title={t('common.logoutTitle')}
  body={t('common.logoutBody')}
  confirmLabel={t('common.logout')}
  onConfirm={onLogout}
  onCancel={() => setConfirmLogout(false)}
/>
```

(`import { ConfirmModal } from '@/components/ConfirmModal';`.) The `.modal-actions button.primary` emitter at `ChannelSidebar.tsx:304` dies with the JSX. In `Settings.tsx`: only `useModalFocus` adoption this task — `const modalRef = useRef<HTMLDivElement>(null);` + `useModalFocus(isOpen, modalRef, onClose);` + ref on `.settings-modal` (Settings has no Esc handling today; this adds it).

- [ ] **Step 5: Gates + probes**

```bash
cd client && npx tsc --noEmit && npm test && npm run check:i18n && npm run lint:css 2>&1 | tail -3
node tools/smoke.mjs --probe tools/probe-confirm-focus.js          # all four assertions pass
node tools/smoke.mjs --probe tools/probe-logout-confirm.js --out m4t3-logout.png
# probe-logout-confirm.js (write now, fail-first): click '.panel-icon-btn.is-danger' in '.user-actions',
#   assert '.confirm-modal' exists with title text = ru logoutTitle, confirm button text 'Выйти',
#   activeElement is Cancel; Escape closes. Pre-task: the old '.modal' with common.logoutConfirm renders
#   and '.confirm-modal' is absent → loud fail.
```

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useModalFocus.ts client/src/components/ConfirmModal.tsx client/src/components/ChannelSidebar.tsx client/src/components/Settings.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): useModalFocus (trap/restore/esc) — ConfirmModal focuses Cancel; logout confirms unified on ConfirmModal"
```

---

### Task 4: ContextMenu rebuild + ServerMenu dedupe + confirm/alert sweep

**Files:**
- Create: `client/src/components/ServerMenu.tsx`
- Rewrite: `client/src/components/ContextMenu.tsx`; **Delete:** `client/src/components/ContextMenu.css`
- Modify: `client/src/styles/primitives.css` *(no change expected — the recipe landed in T2; re-run its lint gate anyway)*, `client/src/components/ChannelSidebar.tsx`, `client/src/components/ServerList.tsx`, `client/src/i18n/locales/ru.ts` + `en.ts`

**Interfaces:**
- Consumes: `.context-menu*` recipe (T2), `ConfirmModal` (T3), `.error-toast`.
- Produces:
  - `ContextMenu` props: `{ x: number; y: number; items: ContextMenuItem[]; label?: string; onClose: () => void }`; `ContextMenuItem` gains `icon?: ReactNode`. Rendering order is structural (decision 13): label → non-danger items → (separator + danger items) if any. Position clamp, outside-mousedown/Escape/scroll/resize close, and portal are kept from the current implementation.
  - `ServerMenu` props per decision 14. Internally: `ContextMenu` with `label={server.name}`, items `[Пригласить (UserPlus 16, if canInvite), Настройки сервера (Settings 16, if canManage), Удалить сервер (Trash2 16, danger, if owner)]` (existing keys `server.inviteMenu`/`server.editMenu`/`server.deleteMenu`); `EditServerModal`/`ManageInvitesModal` renders; delete `ConfirmModal` (`server.deleteTitle`/`deleteBody`, decision 16); `.error-toast` on a failed delete (decision 15).
  - i18n added: `server.deleteTitle`, `server.deleteBody`, `channel.deleteTitle`, `channel.deleteBody` (ru+en, decision 16). i18n **value change** (grand-review M3, ruled board-wins per the M3 `youSuffix` precedent): `server.editMenu` `'Редактировать'` → `'Настройки сервера'` (en `'Edit'` → `'Server settings'`) — board 1d names the row «Настройки сервера»; the probe asserts the row's text, not just its icon.

- [ ] **Step 1: Fail-first probe** `tools/probe-server-menu.js` (async). First line poisons natives: `window.confirm = () => { throw new Error('window.confirm called'); }; window.alert = (m) => { throw new Error('alert called: ' + m); };`. Then (with `--click .channel-header-menu --after 800` doing the open): assert `.context-menu` computed `border-radius: 14px`, `box-shadow` non-none, `.context-menu-label` text equals the smoke server's name («Redesign Smoke» — read it from `.channel-header h2`, don't hardcode), each row contains an `svg`, the manage row's text is «Настройки сервера» (the T4 value change — pre-task «Редактировать» → loud fail), `.context-menu-separator` exists and sits **before** the `.is-danger` row (compare `offsetTop`), danger row is last. Then click the danger row → assert `.confirm-modal` appears (title contains the server name), **Escape closes it without deleting** (assert the server row still exists in the rail afterwards). Pre-task at HEAD: label/separator/icons absent → loud fail on the first assertion; and clicking delete pre-task hits the poisoned `window.confirm` → loud fail either way. Record it.

- [ ] **Step 2: Rewrite `ContextMenu.tsx`**

```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  label?: string;
  onClose: () => void;
}

/* Board 1d: caps label, icon rows, destructive last and separated — the split
   below enforces the separation structurally, callers cannot bypass it. */
export function ContextMenu({ x, y, items, label, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // ...the existing outside-mousedown/keydown/scroll/resize effect, verbatim...
  const plain = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const clampedX = Math.min(x, window.innerWidth - 244);
  const clampedY = Math.min(y, window.innerHeight - items.length * 38 - (label ? 26 : 0) - 20);

  const renderItem = (item: ContextMenuItem) => (
    <button
      key={item.label}
      type="button"
      className={`context-menu-item${item.danger ? ' is-danger' : ''}`}
      disabled={item.disabled}
      title={item.disabled ? item.disabledReason : undefined}
      onClick={() => { if (item.disabled) return; item.onClick(); onClose(); }}
    >
      {item.icon}
      {item.label}
    </button>
  );

  return createPortal(
    <div ref={ref} className="context-menu" style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }} onClick={(e) => e.stopPropagation()}>
      {label && <div className="context-menu-label">{label}</div>}
      {plain.map(renderItem)}
      {danger.length > 0 && <div className="context-menu-separator" />}
      {danger.map(renderItem)}
    </div>,
    document.body
  );
}
```

Delete `import './ContextMenu.css'` and the file itself (its recipe lives in primitives since T2 — source order favors nothing; the component file is gone so no tie exists).

- [ ] **Step 3: Write `ServerMenu.tsx`** — lift ChannelSidebar's flow (the more complete copy) into the shared component:

```tsx
import { useEffect, useState } from 'react';
import { UserPlus, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import type { Server, User } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { ContextMenu } from '@/components/ContextMenu';
import { ConfirmModal } from '@/components/ConfirmModal';
import { EditServerModal } from '@/components/EditServerModal';
import { ManageInvitesModal } from '@/components/ManageInvitesModal';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';

interface ServerMenuProps {
  server: Server;
  user: User | null;
  anchor: { x: number; y: number };
  onClose: () => void;
  onDeleted: (serverId: string) => void;
}

export function ServerMenu({ server, user, anchor, onClose, onDeleted }: ServerMenuProps) {
  const t = useT();
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perms = useServerStore.getState().permissions.get(server.id);
  const isOwner = server.owner_id === user?.id;
  const canManage = can(perms, PERMISSIONS.MANAGE_SERVER) || isOwner;
  const canInvite = can(perms, PERMISSIONS.CREATE_INVITE);

  // ContextMenu вызывает свой onClose и после выбора пункта, и при dismiss.
  // Родительский onClose размонтирует ServerMenu целиком — звать его можно
  // только когда поток действительно закончен, иначе под-модалка не откроется.
  const flowOpen = editing || inviting || confirmingDelete || error !== null;
  useEffect(() => {
    if (menuDismissed && !flowOpen) onClose();
  }, [menuDismissed, flowOpen, onClose]);

  const handleDelete = async () => {
    try {
      await apiService.deleteServer(server.id);
      useServerStore.getState().removeServer(server.id);
      onDeleted(server.id);
      setConfirmingDelete(false);
      onClose();
    } catch (err) {
      setConfirmingDelete(false);
      setError(apiErrorText(err, t));
      setTimeout(() => setError(null), 5000); // error !== null держит компонент смонтированным до dismiss тоста
    }
  };

  return (
    <>
      {!menuDismissed && (
        <ContextMenu
          x={anchor.x}
          y={anchor.y}
          label={server.name}
          onClose={() => setMenuDismissed(true)}
          items={[
            ...(canInvite ? [{ label: t('server.inviteMenu'), icon: <UserPlus size={16} strokeWidth={1.8} />, onClick: () => setInviting(true) }] : []),
            ...(canManage ? [{ label: t('server.editMenu'), icon: <SettingsIcon size={16} strokeWidth={1.8} />, onClick: () => setEditing(true) }] : []),
            // Удаление сервера — привилегия владения и на бэкенде (DeleteServer
            // проверяет только owner_id), роль с MANAGE_SERVER снести сервер не может.
            ...(isOwner ? [{ label: t('server.deleteMenu'), icon: <Trash2 size={16} strokeWidth={1.8} />, danger: true, onClick: () => setConfirmingDelete(true) }] : []),
          ]}
        />
      )}
      {editing && <EditServerModal server={server} onClose={() => { setEditing(false); onClose(); }} />}
      {inviting && <ManageInvitesModal serverId={server.id} onClose={() => { setInviting(false); onClose(); }} />}
      <ConfirmModal
        open={confirmingDelete}
        title={t('server.deleteTitle', { name: server.name })}
        body={t('server.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={handleDelete}
        onCancel={() => { setConfirmingDelete(false); onClose(); }}
      />
      {error && <div className="error-toast">{error}</div>}
    </>
  );
}
```

**Behavioral subtlety the implementer must keep:** ContextMenu runs `item.onClick(); onClose();` — so selecting an item both opens the sub-state *and* dismisses the menu. The `menuDismissed`/`flowOpen` pair above is what keeps ServerMenu mounted through that: the parent's `onClose` (which clears the anchor state and unmounts ServerMenu) fires only from the effect when the menu is dismissed **and** no sub-modal/toast is open, or explicitly from a sub-modal's own close. Escape/outside-click with nothing open → effect unmounts immediately, preserving today's dismiss feel. Both call sites wire it identically.

- [ ] **Step 4: Swap both call sites** — `ChannelSidebar.tsx`: delete `handleDeleteServer`, the `serverMenu` ContextMenu JSX (lines 346–357), the `editingServer`/`invitingServer` state + renders (358–359); render `{serverMenu && server && (<ServerMenu server={server} user={user} anchor={serverMenu} onClose={() => setServerMenu(null)} onDeleted={onServerDeleted} />)}`. **Channel** menu items gain icons (`Pencil` 16 / `Trash2` 16) and `handleDeleteChannel` swaps `window.confirm` for a `confirmDeleteChannel: Channel | null` state + `ConfirmModal` (`channel.deleteTitle`/`deleteBody`), `alert` for the toast state (decision 15) — the `channels.length <= 1` guard stays. `ServerList.tsx`: delete `handleDeleteServer`, the menu JSX (238–262), `editingServerId`/`invitingServerId` state + renders; render `ServerMenu` from the `menu` state. Remove now-unused imports in both files.

- [ ] **Step 5: Gates + probes**

```bash
cd client && rg -n 'window\.confirm|alert\(' src/components/ChannelSidebar.tsx src/components/ServerList.tsx   # zero rows
npx tsc --noEmit && npm test && npm run check:i18n && npm run lint:css 2>&1 | tail -3   # total dropped (ContextMenu.css deleted)
node tools/smoke.mjs --click .channel-header-menu --after 800 --probe tools/probe-server-menu.js
node tools/smoke.mjs --click .channel-header-menu --after 800 --theme dark --out m4t4-servermenu-dark.png
node tools/smoke.mjs --probe tools/probe-channel-menu.js
# probe-channel-menu.js (write now, fail-first): poison confirm/alert; dispatch a contextmenu MouseEvent on a
#   '.channel' row; assert menu label = channel name, Pencil+Trash2 icons, separator, danger last, disabled state
#   when only one channel exists (assert the precondition: count '.channel' rows first, don't assume);
#   click delete on a NON-current channel of «Redesign Smoke» ONLY if ≥2 channels — assert ConfirmModal, then Cancel.
node tools/smoke.mjs --probe tools/probe-chat.js   # repaired cross-surface gate — chat column untouched by the sweep
```

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ContextMenu.tsx client/src/components/ServerMenu.tsx client/src/components/ChannelSidebar.tsx client/src/components/ServerList.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git rm client/src/components/ContextMenu.css
git commit -m "feat(redesign): board-1d context menus (label, icons, separated danger) + shared ServerMenu; server/channel deletes on ConfirmModal, alerts on error-toast"
```

---
### Task 5: FindServerModal — the merged one-field board-1d modal

**Files:**
- Create: `client/src/components/FindServerModal.tsx`, `client/src/components/FindServerModal.css`
- Modify: `client/src/pages/AppPage.tsx` (host + open state), `client/src/components/ServerList.tsx` (explore modal deleted; `onOpenFindServer` prop), `client/src/components/ServerList.css` (explore rules deleted; `.search-empty` carried — decision 22), `client/src/components/ChatArea.tsx` (empty-state secondary button + `onFindServer` prop), `client/src/i18n/locales/ru.ts` + `en.ts`

**Interfaces:**
- Consumes: `apiService.searchServers(q)` / `previewInvite(code)` / `joinViaInvite(code)` (unchanged signatures), AppPage's existing `handleJoinServer(server)` / `handleServerJoined(server)` / `setShowCreateServer`, `.modal-overlay`/`.modal-header`/`.modal-close-btn`/`.input`/`.btn` primitives, `useModalFocus`, `Avatar`.
- Produces:
  - `FindServerModal` props: `{ open: boolean; onClose: () => void; onJoinServer: (server: Server) => void; onServerJoined: (server: Server) => void; onCreateServer: () => void }`.
  - `ServerList` prop change: **remove** `onJoinServer`/`onServerJoined` (they move to the modal's host), **add** `onOpenFindServer: () => void`; the rail search tile calls it.
  - `ChatArea` prop: `onFindServer?: () => void`; the no-servers card renders a second, outline button.
  - Classes: `find-server-modal, find-server-results-label, find-server-list, find-server-row (+ is-invite), find-server-avatar, find-server-name, find-server-meta, find-server-empty, find-server-footer, find-server-footer-text`.
  - i18n added under `server.findServer`: `title: 'Найти сервер' / 'Find a server'`, `description: 'Введите название сервера или код приглашения' / 'Enter a server name or an invite code'`, `placeholder: 'Название или код…' / 'Name or code…'`, `results: 'Результаты' / 'Results'` (caps via CSS), `joinAction: 'Войти' / 'Join'`, `byInvite: 'По коду приглашения' / 'By invite code'`, `noResults: 'Ничего не найдено по запросу «{{query}}»' / 'Nothing found for “{{query}}”'`, `footerQuestion: 'Нет нужного сервера?' / 'Can\'t find your server?'`, `createOwn: 'Создать свой' / 'Create your own'`; plus `chat.haveCode: 'У меня есть код' / 'I have a code'`.

- [ ] **Step 1: Fail-first probe** `tools/probe-find-server.js` (async):
  1. `--click` path: open via the rail tile. **Pre-task** the click renders the OLD `.explore-server-modal` — the probe asserts `.find-server-modal` exists → loud fail. Post-task: assert computed width 452px, r16, `--shadow-modal`; the input is focused (`document.activeElement`) and 44px tall with the focus ring (`box-shadow` contains the ring).
  2. Type `Redesign` into the input (native setter + `input` event — the M2 `--type-into` pattern), wait 600ms (debounce + fetch): «Redesign Smoke» is **private** on the smoke account? **Assert the precondition first**: fetch `/api/v1/servers/search?q=Redesign&limit=20` in-page with the stored auth token and record whether it returns rows; assert the modal's rendered row count equals the API's row count (0 rows → the `find-server-empty` branch with the query echoed; ≥1 → rows with «Войти» buttons and **no** meta line). Either branch is a real assertion; neither hardcodes the smoke server's privacy.
  3. Invite path: in-page, `POST /api/v1/servers/<smoke-server-id>/invites` (owner account — authorized; record the code as smoke-server residue), type the code, wait 600ms → assert the `is-invite` row renders with `byInvite` label text and «участников: N» matching the preview response, and a «Войти» button.
  4. Escape closes. (No focus-restore assertion here: the rail search tile is a **div**, not focusable — `document.activeElement` before open is `body`, so "restore" is vacuous on this trigger. The restore behavior is asserted by `probe-confirm-focus.js` where the trigger is a real button; record the asymmetry.)
  Run against pre-task HEAD → loud failure at 1. Record.

- [ ] **Step 2: `FindServerModal.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import type { Server, InvitePreview } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import { useModalFocus } from '@/hooks/useModalFocus';
import { useT } from '@/i18n';
import './FindServerModal.css';

interface FindServerModalProps {
  open: boolean;
  onClose: () => void;
  onJoinServer: (server: Server) => void;
  onServerJoined: (server: Server) => void;
  onCreateServer: () => void;
}

export function FindServerModal({ open, onClose, onJoinServer, onServerJoined, onCreateServer }: FindServerModalProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Server[]>([]);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(open, ref, onClose);

  useEffect(() => {
    if (!open) { setQuery(''); setResults([]); setPreview(null); setSearched(false); }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !q) { setResults([]); setPreview(null); setSearched(false); return; }
    const timer = setTimeout(() => {
      // Одно поле — оба запроса параллельно (spec §2 «merged into one field»).
      // previewInvite на произвольной строке отвечает 404 — это ожидаемо и глотается.
      void Promise.allSettled([apiService.searchServers(q), apiService.previewInvite(q)]).then(
        ([search, invite]) => {
          setResults(search.status === 'fulfilled' ? (search.value as Server[]) : []);
          setPreview(invite.status === 'fulfilled' ? invite.value : null);
          setSearched(true);
        },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [open, query]);

  const handleJoinByInvite = async () => {
    if (!preview) return;
    setBusy(true);
    setJoinError(null);
    try {
      const server = await apiService.joinViaInvite(query.trim());
      onServerJoined(server);
      onClose();
    } catch (err) {
      setJoinError(apiErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const hasRows = preview !== null || results.length > 0;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={ref} className="modal find-server-modal" role="dialog" aria-modal="true" aria-label={t('server.findServer.title')} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{t('server.findServer.title')}</div>
            <p className="modal-sub">{t('server.findServer.description')}</p>
          </div>
          <button type="button" className="modal-close-btn" aria-label={t('common.close')} onClick={onClose}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <input
          className="input"
          data-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('server.findServer.placeholder')}
        />
        {hasRows && <div className="find-server-results-label">{t('server.findServer.results')}</div>}
        {hasRows && (
          <div className="find-server-list">
            {preview && (
              <div className="find-server-row is-invite">
                <Avatar username={preview.server_name} url={preview.icon_url} className="find-server-avatar" />
                <div>
                  <div className="find-server-name">{preview.server_name}</div>
                  <div className="find-server-meta">
                    {t('server.findServer.byInvite')} · {t('server.joinByCode.memberCount', { count: String(preview.member_count) })}
                  </div>
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={handleJoinByInvite}>
                  {t('server.findServer.joinAction')}
                </button>
              </div>
            )}
            {results.map((s) => (
              <div key={s.id} className="find-server-row">
                <Avatar username={s.name} url={s.icon_url} className="find-server-avatar" />
                <div className="find-server-name">{s.name}</div>
                <button type="button" className="btn btn-primary" onClick={() => { onJoinServer(s); onClose(); }}>
                  {t('server.findServer.joinAction')}
                </button>
              </div>
            ))}
          </div>
        )}
        {joinError && <p className="modal-error">{joinError}</p>}
        {searched && !hasRows && (
          <p className="find-server-empty">
            <Search size={16} strokeWidth={1.8} /> {t('server.findServer.noResults', { query: query.trim() })}
          </p>
        )}
        <div className="find-server-footer">
          <span className="find-server-footer-text">{t('server.findServer.footerQuestion')}</span>
          <button type="button" className="btn btn-secondary" onClick={() => { onClose(); onCreateServer(); }}>
            {t('server.findServer.createOwn')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

*(`resolveUploadUrl` is not needed — `Avatar` resolves `url` itself; check its prop contract at execution and use the same pattern ServerList's tiles use if it does not.)*

- [ ] **Step 3: `FindServerModal.css`** — board 1d values:

```css
/* ── Find-server modal — board 1d (452px, one merged field) ── */
.find-server-modal {
  width: 452px;
  max-width: 92vw;
}

.find-server-modal .input {
  height: 44px;
  padding: 0 14px;
  border-radius: var(--radius-card);
}

.find-server-results-label {
  margin: 16px 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted-2);
}

.find-server-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 264px;
  overflow-y: auto;
}

.find-server-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-card);
  transition: background var(--transition);
}

.find-server-row:hover {
  background: var(--canvas-2);
}

.find-server-row.is-invite {
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
}

.find-server-row > div {
  flex: 1;
  min-width: 0;
}

.find-server-row .btn {
  flex-shrink: 0;
}

.find-server-modal .find-server-avatar {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  flex: 0 0 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  object-fit: cover;
}

.find-server-name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.find-server-meta {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--muted-2);
}

.find-server-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--muted);
}

.find-server-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.find-server-footer-text {
  font-size: 12.5px;
  color: var(--muted);
}
```

- [ ] **Step 4: Rewire the hosts.** `AppPage.tsx`: `const [findServerOpen, setFindServerOpen] = useState(false);`; render `<FindServerModal open={findServerOpen} onClose={() => setFindServerOpen(false)} onJoinServer={handleJoinServer} onServerJoined={handleServerJoined} onCreateServer={() => { setShowCreateServer(true); setCreateServerError(''); }} />` next to the other modals; pass `onOpenFindServer={() => setFindServerOpen(true)}` to `ServerList` (dropping `onJoinServer`/`onServerJoined` from its props) and `onFindServer={() => setFindServerOpen(true)}` to `ChatArea`. `ServerList.tsx`: delete the whole `searchOpen` modal JSX (lines 157–236), all search/invite state + handlers (`searchQuery/searchResults/searchLoading/inviteCodeInput/invitePreview/inviteError/inviteBusy`, `handleSearch/handlePreviewInvite/handleJoinByInvite`), and the two dropped props; the search tile becomes `onClick={onOpenFindServer}`. `ChatArea.tsx` no-servers card: the `action` node becomes a two-button column —

```tsx
action={
  <div className="chat-empty-actions">
    <button type="button" className="btn btn-primary" onClick={() => onCreateServer?.()}>
      {t('server.create')}
    </button>
    {onFindServer && (
      <button type="button" className="btn btn-secondary" onClick={onFindServer}>
        {t('chat.haveCode')}
      </button>
    )}
  </div>
}
```

with a 3-line addition to the **rewritten-in-M2, must-stay-0** `ChatArea.css`: `.chat-empty-actions { display: flex; flex-direction: column; gap: 8px; }` (placed by the other `.chat-empty-*` rules; re-lint the file to 0).

- [ ] **Step 5: Delete ServerList's explore CSS** — remove `.explore-server-modal`, `.explore-server-close`, `.explore-server-divider`, `.search-bar`, `.search-results`, `.search-result-item` (+ descendants) from `ServerList.css`. **Keep `.search-empty`** (decision 22 — `ManageInvitesModal.tsx:82` still emits it until T8; leave a `/* carried until T8: ManageInvitesModal still emits search-empty */` comment). Verify with `rg -n 'explore-server|search-bar|search-results|search-result-item' src/ → zero rows` and `rg -n 'search-empty' src/ → exactly the ServerList.css rule + the ManageInvitesModal.tsx emitter`.

- [ ] **Step 6: Gates + probes**

```bash
cd client && npx stylelint src/components/FindServerModal.css src/components/ChatArea.css   # 0 each
npx stylelint src/components/ServerList.css 2>&1 | tail -2    # count STRICTLY BELOW T1's recording (deletions only)
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/FindServerModal.css    # zero rows
npx tsc --noEmit && npm test && npm run check:i18n && npm run lint:css 2>&1 | tail -3
node tools/smoke.mjs --click .server-icon.search --after 800 --probe tools/probe-find-server.js --out m4t5-find-light.png
node tools/smoke.mjs --click .server-icon.search --after 800 --theme dark --out m4t5-find-dark.png
node tools/smoke.mjs --probe tools/probe-chat.js    # cross-surface gate: the ChatArea empty-state edit broke nothing
```

*(The no-servers card itself is unreachable on the smoke account, which has servers — the «У меня есть код» branch is **reasoned-not-measured** beyond tsc/lint; record it, M2 precedent for the same card.)*

- [ ] **Step 7: Commit**

```bash
git add client/src/components/FindServerModal.tsx client/src/components/FindServerModal.css client/src/pages/AppPage.tsx client/src/components/ServerList.tsx client/src/components/ServerList.css client/src/components/ChatArea.tsx client/src/components/ChatArea.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): merged one-field find-server modal per board 1d — name search + invite preview in parallel, hosted by AppPage"
```

---

### Task 6: Settings shell — 648px, 186px icon nav, pinned danger «Выйти»

**Files:**
- Modify: `client/src/components/Settings.tsx` (shell JSX; panes untouched this task), `client/src/components/ChannelSidebar.tsx` (`onLogout` threading)
- **Rewrite:** `client/src/components/Settings.css`
- Modify: `client/src/i18n/locales/ru.ts` + `en.ts` *(no new keys expected — nav rows reuse `settings.tab*`, logout reuses `common.logout*`; if a key is missing at execution, add ru+en together)*

**Interfaces:**
- Consumes: `.modal-overlay`, `.modal-close-btn`, `useModalFocus` (adopted T3), `ConfirmModal`, `common.logoutTitle/Body` (T3).
- Produces:
  - `Settings` props: `{ isOpen: boolean; onClose: () => void; onLogout?: () => void }`; ChannelSidebar passes its `onLogout`.
  - Classes (Task 7 relies on the pane-side ones): `settings-modal, settings-header, settings-body, settings-nav, settings-nav-btn (+ is-active), settings-nav-logout, settings-pane, settings-section, settings-section-title, setting-row, setting-row-info, setting-row-title, setting-row-desc, setting-warning`. The legacy `settings-tabs/settings-tab/settings-content/setting-item/setting-info/setting-description/toggle-slider/setting-select` names die (panes are updated to the new names in **Task 7** — this task keeps a carried-legacy block at the bottom of Settings.css for the pane classes, M2-CONFLICT-1 precedent, deleted in Task 7).
- Nav rows: `{ id, labelKey, icon }` — `profile→User`, `audio→Volume2`, `video→Video`, `appearance→Palette`, 16px; logout row `LogOut` 16px, `margin-top: auto`, opens `ConfirmModal` (same keys as T3), rendered only when `onLogout` is provided.

- [ ] **Step 1: Fail-first probe** `tools/probe-settings-shell.js` (async; open via `tools/probe-open-settings.js`'s click, then): assert `.settings-modal` computed width 648px; `.settings-nav` width 186px with `background-color` = computed `--canvas-3`; every `.settings-nav-btn` contains an `svg`; the active row's background = computed `--accent-soft` and `font-weight: 700`; `.settings-nav-logout` is the **last** child, its `color` = computed `--danger`, and its `offsetTop` > the last plain row's (pinned); `.modal-close-btn` is 30×30; Escape closes and focus restores. Click the logout row → `.confirm-modal` with «Выйти» confirm; **dispatch Escape and assert `.confirm-modal` is gone while `.settings-modal` is still present** (the decision-8 stacking contract — pre-stack, one Escape closes both; grand-review C1), then re-open and **Cancel** — do not log the smoke session out mid-run. Pre-task: `.settings-nav` absent (old `.settings-tabs`) → loud fail. Record.

- [ ] **Step 2: Rewrite the shell JSX** (`Settings.tsx`): overlay `className="modal-overlay"` (z-index note: primitives' overlay is z-1000; the old settings overlay was z-2000 — Settings renders inside ChannelSidebar next to no other overlay, order in DOM decides; record if a stacking conflict is observed and fix with a `.settings-modal`-scoped z rule, not by resurrecting a second overlay class); modal div keeps `modalRef` + `useModalFocus` from T3; header:

```tsx
<div className="settings-header">
  <h2 className="modal-title">{t('settings.title')}</h2>
  <button type="button" className="modal-close-btn" aria-label={t('common.close')} onClick={onClose}>
    <X size={16} strokeWidth={1.8} />
  </button>
</div>
<div className="settings-body">
  <nav className="settings-nav">
    {TABS.map((tab) => (
      <button key={tab.id} type="button"
        className={`settings-nav-btn${activeTab === tab.id ? ' is-active' : ''}`}
        onClick={() => setActiveTab(tab.id)}>
        <tab.icon size={16} strokeWidth={1.8} />
        {t(tab.labelKey)}
      </button>
    ))}
    {onLogout && (
      <button type="button" className="settings-nav-btn settings-nav-logout" onClick={() => setConfirmLogout(true)}>
        <LogOut size={16} strokeWidth={1.8} />
        {t('common.logout')}
      </button>
    )}
  </nav>
  <div className="settings-pane">{/* pane switch unchanged */}</div>
</div>
```

plus the `ConfirmModal` for `confirmLogout` (T3's exact recipe; `onConfirm={() => { setConfirmLogout(false); onClose(); onLogout?.(); }}`). `TABS` entries gain `icon` (typed `LucideIcon`).

- [ ] **Step 3: Rewrite `Settings.css`** — board 1d values, token-only:

```css
/* ── Settings modal — board 1d: 648px, 186px icon nav, pinned danger logout ── */
.settings-modal {
  width: 648px;
  max-width: 92vw;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-modal);
  animation: modal-in 0.18s var(--ease-out);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.settings-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.settings-nav {
  width: 186px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 10px;
  background: var(--canvas-3);
  border-right: 1px solid var(--line);
  overflow-y: auto;
}

.settings-nav-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  text-align: left;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.settings-nav-btn:hover {
  background: var(--canvas-2);
  color: var(--ink);
}

.settings-nav-btn.is-active {
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 700;
}

.settings-nav-logout {
  margin-top: auto;
  color: var(--danger);
}

.settings-nav-logout:hover {
  background: var(--danger-soft);
  color: var(--danger-text);
}

.settings-pane {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.settings-section {
  margin-bottom: 26px;
  padding-bottom: 26px;
  border-bottom: 1px solid var(--line);
}

.settings-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.settings-section-title {
  margin-bottom: 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted-2);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
}

.setting-row-info {
  flex: 1;
  min-width: 0;
}

.setting-row-title {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
}

.setting-row-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
}

.setting-warning {
  margin: 8px 0 0;
  padding: 8px 14px;
  border-radius: var(--radius-row);
  border: 1px solid var(--warning);
  background: var(--canvas-2);
  font-size: 12px;
  font-weight: 500;
  color: var(--warning);
}
```

Below this, keep a marked block `/* ═══ LEGACY (carried until T7 of the M4 plan): pane classes still emitted by settings/*.tsx ═══ */` holding the current `.settings-section h3`, `.setting-item`, `.setting-info`, `.setting-description`, `.toggle-switch`(old 24px)/`.toggle-slider`, `.setting-select` rules **verbatim** — the panes still emit them until Task 7. Enumerate the carried violations in the ledger. **Collision note (the one real hazard):** the legacy block's old `.toggle-switch` (44×24) now ties with T2's primitive `.toggle-switch` (44×26) — source order (primitives injected before component CSS since M2 T1) means the legacy copy **wins ties while carried**, so the old panes keep their old toggle for exactly one task. Assert in this task's probe that the *shell* is new while a pane toggle still measures 24px — the honest interim, recorded like M3's decision 25(d).

- [ ] **Step 4: Thread `onLogout`** — `ChannelSidebar.tsx`: `<Settings isOpen={settingsOpen} onClose={...} onLogout={onLogout} />`.

- [ ] **Step 5: Gates + probes**

```bash
cd client && npx stylelint src/components/Settings.css 2>&1 | tail -3   # violations ONLY inside the carried marker
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/Settings.css        # zero rows OUTSIDE the carried block (record any inside it)
npx tsc --noEmit && npm test && npm run check:i18n && npm run lint:css 2>&1 | tail -3
node tools/smoke.mjs --probe tools/probe-settings-shell.js --out m4t6-settings-light.png
node tools/smoke.mjs --theme dark --probe tools/probe-settings-shell.js --out m4t6-settings-dark.png
```

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Settings.tsx client/src/components/Settings.css client/src/components/ChannelSidebar.tsx
git commit -m "feat(redesign): settings shell per board 1d — 648px modal, 186px icon nav, pinned danger logout via ConfirmModal"
```

---

### Task 7: Settings panes — primitives adoption, mic test + live level meter

**Files:**
- **Rewrite:** `client/src/components/settings/AudioSettings.tsx`
- Modify: `client/src/components/settings/VideoSettings.tsx`, `client/src/components/settings/AppearanceSettings.tsx`, `client/src/components/settings/ProfileSettings.tsx`, `client/src/components/Settings.css` (delete the T6 carried block), `client/src/i18n/locales/ru.ts` + `en.ts`
- **Rewrite:** `client/src/components/settings/ProfileSettings.css`

**Interfaces:**
- Consumes: `.toggle-switch`/`.toggle-track`, `.select-wrap`/`.select-control`/`.select-chevron`, `.slider-input` (+ `--slider-fill`), `.level-meter*` (+ `--meter-level`), `.btn` roles, `setting-row*` (T6), `hooks/useMicLevel.ts` (M3: `useMicLevel(stream: MediaStream | null, isMuted: boolean): number`).
- Produces: shared pane markup pattern every pane uses —

```tsx
<div className="setting-row">
  <div className="setting-row-info">
    <span className="setting-row-title">{t('settings.…')}</span>
    <p className="setting-row-desc">{t('settings.…Description')}</p>
  </div>
  {/* control: toggle / select-wrap / slider / buttons */}
</div>
```

  toggle: `<label className="toggle-switch"><input type="checkbox" … /><span className="toggle-track" /></label>`; select: `<span className="select-wrap"><select className="select-control" …>…</select><span className="select-chevron"><ChevronDown size={14} strokeWidth={1.8} /></span></span>`; slider: `<input type="range" className="slider-input" style={{ '--slider-fill': `${Math.round(volume * 100)}%` } as React.CSSProperties} … />`.
- i18n added: `settings.micTest: 'Проверка микрофона' / 'Mic test'`, `settings.micTestDescription: 'Скажите что-нибудь — полоска покажет уровень входа' / 'Say something — the bar shows your input level'`, `settings.micTestStart: 'Проверить' / 'Test'`, `settings.micTestStop: 'Остановить' / 'Stop'`, `settings.inputLevel: 'уровень входа' / 'input level'`, `settings.micTestError: 'Не удалось получить доступ к микрофону' / 'Could not access the microphone'`.

- [ ] **Step 1: Fail-first probes.** `tools/probe-settings-panes.js`: open settings → audio pane (click nav row index 1); assert a `.toggle-switch` measures 44×26 (pre-task: 44×24 → loud fail), `.select-control` height 36 with a sibling `svg` chevron, `.slider-input` present with a computed gradient background on its track, **zero emoji glyphs** in the pane (`/[\u{1F300}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(pane.textContent)` false — the 2B00 block covers ⬅️/U+2B05, which the narrower range misses (grand-review M1); pre-task: 💬📞➡️⬅️ → loud fail), test-sound buttons are `.btn.btn-secondary` with `svg` icons. `tools/probe-mic-meter.js` (needs `--fake-media` for the auto-granted fake mic): click «Проверить»; take one sample **before** clicking «Проверить» (must be `0px`), then sample `.level-meter-fill`'s computed width ~15× over 1.5s; assert the button label flipped to «Остановить» and width is a non-`0px` value in ≥1 active sample (grand-review I4: the fake tone's ~0.0065–0.0115 amplitude rounds to exactly 1% every sample, so a "≥2 distinct values" clause would be a timing-accident flake — the 0→non-zero→0 envelope is the same evidence without it; assert numerically, do not eyeball); click «Остановить» → assert the fill returns to `0px` and — via a pre-hooked `MediaStreamTrack.prototype.stop` counter installed **before** the click — that `stop()` was called on every acquired track. Pre-task: the mic-test row does not exist → loud fail. Record: **the fake tone cannot exercise a visually prominent fill; the mapping is measured, the visual is not** (M3 speaking-ring precedent — say it plainly in the ledger).

- [ ] **Step 2: Rewrite `AudioSettings.tsx`.** Structure: section «Звуки» (three notification toggles + volume slider + test-sound row) · section «Микрофон» (NC toggle + NC-unsupported warning + mic-test row) · section «Устройства» (the two inert selects — decision 12, restyled). All inline `style={{…}}` objects deleted; test-sound buttons become:

```tsx
<div className="setting-row-actions">
  <button type="button" className="btn btn-secondary" onClick={() => audioService.playMessage()}>
    <MessageSquare size={16} strokeWidth={1.8} /> {t('settings.testMessage')}
  </button>
  <button type="button" className="btn btn-secondary" onClick={() => { audioService.startRingtone(); setTimeout(() => audioService.stopRingtone(), 3000); }}>
    <Phone size={16} strokeWidth={1.8} /> {t('settings.testRing')}
  </button>
  <button type="button" className="btn btn-secondary" onClick={() => audioService.playUserJoined()}>
    <LogIn size={16} strokeWidth={1.8} /> {t('settings.testJoin')}
  </button>
  <button type="button" className="btn btn-secondary" onClick={() => audioService.playUserLeft()}>
    <LogOut size={16} strokeWidth={1.8} /> {t('settings.testLeave')}
  </button>
</div>
```

Mic-test block (decision 11 — component-local, zero services changes):

```tsx
const [testStream, setTestStream] = useState<MediaStream | null>(null);
const [micError, setMicError] = useState(false);
const level = useMicLevel(testStream, false);

const toggleMicTest = async () => {
  if (testStream) {
    testStream.getTracks().forEach((tr) => tr.stop());
    setTestStream(null);
    return;
  }
  setMicError(false);
  try {
    setTestStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
  } catch {
    setMicError(true);
  }
};

useEffect(() => () => { testStream?.getTracks().forEach((tr) => tr.stop()); }, [testStream]);
```

```tsx
<div className="setting-row">
  <div className="setting-row-info">
    <span className="setting-row-title">{t('settings.micTest')}</span>
    <p className="setting-row-desc">{t('settings.micTestDescription')}</p>
  </div>
  <div className="mic-test-block">
    <div className="level-meter" style={{ '--meter-level': `${Math.min(100, Math.round(level * 100))}%` } as React.CSSProperties}>
      <div className="level-meter-fill" />
    </div>
    <div className="level-meter-caption">{t('settings.inputLevel')}</div>
    <button type="button" className="btn btn-secondary" onClick={() => { void toggleMicTest(); }}>
      {testStream ? t('settings.micTestStop') : t('settings.micTestStart')}
    </button>
  </div>
</div>
{micError && <p className="setting-warning">{t('settings.micTestError')}</p>}
```

*(Effect-cleanup shape: the `useEffect` above re-registers per stream and stops the previous one on change/unmount — the classic acquire/release pair. Keep it exactly; a single-mount `[]` variant leaks the first stream on re-test.)*

- [ ] **Step 3: Convert the other panes** — Video/Appearance: `setting-item→setting-row` family + `select-wrap` pattern (Appearance keeps its theme select semantics; Video its inert camera select). ProfileSettings: `setting-item→setting-row` family; avatar buttons → `.btn btn-secondary` / `.btn btn-ghost`; locale select → primitive; `ProfileSettings.css` rewritten token-only (avatar block layout + `profile-avatar-large` sizing stay; hardcoded values → tokens; 0 problems). Add the two structural rules to `Settings.css`'s main body: `.setting-row-actions { display: flex; flex-wrap: wrap; gap: 8px; }` and `.mic-test-block { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }`.

- [ ] **Step 4: Delete the T6 carried block** from `Settings.css` (the panes no longer emit those classes). Verify: `rg -n 'setting-item|setting-info|setting-description|toggle-slider|setting-select|settings-tabs|settings-tab\b|settings-content' src/ → zero rows`. `Settings.css` is now **0 problems, no exceptions**.

- [ ] **Step 5: Gates + probes**

```bash
cd client && npx stylelint src/components/Settings.css src/components/settings/ProfileSettings.css   # 0 each
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/Settings.css src/components/settings/ProfileSettings.css   # zero rows
npx tsc --noEmit && npm test && npm run check:i18n && npm run lint:css 2>&1 | tail -3
node tools/smoke.mjs --probe tools/probe-settings-panes.js --out m4t7-audio-light.png
node tools/smoke.mjs --theme dark --probe tools/probe-settings-panes.js --out m4t7-audio-dark.png
node tools/smoke.mjs --fake-media --probe tools/probe-mic-meter.js
node tools/smoke.mjs --probe tools/probe-settings-shell.js   # T6's shell assertions still hold after the pane rewrite
```

- [ ] **Step 6: Commit**

```bash
git add client/src/components/settings/ client/src/components/Settings.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): settings panes on form primitives — toggles 44×26, wrapped selects, filled slider; live mic-test level meter"
```

---
### Task 8: Small-modal sweep — create/edit ×4, invites, link dialog; primitives reaches 0

**Files:**
- Modify: `client/src/components/EditServerModal.tsx`, `client/src/components/EditChannelModal.tsx`, `client/src/components/CreateChannelModal.tsx`, `client/src/pages/AppPage.tsx` (create-server modal buttons), `client/src/components/ManageInvitesModal.tsx`, `client/src/components/LinkDialog.tsx`
- **Rewrite:** `client/src/components/EditServerModal.css`, `client/src/components/ManageInvitesModal.css`, `client/src/components/LinkDialog.css`
- Modify: `client/src/styles/primitives.css` (**delete the T2 carried block**), `client/src/components/ServerList.css` (**delete `.search-empty`**), `client/src/i18n/locales/ru.ts` + `en.ts`

**Interfaces:**
- Consumes: `.modal`/`.modal-header`/`.modal-title`/`.modal-close-btn`/`.modal-actions`/`.btn` roles, `inviteExpiry` (`utils/inviteExpiry.ts` — `(expiresAt?: string) => { kind: 'never' } | { kind: 'days'; days: number }`), existing keys `server.inviteCard.noExpiry`/`server.inviteCard.expiresDays`.
- Produces: every `.modal-actions` in the app renders `.btn` children — the conversion table, applied at all six sites (`AppPage.tsx:698`, `EditServerModal.tsx:143,146`, `EditChannelModal.tsx:57,60`, `CreateChannelModal.tsx:53,56`, `ManageInvitesModal.tsx:126`, plus LinkDialog's two):
  `<button>` (cancel) → `className="btn btn-secondary"` · `<button className="primary">` → `className="btn btn-primary"`. New classes: `invites-empty, invites-list, invites-row, invites-code, invites-meta, invites-actions`, wrapper `modal invites-modal` (replacing the misnamed `channel-access-*` family and the whole `manage-invites-*`/`search-empty` set; `.invites-modal` exists for width only if needed — `.modal`'s default `max-width: 440px` is the intended size, so the class may carry zero declarations and can then be omitted; decide at execution and record). `link-dialog` keeps its namespace.

- [ ] **Step 1: Fail-first probe** `tools/probe-modal-sweep.js` (async): open the create-channel modal (click `.channel-category-add`); assert both action buttons carry `btn` classes (pre-task: bare `<button>`/`.primary` → loud fail) and the primary's computed bg = `--accent`; close. Open the server menu → «Пригласить»; in ManageInvites assert: `.modal-close-btn` 30×30 (pre-task: text `✕` in `.manage-invites-close` → fail), zero `<svg>` elements **without** the `lucide` class (pre-task: 3 hand-inlined SVGs → fail), and — after clicking «Создать ссылку» (writes one invite to the smoke server; residue-record it) — an `invites-row` whose meta text matches `inviteExpiry`'s output for the returned `expires_at` («Ссылка живёт N дн.» or «Ссылка не истекает») plus «использований: 0». Run pre-task → loud fail. Record.

- [ ] **Step 2: Convert the five form modals.** Mechanical per the table; additionally each gets the header pattern where it has none: `<h2>` → `<div className="modal-header"><h2 className="modal-title">…</h2><button className="modal-close-btn" …><X size={16} strokeWidth={1.8} /></button></div>` for EditServer/ManageInvites (which had ad-hoc close buttons — `manage-invites-close` dies) — Create/Edit-channel and AppPage's create-server keep their no-close-button shape (Cancel covers it; board 1d shows close buttons on the two big modals, not the small forms). `EditServerModal.css` rewrite: `edit-server-icon-preview` (46px, r14 — the rail-tile radius table), `edit-server-icon-actions` buttons → `.btn btn-secondary`/`.btn btn-danger-soft` (the bare `.edit-server-icon-btn.danger` dies), token-only, 0 problems.

- [ ] **Step 3: Rewrite `ManageInvitesModal.tsx` rows** — lucide `Copy`/`Check` (15) for the copy button, `Trash2` (15) for revoke; `channel-access-*`→`invites-*`; `search-empty`→`invites-empty`; expiry line added to each row:

```tsx
<li key={invite.code} className="invites-row">
  <div>
    <span className="invites-code">{invite.code}</span>
    <span className="invites-meta">
      {t('server.invites.usesCount', { count: String(invite.uses) })}
      {' · '}
      {(() => { const exp = inviteExpiry(invite.expires_at);
        return exp.kind === 'never' ? t('server.inviteCard.noExpiry') : t('server.inviteCard.expiresDays', { days: String(exp.days) }); })()}
    </span>
  </div>
  <div className="invites-actions">
    <button type="button" className="panel-icon-btn"
      title={copiedCode === invite.code ? t('server.invites.copied') : t('server.invites.copy')}
      aria-label={t('server.invites.copy')} onClick={() => handleCopy(invite.code)}>
      {copiedCode === invite.code
        ? <Check size={15} strokeWidth={1.8} />
        : <Copy size={15} strokeWidth={1.8} />}
    </button>
    <button type="button" className="panel-icon-btn is-danger"
      title={t('server.invites.revoke')} aria-label={t('server.invites.revoke')}
      onClick={() => handleRevoke(invite.code)}>
      <Trash2 size={15} strokeWidth={1.8} />
    </button>
  </div>
</li>
```

`ManageInvitesModal.css` rewrite (token-only, 0 problems): `invites-list` (flex column, gap 6px, max-height 300px, overflow auto), `invites-row` (padding 10px 12px, r11 `--radius-card`, `1px solid var(--line)`, `--canvas-3` bg, flex space-between), `invites-code` (mono `--font-mono` 12.5px 600 `--ink`), `invites-meta` (11.5px `--muted-2`, block), `invites-actions` buttons = `.panel-icon-btn` recipe consumers (`panel-icon-btn` + `is-danger` for revoke — reuse the primitive, no new button recipe), `invites-empty` (13px `--muted`).

- [ ] **Step 4: LinkDialog** — backdrop → `.modal-overlay` (drop `link-dialog-backdrop`; keep the `onMouseDown` close semantics on the overlay), dialog `modal link-dialog` (width 380px override), fields keep `link-dialog-field` (label 13/600 `--muted`, input = `.input` class), error `modal-error`, actions `modal-actions` + `.btn` roles. `LinkDialog.css` rewrite: the 5 hex die; ~20 lines, 0 problems.

- [ ] **Step 5: Delete the two carried blocks.** `primitives.css`: remove the `.modal-actions button` legacy block — **verify first**: `rg -n 'className="primary"|className=\{`?"?primary' src/ → zero rows` and `rg -n 'modal-actions' src/ → only .btn children sites`. `ServerList.css`: remove `.search-empty` (`rg -n 'search-empty' src/ → zero rows`). From here `primitives.css` must be **0 problems, no exceptions** (decision 5's endpoint).

- [ ] **Step 6: Gates + probes**

```bash
cd client && npx stylelint src/styles/primitives.css src/components/EditServerModal.css src/components/ManageInvitesModal.css src/components/LinkDialog.css   # 0 · 0 · 0 · 0
npx stylelint src/components/ServerList.css 2>&1 | tail -2   # ≤ T5's number minus the search-empty violations, if any
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/styles/primitives.css src/components/EditServerModal.css src/components/ManageInvitesModal.css src/components/LinkDialog.css   # zero rows
npx tsc --noEmit && npm test && npm run check:i18n && npm run lint:css 2>&1 | tail -3
node tools/smoke.mjs --probe tools/probe-modal-sweep.js --out m4t8-invites-light.png
node tools/smoke.mjs --theme dark --probe tools/probe-modal-sweep.js --out m4t8-invites-dark.png
node tools/smoke.mjs --probe tools/probe-primitives.js   # T2's overlay/keyframe assertions still hold with the block gone
```

*(LinkDialog verification: it opens from the formatting toolbar's link button inside the composer — `probe-modal-sweep.js` adds a phase: focus the composer, reveal the toolbar via the `Aa` toggle, click the link button, assert `.link-dialog` computed r16 + `.btn` actions, Esc closes. Pre-task it renders the old classes → the phase fails loudly.)*

- [ ] **Step 7: Commit**

```bash
git add client/src/components/EditServerModal.tsx client/src/components/EditServerModal.css client/src/components/EditChannelModal.tsx client/src/components/CreateChannelModal.tsx client/src/pages/AppPage.tsx client/src/components/ManageInvitesModal.tsx client/src/components/ManageInvitesModal.css client/src/components/LinkDialog.tsx client/src/components/LinkDialog.css client/src/styles/primitives.css client/src/components/ServerList.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): form modals on btn roles + modal header pattern; invites rows with expiry on lucide; link dialog tokenized; primitives.css reaches 0"
```

---

### Task 9: StickerManager + AvatarCropModal

**Files:**
- Modify: `client/src/components/StickerManager.tsx`, `client/src/components/AvatarCropModal.tsx`
- **Rewrite:** `client/src/components/StickerManager.css`, `client/src/components/AvatarCropModal.css`
- Modify: `client/src/i18n/locales/ru.ts` + `en.ts`

**Interfaces:**
- Consumes: `ConfirmModal`, `.modal-header` pattern, `.btn` roles, `.slider-input` (+ `--slider-fill`), `.error-toast`.
- Produces: i18n added — `chat.deleteStickerTitle: 'Удалить стикер «{{name}}»?' / 'Delete sticker “{{name}}”?'`, `chat.deleteStickerBody: 'Стикер станет недоступен всем участникам сервера.' / 'The sticker will no longer be available to anyone on this server.'`. Sticker delete flows through `ConfirmModal` (`confirmDeleteSticker: Sticker | null` state — the handler needs the whole sticker for the title interpolation, not just the id).

- [ ] **Step 1: Fail-first probe** `tools/probe-sticker-crop.js` (async): poison `window.confirm`. Open the sticker manager (composer → sticker picker → «управление» button; the smoke account owns «Redesign Smoke», so `canManageStickers` is true — assert the button exists rather than assuming). Assert: `.modal-header` + 30×30 close (pre-task: bare `<h3>` + bottom close button → loud fail), dropzone contains a `lucide` svg and no emoji, upload/remove buttons carry `.btn` classes. If a sticker exists (M2 left 3 on the server — count first), click its delete → assert `.confirm-modal` with the sticker's name in the title → **Cancel**. Pre-task: delete hits poisoned `window.confirm` → loud fail either way. AvatarCrop phase: from settings → profile → «Изменить аватар» a real file pick can't be driven headlessly — instead assert statically-reachable pieces via a **rendered** crop modal by dispatching a `File` through the input's native setter (`DataTransfer` + `dispatchEvent(new Event('change'))` with a 1×1 PNG blob — works headless); assert `.avatar-crop-modal` uses `modal` shell classes, the zoom row has a `lucide` icon (pre-task 🔍 → fail) and `.slider-input`.
- [ ] **Step 2: StickerManager** — `<h3>` → `.modal-header` pattern (title `chat.manageStickersTitle`, `.modal-close-btn`; the bottom «Закрыть» button dies); root divs → `modal-overlay` + `modal sticker-manager` (keep the namespace class for its own rules); 🖼️ → `ImagePlus size={28} strokeWidth={1.8}` in `--muted-2`; name input → `.input`; «убрать файл» → `.btn btn-ghost`, «Загрузить» → `.btn btn-primary`, per-sticker delete → `.panel-icon-btn is-danger` with `Trash2 size={15}`; `window.confirm` → `ConfirmModal` (keys above; on confirm run the existing delete body). `StickerManager.css` rewrite: dropzone (2px dashed `--line-strong`, r11, `--canvas-3` bg; `is-active` → `--accent` border + `--accent-soft` bg; `is-error` → `--danger` border), list rows (r9, `--line` border, 48px thumbs), token-only, 0 problems.
- [ ] **Step 3: AvatarCropModal** — overlay/modal → shell classes (`modal avatar-crop-modal`), `<h3>` → `.modal-header` (close = cancel), 🔍 → `ZoomIn size={16} strokeWidth={1.8}` in `--muted-2`, zoom `input[type=range]` → `className="slider-input"` with `--slider-fill` inline (`(zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)`), action buttons → `.btn btn-secondary` / `.btn btn-primary` (the `avatar-crop-btn` family dies). `AvatarCropModal.css` rewrite: canvas frame (r14, `--line` border), zoom row layout, token-only, 0 problems. Behavior (pointer drag, wheel, export) untouched.
- [ ] **Step 4: Gates + probes**

```bash
cd client && npx stylelint src/components/StickerManager.css src/components/AvatarCropModal.css   # 0 · 0
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/StickerManager.css src/components/AvatarCropModal.css   # zero rows
rg -n 'window\.confirm' src/   # ZERO rows — the last one died here
npx tsc --noEmit && npm test && npm run check:i18n && npm run lint:css 2>&1 | tail -3
node tools/smoke.mjs --probe tools/probe-sticker-crop.js --out m4t9-stickers-light.png
node tools/smoke.mjs --theme dark --probe tools/probe-sticker-crop.js --out m4t9-stickers-dark.png
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/StickerManager.tsx client/src/components/StickerManager.css client/src/components/AvatarCropModal.tsx client/src/components/AvatarCropModal.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): sticker manager + avatar crop on modal shell — ConfirmModal delete, slider primitive, last window.confirm removed"
```

---

### Task 10: ErrorBoundary i18n + banners + dead-key sweep

**Files:**
- Modify: `client/src/components/ErrorBoundary.tsx`, `client/src/components/UpdateBanner.tsx`, `client/src/pages/AppPage.tsx` + `client/src/pages/AppPage.css` (call-notif extraction)
- Create: `client/src/components/CallNotifBanner.tsx`, `client/src/components/CallNotifBanner.css`
- **Rewrite:** `client/src/components/ErrorBoundary.css`, `client/src/components/UpdateBanner.css`
- Modify: `client/src/i18n/locales/ru.ts` + `en.ts` (new `crash` section; dead-key deletions per decision 27)

**Interfaces:**
- Consumes: `.btn` roles, `.kbd` (event-id chip), accent-soft banner recipe (VoiceBanner family), existing keys `call.invitesTo`/`call.joinCall`/`common.close`.
- Produces:
  - `CallNotifBanner` props: `{ callerName: string; channelName: string; onJoin: () => void; onDismiss: () => void }`; classes `call-notif-banner, call-notif-icon, call-notif-text, call-notif-join` — the join button is `className="call-notif-join btn btn-primary"` (btn role + a layout-only `call-notif-join` rule), the dismiss button is `.modal-close-btn` outright and `call-notif-dismiss` **dies** (grand-review I3: the old `AppPage.css:140-171` button rules are deleted, not moved — only the banner/icon/text/join-layout rules migrate).
  - i18n `crash` section (ru / en): `title: 'Что-то пошло не так' / 'Something went wrong'`, `body: 'Мы уже знаем об этой ошибке. Попробуйте перезагрузить приложение.' / 'We already know about this error. Try reloading the app.'`, `reload: 'Перезагрузить' / 'Reload'`, `copyId: 'Скопировать' / 'Copy'`, `eventId: 'ID: {{id}}' / 'ID: {{id}}'`, `feedbackSummary: 'Что вы делали, когда это произошло?' / 'What were you doing when this happened?'`, `feedbackPlaceholder: 'Необязательно, но очень помогает разобраться' / 'Optional, but it really helps'`, `feedbackSend: 'Отправить' / 'Send'`, `feedbackSent: 'Спасибо, отправлено' / 'Thanks, sent'`.

- [ ] **Step 1: Fail-first probe** `tools/probe-callnotif.js` (async): the banner renders when AppPage's `callNotif` state is set by the incoming-call WS event — **pin the exact event name and payload from `AppPage.tsx` at execution time** (read the `setCallNotif` call site) and drive it via `--preload tools/inject-voice-ws.js --push-ws '<event>:<payload>'` (remember: inert without `--preload`, fires before `--probe`). Assert: `.call-notif-banner` exists, contains a `lucide` svg (pre-task: 🔔 text node → loud fail), join button `.btn btn-primary` sized ≥28px tall, dismiss is an icon button (no `✕` text). If the payload cannot be pinned to a deliverable shape (the event may require a live caller), **downgrade honestly**: render assertions become static JSX/CSS review recorded as reasoned-not-measured, and the probe is not cited. Decide at execution, record which path was taken.
- [ ] **Step 2: Extract `CallNotifBanner.tsx`** — move the JSX block (`AppPage.tsx:707-737`) into the component verbatim except: 🔔 → `PhoneIncoming size={16} strokeWidth={1.8}`, `✕` → `X size={14} strokeWidth={1.8}` with `aria-label={t('common.close')}`; join → `className="call-notif-join btn btn-primary"` (layout-only rule), dismiss → `className="modal-close-btn"` (no banner-specific class — per the Produces block above). Move the surviving `.call-notif-*` rules out of `AppPage.css` into `CallNotifBanner.css` rewritten token-only, and **delete** the old `.call-notif-join`/`.call-notif-dismiss` button-styling rules (accent-soft banner: `--accent-soft` bg, `--accent-border` border, r12, fixed top-center position kept from the old rules), 0 problems. `AppPage.css` loses rules only — its count must be ≤ T1's recording.
- [ ] **Step 3: ErrorBoundary** — `CrashFallback` gains `const t = useT();` and every literal swaps to the `crash` keys; ⚠️ → `AlertTriangle size={28} strokeWidth={1.8}` in a 56px r18 `--danger-soft` tile (the empty-state tile recipe); reload → `.btn btn-primary`, copy → `.btn btn-ghost`, feedback submit → `.btn btn-secondary`; the `'Спасибо, отправлено ✓'` string's `✓` becomes `Check size={14}` next to the label. `ErrorBoundary.css` rewrite: centered card on `--canvas` (`--line` border, r16, `--shadow-modal`), token-only (its `--text-muted` aliases die with the rewrite — M6's alias sweep loses two files), 0 problems. **Verification limits (decision 17):** the crash render cannot be exercised here — gates are `npm run check:i18n` **now printing 0 warnings** (the milestone's measurable win), `tsc` parity, lint 0, and a static read; recorded reasoned-not-measured.
- [ ] **Step 4: UpdateBanner** — `update-banner__dismiss` → `update-banner-dismiss` (TSX + CSS); buttons → `.btn btn-primary` (install/restart) and `.btn btn-ghost` (later/manual); `UpdateBanner.css` rewrite token-only on the accent-soft banner recipe, keeping its current fixed position under the TitleBar (verify the offset value against `TitleBar.css` at execution — the M0 closeout moved title-bar styles; do not hardcode a stale 40px if the token/value differs), 0 problems. **Electron-only: statically verified, reasoned-not-measured** (decision 19).
- [ ] **Step 5: Dead-key sweep (decision 27)** — for each candidate, `rg` its full dotted key path in `src/` excluding the locale files; **zero consumers → delete from ru+en; any consumer → keep and record**. Candidates: `call.screenSharingActive`, `chat.deleteConfirm`, `server.deleteConfirm`, `channel.deleteConfirm`, `chat.deleteStickerConfirm`, `common.logoutConfirm`, `server.searchPlaceholder`, `server.search`, `server.searching`, `server.noneFound`, `server.orSeparator`, `server.join`, `server.joinByCode.label`, `server.joinByCode.placeholder`, `server.joinByCode.preview`. Known-kept: `server.joinByCode.memberCount`. Run `npx tsc --noEmit` after — a deletion that breaks compilation was a live key: restore it.
- [ ] **Step 6: Gates + probes**

```bash
cd client && npx stylelint src/components/ErrorBoundary.css src/components/UpdateBanner.css src/components/CallNotifBanner.css   # 0 · 0 · 0
npx stylelint src/pages/AppPage.css 2>&1 | tail -2   # ≤ T1's recording (deletions only)
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/ErrorBoundary.css src/components/UpdateBanner.css src/components/CallNotifBanner.css   # zero rows
npm run check:i18n    # exit 0 — **0 warnings** (was 4; this line is the milestone's headline gate)
npx tsc --noEmit && npm test && npm run lint:css 2>&1 | tail -3
node tools/smoke.mjs --preload tools/inject-voice-ws.js --push-ws '<pinned>' --probe tools/probe-callnotif.js --out m4t10-callnotif.png   # or the recorded static downgrade
```

- [ ] **Step 7: Commit**

```bash
git add client/src/components/ErrorBoundary.tsx client/src/components/ErrorBoundary.css client/src/components/UpdateBanner.tsx client/src/components/UpdateBanner.css client/src/components/CallNotifBanner.tsx client/src/components/CallNotifBanner.css client/src/pages/AppPage.tsx client/src/pages/AppPage.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): error boundary on i18n (check:i18n 4→0) + tokenized update/call-notif banners; dead-key sweep"
```

---

### Task 11: Final gate sweep + visual QA + ledger closeout numbers

No production code changes expected; fixes found here go into this task's commit (or a scoped fix commit if large — surface first).

**Files:** none planned (fixes only).

- [ ] **Step 1: Full static gates, recorded verbatim**

```bash
cd client && npm run lint:css 2>&1 | tail -3     # record final total; must be ≤ 531 and expected well below 271
for f in src/styles/primitives.css src/components/FindServerModal.css src/components/Settings.css \
  src/components/settings/ProfileSettings.css src/components/EditServerModal.css src/components/ManageInvitesModal.css \
  src/components/LinkDialog.css src/components/StickerManager.css src/components/AvatarCropModal.css \
  src/components/UpdateBanner.css src/components/ErrorBoundary.css src/components/CallNotifBanner.css \
  src/components/ChatArea.css; do npx stylelint "$f" || echo "FAIL $f"; done    # each 0 problems
npx stylelint src/styles/tokens.css src/pages/AppPage.css src/components/ServerList.css src/components/ChannelSidebar.css src/components/ConfirmModal.css src/components/CallUI.css 2>&1 | tail -2   # no gain vs T1 recordings (deletion-driven drops welcome)
npx tsc --noEmit
npm test                                          # only api.network-retry fails (3) + 2 rejections; record totals
npm run check:i18n                                # exit 0, ZERO warnings
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/styles/primitives.css src/components/FindServerModal.css src/components/Settings.css src/components/settings/ProfileSettings.css src/components/EditServerModal.css src/components/ManageInvitesModal.css src/components/LinkDialog.css src/components/StickerManager.css src/components/AvatarCropModal.css src/components/UpdateBanner.css src/components/ErrorBoundary.css src/components/CallNotifBanner.css   # zero rows, literally
rg -n 'window\.confirm|window\.alert|(?<![.\w])alert\(' --pcre2 src/    # zero rows (window\.alert spelled out — the lookbehind alone would skip it; grand-review M6)
rg -n 'fadeIn|scaleIn|modalIn|update-banner__|channel-access-|explore-server|search-bar|search-results|search-result-item|search-empty|manage-invites-|setting-item|setting-select|toggle-slider|settings-tabs|settings-content|avatar-crop-btn|call-notif-dismiss|link-dialog-backdrop|link-dialog-cancel|link-dialog-submit' src/   # zero rows — the dead-name belt; the bidirectional scan below is the suspenders
rg -n '[\x{1F300}-\x{1FAFF}\x{2190}-\x{27BF}\x{2B00}-\x{2BFF}]|✕' src/components src/pages --glob '*.tsx'   # zero rows on M4 surfaces (2B00 block covers ⬅️ — grand-review M1); any hit outside M4 scope → record owner, do not fix
```

- [ ] **Step 2: Bidirectional class scan (the primary orphan gate)** — for every M4-owned CSS file: each selector class appears in some TSX, and each className token in the M4-touched TSX has a rule. **Match class tokens, not substrings** (the M3 trap). The 4 JS-injected custom properties (`--slider-fill`, `--meter-level`, plus M0/M3's `--avatar-*`, `--speak-level` family) are expected non-CSS-defined names — list them, don't flag them. Record: N classes → 0 orphans; M tokens → 0 missing.

- [ ] **Step 3: Fresh-server visual QA, both themes** — restart the dev server (stale-server rule: compare start time vs HEAD commit time), re-run **every** M4 probe at HEAD: `probe-primitives`, `probe-confirm-focus`, `probe-logout-confirm`, `probe-server-menu`, `probe-channel-menu`, `probe-find-server`, `probe-settings-shell`, `probe-settings-panes`, `probe-mic-meter` (`--fake-media`), `probe-modal-sweep`, `probe-sticker-crop`, `probe-callnotif` (or its recorded downgrade). Screenshot set (light+dark each): find-server with results, find-server invite row, settings/audio pane, mic test active, server menu, channel menu, confirm modal, invites modal, sticker manager, link dialog. Open `design_handoff_discord_redesign/Redesign.dc.html` section `1d` (+ the design-token tables) side-by-side in Chrome and compare: modal anatomy (452/648 widths, r16, header/close), menu anatomy (236px, caps label, separator, danger last), confirmation anatomy (300px, 40px danger-soft tile), toggle/select/slider/meter geometry. List every deviation with a ruling (adapted / defect-fix-now / defer-M6).

- [ ] **Step 4: Cross-surface regression gates** — `probe-chat.js` (repaired, throwing) for the chat column; `probe-sidebar.js` for the M1 shell; one call-surface smoke (`--fake-media --click .chat-voice-btn --after 9000 --out m4t11-stage.png` — M4 edited `CallUI.css`'s keyframe ref and `CallDock.tsx`'s class; the stage must still render and the dock button must still show its danger hover). Confirm the M2/M3 untouched-stylesheet argument the same way M3 did: enumerate which stylesheets M4 touched, show the deleted-class set has zero external consumers (Step 1's grep + Step 2's scan), and state that all keyframe names remain unique (`rg -c '@keyframes' src/` + name listing).

- [ ] **Step 5: Record for the closeout** — final lint total + per-file table; test totals; check:i18n **0 warnings**; the reasoned-not-measured list (expected: ErrorBoundary crash render, UpdateBanner/Electron, the no-servers «У меня есть код» branch, the call-notif probe if downgraded, `useModalFocus` restore-on-unmount edge when the trigger element left the DOM); smoke-server residue added by M4 probes (created invites, any sticker uploads); the carried-block lifecycle (T2→T8, T6→T7) with the enumerated violations at each stage; deviations vs board 1d; which dead keys were deleted vs kept-with-consumer.

- [ ] **Step 6: Commit** (only if fixes landed; otherwise no commit — the ledger records the sweep)

```bash
git add -u client/src
git commit -m "fix(redesign): M4 final-sweep fixes"   # only when non-empty; never git add -A
```

---

## Review provenance

This plan was reviewed by the Opus grand-reviewer before execution. Verdict: **"sound with revisions"** — the reviewer verified all 14 planning-time stylelint counts, every cited line number, the keyframe-consumer inventory, the consumed i18n/API/type shapes, and ran the plan's verbatim CSS through the real stylelint config. All findings are applied inline: **C1** (nested-modal Escape closed both Settings and its logout confirm — `useModalFocus` gained the module-level modal stack, decision 8 records the standard-stacking ruling, and the T6 probe now asserts Escape-on-nested-confirm keeps Settings open), **I1** (the context-menu `:disabled` rule measurably tripped `no-descending-specificity` after the `:hover:not(:disabled)` rule — reordered with an in-CSS comment), **I2** (the ConfirmModal focus-cycle assertion was unsatisfiable — replaced with the Shift+Tab/Tab boundary-wrap sequence, the only hook-driven moves with two focusables), **I3** (T10's Produces contradicted its Step 2 on the call-notif button classes — resolved: join = `call-notif-join btn btn-primary` layout-only, dismiss = `.modal-close-btn`, `call-notif-dismiss` dies and joins the T11 dead-name belt), **I4** (the mic-meter "≥2 distinct values" clause was a timing flake at the fake tone's 1%-rounding amplitude — replaced with the 0 → non-zero → 0 envelope), **M1** (both emoji regexes gained the `2B00–2BFF` block for ⬅️), **M2** (the T11 belt greps the whole `manage-invites-` prefix; T8's Produces names the `modal invites-modal` wrapper and its intended default width), **M3** (ruled board-wins: `server.editMenu` value changes to «Настройки сервера»/"Server settings" in T4, probe asserts the text — M3 `youSuffix` precedent), **M4** (T2's ledger enumerates the carried block's raw `#FFFFFF`), **M5** (phantom `find-server-form` removed from T5's Produces), **M6** (`window\.alert` spelled out in the T11 grep).

## Self-review notes (spec coverage)

Spec §5 M4 bullet → tasks: find-server merged one field (T5) · settings modal 186px nav + toggle/select/slider/level-meter + pinned danger «Выйти» covering profile/audio-NC/video/appearance (T2 primitives, T6 shell, T7 panes) · server & channel context menus (T4) · destructive confirmation reused app-wide (T3 hardening; swaps in T3/T4/T9) · manage invites, edit server/channel, create channel/server (T8) · sticker manager, avatar crop (T9) · update banner, error boundary strings into i18n (T10). §4.1 primitives-layer items (modal shell, context menu, toggle/select/slider/level-meter, kbd) → T2. M3-closeout M4 triage: dead `call.screenSharingActive` (T10) · primitives held-flat ownership (T2/T8, decision 5) · probe-chat repair (T1). M2-closeout M4 items: ConfirmModal autofocus/trap/restore/Esc (T3) · window.confirm sites (T4/T9) · ChannelSidebar/ServerList dedupe (T4). Human-ruled scope adds: LinkDialog + call-notif banner (T8/T10), live mic-test meter (T7), both logout affordances (T3/T6). Out of scope honored: no services/, no server/, no types, no e2e; backlog §1 untouched; token aliases untouched (additions only).



