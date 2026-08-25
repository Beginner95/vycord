# Frontend Redesign — Design Spec

**Date:** 2026-08-25
**Status:** Approved
**Design source of truth:** `design_handoff_discord_redesign/` (README.md + `Redesign.dc.html` board). This spec records *decisions and deviations*; pixel values, tokens, and per-screen specs live in the handoff README and are not duplicated here except where we deviate.

## 1. Goal & constraints

Visually rebuild the vycord client to the handoff design system: one chat metaphor, one icon set, four button roles, three depth levels, light + dark themes. **No backend changes** — all REST/WebSocket contracts (`src/services/api.ts`, `src/services/websocket.ts`, `src/types/index.ts`) stay exactly as they are. No framework migration: React 19 + Vite + Zustand + plain per-component CSS remain.

## 2. Scope decisions (settled with the user)

| Decision | Choice |
|---|---|
| Feature scope | **Restyle + client-feasible features.** Implement: command palette, optimistic send with `sending`/`failed` delivery states, empty states, local unread tracking. **Skip until a backend phase:** typing indicator, read receipts, reactions, attachment cards (the hover popover ships with edit/delete/quote; no react button). |
| App font | **Inter** (self-hosted woff2, 400–800), not the handoff's Plus Jakarta Sans — Plus Jakarta Sans has no Cyrillic glyphs and the product UI is Russian. **JetBrains Mono 500** for kbd hints/mono accents as specced. |
| Delivery | **One long-lived `redesign` branch**, built in milestone PRs, released to users as a single version. No mixed-design releases. |
| Unspecced surfaces | **Restyle everything** to the new system, extrapolating the design language: stickers (picker + manager), legacy 1:1 call overlay, NC/audio settings incl. test-sound buttons, volume popover, screen-share picker, update banner, avatar crop, error boundary. |
| Search UX | **Keep both**: ⌘K palette is the primary quick-nav (channels → messages → actions); the paginated `MessageSearch` panel survives restyled for deep search, reachable from the chat header and a "show all results" row in the palette. |
| Token migration | **Option B**: new canonical tokens named per the handoff (`--accent`, `--ink`, `--panel`, `--rail`, `--own-msg-bg`, …) with **temporary aliases** for the old names (`--bg-secondary: var(--panel)` etc.) so untouched surfaces stay coherent mid-migration; aliases deleted in the final milestone. |

## 3. Current-state facts the plan relies on

- `src/index.css` is the only live global stylesheet (imported from `main.tsx`); it already defines CSS-variable tokens and a `[data-theme="dark"]` override set by `stores/themeStore.ts`.
- Token discipline is good: 17 of 23 component CSS files have zero hardcoded hex; the holdout is `CallStage.css` (~20 hex + ~40 raw rgba).
- Layout already matches the design's skeleton: `AppPage.tsx` owns TitleBar + rail (`ServerList`, 72px) + sidebar (`ChannelSidebar`, 260px) + chat (`ChatArea`) + member list (`UserList`, 240px). Target widths: 76 / 252 / flex / 236.
- Messages render as **asymmetric bubbles** (`.message.self` / `.message.other` with reversed header/avatar) — the largest JSX change is unifying this.
- ~40 emoji are used as UI icons across 15 files; no icon library; a handful of hand-inlined SVGs in 6 files.
- Inter is referenced in `--font-sans` but **never loaded**; the app renders in system fallback today.
- Shared modal/form styles live in `pages/AppPage.css` (used by 7 modal surfaces); `.title-bar` is styled in `ChatArea.css`; `ScreenSharePicker.tsx` imports `CallStage.css` — extraction hazards.
- Dead Vite-template files: `src/style.css`, `src/main.ts`, `src/counter.ts`, `src/assets/{hero.png,typescript.svg,vite.svg}`, `public/icons.svg`.
- i18n is a custom type-safe module (`src/i18n/`, ru = source dictionary, en mirror, `npm run check:i18n`). `ErrorBoundary.tsx` has hardcoded Russian strings.
- Absent today (grep-verified): reactions, typing, unread, delivery states, attachment rendering, command palette, channel search.
- Electron: frameless window with `backgroundColor: '#313338'` hardcoded in `electron/main.ts` (dark flash on light-mode launch); custom `TitleBar` must coexist with the new design (the board doesn't include one — style it in rail/panel colors).

## 4. Architecture

### 4.1 Styles layer (`src/styles/`)

New directory, imported from `main.tsx` in place of the current single-file system:

- `tokens.css` — `:root` light tokens named per the handoff README tables (colors, radii, shadows, spacing, focus ring) + `[data-theme="dark"]` set from board option `2d`; the temporary alias block for old token names sits at the end, clearly marked for deletion.
- `fonts.css` — `@font-face` for self-hosted Inter (400/500/600/700/800) and JetBrains Mono 500 (woff2 files under `src/assets/fonts/`, bundled by Vite); `--font-sans` / `--font-mono`.
- `base.css` — reset, body, scrollbar, selection, focus-visible (accent ring per spec: `1.5px solid accent` + `0 0 0 3px rgba(79,70,229,.13)` on inputs), type-scale custom properties.
- `primitives.css` — shared component classes:
  - Buttons: `primary`, `secondary` (outline), `ghost`, `danger-soft`, `danger` (solid, destructive confirm only), one shared disabled state.
  - Inputs/textareas with the focus ring; select (36px, r9, chevron), toggle (44×26, 160ms), slider (150×6 track, accent fill), level meter.
  - Modal shell: overlay + dialog (r16, modal shadow, 180ms opacity + 4px rise), header/close-button pattern — **extracted from `AppPage.css`**, which stops carrying shared styles.
  - Context menu (r14, menu shadow, caps label, separated destructive row), kbd chip (mono 11px), pills/badges, skeleton shimmer.

Component CSS files stay per-component but consume tokens + primitives.

### 4.2 Icons

`lucide-react`, used directly (no wrapper): sizes 16–21px, `strokeWidth={1.8}` per spec. Every emoji-as-icon and hand-inlined SVG is replaced. Emoji remain only as *content* (message emoji picker, stickers).

### 4.3 Avatars

`Avatar.tsx` gains the deterministic color system (board `2b`): hash(username) → fixed 8-color palette, white 700 initial; uploaded avatar images unchanged; offline-in-dark = same hue at ~30% alpha. Squircle radii per size table (never circles for servers; presence dots stay circles).

### 4.4 New client-side state

- `unreadStore` (new zustand store): per-channel `{ unread: boolean, mentionCount: number, firstUnreadMessageId }` derived from WebSocket message events vs. a `lastReadByChannel` map persisted in localStorage; channel marked read when the last message enters the viewport; the "НОВЫЕ СООБЩЕНИЯ" divider stays until the user leaves the channel. Server rail badges aggregate mention counts per server. Known limitation (accepted): only messages received while the client runs are counted — no server-side read state.
- `messageStore` messages gain a client-only `deliveryState?: 'sending' | 'failed'` via optimistic send: append immediately at 75% opacity with a clock chip; reconcile on server ack; on failure show the `danger` "не отправлено · повторить" chip with retry. No `read` state (backend).
- `paletteStore`: `{ isOpen, query, results }` for ⌘K.

### 4.5 Electron

`electron/main.ts` `backgroundColor` follows the persisted theme to kill the launch flash — main can't read renderer localStorage, so `themeStore` mirrors the choice to a main-readable location via a small IPC call (written on change, read at window creation; default = light `canvas`). `TitleBar` CSS moves to its own file, styled with rail/panel tokens.

## 5. Milestones

Each is a PR into `redesign`; the app is fully functional after each (aliases keep untouched surfaces coherent).

- **M0 — Foundation.** Delete dead files; create `src/styles/`; load fonts; add lucide; extract modal shell from `AppPage.css`; move `.title-bar` styles out of `ChatArea.css`; Avatar color system; Electron backgroundColor fix. Visual change is minimal by design.
- **M1 — App shell** (board `1c` columns A/B/D). Rail 76px (home, divider, squircle tiles, corner unread/mention badges, bottom create+search group); sidebar 252px (header, group labels, text-channel row states incl. unread bar + mention badge, **voice channel cards** with participant list/mic states/"Войти в канал", idle voice rows with counts, restyled footer user panel + CallDock); member list 236px (online/offline groups, "в голосовом · X" sub-lines, bottom invite card wired to the existing invites API). Includes the `unreadStore`.
- **M2 — Chat** (board `1c` column C, `2a`, `2b`, `1f`). Single left-aligned metaphor (grid `42px 1fr`, grouping window **5 min** — changed from today's 7), own message = `own-msg-bg` + 2px accent border + "вы" chip; header 58px; date dividers; hover action popover (edit/delete/quote); delete via the new destructive-confirm modal (replaces `window.confirm`); composer single field with `Aa` toggle hiding the formatting toolbar, accent send square, hint line; restyled mention dropdown/emoji/sticker pickers; empty states; unread divider + viewport mark-read; optimistic delivery states; enter animation (220ms) and skeleton loading; mobile chat per `1f` within the existing single-panel mobile model.
- **M3 — Calls** (board `1e`, `2e`). CallStage on `stage` tokens: top bar (live pill + timer, counter, fullscreen), responsive tile grid (1/2/3 columns by participant count), name plates with mic/equalizer, speaking ring driven by real audio levels (existing speaking detection), control bar (three toggles with labels, divider, danger "Выйти" pill); screen-share view + picker; quality tooltip; `CallUI` 1:1 overlay restyled; mobile voice banner.
- **M4 — Modals, menus, settings** (board `1d` + unspecced). Find-server modal (name search + invite code merged into **one field**); settings modal (186px nav, new toggle/select/slider/level-meter, "Выйти" pinned bottom in danger) covering profile/audio-NC/video/appearance; server & channel context menus; destructive confirmation reused app-wide; then: manage invites, edit server/channel, create channel/server, sticker manager, avatar crop, update banner, error boundary (strings moved into i18n).
- **M5 — Command palette** (board `2c`). New component + `paletteStore`; `⌘K`/`Ctrl+K` global; groups ordered channels (client-side filter) → messages (existing search API, 120ms debounce) → actions (create channel, join voice, open settings, switch theme…); full keyboard nav (`↑↓`, `↵`, `esc`); "show all results" row opens the restyled deep-search panel.
- **M6 — Polish & closure.** Dark-theme parity pass on every surface (`2d`); responsive per design: ≥1200px four columns, 1000–1200px member list hidden behind header toggle, <900px sidebar drawer, <640px mobile layout (replaces the single 768px breakpoint); `prefers-reduced-motion` (drop loops, keep fades); animation budget audit (≤250ms ease-out); i18n additions ru+en with `check:i18n` green; **delete the token alias block**; final visual QA side-by-side with `Redesign.dc.html` per screen.

## 6. Testing

- Vitest for new logic: unread store transitions, optimistic delivery reconciliation, palette filtering/grouping, avatar hash stability, message grouping window.
- `npm run check:i18n` stays green each milestone (new strings land in ru + en together).
- Existing audio e2e (`client/e2e/`) untouched — no audio-path changes.
- Visual QA: open the design board and the app side by side in Chrome per milestone; final pass in M6.

## 7. Out of scope

Backend/API changes of any kind; typing indicators; read receipts; reactions; attachment upload/rendering; server-side unread state; new i18n languages; changes to `services/` (WebRTC, NC, echo cancellation) beyond none.

## 8. Risks & mitigations

- **`ChatArea.tsx` (1071 lines) rewrite risk** — M2 splits it into subcomponents (MessageRow, Composer, pickers) as part of the work; behavior covered by targeted vitest where practical.
- **Long-lived branch drift vs `main`** — rebase the `redesign` branch on `main` at each milestone boundary.
- **Alias layer masking missed conversions** — M6 alias deletion doubles as the audit: build + grep for old token names must come up empty.
- **Optimistic send vs current send path** — reconciliation keyed on server-assigned id via the existing WS message event; retry re-invokes the same API call.
