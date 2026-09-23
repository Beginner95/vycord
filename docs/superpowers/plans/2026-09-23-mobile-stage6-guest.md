# Mobile Stage 6 — Guest Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the unauthenticated `/guest` route for `width < 900px` per spec §7 —
mobile polish for the entry/lobby/notice/ended states, and a dedicated mobile
in-call experience (reusing `MobileCallScreen` from stage 4, with Chat/Participants
as screens over the call via `useMobileNav`) — while `≥900px` stays pixel-identical.

**Architecture:** Two independent surfaces. (1) Entry/lobby/notice/ended
(`GuestEntry`/`GuestLobby`/`GuestNotice`/`GuestEnded` in `GuestPage.tsx`) stay the
exact same components, gaining only an additive `@media (width < 900px)` CSS block
— they're already centered single-column cards, so no component split is needed.
(2) The `in_call`/`connecting`/`resuming` branch of `GuestPage.tsx` switches on
`useIsMobile()`: desktop keeps `GuestCallView` (`CallStage` + aside panel)
unchanged; mobile gets a new `GuestMobileCallShell` that owns its own
`useMobileNav()` stack (root `guestCall` — the placeholder `Screen` kinds
`guestCall`/`guestChat`/`guestParticipants` were reserved, unused, back in stage 1)
and renders the existing `MobileCallScreen`/`CallOverflowSheets` (stage 4, already
guest-aware via `isGuestMode`) plus two new screens wrapping bodies extracted from
`GuestCallView.tsx` via the established seam pattern (stage 2/5's Body-component
split).

**Tech Stack:** React 19, Vite 8, TS, Zustand 5, react-router-dom 7, Vitest, RTL,
lucide-react, plain per-component CSS.

**Spec:** `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md` (§7 —
primary; §2 breakpoint; §3 nav model; §6.2 `MobileCallScreen` contract this stage
reuses verbatim)

## Global Constraints

- Breakpoint literal is exactly `(width < 900px)`, matching
  `client/src/mobile/breakpoint.ts`'s `MOBILE_MQ` — never `<=720px`, `<=768px`, or
  any other value.
- Desktop (`≥900px`) must stay pixel-identical. Every change to
  `GuestPage.tsx`/`GuestCallView.tsx`/`GuestPage.css`/`GuestCallView.css` is either
  additive-only or gated behind `useIsMobile()` / `@media (width < 900px)`.
- No numeric z-index literals; canonical role tokens only (`var(--ink)`,
  `var(--muted)`, etc.) — no raw colors, no ad-hoc radii.
- Touch targets ≥44×44 for any new/modified interactive control reachable below
  900px.
- Any `<input>`/`<textarea>` reachable below 900px needs `font-size: 16px` (iOS
  zoom-on-focus) — established pattern from stage 5.
- Never edit `client/src/test/api.network-retry.test.ts`.
- Gates (run from `client/`): `npx tsc --noEmit` and
  `npx stylelint "src/**/*.css"` must produce zero bytes of output;
  `npm run check:i18n` must report «непереведённых строк не найдено»; `npm test`
  must fail exactly 3 tests, all in `api.network-retry.test.ts`.
- `useMobileNav()` (`client/src/mobile/nav/useMobileNav.ts`) is route-agnostic —
  it reads `location.state` and navigates against `location.pathname` — so a
  second instance mounted under `/guest` shares no state with the authenticated
  `/app` instance; they're different routes/history entries.
- `ROOT_KINDS`/`FIELDS` in `client/src/mobile/nav/navReducer.ts` already register
  `guestCall` (root), `guestChat`, `guestParticipants` with zero required fields —
  do not re-declare them; this stage is the first to actually render them.

## Decisions

**D1 — Entry/lobby/notice/ended get CSS-only mobile treatment.** No component
restructuring: `GuestEntry`/`GuestLobby`/`GuestNotice`/`GuestEnded` stay exactly as
they are in `GuestPage.tsx`, gaining an additive `@media (width < 900px)` block in
`GuestPage.css` (mirrors stage 5's `Auth.css` treatment, Task 6 of that stage).

**D2 — `GuestCallView.css`'s legacy breakpoint is deleted, not migrated.** Once
`GuestPage.tsx` branches to `GuestMobileCallShell` for `in_call`/`connecting`/
`resuming` below 900px, `GuestCallView.tsx` only ever renders at `≥900px` — its
`@media (width <= 720px) { .guest-side {…} }` rule (`GuestCallView.css:186-192`)
becomes dead/unreachable. This is a deliberate deviation from the spec's literal
§7 line ("`GuestCallView.css` `(width <= 720px)` → `(width < 900px)`"): migrating a
rule's threshold when the rule can no longer fire at all would leave a silent trap
for a future reader who assumes it's still load-bearing. Task 4 deletes it
outright. Cost if wrong: trivial, a one-line CSS re-add.

**D3 — `GuestMobileCallShell` mounts its own `useMobileNav()` directly under
`/guest`**, not nested inside the authenticated `MobileShell`. Safe per the Global
Constraints note above. `guestCall` is already a valid stack root
(`navReducer.ts`'s `ROOT_KINDS`).

**D4 — `MobileCallScreen`/`CallOverflowSheets` are reused almost verbatim**, with
exactly one small, backward-compatible addition: an optional
`chatUnreadCount?: number` prop on `MobileCallScreen`, needed for spec §7's
"бейдж непрочитанного на «Чат»" (the authenticated in-call flow has no equivalent
unread concept for its chat button — `guestCallStore.chatUnread` exists
specifically because a guest has no other surface where unread messages would
show). The prop defaults to `undefined`; `renderScreen.tsx`'s existing `CallScreen`
never passes it, so the authenticated flow's `MobileCallScreen` renders byte-for-
byte the same as before — this is the one deliberate exception to "zero new
props," scoped to Task 4, and verified there against stage 4's existing
`MobileCallScreen.test.tsx` staying green. Everything else about `MobileCallScreen`
is unchanged: it already guards `!m.isGuestMode && <GuestLobbyToast/>`; its
`onOpenChat`/`onOpenOverflow`/`onOpenQuality` are plain callbacks the shell
supplies. `CallOverflowSheets` gets `guestsPresent={false}` from the shell — not
`useGuestManagementStore`, which is the *host's* view of guests in a channel and
irrelevant to what a guest should see about themself. Combined with
`m.isGuestMode === true` (already computed inside `useCallStageModel` from
`callStore.guestSelf`), the existing condition in `useCallOverflowItems` —
`(m.guestLinksEnabled && !m.isGuestMode) || guestsPresent` — correctly hides the
"invite a guest" menu item from a guest's own overflow menu with zero new code.

**D5 — Seam split: `GuestChatPanel`/`GuestParticipantsPanel` → `GuestChatBody`/
`GuestParticipantsBody`.** Currently private functions inside `GuestCallView.tsx`,
extracted to `client/src/pages/guest/GuestChatBody.tsx` /
`GuestParticipantsBody.tsx` — same seam pattern as stage 5's `ProfileAccountBody`/
`PrivacyBody`/`LanguageBody`. `GuestCallView.tsx`'s desktop `<aside>` imports and
renders them completely unchanged (verified via Task 1's frozen DOM snapshot); the
new mobile `GuestChatScreen`/`GuestParticipantsScreen` wrap the same bodies with
`ScreenHeader`.

**D6 — No new `guest.*` i18n keys for chat/participants/call.** `guest.chat`/
`guest.participants` (existing) become the two new screens' titles;
`mobile.callOpenChat`/`mobile.callActions` (existing, stage 4) stay the aria-labels
on `MobileCallScreen`'s buttons, unchanged. One new key pair IS needed for the
in-app-browser hint (Task 3) — see D7.

**D7 — In-app-browser hint is a real, scoped addition, not deferred.** Spec §7:
"Проверить текст про in-app браузеры; при отсутствии — добавить подсказку (i18n
ru+en)." Current `guest.mediaDeniedHint` ("Разрешите доступ в настройках
браузера — или войдите без них.") already covers "join without them" — that part
of §7 is already satisfied, no code needed. But nothing names the in-app-browser
case specifically (Instagram/TikTok/WeChat/Line webviews routinely block
`getUserMedia` at the host-app level, which a guest experiences as a plain
"media denied" with no explanation of *why*). Task 3 adds a small UA-substring
detector (`client/src/pages/guest/inAppBrowser.ts`) and one new i18n key,
`guest.inAppBrowserHint`, shown only when both `denied` and an in-app browser are
detected.

## File Structure

| File | Responsibility |
|---|---|
| `client/src/pages/GuestPage.css` (modify) | + `@media (width < 900px)` block: entry/lobby/notice/ended mobile polish |
| `client/src/pages/GuestPage.tsx` (modify) | `guest-card-entry` class on `GuestEntry`'s card; in-app-browser hint; `useIsMobile()` branch for in_call/connecting/resuming → `GuestMobileCallShell` |
| `client/src/pages/guest/inAppBrowser.ts` (new) | `isInAppBrowser(ua?: string): boolean` — UA substring check |
| `client/src/pages/guest/GuestChatBody.tsx` (new) | Extracted chat panel (message list + composer) |
| `client/src/pages/guest/GuestParticipantsBody.tsx` (new) | Extracted roster list |
| `client/src/pages/GuestCallView.tsx` (modify) | Imports the two bodies instead of defining them inline |
| `client/src/pages/GuestCallView.css` (modify) | Delete dead `(width <= 720px)` `.guest-side` rule |
| `client/src/pages/guest/GuestMobileCallShell.tsx` (new) | Owns `useMobileNav`; renders `MobileCallScreen`/`CallOverflowSheets` for the `guestCall` root and dispatches `guestChat`/`guestParticipants` |
| `client/src/mobile/screens/GuestChatScreen.tsx` (new) | `ScreenHeader` + `GuestChatBody` |
| `client/src/mobile/screens/GuestParticipantsScreen.tsx` (new) | `ScreenHeader` + `GuestParticipantsBody` |
| `client/src/mobile/screens/GuestChatScreen.css`, `GuestParticipantsScreen.css` (new) | Full-height flex wrapper per screen |
| `client/src/i18n/locales/ru.ts`, `en.ts` (modify) | + `guest.inAppBrowserHint` |
| `client/src/pages/__tests__/GuestCallView.dom.test.tsx` (new) | Frozen desktop DOM snapshot — chat + participants panels open |
| `client/src/pages/guest/__tests__/inAppBrowser.test.ts` (new) | UA-matcher unit tests |
| `client/src/pages/guest/__tests__/GuestChatBody.test.tsx`, `GuestParticipantsBody.test.tsx` (new) | Behavior tests for the extracted bodies |
| `client/src/pages/guest/__tests__/GuestMobileCallShell.test.tsx` (new) | Screen-dispatch behavior test |
| `client/src/mobile/screens/__tests__/GuestChatScreen.test.tsx`, `GuestParticipantsScreen.test.tsx` (new) | Behavior tests |

---

### Task 1: Frozen DOM snapshot — `GuestCallView` desktop parity

**Files:**
- Create: `client/src/pages/__tests__/GuestCallView.dom.test.tsx`
- Create (generated by the test run): `client/src/pages/__tests__/__snapshots__/GuestCallView.chat.html`, `GuestCallView.participants.html`

**Interfaces:**
- Consumes: `GuestCallView` (`client/src/pages/GuestCallView.tsx`, unchanged this
  task), `useCallStore`/`useGuestCallStore` (existing), `stubBrowser` from
  `@/components/__tests__/callHarness` (existing, already imported cross-directory
  by `client/src/mobile/screens/__tests__/MobileCallScreen.test.tsx`).
- Produces: a byte-for-byte safety net that Task 2's extraction must not change.

This test freezes the DOM of the two side-panel states in `GuestCallView.tsx`
*before* `GuestChatPanel`/`GuestParticipantsPanel` are extracted to their own
files in Task 2. `GuestCallView` renders `<CallStage>` internally, so it needs the
same service mocks as `client/src/components/__tests__/CallStage.dom.test.tsx`.

- [ ] **Step 1: Write the test**

```tsx
// client/src/pages/__tests__/GuestCallView.dom.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { GuestCallView } from '../GuestCallView';
import { useCallStore } from '@/stores/callStore';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { stubBrowser } from '@/components/__tests__/callHarness';

vi.mock('@/services/groupCall', () => ({
  groupCallService: {
    localStreamState: null, screenStreamState: null,
    toggleMuteAudio: vi.fn(), toggleMuteVideo: vi.fn(),
    stopScreenShare: vi.fn(), startScreenShare: vi.fn(),
    watchShare: vi.fn(), unwatchShare: vi.fn(),
  },
}));
vi.mock('@/services/callBus', () => ({ callBus: { send: vi.fn(), on: vi.fn(() => () => {}) } }));

beforeAll(stubBrowser);

const messages = [
  {
    id: 'm1', content: 'привет всем', created_at: '2026-09-23T10:00:00Z',
    author: { kind: 'guest' as const, guest_id: 'g1', display_name: 'Аня' },
  },
  {
    id: 'm2', content: 'привет!', created_at: '2026-09-23T10:01:00Z',
    author: { kind: 'user' as const, user_id: 'u2', username: 'boris' },
  },
];

beforeEach(() => {
  useCallStore.setState({
    callChannelId: 'c1', callChannelName: 'general', callServerId: 's1', status: 'connected',
    startedAt: Date.now(), isMuted: false, isVideoOff: true, isMicAvailable: true,
    participants: [], directory: {}, guestSelf: { id: 'g1', display_name: 'Аня' } as never,
  });
  useGuestCallStore.setState({
    phase: 'in_call', guestId: 'g1', displayName: 'Аня', roomId: 'c1',
    preview: { server_name: 's', channel_name: 'general', participant_count: 2 },
    participants: {
      users: [{ user_id: 'u2', username: 'boris', avatar_url: undefined }],
      guests: [{ id: 'g1', display_name: 'Аня' }],
    },
    messages,
    chatUnread: 0,
  } as never);
});
afterEach(() => {
  cleanup();
  useCallStore.getState().reset();
  useGuestCallStore.getState().reset();
});

const snap = (name: string) => expect(document.body.innerHTML).toMatchFileSnapshot(`./__snapshots__/GuestCallView.${name}.html`);

describe('GuestCallView DOM (desktop parity, снято до VYC-95 этапа 6)', () => {
  it('панель «Чат» открыта', async () => {
    // По title, не по индексу .stage-ctl-btn: CallStage сам рендерит
    // .stage-ctl-btn для мика/камеры/демонстрации/гостей раньше extraControls,
    // так что querySelectorAll(...)[0] попал бы на кнопку мика.
    const { getByTitle } = render(<GuestCallView />);
    fireEvent.click(getByTitle('Чат'));
    await snap('chat');
  });
  it('панель «Участники» открыта', async () => {
    const { getByTitle } = render(<GuestCallView />);
    fireEvent.click(getByTitle('Участники'));
    await snap('participants');
  });
});
```

- [ ] **Step 2: Run it to generate the baseline snapshots**

Run: `npx vitest run src/pages/__tests__/GuestCallView.dom.test.tsx`
Expected: PASS, two new files written under `client/src/pages/__tests__/__snapshots__/`.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/__tests__/GuestCallView.dom.test.tsx client/src/pages/__tests__/__snapshots__/GuestCallView.chat.html client/src/pages/__tests__/__snapshots__/GuestCallView.participants.html
git commit -m "test: freeze GuestCallView side-panel DOM before stage 6 body extraction"
```

---

### Task 2: Extract `GuestChatBody` / `GuestParticipantsBody`

**Files:**
- Create: `client/src/pages/guest/GuestChatBody.tsx`
- Create: `client/src/pages/guest/GuestParticipantsBody.tsx`
- Modify: `client/src/pages/GuestCallView.tsx`
- Create: `client/src/pages/guest/__tests__/GuestChatBody.test.tsx`
- Create: `client/src/pages/guest/__tests__/GuestParticipantsBody.test.tsx`

**Interfaces:**
- Consumes: Task 1's frozen snapshots (regression gate).
- Produces: `export function GuestChatBody(): JSX.Element` (no props — reads
  `useGuestCallStore`/`useCallStore` directly, exactly like the panel it replaces),
  `export function GuestParticipantsBody(): JSX.Element` (same, no props). Task 5
  imports both.

This is a verbatim move: copy `toChatMessage`, `GuestChatPanel`'s body, and
`GuestParticipantsPanel`'s body out of `GuestCallView.tsx` into the two new files,
rename the components to `GuestChatBody`/`GuestParticipantsBody`, update imports,
and replace the two inline definitions in `GuestCallView.tsx` with imports. No
logic change.

- [ ] **Step 1: Create `GuestChatBody.tsx`**

```tsx
// client/src/pages/guest/GuestChatBody.tsx
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { MessageRow } from '@/components/MessageRow';
import { DayDivider } from '@/components/DayDivider';
import { MediaLightbox, pickLightboxMedia } from '@/components/MediaLightbox';
import { useGuestCallStore } from '@/stores/guestCallStore';
import type { ChatMessage } from '@/stores/messageStore';
import type { GuestChatMessage } from '@/services/guestApi';
import type { Attachment, MemberWithUser } from '@/types';
import { isContinuation } from '@/utils/messageGroups';
import { useT, useDateFormat, isSameCalendarDay } from '@/i18n';
import { guestErrorText } from '@/pages/guestErrors';

function toChatMessage(m: GuestChatMessage, channelId: string): ChatMessage {
  const isGuest = m.author.kind === 'guest';
  return {
    id: m.id,
    channel_id: channelId,
    user_id: isGuest ? null : (m.author.user_id ?? null),
    guest: isGuest ? { id: m.author.guest_id ?? '', display_name: m.author.display_name ?? '' } : undefined,
    content: m.content,
    kind: 'user',
    attachments: m.attachments,
    sticker_id: m.sticker_id,
    sticker: m.sticker,
    created_at: m.created_at,
    updated_at: m.updated_at ?? m.created_at,
  };
}

/** Тело гостевого чата — та же лента (MessageRow) с тем же композером в режиме
 *  «только текст», что была встроена в `GuestCallView`. Используется и
 *  десктопным aside (`GuestCallView.tsx`, неизменно), и мобильным
 *  `GuestChatScreen` (этап 6). */
export function GuestChatBody() {
  const t = useT();
  const { formatFullDate } = useDateFormat();
  const rawMessages = useGuestCallStore((s) => s.messages);
  const sendChat = useGuestCallStore((s) => s.sendChat);
  const guestId = useGuestCallStore((s) => s.guestId);
  const displayName = useGuestCallStore((s) => s.displayName);
  const channelId = useGuestCallStore((s) => s.roomId) ?? '';
  const channelName = useGuestCallStore((s) => s.preview?.channel_name) ?? '';
  const rosterUsers = useGuestCallStore((s) => s.participants.users);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [lightbox, setLightbox] = useState<{ attachments: Attachment[]; index: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);

  const messages = useMemo(() => rawMessages.map((m) => toChatMessage(m, channelId)), [rawMessages, channelId]);

  const members = useMemo<MemberWithUser[]>(
    () => rosterUsers.map((u) => ({
      user_id: u.user_id,
      username: u.username ?? u.user_id.slice(0, 8),
      avatar_url: u.avatar_url,
      roles: [],
      joined_at: '',
    })),
    [rosterUsers],
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = (content: string) => {
    void sendChat(content).then(
      () => setError(null),
      (err: { code?: string; message?: string }) => setError({ code: err.code, message: err.message ?? '' }),
    );
  };

  return (
    <>
      <div className="guest-chat-feed" ref={listRef}>
        <p className="guest-chat-hint">{t('guest.chatHint')}</p>
        {messages.map((msg, idx) => {
          const prev = messages[idx - 1];
          const date = new Date(msg.created_at);
          const dayChanged = !prev || !isSameCalendarDay(date, new Date(prev.created_at));
          const isOwn = Boolean(msg.guest && msg.guest.id === guestId);
          const author = rawMessages[idx].author;
          const name = msg.guest
            ? msg.guest.display_name
            : (author.username ?? author.user_id?.slice(0, 8) ?? '');
          return (
            <Fragment key={msg.id}>
              {dayChanged && <DayDivider label={formatFullDate(date)} />}
              <MessageRow
                msg={msg}
                isOwn={isOwn}
                isContinuation={!dayChanged && isContinuation(prev, msg)}
                displayName={isOwn ? displayName : name}
                avatarUrl={author.avatar_url}
                isEditing={false}
                highlighted={false}
                entered={false}
                members={members}
                canMentionEveryone={false}
                canModify={false}
                onStartEdit={() => {}}
                onCancelEdit={() => {}}
                onSaveEdit={async () => {}}
                onDelete={() => {}}
                onQuote={() => composerRef.current?.insertQuote(msg.content)}
                onOpenAttachment={(index) => setLightbox(pickLightboxMedia(msg.attachments ?? [], index))}
              />
            </Fragment>
          );
        })}
      </div>
      {error && <p className="guest-chat-error">{guestErrorText(error, t)}</p>}
      <div className="guest-chat-composer">
        <Composer
          ref={composerRef}
          channel={{ id: channelId, name: channelName, server_id: '' }}
          members={members}
          canMentionEveryone={false}
          onSend={send}
          textOnly
        />
      </div>
      {lightbox && (
        <MediaLightbox
          attachments={lightbox.attachments}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : cur))}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create `GuestParticipantsBody.tsx`**

```tsx
// client/src/pages/guest/GuestParticipantsBody.tsx
import { MicOff, Mic } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useCallStore } from '@/stores/callStore';
import { useT } from '@/i18n';

/** Тело ростера участников — та же логика, что была встроена в
 *  `GuestCallView`. Используется десктопным aside (неизменно) и мобильным
 *  `GuestParticipantsScreen` (этап 6). */
export function GuestParticipantsBody() {
  const t = useT();
  const participants = useGuestCallStore((s) => s.participants);
  const guestId = useGuestCallStore((s) => s.guestId);
  const selfMuted = useCallStore((s) => s.isMuted);
  const remoteMicMuted = useCallStore((s) => s.remoteMicMuted);
  const selfIdentity = guestId ? `guest:${guestId}` : '';

  const rows = [
    ...participants.users.map((u) => ({
      id: u.user_id,
      name: u.username ?? u.user_id.slice(0, 8),
      avatarUrl: u.avatar_url,
      isGuest: false,
    })),
    ...participants.guests.map((g) => ({ id: g.id, name: g.display_name, avatarUrl: undefined, isGuest: true })),
  ];

  return (
    <ul className="guest-roster">
      {rows.map((row) => {
        const isSelf = row.id === selfIdentity;
        const muted = isSelf ? selfMuted : (remoteMicMuted.get(row.id) ?? false);
        return (
          <li key={row.id} className="guest-roster-row">
            <Avatar username={row.name} url={row.avatarUrl} className="guest-roster-avatar" />
            <span className="guest-roster-name">{row.name}</span>
            {row.isGuest && <span className="guest-roster-chip">{t('guest.guestBadge')}</span>}
            {isSelf && <span className="guest-roster-chip is-self">{t('guest.youBadge')}</span>}
            <span className={`guest-roster-mic${muted ? ' is-muted' : ''}`}>
              {muted ? <MicOff size={14} strokeWidth={1.8} /> : <Mic size={14} strokeWidth={1.8} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: Update `GuestCallView.tsx`**

Remove the `GuestChatPanel`/`GuestParticipantsPanel`/`toChatMessage` definitions
(current lines 115-276) and their now-unused imports (`Fragment`, `useMemo`,
`Composer`/`ComposerHandle`, `MessageRow`, `DayDivider`, `MediaLightbox`/
`pickLightboxMedia`, `Avatar`, `ChatMessage`, `GuestChatMessage`, `Attachment`/
`MemberWithUser`, `isContinuation`, `useDateFormat`/`isSameCalendarDay`,
`guestErrorText`, `MicOff`/`Mic` — keep whatever `GuestCallView` itself still uses,
e.g. `Loader2`/`MessageSquare`/`Users`/`X` for its own JSX). Add:

```tsx
import { GuestChatBody } from './guest/GuestChatBody';
import { GuestParticipantsBody } from './guest/GuestParticipantsBody';
```

And change the panel render:

```tsx
{panel === 'chat' ? <GuestChatBody /> : <GuestParticipantsBody />}
```

- [ ] **Step 4: Verify the frozen snapshot from Task 1 is unchanged**

Run: `npx vitest run src/pages/__tests__/GuestCallView.dom.test.tsx`
Expected: PASS, no snapshot diff — the extraction is a pure move.

- [ ] **Step 5: Write behavior tests for the extracted bodies**

```tsx
// client/src/pages/guest/__tests__/GuestChatBody.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { GuestChatBody } from '../GuestChatBody';
import { useGuestCallStore } from '@/stores/guestCallStore';

beforeEach(() => {
  useGuestCallStore.setState({
    guestId: 'g1', displayName: 'Аня', roomId: 'c1',
    preview: { server_name: 's', channel_name: 'general', participant_count: 1 },
    participants: { users: [], guests: [{ id: 'g1', display_name: 'Аня' }] },
    messages: [{
      id: 'm1', content: 'привет всем', created_at: '2026-09-23T10:00:00Z',
      author: { kind: 'guest', guest_id: 'g1', display_name: 'Аня' },
    }],
    chatUnread: 0,
  } as never);
});
afterEach(() => { cleanup(); useGuestCallStore.getState().reset(); });

describe('GuestChatBody', () => {
  it('показывает сообщение из стора', () => {
    render(<GuestChatBody />);
    expect(screen.getByText('привет всем')).toBeInTheDocument();
  });
});
```

```tsx
// client/src/pages/guest/__tests__/GuestParticipantsBody.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { GuestParticipantsBody } from '../GuestParticipantsBody';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useCallStore } from '@/stores/callStore';

beforeEach(() => {
  useGuestCallStore.setState({
    guestId: 'g1',
    participants: {
      users: [{ user_id: 'u2', username: 'boris', avatar_url: undefined }],
      guests: [{ id: 'g1', display_name: 'Аня' }],
    },
  } as never);
});
afterEach(() => {
  cleanup();
  useGuestCallStore.getState().reset();
  useCallStore.getState().reset();
});

describe('GuestParticipantsBody', () => {
  it('показывает себя с бейджем «вы» и второго участника', () => {
    render(<GuestParticipantsBody />);
    expect(screen.getByText('Аня')).toBeInTheDocument();
    expect(screen.getByText('boris')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the new tests**

Run: `npx vitest run src/pages/guest/__tests__/GuestChatBody.test.tsx src/pages/guest/__tests__/GuestParticipantsBody.test.tsx`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/guest/GuestChatBody.tsx client/src/pages/guest/GuestParticipantsBody.tsx client/src/pages/GuestCallView.tsx client/src/pages/guest/__tests__/GuestChatBody.test.tsx client/src/pages/guest/__tests__/GuestParticipantsBody.test.tsx
git commit -m "refactor: extract GuestChatBody/GuestParticipantsBody from GuestCallView"
```

---

### Task 3: `GuestPage.css` mobile polish + in-app-browser hint

**Files:**
- Modify: `client/src/pages/GuestPage.css`
- Modify: `client/src/pages/GuestPage.tsx`
- Create: `client/src/pages/guest/inAppBrowser.ts`
- Create: `client/src/pages/guest/__tests__/inAppBrowser.test.ts`
- Modify: `client/src/i18n/locales/ru.ts`, `client/src/i18n/locales/en.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isInAppBrowser(ua?: string): boolean`, exported for the unit test and
  for `GuestEntry`'s `denied` branch.

- [ ] **Step 1: Write `inAppBrowser.ts`**

```ts
// client/src/pages/guest/inAppBrowser.ts
/** Известные UA-маркеры in-app браузеров (Instagram/Facebook/TikTok/WeChat/
 *  Line) — эти вебвью часто блокируют getUserMedia на уровне хост-приложения,
 *  и гость получает `denied` без объяснения причины (спека §7). */
const MARKERS = ['Instagram', 'FBAN', 'FBAV', 'TikTok', 'MicroMessenger', 'Line/'];

export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  return MARKERS.some((m) => ua.includes(m));
}
```

- [ ] **Step 2: Write the test**

```ts
// client/src/pages/guest/__tests__/inAppBrowser.test.ts
import { describe, it, expect } from 'vitest';
import { isInAppBrowser } from '../inAppBrowser';

describe('isInAppBrowser', () => {
  it('распознаёт Instagram-вебвью', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) Instagram 300.0.0')).toBe(true);
  });
  it('распознаёт TikTok-вебвью', () => {
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 13) TikTok 32.0.0')).toBe(true);
  });
  it('не срабатывает на обычном Chrome', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Chrome/120.0')).toBe(false);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run src/pages/guest/__tests__/inAppBrowser.test.ts`
Expected: PASS.

- [ ] **Step 4: Add the i18n key**

In `client/src/i18n/locales/ru.ts`, inside the `guest:` block, immediately after
`mediaDeniedHint`:

```ts
    inAppBrowserHint: 'Похоже, вы открыли ссылку внутри другого приложения. Откройте её в Chrome, Safari или через «Открыть в браузере».',
```

In `client/src/i18n/locales/en.ts`, same position:

```ts
    inAppBrowserHint: 'Looks like you opened this link inside another app. Open it in Chrome, Safari, or via "Open in browser".',
```

- [ ] **Step 5: Wire the hint into `GuestEntry` and tag its card**

In `client/src/pages/GuestPage.tsx`, add the import:

```tsx
import { isInAppBrowser } from './guest/inAppBrowser';
```

Change `GuestEntry`'s outer card `<div className="guest-card">` to
`<div className="guest-card guest-card-entry">` (mobile-only styling hook, Step 6
below). Change the `denied` block to also show the new hint when detected:

```tsx
{denied && (
  <p className="guest-warning">
    {t('guest.mediaDenied')} {t('guest.mediaDeniedHint')}
    {isInAppBrowser() && ` ${t('guest.inAppBrowserHint')}`}
  </p>
)}
```

- [ ] **Step 6: Add the missing name-input attributes (spec §7, pre-existing gap)**

The spec requires the name field to carry `autocomplete="nickname"` and
`enterkeyhint="go"`; the current input has neither. In `GuestEntry`'s `<input>`
(the one with `data-autofocus`), add:

```tsx
            data-autofocus
            autoComplete="nickname"
            enterKeyHint="go"
```

This is not width-gated — both attributes are harmless/beneficial at any width
(desktop browsers ignore `enterkeyhint`; `autocomplete="nickname"` only affects
autofill suggestions), so it's a plain additive change, not wrapped in
`isMobile`/`@media`.

- [ ] **Step 7: Add the mobile CSS block**

Append to `client/src/pages/GuestPage.css`:

```css
/* ── Мобильная раскладка (< 900px, спека §7) ──────────────────────────── */

@media (width < 900px) {
  .guest-page {
    min-height: 100dvh;
    padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
  }

  .guest-card {
    max-width: none;
  }

  /* Карточка входа: колонка на всю высоту, «Попросить войти» прижата к низу
     (спека §7) — только здесь, не у узких карточек notice/lobby/ended, у
     которых нет прижимаемого к низу CTA. */
  .guest-card-entry {
    justify-content: space-between;
    height: 100%;
    min-height: 0;
    padding: 0;
    border: none;
    box-shadow: none;
  }

  /* Любая кнопка внутри карточки (toggle, submit, «Отменить» в GuestLobby,
     «Создать аккаунт»/«Закрыть» в GuestEnded) — базовый `.btn` — 34px, ниже
     обязательного минимума (см. Global Constraints). */
  .guest-card .btn {
    min-height: 44px;
  }

  .guest-field .input {
    font-size: 16px;
  }

  .guest-page-stage {
    height: 100dvh;
  }
}
```

- [ ] **Step 8: Verify the CSS diff is additive-only outside the new block**

Run: `git diff client/src/pages/GuestPage.css`
Expected: only the new `@media (width < 900px) { … }` block added at the end, plus
the (harmless, additive) `guest-card-entry` selector inside it — no existing rule
touched.

- [ ] **Step 9: Run gates**

Run (from `client/`): `npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n`
Expected: all clean per Global Constraints.

- [ ] **Step 10: Commit**

```bash
git add client/src/pages/GuestPage.css client/src/pages/GuestPage.tsx client/src/pages/guest/inAppBrowser.ts client/src/pages/guest/__tests__/inAppBrowser.test.ts client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat: mobile CSS polish for guest entry/lobby/notice/ended + in-app-browser hint"
```

---

### Task 4: `GuestMobileCallShell` — mobile in-call wiring

**Files:**
- Create: `client/src/pages/guest/GuestMobileCallShell.tsx`
- Modify: `client/src/pages/GuestPage.tsx`
- Modify: `client/src/pages/GuestCallView.css` (delete dead rule, D2)
- Modify: `client/src/mobile/screens/MobileCallScreen.tsx` (+ optional
  `chatUnreadCount` prop, D4)
- Modify: `client/src/mobile/screens/MobileCallScreen.css` (+ `.mcs-chat-badge`)
- Create: `client/src/pages/guest/__tests__/GuestMobileCallShell.test.tsx`

**Interfaces:**
- Consumes: `useMobileNav` (`@/mobile/nav/useMobileNav`, existing, generic),
  `useCallStageModel` (`@/components/useCallStageModel`, existing, guest-aware),
  `MobileCallScreen`/`CallOverflowSheets` (`@/mobile/screens/MobileCallScreen`,
  `@/mobile/call/CallOverflowSheets`, existing, stage 4, reused per D4 with one
  additive prop).
- Produces: `export function GuestMobileCallShell(): JSX.Element`, mounted by
  `GuestPage.tsx` for `in_call`/`connecting`/`resuming` when `useIsMobile()` is
  true. Task 5's `GuestChatScreen`/`GuestParticipantsScreen` are rendered from
  inside this component's own screen switch (added in that task).

`GuestMobileCallShell` mirrors `CallScreen` in
`client/src/mobile/screens/renderScreen.tsx` (single `useCallStageModel()` call
shared by `MobileCallScreen` and `CallOverflowSheets`, per that file's Important
I1 comment) but is self-contained: it owns its own tiny nav stack instead of
receiving `ctx`/`nav` from the authenticated shell.

- [ ] **Step 1: Add `chatUnreadCount` to `MobileCallScreen`**

In `client/src/mobile/screens/MobileCallScreen.tsx`, add the prop:

```tsx
interface MobileCallScreenProps {
  model: CallStageModel;
  onBack: () => void;
  onOpenChat: () => void;
  onOpenOverflow: () => void;
  onOpenQuality: () => void;
  /** Бейдж непрочитанного на кнопке «Чат» (спека §7) — нужен только гостю:
   *  у участника с аккаунтом непрочитанное в звонке отражается в обычном
   *  списке каналов, отдельного счётчика тут никогда не было и не нужно.
   *  Аутентифицированный `CallScreen` (renderScreen.tsx) этот проп не
   *  передаёт — там всегда `undefined`, кнопка рендерится как раньше. */
  chatUnreadCount?: number;
}
```

And update the function signature + the chat button's JSX:

```tsx
export function MobileCallScreen({ model: m, onBack, onOpenChat, onOpenOverflow, onOpenQuality, chatUnreadCount }: MobileCallScreenProps) {
```

```tsx
        <button type="button" className="mcs-panel-btn mcs-panel-btn-chat" onClick={onOpenChat} aria-label={t('mobile.callOpenChat')}>
          <MessageSquare size={22} strokeWidth={1.8} />
          {Boolean(chatUnreadCount) && <span className="mcs-chat-badge">{chatUnreadCount! > 99 ? '99+' : chatUnreadCount}</span>}
        </button>
```

- [ ] **Step 2: Badge CSS**

Append to `client/src/mobile/screens/MobileCallScreen.css`:

```css
.mcs-panel-btn-chat {
  position: relative;
}

/* Тот же паттерн, что .guest-ctl-badge (GuestCallView.css) — тоже на тёмной
   --stage-* сцене, поэтому --stage-danger, а не --danger. */
.mcs-chat-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--stage-danger);
  color: var(--white);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
```

- [ ] **Step 3: Verify the authenticated flow is untouched**

Run: `npx vitest run src/mobile/screens/__tests__/MobileCallScreen.test.tsx`
Expected: PASS unchanged — `renderScreen.tsx`'s `CallScreen` doesn't pass
`chatUnreadCount`, so `Boolean(undefined)` is `false` and the badge never renders
there.

- [ ] **Step 4: Write the shell**

```tsx
// client/src/pages/guest/GuestMobileCallShell.tsx
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useCallStageModel } from '@/components/useCallStageModel';
import { MobileCallScreen } from '@/mobile/screens/MobileCallScreen';
import { CallOverflowSheets } from '@/mobile/call/CallOverflowSheets';
import type { CallOverflowSub } from '@/mobile/call/useCallOverflowItems';
import { useMobileNav } from '@/mobile/nav/useMobileNav';
import { GuestChatScreen } from '@/mobile/screens/GuestChatScreen';
import { GuestParticipantsScreen } from '@/mobile/screens/GuestParticipantsScreen';
import { useT } from '@/i18n';

/** Мобильная сцена гостевого звонка (спека §7). Тот же MobileCallScreen/
 *  CallOverflowSheets, что у участника с аккаунтом (этап 4) — гостевой режим
 *  они уже умеют (isGuestMode внутри useCallStageModel). Свой стек
 *  useMobileNav с корнем `guestCall`: страница /guest не смонтирована внутри
 *  MobileShell, поэтому навигацию нужно завести отдельно (D3). */
export function GuestMobileCallShell() {
  const t = useT();
  const phase = useGuestCallStore((s) => s.phase);
  const leave = useGuestCallStore((s) => s.leave);
  const chatUnread = useGuestCallStore((s) => s.chatUnread);
  const model = useCallStageModel({ onLeave: () => void leave() });
  const nav = useMobileNav({ kind: 'guestCall' });
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowInitialSub, setOverflowInitialSub] = useState<CallOverflowSub>(null);

  if (nav.top.kind === 'guestChat') return <GuestChatScreen onBack={nav.back} />;
  if (nav.top.kind === 'guestParticipants') return <GuestParticipantsScreen onBack={nav.back} />;

  // connecting/resuming: тот же спиннер, что десктопная GuestCallView
  // показывает при `phase !== 'in_call'` — без этой проверки MobileCallScreen
  // вернул бы null (`!m.isInGroupCall`), т.е. пустой экран вместо спиннера.
  if (phase !== 'in_call') {
    return (
      <div className="guest-page guest-page-stage">
        <div className="guest-status">
          <Loader2 size={28} strokeWidth={1.8} className="guest-spinner" />
          <span>{t('guest.connecting')}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <MobileCallScreen
        model={model}
        onBack={() => void leave()}
        onOpenChat={() => nav.push({ kind: 'guestChat' })}
        onOpenOverflow={() => { setOverflowInitialSub(null); setOverflowOpen(true); }}
        onOpenQuality={() => { setOverflowInitialSub('quality'); setOverflowOpen(true); }}
        chatUnreadCount={chatUnread}
      />
      <CallOverflowSheets
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        model={model}
        guestsPresent={false}
        initialSub={overflowInitialSub}
      />
    </>
  );
}
```

Note: `useCallStageModel()` is called unconditionally before the phase check,
matching the established pattern in `renderScreen.tsx`'s `CallScreen` (which also
calls it before confirming the call is ready) — this is safe under React's rules
of hooks and the hook already tolerates an unpopulated `callStore`/no `guestSelf`.
During task review, empirically verify (via the acceptance pass, not just types)
that mounting during `connecting`/`resuming` doesn't trigger any extra media
acquisition beyond what `groupCallService`/`guestGateway` already do on their own
schedule — if it does, move the hook call inside the `phase === 'in_call'` branch
instead and adjust the early-return spinner to not call it at all.

Note: `onBack` on the top-level `MobileCallScreen` call is wired to `leave()`
directly rather than a collapse/back gesture — a guest has nowhere to "collapse"
the call to (no tab bar, no other screens to return to below it in the stack;
`guestCall` is the root). Collapsing would leave an empty stage behind it.

- [ ] **Step 5: Wire `GuestPage.tsx`**

Add imports:

```tsx
import { useIsMobile } from '@/mobile/breakpoint';
import { GuestMobileCallShell } from './guest/GuestMobileCallShell';
```

Change the in-call dispatch:

```tsx
if (phase === 'in_call' || phase === 'connecting' || phase === 'resuming') {
  return isMobile ? <GuestMobileCallShell /> : <GuestCallView />;
}
```

with `const isMobile = useIsMobile();` added near the top of `GuestPage()`
alongside the existing `useState`/store-selector calls.

- [ ] **Step 6: Delete the dead breakpoint (D2)**

In `client/src/pages/GuestCallView.css`, delete lines 185-192 (the
`@media (width <= 720px) { .guest-side {…} }` block) in full — `GuestCallView`
never renders below 900px once Step 5 lands.

- [ ] **Step 7: Write a behavior test for the shell's screen dispatch**

```tsx
// client/src/pages/guest/__tests__/GuestMobileCallShell.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GuestMobileCallShell } from '../GuestMobileCallShell';
import { useCallStore } from '@/stores/callStore';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { stubBrowser } from '@/components/__tests__/callHarness';

vi.mock('@/services/groupCall', () => ({
  groupCallService: {
    localStreamState: null, screenStreamState: null,
    toggleMuteAudio: vi.fn(), toggleMuteVideo: vi.fn(),
    stopScreenShare: vi.fn(), startScreenShare: vi.fn(),
    watchShare: vi.fn(), unwatchShare: vi.fn(),
  },
}));
vi.mock('@/services/callBus', () => ({ callBus: { send: vi.fn(), on: vi.fn(() => () => {}) } }));

beforeAll(stubBrowser);
beforeEach(() => {
  useCallStore.setState({
    callChannelId: 'c1', callChannelName: 'general', status: 'connected',
    startedAt: Date.now(), isMuted: false, isVideoOff: true, isMicAvailable: true,
    participants: [], directory: {}, guestSelf: { id: 'g1', display_name: 'Аня' } as never,
  });
  useGuestCallStore.setState({
    phase: 'in_call', guestId: 'g1', displayName: 'Аня', roomId: 'c1',
    participants: { users: [], guests: [{ id: 'g1', display_name: 'Аня' }] },
    messages: [], chatUnread: 0,
  } as never);
});
afterEach(() => {
  cleanup();
  useCallStore.getState().reset();
  useGuestCallStore.getState().reset();
});

const mount = () => render(<MemoryRouter><GuestMobileCallShell /></MemoryRouter>);

describe('GuestMobileCallShell', () => {
  it('открывает чат по кнопке в панели и возвращается назад', () => {
    mount();
    fireEvent.click(screen.getByLabelText('Открыть чат'));
    expect(screen.getByText('Чат')).toBeInTheDocument(); // ScreenHeader title — см. Task 5's GuestChatScreen
    fireEvent.click(screen.getByLabelText('Назад'));
    expect(screen.queryByText('Чат')).not.toBeInTheDocument(); // снова сцена звонка, не экран чата
  });

  it('показывает спиннер, пока phase не in_call', () => {
    useGuestCallStore.setState({ phase: 'connecting' } as never);
    mount();
    expect(screen.getByText('Подключаемся…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Открыть чат')).not.toBeInTheDocument();
  });
});
```

(This test asserts against Task 5's `GuestChatScreen` header — it will fail until
Task 5 lands; that's expected and fine within the same fix loop / task-review
cycle if the two are reviewed together, or this test can be deferred to Task 5's
file list if the reviewer prefers strict per-task independence. Note this
explicitly in the dispatch brief for whichever of Task 4/5 writes it.)

- [ ] **Step 8: Run gates**

Run (from `client/`): `npx tsc --noEmit && npx stylelint "src/**/*.css"`
Expected: clean. (The shell test above may not pass until Task 5 — see the note.)

- [ ] **Step 9: Commit**

```bash
git add client/src/mobile/screens/MobileCallScreen.tsx client/src/mobile/screens/MobileCallScreen.css client/src/pages/guest/GuestMobileCallShell.tsx client/src/pages/GuestPage.tsx client/src/pages/GuestCallView.css client/src/pages/guest/__tests__/GuestMobileCallShell.test.tsx
git commit -m "feat: mobile in-call shell for /guest, reusing MobileCallScreen (stage 4)"
```

---

### Task 5: `GuestChatScreen` / `GuestParticipantsScreen`

**Files:**
- Create: `client/src/mobile/screens/GuestChatScreen.tsx`
- Create: `client/src/mobile/screens/GuestParticipantsScreen.tsx`
- Create: `client/src/mobile/screens/GuestChatScreen.css`
- Create: `client/src/mobile/screens/GuestParticipantsScreen.css`
- Create: `client/src/mobile/screens/__tests__/GuestChatScreen.test.tsx`
- Create: `client/src/mobile/screens/__tests__/GuestParticipantsScreen.test.tsx`

**Interfaces:**
- Consumes: `GuestChatBody`/`GuestParticipantsBody` (Task 2), `ScreenHeader`
  (`@/mobile/components/ScreenHeader`, existing).
- Produces: `export function GuestChatScreen({ onBack }: { onBack: () => void })`,
  `export function GuestParticipantsScreen({ onBack }: { onBack: () => void })` —
  consumed by Task 4's `GuestMobileCallShell`.

- [ ] **Step 1: `GuestChatScreen.tsx`**

```tsx
// client/src/mobile/screens/GuestChatScreen.tsx
import { useEffect } from 'react';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { GuestChatBody } from '@/pages/guest/GuestChatBody';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useT } from '@/i18n';
import './GuestChatScreen.css';

/** Экран `guestChat` (спека §7) — чат гостевого звонка поверх сцены, тот же
 *  GuestChatBody, что и десктопный aside в GuestCallView.tsx. Гасит
 *  непрочитанное при открытии — то же место, что и у десктопной
 *  GuestCallView (эффект на родителе панели, не внутри самого тела). */
export function GuestChatScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const chatUnread = useGuestCallStore((s) => s.chatUnread);
  const markChatRead = useGuestCallStore((s) => s.markChatRead);
  useEffect(() => {
    if (chatUnread > 0) markChatRead();
  }, [chatUnread, markChatRead]);
  return (
    <div className="guest-chat-screen">
      <ScreenHeader title={t('guest.chat')} onBack={onBack} />
      <div className="guest-chat-screen-body">
        <GuestChatBody />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `GuestParticipantsScreen.tsx`**

```tsx
// client/src/mobile/screens/GuestParticipantsScreen.tsx
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { GuestParticipantsBody } from '@/pages/guest/GuestParticipantsBody';
import { useT } from '@/i18n';
import './GuestParticipantsScreen.css';

/** Экран `guestParticipants` (спека §7) — ростер гостевого звонка поверх
 *  сцены, тот же GuestParticipantsBody, что и десктопный aside. */
export function GuestParticipantsScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <div className="guest-participants-screen">
      <ScreenHeader title={t('guest.participants')} onBack={onBack} />
      <div className="guest-participants-screen-body">
        <GuestParticipantsBody />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: CSS — full-height flex wrappers**

```css
/* client/src/mobile/screens/GuestChatScreen.css */
.guest-chat-screen {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.guest-chat-screen-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.guest-chat-screen-body .guest-chat-feed {
  flex: 1;
  overflow-y: auto;
}
```

```css
/* client/src/mobile/screens/GuestParticipantsScreen.css */
.guest-participants-screen {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.guest-participants-screen-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

- [ ] **Step 4: Wire the two screens into `GuestMobileCallShell`**

Task 4 already imports and renders `GuestChatScreen`/`GuestParticipantsScreen`
from within its own top-of-function `if` checks — no further change needed there
if Task 4 was dispatched after this task's interfaces were known. If Task 4 ran
first (per this plan's ordering), re-run its shell test now (Step 5 below) to
confirm the two screens resolve.

- [ ] **Step 5: Write behavior tests**

```tsx
// client/src/mobile/screens/__tests__/GuestChatScreen.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { GuestChatScreen } from '../GuestChatScreen';
import { useGuestCallStore } from '@/stores/guestCallStore';

beforeEach(() => {
  useGuestCallStore.setState({
    guestId: 'g1', displayName: 'Аня', roomId: 'c1',
    participants: { users: [], guests: [] },
    messages: [], chatUnread: 0,
  } as never);
});
afterEach(() => { cleanup(); useGuestCallStore.getState().reset(); });

describe('GuestChatScreen', () => {
  it('заголовок «Чат» и кнопка назад', () => {
    const onBack = vi.fn();
    render(<GuestChatScreen onBack={onBack} />);
    expect(screen.getByText('Чат')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Назад'));
    expect(onBack).toHaveBeenCalled();
  });
});
```

```tsx
// client/src/mobile/screens/__tests__/GuestParticipantsScreen.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { GuestParticipantsScreen } from '../GuestParticipantsScreen';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useCallStore } from '@/stores/callStore';

beforeEach(() => {
  useGuestCallStore.setState({
    guestId: 'g1',
    participants: { users: [], guests: [{ id: 'g1', display_name: 'Аня' }] },
  } as never);
});
afterEach(() => {
  cleanup();
  useGuestCallStore.getState().reset();
  useCallStore.getState().reset();
});

describe('GuestParticipantsScreen', () => {
  it('заголовок «Участники» и строка себя', () => {
    const onBack = vi.fn();
    render(<GuestParticipantsScreen onBack={onBack} />);
    expect(screen.getByText('Участники')).toBeInTheDocument();
    expect(screen.getByText('Аня')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Назад'));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Re-run Task 4's shell test**

Run: `npx vitest run src/pages/guest/__tests__/GuestMobileCallShell.test.tsx src/mobile/screens/__tests__/GuestChatScreen.test.tsx src/mobile/screens/__tests__/GuestParticipantsScreen.test.tsx`
Expected: all PASS now that both screens exist.

- [ ] **Step 7: Commit**

```bash
git add client/src/mobile/screens/GuestChatScreen.tsx client/src/mobile/screens/GuestParticipantsScreen.tsx client/src/mobile/screens/GuestChatScreen.css client/src/mobile/screens/GuestParticipantsScreen.css client/src/mobile/screens/__tests__/GuestChatScreen.test.tsx client/src/mobile/screens/__tests__/GuestParticipantsScreen.test.tsx
git commit -m "feat: GuestChatScreen/GuestParticipantsScreen for the mobile guest call"
```

---

### Task 6: Coverage table + acceptance

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md` (§10
  coverage table + a new "Этап 6 — отложено и найдено по пути" section)

**Interfaces:** none — documentation + verification only.

- [ ] **Step 1: Run the full gate suite**

Run (from `client/`):
```bash
npx tsc --noEmit
npx stylelint "src/**/*.css"
npm run check:i18n
npm test -- --run
```
Expected: `tsc`/`stylelint` zero bytes; i18n check clean; test suite exactly 3
failed (all `api.network-retry.test.ts`), matching the pre-stage baseline plus
every new test file passing.

- [ ] **Step 2: Visual/behavioral verification**

Using `client/tools/verify/smoke.mjs` (or the project's established CDP harness
convention from stages 4-5), check at a mobile viewport width and both themes:
- `/guest` entry screen: camera preview 4:3, toggles reachable, name input
  doesn't trigger iOS zoom (16px), submit button pinned to the bottom.
- `/guest` lobby/ended/notice screens: readable, ≥44px targets, safe-area
  respected.
- `/guest` in-call: `MobileCallScreen` renders instead of the desktop
  `GuestCallView` layout; the chat button opens `GuestChatScreen` full-screen;
  back returns to the call; participants screen shows the guest's own row with
  the «вы» badge.
- Confirm `≥900px`: `/guest` renders byte-identical to pre-stage (spot-check via
  `git diff` on `GuestPage.tsx`/`GuestCallView.tsx` outside the `isMobile`
  branches, plus a screenshot comparison if the harness supports it).

Record any found-and-fixed issues in the plan's ledger during execution, the same
way stage 5's Task 7 did.

- [ ] **Step 3: Update the coverage table (§10)**

For every row under "Гостевая страница" (or wherever guest-related rows live in
the table — search the table for `guest`/`/guest`), mark ✅ этап 6 with a one-line
note on how it was verified, following the exact citation style already used for
rows 1-4, 70-97 (file paths under `.superpowers/vyc95/s6/` for any screenshots
taken, or the specific test file for behavior claims).

- [ ] **Step 4: Add the "Этап 6 — отложено" section**

Immediately after the existing "### Этап 5 — отложено и найдено по пути" section,
add "### Этап 6 — отложено и найдено по пути" documenting anything genuinely
deferred (there should be none forced by this plan, but acceptance testing may
surface real bugs the same way stage 5's did — follow the same
fix-now-if-cheap-and-mainline, defer-with-reasoning-otherwise discipline from
that stage).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-20-mobile-redesign-design.md
git commit -m "docs: mark stage 6 (guest) coverage in the mobile redesign spec"
```
