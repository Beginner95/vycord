# Redesign M2 — Chat Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the chat column (board `1c` column C) to the handoff design system — single left-aligned message metaphor, new composer, destructive-confirm modal, empty states, unread divider, optimistic delivery, mobile chat — plus two hardening tasks (CSS cascade order, stylelint delta-gate) that must land first.

**Architecture:** `ChatArea.tsx` (1071 lines) splits into `MessageRow`, `Composer`, `FormattingToolbar`, `MentionDropdown`, `ConfirmModal` subcomponents, each with its own prefixed CSS file. New client-side state: `unreadStore` (divider only), `ChatMessage` delivery states in `messageStore`. No API/WS contract changes.

**Tech Stack:** React 19 + Vite + Zustand + plain per-component CSS, lucide-react icons, vitest, stylelint 17.

**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` (§5 M2 bullet, §4.4, §8). Pixel source of truth: `design_handoff_discord_redesign/README.md` — sections "1. Main app screen → Column C", "2. Empty states (2a)", "3. Unread / typing / delivery (2b)", "7. Mobile chat (1f)". Also binding: `docs/superpowers/plans/2026-08-25-redesign-m1-closeout.md` (deferred-finding triage + harness notes).

## Global Constraints

- Branch `redesign` only; one commit per task; **never** commit to `main`; **never** `git add -A` (`design_handoff_discord_redesign/` is untracked on purpose).
- No changes under `server/`; no API/WS contract changes; no changes to `src/services/`; `src/types/index.ts` untouched. Legacy token aliases in `src/styles/tokens.css` stay until M6.
- All work under `client/` unless stated. Product copy is Russian; every new string lands in `src/i18n/locales/ru.ts` **and** `en.ts` together; `npm run check:i18n` must stay exit-0 (4 pre-existing ErrorBoundary warnings are M4's).
- Icons: lucide-react, `strokeWidth={1.8}`, 16–21px (spec §4.2). No emoji as UI icons, no hand-inlined SVGs in touched code.
- Animation budget ≤250ms ease-out (message enter 220ms, popover 120ms, modal 180ms).
- **Test delta-gate:** `npm test` baseline is RED — exactly 3 failures, all in `src/services/__tests__/api.network-retry.test.ts` (plus 2 unhandled rejections from that same file). Gate: no *other* file may fail; new tests must pass. Do not fix that file (out of scope).
- **Stylelint delta-gate (from Task 2 on):** total violation count from `npm run lint:css` must never increase past the recorded baseline, and any file this milestone creates or rewrites must be violation-free. Do NOT mass-fix legacy files — M6 owns that sweep.
- Visual verification: CDP harness `tools/smoke.mjs` (copied into this milestone's workspace by Task 1). Dev server: `cd client && npm run dev:vite` → http://localhost:3000 (**port 3000 exactly** — prod CORS allowlist; port 3001 fallback makes login fail with a CORS error that is not a bug). Test account `redesign_smoke@vycord.local` / `RedesignSmoke2026!`, throwaway server «Redesign Smoke». This is the **production API** — destructive testing only on that server.
- Electron cannot launch (npm 11 skipped its postinstall); verify statically, or `npm install-scripts ls` in `client/` if truly needed.

## Decisions ruled on while planning (binding for this milestone)

1. **`window.confirm` retrofit scope:** M2 replaces only the **message-delete** confirm in ChatArea with the new `ConfirmModal`. The server/channel-delete confirms in `ChannelSidebar.tsx:74,88`, `ServerList.tsx:97` and `StickerManager.tsx:79` stay on `window.confirm` until M4 — M4 rebuilds those menu flows and dedupes the ChannelSidebar/ServerList duplicate anyway, and no release ships between M2 and M4. `ConfirmModal` is built reusable so M4 only swaps call sites.
2. **Header seam:** chat header goes to **58px** (matches sidebar + board). `MessageSearch.css:4` (`top: 56px`) is updated in the same task. Mobile top bar is 56px per board `1f` (Task 12 override).
3. **Dark `--danger-soft`/`--danger-text`:** refined **in M2** (Task 11) — the failed-send chip is a dark surface and M2 owns it. Contrast target ≥4.5:1, verified in the browser; the two `/* refine in M6 */` comments on those lines are removed (the `--own-msg-bg` one stays).
4. **Class-name scheme** (for `selector-class-pattern`): enforced by regex — class names must be multi-segment kebab-case (a component prefix + at least one more segment), with state modifiers as `is-*`/`has-*` and an exact-singles allowlist for the shared primitives `btn|input|kbd|modal|mention`. Prefix **uniqueness** (one namespace = one owner file) is convention enforced in review + ledger, not regex. M2 namespaces: `chat-` + `unread-` (ChatArea.css), `msg-` (MessageRow.css), `composer-` (Composer.css), `fmt-` (FormattingToolbar.css), `mention-` (MentionDropdown.css), `confirm-` (ConfirmModal.css), `emoji-` (EmojiPicker.css), `sticker-picker-`/`sticker-manager-` (two-segment namespaces, separate files).
5. **Empty-state adaptations (2a):** "или закрепить правила канала" ghost link is dropped (no rules feature). The no-servers card gets only the primary «Создать сервер» (wired to AppPage's existing modal); «У меня есть код» waits for M4's merged find-server modal — the rail's working search tile is adjacent. No-search-results restyle applies to `MessageSearch`'s existing empty branch only; the full MessageSearch restyle is M5's.
6. **Header search button** stays icon-only 34×34 in M2; the board's dark-theme `⌘K` chip arrives with the palette (M5). The header voice-join button keeps its behavior, restyled with a lucide `Headphones` icon.
7. **Message grouping window: 5 minutes** (300 000 ms) — changed from today's 7 (420 000 ms), per spec §5.
8. **Optimistic reconciliation** happens on the HTTP response (`replaceMessage(tempId, serverMsg)`), not the WS event — `AppPage.tsx:193` already skips own `chat_message` WS events, so there is no duplicate path.

## File structure after M2

```
client/src/
  components/
    ChatArea.tsx        (rewritten shell: header, list, empty states, unread divider, wiring)
    ChatArea.css        (rewritten: chat-* + unread-* only)
    MessageRow.tsx/.css (new: msg-*  — row, popover, edit-in-place, delivery chips)
    Composer.tsx/.css   (new: composer-*)
    FormattingToolbar.tsx/.css (new: fmt-* — shared by Composer + MessageRow edit)
    MentionDropdown.tsx/.css   (new: mention-* — shared dropdown UI)
    ConfirmModal.tsx/.css      (new: confirm-* — destructive confirmation, board 1d)
    EmojiPicker.css     (new: emoji-* rules move out of ChatArea.css, restyled)
    StickerPicker.css   (new: sticker-picker-* rules move out of ChatArea.css, restyled)
    StickerManager.css  (new: sticker-manager-* rules move out of ChatArea.css, lint-clean only — M4 restyles)
  stores/
    messageStore.ts     (ChatMessage type, replaceMessage, loading)
    unreadStore.ts      (new)
    __tests__/messageStore.test.ts, unreadStore.test.ts (new)
  utils/
    messageGroups.ts    (new) + messageGroups.test.ts
  .stylelintrc.json     (new, in client/)
```

---

### Task 1: Cascade-order fix (styles before App) + full re-verification

The M1 closeout's top deferred finding. `client/src/main.tsx:3` imports `App` before `styles/*`, so ES-module evaluation injects the whole component-CSS graph **before** tokens/base/primitives — at tied specificity `primitives.css` beats every component override (this already killed `.invite-card-btn { height: 32px }` in M1). M2 overrides `.btn`/`.modal`/`.kbd` repeatedly, so this must flip first. It is a **global cascade change**: every existing surface must be re-probed after.

**Files:**
- Modify: `client/src/main.tsx`
- No new files in git. Also copy the M1 harness to this milestone's workspace (not committed; the SDD workspace is gitignored).

**Interfaces:** none (import order only).

- [ ] **Step 1: Preserve the verification harness**

```bash
mkdir -p .superpowers/sdd/2026-08-25-redesign-m2-chat/tools
cp -R .superpowers/sdd/2026-08-25-redesign-m1-app-shell/tools/. .superpowers/sdd/2026-08-25-redesign-m2-chat/tools/
```

Harness flags (from the M1 closeout, don't rediscover): `--out --theme --anon --click --after --type-into/--type-text --fake-electron --probe --preload --push-ws --touch`. `--touch` needs `setTouchEmulationEnabled` + `setDeviceMetricsOverride {mobile:true}` (the `Emulation.setEmulatedMedia` route does NOT work). WS injection must use `dispatchEvent`, not `.onmessage`.

- [ ] **Step 2: Reorder imports in `client/src/main.tsx`**

Replace lines 1–14 so the style layer evaluates before the component graph:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/primitives.css';
import App from './App';
import './stores/themeStore';
import './stores/localeStore';
```

(The rest of the file is unchanged.)

- [ ] **Step 3: Static gates**

Run: `cd client && npx tsc --noEmit && npm test`
Expected: tsc clean; test baseline `Test Files 1 failed | 18 passed (19)`, `Tests 3 failed | 122 passed (125)` — the 3 failures all in `api.network-retry.test.ts`.

- [ ] **Step 4: Browser re-verification of every M1 surface, both themes + touch**

Start `npm run dev:vite` (port 3000). Using the copied harness, re-run the M1 probes and confirm computed values are UNCHANGED except where component CSS was silently losing before (differences must be understood and listed, not waved through):

```bash
node tools/smoke.mjs --probe tools/probe-rail.js --out t1-rail-light.png
node tools/smoke.mjs --theme dark --probe tools/probe-rail.js --out t1-rail-dark.png
node tools/smoke.mjs --probe tools/probe-sidebar.js
node tools/smoke.mjs --theme dark --probe tools/probe-sidebar.js
node tools/smoke.mjs --probe tools/probe-memberlist.js
node tools/smoke.mjs --theme dark --probe tools/probe-memberlist.js
node tools/smoke.mjs --probe tools/probe-invitecard.js       # .invite-card-btn must still be 32px
node tools/smoke.mjs --probe tools/probe-footer.js
node tools/smoke.mjs --theme dark --touch --probe tools/probe-touchpill.js   # the M1 dark+touch join-pill regression class
node tools/smoke.mjs --probe tools/probe-servermenu.js --out t1-servermenu.png  # modal/context-menu surface
```

Expected: all probes pass. Known intentional change class: any component rule that ties with a primitives rule now WINS (was losing). If a probe fails, inspect whether the M1 value depended on primitives winning (then fix the component rule), record each such fix in the ledger.

- [ ] **Step 5: Commit**

```bash
git add client/src/main.tsx
git commit -m "fix(redesign): import style layer before component graph — component CSS now wins specificity ties"
```

---

### Task 2: stylelint with delta-gate

**Files:**
- Create: `client/.stylelintrc.json`
- Modify: `client/package.json` (devDependencies + `lint:css` script)

**Interfaces:**
- Produces: `npm run lint:css` (runs `stylelint "src/**/*.css"`), the recorded baseline (total + per-rule) in the SDD ledger. Every later task's completion gate includes: total ≤ baseline, and files that task created/rewrote are clean (`npx stylelint <files>` → 0 problems).

- [ ] **Step 1: Install exact versions** (verified available on npm)

```bash
cd client && npm install --save-dev --save-exact stylelint@17.14.1 stylelint-config-standard@40.0.0 stylelint-value-no-unknown-custom-properties@6.1.1
```

- [ ] **Step 2: Create `client/.stylelintrc.json`**

```json
{
  "extends": ["stylelint-config-standard"],
  "plugins": ["stylelint-value-no-unknown-custom-properties"],
  "rules": {
    "no-descending-specificity": true,
    "selector-class-pattern": [
      "^(?:btn|input|kbd|modal|mention)$|^(?:is|has)-[a-z0-9]+(?:-[a-z0-9]+)*$|^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$",
      {
        "resolveNestedSelectors": true,
        "message": "Class needs a component prefix (multi-segment kebab-case). State modifiers: is-*/has-*. One namespace = one owner file (see M2 plan, decision 4)."
      }
    ],
    "csstools/value-no-unknown-custom-properties": [
      true,
      { "importFrom": ["src/styles/tokens.css", "src/styles/base.css"] }
    ]
  }
}
```

Rationale recorded here so the ledger can point at it: `no-descending-specificity` is exactly the trap that broke the M1 dark+touch join pill (`@media` adds no specificity); the class pattern forbids the bare classes (`.active`, `.message`, `.self`) that produced today's cross-file duplicates (7 classes shared by CallStage.css/CallUI.css, `.mobile-back-btn` in three files, `.channel-hash` in two); the custom-properties plugin catches `var(--typo)` and replaces check 3 of M1's hand-rolled bash gate (`tools/verify-tokens*.sh`).

Known limitation to note in the ledger: properties injected from JS (`--avatar-color`, `--avatar-bg`, `--avatar-ink`, `--call-stage-height`, `--presence-ring`) are invisible to `importFrom`; existing references sit in the baseline, and new CSS referencing them must carry a `var(--x, fallback)` fallback or be individually ruled on.

- [ ] **Step 3: Add the script to `client/package.json`**

In `"scripts"`, after `"check:i18n"`:

```json
"lint:css": "stylelint \"src/**/*.css\""
```

- [ ] **Step 4: Record the baseline**

```bash
npm run lint:css 2>&1 | tail -3          # total problem count
npm run lint:css -- --formatter json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r={};for(const f of JSON.parse(d))for(const w of f.warnings)r[w.rule]=(r[w.rule]||0)+1;console.log(r)})"
```

Expected: a large nonzero total (legacy files violate heavily, especially `no-descending-specificity`). Record **total and per-rule breakdown** in the SDD ledger verbatim. From now on hold two lines: total never increases; files M2 creates/rewrites are clean. If a rule proves unworkable against this codebase, say so and rule on it in the ledger — never silently disable.

- [ ] **Step 5: Sanity-check the gate catches real problems**

Temporarily add `.x { color: var(--typo-token); }` to `src/styles/primitives.css`, run `npm run lint:css`, confirm BOTH `selector-class-pattern` (`.x` single segment) and `csstools/value-no-unknown-custom-properties` fire; revert the edit.

- [ ] **Step 6: Commit**

```bash
git add client/.stylelintrc.json client/package.json client/package-lock.json
git commit -m "chore(redesign): stylelint delta-gate — config-standard + class-pattern + unknown-custom-properties"
```

---

### Task 3: Message grouping util + messageStore delivery/loading extensions (TDD)

**Files:**
- Create: `client/src/utils/messageGroups.ts`, `client/src/utils/messageGroups.test.ts`
- Modify: `client/src/stores/messageStore.ts`
- Create: `client/src/stores/__tests__/messageStore.test.ts`

**Interfaces (later tasks rely on these exact names):**
- `messageGroups.ts`: `export const GROUP_WINDOW_MS = 300_000;` and `export function isContinuation(prev: Message | undefined, msg: Message): boolean` — true iff `prev` exists, same `user_id`, same calendar day, and `created_at` delta < window.
- `messageStore.ts`: `export type ChatMessage = Message & { deliveryState?: 'sending' | 'failed' }`; state becomes `messages: ChatMessage[]`; new actions `replaceMessage(id: string, message: ChatMessage): void` (swap in place, preserving position) and `loading: boolean` + `setLoading(loading: boolean): void`. Existing actions keep their signatures (`addMessage(message: ChatMessage)` etc.).

- [ ] **Step 1: Write the failing tests**

`client/src/utils/messageGroups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GROUP_WINDOW_MS, isContinuation } from './messageGroups';
import type { Message } from '@/types';

const msg = (over: Partial<Message>): Message => ({
  id: '1', channel_id: 'c', user_id: 'u', content: 'hi',
  created_at: '2026-08-25T12:00:00Z', updated_at: '2026-08-25T12:00:00Z', ...over,
});

describe('isContinuation', () => {
  it('window is 5 minutes', () => expect(GROUP_WINDOW_MS).toBe(300_000));
  it('false without a previous message', () =>
    expect(isContinuation(undefined, msg({}))).toBe(false));
  it('true for same author within 5 min', () =>
    expect(isContinuation(msg({}), msg({ id: '2', created_at: '2026-08-25T12:04:59Z', updated_at: '2026-08-25T12:04:59Z' }))).toBe(true));
  it('false at exactly 5 min', () =>
    expect(isContinuation(msg({}), msg({ id: '2', created_at: '2026-08-25T12:05:00Z', updated_at: '2026-08-25T12:05:00Z' }))).toBe(false));
  it('false for another author', () =>
    expect(isContinuation(msg({}), msg({ id: '2', user_id: 'v', created_at: '2026-08-25T12:01:00Z' }))).toBe(false));
  it('false across a calendar-day boundary even within the window', () =>
    expect(isContinuation(
      msg({ created_at: '2026-08-25T23:58:00' }),   // local time, no Z — day boundary is local
      msg({ id: '2', created_at: '2026-08-26T00:01:00' })
    )).toBe(false));
});
```

`client/src/stores/__tests__/messageStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useMessageStore, type ChatMessage } from '../messageStore';

const m = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, channel_id: 'c', user_id: 'u', content: 'hi',
  created_at: '2026-08-25T12:00:00Z', updated_at: '2026-08-25T12:00:00Z', ...over,
});

beforeEach(() => {
  useMessageStore.setState({ messages: [], loading: false });
});

describe('messageStore delivery/loading', () => {
  it('replaceMessage swaps in place preserving order', () => {
    const s = useMessageStore.getState();
    s.setMessages([m('a'), m('pending-1', { deliveryState: 'sending' }), m('b')]);
    s.replaceMessage('pending-1', m('server-id'));
    expect(useMessageStore.getState().messages.map((x) => x.id)).toEqual(['a', 'server-id', 'b']);
    expect(useMessageStore.getState().messages[1].deliveryState).toBeUndefined();
  });
  it('replaceMessage with unknown id is a no-op', () => {
    const s = useMessageStore.getState();
    s.setMessages([m('a')]);
    s.replaceMessage('nope', m('x'));
    expect(useMessageStore.getState().messages.map((x) => x.id)).toEqual(['a']);
  });
  it('updateMessage can set and clear deliveryState', () => {
    const s = useMessageStore.getState();
    s.setMessages([m('p', { deliveryState: 'sending' })]);
    s.updateMessage('p', { deliveryState: 'failed' });
    expect(useMessageStore.getState().messages[0].deliveryState).toBe('failed');
  });
  it('setLoading toggles', () => {
    useMessageStore.getState().setLoading(true);
    expect(useMessageStore.getState().loading).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/utils/messageGroups.test.ts src/stores/__tests__/messageStore.test.ts`
Expected: FAIL — module `./messageGroups` not found; `replaceMessage` not a function.

- [ ] **Step 3: Implement**

`client/src/utils/messageGroups.ts`:

```ts
import type { Message } from '@/types';
import { isSameCalendarDay } from '@/i18n';

/** Spec §5 M2: grouping window is 5 minutes (was 7 before the redesign). */
export const GROUP_WINDOW_MS = 300_000;

/** A grouped continuation row: same author, same local calendar day, < 5 min apart. */
export function isContinuation(prev: Message | undefined, msg: Message): boolean {
  if (!prev || prev.user_id !== msg.user_id) return false;
  const a = new Date(prev.created_at);
  const b = new Date(msg.created_at);
  if (!isSameCalendarDay(a, b)) return false;
  return b.getTime() - a.getTime() < GROUP_WINDOW_MS;
}
```

`client/src/stores/messageStore.ts` — full new content:

```ts
import { create } from 'zustand';
import type { Message } from '@/types';

/** Client-only delivery state for optimistic send (spec §4.4). Never sent to the server. */
export type ChatMessage = Message & { deliveryState?: 'sending' | 'failed' };

interface MessageState {
  messages: ChatMessage[];
  loading: boolean;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  replaceMessage: (id: string, message: ChatMessage) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  loading: false,

  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  replaceMessage: (id, message) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? message : m)),
    })),
  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((m) => m.id !== id) })),
  clearMessages: () => set({ messages: [] }),
  setLoading: (loading) => set({ loading }),
}));
```

- [ ] **Step 4: Run the tests + full gates**

Run: `npx vitest run src/utils/messageGroups.test.ts src/stores/__tests__/messageStore.test.ts` → PASS.
Run: `npx tsc --noEmit && npm test` → only the 3 known `api.network-retry` failures.
Run: `npm run lint:css` → total unchanged (no CSS touched).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/messageGroups.ts client/src/utils/messageGroups.test.ts client/src/stores/messageStore.ts client/src/stores/__tests__/messageStore.test.ts
git commit -m "feat(redesign): 5-min grouping util + messageStore delivery states, replaceMessage, loading flag"
```

---

### Task 4: unreadStore (TDD)

Divider-only scope per spec §4.4: a persisted last-read mark per channel; `firstUnreadId` computed against fetched messages on channel entry; the mark advances when the last message enters the viewport (wired in Task 10). **No sidebar bars, no rail badges** (server only pushes events for the viewed channel — spec §3).

**Files:**
- Create: `client/src/stores/unreadStore.ts`, `client/src/stores/__tests__/unreadStore.test.ts`

**Interfaces:**
- `export interface LastReadMark { messageId: string; ts: string }`
- `useUnreadStore`: `{ lastRead: Record<string, LastReadMark>; markRead(channelId: string, messageId: string, ts: string): void }` — persisted to `localStorage` key `vycord.lastRead` (read once at store creation, written on every `markRead`).
- `export function firstUnreadId(mark: LastReadMark | undefined, messages: Message[]): string | null` — pure: `null` if no messages; if no mark, `null` (a never-visited channel shows no divider — everything unread is meaningless noise on first visit); else the id of the first message with `ts > mark.ts` **and** `id !== mark.messageId`, or `null` if none.

- [ ] **Step 1: Write the failing tests**

`client/src/stores/__tests__/unreadStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useUnreadStore, firstUnreadId } from '../unreadStore';
import type { Message } from '@/types';

const m = (id: string, ts: string): Message => ({
  id, channel_id: 'c', user_id: 'u', content: 'x', created_at: ts, updated_at: ts,
});

beforeEach(() => {
  window.localStorage.removeItem('vycord.lastRead');
  useUnreadStore.setState({ lastRead: {} });
});

describe('unreadStore', () => {
  it('markRead stores and persists the mark', () => {
    useUnreadStore.getState().markRead('c1', 'm9', '2026-08-25T12:00:00Z');
    expect(useUnreadStore.getState().lastRead.c1).toEqual({ messageId: 'm9', ts: '2026-08-25T12:00:00Z' });
    expect(JSON.parse(window.localStorage.getItem('vycord.lastRead')!)).toHaveProperty('c1');
  });
  it('firstUnreadId: no mark → null (first visit shows no divider)', () => {
    expect(firstUnreadId(undefined, [m('a', '2026-08-25T10:00:00Z')])).toBeNull();
  });
  it('firstUnreadId: returns first message after the mark', () => {
    const mark = { messageId: 'a', ts: '2026-08-25T10:00:00Z' };
    const msgs = [m('a', '2026-08-25T10:00:00Z'), m('b', '2026-08-25T10:01:00Z'), m('c', '2026-08-25T10:02:00Z')];
    expect(firstUnreadId(mark, msgs)).toBe('b');
  });
  it('firstUnreadId: everything read → null', () => {
    const mark = { messageId: 'b', ts: '2026-08-25T10:01:00Z' };
    const msgs = [m('a', '2026-08-25T10:00:00Z'), m('b', '2026-08-25T10:01:00Z')];
    expect(firstUnreadId(mark, msgs)).toBeNull();
  });
  it('firstUnreadId: empty list → null', () => {
    expect(firstUnreadId({ messageId: 'a', ts: '2026-08-25T10:00:00Z' }, [])).toBeNull();
  });
  it('markRead survives a corrupt localStorage payload', () => {
    window.localStorage.setItem('vycord.lastRead', '{not json');
    useUnreadStore.getState().markRead('c1', 'm1', '2026-08-25T12:00:00Z');
    expect(useUnreadStore.getState().lastRead.c1.messageId).toBe('m1');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/stores/__tests__/unreadStore.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `client/src/stores/unreadStore.ts`**

```ts
import { create } from 'zustand';
import type { Message } from '@/types';

export interface LastReadMark { messageId: string; ts: string }

const STORAGE_KEY = 'vycord.lastRead';

function load(): Record<string, LastReadMark> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

interface UnreadState {
  lastRead: Record<string, LastReadMark>;
  markRead: (channelId: string, messageId: string, ts: string) => void;
}

export const useUnreadStore = create<UnreadState>((set) => ({
  lastRead: load(),
  markRead: (channelId, messageId, ts) =>
    set((state) => {
      const next = { ...state.lastRead, [channelId]: { messageId, ts } };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* стор — источник правды в рантайме; квота/приватный режим не роняют чат */
      }
      return { lastRead: next };
    }),
}));

/**
 * Divider anchor, computed once on channel entry (spec §4.4): the first
 * message strictly after the stored mark. No mark (never-visited channel) →
 * no divider.
 */
export function firstUnreadId(mark: LastReadMark | undefined, messages: Message[]): string | null {
  if (!mark || messages.length === 0) return null;
  const found = messages.find((m) => m.id !== mark.messageId && m.created_at > mark.ts);
  return found ? found.id : null;
}
```

Note: `created_at > mark.ts` compares ISO-8601 strings from the same server clock — lexicographic order equals chronological order for a uniform format; both values come from the API untouched.

- [ ] **Step 4: Run tests + gates** — target file PASS; `npx tsc --noEmit && npm test` delta-clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/stores/unreadStore.ts client/src/stores/__tests__/unreadStore.test.ts
git commit -m "feat(redesign): unreadStore — persisted last-read marks + firstUnreadId selector"
```

---

### Task 5: ConfirmModal (destructive confirmation, board 1d) + message-delete retrofit

**Files:**
- Create: `client/src/components/ConfirmModal.tsx`, `client/src/components/ConfirmModal.css`
- Modify: `client/src/components/ChatArea.tsx` (the `handleDelete` at line 680), `client/src/i18n/locales/ru.ts`, `en.ts`

**Interfaces:**
- Produces: `ConfirmModal` with props `{ open: boolean; title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }`. Renders `null` when `!open`. Reuses `.modal-overlay` from primitives; Esc and overlay-click cancel; the confirm button is the solid `danger` role. Later milestones (M4) reuse it for server/channel/sticker deletes.

- [ ] **Step 1: i18n strings (ru + en together)**

In `ru.ts` chat section, next to the existing `deleteConfirm` (line 60): add

```ts
    deleteTitle: 'Удалить сообщение?',
    deleteBody: 'Сообщение будет удалено навсегда. Это действие нельзя отменить.',
```

In `en.ts` mirror: `deleteTitle: 'Delete message?'`, `deleteBody: 'The message will be deleted forever. This cannot be undone.'`. (Existing `common.cancel`/`common.delete` are reused for buttons.) The old `chat.deleteConfirm` string becomes unused by ChatArea but STAYS (StickerManager-adjacent cleanup is M4's; `check:i18n` tolerates it — verify).

- [ ] **Step 2: `ConfirmModal.tsx`**

```tsx
import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useT } from '@/i18n';
import './ConfirmModal.css';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ open, title, body, confirmLabel, onConfirm, onCancel }: ConfirmModalProps) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-icon">
          <AlertTriangle size={18} strokeWidth={1.8} />
        </div>
        <h3 className="confirm-modal-title">{title}</h3>
        <p className="confirm-modal-body">{body}</p>
        <div className="confirm-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `ConfirmModal.css`** (board 1d: 300px, r16, padding 20; 40px r12 danger-soft tile; title 16/700; body 12.5/400/1.5 muted; two equal buttons)

```css
/* Destructive confirmation — board 1d. Reused app-wide from M4 on. */
.confirm-modal {
  width: 300px;
  padding: 20px;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-modal);
  animation: modalIn 0.18s var(--ease-out);
}

.confirm-modal-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--danger-soft);
  color: var(--danger-text);
  margin-bottom: 12px;
}

.confirm-modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 6px;
}

.confirm-modal-body {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--muted);
  margin-bottom: 16px;
}

.confirm-modal-actions {
  display: flex;
  gap: 8px;
}

.confirm-modal-actions .btn {
  flex: 1;
}
```

(`modalIn` keyframes already exist in `primitives.css` and now load first thanks to Task 1.)

- [ ] **Step 4: Retrofit ChatArea's message delete**

In `ChatArea.tsx`: add state `const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);`. Replace the body of `handleDelete` (line 680–697): the `window.confirm` line is deleted; `handleDelete(messageId)` becomes `setConfirmDeleteId(messageId)`, and the actual API call moves to:

```tsx
  const confirmDelete = async () => {
    const messageId = confirmDeleteId;
    setConfirmDeleteId(null);
    if (!channel || !messageId) return;
    try {
      await apiService.deleteMessage(channel.id, messageId);
      removeMessage(messageId);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'message_not_found') {
        removeMessage(messageId);
        return;
      }
      logger.error('Failed to delete message:', err, { module: 'chat' });
    }
  };
```

(Keep the existing already-deleted-server-side comment with the moved code.) Render before `</main>`:

```tsx
      <ConfirmModal
        open={confirmDeleteId !== null}
        title={t('chat.deleteTitle')}
        body={t('chat.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
```

- [ ] **Step 5: Gates + visual check**

`npx tsc --noEmit && npm test && npm run check:i18n` — delta-clean, exit 0.
`npx stylelint src/components/ConfirmModal.css` → 0 problems; `npm run lint:css` total ≤ baseline.
Browser: send a message as the smoke account, click delete, screenshot the modal in both themes:
`node tools/smoke.mjs --click '.msg-действие…'` — at this task the old `.message-action-btn` delete button still exists; click it and `--out t5-confirm-light.png` / `--theme dark --out t5-confirm-dark.png`. Confirm deletes; Esc/overlay/Отмена cancel.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ConfirmModal.tsx client/src/components/ConfirmModal.css client/src/components/ChatArea.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): destructive-confirm modal replaces window.confirm for message delete"
```

---

### Task 6: Message list rewrite — MessageRow, unified metaphor, header 58px, popover, skeleton, enter animation

The core of M2 (board 1c column C). `ChatArea.tsx` sheds the per-message JSX into `MessageRow.tsx`; the asymmetric `.message.self`/`.message.other` bubbles become one left-aligned grid; the shared formatting toolbar and mention dropdown are extracted (Composer consumes them in Task 7).

**Files:**
- Create: `client/src/components/MessageRow.tsx`, `MessageRow.css`, `FormattingToolbar.tsx`, `FormattingToolbar.css`, `MentionDropdown.tsx`, `MentionDropdown.css`
- Modify: `client/src/components/ChatArea.tsx`, **rewrite** `client/src/components/ChatArea.css` (chat-* / unread-* only; emoji/sticker rules move in Task 8 — until then they stay at the bottom of ChatArea.css unchanged and are counted in the lint baseline), `client/src/components/DayDivider.css` (restyle to tokens), `client/src/components/MessageSearch.css:4` (top 56px → 58px), `client/src/pages/AppPage.tsx` (setLoading in `handleSelectChannel`/`loadServers`), `client/src/i18n/locales/ru.ts` + `en.ts`
- Test: behavior covered by Task 3's grouping tests + browser probes (JSX rendering is verified in-browser; the codebase has no component-render test setup — do not introduce one here).

**Interfaces:**
- Consumes: `isContinuation`/`GROUP_WINDOW_MS` (Task 3), `ChatMessage` + `loading` (Task 3), `ConfirmModal` flow (Task 5).
- Produces:
  - `MessageRow` props: `{ msg: ChatMessage; isOwn: boolean; isContinuation: boolean; displayName: string; avatarUrl?: string; isEditing: boolean; highlighted: boolean; entered: boolean; members: MemberWithUser[]; currentUserId?: string; canMentionEveryone: boolean; onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: (content: string) => Promise<void>; onDelete: () => void; onQuote: () => void; onRetry?: () => void }` (`onRetry` unused until Task 11).
  - `FormattingToolbar` props: `{ onWrap: (marker: string) => void; onBullet: () => void; onNumbered: () => void; onLink: () => void; onEmojiToggle: () => void; emojiOpen: boolean; quote?: { active: boolean; onToggle: () => void } }` — renders the B/I/U/link/ol/ul/(quote)/emoji buttons as `fmt-btn` 28×28 r7, lucide `Bold/Italic/Underline/Link2/ListOrdered/List/Quote/Smile` 15px.
  - `MentionDropdown` props: `{ mention: ReturnType<typeof useMentionAutocomplete> }` — renders the `mention-dropdown` list (returns `null` when closed), row classes `mention-item` / `is-active`.
- CSS class inventory produced (Tasks 9–12 extend these): `chat-area, chat-header, chat-header-hash, chat-header-name, chat-header-divider, chat-header-actions, chat-voice-btn, chat-search-btn, chat-members-btn, chat-back-btn, chat-messages, chat-skel-row, chat-skel-avatar, chat-skel-line, chat-error-toast, chat-jump-btn` · `msg-row, msg-row--own, msg-row--continuation, msg-row--enter, msg-row--highlight, msg-gutter, msg-gutter-time, msg-avatar, msg-content, msg-header, msg-author, msg-own-chip, msg-time, msg-body, msg-quote-block, msg-sticker, msg-actions, msg-action-btn, msg-edit, msg-edit-input`.

- [ ] **Step 1: Extract `MentionDropdown.tsx` + css**

```tsx
import type { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import './MentionDropdown.css';

export function MentionDropdown({ mention }: { mention: ReturnType<typeof useMentionAutocomplete> }) {
  if (mention.mentionQuery === null || mention.mentionEntries.length === 0) return null;
  return (
    <ul className="mention-dropdown" role="listbox">
      {mention.mentionEntries.map((entry, i) => (
        <li
          key={mention.entryKey(entry)}
          role="option"
          aria-selected={i === mention.mentionIndex}
          className={`mention-item${i === mention.mentionIndex ? ' is-active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); mention.selectEntry(entry); }}
        >
          @{entry.label}
        </li>
      ))}
    </ul>
  );
}
```

`MentionDropdown.css` — popover per system (white, `1px solid var(--line)`, r10, `var(--shadow-popover)`, absolute above the field, rows 13.5/500 padding 7px 10px r7, active row `accent-soft` bg + `accent` text):

```css
.mention-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 220px;
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow-popover);
  list-style: none;
  z-index: 30;
}

.mention-item {
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ink);
  cursor: pointer;
}

.mention-item:hover,
.mention-item.is-active {
  background: var(--accent-soft);
  color: var(--accent-text);
}
```

- [ ] **Step 2: Extract `FormattingToolbar.tsx` + css**

```tsx
import { Bold, Italic, Underline, Link2, ListOrdered, List, Quote, Smile } from 'lucide-react';
import { useT } from '@/i18n';
import './FormattingToolbar.css';

interface FormattingToolbarProps {
  onWrap: (marker: string) => void;
  onBullet: () => void;
  onNumbered: () => void;
  onLink: () => void;
  onEmojiToggle: () => void;
  emojiOpen: boolean;
  quote?: { active: boolean; onToggle: () => void };
}

export function FormattingToolbar({ onWrap, onBullet, onNumbered, onLink, onEmojiToggle, emojiOpen, quote }: FormattingToolbarProps) {
  const t = useT();
  const prevent = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="fmt-toolbar" role="toolbar" aria-label={t('chat.formatting')}>
      {quote && (
        <button type="button" onMouseDown={prevent} className={`fmt-btn${quote.active ? ' is-active' : ''}`} aria-pressed={quote.active} aria-label={t('chat.quote')} title={t('chat.quote')} onClick={quote.onToggle}>
          <Quote size={15} strokeWidth={1.8} />
        </button>
      )}
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.bold')} title={t('chat.bold')} onClick={() => onWrap('**')}><Bold size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.italic')} title={t('chat.italic')} onClick={() => onWrap('*')}><Italic size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.underline')} title={t('chat.underline')} onClick={() => onWrap('__')}><Underline size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.link')} title={t('chat.link')} onClick={onLink}><Link2 size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.numberedList')} title={t('chat.numberedList')} onClick={onNumbered}><ListOrdered size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.bulletedList')} title={t('chat.bulletedList')} onClick={onBullet}><List size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className={`fmt-btn${emojiOpen ? ' is-active' : ''}`} aria-label={t('chat.emoji')} title={t('chat.emoji')} onClick={onEmojiToggle}><Smile size={15} strokeWidth={1.8} /></button>
    </div>
  );
}
```

`FormattingToolbar.css`:

```css
.fmt-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
}

.fmt-btn {
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

.fmt-btn:hover {
  background: var(--canvas-2);
  color: var(--ink);
}

.fmt-btn.is-active {
  background: var(--accent-soft);
  color: var(--accent-text);
}
```

Note the sticker button is NOT here — it is composer-only chrome (Task 7); the edit toolbar never had it.

- [ ] **Step 3: `MessageRow.tsx`**

Move `renderMessageContent`, `renderInlineNodes`, `renderMessageBody` from `ChatArea.tsx` into this file unchanged (they render mentions + markdown; only the CSS class `message-quote` renames to `msg-quote-block`, `.mention*` classes stay). Full component:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Pencil, Trash2, Quote, Clock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { FormattingToolbar } from '@/components/FormattingToolbar';
import { MentionDropdown } from '@/components/MentionDropdown';
import { EmojiPicker } from '@/components/EmojiPicker';
import { LinkDialog } from '@/components/LinkDialog';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { toggleWrap, toggleBullet, toggleNumbered, type LineToggle } from '@/utils/textTransforms';
import { resolveUploadUrl } from '@/services/api';
import { useT, useDateFormat } from '@/i18n';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';
import './MessageRow.css';

/* renderMessageContent / renderInlineNodes / renderMessageBody: moved
   verbatim from ChatArea.tsx (lines 55–130) — see Step 3 note. */

interface MessageRowProps {
  msg: ChatMessage;
  isOwn: boolean;
  isContinuation: boolean;
  displayName: string;
  avatarUrl?: string;
  isEditing: boolean;
  highlighted: boolean;
  entered: boolean;
  members: MemberWithUser[];
  currentUserId?: string;
  canMentionEveryone: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (content: string) => Promise<void>;
  onDelete: () => void;
  onQuote: () => void;
  onRetry?: () => void;
}

export function MessageRow(props: MessageRowProps) {
  const { msg, isOwn, isContinuation, displayName, avatarUrl, isEditing, highlighted, entered } = props;
  const t = useT();
  const { formatTime } = useDateFormat();
  const isEdited = msg.updated_at !== msg.created_at;
  const time = formatTime(new Date(msg.created_at));

  const rowClass = [
    'msg-row',
    isOwn ? 'msg-row--own' : '',
    isContinuation ? 'msg-row--continuation' : '',
    entered ? 'msg-row--enter' : '',
    highlighted ? 'msg-row--highlight' : '',
    msg.deliveryState === 'sending' ? 'msg-row--sending' : '',
    msg.deliveryState === 'failed' ? 'msg-row--failed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div data-message-id={msg.id} className={rowClass}>
      <div className="msg-gutter">
        {isContinuation
          ? <span className="msg-gutter-time">{time}</span>
          : <Avatar url={avatarUrl} username={displayName} className="msg-avatar" />}
      </div>
      <div className="msg-content">
        {!isContinuation && (
          <div className="msg-header">
            <span className="msg-author">{displayName}</span>
            {isOwn && <span className="msg-own-chip">{t('chat.youChip')}</span>}
            <span className="msg-time">
              {time}
              {isEdited && t('chat.edited')}
            </span>
          </div>
        )}
        {isEditing
          ? <MessageEditor initial={msg.content} {...props} />
          : msg.sticker_id && msg.sticker
            ? <img className="msg-sticker" src={resolveUploadUrl(msg.sticker.image_url)} alt={msg.sticker.name} />
            : msg.sticker_id
              ? <div className="msg-body">{t('chat.stickerRemoved')}</div>
              : <div className="msg-body">{renderMessageBody(msg.content, props.members, t, props.currentUserId)}</div>}
      </div>
      {!isEditing && !msg.deliveryState && (
        <div className="msg-actions">
          <button type="button" className="msg-action-btn" aria-label={t('chat.quote')} title={t('chat.quote')} onClick={props.onQuote}>
            <Quote size={15} strokeWidth={1.8} />
          </button>
          {isOwn && !msg.sticker_id && (
            <button type="button" className="msg-action-btn" aria-label={t('common.edit')} title={t('common.edit')} onClick={props.onStartEdit}>
              <Pencil size={15} strokeWidth={1.8} />
            </button>
          )}
          {isOwn && (
            <button type="button" className="msg-action-btn msg-action-btn--danger" aria-label={t('common.delete')} title={t('common.delete')} onClick={props.onDelete}>
              <Trash2 size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

`MessageEditor` (same file, below): owns `value` state seeded from `initial`, its own `useMentionAutocomplete` (mounted only while editing), its own `EmojiPicker` toggle and `LinkDialog` (local `linkOpen` state — `onBlur` skips `onCancelEdit()` while `linkOpen`), auto-resizing textarea (`msg-edit-input`), `FormattingToolbar` wired to local `wrap/bullet/numbered` helpers copied from ChatArea's `applyRangeToggle`/`wrapSelection` pattern (operating on the local ref), Enter→`onSaveEdit(value.trim())`, Escape→`onCancelEdit`. This removes the edit-path state (`editingId` aside), `editValue`, `editInputRef`, `editMention`, `editSelectionToolbar`, `editWrap/editBullet/editNumbered`, `editEmojiPickerOpen`, and the duplicated toolbar JSX from ChatArea. The edit-selection floating-quote toolbar is dropped — quoting your own text mid-edit was an artifact of the old UI; the popover quote covers the use case (record in ledger).

- [ ] **Step 4: `MessageRow.css`** — the board 1c column C values:

```css
/* Single left-aligned metaphor — board 1c column C */
.msg-row {
  position: relative;
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 0 12px;
  padding: 5px 8px;
  border-radius: 10px;
}

.msg-row--continuation {
  padding: 3px 8px;
}

.msg-row:hover {
  background: var(--canvas-2);
}

.msg-row--own {
  background: var(--own-msg-bg);
  border-left: 2px solid var(--accent);
  padding-left: 6px; /* 8px − 2px border keeps the grid aligned */
}

.msg-gutter {
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
}

.msg-avatar {
  width: 38px;
  height: 38px;
  border-radius: 13px;
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}

.msg-gutter-time {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--faint);
  opacity: 0;
  padding-top: 3px;
}

.msg-row:hover .msg-gutter-time {
  opacity: 1;
}

.msg-content {
  min-width: 0;
}

.msg-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 1px;
}

.msg-author {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink);
}

.msg-row--own .msg-author {
  color: var(--accent-text);
}

.msg-own-chip {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--muted-2);
  background: var(--own-chip-bg);
  border-radius: 5px;
  padding: 2px 6px;
}

.msg-time {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--faint);
}

.msg-body {
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink);
  word-wrap: break-word;
  white-space: pre-wrap;
}

.msg-quote-block {
  display: block;
  border-left: 3px solid var(--line-strong);
  padding-left: 10px;
  color: var(--muted);
}

.msg-sticker {
  max-width: 160px;
  max-height: 160px;
  border-radius: 12px;
}

/* Hover action popover: top −14 / right 10, 120ms fade */
.msg-actions {
  position: absolute;
  top: -14px;
  right: 10px;
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow-popover);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s var(--ease-out);
  z-index: 5;
}

.msg-row:hover .msg-actions,
.msg-row:focus-within .msg-actions {
  opacity: 1;
  pointer-events: auto;
}

.msg-action-btn {
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
}

.msg-action-btn:hover {
  background: var(--canvas-2);
  color: var(--ink);
}

.msg-action-btn--danger:hover {
  background: var(--danger-soft);
  color: var(--danger-text);
}

/* Enter animation — 220ms ease-out (board 2b msgin) */
@keyframes msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.msg-row--enter {
  animation: msg-in 0.22s var(--ease-out);
}

.msg-row--highlight {
  animation: msg-jump-flash 2.2s var(--ease-out);
}

@keyframes msg-jump-flash {
  0%, 40% { background: var(--accent-soft); }
  100% { background: transparent; }
}

.msg-edit {
  position: relative;
}

.msg-edit-input {
  width: 100%;
  resize: none;
  border: 1.5px solid var(--accent);
  border-radius: 10px;
  box-shadow: var(--focus-ring);
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  padding: 8px 10px;
  outline: none;
}
```

Add token `--own-chip-bg` to `src/styles/tokens.css`: light `#E9ECF5` (board), dark `rgba(255, 255, 255, 0.08)` — placed with the other chat tokens, NOT in the alias block.

- [ ] **Step 5: Rewrite `ChatArea.tsx` message-list section + header**

Keep: user-cache effects, WS subscriptions, jump/history logic, search open/close, sticker fetch, sendError toast, `ConfirmModal` wiring (now `onDelete={() => setConfirmDeleteId(msg.id)}` через props), FloatingQuoteButton for the **chat-selection** toolbar (compose/edit ones move in Tasks 6/7). Replace the `messages.map` block with:

```tsx
            {messages.map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const msgDate = new Date(msg.created_at);
              const dayChanged = !prevMsg || !isSameCalendarDay(msgDate, new Date(prevMsg.created_at));
              const isOwn = msg.user_id === user?.id;
              const continuation = !dayChanged && isContinuation(prevMsg, msg);
              const member = !isOwn ? members.find((m) => m.user_id === msg.user_id) : undefined;
              const cached = !isOwn ? userCache.get(msg.user_id) : undefined;
              const displayName = isOwn ? user!.username : (member?.username ?? cached?.username ?? msg.user_id.slice(0, 8));
              const avatarUrl = isOwn ? user?.avatar_url : (member?.avatar_url ?? cached?.avatar_url);
              return (
                <Fragment key={msg.id}>
                  {dayChanged && <DayDivider label={formatFullDate(msgDate)} />}
                  <MessageRow
                    msg={msg}
                    isOwn={isOwn}
                    isContinuation={continuation}
                    displayName={displayName}
                    avatarUrl={avatarUrl}
                    isEditing={editingId === msg.id}
                    highlighted={highlightedId === msg.id}
                    entered={enteredIds.has(msg.id)}
                    members={members}
                    currentUserId={user?.id}
                    canMentionEveryone={canMentionEveryone}
                    onStartEdit={() => setEditingId(msg.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={(content) => saveEdit(msg.id, content)}
                    onDelete={() => setConfirmDeleteId(msg.id)}
                    onQuote={() => insertQuoteIntoCompose(msg.content)}
                  />
                </Fragment>
              );
            })}
```

`saveEdit(messageId, content)` keeps its current API logic but takes content as a parameter (no `editValue` state left in ChatArea). Enter-animation bookkeeping:

```tsx
  // Rows appended after the initial channel render animate in (220ms);
  // the initial batch must not stagger-flash on channel switch.
  const initialIdsRef = useRef<Set<string> | null>(null);
  const [enteredIds, setEnteredIds] = useState<Set<string>>(new Set());
  useEffect(() => { initialIdsRef.current = null; setEnteredIds(new Set()); }, [channel?.id]);
  useEffect(() => {
    if (loading) return;
    if (initialIdsRef.current === null) {
      initialIdsRef.current = new Set(messages.map((m) => m.id));
      return;
    }
    const fresh = messages.filter((m) => !initialIdsRef.current!.has(m.id));
    if (fresh.length) {
      setEnteredIds((prev) => {
        const next = new Set(prev);
        fresh.forEach((m) => { next.add(m.id); initialIdsRef.current!.add(m.id); });
        return next;
      });
    }
  }, [messages, loading]);
```

Header JSX (58px; hash → name → right-side actions; lucide `Hash`, `Search`, `Users`, `Headphones`, `ChevronLeft`, `Mic` for the mobile call button):

```tsx
      <div className="chat-header">
        {onMobileBack && (
          <button className="chat-back-btn" onClick={onMobileBack} aria-label={t('chat.back')}>
            <ChevronLeft size={18} strokeWidth={1.8} />
          </button>
        )}
        <Hash size={17} strokeWidth={1.8} className="chat-header-hash" />
        <h3 className="chat-header-name">{channel.name}</h3>
        <div className="chat-header-actions">
          {onJoinVoice && (
            <button type="button" className={`chat-voice-btn${callChannelId === channel.id ? ' is-in-call' : ''}`} …existing handler/title logic… >
              <Headphones size={16} strokeWidth={1.8} />
              <span>{…existing label logic…}</span>
            </button>
          )}
          <button type="button" className={`chat-search-btn${searchOpen ? ' is-active' : ''}`} …existing… >
            <Search size={17} strokeWidth={1.8} />
          </button>
          {onShowCall && <button className="chat-call-btn" …existing…><Mic size={17} strokeWidth={1.8} /></button>}
          {onShowMembers && <button className="chat-members-btn" …existing…><Users size={17} strokeWidth={1.8} /></button>}
        </div>
      </div>
```

(`…existing…` = the exact handlers/aria/title logic already at ChatArea.tsx:727–770 — behavior unchanged, only classes/icons change. The `.chat-voice-btn.in-call` orphan dies here: the class becomes `is-in-call` WITH a defined style.)

- [ ] **Step 6: Rewrite `ChatArea.css`** (keep the emoji/sticker/mention legacy blocks untouched at the bottom until Task 8; everything else replaced). Key blocks:

```css
.chat-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
}

/* Header — 58px, closes the M1 56/58 seam (board column C) */
.chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 58px;
  min-height: 58px;
  padding: 0 18px;
  border-bottom: 1px solid var(--line);
}

.chat-header-hash { color: var(--muted-2); flex-shrink: 0; }

.chat-header-name {
  font-size: 15.5px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-voice-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: var(--canvas);
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.chat-voice-btn:hover:not(:disabled) { color: var(--ink); background: var(--canvas-2); }
.chat-voice-btn.is-in-call { background: var(--accent-soft); border-color: var(--accent-border); color: var(--accent-text); }

.chat-search-btn,
.chat-members-btn,
.chat-call-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: var(--canvas);
  color: var(--muted);
  cursor: pointer;
}

.chat-search-btn:hover, .chat-members-btn:hover, .chat-call-btn:hover { color: var(--ink); background: var(--canvas-2); }
.chat-search-btn.is-active { background: var(--accent-soft); border-color: var(--accent-border); color: var(--accent-text); }

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px 8px;
  display: flex;
  flex-direction: column;
}

/* Skeleton loading — avatar circle + two bars, line fill, 1.2s shimmer */
.chat-skel-row {
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 0 12px;
  padding: 5px 8px;
}

.chat-skel-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--line);
}

.chat-skel-line {
  height: 12px;
  border-radius: 6px;
  background: var(--line);
  margin-bottom: 8px;
}

.chat-skel-line--short { width: 30%; }
.chat-skel-line--long { width: 70%; }

.chat-skel-row, .chat-skel-avatar, .chat-skel-line {
  animation: chat-shimmer 1.2s ease-in-out infinite;
}

@keyframes chat-shimmer {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
```

Skeleton JSX in ChatArea (rendered when `loading`): six `chat-skel-row`s, each `<div className="chat-skel-row"><div className="chat-skel-avatar"/><div><div className="chat-skel-line chat-skel-line--short"/><div className="chat-skel-line chat-skel-line--long"/></div></div>`. Mobile block, `.chat-error-toast` (renamed from `.error-toast`), `.chat-jump-btn` (renamed `.back-to-latest-btn`, lucide `ArrowDown`), `.floating-quote-btn` → rename to `chat-quote-float` (still ChatArea-owned): carry over the existing rules with new names and tokens (`--bg-*`/`--text-*` aliases → `--canvas`/`--ink`/etc.). The old `.chat-header--empty`, `.welcome-message`, `.chat-empty` survive renamed (`chat-welcome-*`) until Task 9 replaces their contents. `DayDivider.css` restyle: label 11.5/600 `var(--muted-2)`, lines `var(--line)`, margins 14px top / 10px below, background token `var(--canvas)`.

- [ ] **Step 7: AppPage loading flag**

In `handleSelectChannel` (AppPage.tsx:507): `useMessageStore.getState().setLoading(true);` before the `try`, and `finally { useMessageStore.getState().setLoading(false); }` around the fetch. Same pattern around the message fetch in `loadServers` (line 430).

- [ ] **Step 8: i18n**

New keys ru/en: `chat.youChip: 'вы' / 'you'`, `chat.formatting: 'Форматирование' / 'Formatting'`. Verify `check:i18n` exit 0.

- [ ] **Step 9: Gates**

`npx tsc --noEmit && npm test && npm run check:i18n` — delta-clean.
`npx stylelint src/components/{MessageRow,FormattingToolbar,MentionDropdown,DayDivider}.css` → 0 problems. `src/components/ChatArea.css` — clean except the untouched legacy emoji/sticker block (list its remaining violations in the ledger; they vanish in Task 8). `npm run lint:css` total ≤ baseline.

- [ ] **Step 10: Browser verification (both themes + touch)**

With the smoke account (server «Redesign Smoke»):

```bash
node tools/smoke.mjs --out t6-chat-light.png
node tools/smoke.mjs --theme dark --out t6-chat-dark.png
node tools/smoke.mjs --probe probe-chat.js            # write for this task
node tools/smoke.mjs --theme dark --touch --out t6-chat-touch-dark.png
```

Write `probe-chat.js` asserting computed values: `.chat-header` height 58; `.msg-row` grid-template-columns `42px 1fr`; own row background = resolved `--own-msg-bg` and border-left `2px solid` accent; continuation row has no `.msg-avatar`; hover popover opacity 1 on `:hover` (use `--click`/CDP hover or assert the rule via `getComputedStyle` after forcing `.msg-row:hover` with CDP `CSS.forcePseudoState` — if not supported by the harness, screenshot evidence suffices, note in ledger); two messages < 5 min apart from the same author render one header (send two via `--type-into` composer); a 220ms `msg-in` animation applies to a message pushed via `--push-ws 'chat_message:{...}'`. Verify skeleton by throttling: probe `useMessageStore.getState().loading` render path via screenshot during channel switch if capturable, else assert the CSS rules exist and the JSX renders when `loading===true` (set state via CDP `Runtime.evaluate`).
Also re-run `node tools/smoke.mjs --probe tools/probe-sidebar.js` — the sidebar/rail must be untouched by the ChatArea.css rewrite.

- [ ] **Step 11: Commit**

```bash
git add client/src/components/MessageRow.tsx client/src/components/MessageRow.css client/src/components/FormattingToolbar.tsx client/src/components/FormattingToolbar.css client/src/components/MentionDropdown.tsx client/src/components/MentionDropdown.css client/src/components/ChatArea.tsx client/src/components/ChatArea.css client/src/components/DayDivider.css client/src/components/MessageSearch.css client/src/pages/AppPage.tsx client/src/styles/tokens.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): unified left-aligned message list — MessageRow, 58px header, hover popover, skeleton, 220ms enter"
```

---

### Task 7: Composer rewrite — single field, Aa toggle, accent send square, hint line

**Files:**
- Create: `client/src/components/Composer.tsx`, `client/src/components/Composer.css`
- Modify: `client/src/components/ChatArea.tsx` (swap the whole `chat-input` block for `<Composer>`), `client/src/i18n/locales/ru.ts` + `en.ts`

**Interfaces:**
- `Composer` props: `{ channel: Channel; members: MemberWithUser[]; canMentionEveryone: boolean; onSend: (content: string) => void; serverStickers: Sticker[]; onSendSticker: (s: Sticker) => void; canManageStickers: boolean; onOpenStickerManager: () => void }`.
- `export interface ComposerHandle { insertQuote(text: string): void; focus(): void }` via `forwardRef`/`useImperativeHandle` — ChatArea's message-quote popover and the chat-selection floating button call `composerRef.current?.insertQuote(text)`; Task 9's empty-state CTA calls `focus()`.
- Composer owns: input state, `useMentionAutocomplete` + `MentionDropdown`, quote-prefix tracking (`caretInQuoteLine`), paste-as-link, its own `LinkDialog` + `EmojiPicker` + `StickerPicker`, its own compose-selection floating-quote toolbar, and the `Aa` visibility state for `FormattingToolbar` (default hidden). All the corresponding state/handlers (ChatArea.tsx lines 168–585 compose-path parts: `input`, `caretInQuoteLine`, `composeMention`, `handleSubmit`→calls `onSend`, `handleComposeKeyDown`, `updateQuoteButtonActive`, `handleComposeChange`, `applyRangeToggle`, `wrapSelection`, `toggleQuotePrefix*`, `composeWrap/Bullet/Numbered`, `insertLink` (compose branch), `handleComposePaste`, `composeSelectionToolbar`, `insertQuoteIntoCompose` internals, emoji/sticker open state) MOVE here; ChatArea keeps only `sendMessage(content)` (API call + store) passed as `onSend`.

- [ ] **Step 1: Composer JSX structure** (board column C composer):

```tsx
      <div className="composer">
        {fmtOpen && (
          <FormattingToolbar
            onWrap={wrap} onBullet={bullet} onNumbered={numbered}
            onLink={() => setLinkOpen(true)}
            onEmojiToggle={() => setEmojiOpen((v) => !v)} emojiOpen={emojiOpen}
            quote={{ active: caretInQuoteLine, onToggle: toggleQuotePrefix }}
          />
        )}
        <form className="composer-field" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            className="composer-input"
            value={input}
            …existing change/keydown/paste/select handlers…
            placeholder={t('chat.messagePlaceholder', { channel: channel.name })}
            maxLength={2000}
            rows={1}
          />
          <button type="button" className={`composer-aa${fmtOpen ? ' is-active' : ''}`} aria-pressed={fmtOpen} aria-label={t('chat.formatting')} title={t('chat.formatting')} onClick={() => setFmtOpen((v) => !v)}>Aa</button>
          <button type="button" className={`composer-icon-btn${stickerOpen ? ' is-active' : ''}`} aria-label={t('chat.stickers')} title={t('chat.stickers')} onClick={() => setStickerOpen((v) => !v)}>
            <Sticker size={17} strokeWidth={1.8} />
          </button>
          <button type="button" className={`composer-icon-btn${emojiOpen ? ' is-active' : ''}`} aria-label={t('chat.emoji')} title={t('chat.emoji')} onClick={() => setEmojiOpen((v) => !v)}>
            <Smile size={17} strokeWidth={1.8} />
          </button>
          <button type="submit" className="composer-send" aria-label={t('chat.send')} disabled={!input.trim()}>
            <SendHorizontal size={17} strokeWidth={1.8} />
          </button>
          <MentionDropdown mention={mention} />
        </form>
        <p className="composer-hint">{t('chat.composerHint')}</p>
        {emojiOpen && <EmojiPicker …existing insertEmojiAtCaret wiring… />}
        {stickerOpen && <StickerPicker …existing wiring via props… />}
        <LinkDialog open={linkOpen} onClose={() => setLinkOpen(false)} onInsert={insertLink} />
      </div>
```

(lucide `Sticker`, `Smile`, `SendHorizontal`. `insertEmojiAtCaret` moves here from ChatArea.)

- [ ] **Step 2: `Composer.css`** (field row white, `1px solid line-strong`, r14, padding `8px 10px 8px 12px`, gap 10; hint 11.5/500 faint; send 34×34 r10 accent):

```css
.composer {
  position: relative;
  padding: 10px 20px 18px;
}

.composer-field {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 8px 10px 8px 12px;
  background: var(--canvas);
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  box-shadow: var(--shadow-row);
  transition: border-color var(--transition), box-shadow var(--transition);
}

.composer-field:focus-within {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.composer-input {
  flex: 1;
  min-width: 0;
  max-height: 40vh;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  padding: 5px 0;
}

.composer-input::placeholder { color: var(--faint); }

.composer-aa {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.composer-icon-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.composer-aa:hover, .composer-icon-btn:hover { background: var(--canvas-2); color: var(--ink); }
.composer-aa.is-active, .composer-icon-btn.is-active { background: var(--accent-soft); color: var(--accent-text); }

.composer-send {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: var(--accent);
  color: #ffffff;
  cursor: pointer;
  transition: background var(--transition);
}

.composer-send:hover:not(:disabled) { background: var(--accent-hover); }
.composer-send:disabled { opacity: 0.5; cursor: default; }

.composer-hint {
  margin: 6px 2px 0;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--faint);
}

.composer .fmt-toolbar {
  margin-bottom: 6px;
}
```

- [ ] **Step 3: ChatArea integration** — `const composerRef = useRef<ComposerHandle>(null);`, `insertQuoteIntoCompose = (text) => composerRef.current?.insertQuote(text)`, `sendMessage(content)` = the current `handleSubmit` API logic minus the form-event plumbing (in Task 11 it becomes optimistic). Delete the entire old `chat-input` JSX + moved handlers.

- [ ] **Step 4: i18n** — new keys ru/en: `chat.send: 'Отправить' / 'Send'`, `chat.composerHint: 'Enter — отправить · Shift+Enter — новая строка' / 'Enter — send · Shift+Enter — new line'`.

- [ ] **Step 5: Gates + browser**

tsc/test/check:i18n delta-clean; `npx stylelint src/components/Composer.css` → 0; lint:css total ≤ baseline.
Browser both themes: type + Enter sends; Shift+Enter newlines; Aa toggles the toolbar; quote popover on a message prefills `> …`; mention `@` dropdown navigates with arrows; emoji insert at caret; sticker send works; paste-URL-over-selection creates `[sel](url)`; hint line renders. `--touch` pass: all buttons reachable. Screenshots `t7-composer-{light,dark}.png`, `t7-composer-fmt-open.png`.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Composer.tsx client/src/components/Composer.css client/src/components/ChatArea.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): composer — single field, Aa formatting toggle, accent send square, hint line"
```

---

### Task 8: Pickers — emoji/sticker restyle + CSS extraction

**Files:**
- Create: `client/src/components/EmojiPicker.css`, `StickerPicker.css`, `StickerManager.css`
- Modify: `EmojiPicker.tsx` (import own css; `active` class → `is-active`), `StickerPicker.tsx` (import own css), `StickerManager.tsx` (import own css), `ChatArea.css` (delete the moved legacy blocks — lines covering `.emoji-picker` through `.sticker-manager-list` and friends)

**Interfaces:** component APIs unchanged. `EmojiPicker.css` restyles to the popover system (canvas bg, `1px solid var(--line)`, r12, `--shadow-popover`, tab row bottom, cells 28×28 r7, hover `canvas-2`, active tab `accent-soft`); `StickerPicker.css` same shell with a 3-column grid of 96px cells r10; `StickerManager.css` is a **verbatim move with mechanical lint fixes only** (tokens already used stay; rename any class that breaks `selector-class-pattern` — they are all `sticker-manager-*`/`sticker-*` already multi-segment; fix descending-specificity by reordering; no visual redesign — M4 restyles it).

- [ ] **Step 1:** Create the three CSS files; positioning: `.emoji-picker`/`.sticker-picker` are `position: absolute; bottom: calc(100% + 8px); right: 12px;` inside `.composer` (their new anchor), z-index 30, `animation: fadeIn 0.12s var(--ease-out)`.
- [ ] **Step 2:** Update the three TSX files' imports; in `EmojiPicker.tsx` change `` `emoji-tab${c.id === active ? ' active' : ''}` `` to `` `emoji-tab${c.id === active ? ' is-active' : ''}` ``.
- [ ] **Step 3:** Delete the moved blocks from `ChatArea.css`; ChatArea.css must now be fully lint-clean.
- [ ] **Step 4:** Gates: tsc/test delta-clean; `npx stylelint src/components/{EmojiPicker,StickerPicker,StickerManager,ChatArea}.css` → 0; `npm run lint:css` total ≤ baseline (it should DROP — record new total in ledger as the updated hold-line).
- [ ] **Step 5:** Browser: open both pickers in both themes, insert an emoji, send a sticker; screenshots `t8-pickers-{light,dark}.png`. Sticker manager opens and lists (no restyle expected).
- [ ] **Step 6: Commit**

```bash
git add client/src/components/EmojiPicker.css client/src/components/StickerPicker.css client/src/components/StickerManager.css client/src/components/EmojiPicker.tsx client/src/components/StickerPicker.tsx client/src/components/StickerManager.tsx client/src/components/ChatArea.css
git commit -m "feat(redesign): emoji/sticker pickers restyled on popover system; picker CSS out of ChatArea.css"
```

---

### Task 9: Empty states (board 2a)

**Files:**
- Modify: `client/src/components/ChatArea.tsx` + `ChatArea.css` (empty-channel + no-servers cards), `client/src/pages/AppPage.tsx` (pass `onCreateServer` prop), `client/src/components/MessageSearch.tsx` + `MessageSearch.css` (no-results block), `ru.ts`/`en.ts`

**Interfaces:**
- `ChatAreaProps` gains `onCreateServer?: () => void` (AppPage passes `() => { setShowCreateServer(true); setCreateServerError(''); }`).
- Three variants, shared card recipe (2a): centered, min-height 300px, `canvas` card `1px solid var(--line)` r14, padding 36px 28px, gap 14, copy max-width 250px, title 17/800, body 13/400/1.55 `muted`, 56px r18 icon tile.

- [ ] **Step 1: Empty channel** (`channel && !loading && messages.length === 0`): tile `accent-soft` with lucide `Hash` 22; title `t('chat.quietTitle')`; body `t('chat.quietBody')`; `.btn .btn-primary` `t('chat.writeFirst')` → `composerRef.current?.focus()`. Classes `chat-empty-card, chat-empty-tile, chat-empty-title, chat-empty-body` (replaces the old `welcome-message` block).
- [ ] **Step 2: No servers** (`!channel && useServerStore` has zero servers — subscribe `const servers = useServerStore((s) => s.servers);`): three 40px tiles strip (`chat-empty-tiles`: two `var(--line)` placeholders r12 + middle `var(--rail)` tile with lucide `Plus` 16 in `var(--online)`), title `t('chat.noServersTitle')`, body `t('chat.noServersBody')`, primary `t('server.create')` → `onCreateServer?.()`. When `!channel` but servers exist, keep a plain quiet header + `t('chat.welcomeTitle')` body (existing strings) inside the same card recipe.
- [ ] **Step 3: Search no-results**: in `MessageSearch.tsx`'s `results.length === 0` branch (line 167–170) wrap with the card recipe classes `message-search-empty, message-search-empty-tile` (56px r18 `canvas-2` tile, lucide `SearchX` 22 `muted-2`), keep `t('chat.nothingFound', { query })`. Suggestion chips are dropped (no query-suggestion source; record in ledger).
- [ ] **Step 4: i18n** ru/en: `chat.quietTitle: 'Здесь пока тихо' / 'It’s quiet here'`, `chat.quietBody: 'Начните обсуждение в #{{channel}} — напишите первое сообщение.' / 'Start the conversation in #{{channel}} — write the first message.'`, `chat.writeFirst: 'Написать первое сообщение' / 'Write the first message'`, `chat.noServersTitle: 'Пока ни одного сервера' / 'No servers yet'`, `chat.noServersBody: 'Создайте сервер — или найдите существующий через поиск в левой панели.' / 'Create a server — or find an existing one via the search in the left rail.'`.
- [ ] **Step 5: Gates + browser**: tsc/test/check:i18n delta-clean; touched css files stylelint-clean; total ≤ ledger line. Browser: `--anon`? No — empty channel needs a channel with no messages: create a throwaway channel in «Redesign Smoke», screenshot both themes (`t9-empty-channel-{light,dark}.png`); search gibberish in MessageSearch → `t9-search-empty.png`; CTA focuses the composer (probe `document.activeElement.className` contains `composer-input`). No-servers card: verify by CDP `Runtime.evaluate` forcing `useServerStore.setState({servers: []})` + screenshot, then reload.
- [ ] **Step 6: Commit**

```bash
git add client/src/components/ChatArea.tsx client/src/components/ChatArea.css client/src/pages/AppPage.tsx client/src/components/MessageSearch.tsx client/src/components/MessageSearch.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): empty states — quiet channel, no servers, search no-results (board 2a)"
```

---

### Task 10: Unread divider + viewport mark-read

**Files:**
- Modify: `client/src/components/ChatArea.tsx`, `ChatArea.css` (unread-* rules), `ru.ts`/`en.ts`

**Interfaces:**
- Consumes `useUnreadStore`, `firstUnreadId` (Task 4).
- Behavior (spec §4.4 + board 2b): the divider anchor is computed **once per channel entry** and pinned until the user leaves the channel; the persisted mark advances when the LAST message enters the viewport, but the visible divider does not move; re-entering the channel recomputes (so a fully-read channel shows none).

- [ ] **Step 1: Entry snapshot in ChatArea**

```tsx
  const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);
  const anchorComputedRef = useRef(false);
  useEffect(() => { anchorComputedRef.current = false; setUnreadAnchorId(null); }, [channel?.id]);
  useEffect(() => {
    if (anchorComputedRef.current || loading || !channel || messages.length === 0) return;
    anchorComputedRef.current = true;
    setUnreadAnchorId(firstUnreadId(useUnreadStore.getState().lastRead[channel.id], messages));
  }, [messages, loading, channel]);
```

- [ ] **Step 2: Divider JSX** — inside the messages map, before the `MessageRow` whose `msg.id === unreadAnchorId`:

```tsx
                  {msg.id === unreadAnchorId && (
                    <div className="unread-divider" role="separator" aria-label={t('chat.newMessages')}>
                      <span className="unread-divider-line" />
                      <span className="unread-divider-pill">{t('chat.newMessages')}</span>
                      <span className="unread-divider-line" />
                    </div>
                  )}
```

- [ ] **Step 3: Viewport mark-read** — IntersectionObserver on the existing `messagesEndRef` sentinel:

```tsx
  useEffect(() => {
    const sentinel = messagesEndRef.current;
    const root = chatMessagesRef.current;
    if (!sentinel || !root || !channel) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      const msgs = useMessageStore.getState().messages;
      const last = [...msgs].reverse().find((m) => !m.deliveryState);
      if (last) useUnreadStore.getState().markRead(channel.id, last.id, last.created_at);
    }, { root, threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [channel?.id]);
```

- [ ] **Step 4: CSS** (board 2b: 1px `danger` rules at 50%, pill `danger-soft` 10.5/700 caps `danger-text`):

```css
.unread-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 6px;
}

.unread-divider-line {
  flex: 1;
  height: 1px;
  background: var(--danger);
  opacity: 0.5;
}

.unread-divider-pill {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--danger-soft);
  color: var(--danger-text);
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
```

- [ ] **Step 5: i18n** — `chat.newMessages: 'Новые сообщения' / 'New messages'` (CSS uppercases).
- [ ] **Step 6: Gates + browser**: tsc/test delta-clean (unreadStore tests from Task 4 still green). Browser scenario: view channel A (mark advances), push a WS message into A (`--push-ws 'chat_message:{…}'` with a fabricated id/timestamp — see M1 harness notes), switch to channel B, switch back → divider above the pushed message; screenshot `t10-unread-{light,dark}.png`; scroll to bottom → leave → re-enter → divider gone (probe asserts no `.unread-divider` and localStorage mark equals last real message id).
- [ ] **Step 7: Commit**

```bash
git add client/src/components/ChatArea.tsx client/src/components/ChatArea.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): unread divider pinned per entry + viewport mark-read via unreadStore"
```

---

### Task 11: Optimistic delivery states + dark danger-token refinement

**Files:**
- Modify: `client/src/components/ChatArea.tsx` (optimistic `sendMessage` + retry), `client/src/components/MessageRow.tsx` + `MessageRow.css` (sending/failed chips), `client/src/styles/tokens.css` (dark `--danger-soft`/`--danger-text`), `ru.ts`/`en.ts`
- Test: extend `client/src/stores/__tests__/messageStore.test.ts` if new store behavior appears (none expected — reuse Task 3 primitives).

**Interfaces:**
- Consumes `ChatMessage`, `replaceMessage` (Task 3), `ComposerHandle.onSend` wiring (Task 7), `onRetry` prop slot (Task 6).
- Spec §4.4 + board 2b: `sending` → row at 75% opacity + clock chip «отправляется»; `failed` → row stays 75% + `danger` chip «не отправлено · повторить» with retry; reconcile on HTTP response (decision 8).

- [ ] **Step 1: Optimistic send in ChatArea**

```tsx
  const pendingSeqRef = useRef(0);
  const sendMessage = async (content: string) => {
    if (!channel || !user) return;
    const tempId = `pending-${Date.now()}-${pendingSeqRef.current++}`;
    const now = new Date().toISOString();
    addMessage({
      id: tempId, channel_id: channel.id, user_id: user.id,
      content, created_at: now, updated_at: now, deliveryState: 'sending',
    });
    try {
      const msg = await apiService.createMessage(channel.id, content) as Message;
      replaceMessage(tempId, msg);
    } catch (err) {
      logger.error('Failed to send message:', err, { module: 'chat' });
      updateMessage(tempId, { deliveryState: 'failed' });
    }
  };
  const retrySend = async (msg: ChatMessage) => {
    if (!channel) return;
    updateMessage(msg.id, { deliveryState: 'sending' });
    try {
      const saved = await apiService.createMessage(channel.id, msg.content) as Message;
      replaceMessage(msg.id, saved);
    } catch (err) {
      logger.error('Failed to send message:', err, { module: 'chat' });
      updateMessage(msg.id, { deliveryState: 'failed' });
    }
  };
```

Pass `onRetry={() => retrySend(msg)}` to `MessageRow`; sticker send (`sendSticker`) stays non-optimistic (no local render for a sticker without the server object — record in ledger). Remove the now-redundant `sendError` toast on plain send failures (the failed chip replaces it) but KEEP the toast for edit/jump errors.

- [ ] **Step 2: Chips in MessageRow** — under `msg-body` when `deliveryState` is set:

```tsx
        {msg.deliveryState === 'sending' && (
          <span className="msg-delivery msg-delivery--sending">
            <Clock size={12} strokeWidth={1.8} /> {t('chat.sending')}
          </span>
        )}
        {msg.deliveryState === 'failed' && (
          <button type="button" className="msg-delivery msg-delivery--failed" onClick={props.onRetry}>
            {t('chat.sendFailed')} · {t('chat.retry')}
          </button>
        )}
```

CSS:

```css
.msg-row--sending, .msg-row--failed {
  opacity: 0.75;
}

.msg-delivery {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 600;
}

.msg-delivery--sending {
  background: var(--canvas-2);
  color: var(--muted-2);
}

.msg-delivery--failed {
  border: none;
  background: var(--danger-soft);
  color: var(--danger-text);
  cursor: pointer;
}
```

- [ ] **Step 3: Dark danger tokens** — in `tokens.css` dark block (lines 115–116) replace with:

```css
  --danger-soft: rgba(231, 68, 74, 0.18);
  --danger-text: #F87171;
```

and delete the two `/* refine in M6 */` comments on those lines only. Then measure in the browser (dark theme, failed chip forced via CDP: `useMessageStore.getState().updateMessage(<id>,{deliveryState:'failed'})`): probe computed fg/bg of `.msg-delivery--failed`, compute WCAG contrast against the blended background (`--danger-soft` over `--canvas` #0E1017; own-message rows blend over `--own-msg-bg` too — check both). Target ≥4.5:1; if short, raise `--danger-text` lightness (e.g. `#FCA5A5`) until it passes, and record the final values + measured ratios in the ledger.

- [ ] **Step 4: i18n** — `chat.sending: 'отправляется' / 'sending'`, `chat.sendFailed: 'не отправлено' / 'not sent'`, `chat.retry: 'повторить' / 'retry'`.
- [ ] **Step 5: Gates + browser**: tsc/test/check:i18n delta-clean; stylelint clean on touched files. Browser: send normally (chip flashes then resolves — verify via `--after 100` screenshot if catchable, else assert the reconciliation leaves no `pending-*` id in the store); force a failure (CDP: block the request via `Fetch.enable` patterns on `*/messages`, or point `--push-ws`-style at an invalid channel — simplest reliable path: `Network.emulateNetworkConditions offline:true` during send) → failed chip renders, click «повторить» after going online → message delivers and `replaceMessage` swapped the server id (probe). Screenshots `t11-failed-{light,dark}.png`. Confirm the enter animation (Task 6) applies once, not again on reconcile (id changes — verify no double-flash; if it re-animates, add the server id to `initialIdsRef` inside `replaceMessage` call site before the swap).
- [ ] **Step 6: Commit**

```bash
git add client/src/components/ChatArea.tsx client/src/components/MessageRow.tsx client/src/components/MessageRow.css client/src/styles/tokens.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): optimistic send with sending/failed chips + retry; dark danger tokens refined"
```

---

### Task 12: Mobile chat (board 1f)

**Files:**
- Modify: `client/src/components/ChatArea.css`, `MessageRow.css`, `Composer.css` (each file's own `@media (max-width: 768px)` block — the 768→900 boundary migration is M6's, per spec §5), `client/src/components/ChatArea.tsx` (mobile subtitle line), `ru.ts`/`en.ts` if needed (reuse `call.participants` plural for the subtitle)

**Interfaces:** consumes everything prior; produces the `1f` overrides:

- [ ] **Step 1: Top bar 56px** — in ChatArea.css mobile block: `.chat-header { height: 56px; min-height: 56px; gap: 8px; padding: 0 10px; }`; `.chat-back-btn` 40×40 flex r11 (visible only on mobile — desktop hides it: the `onMobileBack` prop only renders it in mobile panels anyway, keep `display:flex` scoped here as today's `.mobile-back-btn` was); title block: add a `chat-header-title` wrapper div (name 15/700 + `chat-header-sub` line `{server?.name} · {t('call.participants', {count: members.length})}` 11.5/500 `muted-2`) — rendered only under the mobile media query (`display:none` on desktop, `display:block` mobile; the plain `chat-header-name` hides on mobile). ChatArea gets `currentServer` from `useServerStore` (already imported). `.chat-search-btn`, `.chat-members-btn`, `.chat-call-btn`: 40×40 r11, search bg `var(--canvas-2)` borderless; `.chat-voice-btn`: 40×40 r11 `accent-soft` `accent-text` icon-only (`span` label `display:none`).
- [ ] **Step 2: Messages** — MessageRow.css mobile block: `.msg-row { grid-template-columns: 36px 1fr; gap: 0 10px; padding: 4px 6px; }`, `.msg-avatar { width: 32px; height: 32px; border-radius: 11px; }`; own message keeps bg + border (no change needed).
- [ ] **Step 3: Composer** — Composer.css mobile block: `.composer { padding: 8px 10px calc(10px + env(safe-area-inset-bottom, 0px)); }`, `.composer-field { border-radius: 13px; }`, `.composer-input { font-size: 16px; }` (iOS zoom guard, carried from the old CSS), `.composer-aa, .composer-icon-btn { width: 40px; height: 40px; }`, `.composer-send { width: 44px; height: 44px; border-radius: 13px; }`, `.composer-hint { display: none; }` (no hardware Enter on touch).
- [ ] **Step 4: Gates + browser**: tsc/test delta-clean; stylelint clean. Harness `--touch` + mobile metrics (the harness's `--touch` sets `setDeviceMetricsOverride {mobile:true}` — pass width 390): light + dark screenshots `t12-mobile-{light,dark}.png`; probe asserts header 56px, back button ≥40px hit target, send button 44px, hover-dependent `.msg-actions` unreachable on touch — verify long-press… the board defines no touch affordance for the popover: on `(hover: none)` make `.msg-actions` always visible at reduced opacity `0.9` for own+quote actions (`@media (hover: none) { .msg-row .msg-actions { opacity: 0.9; pointer-events: auto; position: static; …inline row under the message… } }` — this is the M1 touch-pill lesson: never leave a hover-only affordance on touch; verify with `--touch` probe).
- [ ] **Step 5: Commit**

```bash
git add client/src/components/ChatArea.css client/src/components/MessageRow.css client/src/components/Composer.css client/src/components/ChatArea.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(redesign): mobile chat per board 1f — 56px top bar, 40px targets, touch-visible actions"
```

---

### Task 13: Whole-branch review + closeout

- [ ] **Step 1: Full gate sweep** — `npx tsc --noEmit`; `npm test` (only api.network-retry red); `npm run check:i18n` exit 0; `npm run lint:css` total ≤ final ledger hold-line and every M2-created/rewritten file individually clean; `npm run build:vite` succeeds.
- [ ] **Step 2: Whole-branch code review** (superpowers:requesting-code-review) over `git diff <M1 head f39e699>..HEAD`, spec §5 M2 bullet + this plan as the requirements. Fix-now items get fixed and re-reviewed.
- [ ] **Step 3: Final visual QA** — side-by-side with `design_handoff_discord_redesign/Redesign.dc.html` (`1c` column C, `2a`, `2b`, `1f`) in both themes; full-app screenshots `t13-full-{light,dark}.png`, mobile `t13-mobile-{light,dark}.png`.
- [ ] **Step 4: Write the M2 closeout** — `docs/superpowers/plans/2026-08-25-redesign-m2-closeout.md` mirroring the M1 closeout format: decisions that bind later work, deferred findings triaged by owner (M4/M5/M6), the stylelint baseline history (initial → final totals, per-rule), harness additions, environment notes. Commit it.

---

## Self-review (performed while writing)

- Spec coverage: every clause of spec §5 M2 maps to a task — single metaphor/grid/5-min (T6+T3), own-message treatment (T6), header 58 (T6), date dividers (T6), popover edit/delete/quote (T6), destructive-confirm modal replacing `window.confirm` (T5), composer + Aa + send square + hint (T7), mention/emoji/sticker restyle (T6 mention, T8 pickers), empty states (T9), unread divider + viewport mark-read + unreadStore (T4+T10), optimistic delivery (T3+T11), 220ms enter + skeleton (T6), mobile 1f (T12), ChatArea split per §8 (T6/T7). Hardening: cascade (T1), stylelint (T2).
- The four planning decisions from the handoff prompt are ruled on in "Decisions" 1–4.
- Type consistency: `ChatMessage`/`replaceMessage`/`loading` (T3) are consumed with identical names in T6/T10/T11; `ComposerHandle.insertQuote/focus` (T7) consumed in T9; `firstUnreadId(mark, messages)` signature identical in T4/T10; `isContinuation(prev, msg)` identical in T3/T6.
- Known intentional scope cuts are each recorded with a rationale (decisions 5–6, edit-selection floating quote, sticker optimistic send, suggestion chips) and must be echoed into the M2 closeout ledger.
