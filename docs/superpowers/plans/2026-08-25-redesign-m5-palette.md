# Redesign M5 — Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship board `2c`'s ⌘K command palette — a 600px r16 dialog on the palette shadow with a search row, three scoped groups (channels → messages → actions), a footer hint bar and full keyboard navigation — scoped honestly to what the APIs can deliver, and restyle the surviving `MessageSearch` deep-search panel to the new system (8 stylelint problems → 0, every legacy alias gone, board `2a`'s empty state), with the palette's «показать все результаты» row handing its query off to that panel.

**Architecture:** Three new units and one measured constraint drive the whole design. (1) `utils/paletteFilter.ts` is a **pure** module — ranking, capping, group assembly and the flat selection index — and is the milestone's new vitest surface (spec §6 names palette filtering/grouping; it needs no jsdom). (2) `stores/paletteStore.ts` holds `isOpen` plus a **single command channel** for the two actions that cannot be lifted out of `ChatArea` (open the deep-search panel with a query; jump to a message). (3) `components/CommandPalette.tsx` renders inside `AppPage`'s root — a sibling of `.app-layout`, like `CallUI` — because **`.channel-sidebar` and `.chat-area` are `display: none` in ordinary states** (`AppPage.css:98,108-118,134`), so a globally-reachable palette cannot render inside either subtree, and any modal it opens must not live there either. That single measured fact is why `Settings` and `CreateChannelModal` are lifted from `ChannelSidebar` to `AppPage` (the M4 `FindServerModal` precedent), and why the command channel exists only for the chat surface. `primitives.css` reached 0 in M4 and is **not reopened**: the palette's two kbd chips compose `.kbd` with component-scoped overrides, which win ties by source order (M2 T1's standing fact, verified in dev *and* the production bundle).

**Tech Stack:** React 19 + Vite + Zustand + plain per-component CSS, lucide-react icons, vitest (node env — no jsdom; DOM behaviour is fail-first CDP-probe-verified), stylelint 17, CDP smoke harness.

**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` — §5's **M5 bullet** is the clause list this plan must satisfy; also binding: §2 (search UX — keep both), §3 (server-side constraints), §4.1 (styles layer), §4.4 (`paletteStore`), §6 (testing), §7 (out of scope). Pixel source of truth: `design_handoff_discord_redesign/README.md` §"4. Command palette (⌘K) — option `2c`" plus the Design-token tables, cross-read against the board markup at `Redesign.dc.html:99-125`. Also binding, and superseding older text wherever they disagree: `docs/superpowers/plans/2026-08-25-redesign-m4-closeout.md` (24 rulings, harness corrections, deferred-finding triage), `docs/superpowers/plans/2026-08-25-redesign-m3-closeout.md` (21 rulings), `docs/superpowers/plans/2026-08-25-redesign-m2-closeout.md` (17 rulings — decision 6 defers the header ⌘K chip and the full `MessageSearch` restyle to M5). `docs/superpowers/backlog/post-redesign-backlog.md` is **excluded scope**: nothing in its §1 is planned here; if a task brushes one of those items, record the contact and move on.

## Global Constraints

- Branch `redesign` only; **one commit per task**; never commit to `main`; **never** `git add -A` (`design_handoff_discord_redesign/` is untracked on purpose — stage explicit paths).
- No changes under `server/`; no API/WS contract changes; **no changes to `client/src/services/`**; `client/src/types/index.ts` untouched; `client/e2e/` untouched. Legacy token aliases in `src/styles/tokens.css` stay until M6 — **`tokens.css` changes are additions only** (verify `+N / −0` at close, so the LEGACY ALIASES block is provably untouched).
- All work under `client/`. Product copy is Russian; every new string lands in `src/i18n/locales/ru.ts` **and** `en.ts` together. `npx tsc --noEmit` is the **real** ru/en parity gate (`en` is typed against `ru`'s `Dictionary`). Plural strings render via `tp()`/`useTp()` — `t()` renders the literal key for plural entries.
- **`npm run check:i18n` is at ZERO warnings** (M4 took it 4 → 0) and must stay at zero. Its matcher, re-derived from `client/scripts/check-i18n.mjs` at planning time: it strips `//` and **single-line** `/* */` per line, then flags (1) JSX text nodes matching `(?<!=)>\s*([A-Za-zА-Яа-яЁё][^<>{}\n]{2,}?)\s*<` — **Latin text is flagged too, not only Cyrillic**; (2) `placeholder|title|aria-label|alt="literal"` in `.tsx` only; (3) `alert('literal')`/`confirm('literal')` anywhere. Two consequences bind every task: **a multi-line `/* */` block comment in a `.tsx` is a structural blind spot that trips the gate** (M4 hit it twice) — use `//` comments in `.tsx`; and **a JSX text node that follows a closing tag is still a text node** (`</b> навигация<` matches), so mixed glyph+word hints must be written as `<b …>↑↓</b> {t('…')}` with the word inside `t()`.
- Icons: lucide-react, `strokeWidth={1.8}`, 16–21px band. Board `2c` draws its row icons at stroke **1.9**; M5 ships 1.8 like every other surface (decision 20). Sizes outside the band inherit M3/M4's disclosed-deviation precedent and must each be recorded. No emoji as UI icons; no hand-inlined SVGs in touched code — `MessageSearch.tsx`'s **four** inline SVGs (`:124`, `:141`, `:146`, `:157`) die in Task 6.
- Animation budget ≤250ms ease-out. The palette reuses the existing global keyframes `fade-in` (overlay) and `modal-in` (dialog, 180ms opacity + 4px rise). **Add no new keyframe** — all 16 keyframe names in `client/src` are currently unique and M6 owns the `prefers-reduced-motion` pass (`base.css` already carries a blanket reduce block).
- **Test delta-gate.** `npm test` is RED by design: exactly 3 failures + 2 unhandled rejections, **all** in `src/services/__tests__/api.network-retry.test.ts`. Pre-M5 shape: `Test Files 1 failed | 22 passed (23)` · `Tests 3 failed | 149 passed (152)` · `Errors 2 errors`. **Task 2 adds test files and therefore changes this shape legitimately** (decision 12) — it must record the exact new shape, and every later task compares against *that*. The gate itself never changes: **the 3 `FAIL` lines must name only `api.network-retry.test.ts`, the passing count must only grow, and that file is never fixed.** A paste that says "same file" without the `FAIL` lines naming it **is not evidence**.
- **Stylelint delta-gate.** Total from `npm run lint:css` must never exceed **531**; current total **196** — record the exact number at every task boundary; it must only fall (M5's floor is 188: `MessageSearch.css`'s 8 die in Task 6). **Every file M5 creates or rewrites must be individually 0 problems**: `CommandPalette.css` (new), `MessageSearch.css` (rewritten). **No scheduled exceptions** — unlike M2/M4, M5 carries no legacy block. Stylelint **must run from `client/`** — `importFrom` is cwd-relative and a repo-root run crashes with `ENOENT`, **which is a crash, not a lint result**. `--formatter json` writes to **stderr** — pipe with `2>&1`, never `2>/dev/null`. Do **not** mass-fix legacy files (`tokens.css` 118, `ChannelSidebar.css` 23, `UserList.css` 16, `ServerList.css` 15, `Auth.css` 10, `AppPage.css` 4, `TitleBar.css` 2 are M6's).
- **Raw-value gate.** After each task, `rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' <file>` must return **zero rows, literally** for every M5-owned file (`CommandPalette.css`, `MessageSearch.css`). No sanctioned exception exists for this milestone.
- Class names: multi-segment kebab-case with a component prefix; state modifiers `is-*`/`has-*`; **never** BEM `--`/`__`. The singles allowlist is only `btn|input|kbd|modal|mention` (`.stylelintrc.json`). New CSS uses media-query **range syntax** (`(width <= 640px)`) — `media-feature-range-notation` requires it (M2 ruling 17's accepted iOS-Safari-<16.4 exposure; M6 resolves it).
- **Visual verification: the CDP harness is gitignored and there is exactly one copy.** `Task 1 copies it forward with `cp -R` from `.superpowers/sdd/2026-08-25-redesign-m4-modals/tools/` (31M). Corrections that override older plan texts: `--click` is `el.click()` inside `Runtime.evaluate` with **no user activation**; `--fake-media` fakes devices and auto-grants permission but **joins nothing**; `--after 6000` is unreliable for call surfaces (use 9000+); `--push-ws` is inert without `--preload tools/inject-voice-ws.js` and **cannot satisfy a guard that compares against live state**; `--focus-emulation` is **opt-in** and makes `document.hasFocus()` permanently true (never default it, never use it on a probe asserting blur/idle behaviour); `getComputedStyle(el, '::-webkit-slider-*')` returns the **host** box while author pseudos like `::before` resolve normally; `new Event('change')` does not bubble and React 18 delegates at the root, so synthesized events need `{ bubbles: true }`.
- **Harness flags, re-derived from `smoke.mjs` at planning time (not inherited from prose):** the real argument set is `--out <file.png>` (**the screenshot flag is `--out`, not `--shot`**), `--theme`, `--path`, `--wait`, `--anon`, `--click` + `--after` (default 1500ms), `--click2` + `--after2` (default 800ms), `--size`, `--touch`, `--fake-media`, `--focus-emulation`, `--fake-electron`, `--preload`, `--push-ws`, `--type-into` + `--type-text`, and `--probe` / `--probe2` / `--probe3`.
- **A failing probe does NOT make `smoke.mjs` exit non-zero.** `smoke.mjs:403` wraps the probe in `try { … } catch (e) { return 'PROBE ERROR: ' + e.message }`, so a thrown assertion is **printed**, not propagated: the run still exits 0. **Evidence is the printed output, never the exit code** — "fails loudly" means the transcript shows a `PROBE ERROR:` line naming the assertion, and "passes" means it shows the probe's returned JSON. Two further mechanics from the same call site: the probe file is evaluated as an **expression** (`(await (${probeSrc}))`), so it must be an IIFE or another expression, never a series of statements; and `--probe2`/`--probe3` run **after** `--probe`, each as its own `Runtime.evaluate`, which is the only way to spend more than one transient user activation.
- **`--type-into` dispatches `Enter` after typing** (`smoke.mjs:284`) and then sleeps 2500ms. That is right for the deep-search panel and **wrong for the palette**, where Enter activates the selected row: palette probes must type inside the probe body with the native-setter + `input` event pattern and no trailing Enter.
- **Before citing any probe, check that it can fail.** Two nominal gates in M4 could not: `probe-chat.js` (repaired at M4 T1, but the closeout still records two optional-chained descriptive fields with no `fail()` and continuation-row assertions that no-op on an empty list — re-read before trusting it) and `probe-server-menu.js` (dead from T8, repaired at T11). `probe-callstate.js` is **banned as evidence**. `probe-confirm-modal.js` has zero `throw`s. `probe-t5fix-handoff-focus.js:35` contains `… || true`, a field that cannot fail.
- **Fail-first probes (mandatory).** Every verification probe is written and run against the **pre-task** state first and must fail **loudly** there before its post-task pass is trusted. Assert the precondition, never assume it (M3 ruling P4): read which channel is open, read counts before asserting them. House pattern: `const fail = (m) => { throw new Error(m); };` with **every** assertion routed through it; `probe-screen-picker.js` is the reference implementation.
- **⌘K cannot be driven by `--click`.** Dispatch the keystroke instead: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }))`.
- Dev server: `cd client && npm run dev:vite` → `http://localhost:3000` **exactly** (production CORS allowlist; a 3001/3002 fallback fails login with a CORS error that looks like a bug and is not). **Kill stale servers** — two were found alive mid-M4, three at M3 start. **A dev server predating HEAD invalidates visual evidence**; compare its start time against HEAD's commit time. **Any task that edits a base-layer file restarts the server before probing** (M4 ruling PF-6: Vite HMR re-injects a changed file and can put the base layer *after* component CSS, inverting source-order tie-breaks).
- Test account `redesign_smoke@vycord.local` / `RedesignSmoke2026!`, throwaway server «Redesign Smoke» — the production API; destructive testing only there. **Residue accounting must cover every probe an invocation runs, not only the probe the task is about** (M4 under-recorded 10 messages that way).
- **Electron cannot launch** (`node_modules/electron/dist` is 292K; npm 11 skipped the postinstall). M5 touches nothing under `electron/`; any Electron-adjacent claim is recorded **reasoned-not-measured**.
- **The M3-era claim that `--fake-media`'s tone peaks at ~0.0065–0.0115 is measured FALSE** (M4 closeout): it is a full-scale periodic beep every ~450ms and that range is its decay tail. No brief may carry the 1%-rounding sentence forward. M5 touches no audio surface, so this only matters if a probe wanders onto one.

## Decisions ruled on while planning (binding for this milestone)

Every entry states what it costs if wrong.

1. **The three groups deliver exactly what the APIs allow, and each group header says so.** **КАНАЛЫ** = the current server only — a client-side filter over `useServerStore.channels`, which holds only the active server's list (spec §3); header «Каналы — этот сервер». **СООБЩЕНИЯ** = the current channel only — `apiService.searchMessages(channelId, q, limit, 0)` is per-channel (spec §3); header «Сообщения — в этом канале»; the group is **absent entirely** when `currentChannel` is null. **ДЕЙСТВИЯ** = a static client-side registry, each entry gated on real availability (decision 16). No cross-server fan-out (spec §7). **Cost if wrong:** a user searching for a channel on another server finds nothing and must switch servers first — the spec's stated trade, and the group header is what stops it being a silent lie.
2. **Board `2c`'s per-row server name is dropped from channel rows.** The board draws two rows with *different* server names (`gemroom`, `TESTING`), which is unreachable: `channels` holds one server's rows, so every row would print the same string, asserting a distinction that cannot exist — while the group header already states the scope (decision 1). Rows render icon + name. Recorded as a **board adaptation**, surfaced for the human. **Cost if wrong:** a thinner row than the board draws; re-adding a constant secondary is additive and costs one `<span>`.
3. **`paletteStore` is a new zustand store holding `isOpen` and one command channel — `query` and `results` stay component-local.** Spec §4.4's `{ isOpen, query, results }` is a conceptual shape, not a storage mandate: a per-keystroke write to a global store re-renders every subscriber and races the 120ms debounce, and `results` are derived. The store's real job is decoupling — the hotkey hook and any future opener call `open()` without prop drilling, and the chat command channel crosses a tree boundary that props cannot. **Cost if wrong:** a documented deviation from §4.4's literal wording; the observable behaviour is identical.
4. **`Settings` and `CreateChannelModal` are lifted from `ChannelSidebar` to `AppPage`. This is measured, not preference.** `AppPage.css:98` sets `.app-layout[data-left-sidebar="hidden"] .channel-sidebar { display: none }` and `:108-118` hides it on every mobile panel except `channels`; `display: none` on an ancestor removes the whole subtree, so a modal rendered inside `<nav class="channel-sidebar">` is **unreachable** in ordinary states — and `ChannelSidebar` additionally early-returns a **different** JSX branch when `server` is null (`ChannelSidebar.tsx:136-153`) that never renders `Settings` at all. A global palette that opens settings must therefore host settings outside that subtree. `AppPage` gains `settingsOpen` / `createChannelOpen` state and renders both modals beside `FindServerModal` (the M4 decision-4 precedent); `ChannelSidebar` gains `onOpenSettings` / `onCreateChannel` props and loses the two renders, the two state hooks and the two imports. **Cost if wrong:** two modals move one level up and `ChannelSidebar` gains two props; the alternative is a palette action that silently does nothing whenever the sidebar is hidden.
5. **The command channel exists only for the chat surface, and both chat commands share one shape.** `MessageSearch` needs `channel` and `ChatArea`'s local `jumpToMessage`/`historyMode`/`highlightedId`/`chatMessagesRef` — it cannot be lifted. So `paletteStore` carries `command: { kind: 'chat-search'; id; channelId; query } | { kind: 'chat-jump'; id; channelId; messageId } | null`. **Every other palette action is a direct callback** from `AppPage`, which owns the surface. Consumers clear the command by `id` **first**, then act, so re-entry is a no-op; a consumer whose `channel.id` differs from `command.channelId` clears and drops it (the user can switch channels between opening the palette and pressing ↵). **Cost if wrong:** one effect-driven channel instead of a request/ack prop pair on `ChatArea`, whose props interface already carries 9 entries (`ChatArea.tsx:44-54`) — the `MessageEditorProps` smell M2 recorded (16 props to consume 5).
6. **«Показать все результаты» opens the restyled `MessageSearch` for the current channel, prefilled.** `MessageSearch` gains `initialQuery?: string`; `ChatArea` renders it with `key={searchSeed?.id ?? 0}` so a **new** request remounts the panel on the new query instead of silently keeping the old one. The row renders only when the messages group has at least one row and `total > shown`. Before dispatching a chat command the palette calls `onShowChat()` so `AppPage` sets `mobilePanel: 'chat'` — `.chat-area` is `display: none` under `[data-mobile-panel="call"]` (`AppPage.css:134`), the same subtree hazard as decision 4. **Cost if wrong:** the panel opens empty and the user retypes.
7. **The chat header's search button keeps opening `MessageSearch`, and board `1c`'s dark-theme `⌘K` chip is NOT shipped on it.** Spec §2 (settled with the user) makes the deep panel "reachable from the chat header"; a `⌘K` chip on a control that does **not** open the ⌘K palette is a false label — the exact defect class M4 named as its dominant one. The palette advertises its own shortcut where board `2c` puts that copy: its footer («Открывается на ⌘K из любого места»). This closes M2 decision 6's deferral with an explicit answer rather than silence, and is **flagged for the human**: if the board owner wants that button to become the palette entry, it is a two-line JSX + CSS change and M6 owns it. **Cost if wrong:** one board detail unshipped in dark theme.
8. **⌘K/Ctrl+K is OPEN-ONLY and inert while ANY modal is open — and the modal stack alone cannot tell us that.** `hooks/useModalFocus.ts` gains `export function isBlockingOverlayOpen(): boolean`. The obvious implementation — read the existing module-level stack length — is **not enough**, because **only three components adopt that hook** (`ConfirmModal.tsx:19`, `FindServerModal.tsx:27`, `Settings.tsx:32` — app-wide adoption is M6's, per M4 ruling 13). `CreateChannelModal`, `EditChannelModal`, `EditServerModal`, `ManageInvitesModal`, `StickerManager`, `AvatarCropModal`, `LinkDialog` and `AppPage`'s inline create-server modal are **not** on the stack, so a stack-only gate would let ⌘K open the palette on top of all eight — including `CreateChannelModal`, which the palette itself opens. **Measured escape hatch:** every one of those surfaces renders a `.modal-overlay` element (grep-verified across all ten modal components plus `AppPage.tsx`'s inline modal), so `isBlockingOverlayOpen()` is `modalStack.length > 0 || document.querySelector('.modal-overlay') !== null`. The DOM half also delivers open-only by construction — the palette's own overlay carries `.modal-overlay`, so no separate "already open" flag is needed. The predicate is `(e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK'` — **`e.code`, not `e.key`**, because the product UI is Russian and a Cyrillic layout reports `e.key === 'л'` for that physical key (`ChatArea.tsx:221` already uses `e.code` for Ctrl+Shift+F). `preventDefault()` fires **on chord match, before the gate**, so a gated ⌘K does not fall through to the browser's address-bar shortcut in the web build. **Cost if wrong:** ⌘K no-ops while any modal is open — the expected behaviour; a stack-only gate would instead have stacked a palette over eight modals while the plan claimed it could not.
9. **The four non-stack-aware document Escape listeners are enumerated from grep, and one Escape closing both is accepted and disclosed.** The live set is `ContextMenu.tsx:35`, `VolumeControlPopover.tsx:57`, `ScreenSharePicker.tsx:24` **and** `:88` (two listeners in one file), and `useFloatingSelectionToolbar.ts:67` — **five registrations across four files; the fourth file is not in any earlier prose and was found by grep, not inherited.** None consults the modal stack. The palette's overlay covers the viewport, so none of them can be *opened* while it is open; the reverse (⌘K over an already-open popover) is reachable, and Escape then closes the palette **and** the popover underneath. Ruled: accepted — all five guard transient overlays whose dismissal alongside the palette matches intent, and making them stack-aware means editing four M1/M3-owned files for no user-visible gain. M6 already owns app-wide `useModalFocus` adoption (M4 ruling 13). **Cost if wrong:** one Escape dismisses a transient popover the user might have wanted kept.
10. **`.palette-overlay` sits at `z-index: 1150`.** The **complete** measured map, every entry re-derived by grep rather than sampled: `.message-search` 20 · `.modal-overlay` 1000 (`primitives.css:342`) · `.p2p-overlay` 1000 · `.context-menu` **1050** (`primitives.css:637`) · `.screen-share-picker` **1100** (`ScreenSharePicker.css:5`) · `.volume-popover` **1100** (`VolumeControlPopover.css:14`) · `.stage-tip` 1200 · `.error-toast` 2000 (`primitives.css:729`) · `.call-notif-banner` 2000 · `.update-banner` / `.error-boundary` 9999. Reusing `.modal-overlay` unchanged would let an already-open context menu paint **over** the palette; **1100 would tie two live popovers and leave the outcome to DOM order**, so the value is 1150 — above the context menu and both popovers, below `.stage-tip`'s tooltip, the error toast, the incoming-call banner and the crash screen, all of which must stay visible over a palette. The palette composes `.modal-overlay` (scrim, blur, `fade-in`) and overrides exactly three declarations in its own file — `z-index`, `align-items: flex-start`, `padding` — which win by source order (M2 T1's standing fact, proven in dev **and** in `dist/`), so no `!important` and no specificity fight. **Cost if wrong:** the palette paints under a context menu or a volume popover.
11. **`Ctrl+Shift+F` becomes overlay-aware in the same milestone.** `ChatArea.tsx:219-228` toggles `MessageSearch` from a document listener; with the palette — or any modal — open it would toggle the panel *behind* the overlay. Gate it on `!isBlockingOverlayOpen()`, the same predicate as ⌘K (decision 8), so the two global chords cannot drift apart. One line in a file M5 already edits. **Cost if wrong:** a keystroke behaves exactly as it does today.
12. **Filtering/grouping/selection is a pure module and IS the milestone's new vitest surface.** `src/utils/paletteFilter.ts` + colocated `paletteFilter.test.ts` (the `utils/` idiom: `callStage.test.ts`, `messageGroups.test.ts`, `avatarColor.test.ts`, `inviteExpiry.test.ts`, `voiceMembership.test.ts`), plus `src/utils/searchSnippet.ts` + `searchSnippet.test.ts` (decision 13) and `src/stores/__tests__/paletteStore.test.ts` for the command-id contract. All are pure and node-testable — **M4 decision 23's reason not to add a vitest surface (jsdom absent, env is `node`) does not apply**, and spec §6 explicitly names "palette filtering/grouping". **Cost if wrong:** three new test files to maintain; the flat-index navigation model is the subtlest logic in the milestone and would otherwise be probe-only.
13. **`snippetAround` and match-splitting move out of `MessageSearch.tsx` into `utils/searchSnippet.ts` — moved, never duplicated.** Both search surfaces need them; copying ~25 lines across two surfaces is the drift that made M4 build `ServerMenu` (decision 14 there). Task 5 performs the move and re-imports at the original call site, so no duplicate ever exists. **The extraction fixes a latent infinite loop:** `MessageSearch.tsx:45-51`'s `for(;;) { const idx = lower.indexOf(q, pos); … pos = idx + q.length }` never advances when `q` is `''` (`indexOf('')` returns `pos`), so an empty query would hang the tab. It is unreachable today (both call sites gate on ≥2 characters) but the extracted pure function guards it and a unit test pins it. **Cost if wrong:** one more small util file; the alternative is two copies of a function with a latent hang.
14. **Selection is one flat index over rows only; group labels are not selectable; ↑↓ wrap.** Selection resets to `0` whenever the row list changes (query edit, debounced results arriving). `↵` activates, `esc` closes, hover sets the selection. Wrapping is not board-specified — chosen because every shipping palette wraps and a hard stop on a three-row list reads as broken. It is one branch in a unit-tested pure function. **Cost if wrong:** a keyboard nuance, changeable in one line with a test.
15. **Caps: channels 6, messages 5, actions 7 — and message truncation is never silent.** `CAP_ACTIONS` is **7, the exact size of the full registry** (decision 16), so an empty query can never silently drop an action; the cap exists only as a guard for a future registry that outgrows the list. The messages group carries the show-all row whenever `total > shown`, which is where board `2c` puts the overflow affordance. Channel and action truncation has no board affordance; the query narrows it, and the caps are **recorded here rather than hidden** (M4's "no silent caps" rule). **Cost if wrong:** a seventh matching channel needs one more typed character.
16. **Action registry: seven actions, all wired to existing flows, and no logout. Six land in Task 4; the seventh lands in Task 5** because «Искать в канале» dispatches a chat command and needs the command channel Task 5 introduces. «Создать канал» (needs `currentServer` **and** `can(permissions, PERMISSIONS.MANAGE_CHANNELS)` — the exact predicate at `ChannelSidebar.tsx:72`) · «Войти в голосовой «{channel}»» (needs `currentChannel`; hidden when `callChannelId === currentChannel.id`) · «Открыть настройки» (always) · «Включить тёмную/светлую тему» (reads `themeStore`, shows the *other* theme) · «Создать сервер» (always) · «Найти сервер» (always) · «Искать в канале #{channel}» (needs `currentChannel`; the persistent deep-search entry). **«Выйти» is deliberately absent** — a one-keystroke logout behind a fuzzy match is the wrong affordance, and Settings already hosts it behind `ConfirmModal`. **Cost if wrong:** one action fewer; adding one is a registry entry plus two i18n keys.
17. **Matching is `toLocaleLowerCase()` substring with prefix ranking — no fuzzy matcher, no `ё`/`е` folding.** Prefix matches rank above substring matches; ties keep source order (channels keep `position`, actions keep registry order). No new dependency. `ё`/`е` normalisation is **not** done and is recorded: a user typing «е» will not match «Ёлка». **Cost if wrong:** one class of Russian near-miss; the fold is three lines in a unit-tested pure function whenever someone wants it.
18. **Message queries are gated at 2–100 characters because the server enforces it.** `server/internal/delivery/http/handler/message.go:124` rejects `q` under 2 or over 100 runes with `400 CodeSearchQueryLength`. The palette fires the messages request only at `trimmed.length >= 2` (identical to `MessageSearch`'s `MIN_QUERY_LEN`) and the input carries `maxLength={100}`. **Cost if wrong:** a guaranteed 400 on every one-character keystroke.
19. **Debounce is 120ms in the palette and stays 300ms in `MessageSearch`** — board `2c` specifies 120ms; the deep panel paginates a committed query. They differ on purpose and each carries a `//` comment saying so. A superseded response is **discarded, not cancelled** — `services/api.ts` has no `AbortController` anywhere (M4 closeout) and M5 may not add one; the effect's `cancelled` flag drops the late response, the pattern `MessageSearch.tsx:85-105` already uses. Say "discarded" in the closeout, not "cancelled". **Cost if wrong:** more in-flight requests per keystroke burst than the wording implies, bounded by the 2-rune gate and the 120ms debounce.
20. **Icon strokes are 1.8, against board `2c`'s 1.9.** The board draws the palette's row icons at `stroke-width: 1.9`; spec §4.2 and every shipped surface since M0 use 1.8. Consistency wins; recorded as an **adapted** deviation so M6 inherits a decision rather than a breach. Sizes: magnifier 19 (search row), row icons 17, both inside the 16–21 band. **Cost if wrong:** a sub-pixel stroke difference on one surface.
21. **Two new tokens for the match highlight, with dark values, additions only.** `--hl-bg: #FEF3C7` / `--hl-ink: #101322` in `:root`; `--hl-bg: rgb(245 158 11 / 28%)` / `--hl-ink: #FDF3DC` in `[data-theme="dark"]`, both marked refine-in-M6. **The `mark` rule must set background *and* colour**: in dark `--ink` is `#E4E7F0` and would be unreadable on a light amber. A token with no dark value is already an M6 finding class (`--danger`); M5 does not add another. Both search surfaces use the same pair, so the palette snippet and the panel highlight identically. Modern colour notation — legacy `rgba()` commas trip three lint rules each. **Cost if wrong:** two tokens M6's naming pass may merge.
22. **The palette's two kbd chips compose `.kbd`; `primitives.css` is not reopened.** Board `2c`'s `esc` chip is `--chip-bg`, mono 11px/600, `--muted-2`, padding `3px 8px`, **no border**; `.kbd` (M4-owned, file at 0) is `--chip-bg` with `1px solid var(--line)`, padding `2px 6px`, `--muted`. The `↵ открыть` chip is `--canvas` on `--accent-border` in `--accent`. Both ship as `.kbd.palette-esc` / `.kbd.palette-enter` — (0,2,0) beats (0,1,0), so no ordering hazard and no `!important`. `primitives.css` reached 0 in M4 after being held flat since M2; **M5 creates no shared recipe and does not touch that file.** **Cost if wrong:** three override declarations per chip instead of a second primitive — the right trade for a single-consumer surface.
23. **`MessageSearch`'s restyle is a rewrite to 0, and board `2a`'s suggestion chips are dropped.** `MessageSearch.css` 8 → 0, tokens only; the three hand-inlined SVGs become lucide (`Search` 17 header, `X` 14 clear, `X` 16 close — the 14 is below the band and is recorded as a disclosed deviation, M3 precedent); the header input adopts the `.input` primitive; the hand-rolled avatar div adopts the `Avatar` component **for dedupe only** — `Avatar` renders its `<img>` branch only when a `url` prop is passed (`Avatar.tsx:23`) and `MessageWithAuthor` carries no avatar URL (`types/index.ts:70-72`), so both surfaces will always render the initial fallback; the swap removes a duplicate, it does not gain an image branch, and **the closeout must not claim otherwise**. Board `2a`'s empty state ships as **title + body** (new key `chat.nothingFoundTitle: 'Ничего не нашлось'` above the existing `chat.nothingFound`, closing M2's combined-string adaptation) **without** suggestion chips, because nothing in the client can suggest a query. **Cost if wrong:** one board element unshipped; there is no data to fill it.
24. **The rewrite retires alias references the backlog assigned to M6 — record it, so M6's inventory stays true.** `MessageSearch.css` currently consumes `--bg-primary`, `--bg-secondary`, `--bg-hover`, `--bg-tertiary`, `--border-color`, `--text-primary`, `--text-secondary`, `--text-muted` (`:46,:67` are named in the backlog), `--brand-color`, `--brand-subtle`, `--brand-100`, `--red-color`, `--radius-md`, `--radius-sm`, `--radius-full`. All go. M4 recorded the same for `ErrorBoundary.css` / `UpdateBanner.css` ("M6's sweep loses two files"); M5's closeout records the third. `@keyframes message-search-spin` is an infinite loop and stays a target for M6's `prefers-reduced-motion` pass. **Cost if wrong:** M6 hunts for aliases that are already gone.
25. **The palette adds a new caller of `handleSelectChannel` and inherits backlog §1c unchanged.** A channel opened from the palette runs the same `AppPage.handleSelectChannel`, so a **rejected** message fetch still paints the previous channel's list (backlog §1c, `AppPage.tsx:546-547`). M5 introduces neither the path nor the bug and does not fix it — backlog §1 is excluded scope. Recorded so a reviewer does not mis-attribute it to M5. **Cost if wrong:** none — this is a disclosure.
26. **The palette input suppresses its `:focus-visible` outline.** `base.css:60-63` gives every `:focus-visible` a 2px accent outline; board `2c`'s search row has none — the accent caret is the focus signal. The input is auto-focused, is the only text field inside the trap, and `outline: none` is scoped to `.palette-input:focus-visible` alone. Result rows are `role="option"` divs driven by `aria-activedescendant` (decision 27), so no focusable element inside the palette loses a ring. **Cost if wrong:** one redundant focus cue on an auto-focused sole input.
27. **Palette a11y is combobox + listbox, not a list of buttons.** The dialog is `role="dialog" aria-modal="true"` with `aria-label={t('palette.title')}`; the input is `role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={selected row id}`; the list is `role="listbox" id="palette-list"`; rows are `role="option" id={`palette-row-${index}`} aria-selected`. This keeps `useModalFocus`'s Tab trap on a single focusable (the input) instead of cycling fifteen rows, and it is the standard palette pattern. **M5 does not fix M4's parked accessible-name gap in the primitives recipes** — that stays M6's, at the recipe. **Cost if wrong:** a new surface ships correct semantics while inherited ones stay M6's problem.
28. **Rebase check, not rebase.** Spec §8 wants a rebase on `main` at each milestone boundary; `main` has not moved (`git log redesign..main` empty, verified at plan time). Task 1 re-verifies and records it; **if it is not empty, STOP and surface.** **Cost if wrong:** none — it is a check.
29. **A chat command issued while the call stage is fullscreen lands in a hidden chat area. Accepted and disclosed.** `AppPage.css:67-72` hides `.chat-area` under `.channel-body:has(.call-stage.is-fullscreen)` and `:has(.stage-focus-main.is-fullscreen)` — the same `display: none` class of fact that drives decisions 4 and 6, but on the **desktop** fullscreen path, where `onShowChat()` does nothing because `mobilePanel` is not what hides the column. Ruled accepted rather than fixed: exiting fullscreen from a palette command would reach into M3's fullscreen state machine — the subtlest logic in that milestone, with an Electron half that is reasoned-not-measured (M3 rulings 14/16) — for a state the user entered deliberately. The palette still opens and its channel/action rows still work; only the two chat commands are swallowed. **No probe may claim otherwise**, and the closeout carries it to M6 with the fullscreen deferrals it already owns. **Cost if wrong:** a user in fullscreen presses ↵ on a message result and nothing visible happens until they exit fullscreen.

## File structure after M5

```
client/src/
  components/
    CommandPalette.tsx/.css   (new: palette-* — board 2c; the only new component)
    MessageSearch.tsx/.css    (rewritten: tokens+lucide+.input+Avatar, initialQuery, board 2a empty state)
    ChatArea.tsx              (modified: chat-search/chat-jump consumer, searchSeed key, stack-aware Ctrl+Shift+F,
                               snippet helpers re-imported from utils/searchSnippet)
    ChannelSidebar.tsx        (modified: Settings + CreateChannelModal renders/state/imports REMOVED;
                               new props onOpenSettings, onCreateChannel)
  hooks/
    useModalFocus.ts          (modified: + isBlockingOverlayOpen() export; no behaviour change)
    usePaletteHotkey.ts       (new: global ⌘K/Ctrl+K listener, open-only, modal-stack-gated)
  stores/
    paletteStore.ts           (new: isOpen + the chat command channel)
    __tests__/paletteStore.test.ts (new)
  utils/
    paletteFilter.ts          (new: pure rank/cap/group/select; the flat selection model)
    paletteFilter.test.ts     (new)
    searchSnippet.ts          (new: snippetAround + splitMatches, MOVED out of MessageSearch.tsx)
    searchSnippet.test.ts     (new)
  styles/
    tokens.css                (modified: + --hl-bg, --hl-ink in both themes; NO alias changes)
  pages/
    AppPage.tsx               (modified: hosts CommandPalette + usePaletteHotkey; owns settingsOpen /
                               createChannelOpen and renders Settings + CreateChannelModal)
  i18n/locales/ru.ts + en.ts  (new `palette` section; + chat.nothingFoundTitle)
```

Untouched by design: `styles/primitives.css` (0 since M4 — decision 22), `styles/base.css`, every other component, every store other than the new one.

---

### Task 1: Workspace, harness carry-forward, tokens, baselines

**Files:**
- Modify: `client/src/styles/tokens.css` (additions only — two lines in `:root`, two in `[data-theme="dark"]`)
- Not in git: milestone workspace + harness copy

**Interfaces:**
- Produces: `--hl-bg` / `--hl-ink` tokens (decision 21); a carried-forward `tools/` directory; recorded pre-M5 baselines (lint total, per-file counts, test shape, `check:i18n` = 0, BEFORE screenshots); a written probe-capability audit.

- [ ] **Step 1: Preserve the harness — it is the only copy**

```bash
cd /Users/nm/Projects/experiments/vycord
mkdir -p .superpowers/sdd/2026-08-25-redesign-m5-palette/tools
cp -R .superpowers/sdd/2026-08-25-redesign-m4-modals/tools/. .superpowers/sdd/2026-08-25-redesign-m5-palette/tools/
ls .superpowers/sdd/2026-08-25-redesign-m5-palette/tools/smoke.mjs   # must exist
du -sh .superpowers/sdd/2026-08-25-redesign-m5-palette/tools/         # ~31M
```

- [ ] **Step 2: Probe-capability audit — write it down before anyone cites a probe**

Record, in the task report, the known-unusable set (M4 closeout, "Probes flagged for anyone reusing them"):

- `probe-callstate.js` — inert, **banned as evidence**.
- `probe-confirm-modal.js` — stale M2 residue, dead selectors, **zero `throw`**.
- `probe-t5fix-handoff-focus.js:35` — `composerSendsOnEnter = … || true`, a field that cannot fail.
- `probe-t11-flow.js` — `toastPresent` queries the deleted `.chat-error-toast`, permanently false.
- `probe-chat.js` — a real gate since M4 T1, **but** two descriptive fields are read with optional chaining and no `fail()`, and its continuation-row assertions no-op on an empty list. If M5 cites it as the cross-surface regression gate, re-read those lines first and state what they cover.

Then confirm the one probe M5 will lean on hardest can fail, by inverting one expectation and re-running:

```bash
cd .superpowers/sdd/2026-08-25-redesign-m5-palette/tools
rg -c 'fail\(' probe-screen-picker.js    # reference implementation: every assertion thrown, none recorded.
#   The M3-era prose says "15 assertions"; the file today has 22. Re-derive counts, never inherit them —
#   that is the same "assert a fact from surrounding idiom" defect M4 named as its dominant class.
```

- [ ] **Step 3: Verify branch state and `main` drift (decision 28)**

```bash
cd /Users/nm/Projects/experiments/vycord
git rev-parse --abbrev-ref HEAD     # must be: redesign
git log --oneline redesign..main    # must be EMPTY; if not, STOP and surface
git status --short                  # only `?? design_handoff_discord_redesign/`
```

- [ ] **Step 4: Add the two highlight tokens**

In `client/src/styles/tokens.css`, inside `:root`'s `/* ── Lines & surfaces ── */` group, immediately after the `--track-bg` line:

```css
  --hl-bg:  #FEF3C7; /* board 2c: search-match highlight (palette + deep panel) */
  --hl-ink: #101322; /* readable ink ON --hl-bg; the mark rule must set both */
```

In the `[data-theme="dark"]` block, immediately after the `--track-bg` line:

```css
  --hl-bg:  rgb(245 158 11 / 28%); /* refine in M6 */
  --hl-ink: #FDF3DC;               /* refine in M6 */
```

Modern colour notation on purpose (M3/M4 precedent: legacy `rgba()` commas trip three lint rules each). **Do not touch the LEGACY ALIASES block.**

- [ ] **Step 5: Record every baseline (all commands from `client/`)**

```bash
cd client
npm run lint:css 2>&1 | tail -3                       # expect: 196 problems
npx stylelint src/styles/tokens.css 2>&1 | tail -2    # run BEFORE and AFTER the edit — must not gain (118)
npx stylelint src/components/MessageSearch.css 2>&1 | tail -2   # expect 8
npx stylelint src/styles/primitives.css 2>&1 | tail -2          # expect 0 — M5 must never change this
git diff --numstat src/styles/tokens.css              # must read: 4  0  (additions only)
npx tsc --noEmit                                      # clean
npm test 2>&1 | tail -20                              # RED shape, FAIL lines must name api.network-retry only
npm run check:i18n                                    # ZERO warnings, exit 0 — record verbatim
```

Record the exact `Test Files` / `Tests` / `Errors` lines — Task 2 changes them legitimately and every later task compares against Task 2's numbers, not these.

- [ ] **Step 6: BEFORE screenshots (fresh dev server, port 3000)**

```bash
pgrep -fl "vite" || true            # kill anything stale first
cd client && npm run dev:vite &     # must bind 3000 exactly
cd ../.superpowers/sdd/2026-08-25-redesign-m5-palette/tools
node smoke.mjs --out before-m5-chat-light.png --wait 4000
node smoke.mjs --theme dark --out before-m5-chat-dark.png --wait 4000
node smoke.mjs --click .chat-search-btn --after 1200 --out before-m5-search-light.png
node smoke.mjs --theme dark --click .chat-search-btn --after 1200 --out before-m5-search-dark.png
```

Flag names were re-derived from `smoke.mjs`'s parser at planning time (Global Constraints) — `--out`, not `--shot`. If anything still differs, read the parser and record the correction rather than guessing; the M3 and M4 closeouts each had to correct an inherited harness description.

- [ ] **Step 7: Commit**

```bash
cd /Users/nm/Projects/experiments/vycord
git add client/src/styles/tokens.css
git commit -m "chore(redesign): M5 T1 — highlight tokens, harness carried forward, baselines recorded"
```

---

### Task 2: `paletteFilter` + `searchSnippet` + `paletteStore` (pure, TDD)

**Files:**
- Create: `client/src/utils/paletteFilter.ts`, `client/src/utils/paletteFilter.test.ts`
- Create: `client/src/stores/paletteStore.ts`, `client/src/stores/__tests__/paletteStore.test.ts`
- Test: the two files above (`searchSnippet` lands in Task 5 with its first consumer — see decision 13)

**Interfaces:**
- Produces, consumed by Tasks 3–5:
  - `PALETTE_MIN_QUERY = 2`, `PALETTE_MAX_QUERY = 100`, `PALETTE_DEBOUNCE_MS = 120`, `CAP_CHANNELS = 6`, `CAP_MESSAGES = 5`, `CAP_ACTIONS = 7`
  - `rankByName<T>(items: T[], query: string, nameOf: (item: T) => string, cap: number): T[]`
  - `buildPalette(input: PaletteInput): PaletteModel`
  - `moveSelection(current: number, delta: number, rowCount: number): number`
  - types `PaletteRow`, `PaletteGroup`, `PaletteModel`, `PaletteInput`, `PaletteActionDef`
  - `usePaletteStore` with `{ isOpen, command, open, close, searchInChannel, jumpToMessage, clearCommand }`

- [ ] **Step 1: Write the failing tests for `paletteFilter`**

Create `client/src/utils/paletteFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  rankByName, buildPalette, moveSelection,
  CAP_CHANNELS, PALETTE_MIN_QUERY, type PaletteActionDef,
} from './paletteFilter';
import type { Channel } from '@/types';

const ch = (id: string, name: string, position = 0): Channel => ({
  id, name, position, server_id: 's',
  created_at: '2026-08-25T12:00:00Z', updated_at: '2026-08-25T12:00:00Z',
});

const action = (id: string, label: string): PaletteActionDef =>
  ({ id, label, run: () => {} });

describe('rankByName', () => {
  // Все три имени кириллические намеренно: запрос 'ген' не совпал бы с латинским
  // "general" — toLocaleLowerCase не транслитерирует, и фикстура молча
  // развалила бы тест на ранжирование.
  const items = [ch('1', 'общий'), ch('2', 'генерал'), ch('3', 'разговоры-генерал')];

  it('returns every item, capped, for an empty query', () =>
    expect(rankByName(items, '', (c) => c.name, 2).map((c) => c.id)).toEqual(['1', '2']));

  it('is case-insensitive', () =>
    expect(rankByName(items, 'ОБЩ', (c) => c.name, 6).map((c) => c.id)).toEqual(['1']));

  it('ranks a prefix match above a substring match', () =>
    expect(rankByName(items, 'ген', (c) => c.name, 6).map((c) => c.id)).toEqual(['2', '3']));

  it('keeps source order inside the same rank', () =>
    expect(rankByName(items, 'р', (c) => c.name, 6).map((c) => c.id)).toEqual(['3', '2']));

  it('returns nothing when nothing matches', () =>
    expect(rankByName(items, 'zzz', (c) => c.name, 6)).toEqual([]));

  it('never returns more than the cap', () =>
    expect(rankByName(items, '', (c) => c.name, CAP_CHANNELS).length).toBeLessThanOrEqual(CAP_CHANNELS));
});

describe('buildPalette', () => {
  const base = {
    channels: [ch('1', 'общий'), ch('2', 'генерал')],
    actions: [action('a', 'Создать канал')],
    messages: [],
    messagesTotal: 0,
    hasChannel: true,
    messagesLoading: false,
    messagesError: null,
  };

  it('orders groups channels → messages → actions', () => {
    const model = buildPalette({
      ...base, query: 'ген',
      // Действие должно совпадать с тем же запросом, иначе группа действий
      // пуста и порядок групп проверяется на двух из трёх.
      actions: [action('a', 'Войти в голосовой «генерал»')],
      messages: [{ id: 'm1', username: 'a', content: 'генерал?', created_at: '2026-08-25T12:00:00Z' }],
      messagesTotal: 1,
    });
    expect(model.groups.map((g) => g.key)).toEqual(['channels', 'messages', 'actions']);
  });

  it('omits the messages group below the minimum query length', () => {
    const model = buildPalette({ ...base, query: 'г'.repeat(PALETTE_MIN_QUERY - 1) });
    expect(model.groups.map((g) => g.key)).not.toContain('messages');
  });

  it('omits the messages group when no channel is open', () => {
    const model = buildPalette({ ...base, query: 'ген', hasChannel: false });
    expect(model.groups.map((g) => g.key)).not.toContain('messages');
  });

  it('omits an empty group entirely', () => {
    const model = buildPalette({ ...base, query: 'zzz' });
    expect(model.groups).toEqual([]);
    expect(model.rows).toEqual([]);
  });

  it('adds a show-all row only when the total exceeds what is shown', () => {
    const shown = { id: 'm1', username: 'a', content: 'ген', created_at: '2026-08-25T12:00:00Z' };
    const few = buildPalette({ ...base, query: 'ген', messages: [shown], messagesTotal: 1 });
    const many = buildPalette({ ...base, query: 'ген', messages: [shown], messagesTotal: 9 });
    expect(few.rows.some((r) => r.kind === 'show-all')).toBe(false);
    expect(many.rows.some((r) => r.kind === 'show-all')).toBe(true);
  });

  it('gives each group a `from` index that indexes into the flat row list', () => {
    const model = buildPalette({ ...base, query: 'ген' });
    for (const group of model.groups) {
      group.rows.forEach((row, i) => expect(model.rows[group.from + i]).toBe(row));
    }
  });

  it('renders a loading row instead of results while messages are in flight', () => {
    const model = buildPalette({ ...base, query: 'ген', messagesLoading: true });
    const messages = model.groups.find((g) => g.key === 'messages');
    expect(messages?.rows.map((r) => r.kind)).toEqual(['status']);
    expect(model.rows.some((r) => r.kind === 'status')).toBe(false); // status rows are not selectable
  });

  it('renders an error row when the message search failed', () => {
    const model = buildPalette({ ...base, query: 'ген', messagesError: 'Нет доступа' });
    const messages = model.groups.find((g) => g.key === 'messages');
    expect(messages?.rows[0]).toEqual({ kind: 'status', id: 'messages-error', text: 'Нет доступа' });
  });
});

describe('moveSelection', () => {
  it('wraps past the last row', () => expect(moveSelection(2, 1, 3)).toBe(0));
  it('wraps before the first row', () => expect(moveSelection(0, -1, 3)).toBe(2));
  it('moves normally in between', () => expect(moveSelection(0, 1, 3)).toBe(1));
  it('clamps to 0 on an empty list', () => expect(moveSelection(0, 1, 0)).toBe(0));
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd client && npx vitest run src/utils/paletteFilter.test.ts
```

Expected: FAIL — `Failed to resolve import "./paletteFilter"`.

- [ ] **Step 3: Implement `paletteFilter.ts`**

Create `client/src/utils/paletteFilter.ts`:

```ts
import type { Channel } from '@/types';

// Board 2c: query debounce 120ms. The deep panel (MessageSearch) stays at 300ms
// on purpose — it paginates a committed query, the palette previews one.
export const PALETTE_DEBOUNCE_MS = 120;
// Server-enforced: server/internal/delivery/http/handler/message.go:124 rejects
// a query under 2 or over 100 runes with 400 CodeSearchQueryLength.
export const PALETTE_MIN_QUERY = 2;
export const PALETTE_MAX_QUERY = 100;
export const CAP_CHANNELS = 6;
export const CAP_MESSAGES = 5;
// 7 = ровно размер полного реестра действий (решение 16), чтобы пустой запрос
// никогда молча не отбрасывал действие (решение 15).
export const CAP_ACTIONS = 7;

export interface PaletteActionDef {
  id: string;
  label: string;
  run: () => void;
}

export interface PaletteMessage {
  id: string;
  username: string;
  content: string;
  created_at: string;
}

export type PaletteRow =
  | { kind: 'channel'; id: string; channel: Channel }
  | { kind: 'message'; id: string; message: PaletteMessage }
  | { kind: 'action'; id: string; action: PaletteActionDef }
  | { kind: 'show-all'; id: 'show-all' }
  // Status rows render inside a group but are NOT selectable and never enter `rows`.
  | { kind: 'status'; id: string; text: string };

export type PaletteGroupKey = 'channels' | 'messages' | 'actions';

export interface PaletteGroup {
  key: PaletteGroupKey;
  /** Flat index of this group's first SELECTABLE row. */
  from: number;
  rows: PaletteRow[];
}

export interface PaletteModel {
  groups: PaletteGroup[];
  /** Selectable rows in render order; the array index IS the selection index. */
  rows: PaletteRow[];
}

export interface PaletteInput {
  query: string;
  channels: Channel[];
  actions: PaletteActionDef[];
  messages: PaletteMessage[];
  messagesTotal: number;
  hasChannel: boolean;
  messagesLoading: boolean;
  messagesError: string | null;
}

function normalise(value: string): string {
  // Никакой ё/е-нормализации (решение 17): осознанный пробел, а не забытый случай.
  return value.toLocaleLowerCase();
}

export function rankByName<T>(
  items: T[],
  query: string,
  nameOf: (item: T) => string,
  cap: number,
): T[] {
  const q = normalise(query.trim());
  if (!q) return items.slice(0, cap);
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const item of items) {
    const name = normalise(nameOf(item));
    if (name.startsWith(q)) prefix.push(item);
    else if (name.includes(q)) substring.push(item);
  }
  return [...prefix, ...substring].slice(0, cap);
}

export function buildPalette(input: PaletteInput): PaletteModel {
  const {
    query, channels, actions, messages, messagesTotal,
    hasChannel, messagesLoading, messagesError,
  } = input;
  const trimmed = query.trim();

  const channelRows: PaletteRow[] = rankByName(channels, trimmed, (c) => c.name, CAP_CHANNELS)
    .map((channel) => ({ kind: 'channel', id: `channel-${channel.id}`, channel }));

  const actionRows: PaletteRow[] = rankByName(actions, trimmed, (a) => a.label, CAP_ACTIONS)
    .map((action) => ({ kind: 'action', id: `action-${action.id}`, action }));

  const messageRows: PaletteRow[] = [];
  const wantsMessages = hasChannel && trimmed.length >= PALETTE_MIN_QUERY;
  if (wantsMessages) {
    if (messagesError) {
      messageRows.push({ kind: 'status', id: 'messages-error', text: messagesError });
    } else if (messagesLoading) {
      messageRows.push({ kind: 'status', id: 'messages-loading', text: '' });
    } else {
      for (const message of messages.slice(0, CAP_MESSAGES)) {
        messageRows.push({ kind: 'message', id: `message-${message.id}`, message });
      }
      if (messageRows.length > 0 && messagesTotal > messageRows.length) {
        messageRows.push({ kind: 'show-all', id: 'show-all' });
      }
    }
  }

  const groups: PaletteGroup[] = [];
  const rows: PaletteRow[] = [];
  const push = (key: PaletteGroupKey, groupRows: PaletteRow[]) => {
    if (groupRows.length === 0) return;
    groups.push({ key, from: rows.length, rows: groupRows });
    rows.push(...groupRows.filter((row) => row.kind !== 'status'));
  };
  push('channels', channelRows);
  push('messages', messageRows);
  push('actions', actionRows);

  return { groups, rows };
}

export function moveSelection(current: number, delta: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return (((current + delta) % rowCount) + rowCount) % rowCount;
}
```

> Note the `from`/`rows` contract: `from` is the flat index of the group's first **selectable** row, and a `status` row never enters `rows`. A group whose only row is a status row therefore renders with `from` pointing at the next group's first row — which is harmless because the renderer only computes `group.from + i` for non-status rows. The unit test "gives each group a `from` index…" runs on a status-free model and is the gate on that arithmetic.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd client && npx vitest run src/utils/paletteFilter.test.ts
```

Expected: PASS, **18 tests** (6 `rankByName` + 8 `buildPalette` + 4 `moveSelection`). If the count differs, one of them is not running — count the `it()` blocks rather than trusting this number.

- [ ] **Step 5: Write the failing store test**

Create `client/src/stores/__tests__/paletteStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { usePaletteStore } from '../paletteStore';

describe('paletteStore', () => {
  beforeEach(() => usePaletteStore.setState({ isOpen: false, command: null }));

  it('opens and closes', () => {
    usePaletteStore.getState().open();
    expect(usePaletteStore.getState().isOpen).toBe(true);
    usePaletteStore.getState().close();
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it('stamps each command with a fresh id', () => {
    usePaletteStore.getState().searchInChannel('c1', 'баг');
    const first = usePaletteStore.getState().command;
    usePaletteStore.getState().searchInChannel('c1', 'баг');
    const second = usePaletteStore.getState().command;
    expect(first?.id).not.toBe(second?.id);
  });

  it('carries the channel id and payload', () => {
    usePaletteStore.getState().jumpToMessage('c1', 'm9');
    expect(usePaletteStore.getState().command).toMatchObject({
      kind: 'chat-jump', channelId: 'c1', messageId: 'm9',
    });
  });

  it('clears only the command whose id matches', () => {
    usePaletteStore.getState().searchInChannel('c1', 'a');
    const stale = usePaletteStore.getState().command!.id;
    usePaletteStore.getState().searchInChannel('c1', 'b');
    usePaletteStore.getState().clearCommand(stale);
    expect(usePaletteStore.getState().command).not.toBeNull();
    usePaletteStore.getState().clearCommand(usePaletteStore.getState().command!.id);
    expect(usePaletteStore.getState().command).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
cd client && npx vitest run src/stores/__tests__/paletteStore.test.ts
```

Expected: FAIL — `Failed to resolve import "../paletteStore"`.

- [ ] **Step 7: Implement `paletteStore.ts`**

Create `client/src/stores/paletteStore.ts`:

```ts
import { create } from 'zustand';

// Канал команд существует ТОЛЬКО для двух действий чат-поверхности: панель
// MessageSearch и jumpToMessage живут внутри ChatArea и не поднимаются наверх
// (им нужны channel + локальный historyMode/highlightedId/ref). Всё остальное
// палитра вызывает прямыми колбэками AppPage — см. решение 5.
export type PaletteCommand =
  | { kind: 'chat-search'; id: number; channelId: string; query: string }
  | { kind: 'chat-jump'; id: number; channelId: string; messageId: string };

interface PaletteState {
  isOpen: boolean;
  command: PaletteCommand | null;
  open: () => void;
  close: () => void;
  searchInChannel: (channelId: string, query: string) => void;
  jumpToMessage: (channelId: string, messageId: string) => void;
  /** Снимает команду, только если это всё ещё она: потребитель не должен
   *  затирать более новую команду, пришедшую между рендером и эффектом. */
  clearCommand: (id: number) => void;
}

let nextCommandId = 1;

export const usePaletteStore = create<PaletteState>((set) => ({
  isOpen: false,
  command: null,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  searchInChannel: (channelId, query) =>
    set({ command: { kind: 'chat-search', id: nextCommandId++, channelId, query } }),
  jumpToMessage: (channelId, messageId) =>
    set({ command: { kind: 'chat-jump', id: nextCommandId++, channelId, messageId } }),
  clearCommand: (id) => set((state) => (state.command?.id === id ? { command: null } : state)),
}));
```

- [ ] **Step 8: Run the full gate set and record the NEW test shape**

```bash
cd client
npx vitest run src/stores/__tests__/paletteStore.test.ts   # PASS, 4 tests
npx tsc --noEmit                                           # clean
npm test 2>&1 | tail -20
```

Expected new shape: `Test Files 1 failed | 24 passed (25)` · `Tests 3 failed | 171 passed (174)` · `Errors 2 errors` — that is 149 + 18 + 4 — with the 3 `FAIL` lines naming **only** `src/services/__tests__/api.network-retry.test.ts`. **Record the exact numbers**; they are the baseline for Tasks 3–8. If the passing count differs because a test was added or split, record what you actually got — the gate is the FAIL lines and a non-decreasing pass count, not a magic number.

```bash
npm run lint:css 2>&1 | tail -3   # still 196 — no CSS touched
npm run check:i18n                # ZERO warnings
```

- [ ] **Step 9: Commit**

```bash
cd /Users/nm/Projects/experiments/vycord
git add client/src/utils/paletteFilter.ts client/src/utils/paletteFilter.test.ts \
        client/src/stores/paletteStore.ts client/src/stores/__tests__/paletteStore.test.ts
git commit -m "feat(redesign): M5 T2 — pure palette filter/grouping model + paletteStore (TDD)"
```

---

### Task 3: Palette shell, ⌘K hotkey, channels group

**Files:**
- Create: `client/src/components/CommandPalette.tsx`, `client/src/components/CommandPalette.css`
- Create: `client/src/hooks/usePaletteHotkey.ts`
- Modify: `client/src/hooks/useModalFocus.ts` (add `isBlockingOverlayOpen()`; no behaviour change)
- Modify: `client/src/pages/AppPage.tsx` (render the palette, call the hotkey hook)
- Modify: `client/src/i18n/locales/ru.ts`, `client/src/i18n/locales/en.ts` (new `palette` section)

**Interfaces:**
- Consumes: `buildPalette`, `moveSelection`, `PALETTE_MAX_QUERY`, `PaletteRow`, `PaletteActionDef` (Task 2); `usePaletteStore` (Task 2).
- Produces: `isBlockingOverlayOpen(): boolean` from `hooks/useModalFocus`; `usePaletteHotkey(): void`; `CommandPalette` with props `{ onSelectChannel: (channel: Channel) => void }` — Task 4 widens this prop list, Task 5 adds the messages group.

- [ ] **Step 1: Add `isBlockingOverlayOpen()` to `useModalFocus.ts`**

At the end of `client/src/hooks/useModalFocus.ts`, after the hook:

```ts
/** Открыт ли сейчас блокирующий оверлей. Нужен глобальным хоткеям: ⌘K не
 *  должен открывать палитру поверх модалки (решение 8), а Ctrl+Shift+F —
 *  переключать панель поиска под оверлеем (решение 11).
 *
 *  Двойная проверка не избыточна. Стек знает только про адоптеров хука — а это
 *  ровно ConfirmModal, FindServerModal и Settings; остальные восемь модалок
 *  приложения к нему не подключены (адоптация app-wide — за M6, ruling 13 M4).
 *  Зато `.modal-overlay` рисуют ВСЕ, включая саму палитру, — что заодно даёт
 *  «только открывает» без отдельного флага. */
export function isBlockingOverlayOpen(): boolean {
  return modalStack.length > 0 || document.querySelector('.modal-overlay') !== null;
}
```

Nothing else in that file changes — the hook's logic, its comments and its mount-order caveat stay byte-identical.

- [ ] **Step 2: Write the hotkey hook**

Create `client/src/hooks/usePaletteHotkey.ts`:

```ts
import { useEffect } from 'react';
import { usePaletteStore } from '@/stores/paletteStore';
import { isBlockingOverlayOpen } from '@/hooks/useModalFocus';

// Board 2c: ⌘K/Ctrl+K ОТКРЫВАЕТ, esc закрывает. Не тумблер: открытая палитра
// сама рисует .modal-overlay, поэтому второй ⌘K гасится тем же гейтом.
// e.code, а не e.key: интерфейс русский, при кириллической раскладке эта
// физическая клавиша приходит как 'л' (ChatArea уже использует e.code).
export function usePaletteHotkey(): void {
  const open = usePaletteStore((s) => s.open);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.code !== 'KeyK') return;
      // preventDefault ДО гейта: иначе заглушённый ⌘K в вебе провалится
      // в адресную строку браузера.
      e.preventDefault();
      if (isBlockingOverlayOpen()) return;
      open();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
}
```

- [ ] **Step 3: Add the `palette` i18n section (ru + en together)**

In `client/src/i18n/locales/ru.ts`, add a top-level section after `sidebar`:

```ts
  palette: {
    title: 'Быстрый переход',
    placeholder: 'Каналы, сообщения, действия…',
    esc: 'esc',
    groupChannels: 'Каналы — этот сервер',
    groupMessages: 'Сообщения — в этом канале',
    groupActions: 'Действия',
    enterOpen: 'открыть',
    navHint: 'навигация',
    selectHint: 'выбрать',
    globalHintBefore: 'Открывается на',
    globalHintAfter: 'из любого места',
    searching: 'Ищем…',
    showAll: 'Показать все результаты',
    empty: 'Ничего не найдено по запросу «{{query}}»',
    createChannel: 'Создать канал',
    joinVoice: 'Войти в голосовой «{{channel}}»',
    openSettings: 'Открыть настройки',
    themeDark: 'Включить тёмную тему',
    themeLight: 'Включить светлую тему',
    createServer: 'Создать сервер',
    findServer: 'Найти сервер',
    searchInChannel: 'Искать в канале #{{channel}}',
  },
```

The mirror in `client/src/i18n/locales/en.ts`, same position:

```ts
  palette: {
    title: 'Quick jump',
    placeholder: 'Channels, messages, actions…',
    esc: 'esc',
    groupChannels: 'Channels — this server',
    groupMessages: 'Messages — this channel',
    groupActions: 'Actions',
    enterOpen: 'open',
    navHint: 'navigate',
    selectHint: 'select',
    globalHintBefore: 'Opens with',
    globalHintAfter: 'from anywhere',
    searching: 'Searching…',
    showAll: 'Show all results',
    empty: 'Nothing found for “{{query}}”',
    createChannel: 'Create channel',
    joinVoice: 'Join voice in “{{channel}}”',
    openSettings: 'Open settings',
    themeDark: 'Switch to dark theme',
    themeLight: 'Switch to light theme',
    createServer: 'Create server',
    findServer: 'Find server',
    searchInChannel: 'Search in #{{channel}}',
  },
```

There is deliberately **no** "nothing found in this channel" key: `buildPalette` omits an empty group entirely, so a message-less result set falls through to `palette.empty` — a key with no render path is the dead-key hygiene M4 spent a whole task reversing. **Report note for this task:** about ten of these keys (`searching`, `showAll`, `joinVoice`, the action labels, `searchInChannel`) are consumed only in Tasks 4–5. That is deliberate — ru and en land together in one commit — but if the milestone is abandoned after Task 3, they are orphans; say so in the task report so a later `rg` sweep has the context.

Group labels are stored in sentence case and uppercased by CSS (`text-transform: uppercase`), so translators never hand-shout. `esc`, `↑↓`, `↵` and `⌘K` are glyph/keycap literals: `esc` **must** be a key because `check:i18n` flags Latin JSX text nodes of 3+ characters; the arrow glyphs are not letters and are safe as literals inside `<b>`.

- [ ] **Step 4: Write `CommandPalette.tsx`**

Create `client/src/components/CommandPalette.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Search } from 'lucide-react';
import type { Channel } from '@/types';
import { useT } from '@/i18n';
import { useServerStore } from '@/stores/serverStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import {
  buildPalette, moveSelection, PALETTE_MAX_QUERY,
  type PaletteActionDef, type PaletteRow,
} from '@/utils/paletteFilter';
import './CommandPalette.css';

interface CommandPaletteProps {
  onSelectChannel: (channel: Channel) => void;
}

export function CommandPalette({ onSelectChannel }: CommandPaletteProps) {
  const t = useT();
  const isOpen = usePaletteStore((s) => s.isOpen);
  const close = usePaletteStore((s) => s.close);
  const channels = useServerStore((s) => s.channels);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useModalFocus(isOpen, dialogRef, close);

  // Каждое открытие — чистая палитра.
  useEffect(() => {
    if (isOpen) { setQuery(''); setSelected(0); }
  }, [isOpen]);

  const actions: PaletteActionDef[] = useMemo(() => [], []); // Task 4 наполняет реестр

  const model = useMemo(
    () => buildPalette({
      query,
      channels,
      actions,
      messages: [],
      messagesTotal: 0,
      hasChannel: false,
      messagesLoading: false,
      messagesError: null,
    }),
    [query, channels, actions],
  );

  // Список поменялся — выделение всегда возвращается на первую строку.
  useEffect(() => { setSelected(0); }, [model.rows.length, query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`#palette-row-${selected}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!isOpen) return null;

  const activate = (row: PaletteRow) => {
    if (row.kind === 'channel') { close(); onSelectChannel(row.channel); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => moveSelection(i, 1, model.rows.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => moveSelection(i, -1, model.rows.length)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const row = model.rows[selected];
      if (row) activate(row);
    }
    // Escape обрабатывает useModalFocus (стек модалок), здесь не дублируем.
  };

  const groupLabel = { channels: 'palette.groupChannels', messages: 'palette.groupMessages', actions: 'palette.groupActions' } as const;

  return (
    <div className="modal-overlay palette-overlay" onClick={close}>
      <div
        ref={dialogRef}
        className="palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="palette-search">
          <Search size={19} strokeWidth={1.8} className="palette-search-icon" />
          <input
            className="palette-input"
            type="text"
            role="combobox"
            aria-expanded={model.rows.length > 0}
            aria-controls="palette-list"
            aria-activedescendant={model.rows.length ? `palette-row-${selected}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder')}
            maxLength={PALETTE_MAX_QUERY}
            data-autofocus
          />
          <span className="kbd palette-esc">{t('palette.esc')}</span>
        </div>

        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {model.groups.map((group) => (
            <div className="palette-group" key={group.key}>
              <div className="palette-group-label">{t(groupLabel[group.key])}</div>
              {group.rows.map((row, i) => {
                if (row.kind === 'status') {
                  return <div className="palette-status" key={row.id}>{row.text}</div>;
                }
                const index = group.from + i;
                const isSelected = index === selected;
                return (
                  <div
                    key={row.id}
                    id={`palette-row-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`palette-row${isSelected ? ' is-selected' : ''}`}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => activate(row)}
                  >
                    {row.kind === 'channel' && (
                      <>
                        <Hash size={17} strokeWidth={1.8} className="palette-row-icon" />
                        <span className="palette-row-name">{row.channel.name}</span>
                        {isSelected && (
                          <span className="kbd palette-enter">↵ {t('palette.enterOpen')}</span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {model.rows.length === 0 && query.trim() && (
            <div className="palette-empty">{t('palette.empty', { query: query.trim() })}</div>
          )}
        </div>

        <div className="palette-footer">
          <span className="palette-hint"><b className="palette-key">↑↓</b> {t('palette.navHint')}</span>
          <span className="palette-hint"><b className="palette-key">↵</b> {t('palette.selectHint')}</span>
          <span className="palette-hint palette-hint-end">
            {t('palette.globalHintBefore')} <b className="palette-key">⌘K</b> {t('palette.globalHintAfter')}
          </span>
        </div>
      </div>
    </div>
  );
}
```

Two `check:i18n` traps this markup deliberately avoids: every word-bearing text node is a `{t(…)}` expression (a literal after `</b>` would be flagged), and every comment is `//` (a multi-line `/* */` block in a `.tsx` is unstripped and would be flagged).

- [ ] **Step 5: Write `CommandPalette.css` — board `2c` geometry, tokens only**

Create `client/src/components/CommandPalette.css`:

```css
/* ═══ Command palette (board 2c) — 600px dialog, r16, palette shadow ═══
   Оверлей переиспользует .modal-overlay (скрим, blur, fade-in) и меняет ровно
   три декларации. z-index 1150, а не 1000: .context-menu лежит на 1050 и иначе
   рисовался бы поверх палитры, а 1100 занято — .screen-share-picker и
   .volume-popover (решение 10). Компонентный CSS выигрывает у базового слоя по
   порядку источника — доказано в dev и в dist (M2 T1). */
.palette-overlay {
  align-items: flex-start;
  padding: 12vh 16px 16px;
  z-index: 1150;
}

.palette-dialog {
  display: flex;
  flex-direction: column;
  width: min(600px, 100%);
  overflow: hidden;
  background: var(--canvas);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-palette);
  animation: modal-in 0.18s var(--ease-out);
}

/* ═══ Search row ═══ */
.palette-search {
  display: flex;
  gap: 11px;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}

.palette-search-icon {
  flex-shrink: 0;
  color: var(--muted-2);
}

.palette-input {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 15px;
  font-weight: 400;
  color: var(--ink);
  background: none;
  border: none;
  outline: none;
  caret-color: var(--accent);
}

.palette-input::placeholder {
  color: var(--faint);
}

/* Кольцо фокуса снято намеренно (решение 26): поле автофокусное и
   единственное внутри ловушки, сигнал фокуса — акцентная каретка. */
.palette-input:focus-visible {
  outline: none;
}

.kbd.palette-esc {
  flex-shrink: 0;
  padding: 3px 8px;
  font-weight: 600;
  color: var(--muted-2);
  border: none;
}

/* ═══ Results ═══ */
.palette-list {
  max-height: min(52vh, 420px);
  padding: 10px 8px 12px;
  overflow-y: auto;
}

.palette-group-label {
  padding: 14px 12px 6px;
  font-size: var(--fs-group);
  font-weight: 700;
  letter-spacing: var(--ls-group);
  color: var(--muted-2);
  text-transform: uppercase;
}

.palette-group:first-child .palette-group-label {
  padding-top: 8px;
}

.palette-row {
  display: flex;
  gap: 11px;
  align-items: center;
  padding: 9px 12px;
  border-radius: var(--radius-btn);
  cursor: pointer;
}

.palette-row.is-selected {
  background: var(--accent-soft);
}

.palette-row-icon {
  flex-shrink: 0;
  color: var(--muted-2);
}

.palette-row.is-selected .palette-row-icon {
  color: var(--accent);
}

.palette-row-name {
  overflow: hidden;
  font-size: var(--fs-label);
  font-weight: 600;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-row.is-selected .palette-row-name {
  font-weight: 700;
}

.kbd.palette-enter {
  flex-shrink: 0;
  margin-left: auto;
  padding: 3px 8px;
  font-weight: 600;
  color: var(--accent);
  background: var(--canvas);
  border-color: var(--accent-border);
}

.palette-status,
.palette-empty {
  padding: 9px 12px;
  font-size: 13px;
  color: var(--muted);
}

/* ═══ Footer hint bar ═══ */
.palette-footer {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 10px 18px;
  background: var(--canvas-3);
  border-top: 1px solid var(--line);
}

.palette-hint {
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--muted-2);
}

.palette-hint-end {
  margin-left: auto;
}

.palette-key {
  font-family: var(--font-mono);
  color: var(--muted);
}

@media (width <= 640px) {
  .palette-overlay {
    padding: 8vh 12px 12px;
  }

  .palette-list {
    max-height: 60vh;
  }
}
```

The footer is `--canvas-3` (`#FBFCFE`), not `--canvas-2` (`#F6F7FB`): the handoff's token table writes `canvas-2` as `#F6F7FB / #FBFCFE` and M0 split them into two tokens; board `2c`'s footer is the second value.

- [ ] **Step 6: Mount the palette in `AppPage`**

In `client/src/pages/AppPage.tsx`, add the imports:

```tsx
import { CommandPalette } from '@/components/CommandPalette';
import { usePaletteHotkey } from '@/hooks/usePaletteHotkey';
```

Call the hook next to the other top-level hooks in the component body:

```tsx
  usePaletteHotkey();
```

And render the palette as a sibling of `.app-layout`, immediately before `<CallUI />` at the end of the returned tree:

```tsx
      <CommandPalette onSelectChannel={handleSelectChannel} />
      <CallUI />
```

It must **not** go inside `.app-layout`'s children — `.channel-sidebar` and `.chat-area` are `display: none` in ordinary states (`AppPage.css:98,108-118,134`), and a palette inside either subtree would vanish with it.

- [ ] **Step 7: Write the fail-first probe**

Create `tools/probe-palette-shell.js` in the M5 workspace. It must throw on every missed assertion:

```js
(async () => {
  const fail = (m) => { throw new Error(m); };
  const q = (sel) => document.querySelector(sel);

  if (q('.palette-dialog')) fail('palette already open before ⌘K');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));

  const dialog = q('.palette-dialog') ?? fail('⌘K did not open .palette-dialog');
  const cs = getComputedStyle(dialog);
  const box = dialog.getBoundingClientRect();
  if (Math.round(box.width) !== 600) fail(`dialog width ${box.width}, expected 600`);
  if (cs.borderRadius !== '16px') fail(`dialog radius ${cs.borderRadius}, expected 16px`);
  if (!cs.boxShadow.includes('22px')) fail(`dialog shadow ${cs.boxShadow}, expected the 0 22px 50px palette shadow`);

  const overlay = q('.palette-overlay') ?? fail('no .palette-overlay');
  const oz = Number(getComputedStyle(overlay).zIndex);
  // Строго больше 1100: 1050 — .context-menu, 1100 — .screen-share-picker и
  // .volume-popover. Ничья разрешалась бы порядком в DOM, а это не гарантия.
  if (!(oz > 1100)) fail(`overlay z-index ${oz}, must exceed the 1100 popover tier (решение 10)`);

  const row = q('.palette-search') ?? fail('no .palette-search');
  const rcs = getComputedStyle(row);
  if (rcs.padding !== '16px 18px') fail(`search padding ${rcs.padding}, expected 16px 18px`);
  if (rcs.columnGap !== '11px') fail(`search gap ${rcs.columnGap}, expected 11px`);

  const input = q('.palette-input') ?? fail('no .palette-input');
  if (document.activeElement !== input) fail('palette input is not focused on open');
  if (input.maxLength !== 100) fail(`maxLength ${input.maxLength}, expected 100`);

  const esc = q('.palette-esc') ?? fail('no esc chip');
  const ecs = getComputedStyle(esc);
  if (ecs.padding !== '3px 8px') fail(`esc padding ${ecs.padding}, expected 3px 8px`);
  if (ecs.borderTopWidth !== '0px') fail(`esc chip has a border (${ecs.borderTopWidth}); board 2c has none`);

  // Каналы: выделение, ↵-чип, стрелки, wrap.
  const rows = [...document.querySelectorAll('.palette-row')];
  if (rows.length < 2) fail(`expected ≥2 channel rows on the smoke server, got ${rows.length}`);
  if (!rows[0].classList.contains('is-selected')) fail('first row is not selected on open');
  if (!rows[0].querySelector('.palette-enter')) fail('selected row has no ↵ chip');
  const selBg = getComputedStyle(rows[0]).backgroundColor;
  if (selBg === getComputedStyle(rows[1]).backgroundColor) fail('selected row is not tinted differently');

  const press = (key) => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  press('ArrowDown');
  await new Promise((r) => setTimeout(r, 60));
  if (!document.querySelectorAll('.palette-row')[1].classList.contains('is-selected')) fail('ArrowDown did not move the selection');
  for (let i = 0; i < rows.length; i++) press('ArrowDown');
  await new Promise((r) => setTimeout(r, 60));
  if (!document.querySelectorAll('.palette-row')[1].classList.contains('is-selected')) fail('selection did not wrap');

  // ⌘K не тумблер и инертен при открытой модалке (решение 8).
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  if (!q('.palette-dialog')) fail('second ⌘K closed the palette — it must be open-only');

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  if (q('.palette-dialog')) fail('Escape did not close the palette');

  return { verdict: 'palette shell OK', rows: rows.length };
})()
```

- [ ] **Step 8: Prove the probe fails against the pre-task state, then passes**

```bash
cd /Users/nm/Projects/experiments/vycord
git stash                       # back to the pre-task tree
cd client && npm run dev:vite & sleep 6
cd ../.superpowers/sdd/2026-08-25-redesign-m5-palette/tools
node smoke.mjs --probe probe-palette-shell.js --wait 4000
#   ^ MUST print `PROBE ERROR: ⌘K did not open .palette-dialog`. The run still exits 0 —
#     read the printed output, never the exit code (Global Constraints).
cd /Users/nm/Projects/experiments/vycord && git stash pop
# restart the dev server (HMR does not reorder injected <style> tags), then:
node smoke.mjs --probe probe-palette-shell.js --wait 4000 --out m5t3-palette-light.png   # prints the probe's JSON
node smoke.mjs --theme dark --probe probe-palette-shell.js --wait 4000 --out m5t3-palette-dark.png
```

- [ ] **Step 9: Gates**

```bash
cd client
npx stylelint src/components/CommandPalette.css 2>&1 | tail -2      # MUST be 0 problems
npm run lint:css 2>&1 | tail -3                                     # still 196
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/CommandPalette.css   # ZERO rows
npx stylelint src/styles/primitives.css 2>&1 | tail -2              # still 0, still untouched
npx tsc --noEmit && npm test 2>&1 | tail -20                        # Task 2's shape, FAIL lines named
npm run check:i18n                                                  # ZERO warnings
```

- [ ] **Step 10: Commit**

```bash
cd /Users/nm/Projects/experiments/vycord
git add client/src/components/CommandPalette.tsx client/src/components/CommandPalette.css \
        client/src/hooks/usePaletteHotkey.ts client/src/hooks/useModalFocus.ts \
        client/src/pages/AppPage.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): M5 T3 — ⌘K palette shell + channels group on board 2c geometry"
```

---

### Task 4: Actions group, and the modal lift out of `ChannelSidebar`

**Files:**
- Modify: `client/src/pages/AppPage.tsx` (own `settingsOpen` / `createChannelOpen`; render `Settings` + `CreateChannelModal`; pass six action callbacks to the palette)
- Modify: `client/src/components/ChannelSidebar.tsx` (delete both modal renders, both state hooks, both imports; add `onOpenSettings` / `onCreateChannel` props)
- Modify: `client/src/components/CommandPalette.tsx` (the action registry)

**Interfaces:**
- Consumes: `CommandPalette` (Task 3), `PaletteActionDef` (Task 2).
- Produces: `CommandPalette` props `{ onSelectChannel, onOpenSettings, onCreateChannel, onCreateServer, onFindServer }`; `ChannelSidebar` props `onOpenSettings: () => void`, `onCreateChannel: () => void`.

- [ ] **Step 1: Lift `Settings` and `CreateChannelModal` into `AppPage`**

In `client/src/pages/AppPage.tsx`, add imports and state:

```tsx
import { Settings } from '@/components/Settings';
import { CreateChannelModal } from '@/components/CreateChannelModal';
```

```tsx
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
```

Render them beside `FindServerModal`, outside `.app-layout`:

```tsx
      <Settings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onLogout={handleLogout} />

      {createChannelOpen && currentServer && (
        <CreateChannelModal serverId={currentServer.id} onClose={() => setCreateChannelOpen(false)} />
      )}
```

- [ ] **Step 2: Strip them out of `ChannelSidebar`**

In `client/src/components/ChannelSidebar.tsx`:

- Delete `import { Settings } from '@/components/Settings';` and `import { CreateChannelModal } from '@/components/CreateChannelModal';`
- Delete `const [settingsOpen, setSettingsOpen] = useState(false);` and `const [creatingChannel, setCreatingChannel] = useState(false);`
- Delete the `<Settings … />` render (`:307`) and the `{creatingChannel && <CreateChannelModal … />}` render (`:355`)
- Add to the props interface and destructuring: `onOpenSettings: () => void;` and `onCreateChannel: () => void;`
- Replace `setSettingsOpen(true)` at the footer settings button (`:291`) with `onOpenSettings()`
- Replace `setCreatingChannel(true)` with `onCreateChannel()`. There is **exactly one** call site — the group-header "+" button at `ChannelSidebar.tsx:187`, inside the `canManageChannels` guard at `:182`. No context-menu item creates a channel; do not go looking for one.

`npx tsc --noEmit` is the proof that no site was missed: `noUnusedLocals` turns a leftover import or state binding into a compile error.

Wire the new props at the `<ChannelSidebar …>` call site in `AppPage.tsx`:

```tsx
          onOpenSettings={() => setSettingsOpen(true)}
          onCreateChannel={() => setCreateChannelOpen(true)}
```

- [ ] **Step 3: Build the action registry in `CommandPalette.tsx`**

Replace the `actions` placeholder from Task 3. New imports:

```tsx
import { Hash, Moon, Plus, Search, Settings as SettingsIcon, Sun, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallStore } from '@/stores/callStore';
import { useThemeStore } from '@/stores/themeStore';
import { can, PERMISSIONS } from '@/utils/permissions';
```

Widen the props:

```tsx
interface CommandPaletteProps {
  onSelectChannel: (channel: Channel) => void;
  onOpenSettings: () => void;
  onCreateChannel: () => void;
  onCreateServer: () => void;
  onFindServer: () => void;
  onJoinVoice: (channel: Channel) => void;
}
```

Read the gating state and build the registry:

```tsx
  const currentServer = useServerStore((s) => s.currentServer);
  const currentChannel = useServerStore((s) => s.currentChannel);
  const permissions = useServerStore((s) => (s.currentServer ? s.permissions.get(s.currentServer.id) : undefined));
  const callChannelId = useCallStore((s) => s.callChannelId);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // Иконки живут рядом с реестром: paletteFilter — чистый модуль и ничего не
  // знает про React (решение 12).
  const actionIcons: Record<string, ReactNode> = {
    'create-channel': <Plus size={17} strokeWidth={1.8} className="palette-row-icon" />,
    'join-voice': <Volume2 size={17} strokeWidth={1.8} className="palette-row-icon" />,
    'open-settings': <SettingsIcon size={17} strokeWidth={1.8} className="palette-row-icon" />,
    theme: theme === 'dark'
      ? <Sun size={17} strokeWidth={1.8} className="palette-row-icon" />
      : <Moon size={17} strokeWidth={1.8} className="palette-row-icon" />,
    'create-server': <Plus size={17} strokeWidth={1.8} className="palette-row-icon" />,
    'find-server': <Search size={17} strokeWidth={1.8} className="palette-row-icon" />,
  };

  const canManageChannels = can(permissions, PERMISSIONS.MANAGE_CHANNELS);
  const actions: PaletteActionDef[] = useMemo(() => {
    const defs: PaletteActionDef[] = [];
    if (currentServer && canManageChannels) {
      defs.push({ id: 'create-channel', label: t('palette.createChannel'), run: onCreateChannel });
    }
    if (currentChannel && callChannelId !== currentChannel.id) {
      defs.push({
        id: 'join-voice',
        label: t('palette.joinVoice', { channel: currentChannel.name }),
        run: () => onJoinVoice(currentChannel),
      });
    }
    defs.push({ id: 'open-settings', label: t('palette.openSettings'), run: onOpenSettings });
    defs.push({
      id: 'theme',
      label: theme === 'dark' ? t('palette.themeLight') : t('palette.themeDark'),
      run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    });
    defs.push({ id: 'create-server', label: t('palette.createServer'), run: onCreateServer });
    defs.push({ id: 'find-server', label: t('palette.findServer'), run: onFindServer });
    return defs;
  }, [t, currentServer, canManageChannels, currentChannel, callChannelId, theme,
      onCreateChannel, onJoinVoice, onOpenSettings, setTheme, onCreateServer, onFindServer]);
```

Extend `activate` and the row renderer:

```tsx
  const activate = (row: PaletteRow) => {
    if (row.kind === 'channel') { close(); onSelectChannel(row.channel); }
    else if (row.kind === 'action') { close(); row.action.run(); }
  };
```

```tsx
                    {row.kind === 'action' && (
                      <>
                        {actionIcons[row.action.id]}
                        <span className="palette-row-name palette-row-action">{row.action.label}</span>
                      </>
                    )}
```

Add to `CommandPalette.css` (board `2c` renders action labels at 600 and their icons in `--muted`, one step darker than the `--muted-2` channel hashes). **Placement is load-bearing — insert the icon rule between the `.palette-row-icon` base rule and the `.is-selected` override, not at the end of the file:**

```css
/* Иконка действия на полтона темнее иконки канала (board 2c: #5A6178 против
   #8A90A2). Селектор именно :has(): иконка стоит в разметке ПЕРЕД лейблом,
   поэтому `.palette-row-action ~ .palette-row-icon` не совпал бы никогда.
   Правило живёт МЕЖДУ базовым .palette-row-icon (0,1,0) и .is-selected
   (0,3,0): оно само (0,3,0), так что порядок остаётся неубывающим
   (no-descending-specificity), а выделенная строка действия получает
   --accent так же, как выделенный канал. */
.palette-row:has(.palette-row-action) .palette-row-icon {
  color: var(--muted);
}
```

and, at the label:

```css
.palette-row-action {
  font-weight: 600;
}
```

`:has()` is already sanctioned in this codebase (`AppPage.css:61-70`, `CallStage.css`). **Verify the ordering with the gate, not by eye:** `npx stylelint src/components/CommandPalette.css` must stay at 0 — `no-descending-specificity` buckets by key selector, and all three rules here share the key `.palette-row-icon`. That rule has been miscited three times on this branch (M2 ruling, M3, M4 T2-b); measure, do not copy a justification.

- [ ] **Step 4: Pass the callbacks from `AppPage`**

```tsx
      <CommandPalette
        onSelectChannel={handleSelectChannel}
        onOpenSettings={() => setSettingsOpen(true)}
        onCreateChannel={() => setCreateChannelOpen(true)}
        onCreateServer={() => { setShowCreateServer(true); setCreateServerError(''); }}
        onFindServer={() => setFindServerOpen(true)}
        onJoinVoice={handleJoinVoice}
      />
```

- [ ] **Step 5: Write the fail-first probe**

`tools/probe-palette-actions.js` — it must assert the two things a per-task diff cannot show: that the lifted modals are reachable **while the sidebar is hidden**, and that focus does not snap back to the composer when the palette hands off (the M4 T5-a trap).

```js
(async () => {
  const fail = (m) => { throw new Error(m); };
  const q = (sel) => document.querySelector(sel);
  const openPalette = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    return q('.palette-input') ?? fail('palette did not open');
  };
  const type = async (input, text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  };

  // Precondition, asserted not assumed (M3 P4): the sidebar is the modals' OLD host.
  const sidebar = q('.channel-sidebar') ?? fail('no .channel-sidebar');
  if (sidebar.querySelector('.settings-modal')) fail('Settings still renders inside .channel-sidebar');

  // Hide the sidebar — the state in which the old host is display:none.
  const gutter = q('.sidebar-gutter') ?? fail('no .sidebar-gutter toggle');
  gutter.click();
  await new Promise((r) => setTimeout(r, 300));
  if (getComputedStyle(sidebar).display !== 'none') fail('sidebar did not hide; probe precondition unmet');

  let input = await openPalette();
  await type(input, 'настрой');
  const rows = [...document.querySelectorAll('.palette-row')];
  if (rows.length === 0) fail('no action row matched "настрой"');
  rows[0].click();
  await new Promise((r) => setTimeout(r, 400));
  const settings = q('.settings-modal') ?? fail('Settings did not open from the palette with the sidebar hidden');
  if (!settings.contains(document.activeElement)) {
    fail(`focus landed on ${document.activeElement?.className || document.activeElement?.tagName}, not inside Settings`);
  }

  // ⌘K инертен при открытой модалке (решение 8) — проверяем ЗДЕСЬ,
  // безусловно: Settings уже открыт этой же фазой, так что гейт не может
  // молча не выполниться из-за неудачного селектора.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  if (q('.palette-dialog')) fail('⌘K opened the palette on top of an open modal');

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  if (q('.settings-modal')) fail('Escape did not close Settings');

  // Тот же гейт, но на модалке, которой НЕТ на стеке useModalFocus
  // (её адоптеры — только ConfirmModal/FindServerModal/Settings). Именно эту
  // дыру закрывает DOM-половина гейта из решения 8, и только этот сценарий её
  // проверяет. Сайдбар всё ещё скрыт предыдущей фазой — возвращаем его.
  gutter.click();
  await new Promise((r) => setTimeout(r, 300));
  input = await openPalette();
  await type(input, 'создать кан');
  const createRow = [...document.querySelectorAll('.palette-row')][0] ?? fail('no create-channel action row');
  createRow.click();
  await new Promise((r) => setTimeout(r, 400));
  // Что модалка НЕ на стеке — факт исходника (grep по useModalFocus даёт ровно
  // ConfirmModal/FindServerModal/Settings), а не то, что можно спросить у DOM:
  // стек — модульная переменная. Если адоптеров станет больше, эта фаза
  // перестанет проверять DOM-половину гейта — перепроверьте grep, не пробу.
  const createModal = q('.modal-overlay .modal') ?? fail('CreateChannelModal did not open from the palette');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  if (q('.palette-dialog')) fail('⌘K opened the palette on top of a non-stack modal (the DOM half of the gate is dead)');
  // Закрываем «Отмена», не создавая канал: остатки на smoke-сервере не нужны.
  (createModal.querySelector('.modal-actions .btn-secondary') ?? fail('no Cancel button')).click();
  await new Promise((r) => setTimeout(r, 300));
  if (q('.modal-overlay .modal')) fail('CreateChannelModal did not close');

  // Theme action flips data-theme.
  const before = document.documentElement.getAttribute('data-theme');
  input = await openPalette();
  await type(input, 'тем');
  const themeRow = [...document.querySelectorAll('.palette-row')][0] ?? fail('no theme row');
  themeRow.click();
  await new Promise((r) => setTimeout(r, 300));
  const after = document.documentElement.getAttribute('data-theme');
  if (after === before) fail(`theme did not change (${before} → ${after})`);
  // restore
  input = await openPalette();
  await type(input, 'тем');
  document.querySelectorAll('.palette-row')[0].click();
  await new Promise((r) => setTimeout(r, 300));
  if (getComputedStyle(sidebar).display === 'none') fail('probe left the sidebar hidden');

  return { verdict: 'palette actions OK', themeBefore: before, themeAfter: after };
})()
```

The probe leaves the app as it found it: the sidebar is unhidden before the modal phase and the theme is switched back at the end — both are asserted, not assumed, so a half-run cannot quietly poison the next probe's preconditions.

- [ ] **Step 6: Prove it fails pre-task, then passes**

Same `git stash` / restart-dev-server sequence as Task 3 Step 8. Pre-task it must throw at `palette did not open` or `no action row matched`.

- [ ] **Step 7: Gates**

```bash
cd client
npx tsc --noEmit                                  # proves no orphaned import/state in ChannelSidebar
npm test 2>&1 | tail -20                          # Task 2's shape
npm run lint:css 2>&1 | tail -3                   # 196
npx stylelint src/components/CommandPalette.css 2>&1 | tail -2   # 0
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/CommandPalette.css   # zero rows
npm run check:i18n                                # ZERO
rg -n 'Settings|CreateChannelModal' src/components/ChannelSidebar.tsx  # only the lucide SettingsIcon import may remain
```

- [ ] **Step 8: Commit**

```bash
cd /Users/nm/Projects/experiments/vycord
git add client/src/components/CommandPalette.tsx client/src/components/CommandPalette.css \
        client/src/components/ChannelSidebar.tsx client/src/pages/AppPage.tsx
git commit -m "feat(redesign): M5 T4 — palette actions group; Settings/CreateChannel lifted to AppPage"
```

---

### Task 5: Messages group, show-all, and the chat command channel

**Files:**
- Create: `client/src/utils/searchSnippet.ts`, `client/src/utils/searchSnippet.test.ts`
- Modify: `client/src/components/MessageSearch.tsx` (re-import the moved helpers; add `initialQuery`)
- Modify: `client/src/components/CommandPalette.tsx`, `client/src/components/CommandPalette.css`
- Modify: `client/src/components/ChatArea.tsx` (command consumer, `searchSeed`, stack-aware Ctrl+Shift+F)
- Modify: `client/src/pages/AppPage.tsx` (`onShowChat` callback)

**Interfaces:**
- Consumes: `usePaletteStore.searchInChannel/jumpToMessage/clearCommand` (Task 2), `buildPalette` (Task 2), `CommandPalette` (Tasks 3–4).
- Produces: `snippetAround(content, query, radius?)`, `splitMatches(text, query)`; `MessageSearch` prop `initialQuery?: string`; `CommandPalette` prop `onShowChat: () => void`.

- [ ] **Step 1: Write the failing tests for the moved helpers**

Create `client/src/utils/searchSnippet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { snippetAround, splitMatches } from './searchSnippet';

describe('snippetAround', () => {
  it('returns short content untouched', () =>
    expect(snippetAround('короткое', 'кор', 80)).toBe('короткое'));

  it('windows around the first match with ellipses', () => {
    const text = `${'а'.repeat(200)}игла${'б'.repeat(200)}`;
    const out = snippetAround(text, 'игла', 20);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toContain('игла');
  });

  it('falls back to the head when the query is absent', () =>
    expect(snippetAround('я'.repeat(300), 'нет', 20)).toBe(`${'я'.repeat(40)}…`));
});

describe('splitMatches', () => {
  it('marks every occurrence, case-insensitively', () =>
    expect(splitMatches('Баг и баг', 'баг')).toEqual([
      { text: 'Баг', match: true },
      { text: ' и ', match: false },
      { text: 'баг', match: true },
    ]));

  it('returns one unmatched part when nothing matches', () =>
    expect(splitMatches('привет', 'zzz')).toEqual([{ text: 'привет', match: false }]));

  it('does not hang on an empty query', () =>
    expect(splitMatches('привет', '')).toEqual([{ text: 'привет', match: false }]));
});
```

The last test is the point of the extraction: `MessageSearch.tsx:45-51`'s loop never advances when the query is empty (`indexOf('')` returns `pos`), so it would spin forever. Unreachable at both current call sites, guarded here for good.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd client && npx vitest run src/utils/searchSnippet.test.ts
```

Expected: FAIL — `Failed to resolve import "./searchSnippet"`.

- [ ] **Step 3: Move the helpers out of `MessageSearch.tsx`**

Create `client/src/utils/searchSnippet.ts` with the two functions, lifted from `MessageSearch.tsx:29-54` and made framework-free (the React-node version stays at the call sites):

```ts
/** Обрезает длинный текст окном вокруг первого совпадения. */
export function snippetAround(content: string, query: string, radius = 80): string {
  if (content.length <= radius * 2) return content;
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return `${content.slice(0, radius * 2)}…`;
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + query.length + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

/** Режет текст на совпавшие/несовпавшие куски. Пустой запрос — единственный
 *  вход, на котором прежний цикл в MessageSearch не продвигался (indexOf('')
 *  возвращает pos) и вешал вкладку; здесь он отсекается явно. */
export function splitMatches(text: string, query: string): SnippetPart[] {
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: SnippetPart[] = [];
  let pos = 0;
  for (;;) {
    const idx = lower.indexOf(q, pos);
    if (idx === -1) break;
    if (idx > pos) parts.push({ text: text.slice(pos, idx), match: false });
    parts.push({ text: text.slice(idx, idx + q.length), match: true });
    pos = idx + q.length;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false });
  return parts;
}
```

In `MessageSearch.tsx`: delete the local `snippetAround` and `highlightMatches`, import the two helpers, and render through them:

```tsx
import { snippetAround, splitMatches } from '@/utils/searchSnippet';
```

```tsx
                    {splitMatches(snippetAround(msg.content, trimmed), trimmed).map((part, i) =>
                      part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
                    )}
```

- [ ] **Step 4: Give `MessageSearch` an `initialQuery`**

```tsx
interface MessageSearchProps {
  channel: Channel;
  initialQuery?: string;
  onJumpToMessage: (messageId: string) => void;
  onClose: () => void;
}
```

```tsx
export function MessageSearch({ channel, initialQuery = '', onJumpToMessage, onClose }: MessageSearchProps) {
  …
  const [query, setQuery] = useState(initialQuery);
```

No effect syncs `initialQuery` after mount: `ChatArea` remounts the panel with a fresh `key` per request (Step 6), which is what makes a repeated identical query still reset the panel.

- [ ] **Step 5: Run the tests, then wire the palette's messages group**

```bash
cd client && npx vitest run src/utils/searchSnippet.test.ts   # PASS, 6 tests
```

In `CommandPalette.tsx`, add the debounced per-channel search:

```tsx
import { apiService, apiErrorText } from '@/services/api';
import type { MessageSearchResponse } from '@/types';
import { snippetAround, splitMatches } from '@/utils/searchSnippet';
import { Avatar } from '@/components/Avatar';
import { useDateFormat } from '@/i18n';
import { PALETTE_DEBOUNCE_MS, PALETTE_MIN_QUERY, CAP_MESSAGES, type PaletteMessage } from '@/utils/paletteFilter';
```

Add `onShowChat: () => void;` to `CommandPaletteProps` and destructure it, then:

```tsx
  const fmt = useDateFormat();
  const [messages, setMessages] = useState<PaletteMessage[]>([]);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const trimmed = query.trim();
  useEffect(() => {
    if (!isOpen || !currentChannel || trimmed.length < PALETTE_MIN_QUERY) {
      setMessages([]); setMessagesTotal(0); setMessagesError(null); setMessagesLoading(false);
      return;
    }
    setMessagesLoading(true);
    let cancelled = false;
    // 120ms — board 2c. Панель MessageSearch намеренно осталась на 300ms:
    // она листает подтверждённый запрос, палитра показывает превью.
    const timer = setTimeout(async () => {
      try {
        const data = (await apiService.searchMessages(
          currentChannel.id, trimmed, CAP_MESSAGES, 0,
        )) as MessageSearchResponse;
        if (cancelled) return;
        setMessages(data.results);
        setMessagesTotal(data.total);
        setMessagesError(null);
      } catch (err) {
        if (!cancelled) setMessagesError(apiErrorText(err, t));
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }, PALETTE_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, currentChannel, trimmed, t]);
```

Feed them into `buildPalette` (replacing Task 3's zeros):

```tsx
      messages,
      messagesTotal,
      hasChannel: !!currentChannel,
      messagesLoading,
      messagesError,
```

Render the two new row kinds, and render the loading status through `t()` rather than the empty string the model carries:

```tsx
                    {row.kind === 'message' && (
                      <>
                        <Avatar username={row.message.username} className="palette-avatar" />
                        <span className="palette-snippet">
                          {splitMatches(snippetAround(row.message.content, trimmed), trimmed).map((part, i) =>
                            part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
                          )}
                        </span>
                        <span className="palette-date">{fmt.formatDayMonth(new Date(row.message.created_at))}</span>
                      </>
                    )}
                    {row.kind === 'show-all' && (
                      <>
                        <Search size={17} strokeWidth={1.8} className="palette-row-icon" />
                        <span className="palette-row-name palette-row-action">{t('palette.showAll')}</span>
                      </>
                    )}
```

```tsx
                  return (
                    <div className="palette-status" key={row.id}>
                      {row.id === 'messages-loading' ? t('palette.searching') : row.text}
                    </div>
                  );
```

Add the **seventh** action to the registry built in Task 4 — decision 16's persistent deep-search entry, which lands here because it needs the command channel this task introduces. Append it after `find-server`, and add `onShowChat` and `currentChannel` to the `useMemo` dependency list:

```tsx
    if (currentChannel) {
      defs.push({
        id: 'search-in-channel',
        label: t('palette.searchInChannel', { channel: currentChannel.name }),
        run: () => {
          onShowChat();
          usePaletteStore.getState().searchInChannel(currentChannel.id, '');
        },
      });
    }
```

with its icon entry beside the others:

```tsx
    'search-in-channel': <Search size={17} strokeWidth={1.8} className="palette-row-icon" />,
```

The registry now has a maximum of seven entries, which is exactly `CAP_ACTIONS` (decision 15) — an empty query can never silently drop one. `MessageSearch`'s `initialQuery` defaults to `''`, so this opens the panel empty and focused, which is what the header button does today.

And extend `activate`:

```tsx
    else if (row.kind === 'message' && currentChannel) {
      close(); onShowChat();
      usePaletteStore.getState().jumpToMessage(currentChannel.id, row.message.id);
    } else if (row.kind === 'show-all' && currentChannel) {
      close(); onShowChat();
      usePaletteStore.getState().searchInChannel(currentChannel.id, trimmed);
    }
```

New CSS in `CommandPalette.css`:

```css
.palette-avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-size: 10px;
  border-radius: var(--radius-row);
  object-fit: cover;
}

.palette-snippet {
  overflow: hidden;
  font-size: var(--fs-label);
  font-weight: 400;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-snippet mark {
  font-weight: 700;
  color: var(--hl-ink);
  background: var(--hl-bg);
}

.palette-date {
  flex-shrink: 0;
  margin-left: auto;
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--faint);
}
```

`mark` sets **both** background and colour — in dark, `--ink` on a light amber would be unreadable (decision 21).

- [ ] **Step 6: Consume the commands in `ChatArea`**

In `client/src/components/ChatArea.tsx`:

```tsx
import { usePaletteStore } from '@/stores/paletteStore';
import { isBlockingOverlayOpen } from '@/hooks/useModalFocus';
```

```tsx
  const [searchSeed, setSearchSeed] = useState<{ id: number; query: string } | null>(null);
  const paletteCommand = usePaletteStore((s) => s.command);
  const clearPaletteCommand = usePaletteStore((s) => s.clearCommand);

  useEffect(() => {
    const cmd = paletteCommand;
    if (!cmd) return;
    // Снимаем команду ПЕРВЫМ делом: повторный заход эффекта становится no-op.
    clearPaletteCommand(cmd.id);
    // Канал мог смениться между открытием палитры и ↵ — тогда команда чужая.
    if (!channel || cmd.channelId !== channel.id) return;
    if (cmd.kind === 'chat-search') { setSearchSeed({ id: cmd.id, query: cmd.query }); setSearchOpen(true); }
    else jumpToMessage(cmd.messageId);
  }, [paletteCommand, channel, clearPaletteCommand]);
```

Make the Ctrl+Shift+F listener stack-aware (decision 11), and make its close branch clear the seed the way the other two close paths do — otherwise a keyboard close-then-reopen remounts the panel on a stale palette query:

```tsx
      if (isBlockingOverlayOpen()) return;
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        setSearchSeed(null);      // безусловно: клавиатурное открытие — это
        setSearchOpen((o) => !o); // всегда новый ручной поиск, а не повтор
      }                           // запроса из палитры
```

> Clearing the seed **unconditionally** is what avoids a stale closure here: the effect has `[]` deps, so `searchOpen` is not readable outside the updater, and nesting a `setSearchSeed` call inside the `setSearchOpen` updater would be a side effect in a function React double-invokes under StrictMode. Clearing in both directions is correct anyway — a keyboard-opened panel should start empty.

Header button and panel render:

```tsx
            onClick={() => {
              if (searchOpen) { setSearchOpen(false); setSearchSeed(null); }
              else setSearchOpen(true);
            }}
```

```tsx
      {searchOpen && (
        <MessageSearch
          key={searchSeed?.id ?? 0}
          channel={channel}
          initialQuery={searchSeed?.query}
          onJumpToMessage={jumpToMessage}
          onClose={() => { setSearchOpen(false); setSearchSeed(null); }}
        />
      )}
```

- [ ] **Step 7: Add `onShowChat` in `AppPage`**

```tsx
        onShowChat={() => setMobilePanel('chat')}
```

and in `CommandPaletteProps`: `onShowChat: () => void;`. Without it a chat command dispatched from the mobile call panel would land in a `display: none` subtree (`AppPage.css:134`) — the same hazard as decision 4.

- [ ] **Step 8: Write the fail-first probe**

`tools/probe-palette-messages.js`:

```js
(async () => {
  const fail = (m) => { throw new Error(m); };
  const q = (sel) => document.querySelector(sel);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const type = async (input, text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(900); // 120ms debounce + a real round trip
  };

  const header = q('.chat-header-name')?.textContent ?? fail('no channel open — precondition unmet');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }));
  await wait(250);
  const input = q('.palette-input') ?? fail('palette did not open');

  // Ниже минимума запрос не уходит вовсе (решение 18).
  await type(input, 'a');
  if (q('.palette-snippet')) fail('a 1-character query produced message rows; the server would 400');

  await type(input, 'probe');
  const snippet = q('.palette-snippet') ?? fail('no message rows for a seeded query — reseed #general first');
  const mark = snippet.querySelector('mark') ?? fail('match is not highlighted');
  const mcs = getComputedStyle(mark);
  if (mcs.backgroundColor === 'rgba(0, 0, 0, 0)') fail('mark has no highlight background');
  if (mcs.color === getComputedStyle(snippet).color) fail('mark does not set its own colour; dark theme would be unreadable');

  const avatar = q('.palette-avatar') ?? fail('no message avatar');
  const abox = avatar.getBoundingClientRect();
  if (Math.round(abox.width) !== 26) fail(`avatar ${abox.width}px, expected 26`);

  const showAll = [...document.querySelectorAll('.palette-row')].find((r) => r.textContent.includes('Показать все'));
  if (!showAll) fail('no show-all row — seed >5 matching messages in #general and re-run');
  showAll.click();
  await wait(500);
  const panel = q('.message-search') ?? fail('show-all did not open the deep-search panel');
  const panelInput = panel.querySelector('input') ?? fail('deep panel has no input');
  if (panelInput.value !== 'probe') fail(`deep panel query is "${panelInput.value}", expected "probe"`);
  if (q('.chat-header-name')?.textContent !== header) fail('show-all changed the channel');

  return { verdict: 'palette messages OK', channel: header };
})()
```

- [ ] **Step 9: Prove it fails pre-task, then passes; seed the smoke channel first**

The probe needs ≥6 matching messages in `#general` on «Redesign Smoke». Post them through the UI (or a prior probe) with a distinctive token, **record every message you create in the task report's residue section** — M4's lesson is that residue accounting must cover every probe an invocation runs, not just the probe the task is about.

- [ ] **Step 10: Gates + commit**

```bash
cd client
npx tsc --noEmit && npm test 2>&1 | tail -20     # Task 2's shape + 6 new passing tests
npm run lint:css 2>&1 | tail -3
npx stylelint src/components/CommandPalette.css 2>&1 | tail -2   # 0
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/CommandPalette.css   # zero rows
npm run check:i18n
```

```bash
cd /Users/nm/Projects/experiments/vycord
git add client/src/utils/searchSnippet.ts client/src/utils/searchSnippet.test.ts \
        client/src/components/CommandPalette.tsx client/src/components/CommandPalette.css \
        client/src/components/MessageSearch.tsx client/src/components/ChatArea.tsx \
        client/src/pages/AppPage.tsx
git commit -m "feat(redesign): M5 T5 — palette messages group, show-all handoff, chat command channel"
```

---

### Task 6: `MessageSearch` restyle — 8 problems to 0

**Files:**
- Rewrite: `client/src/components/MessageSearch.css`
- Modify: `client/src/components/MessageSearch.tsx` (lucide, `.input`, `Avatar`, two-line empty state)
- Modify: `client/src/i18n/locales/ru.ts`, `en.ts` (`chat.nothingFoundTitle`)

**Interfaces:**
- Consumes: `searchSnippet` helpers and `initialQuery` (Task 5).
- Produces: nothing new — this task is presentation only. `MessageSearch`'s props and behaviour are unchanged.

- [ ] **Step 1: Replace the three hand-inlined SVGs with lucide**

In `client/src/components/MessageSearch.tsx`:

```tsx
import { Search, SearchX, X } from 'lucide-react';
```

- header magnifier (`:124`) → `<Search size={17} strokeWidth={1.8} className="message-search-input-icon" />`
- clear button (`:141`) → `<X size={14} strokeWidth={1.8} />` (below the 16–21 band — a **disclosed deviation**, M3 precedent, recorded in the task report)
- close button (`:146`) → `<X size={16} strokeWidth={1.8} />`
- the hint magnifier (`:157`) → `<Search size={22} strokeWidth={1.8} />` (matches the existing `SearchX size={22}` in the empty state, itself already in M4's recorded ≥22px cohort)

Swap the hand-rolled avatar (`:184-189`) for the shared component, which also gains the uploaded-image branch:

```tsx
                <Avatar username={msg.username} className="message-search-result-avatar" />
```

and drop the now-unused `avatarColor` import — `noUnusedLocals` makes that compiler-proven.

- [ ] **Step 2: Split the empty state per board `2a`**

Add to `ru.ts` (`chat` section, next to `nothingFound`) and mirror in `en.ts`:

```ts
    nothingFoundTitle: 'Ничего не нашлось',
```
```ts
    nothingFoundTitle: 'Nothing found',
```

```tsx
          <div className="message-search-empty">
            <div className="message-search-empty-tile">
              <SearchX size={22} strokeWidth={1.8} />
            </div>
            <h3 className="message-search-empty-title">{t('chat.nothingFoundTitle')}</h3>
            <p>{t('chat.nothingFound', { query: trimmed })}</p>
          </div>
```

Board `2a`'s suggestion chips are **not** shipped — nothing in the client can suggest a query (decision 23).

- [ ] **Step 3: Adopt the `.input` primitive for the header field**

```tsx
            className="input message-search-field"
```

The primitive supplies the border, radius, focus ring and placeholder colour; the component file only adds the icon inset and the clear-button inset.

- [ ] **Step 4: Rewrite `MessageSearch.css` on tokens**

Replace the whole file. Every legacy alias goes (decision 24): `--bg-*`, `--border-color`, `--text-*`, `--brand-*`, `--red-color`, `--radius-md/sm/full`. Keep the panel's shipped geometry (360px, top 58px, slide-in) — board `2c` specs the palette, not this panel, and its dock position is M1/M2 shipped behaviour:

```css
/* ═══ Deep search panel — M5 restyle. Board 2c owns the palette; this panel is
   an unspecced surface (spec §2 "survives restyled"), so geometry is the
   shipped one and only the system changes: tokens, .input, lucide, Avatar.
   Legacy aliases removed here — M6's alias sweep loses this file. ═══ */
.message-search {
  position: absolute;
  top: 58px; /* .chat-header */
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: 360px;
  background: var(--canvas);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow-menu);
  animation: message-search-slide-in 0.18s var(--ease-out);
}

@keyframes message-search-slide-in {
  from {
    opacity: 0;
    transform: translateX(24px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.message-search-header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--line);
}

.message-search-input-wrap {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
}

.message-search-input-icon {
  position: absolute;
  left: 12px;
  color: var(--muted-2);
  pointer-events: none;
}

.input.message-search-field {
  padding: 9px 34px 9px 38px;
  font-size: 14px;
}

.message-search-clear {
  position: absolute;
  right: 10px;
  display: flex;
  align-items: center;
  padding: 2px;
  color: var(--muted-2);
  background: none;
  border: none;
}

.message-search-clear:hover {
  color: var(--ink);
}

.message-search-close {
  display: flex;
  align-items: center;
  padding: 6px;
  color: var(--muted);
  background: none;
  border: none;
  border-radius: var(--radius-chip);
}

.message-search-close:hover {
  color: var(--ink);
  background: var(--canvas-2);
}

.message-search-count {
  padding: 8px 14px;
  font-size: var(--fs-group);
  font-weight: 700;
  letter-spacing: var(--ls-group);
  color: var(--muted-2);
  text-transform: uppercase;
  border-bottom: 1px solid var(--line);
}

.message-search-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  overflow-y: auto;
}

.message-search-hint {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--muted-2);
  text-align: center;
}

.message-search-hint p {
  font-size: 13px;
  line-height: 1.5;
}

.message-search-error {
  color: var(--danger-text);
}

/* ═══ No results — board 2a card, title + body (no suggestion chips: nothing
   in the client can suggest a query) ═══ */
.message-search-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
}

.message-search-empty-tile {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  color: var(--muted-2);
  background: var(--canvas-2);
  border-radius: var(--radius-bar);
}

.message-search-empty-title {
  font-size: 17px;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.message-search-empty p {
  max-width: 250px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--muted);
}

.message-search-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--line);
  border-top-color: var(--accent);
  border-radius: var(--radius-pill);
  animation: message-search-spin 0.7s linear infinite;
}

@keyframes message-search-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ═══ Result rows ═══ */
.message-search-result {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: 100%;
  padding: 10px;
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--radius-row);
  transition: background var(--transition);
}

.message-search-result:hover {
  background: var(--canvas-2);
}

.message-search-result-avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 14px;
  border-radius: var(--radius-tile);
  object-fit: cover;
}

.message-search-result-main {
  flex: 1;
  min-width: 0;
}

.message-search-result-meta {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 2px;
}

.message-search-result-author {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}

.message-search-result-date {
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--faint);
}

.message-search-result-text {
  font-size: 13px;
  line-height: 1.45;
  color: var(--muted);
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

.message-search-result-text mark {
  padding: 0 1px;
  font-weight: 700;
  color: var(--hl-ink);
  background: var(--hl-bg);
  border-radius: 2px;
}

.message-search-more {
  margin: 6px 8px 10px;
  padding: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border: none;
  border-radius: var(--radius-row);
}

.message-search-more:disabled {
  opacity: 0.6;
  cursor: default;
}

.message-search-more:hover:not(:disabled) {
  background: var(--accent-border);
}

/* Мобильный: панель на всю ширину */
@media (width <= 768px) {
  .message-search {
    width: 100%;
    border-left: none;
  }
}
```

Five of the eight old problems are fixed structurally rather than by reformatting (the remaining three are the `rgba`-notation trio on the one raw shadow, which dies with it): the raw `rgba()` shadow becomes `--shadow-menu`; the redundant `8px 30px 8px 30px` becomes the two-value padding on `.input.message-search-field`; the deprecated `word-break: break-word` becomes `overflow-wrap: break-word`; `.message-search-more:disabled` now precedes `:hover:not(:disabled)` (that was the `no-descending-specificity` hit); and `(max-width: 768px)` becomes the range form.

- [ ] **Step 5: Write the fail-first probe**

`tools/probe-message-search.js` — assert the panel in **both** themes, since M4's closeout records that every M4 probe asserted geometry only and colour findings slipped through:

```js
(async () => {
  const fail = (m) => { throw new Error(m); };
  const q = (sel) => document.querySelector(sel);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  (q('.chat-search-btn') ?? fail('no header search button')).click();
  await wait(500);
  const panel = q('.message-search') ?? fail('panel did not open');
  const pcs = getComputedStyle(panel);
  if (pcs.borderLeftColor === 'rgb(0, 0, 0)') fail('panel border is not tokenised');
  if (pcs.boxShadow.includes('rgba(0, 0, 0, 0.08)')) fail('panel still carries the raw legacy shadow');

  const field = panel.querySelector('.input.message-search-field') ?? fail('header input does not use the .input primitive');
  const inlineSvgs = [...panel.querySelectorAll('svg')].filter((s) => !s.classList.contains('lucide'));
  if (inlineSvgs.length) fail(`${inlineSvgs.length} hand-inlined SVG(s) survive in the panel (there were 4)`);

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(field, 'zzzqqq-no-such-text');
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(900);
  const empty = q('.message-search-empty') ?? fail('empty state did not render');
  const title = empty.querySelector('.message-search-empty-title') ?? fail('empty state has no title line (board 2a wants title + body)');
  if (!empty.querySelector('p')) fail('empty state has no body line');
  if (title.textContent.includes('zzzqqq')) fail('title names the query; the body should');

  return {
    verdict: 'deep panel OK',
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    shadow: pcs.boxShadow,
  };
})()
```

Run it under `--theme dark` as well and compare the two returned `shadow` values — light resolves `--shadow-menu` to `0 14px 34px rgba(16,19,34,.14)` and dark to `0 14px 34px rgba(0,0,0,.5)`, so a difference is the proof the panel follows the theme rather than a hardcoded rgba. **That comparison, not the border check, is the theme coverage:** `borderLeftColor === 'rgb(0, 0, 0)'` is close to un-failable, because a broken `var()` resolves to `currentColor` (≈ `--ink`), not black. Keep the border line as a cheap smoke check; do not count it as evidence.

- [ ] **Step 6: Gates**

```bash
cd client
npx stylelint src/components/MessageSearch.css 2>&1 | tail -2   # MUST be 0 (was 8)
npm run lint:css 2>&1 | tail -3                                 # expect 188
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/MessageSearch.css   # ZERO rows
rg -n -- '--bg-|--text-|--brand-|--border-color|--red-color|--radius-md|--radius-sm|--radius-full' src/components/MessageSearch.css   # ZERO rows
npx tsc --noEmit && npm test 2>&1 | tail -20
npm run check:i18n
```

- [ ] **Step 7: Commit**

```bash
cd /Users/nm/Projects/experiments/vycord
git add client/src/components/MessageSearch.css client/src/components/MessageSearch.tsx \
        client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): M5 T6 — MessageSearch restyle (8 → 0), lucide, board 2a empty state"
```

---

### Task 7: Dark parity, responsive, and the board `2c` fidelity pass

**Files:**
- Modify: `client/src/components/CommandPalette.css` (only if a measurement demands it)
- Modify: `client/src/components/CommandPalette.tsx` (only if a measurement demands it)

**Interfaces:**
- Consumes: everything from Tasks 3–6. Produces nothing new — this task exists to catch what per-surface tasks cannot see.

- [ ] **Step 1: Measure every board `2c` value in both themes**

`tools/probe-palette-board.js` asserts, in one run, against `README.md` §4 and `Redesign.dc.html:99-125`:

| Element | Assertion |
|---|---|
| dialog | width 600, `border-radius: 16px`, `box-shadow` = `--shadow-palette` |
| search row | padding `16px 18px`, gap `11px`, 1px bottom border in `--line` |
| magnifier | 19px box, stroke 1.8, colour `--muted-2` |
| input | 15px/400, `caret-color` = `--accent`, `maxLength` 100 |
| esc chip | padding `3px 8px`, r6, `--chip-bg`, mono 11px/600, `--muted-2`, **no border** |
| list | padding `10px 8px 12px` |
| group label | 11px/700, letter-spacing `.09em`, uppercase, `--muted-2`; first group padding-top 8px, later groups 14px |
| channel row | padding `9px 12px`, r10, gap `11px`; icon 17px |
| selected row | `--accent-soft` background, name 700, icon `--accent`, `↵ открыть` chip on `--canvas` + `--accent-border` in `--accent` |
| message row | avatar 26px r9; snippet 13.5/400; `mark` = `--hl-bg` / `--hl-ink` / 700; date 11.5/500 `--faint`, right-aligned |
| action row | icon `--muted`, label 13.5/600 |
| footer | padding `10px 18px`, 1px top border, `--canvas-3` background, gap 14px, mono keycaps, last hint right-aligned |

Run it twice (`--theme dark`) and assert that **every colour-bearing value differs** between themes except the ones that legitimately do not, listing which. The `--hl-bg`/`--hl-ink` pair is the one to watch: it is new in M5 and its dark values are interpolations.

- [ ] **Step 2: Measure the palette at 390px and 1440px**

```bash
node smoke.mjs --touch --size 390x844 --probe probe-palette-board.js --wait 4000 --out m5t7-palette-390.png
```

At 390px the dialog must be `100% - 24px` wide, must not overflow horizontally, and the footer's three hints must not wrap into the list. If they do, the fix is a `flex-wrap` or a hidden third hint inside the existing `(width <= 640px)` block — record which, and why.

- [ ] **Step 3: Verify the palette does not disturb any existing surface**

Run the inherited cross-surface probes and read their output rather than trusting a green exit: `probe-shell.js`, `probe-sidebar.js`, `probe-modal-sweep.js`. If `probe-chat.js` is cited, first re-read the two optional-chained fields the M4 closeout flagged and state in the report what it does and does not cover.

- [ ] **Step 4: Bidirectional class scan (the primary orphan gate)**

Every class in `CommandPalette.css` and `MessageSearch.css` must have a TSX emitter, and every class token those two TSX files emit must have a rule. **Match class tokens, not substrings** — that trap fired three times across M3/M4, and the working form for a token grep is `(?<![a-zA-Z0-9_-])name(?![a-zA-Z0-9_-])` (`rg -nw` does **not** work: `-` is a word boundary, so `-nw 'search-empty'` still matches `message-search-empty`).

- [ ] **Step 5: Commit (only if steps 1–4 produced changes)**

```bash
git commit -m "fix(redesign): M5 T7 — board 2c fidelity + dark/responsive corrections"
```

If nothing needed changing, this task produces **no commit** — say so explicitly, the way M4's Task 11 did, and do not manufacture a diff.

---

### Task 8: Verification sweep and closeout material (zero-diff)

**Files:** none. This task must produce **no commit**. If it finds something that needs fixing, it reports it; the fix is a separate, reviewed change.

- [ ] **Step 1: Constraint compliance, independently re-derived**

```bash
cd /Users/nm/Projects/experiments/vycord
git diff --stat <M5-base>..HEAD -- server/ client/src/services/ client/src/types/index.ts client/e2e/   # MUST be empty
git diff --numstat <M5-base>..HEAD -- client/src/styles/tokens.css                                      # MUST be "4  0"
git diff --stat <M5-base>..HEAD -- client/src/styles/primitives.css                                     # MUST be empty
rg -n 'apiService\.|wsService\.|fetch\(|/api/' $(git diff --name-only <M5-base>..HEAD -- 'client/src/**/*.tsx' 'client/src/**/*.ts')
#   ^ every hit must be a call to an EXISTING method with an unchanged signature; list them explicitly
git log --oneline redesign..main    # still empty
```

- [ ] **Step 2: Final gate sweep, from `client/`**

```bash
cd client
npm run lint:css 2>&1 | tail -3                       # expect 188; record the per-file decomposition
npx stylelint src/components/CommandPalette.css src/components/MessageSearch.css 2>&1 | tail -2   # 0
npx stylelint src/styles/primitives.css 2>&1 | tail -2   # still 0, untouched
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/components/CommandPalette.css src/components/MessageSearch.css   # ZERO rows
npx tsc --noEmit
npm test 2>&1 | tail -20                              # FAIL lines name api.network-retry ONLY
npm run check:i18n                                    # ZERO warnings
```

- [ ] **Step 3: Spec §5 M5 clause table**

Build the clause-by-clause table the closeout needs, quoting the spec's M5 bullet and marking each clause **Landed / Landed, adapted / Not deliverable**, with the reason and the evidence for each. The clauses are: new component + `paletteStore` · `⌘K`/`Ctrl+K` global · groups ordered channels → messages → actions · **explicit scopes labeled in the group headers** · channels = current server client-side filter · messages = per-channel API with 120ms debounce · actions = global list · no cross-server fan-out · full keyboard nav (`↑↓`, `↵`, `esc`) · "show all results" opens the restyled deep-search panel. Also record M2 decision 6's two deferrals (the header ⌘K chip — decision 7 — and the full `MessageSearch` restyle — Task 6) as closed with an explicit answer.

- [ ] **Step 4: Residue accounting against the REST API, not the DOM**

Query the smoke server for servers / channels / invites / stickers / message counts and diff against M4's recorded close state (1 server · 2 pre-existing invites · 1 sticker `t8seed68113` · 3 channels · 18 probe messages in `#general`). **Report every message any M5 probe run created**, not only those the task intended — M4 under-recorded 10 that way. Inferring from the DOM is what almost produced a false "smoke server destroyed" conclusion in M4 T9; use the API.

- [ ] **Step 5: Write the reasoned-not-measured list**

At minimum it will contain: every Electron branch (Electron cannot launch); icon identity (probes assert "a lucide of size N at stroke 1.8", never *which* icon — that is closed by the static diff); the `--hl-*` dark values (interpolations, not board values); and any probe assertion that runs only post-task because the probe terminates at its first discriminator pre-task. State each plainly. **"X could not be measured because Y" must carry evidence for Y at the same standard as a claim that X passed** — M4 caught four false cost estimates on exactly that shape.

- [ ] **Step 6: Draft `docs/superpowers/plans/2026-08-25-redesign-m5-closeout.md`**

Same shape as the M4 closeout: headline gate table · spec-clause table · every ruling made during execution, each with what it costs if wrong · awaiting-the-human items (decision 7's ⌘K chip is one) · deferred findings triaged by owner (M6 / post-redesign backlog / harness debt) · stylelint baseline history (196 → 188) · verification harness notes and any new mechanics · environment notes · reasoned-not-measured · process notes. The SDD workspace is gitignored and dies with the session — **anything not transcribed into that file is lost.**

---

## What the closeout must record (pre-agreed, so nothing is lost)

- **Stylelint:** 196 → **188**. `MessageSearch.css` 8 → 0; `CommandPalette.css` new at 0; `primitives.css` still 0 and **untouched**; no non-M5 file gained.
- **M6 inherits, newly:** `MessageSearch.css` is off the legacy aliases, so M6's alias sweep loses a third file (after `ErrorBoundary.css` and `UpdateBanner.css`); `@keyframes message-search-spin` and the palette's absence of loops are inputs to M6's `prefers-reduced-motion` pass; `--hl-bg`/`--hl-ink`'s dark values are interpolations to check in the dark-parity pass; the five non-stack-aware document Escape listeners (decision 9) remain M6's if it takes app-wide `useModalFocus` adoption.
- **`isBlockingOverlayOpen()`'s DOM half is load-bearing until M6 finishes `useModalFocus` adoption** (decision 8). It holds only while **every** modal renders `.modal-overlay` — true for all ten modal components plus `AppPage`'s inline one at M5. A future modal that rolls its own overlay class silently reopens the "⌘K over a modal" hole. Record it so M6 either finishes the adoption or keeps the invariant.
- **The z-index tier is now crowded** (decision 10): 1050 context menu · **1100 screen-share picker and volume popover** · 1150 palette · 1200 stage tooltip. M6 should decide whether these want a named token scale instead of five hand-picked integers.
- **Decision 29's fullscreen quirk:** with the call stage fullscreen on desktop, a palette chat command lands in a `display: none` chat area. Accepted for M5; goes to M6 alongside the fullscreen deferrals it already owns.
- **Awaiting the human:** decision 7 (board `1c`'s dark-theme ⌘K chip is not shipped on the header search button, because that button opens the deep panel per spec §2) and decision 2 (board `2c`'s per-row server name is dropped as unreachable).
- **Backlog contact, not fix:** the palette is a new caller of `handleSelectChannel` and inherits backlog §1c (decision 25). Nothing in backlog §1 was touched.

## Self-review (run against the spec before dispatching Task 1)

1. **Spec §5 M5 coverage.** "New component + `paletteStore`" → T2/T3. "`⌘K`/`Ctrl+K` global" → T3 (decision 8). "Groups ordered channels → messages → actions" → T2's `buildPalette` order, unit-tested. "Explicit scopes labeled in the group headers" → T3's i18n («Каналы — этот сервер», «Сообщения — в этом канале»). "Channels = current server, client-side filter over `serverStore.channels`" → T2/T3. "Messages = existing per-channel search API, 120ms debounce" → T5 (decisions 18, 19). "Actions = global (create channel, join voice, open settings, switch theme…)" → seven entries (decision 16): **six in T4, the seventh («Искать в канале») in T5**, where the command channel it dispatches into is built. "No cross-server fan-out" → decision 1. "Full keyboard nav (`↑↓`, `↵`, `esc`)" → T3 + `moveSelection` tests. "«Show all results» opens the restyled deep-search panel" → T5 + T6 (decisions 6, 23). Spec §6's "palette filtering/grouping" vitest surface → T2 (decision 12). **No clause is unassigned.**
2. **Placeholder scan.** Every code step carries real code. The two soft spots are named rather than hidden: Task 4's footer settings-button selector is explicitly flagged as "read the class off the live DOM", and Task 1 Step 6's smoke-flag names carry "if they differ, read the argument parser and record the correction" — both are instructions to verify, not TODOs.
3. **Counts, re-derived rather than inherited** (the review caught five stale ones in the first draft): `MessageSearch.tsx` has **four** inline SVGs, not three; `ChatAreaProps` has **9** entries, not 12; `setCreatingChannel(true)` has **one** call site, not two; `probe-screen-picker.js` has **22** `fail(` sites today, not the M3-era prose's 15; Task 2's suite is **18** tests, not 15, which moves the projected shape to `171 passed (174)`; five of `MessageSearch.css`'s eight problems die structurally, not four. Every number in this plan that an implementer will compare against reality has been re-derived from the file at planning time.
4. **Type consistency.** `PaletteActionDef.run` is used at Task 4's `row.action.run()`. `PaletteRow`'s five kinds are all handled in Tasks 3–5's renderer and `activate`. `buildPalette`'s `PaletteInput` fields match every call site (Task 3 passes zeros for the message fields, Task 5 replaces them). `usePaletteStore`'s four mutators are called exactly as declared. `MessageSearch`'s `initialQuery` is optional at both call sites. `isBlockingOverlayOpen()` is consumed by `usePaletteHotkey` and `ChatArea`.

---

## Review provenance

This plan was reviewed by an Opus grand-reviewer before execution, in the same seat M2/M3/M4 used. The reviewer read the spec, all three closeouts, the backlog, the board README and markup, and the M4 plan, and **independently re-derived every load-bearing factual claim against the codebase**. Verdict: *"sound with revisions — do not dispatch Task 2 or Task 4 as written."* Four blocking and eleven non-blocking findings; **all fifteen are applied above**, plus four corrections I found myself while the review ran. Nothing was deferred.

**Confirmed correct by the reviewer's own re-derivation** (kept unchanged): the `AppPage.css` `display: none` facts behind decisions 4 and 6 (every cited line checks out); the Escape-listener enumeration in decision 9; the `check-i18n.mjs` matcher description; the server's 2–100 rune bound; the `MessageSearch` empty-query hang in decision 13; decision 24's alias list (15 of 15); the `from`/`rows` status-row arithmetic; and every baseline (lint 196, `MessageSearch.css` 8 with all eight resolved by the rewrite, test shape 3/149/152, `check:i18n` zero, `redesign..main` empty, harness present at 31M).

**Blocking findings, and what changed:**

1. **Task 2's TDD suite could not pass against Task 2's own implementation.** Two fixtures were wrong: `'разговоры-general'` is Latin, so the Cyrillic query `'ген'` never matched it (`toLocaleLowerCase` does not transliterate), and the group-order test's only action, `'Создать канал'`, matched no `'ген'` either — so the actions group was empty and the assertion tested two groups of three. Both fixtures fixed; the test count was also wrong (18, not 15), which made the projected test shape wrong (`171 passed (174)`, not 168/171). **This is the milestone's flagship gate, and it was the milestone's own dominant defect class — a claim asserted from idiom rather than derived.**
2. **Decision 16 ruled seven actions; the code shipped six.** «Искать в канале» was never built and `palette.searchInChannel` would have shipped as a dead key pair. It is now Task 5's, because it dispatches into the command channel Task 5 introduces — and `CAP_ACTIONS` moved 6 → 7 so a full registry can never be silently truncated on an empty query (decision 15's own rule).
3. **Task 4's action-icon CSS was wrong twice.** `.palette-row-action ~ .palette-row-icon` can never match — the icon precedes the label in the markup, and `~` selects *subsequent* siblings; the advisory note had it exactly backwards. Appending the rule at the end of the file would also have fired `no-descending-specificity` against the "individually 0" gate, and would have left a selected action row with a muted icon while a selected channel row went accent. The rule is now `:has()`-only, placed between the base and `.is-selected` rules, with the gate — not the eye — as the check.
4. **The ⌘K-inert story covered three modals out of eleven.** `useModalFocus` is adopted only by `ConfirmModal`, `FindServerModal` and `Settings`; a stack-only gate would have opened the palette over the other eight — including `CreateChannelModal`, which the palette itself opens — while decision 8's cost line implied a guarantee. I verified that **every** modal in the app renders `.modal-overlay`, so the fix is complete rather than "accepted and disclosed": `isBlockingOverlayOpen()` checks the stack **and** the DOM, which also delivers open-only without a separate flag. Task 4's probe now exercises this on a non-adopter modal, unconditionally.

**Non-blocking findings applied:** the false "Avatar gains the uploaded-image branch" claim struck (`MessageWithAuthor` carries no avatar URL, so both surfaces always render the initial); the z-index map completed and the palette moved 1100 → **1150**, because 1100 is already taken by `ScreenSharePicker` and `VolumeControlPopover` and a tie would have been resolved by DOM order; decision 29 added for the desktop fullscreen `:has()` hazard the mount architecture otherwise missed; Ctrl+Shift+F now clears `searchSeed` like the other two close paths; `palette.noMessages` deleted as unrenderable; `preventDefault()` moved before the gate and `shiftKey` excluded; the probe's conditional inertness assertion made unconditional; "cancelled" corrected to "discarded" (there is no `AbortController` in `services/`); the border-colour check demoted from evidence to smoke; the T3 orphaned-key staging noted; and five stale counts re-derived (see self-review item 3).

**Found independently while the review ran**, by reading `smoke.mjs` rather than inheriting prose: the screenshot flag is `--out`, not `--shot`; **a failing probe does not fail the process** — `smoke.mjs:403` catches the throw, prints `PROBE ERROR:` and exits 0, so evidence is the printed output and never the exit code; `--type-into` dispatches `Enter` after typing, which would activate the palette's selected row; and the sidebar footer has no settings-specific class (it is the first of two `.panel-icon-btn`s in `.user-actions`), so that probe selector was invented and is now real.

**The reviewer's three questions, answered here:** (1) the seventh action was an omission, now wired in Task 5; (2) a chat command issued while the stage is fullscreen on desktop is **accepted** as landing hidden — decision 29, with the reasoning and the M6 owner; (3) yes, deliberately — a `chat-jump` command does not remount or re-seed an already-open deep-search panel, because the jump targets the message list behind it and a user mid-search should keep their query.
