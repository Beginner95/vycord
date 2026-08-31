# Redesign M1 — App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the app shell to board `1c` columns A/B/D: server rail 76px, channel sidebar 252px with ONE unified channel list + voice cards, restyled footer user panel + CallDock, member list 236px with online/offline groups, in-voice sub-lines, and an invite card wired to the existing invites API.

**Architecture:** Pure client-side restyle on branch `redesign`. Component CSS files are rewritten to consume the M0 token layer (`src/styles/tokens.css`) and primitives; emoji-as-icons become `lucide-react` (16–21px, `strokeWidth={1.8}`). Two new pure-logic utils (`inviteExpiry`, `voiceMembership`) carry the only testable logic. No changes under `server/`, no changes to `src/services/`, no API/WS contract changes.

**Tech Stack:** React 19 + Vite + Zustand, plain per-component CSS, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` (binding; §5 M1 bullet is the scope). Pixel source of truth: `design_handoff_discord_redesign/README.md` §"Screens / Views — 1. Main app screen".

## Global Constraints

- **Never** touch `server/`, `src/services/`, or any REST/WS contract. `src/types/index.ts` unchanged.
- Legacy token aliases in `src/styles/tokens.css` (the "LEGACY ALIASES — DELETE IN M6" block) stay untouched.
- Test gate is a **delta-gate**: `npm test` must show exactly `Test Files 1 failed | 16 passed` and `Tests 3 failed | 112 passed` **plus any tests this plan adds as new passes**. The 3 known failures are all in `src/services/__tests__/api.network-retry.test.ts` (pre-existing, out of scope). Anything else red = your task broke it.
- `npm run check:i18n` must exit 0 after every task that touches i18n (it prints 4 pre-existing heuristic warnings for ErrorBoundary.tsx — that's fine, exit code gates).
- New user-facing strings land in **both** `src/i18n/locales/ru.ts` and `en.ts` in the same task.
- Icons: `lucide-react` only, sizes 16–21 (14–15 for tiny inline affordances), `strokeWidth={1.8}`. No new emoji-as-icons, no new hand-inlined SVGs.
- New CSS uses tokens; no raw hex/rgba except values that ARE tokens being defined in `tokens.css`. Literal px for sizes/radii is fine.
- Commit per task, message style `feat(redesign): …`, ending with the Claude-Session trailer if your harness provides one. **Stage explicit paths only — NEVER `git add -A`** (`design_handoff_discord_redesign/` is untracked on purpose).
- **Never push.** Never commit to `main`.
- Mobile blocks (`@media (max-width: 768px)`) in touched CSS files must keep working; the 768→900px breakpoint migration is M6's job. Class names `.server-list`, `.channel-sidebar`, `.user-list`, `.user-panel`, `.server-icon`, `.server-icon-symbol`, `.server-icon-name`, `.mobile-back-btn` must survive (AppPage.css mobile-panel rules select them).
- All work happens in `client/`; run all commands from `client/`.

## Decisions this plan locks in (the two M0-flagged inputs + adaptations)

1. **Avatar palette single source of truth = JS** (`src/utils/avatarColor.ts`). The unused `--avatar-1..8` tokens are **deleted** from tokens.css. `Avatar.tsx` exposes the hash color as a CSS custom property (`--avatar-color`) and paints `background: var(--avatar-bg, var(--avatar-color))`, so component CSS can re-theme the fallback (offline-grey in light, 30%-alpha hue in dark via `color-mix`) **without** JS theme awareness, and every unmigrated consumer renders pixel-identically.
2. **Type-scale custom properties land now** (spec §4.1 promised them; §5's M0 bullet omitted them). `base.css` gains `--fs-title/heading/body/label/caption/group` + `--ls-group`. M1+ CSS uses them for exact role matches; the handoff's in-between values (12.5px, 13px, 10.5px…) stay literal.
3. Adaptations (unified channels per spec §2 "Voice UI", existing features preserved):
   - Voice card renders on **any channel with ≥1 voice participant**; count shows as a bare number (no "/12" — no capacity concept). «Войти в канал» hidden when you're already in that channel's call.
   - Per-participant mic icons render **only where state is known**: the channel of YOUR active call (self = `isMuted`, others = `remoteMicMuted`). Other channels' participants get no mic icon.
   - Footer's two icon buttons = **settings + logout** (design shows mic+settings; mute lives in CallDock, logout must stay reachable).
   - Member-list call button (1:1 call) is kept, restyled (lucide `Phone`, hover-reveal).
   - The `.sidebar-gutter` collapse button, the explore-server modal (M4), and `window.confirm` deletes (M4) are **not touched**.
   - Sidebar header goes to the design's 58px; chat header stays 56px until M2 — a known temporary 2px seam.
   - Rail bottom-group border uses `--rail-line` (.14 alpha) though the board says .12 — indistinguishable; M6 parity pass owns it.

## Verification harness (controller-run; implementers note the gates)

- Visual smoke: `.superpowers/sdd/2026-08-25-redesign-m1-app-shell/tools/smoke.mjs` (CDP against headless system Chrome; flags `--out --theme --anon --click --type-into --fake-electron`). Dev server: `npm run dev:vite` → localhost:3000, pointed at the prod API via gitignored `.env.development.local`. Test account `redesign_smoke@vycord.local` / `RedesignSmoke2026!`, throwaway server «Redesign Smoke» (id in `tools/smoke-server-id.txt`). Destructive testing ONLY on that server.
- CSS gate: `tools/verify-tokens.sh` — its expected-token list is M0's; the controller updates it for Task 1's token changes (delete `--avatar-1..8`, add the M1 tokens) before running it.
- Electron cannot launch on this machine (npm 11 allowScripts skipped its postinstall) — verify statically; nothing in M1 touches `electron/`.

## File Structure

| File | Change |
|---|---|
| `src/styles/tokens.css` | −`--avatar-1..8`; +8 M1 tokens (+1 dark override) |
| `src/styles/base.css` | + type-scale `:root` block |
| `src/styles/primitives.css` | + `.panel-icon-btn`, `.user-avatar-wrap` (Task 5) |
| `src/components/Avatar.tsx` | custom-property color contract |
| `src/components/ServerList.tsx/.css` | rail 76px, lucide icons, `.rail-bottom` group |
| `src/components/ChannelSidebar.tsx/.css` | 252px, header 58 + chevron menu, unified rows, voice card, footer |
| `src/components/CallDock.tsx/.css` | lucide + tokens restyle |
| `src/components/UserList.tsx/.css` | 236px, groups, in-voice sub-line, offline avatars, invite card |
| `src/pages/AppPage.tsx` | pass `voiceParticipants` to UserList, `onServerDeleted` to ChannelSidebar |
| `src/utils/voiceMembership.ts` + `.test.ts` | new (Task 6) |
| `src/utils/inviteExpiry.ts` + `.test.ts` | new (Task 7) |
| `src/i18n/locales/ru.ts`, `en.ts` | +`call.joinChannel`, `channel.ncOn`, `server.inVoice`, `server.inviteCard.*` |

---

### Task 1: Foundation — avatar single source of truth, type scale, M1 tokens

**Files:**
- Modify: `src/styles/tokens.css` (delete `--avatar-1..8` at lines 47–55; add M1 tokens after `--rail-line`; add one dark override)
- Modify: `src/styles/base.css` (prepend type-scale block)
- Modify: `src/components/Avatar.tsx`

**Interfaces:**
- Produces tokens: `--rail-ink`, `--rail-muted`, `--rail-item-hover`, `--rail-create-bg`, `--rail-create-ink`, `--row-hover` (dark override), `--avatar-offline`, `--white`; type scale `--fs-title|heading|body|label|caption|group`, `--ls-group`.
- Produces the Avatar contract: fallback div carries inline `--avatar-color` (the hash hex) and paints `background: var(--avatar-bg, var(--avatar-color))`, `color: var(--avatar-ink, #FFFFFF)`. Consumer CSS re-themes by setting `--avatar-bg` / `--avatar-ink` on the same element (Task 6 relies on this).

- [ ] **Step 1: tokens.css — delete the avatar palette block**

Remove lines 47–55 (`/* ── Avatar palette … ── */` comment + `--avatar-1` … `--avatar-8`). Nothing consumes them (verify first: `rg -n "avatar-[1-8]" src` must only hit tokens.css). Update the comment in `src/utils/avatarColor.ts:1-2` so it no longer claims the tokens exist:

```ts
// Deterministic username → color mapping (design handoff, option 2b).
// SINGLE SOURCE OF TRUTH for the 8-color avatar palette (M1 decision:
// the former --avatar-1..8 tokens were unconsumed and deleted).
```

- [ ] **Step 2: tokens.css — add M1 tokens**

Insert directly after the `--rail-line` line in `:root`:

```css
  --rail-ink:        #E4E7F0;
  --rail-muted:      #C9CFDE;
  --rail-item-hover: rgba(255, 255, 255, 0.12);
  --rail-create-bg:  rgba(18, 183, 106, 0.16);
  --rail-create-ink: #4ADE96;
  --row-hover:       rgba(255, 255, 255, 0.6);
  --avatar-offline:  #E3E6EF;
  --white:           #FFFFFF;
```

In the `[data-theme="dark"]` block (after `--rail: #0A0C12;`) add:

```css
  --row-hover: rgba(255, 255, 255, 0.05); /* board: nav hover in dark */
```

(The rail-* tokens are theme-invariant — the rail is dark in both themes.)

- [ ] **Step 3: base.css — type scale**

Insert at the very top of `base.css`, before the reset:

```css
/* ── Type scale (spec §4.1; handoff typography table). In-between handoff
   values (12.5px, 13px, 10.5px…) stay literal in component CSS. ── */
:root {
  --fs-title:   19px;   /* modal title · 800 · lh 1.25 */
  --fs-heading: 15.5px; /* screen/channel/server name · 700 */
  --fs-body:    14px;   /* message body · 400 · lh 1.55 */
  --fs-label:   13.5px; /* list item, button label · 500–700 */
  --fs-caption: 11.5px; /* caption, description, time · 500 */
  --fs-group:   11px;   /* group label · 700 · caps */
  --ls-group:   0.09em; /* group label letter-spacing */
}
```

- [ ] **Step 4: Avatar.tsx — custom-property contract**

Replace the fallback `return` (lines 26–33) with:

```tsx
  return (
    <div
      className={className}
      style={
        {
          '--avatar-color': avatarColor(username),
          background: 'var(--avatar-bg, var(--avatar-color))',
          color: 'var(--avatar-ink, #FFFFFF)',
          fontWeight: 700,
        } as React.CSSProperties
      }
    >
      {username.charAt(0).toUpperCase() || '?'}
    </div>
  );
```

(`import type React from 'react'` if not already imported — check `noUnusedLocals`; a plain `as React.CSSProperties` cast needs the React namespace in scope. `import { useEffect, useState } from 'react'` exists; add `import type { CSSProperties } from 'react'` and cast `as CSSProperties` instead if that's cleaner.)

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit` → clean. `npm test` → `Test Files 1 failed | 16 passed (17)`, `Tests 3 failed | 112 passed (115)` (unchanged — Avatar rendering is not unit-covered; `avatarColor.test.ts` still passes). `npm run build:vite` → success.

Rendering must be **pixel-identical**: the inline style still resolves to the same background hex (no `--avatar-bg` is defined anywhere yet). Controller smoke confirms `redesign_smoke`'s avatars still render `rgb(232, 89, 12)`.

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css src/styles/base.css src/components/Avatar.tsx src/utils/avatarColor.ts
git commit -m "feat(redesign): avatar palette single-sourced in JS, type scale, M1 shell tokens"
```

---

### Task 2: Server rail — 76px, board 1c column A

**Files:**
- Modify: `src/components/ServerList.tsx` (icons + bottom group wrapper only; modal JSX untouched)
- Modify: `src/components/ServerList.css` (desktop rules lines 1–93 + divider/symbol rules; **keep** the modal styles at lines 95–243 and the mobile block at 261–374 with the minimal edits below)

**Interfaces:**
- Consumes: Task 1 tokens (`--rail-ink`, `--rail-muted`, `--rail-item-hover`, `--rail-create-bg`, `--rail-create-ink`, `--white`), existing `--rail`, `--rail-item`, `--rail-line`, `--accent`.
- Produces: `.rail-bottom` wrapper class (desktop bottom group; mobile neutralizes it).

- [ ] **Step 1: JSX — lucide icons + bottom group**

In `ServerList.tsx`:
1. `import { Home, Plus, Search } from 'lucide-react';`
2. Home tile: replace `<span className="server-icon-symbol">🏠</span>` with `<span className="server-icon-symbol"><Home size={21} strokeWidth={1.8} /></span>`.
3. Create tile: replace `<span className="server-icon-symbol">+</span>` with `<span className="server-icon-symbol"><Plus size={20} strokeWidth={1.8} /></span>`.
4. Search tile: replace `<span className="server-icon-symbol">🔍</span>` with `<span className="server-icon-symbol"><Search size={18} strokeWidth={1.8} /></span>`.
5. Wrap the create + search tiles in `<div className="rail-bottom">…</div>` (they are the last two children of `<aside className="server-list">`).

Server initials stay as text in `.server-icon-symbol`. No other JSX changes; the explore modal stays as-is.

- [ ] **Step 2: CSS — rewrite desktop rail rules**

Replace lines 1–93 of `ServerList.css` (`.server-list` through `.server-icon.search:hover`) with:

```css
.server-list {
  width: 76px;
  min-width: 76px;
  background: var(--rail);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0 14px;
  gap: 8px;
  overflow-y: auto;
}

.server-icon {
  width: 46px;
  height: 46px;
  min-height: 46px;
  border-radius: 14px;
  background: var(--rail-item);
  color: var(--rail-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  font-size: 17px;
  font-weight: 700;
  transition: background var(--transition), color var(--transition);
}

.server-icon-symbol {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Active indicator bar: 4×30, white, sticks out left of the tile. */
.server-icon::before {
  content: '';
  position: absolute;
  left: -13px;
  top: 50%;
  translate: 0 -50%;
  width: 4px;
  height: 0;
  border-radius: 0 4px 4px 0;
  background: var(--white);
  transition: height 0.2s var(--ease-out);
}

.server-icon:hover::before {
  height: 20px;
}

.server-icon.active::before {
  height: 30px;
}

.server-icon:hover {
  background: var(--rail-item-hover);
  color: var(--rail-ink);
}

.server-icon.active {
  background: var(--accent);
  color: var(--white);
  box-shadow: 0 0 0 3px var(--rail-line);
}

.server-icon.home {
  color: var(--rail-ink);
}

.server-icon.home.active {
  background: var(--accent);
  color: var(--white);
}

/* Bottom group: create + search, pinned, separated by a hairline. */
.rail-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 46px;
  padding-top: 8px;
  border-top: 1px solid var(--rail-line);
}

.server-icon.add {
  background: var(--rail-create-bg);
  color: var(--rail-create-ink);
}

.server-icon.add:hover {
  background: var(--rail-create-bg);
  filter: brightness(1.2);
}

.server-icon.search {
  background: var(--rail-item);
  color: var(--rail-muted);
}

.server-icon.search:hover {
  background: var(--rail-item-hover);
  color: var(--rail-ink);
}
```

Notes: the old `overflow: hidden` on `.server-icon` is **deliberately dropped** (it clipped the `::before` indicator); image clipping is already handled by `.server-icon img { border-radius: inherit; }`. Do not re-add hover translate/border-radius morph/colored glows.

- [ ] **Step 3: CSS — divider + mobile-block edits**

Replace `.server-divider` (lines 245–251):

```css
.server-divider {
  width: 30px;
  height: 1px;
  min-height: 1px;
  background: var(--rail-line);
  margin: 3px 0;
}
```

In the mobile block (`@media (max-width: 768px)`):
1. Add a `.rail-bottom` neutralizer as the mobile group is a plain list:

```css
  .rail-bottom {
    margin-top: 0;
    width: 100%;
    padding-top: 0;
    border-top: 0;
    gap: 0;
    align-items: stretch;
  }
```

2. The mobile `.server-icon` row keeps legacy alias colors (they resolve) — leave the block otherwise untouched. The mobile `.server-icon.add .server-icon-symbol { font-size: 22px }` is now inert over a lucide svg — harmless, leave it (M6 sweeps mobile).

- [ ] **Step 4: Gates**

`npx tsc --noEmit` clean; `npm test` delta-gate unchanged (`3 failed | 112 passed`); `npm run build:vite` succeeds. Controller smoke (light + dark): rail is dark in both themes, 76px wide, active tile indigo with white indicator bar visible, bottom group separated, no emoji in the rail, lucide svgs have `stroke-width="1.8"`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ServerList.tsx src/components/ServerList.css
git commit -m "feat(redesign): server rail 76px per board 1c column A"
```

---

### Task 3: Channel sidebar shell — 252px, header + unified channel rows

**Files:**
- Modify: `src/components/ChannelSidebar.tsx` (header chevron menu, hash icons, plus icon)
- Modify: `src/components/ChannelSidebar.css` (shell/header/list/row rules; voice + footer rules are Task 4/5)
- Modify: `src/pages/AppPage.tsx` (pass `onServerDeleted` to ChannelSidebar)

**Interfaces:**
- Consumes: `--panel`, `--panel-line`, `--row-hover`, `--canvas`, `--shadow-row`, `--accent-soft`, `--fs-heading/label/group`, `--ls-group`.
- Produces: `ChannelSidebarProps` gains `onServerDeleted: (serverId: string) => void`; classes `.channel-hash`, `.channel-header-menu` (Task 4 renders rows around them).

- [ ] **Step 1: JSX — imports, props, header menu**

In `ChannelSidebar.tsx`:
1. Add imports: `import { ChevronDown, Hash, Plus } from 'lucide-react';`, `import { EditServerModal } from '@/components/EditServerModal';`, `import { ManageInvitesModal } from '@/components/ManageInvitesModal';`.
2. Extend props: add `onServerDeleted: (serverId: string) => void;` to `ChannelSidebarProps` and to the destructured params.
3. Add state next to the existing menu state:

```tsx
  const [serverMenu, setServerMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingServer, setEditingServer] = useState(false);
  const [invitingServer, setInvitingServer] = useState(false);
```

4. Permission derivation (after the existing `canManageChannels` line):

```tsx
  const canManageServer = can(permissions, PERMISSIONS.MANAGE_SERVER) || server?.owner_id === user?.id;
  const canInvite = can(permissions, PERMISSIONS.CREATE_INVITE);
  const isOwner = server?.owner_id === user?.id;
  const hasServerMenu = canManageServer || canInvite || isOwner;
```

5. Delete-server handler (mirrors ServerList's; `window.confirm` stays until M4):

```tsx
  const handleDeleteServer = async () => {
    if (!server) return;
    if (!window.confirm(t('server.deleteConfirm', { name: server.name }))) return;
    try {
      await apiService.deleteServer(server.id);
      useServerStore.getState().removeServer(server.id);
      onServerDeleted(server.id);
    } catch (err) {
      console.error('Failed to delete server:', err);
      alert(apiErrorText(err, t));
    }
  };
```

6. Header (server branch only) becomes:

```tsx
      <div className="channel-header">
        {onMobileBack && ( /* keep the existing mobile back button exactly as is */ )}
        <h2>{server.name}</h2>
        {hasServerMenu && (
          <button
            type="button"
            className="channel-header-menu"
            aria-label={t('server.editMenu')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setServerMenu({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <ChevronDown size={18} strokeWidth={1.8} />
          </button>
        )}
      </div>
```

7. Render the menu + modals before the closing `</nav>` (next to the existing channelMenu block):

```tsx
      {serverMenu && server && (
        <ContextMenu
          x={serverMenu.x}
          y={serverMenu.y}
          onClose={() => setServerMenu(null)}
          items={[
            ...(canInvite ? [{ label: t('server.inviteMenu'), onClick: () => setInvitingServer(true) }] : []),
            ...(canManageServer ? [{ label: t('server.editMenu'), onClick: () => setEditingServer(true) }] : []),
            ...(isOwner ? [{ label: t('server.deleteMenu'), danger: true, onClick: handleDeleteServer }] : []),
          ]}
        />
      )}
      {editingServer && server && <EditServerModal server={server} onClose={() => setEditingServer(false)} />}
      {invitingServer && server && <ManageInvitesModal serverId={server.id} onClose={() => setInvitingServer(false)} />}
```

8. Category row: replace the text `+` button content with `<Plus size={15} strokeWidth={1.8} />` (keep class/handler/title).
9. Channel row: inside the `.channel` div, prepend `<Hash size={16} strokeWidth={1.8} className="channel-hash" />` before `.channel-name` (the `#` currently comes from a CSS `::before`, removed in Step 2).

In `AppPage.tsx`, add `onServerDeleted={handleServerRemoved}` to the `<ChannelSidebar` props (same handler already passed to `<ServerList`).

- [ ] **Step 2: CSS — shell, header, category, rows**

In `ChannelSidebar.css` replace `.channel-sidebar`, `.channel-header`, `.channel-header h2`, `.channel-list`, `.channel-category`, `.channel-category-add`, `.channel`, `.channel::before`, `.channel:hover`, `.channel.active`, `.channel.active::before`, `.channel.in-call` with:

```css
.channel-sidebar {
  width: 252px;
  min-width: 252px;
  background: var(--panel);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--panel-line);
}

.channel-header {
  height: 58px;
  min-height: 58px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--panel-line);
}

.channel-header h2 {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-heading);
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
}

.channel-header-menu {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--muted-2);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.channel-header-menu:hover {
  background: var(--row-hover);
  color: var(--ink);
}

.channel-list {
  flex: 1;
  padding: 16px 10px;
  overflow-y: auto;
}

.channel-category {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 6px;
  color: var(--muted-2);
  font-size: var(--fs-group);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: var(--ls-group);
}

.channel-category-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--muted-2);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.channel-category-add:hover {
  background: var(--row-hover);
  color: var(--ink);
}

.channel {
  padding: 8px 10px;
  margin: 2px 0;
  border-radius: var(--radius-row);
  color: var(--muted);
  cursor: pointer;
  font-size: var(--fs-label);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background var(--transition), color var(--transition);
}

.channel-hash {
  flex-shrink: 0;
  color: var(--muted-2);
}

.channel:hover {
  background: var(--row-hover);
  color: var(--ink);
}

.channel.active {
  background: var(--canvas);
  box-shadow: var(--shadow-row);
  color: var(--ink);
  font-weight: 700;
}

.channel.active .channel-hash {
  color: var(--accent);
}

/* Board 2d: dark active nav uses accent-soft, not canvas. */
[data-theme="dark"] .channel.active {
  background: var(--accent-soft);
  box-shadow: none;
}

.channel.in-call {
  box-shadow: inset 3px 0 0 var(--online);
}

[data-theme="dark"] .channel.in-call {
  box-shadow: inset 3px 0 0 var(--online);
}
```

Also delete the `.channel-category-add:active { transform: scale(0.92); }` rule. Keep `.channel-name`, `.no-server-message`, the mobile block, and everything below `/* ── Join Voice Button ── */` untouched (Task 4's).

- [ ] **Step 3: Gates**

`npx tsc --noEmit` clean; `npm test` delta-gate unchanged; `npm run check:i18n` exit 0 (no new strings); `npm run build:vite` succeeds. Controller smoke: sidebar 252px on `--panel`, header 58px with chevron (test user owns «Redesign Smoke», so the menu must render and open on click), rows show lucide hash, active row white+shadow in light / accent-soft in dark.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChannelSidebar.tsx src/components/ChannelSidebar.css src/pages/AppPage.tsx
git commit -m "feat(redesign): sidebar shell 252px, header menu, unified channel rows"
```

---

### Task 4: Voice card + quiet join affordance

**Files:**
- Modify: `src/components/ChannelSidebar.tsx` (channel-mapping block only)
- Modify: `src/components/ChannelSidebar.css` (join-voice + voice-participant rules)
- Modify: `src/i18n/locales/ru.ts`, `src/i18n/locales/en.ts` (+`call.joinChannel`)

**Interfaces:**
- Consumes: `useCallStore` fields `callChannelId` (already subscribed), `isMuted`, `remoteMicMuted: Map<string, boolean>`; `Avatar` from Task 1; `--accent`, `--accent-soft`, `--accent-border`, `--online`, `--danger`, `--white`, `--fs-label`, `--fs-caption`.
- Produces: classes `.voice-card`, `.voice-card-row`, `.voice-card-name`, `.voice-card-count`, `.voice-card-participants`, `.voice-participant(-avatar|-name|-mic)`, `.voice-card-join`. i18n key `call.joinChannel`.

- [ ] **Step 1: i18n**

`ru.ts`, in the `call` section next to `joinVoice`:

```ts
    joinChannel: 'Войти в канал',
```

`en.ts`, same position:

```ts
    joinChannel: 'Join channel',
```

Run `npm run check:i18n` → exit 0.

- [ ] **Step 2: JSX — card vs row**

In `ChannelSidebar.tsx` add subscriptions next to `callChannelId`:

```tsx
  const isMuted = useCallStore((s) => s.isMuted);
  const remoteMicMuted = useCallStore((s) => s.remoteMicMuted);
```

Add the mic-state resolver above the return (state is only known for the channel of OUR call):

```tsx
  // 'on' | 'off' | null; null = state unknown (channel we're not in) → no icon.
  const micStateFor = (channelId: string, userId: string): 'on' | 'off' | null => {
    if (callChannelId !== channelId) return null;
    if (userId === user?.id) return isMuted ? 'off' : 'on';
    return remoteMicMuted.get(userId) ? 'off' : 'on';
  };
```

Add lucide imports: `Mic, MicOff, Volume2, Headphones` (extend the Task 3 import line), and extend the react import with the type: `import { useState, useEffect, useMemo, type MouseEvent } from 'react';` (so the bare `MouseEvent` below is React's synthetic type, not the DOM global).

Replace the whole `channels.map((channel) => { … })` block with:

```tsx
        {channels.map((channel) => {
          const participantIds = voiceParticipants?.get(channel.id) ?? [];
          const isCallChannel = callChannelId === channel.id;
          const isActive = currentChannel?.id === channel.id;
          const openMenu = (e: MouseEvent) => {
            if (!canManageChannels) return;
            e.preventDefault();
            setChannelMenu({ x: e.clientX, y: e.clientY, channel });
          };

          if (participantIds.length > 0) {
            // Активная голосовая сессия — карточка (board 1c, адаптация VYC-77:
            // карточку получает ЛЮБОЙ канал с участниками, типа каналов нет).
            return (
              <div
                key={channel.id}
                className={`voice-card${isActive ? ' current' : ''}`}
                onContextMenu={openMenu}
              >
                <div className="voice-card-row" onClick={() => onSelectChannel(channel)}>
                  <Volume2 size={16} strokeWidth={1.8} className="voice-card-icon" />
                  <span className="voice-card-name">{channel.name}</span>
                  <span className="voice-card-count">{participantIds.length}</span>
                </div>
                <div className="voice-card-participants">
                  {participantIds.map((userId) => {
                    const mic = micStateFor(channel.id, userId);
                    return (
                      <div
                        key={userId}
                        className={`voice-participant${userId === user?.id ? ' is-self' : ''}`}
                        onClick={() => onSelectChannel(channel)}
                      >
                        <Avatar
                          url={resolveAvatarUrl(userId)}
                          username={resolveUsername(userId)}
                          className="voice-participant-avatar"
                        />
                        <span className="voice-participant-name">{resolveUsername(userId)}</span>
                        {mic === 'on' && <Mic size={14} strokeWidth={1.8} className="voice-participant-mic" />}
                        {mic === 'off' && <MicOff size={14} strokeWidth={1.8} className="voice-participant-mic off" />}
                      </div>
                    );
                  })}
                </div>
                {!isCallChannel && (
                  <button type="button" className="voice-card-join" onClick={() => onJoinVoice(channel)}>
                    {t('call.joinChannel')}
                  </button>
                )}
              </div>
            );
          }

          return (
            <div
              key={channel.id}
              className={`channel${isActive ? ' active' : ''}`}
              onClick={() => onSelectChannel(channel)}
              onContextMenu={openMenu}
            >
              <Hash size={16} strokeWidth={1.8} className="channel-hash" />
              <span className="channel-name">{channel.name}</span>
              <button
                type="button"
                className="channel-join-voice"
                title={t('call.joinVoice')}
                aria-label={t('call.joinVoice')}
                onClick={(e) => {
                  e.stopPropagation();
                  onJoinVoice(channel);
                }}
              >
                <Headphones size={14} strokeWidth={1.8} />
                <span className="channel-join-voice-label">{t('call.joinVoice')}</span>
              </button>
            </div>
          );
        })}
```

Notes: the old `.voice-channel-group` wrapper, `.voice-count` span, `in-call` row class and the inline headphones SVG are gone from this block (`.channel.in-call` CSS may stay — a card now represents the in-call channel). The plain row keeps the join pill even when a card exists elsewhere; a channel WITH participants exposes joining via the card button.

- [ ] **Step 3: CSS — voice card; recolor the join pill accent**

In `ChannelSidebar.css`, replace the `/* ── Voice Participants ── */` section (`.voice-count`, `.voice-participant-list`, `.voice-participant*`) with:

```css
/* ── Voice card (channel with an active voice session) ── */
.voice-card {
  margin: 2px 0;
  padding: 8px 10px;
  border-radius: var(--radius-row);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.voice-card.current {
  box-shadow: var(--shadow-row);
}

.voice-card-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.voice-card-icon {
  flex-shrink: 0;
  color: var(--accent);
}

.voice-card-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-label);
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.voice-card-count {
  flex-shrink: 0;
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--accent-text);
}

.voice-card-participants {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-left: 25px;
}

.voice-participant {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.voice-participant-avatar {
  width: 20px;
  height: 20px;
  min-width: 20px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  overflow: hidden;
  object-fit: cover;
}

.voice-participant-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.voice-participant.is-self .voice-participant-name {
  color: var(--ink);
  font-weight: 700;
}

.voice-participant-mic {
  flex-shrink: 0;
  color: var(--online);
}

.voice-participant-mic.off {
  color: var(--danger);
}

.voice-card-join {
  width: 100%;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: var(--white);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition);
}

.voice-card-join:hover {
  background: var(--accent-hover);
}
```

Then recolor the join pill (`/* ── Join Voice Button ── */` section): in every rule, replace `var(--green-500)` → `var(--accent)`, `var(--green-600)` → `var(--accent-hover)`, `var(--text-muted)` → `var(--muted-2)`, `var(--text-secondary)` → `var(--muted)`, `var(--text-inverse)` → `var(--white)`, and in the focus rule `var(--bg-primary)` → `var(--panel)`. Delete the two `[data-theme="dark"] .channel-join-voice…` green-compensation rules and the dark override inside `@media (hover: none)` (accent works in both themes); keep the rest of the hover-none and reduced-motion blocks with the same substitutions.

- [ ] **Step 4: Gates**

`npx tsc --noEmit` clean; `npm test` delta-gate unchanged; `npm run check:i18n` exit 0. Controller smoke on «Redesign Smoke»: join the voice channel via `--fake-electron`-less browser run is not possible for real audio — verify statically what needs a session: card renders whenever `voiceParticipants` has entries (controller can verify with a second browser context joining voice, or accept the static + row-level check: plain rows show the accent join pill on hover, no green remains: `rg -n "green-" src/components/ChannelSidebar.css` → 0).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChannelSidebar.tsx src/components/ChannelSidebar.css src/i18n/locales/ru.ts src/i18n/locales/en.ts
git commit -m "feat(redesign): voice session card and accent join affordance"
```

---

### Task 5: Footer user panel + CallDock restyle

**Files:**
- Modify: `src/styles/primitives.css` (+`.panel-icon-btn`, `.user-avatar-wrap`)
- Modify: `src/components/ChannelSidebar.tsx` (footer JSX), `src/components/ChannelSidebar.css` (footer rules)
- Modify: `src/components/CallDock.tsx`, `src/components/CallDock.css`
- Modify: `src/i18n/locales/ru.ts`, `en.ts` (+`channel.ncOn`)

**Interfaces:**
- Produces in primitives.css (shared; Task 6 consumes `.user-avatar-wrap`):
  - `.panel-icon-btn` — 30×30, r9, `--canvas` bg, `--shadow-row`; modifiers `.is-off`, `.danger`.
  - `.user-avatar-wrap` — relative wrapper; `.online` modifier renders the presence dot via `::after`; dot ring color overridable via `--presence-ring` (default `var(--canvas)`).
- Consumes: Task 1 tokens.

- [ ] **Step 1: i18n**

`ru.ts` `channel` section: `ncOn: 'NC вкл.',` — `en.ts`: `ncOn: 'NC on',`. `npm run check:i18n` → exit 0.

- [ ] **Step 2: primitives.css — shared shell primitives**

Append after the `.kbd` rule:

```css
/* ── Panel icon button (sidebar footer, call dock): 30×30, r9, white ── */
.panel-icon-btn {
  width: 30px;
  height: 30px;
  min-width: 30px;
  padding: 0;
  border: none;
  border-radius: var(--radius-row);
  background: var(--canvas);
  color: var(--muted);
  box-shadow: var(--shadow-row);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.panel-icon-btn:hover {
  color: var(--ink);
}

.panel-icon-btn.is-off {
  background: var(--danger-soft);
  color: var(--danger-text);
}

.panel-icon-btn.danger:hover {
  background: var(--danger);
  color: var(--white);
}

/* ── Avatar wrapper with presence dot (pseudo-elements can't attach to <img>) ── */
.user-avatar-wrap {
  position: relative;
  flex-shrink: 0;
  display: flex;
}

.user-avatar-wrap.online::after {
  content: '';
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--online);
  border: 2px solid var(--presence-ring, var(--canvas));
}
```

- [ ] **Step 3: Footer JSX**

In `ChannelSidebar.tsx`: extend the lucide import with `Settings as SettingsIcon, LogOut` (alias — `Settings` the component is already imported). Replace the `.user-panel` block:

```tsx
      <div className="user-panel">
        <span className="user-avatar-wrap online">
          <Avatar url={user?.avatar_url} username={user?.username ?? ''} className="user-avatar small" />
        </span>
        <div className="user-details">
          <span className="user-tag">{user?.username}</span>
          <span className="user-status-text">
            {t('server.online')}
            {ncEnabled && ` · ${t('channel.ncOn')}`}
          </span>
        </div>
        <div className="user-actions">
          <button
            type="button"
            className="panel-icon-btn"
            onClick={() => setSettingsOpen(true)}
            title={t('settings.title')}
          >
            <SettingsIcon size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="panel-icon-btn danger"
            onClick={() => setConfirmLogout(true)}
            title={t('common.logout')}
          >
            <LogOut size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
```

- [ ] **Step 4: Footer CSS**

In `ChannelSidebar.css` replace the `/* ── User Panel ── */` section (`.user-panel` through `.logout-btn:hover`, including `.user-avatar.small`, its `::after` rule, and `.nc-badge`) with:

```css
/* ── User Panel (footer) ── */
.user-panel {
  padding: 10px;
  background: var(--panel-footer);
  border-top: 1px solid var(--panel-line);
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-panel .user-avatar-wrap {
  --presence-ring: var(--panel-footer);
}

.user-avatar.small {
  width: 34px;
  height: 34px;
  min-width: 34px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  overflow: hidden;
  object-fit: cover;
}

.user-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.user-tag {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-status-text {
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-actions {
  display: flex;
  gap: 6px;
}
```

In the mobile block, replace `.user-panel { height: 72px; padding: 0 16px; padding-bottom: env(...) }` with:

```css
  .user-panel {
    padding: 12px 16px;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  }
```

- [ ] **Step 5: CallDock**

`CallDock.tsx` — replace the three emoji buttons with lucide (`import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';`):

```tsx
        <button
          type="button"
          className={`panel-icon-btn${isMuted ? ' is-off' : ''}`}
          onClick={() => useCallStore.getState().toggleMute()}
          title={isMuted ? t('call.micOn') : t('call.micOff')}
        >
          {isMuted ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className={`panel-icon-btn${isVideoOff ? ' is-off' : ''}`}
          onClick={() => useCallStore.getState().toggleVideo()}
          title={isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}
        >
          {isVideoOff ? <VideoOff size={16} strokeWidth={1.8} /> : <Video size={16} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className="panel-icon-btn danger"
          onClick={() => useCallStore.getState().leave()}
          title={t('call.leaveCall')}
        >
          <PhoneOff size={16} strokeWidth={1.8} />
        </button>
```

(keep the `call-dock-btn` → `panel-icon-btn` class swap; delete the old class usages). `CallDock.css` becomes:

```css
.call-dock {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid var(--panel-line);
  background: var(--panel-footer);
}

.call-dock-target {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.call-dock-status {
  font-size: 11px;
  font-weight: 600;
  color: var(--online-text);
}

.call-dock-channel {
  max-width: 100%;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.call-dock-server {
  font-weight: 500;
  color: var(--muted-2);
}

.call-dock-actions {
  display: flex;
  gap: 6px;
}
```

- [ ] **Step 6: Gates**

`npx tsc --noEmit` clean; `npm test` delta-gate unchanged; `npm run check:i18n` exit 0; `npm run build:vite` succeeds. `rg -n "call-dock-btn|nc-badge|settings-btn|logout-btn" src` → only possibly-stale CSS hits must be 0 in the touched files. Controller smoke: footer on `--panel-footer` with 34px r12 avatar (still `rgb(232, 89, 12)`), presence dot visible (it now works over `<img>` too), two white 30×30 buttons, no ⚙/🔇 emoji anywhere in the sidebar.

- [ ] **Step 7: Commit**

```bash
git add src/styles/primitives.css src/components/ChannelSidebar.tsx src/components/ChannelSidebar.css src/components/CallDock.tsx src/components/CallDock.css src/i18n/locales/ru.ts src/i18n/locales/en.ts
git commit -m "feat(redesign): footer user panel and CallDock on panel tokens"
```

---

### Task 6: Member list — 236px, groups, in-voice sub-line, offline avatars

**Files:**
- Create: `src/utils/voiceMembership.ts`
- Create: `src/utils/voiceMembership.test.ts`
- Modify: `src/components/UserList.tsx`, `src/components/UserList.css`
- Modify: `src/pages/AppPage.tsx` (pass `voiceParticipants`)
- Modify: `src/i18n/locales/ru.ts`, `en.ts` (+`server.inVoice`)

**Interfaces:**
- Consumes: `.user-avatar-wrap` (Task 5), Avatar `--avatar-bg`/`--avatar-ink` contract (Task 1), `--avatar-offline`, `--online-text`, `--row-hover`, type scale.
- Produces: `voiceChannelNameFor(userId: string, voiceParticipants: Map<string, string[]> | undefined, channels: Channel[]): string | null`; `UserListProps` gains `voiceParticipants?: Map<string, string[]>`; layout `.user-list > .user-list-scroll` + pinned bottom area (Task 7 puts the invite card after the scroll div).

- [ ] **Step 1: Write the failing test**

`src/utils/voiceMembership.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { voiceChannelNameFor } from './voiceMembership';
import type { Channel } from '@/types';

const ch = (id: string, name: string): Channel => ({
  id,
  server_id: 's1',
  name,
  position: 0,
  created_at: '',
  updated_at: '',
});

describe('voiceChannelNameFor', () => {
  const channels = [ch('c1', 'Общий'), ch('c2', 'Игры')];

  it('returns the channel name the user is in', () => {
    const vp = new Map([['c2', ['u1', 'u2']]]);
    expect(voiceChannelNameFor('u2', vp, channels)).toBe('Игры');
  });

  it('returns null when the user is in no voice channel', () => {
    const vp = new Map([['c1', ['u1']]]);
    expect(voiceChannelNameFor('u9', vp, channels)).toBeNull();
  });

  it('returns null for an unknown channel id (stale WS state)', () => {
    const vp = new Map([['gone', ['u1']]]);
    expect(voiceChannelNameFor('u1', vp, channels)).toBeNull();
  });

  it('returns null when the map is undefined or empty', () => {
    expect(voiceChannelNameFor('u1', undefined, channels)).toBeNull();
    expect(voiceChannelNameFor('u1', new Map(), channels)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `npx vitest run src/utils/voiceMembership.test.ts`
Expected: FAIL — cannot resolve `./voiceMembership`.

- [ ] **Step 3: Implement**

`src/utils/voiceMembership.ts`:

```ts
import type { Channel } from '@/types';

// «в голосовом · X» в списке участников: находит канал, в чьей голосовой
// сессии состоит пользователь. Сервер не пускает в две сессии сразу —
// первое совпадение единственное.
export function voiceChannelNameFor(
  userId: string,
  voiceParticipants: Map<string, string[]> | undefined,
  channels: Channel[],
): string | null {
  if (!voiceParticipants) return null;
  for (const [channelId, userIds] of voiceParticipants) {
    if (userIds.includes(userId)) {
      return channels.find((c) => c.id === channelId)?.name ?? null;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run it — must pass**

Run: `npx vitest run src/utils/voiceMembership.test.ts` → 4 passed.

- [ ] **Step 5: i18n**

`ru.ts` `server` section (near `online`/`offline`): `inVoice: 'в голосовом · {{channel}}',` — `en.ts`: `inVoice: 'in voice · {{channel}}',`.

- [ ] **Step 6: UserList JSX**

1. Props: `interface UserListProps { onMobileBack?: () => void; voiceParticipants?: Map<string, string[]>; }`.
2. Imports: `import { Phone } from 'lucide-react';`, `import { voiceChannelNameFor } from '@/utils/voiceMembership';`; read channels: `const { members, channels } = useServerStore();`.
3. `renderMember` becomes:

```tsx
  const renderMember = (m: MemberWithUser, online: boolean) => {
    const voiceName = online ? voiceChannelNameFor(m.user_id, voiceParticipants, channels) : null;
    return (
      <div key={m.user_id} className={`user-item${online ? '' : ' offline'}`}>
        <span className={`user-avatar-wrap${online ? ' online' : ''}`}>
          <Avatar url={m.avatar_url} username={m.username} className="user-avatar list" />
        </span>
        <div className="user-item-text">
          <span className="username">{m.username}</span>
          {voiceName && <span className="user-item-sub">{t('server.inVoice', { channel: voiceName })}</span>}
        </div>
        {online && currentUser && m.user_id !== currentUser.id && (
          <button
            className="call-user-btn"
            onClick={() => handleCallUser(m.user_id)}
            title={t('server.callUser', { name: m.username })}
          >
            <Phone size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
    );
  };
```

4. Body: wrap the two groups in a scroll container so Task 7 can pin the invite card:

```tsx
  return (
    <aside className="user-list">
      <div className="user-list-mobile-header">…keep as is…</div>
      <div className="user-list-scroll">
        <div className="user-category online-label">
          {t('server.online')} — {onlineMembers.length}
        </div>
        {onlineMembers.map((m) => renderMember(m, true))}
        <div className="user-category">
          {t('server.offline')} — {offlineMembers.length}
        </div>
        {offlineMembers.map((m) => renderMember(m, false))}
      </div>
    </aside>
  );
```

5. `AppPage.tsx`: `<UserList onMobileBack={() => setMobilePanel('chat')} voiceParticipants={voiceParticipants} />`.

- [ ] **Step 7: UserList CSS**

Replace everything above the mobile block in `UserList.css` with:

```css
.user-list {
  width: 236px;
  min-width: 236px;
  background: var(--panel);
  border-left: 1px solid var(--panel-line);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}

.user-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.user-category {
  padding: 0 4px 6px;
  color: var(--muted-2);
  font-size: var(--fs-group);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: var(--ls-group);
}

.user-category.online-label {
  color: var(--online-text);
}

.user-category + .user-category,
.user-item + .user-category {
  margin-top: 14px;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  margin-bottom: 4px;
  border-radius: var(--radius-row);
  position: relative;
}

.user-item:not(.offline) {
  background: var(--canvas);
  box-shadow: var(--shadow-row);
}

.user-item.offline:hover {
  background: var(--row-hover);
}

.user-avatar.list {
  width: 30px;
  height: 30px;
  min-width: 30px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  overflow: hidden;
  object-fit: cover;
}

.user-item .user-avatar-wrap.online::after {
  width: 11px;
  height: 11px;
}

.user-item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.username {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-item.offline .username {
  font-weight: 500;
  color: var(--muted);
}

.user-item-sub {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Offline avatar: light = neutral grey tile; dark = the user's hash hue
   at ~30% alpha with a light tint initial (spec §4.3 / board 2b). */
.user-item.offline .user-avatar.list {
  --avatar-bg: var(--avatar-offline);
  --avatar-ink: var(--muted-2);
}

[data-theme="dark"] .user-item.offline .user-avatar.list {
  --avatar-bg: color-mix(in srgb, var(--avatar-color) 30%, transparent);
  --avatar-ink: color-mix(in srgb, var(--avatar-color) 55%, var(--white));
}

.user-item.offline img.user-avatar.list {
  opacity: 0.5;
}

.call-user-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--muted-2);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition), background var(--transition), color var(--transition);
}

.user-item:hover .call-user-btn {
  opacity: 1;
}

.call-user-btn:hover {
  background: var(--online-soft);
  color: var(--online-text);
}
```

Keep `.user-list-mobile-header { display: none; }` and the whole mobile block; inside the mobile block delete the now-dead `.call-user-btn { opacity: 1; }`? No — **keep it** (touch devices have no hover; it must stay).

- [ ] **Step 8: Gates**

`npx tsc --noEmit` clean; `npm test` → `Tests 3 failed | 116 passed (119)` (the 4 new passes; same 3 known failures); `npm run check:i18n` exit 0; `npm run build:vite` succeeds. Controller smoke: member list 236px, «В СЕТИ — n» label in green, online row = white card with dot, offline `redesign_smoke`-server members grey in light / 30%-alpha hue in dark (verify computed `background-color` contains `rgba` of the hash color in dark).

- [ ] **Step 9: Commit**

```bash
git add src/utils/voiceMembership.ts src/utils/voiceMembership.test.ts src/components/UserList.tsx src/components/UserList.css src/pages/AppPage.tsx src/i18n/locales/ru.ts src/i18n/locales/en.ts
git commit -m "feat(redesign): member list 236px with in-voice sub-lines and offline avatars"
```

---

### Task 7: Invite card wired to the invites API

**Files:**
- Create: `src/utils/inviteExpiry.ts`
- Create: `src/utils/inviteExpiry.test.ts`
- Modify: `src/components/UserList.tsx`, `src/components/UserList.css`
- Modify: `src/i18n/locales/ru.ts`, `en.ts` (+`server.inviteCard.*`)

**Interfaces:**
- Consumes: `apiService.createInvite(serverId): Promise<Invite>` (`Invite.expires_at?: string`), `can(perms, PERMISSIONS.CREATE_INVITE)`, `.btn`/`.btn-secondary` primitives, `.user-list` flex column from Task 6.
- Produces: `inviteExpiry(expiresAt: string | undefined, now?: Date): { kind: 'never' } | { kind: 'days'; days: number }`.

- [ ] **Step 1: Write the failing test**

`src/utils/inviteExpiry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { inviteExpiry } from './inviteExpiry';

const NOW = new Date('2026-08-25T12:00:00Z');
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

describe('inviteExpiry', () => {
  it('no expires_at → never', () => {
    expect(inviteExpiry(undefined, NOW)).toEqual({ kind: 'never' });
  });

  it('unparseable expires_at degrades to never', () => {
    expect(inviteExpiry('not-a-date', NOW)).toEqual({ kind: 'never' });
  });

  it('exactly 7 days → 7', () => {
    expect(inviteExpiry(daysFromNow(7), NOW)).toEqual({ kind: 'days', days: 7 });
  });

  it('partial days round up', () => {
    expect(inviteExpiry(daysFromNow(6.5), NOW)).toEqual({ kind: 'days', days: 7 });
  });

  it('less than a day clamps to 1', () => {
    expect(inviteExpiry(daysFromNow(0.02), NOW)).toEqual({ kind: 'days', days: 1 });
  });

  it('already expired clamps to 1 (freshly-created invites only reach the card)', () => {
    expect(inviteExpiry(daysFromNow(-1), NOW)).toEqual({ kind: 'days', days: 1 });
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `npx vitest run src/utils/inviteExpiry.test.ts` → FAIL, cannot resolve `./inviteExpiry`.

- [ ] **Step 3: Implement**

`src/utils/inviteExpiry.ts`:

```ts
export type InviteExpiry = { kind: 'never' } | { kind: 'days'; days: number };

// Текст «Ссылка живёт N дн.» в инвайт-карточке — всегда вычисляется из
// expires_at сервера, никогда не захардкожен (spec §5 M1).
export function inviteExpiry(expiresAt: string | undefined, now: Date = new Date()): InviteExpiry {
  if (!expiresAt) return { kind: 'never' };
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return { kind: 'never' };
  const days = Math.ceil((ts - now.getTime()) / 86_400_000);
  return { kind: 'days', days: Math.max(days, 1) };
}
```

- [ ] **Step 4: Run it — must pass**

Run: `npx vitest run src/utils/inviteExpiry.test.ts` → 6 passed.

- [ ] **Step 5: i18n**

`ru.ts`, inside `server` after the `invites` object:

```ts
    // Инвайт-карточка внизу списка участников
    inviteCard: {
      title: 'Пригласить друзей',
      hint: 'Позовите друзей на этот сервер',
      noExpiry: 'Ссылка не истекает',
      expiresDays: 'Ссылка живёт {{days}} дн.',
      copyLink: 'Скопировать ссылку',
    },
```

`en.ts`, same position:

```ts
    // Invite card at the bottom of the member list
    inviteCard: {
      title: 'Invite friends',
      hint: 'Bring your friends to this server',
      noExpiry: 'Link never expires',
      expiresDays: 'Link lives for {{days}} d.',
      copyLink: 'Copy link',
    },
```

`npm run check:i18n` → exit 0.

- [ ] **Step 6: UserList JSX — the card**

Add imports: `import { can, PERMISSIONS } from '@/utils/permissions';`, `import { inviteExpiry } from '@/utils/inviteExpiry';`, `import { apiErrorText } from '@/services/api';` (extend the existing apiService import line), `import type { Invite } from '@/types';` (extend the existing type import).

Inside `UserList`, add:

```tsx
  const currentServer = useServerStore((s) => s.currentServer);
  const invitePerms = useServerStore((s) =>
    s.currentServer ? s.permissions.get(s.currentServer.id) : undefined
  );
  const canInvite =
    !!currentServer &&
    (can(invitePerms, PERMISSIONS.CREATE_INVITE) || currentServer.owner_id === currentUser?.id);

  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);

  // Смена сервера — карточка начинает с чистого листа.
  useEffect(() => {
    setInvite(null);
    setInviteError('');
    setInviteCopied(false);
  }, [currentServer?.id]);

  const handleCopyInvite = async () => {
    if (!currentServer) return;
    setInviteError('');
    let inv = invite;
    if (!inv) {
      setInviteBusy(true);
      try {
        inv = await apiService.createInvite(currentServer.id);
        setInvite(inv);
      } catch (err) {
        setInviteError(apiErrorText(err, t));
        return;
      } finally {
        setInviteBusy(false);
      }
    }
    navigator.clipboard?.writeText(inv.code).catch(() => {});
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };
```

(The bare 2000ms reset mirrors ManageInvitesModal's existing pattern.)

After the closing `</div>` of `.user-list-scroll`, before `</aside>`:

```tsx
      {canInvite && currentServer && (
        <div className="invite-card">
          <span className="invite-card-title">{t('server.inviteCard.title')}</span>
          <p className="invite-card-sub">
            {(() => {
              if (!invite) return t('server.inviteCard.hint');
              const exp = inviteExpiry(invite.expires_at);
              return exp.kind === 'never'
                ? t('server.inviteCard.noExpiry')
                : t('server.inviteCard.expiresDays', { days: String(exp.days) });
            })()}
          </p>
          {inviteError && <p className="invite-card-error">{inviteError}</p>}
          <button
            type="button"
            className="btn btn-secondary invite-card-btn"
            onClick={handleCopyInvite}
            disabled={inviteBusy}
          >
            {inviteCopied ? t('server.invites.copied') : t('server.inviteCard.copyLink')}
          </button>
        </div>
      )}
```

- [ ] **Step 7: CSS**

Append to `UserList.css` (above the mobile block):

```css
/* ── Invite card (pinned bottom) ── */
.invite-card {
  margin-top: 12px;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.invite-card-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
}

.invite-card-sub {
  margin: 0;
  font-size: var(--fs-caption);
  font-weight: 400;
  color: var(--muted);
}

.invite-card-error {
  margin: 0;
  font-size: 11px;
  color: var(--danger-text);
}

.invite-card-btn {
  width: 100%;
  height: 32px;
  font-size: 12.5px;
}
```

(`.user-list-scroll { flex: 1 }` from Task 6 already pins it to the bottom.)

- [ ] **Step 8: Gates**

`npx tsc --noEmit` clean; `npm test` → `Tests 3 failed | 122 passed (125)` (6 more new passes; same 3 known failures); `npm run check:i18n` exit 0; `npm run build:vite` succeeds. Controller smoke on «Redesign Smoke» (the smoke user OWNS it, so the card must show): click «Скопировать ссылку» → button flips to «Скопировано», sub-line shows a derived «Ссылка живёт N дн.» or «Ссылка не истекает» — whatever the server's `expires_at` yields, never a hardcoded 7. Also verify with `--anon`-style second check that a member WITHOUT `CREATE_INVITE` sees no card if feasible; otherwise assert statically that the render is gated on `canInvite`.

- [ ] **Step 9: Commit**

```bash
git add src/utils/inviteExpiry.ts src/utils/inviteExpiry.test.ts src/components/UserList.tsx src/components/UserList.css src/i18n/locales/ru.ts src/i18n/locales/en.ts
git commit -m "feat(redesign): member-list invite card wired to invites API"
```

---

### Task 8: M1 closeout — full gate + visual QA

**Files:** none modified (verification only; fixes found here go through review as a scoped fix wave).

- [ ] **Step 1: Full gates from `client/`**

```bash
npx tsc --noEmit                        # clean
npx tsc -p electron/tsconfig.json --noEmit  # clean (nothing touched, confirm)
npm run check:i18n                      # exit 0 (4 pre-existing ErrorBoundary warnings OK)
npm run build:vite                      # success
npm test                                # Test Files 1 failed | 18 passed (19)
                                        # Tests 3 failed | 122 passed (125) — same known 3
```

- [ ] **Step 2: Grep audits**

```bash
rg -n "🏠|🔍|⚙|📞|📷|📴|🎤|🔇" src/components/{ServerList,ChannelSidebar,UserList,CallDock}.tsx   # → 0 hits
rg -n "avatar-[1-8]" src                                                                      # → 0 hits
rg -n "green-|brand-|--bg-|--text-|--border-|--red-|--radius-sm|--radius-md|--radius-lg|--radius-full|--shadow-sm|--shadow-md" src/components/{ServerList,ChannelSidebar,UserList,CallDock}.css
# legacy aliases may remain ONLY inside the @media (max-width: 768px) mobile blocks (M6's job); desktop rules → 0 hits
```

- [ ] **Step 3: Visual QA, light + dark**

Side-by-side with `design_handoff_discord_redesign/Redesign.dc.html` board `1c`: rail 76 / sidebar 252 / member list 236 measured via computed styles; voice card renders when a second context joins voice; footer + CallDock coherent; no unstyled regions on login page or main screen; zero new console errors.

- [ ] **Step 4: Do NOT push.** Surface to the user: M1 complete, N commits on `redesign`, push withheld (outward-facing).

---

## Self-Review (done at planning time)

- **Spec coverage** (§5 M1 bullet): rail 76px home/divider/tiles/bottom group ✓ T2 · no badges ✓ (none built) · sidebar 252px unified list ✓ T3 · active/idle states ✓ T3 · quiet join affordance ✓ T4 · voice card with participants, mic states, «Войти в канал» ✓ T4 · restyled footer user panel ✓ T5 · CallDock ✓ T5 · member list 236px online/offline groups ✓ T6 · «в голосовом · X» sub-lines ✓ T6 · invite card wired to invites API, permission-hidden, expiry derived from `expires_at` ✓ T7 · M0-flagged decisions resolved ✓ T1/header.
- **Type consistency:** `onServerDeleted: (serverId: string) => void` (T3) matches AppPage's existing `handleServerRemoved`. `voiceChannelNameFor` signature identical in T6 test/impl/JSX. `inviteExpiry` union `{kind:'never'}|{kind:'days';days:number}` used consistently in T7. `.panel-icon-btn`/`.user-avatar-wrap` produced in T5 before T6 consumes them. Avatar `--avatar-bg`/`--avatar-ink` produced in T1, consumed only in T6.
- **Known accepted gaps:** dark-theme `.panel-icon-btn` on `--canvas` is low-contrast → M6 parity pass; 2px header seam vs ChatArea until M2; `window.confirm` until M4; mobile blocks keep legacy aliases until M6.
