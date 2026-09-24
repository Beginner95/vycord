# VYC-95 · Этап 1 — мобильный каркас: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить CSS-модель `data-mobile-panel` на настоящую мобильную оболочку (стек экранов в history, таб-бар, свайп назад, bottom sheet в overlay-контракте, PWA), смонтировав в неё существующие панели без потери функций; десктоп ≥ 900px — пиксель в пиксель.

**Architecture:** Логика `AppPage` выносится в `useAppController`; `AppPage` становится развилкой `useIsMobile() ? <MobileShell/> : <DesktopShell/>`. Стек экранов хранится в `location.state.m` роутера, чистые функции (`navReducer`, `reconcile`, трекеры жестов) покрыты TDD, React-обёртки тонкие. `BottomSheet` использует существующие `useModalFocus` + `.modal-overlay`.

**Tech Stack:** React 19, react-router-dom 7 (`BrowserRouter` веб / `HashRouter` Electron), Zustand 5, Vitest 4 (глобально `node`, jsdom — директивой в файле), @testing-library/react 16, lucide-react, чистый CSS на токенах.

**Spec:** `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md` (§1–§4, §8, §9 п.1, строки 90/93/95/96/97 таблицы §10).

## Global Constraints

- Все `npm`/`npx`/`node` — из `client/`. Dev-сервер — `npm run dev:vite`.
- Гейты: `npx tsc --noEmit` — 0 байт; `npx stylelint "src/**/*.css"` — 0 байт; `npm run check:i18n` — «непереведённых строк не найдено.»; `npm test` — ровно 3 падения, все в `api.network-retry.test.ts` (этот файл не трогать).
- Токены только по ролям из `client/docs/design-system.md`; ни одного сырого цвета вне `tokens.css` (исключение этого этапа — литералы в `manifest.webmanifest` и `<meta name="theme-color">`, вносятся в список исключений design-system.md); нет 12px-радиуса; z-index только токеном; `var(--x, fallback)` только для JS-инжектируемых свойств.
- Классы: `component-thing`, состояния `is-*`/`has-*`; иконки lucide с явным `size` и `strokeWidth={1.8}`.
- Всё плавающее — через overlay-контракт (`.modal-overlay` + `useModalFocus`, либо `useEscapeDismiss`); никаких приватных `keydown`-слушателей.
- Motion ≤ 250ms, `var(--ease-out)`, `prefers-reduced-motion` → только fade.
- i18n: `ru.ts` и `en.ts` меняются вместе.
- Мобильная модель: `(width < 900px)`; десктоп — `(width >= 900px)`. Новых чисел-брейкпоинтов нет.
- **Коммиты делает пользователь.** Задачи не коммитят; последняя задача предлагает сообщение коммита этапа. Никогда `git add -A` / `git add .`. Никакого co-author.
- `callStore`, `services/call.ts`, `services/groupCall.ts` не меняются.

## Файловая карта

| Файл | Ответственность |
|---|---|
| `src/mobile/breakpoint.ts` | `MOBILE_MQ`, `isMobileViewport()`, `useIsMobile()` |
| `src/styles/__tests__/breakpoint-contract.test.ts` | все `@media` по ширине ∈ разрешённому набору + точный allowlist наследия |
| `src/pages/app/useCallRing.ts` | AudioContext, рингтон, `voice_call_ring`/`voice_call_cancel`, `callNotif` |
| `src/pages/app/useVoiceParticipants.ts` | `voice_state`/`voice_participants` → `Map` |
| `src/pages/app/useAppController.ts` | вся остальная логика `AppPage` + события навигации |
| `src/pages/app/CreateServerModal.tsx` | инлайн-модалка создания сервера из `AppPage` |
| `src/pages/app/AppOverlays.tsx` | общие оверлеи: Find/Settings/CreateChannel/CreateServer/CallNotif/CommandPalette |
| `src/pages/app/DesktopShell.tsx` | сегодняшний JSX `AppPage` (DOM ≥ 900 идентичен) |
| `src/pages/AppPage.tsx` | развилка |
| `src/mobile/nav/types.ts` | `TabId`, `Screen`, `Stack`, `SettingsSection` |
| `src/mobile/nav/navReducer.ts` | чистые операции над стеком |
| `src/mobile/nav/reconcile.ts` | стек × сторы → валидный стек + действие синхронизации |
| `src/mobile/nav/useMobileNav.ts` | стек ↔ `location.state` |
| `src/mobile/gestures/edgeSwipe.ts` | `createSwipeTracker`, `decideSwipe` |
| `src/mobile/gestures/useEdgeSwipeBack.ts` | pointer-проводка трекера |
| `src/mobile/gestures/useLongPress.ts` | long-press |
| `src/mobile/sheets/useBackDismiss.ts` | закрытие sheet'а системным «назад» |
| `src/mobile/sheets/BottomSheet.tsx` + `.css` | примитив sheet'а |
| `src/mobile/sheets/ActionSheet.tsx` | sheet со списком `ContextMenuItem[]` |
| `src/mobile/components/ScreenHeader.tsx` + `.css` | шапка экрана |
| `src/mobile/components/TabBar.tsx` + `.css` | таб-бар |
| `src/mobile/MobileShell.tsx` + `.css` | оболочка: стек, экраны, таб-бар, док звонка |
| `src/mobile/screens/renderScreen.tsx` | `Screen` → существующая панель (этап 1) |
| `public/manifest.webmanifest`, `public/icons/*` | PWA |
| `index.html` | manifest, theme-color, apple-*, viewport |
| `src/stores/themeStore.ts` | синхронизация `meta[name=theme-color]` |
| `src/styles/primitives.css` | `.modal` докладывается снизу при `< 900px` |

---

### Task 1: Десктопный эталон 1280×800

**Files:** только скриншоты в `/www/my/vycord/.superpowers/vyc95/baseline/` (каталог `.superpowers/` в `.gitignore`).

- [ ] **Step 1: Поднять свежий dev-сервер**

```bash
cd /www/my/vycord/client && (npm run dev:vite > /tmp/vyc95-vite.log 2>&1 &) ; sleep 4; curl -sI http://localhost:3000 | head -1
```
Expected: `HTTP/1.1 200 OK`. (Если порт занят чужим vite — убить его и запустить заново: устаревший сервер обесценивает скриншоты.)

- [ ] **Step 2: Снять эталон — 5 состояний × 2 темы, дважды**

```bash
cd /www/my/vycord/client && set -a && source tools/verify/.env && set +a
B=/www/my/vycord/.superpowers/vyc95/baseline; mkdir -p $B
for run in a b; do for th in light dark; do
  node tools/verify/smoke.mjs --size 1280x800 --theme $th --path /app --wait 5000 --out $B/chat-$th-$run.png
  node tools/verify/smoke.mjs --size 1280x800 --theme $th --path /app --wait 5000 --click '.server-icon-home' --after 1500 --out $B/home-$th-$run.png
  node tools/verify/smoke.mjs --size 1280x800 --theme $th --path /app --wait 5000 --click '.user-actions .panel-icon-btn:not(.is-danger)' --after 1000 --out $B/settings-$th-$run.png
  node tools/verify/smoke.mjs --size 1100x800 --theme $th --path /app --wait 5000 --out $B/band1100-$th-$run.png
  node tools/verify/smoke.mjs --size 950x800 --theme $th --path /app --wait 5000 --out $B/band950-$th-$run.png
done; done
```

- [ ] **Step 3: Измерить шум эталона**

```bash
B=/www/my/vycord/.superpowers/vyc95/baseline
for f in $B/*-a.png; do g=${f%-a.png}-b.png; printf '%s ' "$(basename ${f%-a.png})"; compare -metric AE "$f" "$g" /dev/null 2>&1; echo; done
```
Expected: для каждого состояния число пикселей. `0` — состояние детерминировано, после изменений требуем `0`. Не `0` — сохранить `compare "$f" "$g" $B/noise-<name>.png` и записать в `$B/NOISE.md`, какие области шумят (время «last seen», онлайн-точки и т.п.); при сравнении после изменений допускаются расхождения **только в этих областях** (проверять по diff-картинке глазами).

---

### Task 2: Брейкпоинт — хук и контрактный тест

**Files:**
- Create: `client/src/mobile/breakpoint.ts`
- Test: `client/src/mobile/__tests__/breakpoint.test.tsx`
- Test: `client/src/styles/__tests__/breakpoint-contract.test.ts`

**Interfaces:**
- Produces: `MOBILE_MQ: '(width < 900px)'`, `isMobileViewport(): boolean`, `useIsMobile(): boolean`.

- [ ] **Step 1: Тест хука (падающий)**

`client/src/mobile/__tests__/breakpoint.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { MOBILE_MQ, useIsMobile } from '@/mobile/breakpoint';

function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() { return matches; },
    media: MOBILE_MQ,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  const spy = vi.fn((q: string) => {
    if (q !== MOBILE_MQ) throw new Error(`unexpected query ${q}`);
    return mql;
  });
  window.matchMedia = spy as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) { matches = next; listeners.forEach((l) => l()); },
    listenerCount: () => listeners.size,
  };
}

afterEach(cleanup);

describe('useIsMobile', () => {
  it('uses the single mobile query', () => {
    expect(MOBILE_MQ).toBe('(width < 900px)');
  });

  it('reflects the initial match and follows changes', () => {
    const mm = stubMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    act(() => mm.set(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const mm = stubMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobile());
    expect(mm.listenerCount()).toBe(1);
    unmount();
    expect(mm.listenerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `cd client && npx vitest run src/mobile/__tests__/breakpoint.test.tsx`
Expected: FAIL — `Failed to resolve import "@/mobile/breakpoint"`.

- [ ] **Step 3: Реализация**

`client/src/mobile/breakpoint.ts`:
```ts
import { useSyncExternalStore } from 'react';

/** Единственная граница мобильной модели (спека §2). В CSS — тот же литерал
 *  `(width < 900px)` / `(width >= 900px)`; их держит breakpoint-contract.test.ts.
 *  `<`, а не `<= 899px`: layout viewport дробный (зум, дробный DPR), и только
 *  пара `< 900` / `>= 900` разбивает его без щели (M6 T8, AppPage.css). */
export const MOBILE_MQ = '(width < 900px)';

export function isMobileViewport(): boolean {
  return window.matchMedia(MOBILE_MQ).matches;
}

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_MQ);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileViewport, () => false);
}
```

- [ ] **Step 4: Прогнать — зелёный**

Run: `cd client && npx vitest run src/mobile/__tests__/breakpoint.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Контрактный тест (сначала без allowlist — увидеть падение)**

`client/src/styles/__tests__/breakpoint-contract.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * VYC-95, спека §2 — один мобильный брейкпоинт.
 *
 * До VYC-95 оболочка переключалась на `width < 900px`, а 17 компонентных
 * блоков остались на `<= 768px` (плюс `<= 640px`, `<= 720px`): в полосе
 * 769–899 раскладка была мобильной, а компоненты — десктопными. Тест
 * фиксирует допустимый набор условий по ширине. Наследие перечислено
 * ТОЧНО (файл → условие → число вхождений): и новый нарушитель, и
 * исправленный блок требуют правки этого списка. Этап 7 опустошает его.
 */

const ALLOWED = new Set([
  'width < 900px',            // мобильная модель
  'width >= 900px',           // десктоп
  '900px <= width < 1200px',  // десктопный бенд AppPage (M6 T8)
  'width < 1200px',           // десктопный бенд AppPage (M6 T8)
]);

const LEGACY: Record<string, Record<string, number>> = {
  'components/CallStage.css': { 'width <= 768px': 6, 'width <= 640px': 1 },
  'components/ChannelSidebar.css': { 'width <= 768px': 1 },
  'components/ChatArea.css': { 'width <= 768px': 1 },
  'components/CommandPalette.css': { 'width <= 640px': 1 },
  'components/Composer.css': { 'width <= 768px': 1 },
  'components/FriendsPanel.css': { 'width <= 768px': 1 },
  'components/MediaLightbox.css': { 'width <= 768px': 1 },
  'components/MessageAttachments.css': { 'width <= 768px': 1 },
  'components/MessageRow.css': { 'width <= 768px': 1 },
  'components/MessageSearch.css': { 'width <= 768px': 1 },
  'components/ServerList.css': { 'width <= 768px': 1 },
  'components/UserList.css': { 'width <= 768px': 1 },
  'components/VideoPlayer.css': { 'width <= 768px': 1 },
  'components/VoiceBanner.css': { 'width <= 768px': 1 },
  'pages/GuestCallView.css': { 'width <= 720px': 1 },
};

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : cssFiles(p);
    return p.endsWith('.css') ? [p] : [];
  });
}

/** Условия по ширине из всех @media-прелюдий файла, комментарии вырезаны. */
function widthConditions(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const preludes = [...stripped.matchAll(/@media([^{]*)\{/g)].map((m) => m[1]);
  return preludes.flatMap((p) =>
    [...p.matchAll(/\(([^()]*\bwidth\b[^()]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' ').trim()),
  );
}

describe('breakpoint contract (VYC-95 §2)', () => {
  const found: Record<string, Record<string, number>> = {};
  for (const file of cssFiles(SRC)) {
    const rel = relative(SRC, file);
    for (const cond of widthConditions(readFileSync(file, 'utf8'))) {
      if (ALLOWED.has(cond)) continue;
      found[rel] ??= {};
      found[rel][cond] = (found[rel][cond] ?? 0) + 1;
    }
  }

  it('the scanner sees the known mobile queries (non-vacuous)', () => {
    const all = cssFiles(SRC).flatMap((f) => widthConditions(readFileSync(f, 'utf8')));
    expect(all).toContain('width < 900px');
    expect(all).toContain('width <= 768px');
  });

  it('every width condition is allowed or is exactly-listed legacy', () => {
    expect(found).toEqual(LEGACY);
  });
});
```

Временно замените `const LEGACY = {...}` на `const LEGACY = {}`.

Run: `cd client && npx vitest run src/styles/__tests__/breakpoint-contract.test.ts`
Expected: FAIL второго теста; в diff — ровно 15 файлов из списка выше. Если набор отличается (например, найдено `width < 900px` в `UserPanel.css` как нарушение) — поправить `ALLOWED`/`LEGACY` по фактическому выводу, а не по плану.

- [ ] **Step 6: Вернуть LEGACY — зелёный; проверить, что он ловит**

Вернуть полный `LEGACY`. Run тот же — PASS. Затем временно дописать `@media (width <= 700px) { .chat-area { color: inherit; } }` в конец `src/components/ChatArea.css`, прогнать — FAIL с `'width <= 700px': 1`; удалить строку, прогнать — PASS.

---

### Task 3: Вынос контроллера и `DesktopShell` (чистый рефакторинг)

Поведение **на всех ширинах** не меняется: старая мобильная модель `data-mobile-panel` продолжает работать до Task 10.

**Files:**
- Create: `client/src/pages/app/useCallRing.ts`, `useVoiceParticipants.ts`, `useAppController.ts`, `CreateServerModal.tsx`, `AppOverlays.tsx`, `DesktopShell.tsx`
- Modify: `client/src/pages/AppPage.tsx` (целиком)

**Interfaces:**
- Produces:
```ts
// useCallRing.ts
export interface CallNotif { channelId: string; channelName: string; callerId: string; callerName: string }
export function useCallRing(currentServerId: string | null, userId: string | null): {
  callNotif: CallNotif | null;
  dismiss(): void;          // стоп рингтона + null
};
// useVoiceParticipants.ts
export function useVoiceParticipants(): Map<string, string[]>;
// useAppController.ts
export type MobilePanel = 'servers' | 'channels' | 'chat' | 'call' | 'members';
export type AppNavEvent =
  | { type: 'serverOpened'; serverId: string }
  | { type: 'callJoined'; serverId: string | null; channelId: string };
export interface AppControllerOptions {
  autoOpenChannel: boolean;                 // десктоп: true
  onMobilePanel?: (p: MobilePanel) => void; // ВРЕМЕННО, удаляется в Task 10
}
export interface AppController {
  user: User | null;
  servers: Server[]; currentServer: Server | null;
  channels: Channel[]; currentChannel: Channel | null;
  members: MemberWithUser[];
  pendingCount: number;
  voiceParticipants: Map<string, string[]>;
  callNotif: CallNotif | null;
  selectServer(server: Server): Promise<void>;
  selectChannel(channel: Channel): Promise<void>;
  selectHome(): void;
  joinVoice(channel: Channel): void;
  goToCall(serverId: string | null, channelId: string): void;
  serverRemoved(id: string): void;
  channelRemoved(id: string): void;
  joinServer(server: Server): Promise<void>;
  serverJoined(server: Server): void;
  createServer(name: string, isPrivate: boolean): Promise<void>; // бросает ApiError
  joinCallNotif(): void;
  dismissCallNotif(): void;
  logout(): void;
  subscribe(listener: (e: AppNavEvent) => void): () => void;
  ui: {
    findServerOpen: boolean; setFindServerOpen(v: boolean): void;
    settingsOpen: boolean; setSettingsOpen(v: boolean): void;
    createChannelOpen: boolean; setCreateChannelOpen(v: boolean): void;
    createServerOpen: boolean; setCreateServerOpen(v: boolean): void;
  };
}
export function useAppController(opts: AppControllerOptions): AppController;
```

- [ ] **Step 1: `useCallRing.ts`**

Перенести **дословно** из `AppPage.tsx` строки 34–84 (тип `CallNotif`, модульный `_audioCtx`, `_resumeAudio` + три `addEventListener`, `playRingOnce`, `startCallRingtone`) и эффекты 169–176, 244–278 (ring/cancel), обернув в хук:

```ts
import { useEffect, useRef, useState } from 'react';
import { wsService } from '@/services/websocket';
import { groupCallService } from '@/services/groupCall';

export interface CallNotif { channelId: string; channelName: string; callerId: string; callerName: string }

// ── строки 41–84 AppPage.tsx без изменений (_audioCtx … startCallRingtone) ──

export function useCallRing(currentServerId: string | null, userId: string | null) {
  const [callNotif, setCallNotif] = useState<CallNotif | null>(null);
  const stopRingtoneRef = useRef<(() => void) | null>(null);
  const callNotifRef = useRef<CallNotif | null>(null);
  useEffect(() => { callNotifRef.current = callNotif; }, [callNotif]);
  useEffect(() => () => { stopRingtoneRef.current?.(); }, []);

  useEffect(() => {
    const unsubscribe = wsService.on('voice_call_ring', (payload) => {
      const p = payload as Record<string, unknown>;
      const alreadyInThatCall =
        groupCallService.isInGroupCallState &&
        groupCallService.currentRoomIdState === p.channel_id;
      if (p.server_id === currentServerId && p.caller_id !== userId && !alreadyInThatCall) {
        stopRingtoneRef.current?.();
        setCallNotif({
          channelId: p.channel_id as string,
          channelName: p.channel_name as string,
          callerId: p.caller_id as string,
          callerName: p.caller_name as string,
        });
        stopRingtoneRef.current = startCallRingtone();
      }
    });
    return () => unsubscribe();
  }, [currentServerId, userId]);

  useEffect(() => {
    const unsubscribe = wsService.on('voice_call_cancel', (payload) => {
      const p = payload as Record<string, unknown>;
      if (callNotifRef.current?.channelId === p.channel_id) {
        stopRingtoneRef.current?.();
        stopRingtoneRef.current = null;
        setCallNotif(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const dismiss = () => {
    stopRingtoneRef.current?.();
    stopRingtoneRef.current = null;
    setCallNotif(null);
  };

  return { callNotif, dismiss };
}
```
Замечание: в оригинале зависимости эффекта — `[currentServer, user]` (объекты); здесь — их `id`. Семантика та же (сравниваются только `id`), лишних переподписок меньше.

- [ ] **Step 2: `useVoiceParticipants.ts`**

```ts
import { useEffect, useState } from 'react';
import { wsService } from '@/services/websocket';

/** voice_state / voice_participants → channelId → userIds (перенесено из AppPage). */
export function useVoiceParticipants(): Map<string, string[]> {
  const [voiceParticipants, setVoiceParticipants] = useState<Map<string, string[]>>(new Map());
  // ── тело эффекта AppPage.tsx:280–298 без изменений ──
  return voiceParticipants;
}
```

- [ ] **Step 3: `useAppController.ts`**

Состав (всё — дословный перенос из `AppPage.tsx`, отличия перечислены явно):

| Что | Откуда (`AppPage.tsx`) | Изменение |
|---|---|---|
| сторы и `pendingCount` | 89–92 | — |
| `showCreateServer`/`findServerOpen`/`settingsOpen`/`createChannelOpen` | 93–96 | `showCreateServer` → `createServerOpen` |
| эффекты: WS-reconnect, `loadServers`, `initCallBridge`, `initFriendBridge`, `friendStore.load`, `chat_message`, `user_updated`, `server_update`…`channel_delete` | 178–242, 300–345 | — |
| `loadServerMembers`, `loadServerPermissions`, `callLeaveGroupCall`, `handleJoinVoice`, `handleServerRemoved`, `handleChannelRemoved`, `loadServers`, `handleJoinServer`, `handleServerJoined`, `handleSelectHome`, `handleSelectServer`, `handleSelectChannel`, `handleGoToCall`, `handleLogout` | 347–631 | `setMobilePanel(x)` → `opts.onMobilePanel?.(x)`; см. ниже про `autoOpenChannel` и события |
| создание сервера | 633–649 | становится `createServer(name, isPrivate)` без формы (форма — в `CreateServerModal`) |

Новое в контроллере:

```ts
const listenersRef = useRef(new Set<(e: AppNavEvent) => void>());
const emit = (e: AppNavEvent) => listenersRef.current.forEach((l) => l(e));
const subscribe = (l: (e: AppNavEvent) => void) => {
  listenersRef.current.add(l);
  return () => { listenersRef.current.delete(l); };
};
```

`handleSelectServer` — ветка без автооткрытия канала (мобайл, спека §3.3):
```ts
const handleSelectServer = async (server: Server) => {
  setCurrentServer(server);
  setMembers([]);
  opts.onMobilePanel?.('channels');
  // Мобайл: тап по серверу открывает список каналов, а не чат. Канал чужого
  // сервера сбрасываем, чтобы лента не показывала контекст другого сервера.
  if (!opts.autoOpenChannel) {
    const cur = useServerStore.getState().currentChannel;
    if (cur && cur.server_id !== server.id) { setCurrentChannel(null); setMessages([]); }
  }
  try {
    const data = await apiService.getChannels(server.id) as Channel[];
    setChannels(data);
    loadServerMembers(server.id);
    loadServerPermissions(server.id);
    if (!opts.autoOpenChannel) return;
    // ── далее строки 566–577 без изменений ──
  } catch (err) {
    logger.error('Failed to load channels:', err, { module: 'app' });
  }
};
```

`handleServerJoined` после `handleSelectServer(server)` добавляет `emit({ type: 'serverOpened', serverId: server.id })`; `createServer` — то же после `handleSelectServer(server)`.

`joinCallNotif` (перенос `onJoin` из `AppPage.tsx:824–830`):
```ts
const joinCallNotif = () => {
  const notif = ring.callNotif;
  ring.dismiss();
  if (!notif) return;
  const ch = channels.find((c) => c.id === notif.channelId);
  if (ch) {
    handleSelectChannel(ch);
    handleJoinVoice(ch);
    emit({ type: 'callJoined', serverId: ch.server_id, channelId: ch.id });
  }
};
```
где `const ring = useCallRing(currentServer?.id ?? null, user?.id ?? null);`, а `voiceParticipants = useVoiceParticipants()`.

`createServer`:
```ts
const createServer = async (name: string, isPrivate: boolean) => {
  const server = await apiService.createServer(name, isPrivate) as Server;
  setServers([...useServerStore.getState().servers, server]);
  setCreateServerOpen(false);
  handleSelectServer(server);
  emit({ type: 'serverOpened', serverId: server.id });
};
```

Возврат — объект `AppController` из Interfaces (имена: `selectServer: handleSelectServer`, `serverRemoved: handleServerRemoved`, `channelRemoved: handleChannelRemoved`, `joinServer: handleJoinServer`, `serverJoined: handleServerJoined`, `selectHome: handleSelectHome`, `selectChannel: handleSelectChannel`, `joinVoice: handleJoinVoice`, `goToCall: handleGoToCall`, `logout: handleLogout`, `dismissCallNotif: ring.dismiss`, `callNotif: ring.callNotif`).

- [ ] **Step 4: `CreateServerModal.tsx`**

Разметка — дословно `AppPage.tsx:778–818`, состояние формы — локальное:
```tsx
import { useState } from 'react';
import { apiErrorText } from '@/services/api';
import { logger } from '@/utils/logger';
import { useT } from '@/i18n';

interface CreateServerModalProps {
  onClose: () => void;
  onCreate: (name: string, isPrivate: boolean) => Promise<void>;
}

export function CreateServerModal({ onClose, onCreate }: CreateServerModalProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      await onCreate(name.trim(), isPrivate);
    } catch (err) {
      logger.error('Failed to create server:', err, { module: 'app' });
      setError(apiErrorText(err, t));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {/* дословно AppPage.tsx:781–815 с заменами:
            newServerName → name, setNewServerName(v); setCreateServerError('') → setName(v); setError('')
            newServerIsPrivate → isPrivate, createServerError → error,
            handleCreateServer → submit, «Отмена» onClick → onClose */}
      </div>
    </div>
  );
}
```
Модалка монтируется только при `createServerOpen`, поэтому сброс полей при закрытии обеспечивается размонтированием (как было: `setNewServerName('')` после успеха).

- [ ] **Step 5: `AppOverlays.tsx`**

```tsx
import type { Channel } from '@/types';
import type { AppController } from './useAppController';
import { FindServerModal } from '@/components/FindServerModal';
import { Settings } from '@/components/Settings';
import { CreateChannelModal } from '@/components/CreateChannelModal';
import { CallNotifBanner } from '@/components/CallNotifBanner';
import { CommandPalette } from '@/components/CommandPalette';
import { CreateServerModal } from './CreateServerModal';

interface AppOverlaysProps {
  c: AppController;
  /** Выбор канала в палитре / вход по баннеру — оболочке нужно ещё и навигировать. */
  onPaletteSelectChannel: (channel: Channel) => void;
  onPaletteJoinVoice: (channel: Channel) => void;
  onPaletteShowChat: () => void;
}

/** Общие для обеих оболочек оверлеи, в ТОМ ЖЕ порядке DOM, что был в AppPage
 *  (FindServer → Settings → CreateChannel → CreateServer → CallNotif → Palette). */
export function AppOverlays({ c, onPaletteSelectChannel, onPaletteJoinVoice, onPaletteShowChat }: AppOverlaysProps) {
  const openCreateServer = () => c.ui.setCreateServerOpen(true);
  return (
    <>
      <FindServerModal
        open={c.ui.findServerOpen}
        onClose={() => c.ui.setFindServerOpen(false)}
        onJoinServer={c.joinServer}
        onServerJoined={c.serverJoined}
        onCreateServer={openCreateServer}
      />
      <Settings isOpen={c.ui.settingsOpen} onClose={() => c.ui.setSettingsOpen(false)} onLogout={c.logout} />
      {c.ui.createChannelOpen && c.currentServer && (
        <CreateChannelModal serverId={c.currentServer.id} onClose={() => c.ui.setCreateChannelOpen(false)} />
      )}
      {c.ui.createServerOpen && (
        <CreateServerModal onClose={() => c.ui.setCreateServerOpen(false)} onCreate={c.createServer} />
      )}
      {c.callNotif && (
        <CallNotifBanner
          callerName={c.callNotif.callerName}
          channelName={c.callNotif.channelName}
          onJoin={c.joinCallNotif}
          onDismiss={c.dismissCallNotif}
        />
      )}
      <CommandPalette
        onSelectChannel={onPaletteSelectChannel}
        onOpenSettings={() => c.ui.setSettingsOpen(true)}
        onCreateChannel={() => c.ui.setCreateChannelOpen(true)}
        onCreateServer={openCreateServer}
        onFindServer={() => c.ui.setFindServerOpen(true)}
        onJoinVoice={onPaletteJoinVoice}
        onShowChat={onPaletteShowChat}
      />
    </>
  );
}
```

- [ ] **Step 6: `DesktopShell.tsx`**

Переносит **дословно** из `AppPage.tsx`: состояние `membersOpen`, `leftSidebarHidden` + `toggleLeftSidebar` (104–117), эффект отката `mobilePanel` (127–131), `stageHeight` + `handleSplitDragStart` (136–168), `handleToggleMembers` (546–549) и JSX 652–860 с заменами:
- `handleSelectServer` → `c.selectServer`, `handleSelectChannel` → `c.selectChannel`, `handleJoinVoice` → `c.joinVoice`, `handleServerRemoved` → `c.serverRemoved`, `handleChannelRemoved` → `c.channelRemoved`, `handleSelectHome` → `c.selectHome`, `handleGoToCall` → `c.goToCall`, `handleLogout` → `c.logout`;
- `setShowCreateServer(true); setCreateServerError('')` → `c.ui.setCreateServerOpen(true)`; `setFindServerOpen` → `c.ui.setFindServerOpen`; `setSettingsOpen` → `c.ui.setSettingsOpen`; `setCreateChannelOpen` → `c.ui.setCreateChannelOpen`;
- `servers/currentServer/channels/currentChannel/members/user/pendingCount/voiceParticipants` → из `c`;
- блок 764–846 → `<AppOverlays c={c} onPaletteSelectChannel={c.selectChannel} onPaletteJoinVoice={c.joinVoice} onPaletteShowChat={() => setMobilePanel('chat')} />`.

Сигнатура:
```tsx
interface DesktopShellProps {
  c: AppController;
  mobilePanel: MobilePanel;                 // ВРЕМЕННО до Task 10
  setMobilePanel: (p: MobilePanel) => void; // ВРЕМЕННО до Task 10
}
export function DesktopShell({ c, mobilePanel, setMobilePanel }: DesktopShellProps)
```
`import './../AppPage.css'` переезжает сюда (`import '../AppPage.css';`).

- [ ] **Step 7: `AppPage.tsx`**

```tsx
import { useState } from 'react';
import { usePaletteHotkey } from '@/hooks/usePaletteHotkey';
import { useAppController, type MobilePanel } from './app/useAppController';
import { DesktopShell } from './app/DesktopShell';

export function AppPage() {
  usePaletteHotkey();
  // ВРЕМЕННО (до Task 10): старая мобильная модель data-mobile-panel.
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('servers');
  const c = useAppController({ autoOpenChannel: true, onMobilePanel: setMobilePanel });
  return <DesktopShell c={c} mobilePanel={mobilePanel} setMobilePanel={setMobilePanel} />;
}
```

- [ ] **Step 8: Гейты**

```bash
cd client && npx tsc --noEmit > /tmp/tsc.out 2>&1; echo "exit=$?"; wc -c < /tmp/tsc.out
npx stylelint "src/**/*.css" > /tmp/sl.out 2>&1; echo "exit=$?"; wc -c < /tmp/sl.out
npm test 2>&1 | grep -E "FAIL|Tests " | sort -u
```
Expected: `exit=0`, `0`, `exit=0`, `0`; FAIL-строки только `api.network-retry.test.ts`, `Tests  3 failed | … passed`.

- [ ] **Step 9: Десктоп пиксель-в-пиксель**

Перезапустить `npm run dev:vite` (сервер должен быть новее правок). Снять те же 20 кадров (Task 1 Step 2, `run=after`, в `/www/my/vycord/.superpowers/vyc95/after-t3/`) и сравнить с `*-a.png`:
```bash
A=/www/my/vycord/.superpowers/vyc95/after-t3; B=/www/my/vycord/.superpowers/vyc95/baseline
for f in $B/*-a.png; do n=$(basename ${f%-a.png}); printf '%s ' $n; compare -metric AE "$f" "$A/$n-after.png" "$A/diff-$n.png" 2>&1; echo; done
```
Expected: `0` для детерминированных; для шумных — отличия только в областях из `NOISE.md` (глазами по `diff-*.png`).

- [ ] **Step 10: Старая мобильная модель жива**

`--size 375x812 --touch`: `/app` → кадр списка серверов; `--click '.server-icon:not(.server-icon-home):not(.server-icon-add)'` → кадр списка каналов. Оба не пустые (сравнить с тем, как было до Task 3 — снять и эти два кадра до начала Task 3, если не сняты в Task 1).

---

### Task 4: Типы стека и `navReducer`

**Files:**
- Create: `client/src/mobile/nav/types.ts`, `client/src/mobile/nav/navReducer.ts`
- Test: `client/src/mobile/nav/__tests__/navReducer.test.ts`

**Interfaces:**
- Produces:
```ts
// types.ts
export type TabId = 'servers' | 'friends' | 'profile';
export type SettingsSection = 'profile' | 'privacy' | 'audio' | 'video' | 'appearance' | 'language';
export type Screen =
  | { kind: 'servers' } | { kind: 'friends' } | { kind: 'profile' }
  | { kind: 'channels'; serverId: string }
  | { kind: 'chat'; channelId: string }
  | { kind: 'channelInfo'; channelId: string }
  | { kind: 'call' }
  | { kind: 'serverSettings'; serverId: string }
  | { kind: 'invites'; serverId: string }
  | { kind: 'stickers'; serverId: string }
  | { kind: 'createServer' } | { kind: 'findServer' } | { kind: 'search' }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'friendAdd' }
  | { kind: 'guestCall' } | { kind: 'guestChat' } | { kind: 'guestParticipants' }
  | { kind: 'sheet'; id: string };
export type Stack = readonly Screen[];
// navReducer.ts
export const TAB_ROOT: Record<TabId, Screen>;
export function tabOf(stack: Stack): TabId;          // по stack[0]; не-вкладочный корень → 'servers'
export function isRoot(stack: Stack): boolean;       // length === 1
export function push(stack: Stack, s: Screen): Stack; // top — sheet → заменяет его
export function pop(stack: Stack): Stack;            // не ниже корня
export function stripSheets(stack: Stack): Stack;
export function isStack(v: unknown): v is Stack;
```

- [ ] **Step 1: Тест (падающий)**

`client/src/mobile/nav/__tests__/navReducer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TAB_ROOT, tabOf, isRoot, push, pop, stripSheets, isStack } from '@/mobile/nav/navReducer';
import type { Stack } from '@/mobile/nav/types';

const root: Stack = [{ kind: 'servers' }];

describe('navReducer', () => {
  it('tab roots', () => {
    expect(TAB_ROOT.servers).toEqual({ kind: 'servers' });
    expect(TAB_ROOT.friends).toEqual({ kind: 'friends' });
    expect(TAB_ROOT.profile).toEqual({ kind: 'profile' });
  });

  it('push appends and never mutates', () => {
    const next = push(root, { kind: 'channels', serverId: 's1' });
    expect(next).toEqual([{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }]);
    expect(root).toHaveLength(1);
  });

  it('push over a sheet replaces the sheet entry', () => {
    const withSheet = push(root, { kind: 'sheet', id: 'a' });
    expect(push(withSheet, { kind: 'createServer' })).toEqual([{ kind: 'servers' }, { kind: 'createServer' }]);
  });

  it('pop never goes below the root', () => {
    expect(pop(push(root, { kind: 'call' }))).toEqual(root);
    expect(pop(root)).toEqual(root);
  });

  it('tabOf / isRoot', () => {
    expect(tabOf([{ kind: 'friends' }])).toBe('friends');
    expect(tabOf([{ kind: 'profile' }, { kind: 'settings', section: 'audio' }])).toBe('profile');
    expect(tabOf([{ kind: 'guestCall' }])).toBe('servers');
    expect(isRoot(root)).toBe(true);
    expect(isRoot(push(root, { kind: 'call' }))).toBe(false);
  });

  it('stripSheets drops only sheet entries', () => {
    const s: Stack = [{ kind: 'servers' }, { kind: 'sheet', id: 'x' }, { kind: 'channels', serverId: 'a' }, { kind: 'sheet', id: 'y' }];
    expect(stripSheets(s)).toEqual([{ kind: 'servers' }, { kind: 'channels', serverId: 'a' }]);
  });

  it('isStack validates history.state payloads', () => {
    expect(isStack(root)).toBe(true);
    expect(isStack([{ kind: 'guestCall' }, { kind: 'guestChat' }])).toBe(true);
    expect(isStack(undefined)).toBe(false);
    expect(isStack([])).toBe(false);
    expect(isStack([{ kind: 'nope' }])).toBe(false);
    expect(isStack([{ kind: 'channels', serverId: 's' }])).toBe(false); // корень обязан быть корнем
    expect(isStack([{ kind: 'servers' }, { kind: 'chat' }])).toBe(false); // нет channelId
  });
});
```

- [ ] **Step 2: Прогнать — падает** (`Failed to resolve import`).

Run: `cd client && npx vitest run src/mobile/nav/__tests__/navReducer.test.ts`

- [ ] **Step 3: Реализация**

`types.ts` — ровно блок из Interfaces (с `export`).

`navReducer.ts`:
```ts
import type { Screen, Stack, TabId } from './types';

export const TAB_ROOT: Record<TabId, Screen> = {
  servers: { kind: 'servers' },
  friends: { kind: 'friends' },
  profile: { kind: 'profile' },
};

const ROOT_KINDS = new Set(['servers', 'friends', 'profile', 'guestCall']);

/** Обязательные строковые поля каждого вида экрана. */
const FIELDS: Record<Screen['kind'], readonly string[]> = {
  servers: [], friends: [], profile: [],
  channels: ['serverId'], chat: ['channelId'], channelInfo: ['channelId'], call: [],
  serverSettings: ['serverId'], invites: ['serverId'], stickers: ['serverId'],
  createServer: [], findServer: [], search: [],
  settings: ['section'], friendAdd: [],
  guestCall: [], guestChat: [], guestParticipants: [],
  sheet: ['id'],
};

function isScreen(v: unknown): v is Screen {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !(kind in FIELDS)) return false;
  return FIELDS[kind as Screen['kind']].every((f) => typeof (v as Record<string, unknown>)[f] === 'string');
}

export function isStack(v: unknown): v is Stack {
  return Array.isArray(v) && v.length > 0 && v.every(isScreen) && ROOT_KINDS.has((v[0] as Screen).kind);
}

export function tabOf(stack: Stack): TabId {
  const k = stack[0].kind;
  return k === 'friends' || k === 'profile' ? k : 'servers';
}

export const isRoot = (stack: Stack): boolean => stack.length === 1;

export function push(stack: Stack, s: Screen): Stack {
  const top = stack[stack.length - 1];
  // Запись sheet'а транзитна: переход ИЗ sheet'а занимает её место, иначе
  // «назад» с нового экрана вернул бы пользователя в уже закрытый sheet.
  return top.kind === 'sheet' && stack.length > 1 ? [...stack.slice(0, -1), s] : [...stack, s];
}

export const pop = (stack: Stack): Stack => (stack.length > 1 ? stack.slice(0, -1) : stack);

export const stripSheets = (stack: Stack): Stack => stack.filter((s) => s.kind !== 'sheet');
```

- [ ] **Step 4: Прогнать — зелёный** (7 passed).

---

### Task 5: `reconcile` — стек против сторов

**Files:**
- Create: `client/src/mobile/nav/reconcile.ts`
- Test: `client/src/mobile/nav/__tests__/reconcile.test.ts`

**Interfaces:**
- Consumes: `Stack`, `Screen` (Task 4).
- Produces:
```ts
export interface NavSnapshot {
  serversLoaded: boolean;
  serverIds: ReadonlySet<string>;
  currentServerId: string | null;
  channels: readonly { id: string; server_id: string }[];
  currentChannelId: string | null;
  callActive: boolean;           // callStore.status !== 'idle'
}
export type SyncAction =
  | { type: 'selectServer'; serverId: string }
  | { type: 'selectChannel'; channelId: string }
  | null;
export function reconcile(stack: Stack, snap: NavSnapshot): { stack: Stack; action: SyncAction };
```
Правила (спека §3.2–§3.3): стек режется на первом невалидном экране (сервера нет среди загруженных; канала нет среди **загруженных** каналов текущего сервера — пустой список = ещё грузится, не резать; `call` без активного звонка; канальный экран без серверного экрана ниже). Действие: сначала сервер (глубочайший серверный экран ≠ текущему), затем канал (верхний канальный экран ≠ текущему, при совпавшем сервере и найденном канале). Неизменённый стек возвращается **той же ссылкой**.

- [ ] **Step 1: Тест (падающий)**

`client/src/mobile/nav/__tests__/reconcile.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { reconcile, type NavSnapshot } from '@/mobile/nav/reconcile';
import type { Stack } from '@/mobile/nav/types';

const snap = (over: Partial<NavSnapshot> = {}): NavSnapshot => ({
  serversLoaded: true,
  serverIds: new Set(['s1', 's2']),
  currentServerId: 's1',
  channels: [{ id: 'c1', server_id: 's1' }, { id: 'c2', server_id: 's1' }],
  currentChannelId: 'c1',
  callActive: false,
  ...over,
});
const S = { kind: 'servers' } as const;
const ch = (serverId: string) => ({ kind: 'channels', serverId } as const);
const chat = (channelId: string) => ({ kind: 'chat', channelId } as const);

describe('reconcile', () => {
  it('valid, in-sync stack is returned by reference with no action', () => {
    const stack: Stack = [S, ch('s1'), chat('c1')];
    const r = reconcile(stack, snap());
    expect(r.stack).toBe(stack);
    expect(r.action).toBeNull();
  });

  it('asks to select the server of the deepest server screen', () => {
    expect(reconcile([S, ch('s2')], snap()).action).toEqual({ type: 'selectServer', serverId: 's2' });
  });

  it('does not select anything before servers are loaded', () => {
    const r = reconcile([S, ch('s9')], snap({ serversLoaded: false, serverIds: new Set() }));
    expect(r.stack).toHaveLength(2);
    expect(r.action).toBeNull();
  });

  it('truncates at a server that no longer exists', () => {
    expect(reconcile([S, ch('gone'), chat('c1')], snap()).stack).toEqual([S]);
  });

  it('asks to select the channel of the top chat screen', () => {
    expect(reconcile([S, ch('s1'), chat('c2')], snap()).action).toEqual({ type: 'selectChannel', channelId: 'c2' });
  });

  it('server selection comes before channel selection', () => {
    expect(reconcile([S, ch('s2'), chat('x')], snap()).action).toEqual({ type: 'selectServer', serverId: 's2' });
  });

  it('waits while channels of the current server are still loading', () => {
    const r = reconcile([S, ch('s1'), chat('c7')], snap({ channels: [{ id: 'z', server_id: 's2' }] }));
    expect(r.stack).toHaveLength(3);
    expect(r.action).toBeNull();
  });

  it('truncates at a deleted channel once channels are loaded', () => {
    expect(reconcile([S, ch('s1'), chat('c7')], snap()).stack).toEqual([S, ch('s1')]);
  });

  it('a chat screen with no server screen below is invalid', () => {
    expect(reconcile([S, chat('c1')], snap()).stack).toEqual([S]);
  });

  it('drops the call screen when no call is active, keeps it otherwise', () => {
    const stack: Stack = [S, ch('s1'), chat('c1'), { kind: 'call' }];
    expect(reconcile(stack, snap()).stack).toEqual([S, ch('s1'), chat('c1')]);
    expect(reconcile(stack, snap({ callActive: true })).stack).toBe(stack);
  });

  it('channelInfo is channel-scoped like chat', () => {
    expect(reconcile([S, ch('s1'), chat('c1'), { kind: 'channelInfo', channelId: 'c7' }], snap()).stack)
      .toEqual([S, ch('s1'), chat('c1')]);
  });
});
```

- [ ] **Step 2: Прогнать — падает.**

- [ ] **Step 3: Реализация**

`client/src/mobile/nav/reconcile.ts`:
```ts
import type { Screen, Stack } from './types';

export interface NavSnapshot {
  serversLoaded: boolean;
  serverIds: ReadonlySet<string>;
  currentServerId: string | null;
  channels: readonly { id: string; server_id: string }[];
  currentChannelId: string | null;
  callActive: boolean;
}

export type SyncAction =
  | { type: 'selectServer'; serverId: string }
  | { type: 'selectChannel'; channelId: string }
  | null;

const serverOf = (s: Screen): string | null =>
  s.kind === 'channels' || s.kind === 'serverSettings' || s.kind === 'invites' || s.kind === 'stickers'
    ? s.serverId : null;

const channelOf = (s: Screen): string | null =>
  s.kind === 'chat' || s.kind === 'channelInfo' ? s.channelId : null;

/** Спека §3.3: экран — из стека, данные — из serverStore. Чистая функция:
 *  MobileShell применяет результат (replace стека / вызов контроллера). */
export function reconcile(stack: Stack, snap: NavSnapshot): { stack: Stack; action: SyncAction } {
  let serverCtx: string | null = null;
  let cut = stack.length;

  for (let i = 1; i < stack.length; i++) {
    const s = stack[i];
    const sid = serverOf(s);
    if (sid) {
      if (snap.serversLoaded && !snap.serverIds.has(sid)) { cut = i; break; }
      serverCtx = sid;
      continue;
    }
    const cid = channelOf(s);
    if (cid) {
      if (!serverCtx) { cut = i; break; }
      if (snap.currentServerId === serverCtx) {
        const loaded = snap.channels.filter((c) => c.server_id === serverCtx);
        if (loaded.length > 0 && !loaded.some((c) => c.id === cid)) { cut = i; break; }
      }
      continue;
    }
    if (s.kind === 'call' && !snap.callActive) { cut = i; break; }
  }

  const next = cut === stack.length ? stack : stack.slice(0, cut);

  let deepestServer: string | null = null;
  let topChannel: string | null = null;
  for (const s of next) {
    deepestServer = serverOf(s) ?? deepestServer;
    topChannel = channelOf(s) ?? topChannel;
  }

  let action: SyncAction = null;
  if (deepestServer && snap.serversLoaded && snap.currentServerId !== deepestServer) {
    action = { type: 'selectServer', serverId: deepestServer };
  } else if (
    topChannel && deepestServer === snap.currentServerId && snap.currentChannelId !== topChannel &&
    snap.channels.some((c) => c.id === topChannel && c.server_id === deepestServer)
  ) {
    action = { type: 'selectChannel', channelId: topChannel };
  }
  return { stack: next, action };
}
```

- [ ] **Step 4: Прогнать — зелёный** (11 passed).

---

### Task 6: `useMobileNav` — стек в history

**Files:**
- Create: `client/src/mobile/nav/useMobileNav.ts`
- Test: `client/src/mobile/nav/__tests__/useMobileNav.test.tsx`

**Interfaces:**
- Consumes: `Stack`, `Screen`, `TabId`, `isStack`, `push`, `TAB_ROOT` (Task 4).
- Produces:
```ts
export interface NavState { m: Stack; b: number } // b — сколько наших push'ей под текущей записью
export interface MobileNav {
  stack: Stack; top: Screen; tab: TabId; valid: boolean; // valid=false → state без m
  push(s: Screen): void;
  pushMany(s: readonly Screen[]): void;
  back(): void;               // b>0 → navigate(-1); иначе replace(pop) — никогда не уводит из приложения
  replaceStack(s: Stack): void;
  switchTab(t: TabId): void;  // replace на [корень]
}
export function useMobileNav(fallback?: Screen): MobileNav; // fallback по умолчанию { kind: 'servers' }
export function latestStack(): Stack | null; // синхронно актуальный стек (для микрозадач useBackDismiss)
```

- [ ] **Step 1: Тест (падающий)**

`client/src/mobile/nav/__tests__/useMobileNav.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMobileNav, latestStack } from '@/mobile/nav/useMobileNav';

afterEach(cleanup);

const wrap = (state?: unknown) => ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={[{ pathname: '/app', state }]}>{children}</MemoryRouter>
);

describe('useMobileNav', () => {
  it('without state: fallback root, invalid', () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap() });
    expect(result.current.stack).toEqual([{ kind: 'servers' }]);
    expect(result.current.valid).toBe(false);
  });

  it('push then back walks history', async () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap({ m: [{ kind: 'servers' }], b: 0 }) });
    act(() => result.current.push({ kind: 'channels', serverId: 's1' }));
    expect(result.current.top).toEqual({ kind: 'channels', serverId: 's1' });
    expect(latestStack()).toEqual(result.current.stack);
    await act(async () => { result.current.back(); });
    expect(result.current.stack).toEqual([{ kind: 'servers' }]);
  });

  it('back at b=0 never leaves the app: pops by replace', () => {
    const deep = { m: [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }], b: 0 };
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap(deep) });
    act(() => result.current.back());
    expect(result.current.stack).toEqual([{ kind: 'servers' }]);
  });

  it('pushMany pushes each screen as its own history entry', async () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap({ m: [{ kind: 'servers' }], b: 0 }) });
    act(() => result.current.pushMany([{ kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c1' }]));
    expect(result.current.stack).toHaveLength(3);
    await act(async () => { result.current.back(); });
    expect(result.current.top).toEqual({ kind: 'channels', serverId: 's1' });
  });

  it('switchTab replaces with the tab root', () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap({ m: [{ kind: 'servers' }], b: 0 }) });
    act(() => result.current.switchTab('friends'));
    expect(result.current.stack).toEqual([{ kind: 'friends' }]);
    expect(result.current.tab).toBe('friends');
  });
});
```

- [ ] **Step 2: Прогнать — падает.**

- [ ] **Step 3: Реализация**

`client/src/mobile/nav/useMobileNav.ts`:
```ts
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Screen, Stack, TabId } from './types';
import { TAB_ROOT, isStack, push as pushScreen, pop, tabOf } from './navReducer';

export interface NavState { m: Stack; b: number }

export interface MobileNav {
  stack: Stack;
  top: Screen;
  tab: TabId;
  valid: boolean;
  push(s: Screen): void;
  pushMany(s: readonly Screen[]): void;
  back(): void;
  replaceStack(s: Stack): void;
  switchTab(t: TabId): void;
}

// Синхронно актуальный стек. navigate() меняет location только к следующему
// рендеру, а useBackDismiss решает «моя ли запись наверху» в микрозадаче —
// ему нужен стек сразу после вызова push/replace, а не после рендера.
let latest: Stack | null = null;
export const latestStack = (): Stack | null => latest;

function readState(raw: unknown): { nav: NavState | null } {
  const s = raw as Partial<NavState> | null | undefined;
  return { nav: s && isStack(s.m) ? { m: s.m, b: typeof s.b === 'number' ? s.b : 0 } : null };
}

export function useMobileNav(fallback: Screen = TAB_ROOT.servers): MobileNav {
  const location = useLocation();
  const navigate = useNavigate();
  const { nav } = readState(location.state);
  const stack: Stack = nav?.m ?? [fallback];
  const depth = nav?.b ?? 0;
  latest = stack;

  const go = useCallback(
    (m: Stack, b: number, replace: boolean) => {
      latest = m;
      const base = (location.state && typeof location.state === 'object') ? location.state : {};
      navigate(`${location.pathname}${location.search}`, { state: { ...base, m, b }, replace });
    },
    [location, navigate],
  );

  return useMemo<MobileNav>(() => ({
    stack,
    top: stack[stack.length - 1],
    tab: tabOf(stack),
    valid: nav !== null,
    push: (s) => {
      const cur = latest ?? stack;
      const next = pushScreen(cur, s);
      // push поверх sheet'а заменяет его запись (navReducer.push) → replace в history.
      go(next, next.length > cur.length ? depth + 1 : depth, next.length === cur.length);
    },
    pushMany: (list) => {
      let cur = latest ?? stack;
      let b = depth;
      for (const s of list) {
        const next = pushScreen(cur, s);
        const grew = next.length > cur.length;
        if (grew) b += 1;
        go(next, b, !grew);
        cur = next;
      }
    },
    back: () => {
      const cur = latest ?? stack;
      if (cur.length <= 1) return;
      if (depth > 0) navigate(-1);
      else go(pop(cur), 0, true);
    },
    replaceStack: (m) => go(m, depth, true),
    switchTab: (t) => go([TAB_ROOT[t]], depth, true),
  }), [stack, nav, depth, go, navigate]);
}
```

- [ ] **Step 4: Прогнать — зелёный** (5 passed). Если `navigate(-1)` в `MemoryRouter` отрабатывает только после `await act(async)` — тесты уже так написаны; если синхронно — тоже проходят.

---

### Task 7: Жесты — свайп от края и long-press

**Files:**
- Create: `client/src/mobile/gestures/edgeSwipe.ts`, `useEdgeSwipeBack.ts`, `useLongPress.ts`
- Test: `client/src/mobile/gestures/__tests__/edgeSwipe.test.ts`, `useLongPress.test.tsx`

**Interfaces:**
- Produces:
```ts
// edgeSwipe.ts
export function decideSwipe(a: { dx: number; vx: number; width: number }): 'back' | 'cancel';
export function decideSheetDismiss(a: { dy: number; vy: number; height: number }): boolean;
export interface SwipeTracker {
  start(x: number, y: number, t: number): boolean;           // true — жест взят (старт у края)
  move(x: number, y: number, t: number): number | null;       // dx при активной горизонтали, иначе null
  end(width: number): 'back' | 'cancel' | 'none';
}
export function createSwipeTracker(opts?: { edge?: number; lock?: number }): SwipeTracker; // edge 20, lock 10
// useEdgeSwipeBack.ts
export function useEdgeSwipeBack(
  ref: React.RefObject<HTMLElement | null>,
  o: { enabled: boolean; onBack: () => void; onProgress: (dx: number | null) => void },
): void;
// useLongPress.ts
export interface LongPressHandlers {
  onPointerDown(e: React.PointerEvent): void; onPointerMove(e: React.PointerEvent): void;
  onPointerUp(): void; onPointerCancel(): void; onPointerLeave(): void;
  onContextMenu(e: React.MouseEvent): void; onClickCapture(e: React.MouseEvent): void;
}
export function useLongPress(cb: () => void, o?: { ms?: number; moveTolerance?: number }): LongPressHandlers;
```

- [ ] **Step 1: Тесты (падающие)**

`client/src/mobile/gestures/__tests__/edgeSwipe.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { decideSwipe, decideSheetDismiss, createSwipeTracker } from '@/mobile/gestures/edgeSwipe';

describe('decideSwipe', () => {
  it('distance past 35% of width goes back', () => {
    expect(decideSwipe({ dx: 140, vx: 0, width: 390 })).toBe('back');
    expect(decideSwipe({ dx: 130, vx: 0, width: 390 })).toBe('cancel');
  });
  it('a fast fling goes back even when short, but not a tiny twitch', () => {
    expect(decideSwipe({ dx: 40, vx: 0.8, width: 390 })).toBe('back');
    expect(decideSwipe({ dx: 10, vx: 2, width: 390 })).toBe('cancel');
  });
});

describe('decideSheetDismiss', () => {
  it('30% of height or a fling closes', () => {
    expect(decideSheetDismiss({ dy: 121, vy: 0, height: 400 })).toBe(true);
    expect(decideSheetDismiss({ dy: 100, vy: 0, height: 400 })).toBe(false);
    expect(decideSheetDismiss({ dy: 40, vy: 0.9, height: 400 })).toBe(true);
    expect(decideSheetDismiss({ dy: -50, vy: 2, height: 400 })).toBe(false);
  });
});

describe('createSwipeTracker', () => {
  it('ignores starts away from the left edge', () => {
    expect(createSwipeTracker().start(60, 300, 0)).toBe(false);
  });
  it('locks horizontal after 10px and reports dx', () => {
    const t = createSwipeTracker();
    expect(t.start(5, 300, 0)).toBe(true);
    expect(t.move(10, 302, 16)).toBeNull();          // до порога оси
    expect(t.move(30, 304, 32)).toBe(25);
    expect(t.move(200, 306, 200)).toBe(195);
    expect(t.end(390)).toBe('back');
  });
  it('abandons when the gesture is vertical', () => {
    const t = createSwipeTracker();
    t.start(5, 300, 0);
    expect(t.move(8, 330, 16)).toBeNull();
    expect(t.move(100, 400, 32)).toBeNull();
    expect(t.end(390)).toBe('none');
  });
  it('a slow short drag cancels', () => {
    const t = createSwipeTracker();
    t.start(5, 300, 0);
    t.move(60, 300, 500);
    expect(t.end(390)).toBe('cancel');
  });
});
```

`client/src/mobile/gestures/__tests__/useLongPress.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useLongPress } from '@/mobile/gestures/useLongPress';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const down = (x = 0, y = 0, pointerType = 'touch') => ({ clientX: x, clientY: y, pointerType, button: 0 }) as unknown as React.PointerEvent;
const mouse = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as React.MouseEvent;

describe('useLongPress', () => {
  it('fires after 450ms of holding still', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down()));
    act(() => vi.advanceTimersByTime(449));
    expect(cb).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by moving past the tolerance (scroll)', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(down(0, 9)));
    act(() => vi.advanceTimersByTime(600));
    expect(cb).not.toHaveBeenCalled();
  });

  it('small jitter within tolerance does not cancel', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(down(3, 4)));
    act(() => vi.advanceTimersByTime(450));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by pointerup / pointercancel', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down()));
    act(() => result.current.onPointerUp());
    act(() => result.current.onPointerDown(down()));
    act(() => result.current.onPointerCancel());
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).not.toHaveBeenCalled();
  });

  it('swallows the click that follows a fired long-press, not others', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    const plain = mouse();
    result.current.onClickCapture(plain);
    expect(plain.preventDefault).not.toHaveBeenCalled();
    act(() => result.current.onPointerDown(down()));
    act(() => vi.advanceTimersByTime(450));
    const after = mouse();
    result.current.onClickCapture(after);
    expect(after.preventDefault).toHaveBeenCalled();
    expect(after.stopPropagation).toHaveBeenCalled();
  });

  it('suppresses the native context menu on touch only', () => {
    const { result } = renderHook(() => useLongPress(vi.fn()));
    act(() => result.current.onPointerDown(down(0, 0, 'touch')));
    const e = mouse();
    result.current.onContextMenu(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('ignores mouse pointers (desktop right-click keeps ContextMenu)', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down(0, 0, 'mouse')));
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Прогнать — оба падают.**

Run: `cd client && npx vitest run src/mobile/gestures`

- [ ] **Step 3: Реализация**

`client/src/mobile/gestures/edgeSwipe.ts`:
```ts
const DIST_RATIO = 0.35;     // спека §3.4
const SHEET_RATIO = 0.3;     // спека §4.1
const FLING_V = 0.5;         // px/ms
const FLING_MIN = 24;        // px — ниже это дрожание, а не бросок

export function decideSwipe({ dx, vx, width }: { dx: number; vx: number; width: number }): 'back' | 'cancel' {
  return dx > width * DIST_RATIO || (vx > FLING_V && dx > FLING_MIN) ? 'back' : 'cancel';
}

export function decideSheetDismiss({ dy, vy, height }: { dy: number; vy: number; height: number }): boolean {
  return dy > height * SHEET_RATIO || (vy > FLING_V && dy > FLING_MIN);
}

export interface SwipeTracker {
  start(x: number, y: number, t: number): boolean;
  move(x: number, y: number, t: number): number | null;
  end(width: number): 'back' | 'cancel' | 'none';
}

export function createSwipeTracker({ edge = 20, lock = 10 } = {}): SwipeTracker {
  let x0 = 0, y0 = 0, lastX = 0, lastT = 0, vx = 0;
  let phase: 'idle' | 'pending' | 'active' | 'abandoned' = 'idle';
  return {
    start(x, y, t) {
      if (x > edge) { phase = 'idle'; return false; }
      x0 = x; y0 = y; lastX = x; lastT = t; vx = 0; phase = 'pending';
      return true;
    },
    move(x, y, t) {
      if (phase === 'pending') {
        const ax = Math.abs(x - x0), ay = Math.abs(y - y0);
        if (Math.max(ax, ay) < lock) return null;
        phase = ax > ay && x > x0 ? 'active' : 'abandoned';
      }
      if (phase !== 'active') return null;
      const dt = t - lastT;
      if (dt > 0) vx = (x - lastX) / dt;
      lastX = x; lastT = t;
      return Math.max(0, x - x0);
    },
    end(width) {
      const was = phase;
      phase = 'idle';
      if (was !== 'active') return 'none';
      return decideSwipe({ dx: lastX - x0, vx, width });
    },
  };
}
```

`client/src/mobile/gestures/useEdgeSwipeBack.ts`:
```ts
import { useEffect, useRef, type RefObject } from 'react';
import { createSwipeTracker } from './edgeSwipe';

/** Свайп «назад» от левого края (спека §3.4). Только touch/pen — мышь не
 *  тянет экраны. Прогресс отдаётся наружу: оболочка сама двигает экран. */
export function useEdgeSwipeBack(
  ref: RefObject<HTMLElement | null>,
  o: { enabled: boolean; onBack: () => void; onProgress: (dx: number | null) => void },
): void {
  const optsRef = useRef(o);
  optsRef.current = o;

  useEffect(() => {
    const el = ref.current;
    if (!el || !o.enabled) return;
    const tracker = createSwipeTracker();
    let pointerId: number | null = null;

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || pointerId !== null) return;
      if (tracker.start(e.clientX, e.clientY, e.timeStamp)) pointerId = e.pointerId;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = tracker.move(e.clientX, e.clientY, e.timeStamp);
      if (dx !== null) optsRef.current.onProgress(dx);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      const verdict = tracker.end(el.clientWidth);
      optsRef.current.onProgress(null);
      if (verdict === 'back') optsRef.current.onBack();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [ref, o.enabled]);
}
```

`client/src/mobile/gestures/useLongPress.ts`:
```ts
import { useEffect, useMemo, useRef } from 'react';

export interface LongPressHandlers {
  onPointerDown(e: React.PointerEvent): void;
  onPointerMove(e: React.PointerEvent): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onPointerLeave(): void;
  onContextMenu(e: React.MouseEvent): void;
  onClickCapture(e: React.MouseEvent): void;
}

/** Long-press для тач-ввода (спека §4.4). Мышь игнорируется: на десктопе
 *  правый клик остаётся за ContextMenu. Сработавшее удержание гасит
 *  следующий click, иначе тап-действие строки выполнилось бы вслед за меню. */
export function useLongPress(cb: () => void, { ms = 450, moveTolerance = 8 } = {}): LongPressHandlers {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const touch = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  useEffect(() => clear, []);

  return useMemo<LongPressHandlers>(() => ({
    onPointerDown(e) {
      touch.current = e.pointerType !== 'mouse';
      if (!touch.current || e.button !== 0) return;
      clear();
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        cbRef.current();
      }, ms);
    },
    onPointerMove(e) {
      const o = origin.current;
      if (!o || !timer.current) return;
      if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > moveTolerance) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu(e) {
      if (touch.current) e.preventDefault();
    },
    onClickCapture(e) {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  }), [ms, moveTolerance]);
}
```

- [ ] **Step 4: Прогнать — зелёные** (edgeSwipe 7, useLongPress 7).

---

### Task 8: Sheets — `useBackDismiss`, `BottomSheet`, `ActionSheet`

**Files:**
- Create: `client/src/mobile/sheets/useBackDismiss.ts`, `BottomSheet.tsx`, `BottomSheet.css`, `ActionSheet.tsx`
- Modify: `client/src/i18n/locales/ru.ts`, `en.ts` (ключи `mobile.*`, нужны и Task 9)
- Test: `client/src/mobile/sheets/__tests__/useBackDismiss.test.tsx`, `BottomSheet.test.tsx`

**Interfaces:**
- Consumes: `useMobileNav`, `latestStack` (Task 6); `decideSheetDismiss` (Task 7); `useModalFocus` (`@/hooks/useModalFocus`); `ContextMenuItem` (`@/components/ContextMenu`).
- Produces:
```ts
export function useBackDismiss(open: boolean, onClose: () => void): void;
export function BottomSheet(p: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }): JSX.Element | null;
export function ActionSheet(p: { open: boolean; onClose: () => void; title?: string; items: ContextMenuItem[] }): JSX.Element | null;
```

- [ ] **Step 1: i18n**

В `ru.ts` после блока `guestInvite` (перед `errors`) и так же в `en.ts`:
```ts
  mobile: {
    tabBar: 'Разделы',            // en: 'Sections'
    tabServers: 'Серверы',        // en: 'Servers'
    tabFriends: 'Друзья',         // en: 'Friends'
    tabProfile: 'Профиль',        // en: 'Profile'
    sheetHandle: 'Потяните вниз, чтобы закрыть', // en: 'Drag down to close'
  },
```
(в `en.ts` — английские значения из комментариев, без комментариев.)

- [ ] **Step 2: Тест `useBackDismiss` (падающий)**

`client/src/mobile/sheets/__tests__/useBackDismiss.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StrictMode, useState, type ReactNode } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useMobileNav, type MobileNav } from '@/mobile/nav/useMobileNav';
import { useBackDismiss } from '@/mobile/sheets/useBackDismiss';

afterEach(cleanup);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

let nav!: MobileNav;
let setOpen!: (v: boolean) => void;
const onClose = vi.fn();

function Harness() {
  nav = useMobileNav();
  const [open, _setOpen] = useState(false);
  setOpen = _setOpen;
  useBackDismiss(open, () => { onClose(); _setOpen(false); });
  return null;
}

const mount = (strict = false) => {
  const tree: ReactNode = (
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
      <Harness />
    </MemoryRouter>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

describe('useBackDismiss', () => {
  it('opening pushes one sheet entry, closing pops it', async () => {
    onClose.mockClear();
    mount();
    act(() => setOpen(true));
    await flush();
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers', 'sheet']);
    act(() => setOpen(false));
    await flush();
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers']);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('system back closes the sheet via onClose', async () => {
    onClose.mockClear();
    mount();
    act(() => setOpen(true));
    await flush();
    await act(async () => { nav.back(); });
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers']);
  });

  it('StrictMode double-mount does not double-push', async () => {
    onClose.mockClear();
    mount(true);
    act(() => setOpen(true));
    await flush();
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers', 'sheet']);
  });

  it('navigating forward from an open sheet replaces it; closing does not pop the new screen', async () => {
    onClose.mockClear();
    mount();
    act(() => setOpen(true));
    await flush();
    act(() => { nav.push({ kind: 'createServer' }); });
    act(() => setOpen(false));
    await flush();
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers', 'createServer']);
  });
});
```

- [ ] **Step 3: Прогнать — падает.**

- [ ] **Step 4: Реализация `useBackDismiss`**

`client/src/mobile/sheets/useBackDismiss.ts`:
```ts
import { useEffect, useId, useRef } from 'react';
import { useMobileNav, latestStack } from '@/mobile/nav/useMobileNav';

// id → число живых монтирований. StrictMode монтирует эффект дважды
// (mount → cleanup → mount синхронно): счётчик и отложенная до микрозадачи
// очистка не дают запушить запись дважды и не делают лишний back().
const registry = new Map<string, number>();

const isMine = (id: string) => {
  const top = latestStack()?.at(-1);
  return top?.kind === 'sheet' && top.id === id;
};

/** Спека §4.2: открытый sheet = запись в истории. Системное «назад» её
 *  снимает → onClose(). Закрытие иным путём (скрим, свайп, Escape, выбор
 *  пункта) → back(), чтобы запись не висела. Переход вперёд из sheet'а
 *  заменяет его запись (navReducer.push), и тогда back() не нужен. */
export function useBackDismiss(open: boolean, onClose: () => void): void {
  const id = useId();
  const nav = useMobileNav();
  const navRef = useRef(nav);
  navRef.current = nav;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const seen = useRef(false);

  useEffect(() => {
    if (!open) return;
    const refs = registry.get(id);
    if (refs === undefined) {
      registry.set(id, 1);
      navRef.current.push({ kind: 'sheet', id });
    } else {
      registry.set(id, refs + 1);
    }
    return () => {
      const n = registry.get(id);
      if (n === undefined) return;
      registry.set(id, n - 1);
      queueMicrotask(() => {
        if (registry.get(id) !== 0) return;
        registry.delete(id);
        seen.current = false;
        if (isMine(id)) navRef.current.back();
      });
    };
  }, [open, id]);

  const inStack = nav.stack.some((s) => s.kind === 'sheet' && s.id === id);
  useEffect(() => {
    if (!open) return;
    if (inStack) { seen.current = true; return; }
    if (seen.current) {
      // Запись снята не нами — системный «назад» / свайп браузера.
      seen.current = false;
      registry.delete(id);
      onCloseRef.current();
    }
  }, [open, inStack, id]);
}
```

- [ ] **Step 5: Прогнать `useBackDismiss` — зелёный** (4 passed).

- [ ] **Step 6: Тест `BottomSheet` (падающий)**

`client/src/mobile/sheets/__tests__/BottomSheet.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { isBlockingOverlayOpen } from '@/hooks/useModalFocus';

afterEach(cleanup);
const inRouter = (ui: React.ReactNode) => (
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>{ui}</MemoryRouter>
);

describe('BottomSheet', () => {
  it('renders nothing when closed', () => {
    render(inRouter(<BottomSheet open={false} onClose={() => {}}>x</BottomSheet>));
    expect(document.querySelector('.sheet')).toBeNull();
  });

  it('joins the overlay contract: .modal-overlay scrim, blocking, dialog role', () => {
    render(inRouter(<BottomSheet open onClose={() => {}} title="T">body</BottomSheet>));
    expect(document.querySelector('.modal-overlay.sheet-overlay > .sheet')).not.toBeNull();
    expect(document.querySelector('.sheet')?.getAttribute('role')).toBe('dialog');
    expect(isBlockingOverlayOpen()).toBe(true);
  });

  it('Escape and scrim click close it; a click inside does not', () => {
    const onClose = vi.fn();
    render(inRouter(<BottomSheet open onClose={onClose}><button type="button">in</button></BottomSheet>));
    fireEvent.click(document.querySelector('.sheet button')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.sheet-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('only the top sheet reacts to Escape', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { rerender } = render(inRouter(<BottomSheet open onClose={outer}>a</BottomSheet>));
    await act(async () => {});
    rerender(inRouter(<><BottomSheet open onClose={outer}>a</BottomSheet><BottomSheet open onClose={inner}>b</BottomSheet></>));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('ActionSheet', () => {
  it('runs the item and closes; danger items come last; disabled shows its reason', () => {
    const onClose = vi.fn();
    const del = vi.fn();
    const edit = vi.fn();
    render(inRouter(
      <ActionSheet open onClose={onClose} items={[
        { label: 'Delete', onClick: del, danger: true },
        { label: 'Edit', onClick: edit },
        { label: 'Nope', onClick: vi.fn(), disabled: true, disabledReason: 'Why not' },
      ]} />,
    ));
    const labels = [...document.querySelectorAll('.action-sheet-item')].map((b) => b.querySelector('.action-sheet-label')?.textContent);
    expect(labels).toEqual(['Edit', 'Nope', 'Delete']);
    expect(document.body.textContent).toContain('Why not');
    fireEvent.click(document.querySelectorAll('.action-sheet-item')[0]);
    expect(edit).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Прогнать — падает.**

- [ ] **Step 8: Реализация `BottomSheet`**

`client/src/mobile/sheets/BottomSheet.tsx`:
```tsx
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '@/hooks/useModalFocus';
import { useT } from '@/i18n';
import { useBackDismiss } from './useBackDismiss';
import { decideSheetDismiss } from '@/mobile/gestures/edgeSwipe';
import './BottomSheet.css';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Спека §4.1. Scrim — `.modal-overlay` (+ useModalFocus): стек слоёв, Escape
 *  только верхнего, ловушка Tab, isBlockingOverlayOpen(). Вторая система
 *  оверлеев запрещена design-system.md — поэтому здесь нет ни своего z-index,
 *  ни своего Escape. */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y0: number; y: number; t: number; vy: number } | null>(null);
  useModalFocus(open, ref, onClose);
  useBackDismiss(open, onClose);
  if (!open) return null;

  const onDown = (e: React.PointerEvent) => {
    const body = ref.current?.querySelector('.sheet-body');
    const fromBody = body?.contains(e.target as Node);
    if (fromBody && (body as HTMLElement).scrollTop > 0) return;
    drag.current = { y0: e.clientY, y: e.clientY, t: e.timeStamp, vy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = e.timeStamp - d.t;
    if (dt > 0) d.vy = (e.clientY - d.y) / dt;
    d.y = e.clientY;
    d.t = e.timeStamp;
    setDy(Math.max(0, e.clientY - d.y0));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const height = ref.current?.offsetHeight ?? 1;
    const close = decideSheetDismiss({ dy: d.y - d.y0, vy: d.vy, height });
    setDy(0);
    if (close) onClose();
  };

  return createPortal(
    <div className="modal-overlay sheet-overlay" onClick={onClose}>
      <div
        ref={ref}
        className={`sheet${dy > 0 ? ' is-dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={dy > 0 ? { transform: `translateY(${dy}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="sheet-grip" aria-hidden="true" title={t('mobile.sheetHandle')}>
          <span className="sheet-grip-bar" />
        </div>
        {title && <h2 className="sheet-title">{title}</h2>}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
```

`client/src/mobile/sheets/BottomSheet.css`:
```css
/* Спека §4.1. Scrim — примитив `.modal-overlay` (primitives.css): фон, blur,
   z-index и fade-in оттуда. Здесь только отличия sheet'а, на (0,2,0), чтобы
   не зависеть от порядка подключения файлов. */
.modal-overlay.sheet-overlay {
  align-items: flex-end;
}

.sheet {
  width: min(100%, 560px);
  max-height: 90dvh;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-radius: var(--radius-modal) var(--radius-modal) 0 0;
  box-shadow: var(--shadow-modal);
  padding-bottom: env(safe-area-inset-bottom);
  animation: sheet-slide-up 0.22s var(--ease-out);
  transition: transform var(--transition) var(--ease-out);
  touch-action: pan-y;
}

.sheet.is-dragging {
  transition: none;
}

.sheet-grip {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  touch-action: none;
  cursor: grab;
}

.sheet-grip-bar {
  width: 36px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--line-strong);
}

.sheet-title {
  padding: 4px 20px 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
}

.sheet-body {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 8px 8px;
}

@keyframes sheet-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .sheet {
    animation: fade-in 0.18s var(--ease-out);
  }
}
```

- [ ] **Step 9: Реализация `ActionSheet`**

`client/src/mobile/sheets/ActionSheet.tsx`:
```tsx
import type { ContextMenuItem } from '@/components/ContextMenu';
import { BottomSheet } from './BottomSheet';

interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  items: ContextMenuItem[];
}

/** Тач-замена ContextMenu (спека §4.3): тот же ContextMenuItem[], опасные
 *  пункты — отдельной группой в конце (board 1d), как у ContextMenu. */
export function ActionSheet({ open, onClose, title, items }: ActionSheetProps) {
  const plain = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const row = (item: ContextMenuItem) => (
    <button
      key={item.label}
      type="button"
      className={`action-sheet-item${item.danger ? ' is-danger' : ''}`}
      disabled={item.disabled}
      onClick={() => { onClose(); item.onClick(); }}
    >
      {item.icon && <span className="action-sheet-icon">{item.icon}</span>}
      <span className="action-sheet-text">
        <span className="action-sheet-label">{item.label}</span>
        {item.disabled && item.disabledReason && (
          <span className="action-sheet-reason">{item.disabledReason}</span>
        )}
      </span>
    </button>
  );
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="action-sheet-group">{plain.map(row)}</div>
      {danger.length > 0 && <div className="action-sheet-group">{danger.map(row)}</div>}
    </BottomSheet>
  );
}
```

Порядок `onClose(); item.onClick()`: если пункт навигирует, его `push` уйдёт после того, как sheet размонтируется; микрозадача `useBackDismiss` к тому моменту увидит, что наверху уже не её запись, — но `push` вызывается синхронно ДО микрозадачи, а `latestStack()` обновляется синхронно в `go()`, поэтому `isMine` вернёт false и лишнего `back()` не будет (покрыто тестом Task 8 Step 2, случай 4).

Добавить в `BottomSheet.css`:
```css
.action-sheet-group + .action-sheet-group {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.action-sheet-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 52px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius-row);
  color: var(--ink);
  font-size: 16px;
  text-align: left;
  cursor: pointer;
}

.action-sheet-item:active:not(:disabled) {
  background: var(--canvas-2);
}

.action-sheet-item:disabled {
  color: var(--muted-2);
  cursor: default;
}

.action-sheet-item.is-danger {
  color: var(--danger-text);
}

.action-sheet-icon {
  display: flex;
  color: var(--muted);
}

.action-sheet-item.is-danger .action-sheet-icon {
  color: var(--danger-text);
}

.action-sheet-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.action-sheet-reason {
  font-size: 13px;
  color: var(--muted-2);
}
```

- [ ] **Step 10: Прогнать sheets — зелёные; стилелинт — 0 байт**

Run: `cd client && npx vitest run src/mobile/sheets && npx stylelint "src/mobile/**/*.css"`
Expected: 9 passed; stylelint без вывода. `overlay-scrim-contract.test.ts` тоже зелёный (`npx vitest run src/styles`) — `.sheet-overlay` носит `.modal-overlay`.

---

### Task 9: Хром — `ScreenHeader`, `TabBar`

**Files:**
- Create: `client/src/mobile/components/ScreenHeader.tsx`, `ScreenHeader.css`, `TabBar.tsx`, `TabBar.css`
- Test: `client/src/mobile/components/__tests__/TabBar.test.tsx`

**Interfaces:**
- Consumes: `TabId` (Task 4), ключи `mobile.*` (Task 8).
- Produces:
```ts
export function ScreenHeader(p: { title: ReactNode; subtitle?: ReactNode; onBack?: () => void; actions?: ReactNode; onTitleClick?: () => void }): JSX.Element;
export function TabBar(p: { active: TabId; onSelect: (t: TabId) => void; friendsBadge: number }): JSX.Element;
```

- [ ] **Step 1: Тест `TabBar` (падающий)**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { TabBar } from '@/mobile/components/TabBar';

afterEach(cleanup);

describe('TabBar', () => {
  it('three tabs, active one marked, click selects', () => {
    const onSelect = vi.fn();
    render(<TabBar active="friends" onSelect={onSelect} friendsBadge={0} />);
    const items = document.querySelectorAll('.tab-bar-item');
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute('aria-current')).toBe('page');
    expect(items[1].classList.contains('is-active')).toBe(true);
    fireEvent.click(items[2]);
    expect(onSelect).toHaveBeenCalledWith('profile');
  });

  it('friends badge caps at 99+ and hides at 0', () => {
    const { rerender } = render(<TabBar active="servers" onSelect={() => {}} friendsBadge={0} />);
    expect(document.querySelector('.tab-bar-badge')).toBeNull();
    rerender(<TabBar active="servers" onSelect={() => {}} friendsBadge={150} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Прогнать — падает.**

- [ ] **Step 3: Реализация**

`TabBar.tsx`:
```tsx
import { CircleUser, LayoutGrid, Users } from 'lucide-react';
import type { TabId } from '@/mobile/nav/types';
import { useT } from '@/i18n';
import './TabBar.css';

const TABS = [
  { id: 'servers', Icon: LayoutGrid, label: 'mobile.tabServers' },
  { id: 'friends', Icon: Users, label: 'mobile.tabFriends' },
  { id: 'profile', Icon: CircleUser, label: 'mobile.tabProfile' },
] as const;

interface TabBarProps {
  active: TabId;
  onSelect: (t: TabId) => void;
  friendsBadge: number;
}

export function TabBar({ active, onSelect, friendsBadge }: TabBarProps) {
  const t = useT();
  return (
    <nav className="tab-bar" aria-label={t('mobile.tabBar')}>
      {TABS.map(({ id, Icon, label }) => (
        <button
          key={id}
          type="button"
          className={`tab-bar-item${active === id ? ' is-active' : ''}`}
          aria-current={active === id ? 'page' : undefined}
          onClick={() => onSelect(id)}
        >
          <span className="tab-bar-icon">
            <Icon size={22} strokeWidth={1.8} />
            {id === 'friends' && friendsBadge > 0 && (
              <span className="tab-bar-badge" aria-label={t('friends.pendingBadge')}>
                {friendsBadge > 99 ? '99+' : friendsBadge}
              </span>
            )}
          </span>
          <span className="tab-bar-label">{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}
```

`TabBar.css`:
```css
.tab-bar {
  display: flex;
  flex-shrink: 0;
  background: var(--panel);
  border-top: 1px solid var(--line);
  padding-bottom: env(safe-area-inset-bottom);
}

.tab-bar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 56px;
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tab-bar-item.is-active {
  color: var(--accent-text);
}

.tab-bar-icon {
  position: relative;
  display: flex;
}

.tab-bar-badge {
  position: absolute;
  top: -4px;
  left: 14px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--danger);
  color: var(--white);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
```

`ScreenHeader.tsx`:
```tsx
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useT } from '@/i18n';
import './ScreenHeader.css';

interface ScreenHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  onTitleClick?: () => void;
}

export function ScreenHeader({ title, subtitle, onBack, actions, onTitleClick }: ScreenHeaderProps) {
  const t = useT();
  const titleBody = (
    <>
      <h1 className="screen-header-name">{title}</h1>
      {subtitle && <div className="screen-header-sub">{subtitle}</div>}
    </>
  );
  return (
    <header className="screen-header">
      {onBack && (
        <button type="button" className="screen-header-btn" onClick={onBack} aria-label={t('common.back')}>
          <ChevronLeft size={24} strokeWidth={1.8} />
        </button>
      )}
      {onTitleClick
        ? <button type="button" className="screen-header-title is-tappable" onClick={onTitleClick}>{titleBody}</button>
        : <div className="screen-header-title">{titleBody}</div>}
      {actions && <div className="screen-header-actions">{actions}</div>}
    </header>
  );
}
```

`ScreenHeader.css`:
```css
.screen-header {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  min-height: 56px;
  padding: env(safe-area-inset-top) 8px 0;
  background: var(--canvas);
  border-bottom: 1px solid var(--line);
}

.screen-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-pill);
  color: var(--ink);
  cursor: pointer;
}

.screen-header-title {
  flex: 1;
  min-width: 0;
  padding: 0 8px;
  background: transparent;
  border: none;
  color: inherit;
  text-align: left;
}

.screen-header-title.is-tappable {
  cursor: pointer;
}

.screen-header-name {
  overflow: hidden;
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.screen-header-sub {
  overflow: hidden;
  font-size: 13px;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.screen-header-actions {
  display: flex;
  gap: 2px;
}
```
(Хэрлайн «только при прокрутке» из спеки §3.5 появляется на этапе 2 вместе с первым собственным списком; в этапе 1 шапку носит только экран «Профиль» без прокрутки — рамка постоянная.)

- [ ] **Step 4: Прогнать — зелёный; stylelint 0 байт.**

---

### Task 10: `MobileShell` и развилка `AppPage`

**Files:**
- Create: `client/src/mobile/MobileShell.tsx`, `MobileShell.css`, `client/src/mobile/screens/renderScreen.tsx`
- Modify: `client/src/pages/AppPage.tsx`, `client/src/pages/app/DesktopShell.tsx`, `client/src/pages/app/useAppController.ts` (удалить `onMobilePanel`/`MobilePanel`)
- Test: `client/src/mobile/__tests__/MobileShell.nav.test.tsx`

**Interfaces:**
- Consumes: всё из Tasks 2–9; `AppController` (Task 3).
- Produces: `MobileShell({ c }: { c: AppController })`; `renderScreen(screen, ctx): ReactNode`.

- [ ] **Step 1: Убрать временную модель из десктопа**

`useAppController.ts`: удалить `MobilePanel`, `onMobilePanel` из опций и все вызовы `opts.onMobilePanel?.(…)`.

`DesktopShell.tsx`: удалить пропсы `mobilePanel`/`setMobilePanel`, атрибут `data-mobile-panel`, эффект отката (бывш. 127–131), все `onMobileBack*`/`onShowCall` пропсы (передавать не надо — на ≥ 900 их кнопки `display: none`, см. `ChatArea.css` `.chat-call-btn` и `AppPage.css`); в `handleToggleMembers` оставить только `setMembersOpen((v) => !v)`; `onPaletteShowChat={() => {}}`. `.app-account-dock` и `CallUI` — как были.

`AppPage.tsx`:
```tsx
import { usePaletteHotkey } from '@/hooks/usePaletteHotkey';
import { useIsMobile } from '@/mobile/breakpoint';
import { MobileShell } from '@/mobile/MobileShell';
import { useAppController } from './app/useAppController';
import { DesktopShell } from './app/DesktopShell';

/** Контроллер живёт выше развилки: смена оболочки на ресайзе не должна
 *  переподписывать WS и перезагружать серверы (спека §1). */
export function AppPage() {
  usePaletteHotkey();
  const isMobile = useIsMobile();
  const c = useAppController({ autoOpenChannel: !isMobile });
  return isMobile ? <MobileShell c={c} /> : <DesktopShell c={c} />;
}
```

- [ ] **Step 2: Тест навигации оболочки (падающий)**

`client/src/mobile/__tests__/MobileShell.nav.test.tsx` — проверяет связку стек × контроллер на заглушке контроллера, без рендера реальных панелей (их замещает `vi.mock('@/mobile/screens/renderScreen')`):
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppController } from '@/pages/app/useAppController';
import type { Server, Channel } from '@/types';

vi.mock('@/mobile/screens/renderScreen', () => ({
  renderScreen: (s: { kind: string }) => <div data-screen={s.kind} />,
}));
vi.mock('@/pages/app/AppOverlays', () => ({ AppOverlays: () => null }));
vi.mock('@/components/CallUI', () => ({ CallUI: () => null }));
vi.mock('@/components/CallDock', () => ({ CallDock: () => null }));

import { MobileShell } from '@/mobile/MobileShell';
import { useServerStore } from '@/stores/serverStore';

afterEach(cleanup);

const server = { id: 's1', name: 'S' } as Server;
const channel = { id: 'c1', name: 'general', server_id: 's1' } as Channel;

function fakeController(over: Partial<AppController> = {}): AppController {
  return {
    user: null, servers: [server], currentServer: null, channels: [], currentChannel: null, members: [],
    pendingCount: 2, voiceParticipants: new Map(), callNotif: null,
    selectServer: vi.fn(async () => {}), selectChannel: vi.fn(async () => {}), selectHome: vi.fn(),
    joinVoice: vi.fn(), goToCall: vi.fn(), serverRemoved: vi.fn(), channelRemoved: vi.fn(),
    joinServer: vi.fn(async () => {}), serverJoined: vi.fn(), createServer: vi.fn(async () => {}),
    joinCallNotif: vi.fn(), dismissCallNotif: vi.fn(), logout: vi.fn(),
    subscribe: () => () => {},
    ui: {
      findServerOpen: false, setFindServerOpen: vi.fn(), settingsOpen: false, setSettingsOpen: vi.fn(),
      createChannelOpen: false, setCreateChannelOpen: vi.fn(), createServerOpen: false, setCreateServerOpen: vi.fn(),
    },
    ...over,
  };
}

const mount = (c: AppController, state?: unknown) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state }]}><MobileShell c={c} /></MemoryRouter>,
);
const top = () => [...document.querySelectorAll('[data-screen]')].at(-1)?.getAttribute('data-screen');

beforeEach(() => {
  useServerStore.setState({ servers: [server], serversLoaded: true, currentServer: null, channels: [], currentChannel: null });
});

describe('MobileShell navigation', () => {
  it('cold start lands on the servers root with the tab bar', async () => {
    mount(fakeController());
    await act(async () => {});
    expect(top()).toBe('servers');
    expect(document.querySelector('.tab-bar')).not.toBeNull();
  });

  it('a restored deep stack asks the controller to select its server (no chat auto-open)', async () => {
    const c = fakeController();
    mount(c, { m: [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }], b: 1 });
    await act(async () => {});
    expect(c.selectServer).toHaveBeenCalledWith(server);
    expect(top()).toBe('channels');
    expect(document.querySelector('.tab-bar')).toBeNull();
  });

  it('selects the channel of the chat screen once its server is current', async () => {
    useServerStore.setState({ currentServer: server, channels: [channel] });
    const c = fakeController({ currentServer: server, channels: [channel] });
    mount(c, { m: [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c1' }], b: 2 });
    await act(async () => {});
    expect(c.selectChannel).toHaveBeenCalledWith(channel);
  });

  it('tab bar switches tabs and shows the friends badge', async () => {
    mount(fakeController());
    await act(async () => {});
    expect(document.querySelector('.tab-bar-badge')?.textContent).toBe('2');
    fireEvent.click(document.querySelectorAll('.tab-bar-item')[1]);
    await act(async () => {});
    expect(top()).toBe('friends');
  });

  it('strips a sheet entry that survived a reload', async () => {
    mount(fakeController(), { m: [{ kind: 'servers' }, { kind: 'sheet', id: 'x' }], b: 1 });
    await act(async () => {});
    expect(top()).toBe('servers');
  });
});
```

- [ ] **Step 3: Прогнать — падает.**

- [ ] **Step 4: `renderScreen.tsx` — этап-1-отображение экранов на существующие панели**

```tsx
import type { ReactNode } from 'react';
import type { Channel } from '@/types';
import type { Screen } from '@/mobile/nav/types';
import type { MobileNav } from '@/mobile/nav/useMobileNav';
import type { AppController } from '@/pages/app/useAppController';
import { ServerList } from '@/components/ServerList';
import { ChannelSidebar } from '@/components/ChannelSidebar';
import { ChatArea } from '@/components/ChatArea';
import { CallStage } from '@/components/CallStage';
import { UserList } from '@/components/UserList';
import { HomeView } from '@/components/HomeView';
import { UserPanel } from '@/components/UserPanel';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { useCallStore } from '@/stores/callStore';
import { useT } from '@/i18n';

export interface ScreenCtx {
  c: AppController;
  nav: MobileNav;
  joinVoice: (channel: Channel) => void; // вход + экран звонка
}

function ProfileRoot({ c }: { c: AppController }) {
  const t = useT();
  return (
    <div className="mobile-profile">
      <ScreenHeader title={t('mobile.tabProfile')} />
      {/* Этап 1: панель пользователя (настройки, выход, NC). Полноценная
          вкладка — этап 5 (спека §5.8). */}
      <UserPanel user={c.user} onLogout={c.logout} onOpenSettings={() => c.ui.setSettingsOpen(true)} />
    </div>
  );
}

function ChannelsScreen({ serverId, ctx }: { serverId: string; ctx: ScreenCtx }) {
  const { c, nav, joinVoice } = ctx;
  if (c.currentServer?.id !== serverId) return <div className="mobile-screen-loading" />;
  return (
    <ChannelSidebar
      server={c.currentServer}
      channels={c.channels}
      currentChannel={c.currentChannel}
      onSelectChannel={(ch) => nav.push({ kind: 'chat', channelId: ch.id })}
      onJoinVoice={joinVoice}
      user={c.user}
      onMobileBack={nav.back}
      voiceParticipants={c.voiceParticipants}
      members={c.members}
      onChannelDeleted={c.channelRemoved}
      onServerDeleted={c.serverRemoved}
      onCreateChannel={() => c.ui.setCreateChannelOpen(true)}
    />
  );
}

function ChatScreen({ channelId, ctx }: { channelId: string; ctx: ScreenCtx }) {
  const { c, nav, joinVoice } = ctx;
  const callChannelId = useCallStore((s) => s.callChannelId);
  const channel = c.currentChannel?.id === channelId ? c.currentChannel : null;
  if (!channel) return <div className="mobile-screen-loading" />;
  return (
    <ChatArea
      channel={channel}
      user={c.user}
      onMobileBack={nav.back}
      onShowMembers={() => nav.push({ kind: 'channelInfo', channelId })}
      onJoinVoice={joinVoice}
      onShowCall={callChannelId === channelId ? () => nav.push({ kind: 'call' }) : undefined}
      onCreateServer={() => c.ui.setCreateServerOpen(true)}
      onFindServer={() => c.ui.setFindServerOpen(true)}
      voiceParticipants={c.voiceParticipants}
    />
  );
}

function CallScreen({ ctx }: { ctx: ScreenCtx }) {
  const callChannelId = useCallStore((s) => s.callChannelId);
  if (!callChannelId || callChannelId !== ctx.c.currentChannel?.id) return <div className="mobile-screen-loading" />;
  return <CallStage onMobileBackToChat={ctx.nav.back} />;
}

/** Этап 1: экраны стека монтируют существующие панели (спека §9 п.1).
 *  Экраны следующих этапов пока не достижимы — рендерят пустой каркас. */
export function renderScreen(screen: Screen, ctx: ScreenCtx): ReactNode {
  const { c, nav } = ctx;
  switch (screen.kind) {
    case 'servers':
      return (
        <ServerList
          servers={c.servers}
          currentServer={null}
          user={c.user}
          onSelectServer={(s) => nav.push({ kind: 'channels', serverId: s.id })}
          onCreateServer={() => c.ui.setCreateServerOpen(true)}
          onOpenFindServer={() => c.ui.setFindServerOpen(true)}
          onServerDeleted={c.serverRemoved}
          onSelectHome={() => nav.switchTab('friends')}
          pendingCount={c.pendingCount}
        />
      );
    case 'friends':
      return <HomeView />;
    case 'profile':
      return <ProfileRoot c={c} />;
    case 'channels':
      return <ChannelsScreen serverId={screen.serverId} ctx={ctx} />;
    case 'chat':
      return <ChatScreen channelId={screen.channelId} ctx={ctx} />;
    case 'channelInfo':
      return <UserList onMobileBack={nav.back} voiceParticipants={c.voiceParticipants} />;
    case 'call':
      return <CallScreen ctx={ctx} />;
    default:
      return <div className="mobile-screen-loading" />;
  }
}
```
Примечание: `ServerList` получает `currentServer={null}` — на корне вкладки ни один сервер не «активен» (как список чатов в Telegram).

- [ ] **Step 5: `MobileShell.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { CallUI } from '@/components/CallUI';
import { CallDock } from '@/components/CallDock';
import type { Channel } from '@/types';
import type { AppController } from '@/pages/app/useAppController';
import { AppOverlays } from '@/pages/app/AppOverlays';
import { useMobileNav } from './nav/useMobileNav';
import { isRoot, stripSheets } from './nav/navReducer';
import { reconcile } from './nav/reconcile';
import type { Screen } from './nav/types';
import { useEdgeSwipeBack } from './gestures/useEdgeSwipeBack';
import { TabBar } from './components/TabBar';
import { renderScreen, type ScreenCtx } from './screens/renderScreen';
import './MobileShell.css';

const keyOf = (s: Screen, i: number) => `${i}:${JSON.stringify(s)}`;

export function MobileShell({ c }: { c: AppController }) {
  const nav = useMobileNav();
  const callStatus = useCallStore((s) => s.status);
  const serversLoaded = useServerStore((s) => s.serversLoaded);
  const stageRef = useRef<HTMLDivElement>(null);
  const [swipeDx, setSwipeDx] = useState<number | null>(null);

  // Нормализация записи: нет стека → корень; sheet'ы после reload не живы.
  useEffect(() => {
    if (!nav.valid) { nav.replaceStack([{ kind: 'servers' }]); return; }
    const clean = stripSheets(nav.stack);
    if (clean.length !== nav.stack.length) nav.replaceStack(clean);
  }, []); // только при монтировании (ESLint в репо нет — disable-комментарий не нужен)

  // Стек × сторы (спека §3.3). Sheet-записи reconcile не трогает — ими
  // владеет useBackDismiss.
  useEffect(() => {
    const r = reconcile(nav.stack, {
      serversLoaded,
      serverIds: new Set(c.servers.map((s) => s.id)),
      currentServerId: c.currentServer?.id ?? null,
      channels: c.channels,
      currentChannelId: c.currentChannel?.id ?? null,
      callActive: callStatus !== 'idle',
    });
    if (r.stack !== nav.stack) { nav.replaceStack(r.stack); return; }
    if (r.action?.type === 'selectServer') {
      const s = c.servers.find((x) => x.id === r.action!.serverId);
      if (s) void c.selectServer(s);
    } else if (r.action?.type === 'selectChannel') {
      const ch = c.channels.find((x) => x.id === r.action!.channelId);
      if (ch) void c.selectChannel(ch);
    }
  }, [nav, serversLoaded, c, callStatus]);

  // События контроллера, требующие навигации.
  useEffect(() => c.subscribe((e) => {
    if (e.type === 'serverOpened') {
      nav.switchTab('servers');
      nav.push({ kind: 'channels', serverId: e.serverId });
    } else if (e.type === 'callJoined' && e.serverId) {
      nav.switchTab('servers');
      nav.pushMany([
        { kind: 'channels', serverId: e.serverId },
        { kind: 'chat', channelId: e.channelId },
        { kind: 'call' },
      ]);
    }
  }), [c, nav]);

  const joinVoice = (channel: Channel) => {
    c.joinVoice(channel);
    const onChat = nav.top.kind === 'chat' && nav.top.channelId === channel.id;
    nav.pushMany(onChat ? [{ kind: 'call' }] : [{ kind: 'chat', channelId: channel.id }, { kind: 'call' }]);
  };
  const openChannelDeep = (serverId: string, channelId: string, withCall: boolean) => {
    nav.switchTab('servers');
    nav.pushMany([
      { kind: 'channels', serverId },
      { kind: 'chat', channelId },
      ...(withCall ? [{ kind: 'call' } as Screen] : []),
    ]);
  };

  const root = isRoot(nav.stack);
  useEdgeSwipeBack(stageRef, {
    enabled: !root && nav.top.kind !== 'call',
    onBack: nav.back,
    onProgress: setSwipeDx,
  });

  const ctx: ScreenCtx = { c, nav, joinVoice };
  // Смонтированы верхний и предыдущий экраны (предыдущий — под свайпом).
  const visible = nav.stack.map((s, i) => ({ s, i })).slice(-2).filter(({ s }) => s.kind !== 'sheet');

  return (
    <div className="mobile-shell">
      <div className="mobile-stage" ref={stageRef}>
        {visible.map(({ s, i }, idx) => {
          const isTop = idx === visible.length - 1;
          return (
            <section
              key={keyOf(s, i)}
              className={`mobile-screen${isTop ? ' is-top' : ' is-under'}`}
              aria-hidden={!isTop}
              style={isTop && swipeDx !== null ? { transform: `translateX(${swipeDx}px)` } : undefined}
            >
              {renderScreen(s, ctx)}
            </section>
          );
        })}
      </div>
      {root && (
        <div className="mobile-call-dock">
          <CallDock onGoToCall={(serverId, channelId) => serverId && openChannelDeep(serverId, channelId, true)} />
        </div>
      )}
      {root && <TabBar active={nav.tab} onSelect={nav.switchTab} friendsBadge={c.pendingCount} />}
      <AppOverlays
        c={c}
        onPaletteSelectChannel={(ch) => openChannelDeep(ch.server_id, ch.id, false)}
        onPaletteJoinVoice={(ch) => { c.joinVoice(ch); openChannelDeep(ch.server_id, ch.id, true); }}
        onPaletteShowChat={() => {}}
      />
      <CallUI />
    </div>
  );
}
```

- [ ] **Step 6: `MobileShell.css`**

```css
/* VYC-95 §3.5. Оболочка рендерится только при (width < 900px) — JS-развилка
   AppPage; поэтому здесь нет @media. */
.mobile-shell {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  background: var(--canvas);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

.mobile-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  touch-action: pan-y;
}

.mobile-screen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
}

.mobile-screen.is-top {
  animation: mobile-screen-in 0.22s var(--ease-out);
}

.mobile-screen.is-under {
  visibility: hidden;
}

/* Под пальцем предыдущий экран должен быть виден. */
.mobile-stage:has(.mobile-screen.is-top[style]) .mobile-screen.is-under {
  visibility: visible;
}

/* Панели этапа 1 (спека §9 п.1) — это десктопные компоненты с фиксированными
   ширинами колонок (rail 76, sidebar 252, members 236). На экране стека они
   занимают всё. (0,2,0) — выигрываем у их (0,1,0) базы специфичностью, а не
   порядком файлов. */
.mobile-screen > .server-list,
.mobile-screen > .channel-sidebar,
.mobile-screen > .chat-area,
.mobile-screen > .call-stage,
.mobile-screen > .user-list,
.mobile-screen > .home-view {
  flex: 1;
  width: 100%;
  min-width: 0;
  max-width: none;
  min-height: 0;
}

/* Навигационные аффордансы панелей, перенесённые из AppPage.css (M6 T8):
   их база — display: none, а компонентные блоки включают их только ≤ 768px.
   Оболочка владеет навигацией — оболочка их и включает, на всей ширине < 900. */
.mobile-shell .mobile-back-btn,
.mobile-shell .chat-back-btn,
.mobile-shell .chat-call-btn,
.mobile-shell .chat-members-btn,
.mobile-shell .stage-back-btn,
.mobile-shell .user-list-mobile-header,
.mobile-shell .home-view-mobile-header {
  display: flex;
}

.mobile-profile {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.mobile-screen-loading {
  flex: 1;
  background: var(--canvas);
}

.mobile-call-dock {
  flex-shrink: 0;
  margin: 0 12px 8px;
  border-radius: var(--radius-card);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

@keyframes mobile-screen-in {
  from { transform: translateX(24%); opacity: 0.6; }
  to { transform: translateX(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .mobile-screen.is-top {
    animation: fade-in 0.18s var(--ease-out);
  }
}
```
Анимация входа проигрывается при монтировании верхнего экрана; при `back()` верхним становится уже смонтированный «is-under» экран — он просто показывается (анимация pop — этап 2, вместе со своими списками; в этапе 1 не требуется спекой §9 п.1).

- [ ] **Step 7: Прогнать тест оболочки — зелёный** (5 passed). Затем все гейты (Task 3 Step 8).

- [ ] **Step 8: Проверка на реальном приложении**

Свежий `npm run dev:vite`. Проба `/www/my/vycord/.superpowers/vyc95/probes/probe-shell.js` (по `probe-template.js`; **сначала увидеть падение**: временно вернуть в `AppPage` `DesktopShell` безусловно — проба обязана упасть на `.mobile-shell missing`):
```js
(async () => {
  const fail = (m) => { throw new Error(`PROBE FAIL: ${m}`); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shell = document.querySelector('.mobile-shell');
  if (!shell) fail('.mobile-shell missing');
  if (!document.querySelector('.tab-bar')) fail('tab bar missing on root');
  const top = () => [...document.querySelectorAll('.mobile-screen.is-top')].at(-1);
  const server = top()?.querySelector('.server-icon:not(.server-icon-home):not(.server-icon-add)');
  if (!server) fail('no server row on root');
  server.click();
  await sleep(1500);
  if (!top()?.querySelector('.channel-sidebar')) fail('server tap did not open channels');
  if (document.querySelector('.tab-bar')) fail('tab bar visible off-root');
  const ch = top().querySelector('.channel-item, [data-channel-id]');
  if (!ch) fail('no channel row (selector: .channel-item / [data-channel-id])');
  ch.click();
  await sleep(1500);
  if (!top()?.querySelector('.chat-area')) fail('channel tap did not open chat');
  const depth = history.state?.usr?.m?.length;
  if (depth !== 3) fail(`history stack depth ${depth} !== 3`);
  history.back();
  await sleep(800);
  if (!top()?.querySelector('.channel-sidebar')) fail('history.back did not return to channels');
  history.back();
  await sleep(800);
  if (!document.querySelector('.tab-bar')) fail('back to root did not restore tab bar');
  return { ok: true };
})()
```
(Селектор строки канала уточнить по `ChannelSidebar.tsx` перед запуском; `history.state.usr` — место, куда react-router 7 кладёт `state`, проверить однократно в консоли.)

```bash
cd client && set -a && source tools/verify/.env && set +a
node tools/verify/smoke.mjs --size 390x844 --touch --theme light --path /app --wait 5000 \
  --probe /www/my/vycord/.superpowers/vyc95/probes/probe-shell.js --out /www/my/vycord/.superpowers/vyc95/s1-shell-390-light.png
```
Expected: `{ ok: true }` в выводе, никаких `PROBE ERROR`.

---

### Task 11: PWA — манифест, иконки, мета, theme-color

**Files:**
- Create: `client/public/manifest.webmanifest`, `client/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`
- Modify: `client/index.html`, `client/src/stores/themeStore.ts`, `client/docs/design-system.md` (исключения)
- Test: `client/src/stores/__tests__/themeStore.themeColor.test.ts`

**Interfaces:**
- Produces: `THEME_COLOR: Record<'light' | 'dark', string>` в `themeStore.ts`.

- [ ] **Step 1: Иконки (временные, спека §8)**

```bash
cd client && mkdir -p public/icons
convert public/favicon.png -filter Lanczos -resize 144x144 -background '#040404' -gravity center -extent 192x192 public/icons/icon-192.png
convert public/favicon.png -filter Lanczos -resize 384x384 -background '#040404' -gravity center -extent 512x512 public/icons/icon-512.png
convert public/favicon.png -filter Lanczos -resize 300x300 -background '#040404' -gravity center -extent 512x512 public/icons/icon-maskable-512.png
convert public/favicon.png -filter Lanczos -resize 136x136 -background '#040404' -gravity center -extent 180x180 public/icons/apple-touch-icon.png
identify public/icons/*.png
```
Expected: 192x192, 512x512, 512x512, 180x180. `#040404` — фон самой `favicon.png` (замер `convert … %[pixel:p{1,1}]`), чтобы поля не выделялись. Maskable: логотип 300/512 ≈ 59% — внутри безопасной зоны 80%.

- [ ] **Step 2: Манифест**

`client/public/manifest.webmanifest`:
```json
{
  "name": "VYCORD",
  "short_name": "VYCORD",
  "start_url": "/app",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#FFFFFF",
  "theme_color": "#FFFFFF",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
`#FFFFFF` — `--canvas` светлой темы (`tokens.css:60`). Пути иконок относительны манифесту (он лежит в корне), поэтому работают при `base: './'`.

- [ ] **Step 3: `index.html`**

Заменить `<head>` на:
```html
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
    <!-- Литералы = --canvas светлой и тёмной темы (tokens.css). themeStore
         переписывает первый мета-тег под выбранную в приложении тему. -->
    <meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0E1017" media="(prefers-color-scheme: dark)" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="VYCORD" />
    <title>Vy Cord</title>
  </head>
```
Изменение `rel="icon"`: было `type="image/svg+xml" href="/favicon.png"` (тип не совпадал с файлом) — исправлено на `image/png`. Абсолютные `/…` пути: `index.html` отдаётся на `/app`, `/guest`, `/login` — относительные пути сломались бы на вложенных маршрутах; Vite при `base: './'` переписывает только ассеты, прошедшие через сборку, а `public/` копируется как есть. В Electron (`file://`) `<link rel="manifest">` не резолвится и игнорируется — проверить в Step 7.

- [ ] **Step 4: Тест синхронизации theme-color (падающий)**

`client/src/stores/__tests__/themeStore.themeColor.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  document.head.innerHTML =
    '<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#0E1017" media="(prefers-color-scheme: dark)">';
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  localStorage.clear();
});

describe('themeStore → meta theme-color', () => {
  it('an explicit app theme overrides both media-scoped metas', async () => {
    const { useThemeStore, THEME_COLOR } = await import('@/stores/themeStore');
    useThemeStore.getState().setTheme('dark');
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    expect(metas.map((m) => m.getAttribute('content'))).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
    useThemeStore.getState().setTheme('light');
    expect(metas.map((m) => m.getAttribute('content'))).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
  });

  it('colors match the canvas tokens', async () => {
    const { THEME_COLOR } = await import('@/stores/themeStore');
    expect(THEME_COLOR).toEqual({ light: '#FFFFFF', dark: '#0E1017' });
  });
});
```

- [ ] **Step 5: Прогнать — падает (`THEME_COLOR` не экспортирован).**

- [ ] **Step 6: Реализация в `themeStore.ts`**

```ts
/** --canvas светлой/тёмной темы (tokens.css). Мета-тег theme-color и манифест
 *  не читают CSS-переменные, поэтому это литералы — исключение, записанное в
 *  design-system.md. Меняешь --canvas — меняй и здесь, и в index.html. */
export const THEME_COLOR: Record<Theme, string> = { light: '#FFFFFF', dark: '#0E1017' };

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  window.electronAPI?.setTheme?.(theme);
  // Тема приложения может расходиться с системной: переписываем оба
  // media-варианта, иначе системная тема перекрасила бы статус-бар PWA.
  document.querySelectorAll?.('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLOR[theme]));
}
```
(`?.` у `querySelectorAll` — в node-тестах `document` — заглушка из `src/test/setup.ts` без этого метода.)

Run тест — PASS (2). Затем полный `npm test` — по-прежнему только 3 падения `api.network-retry`.

- [ ] **Step 7: design-system.md — исключения**

В раздел «Raw values and tints», в перечень «permanent non-CSS exemptions», дописать: «`public/manifest.webmanifest` и `<meta name="theme-color">` в `index.html` + `THEME_COLOR` в `stores/themeStore.ts` (значения `--canvas` обеих тем — манифест и мета-тег не читают CSS)». В раздел про JS-injected свойства пока ничего (`--keyboard-inset` появится на этапе 3).

- [ ] **Step 8: Проверка манифеста в браузере**

Проба `/www/my/vycord/.superpowers/vyc95/probes/probe-pwa.js` (сначала увидеть падение, временно переименовав `public/manifest.webmanifest`):
```js
(async () => {
  const fail = (m) => { throw new Error(`PROBE FAIL: ${m}`); };
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) fail('no manifest link');
  const res = await fetch(link.href);
  if (!res.ok) fail(`manifest ${res.status}`);
  const m = await res.json();
  if (m.display !== 'standalone') fail('display');
  if (m.start_url !== '/app') fail('start_url');
  const sizes = m.icons.map((i) => `${i.sizes}/${i.purpose}`);
  for (const need of ['192x192/any', '512x512/any', '512x512/maskable']) if (!sizes.includes(need)) fail(`icon ${need}`);
  for (const i of m.icons) {
    const r = await fetch(new URL(i.src, link.href));
    if (!r.ok) fail(`icon ${i.src} ${r.status}`);
  }
  const apple = document.querySelector('link[rel="apple-touch-icon"]');
  if (!apple || !(await fetch(apple.href)).ok) fail('apple-touch-icon');
  const tc = [...document.querySelectorAll('meta[name="theme-color"]')].map((x) => x.content);
  const want = document.documentElement.dataset.theme === 'dark' ? '#0E1017' : '#FFFFFF';
  if (!tc.length || tc.some((c) => c !== want)) fail(`theme-color ${tc} != ${want}`);
  return { ok: true, icons: sizes, themeColor: tc };
})()
```
Run на `/app` и `/guest` (`--anon`), обе темы. Expected: `{ ok: true … }`.

Electron: `cd client && npm run build` — exit 0 (сборка `dist/` с `manifest.webmanifest` и `icons/`).

---

### Task 12: Модалки-«sheet» на мобиле, полная проверка этапа, сообщение коммита

**Files:**
- Modify: `client/src/styles/primitives.css`

- [ ] **Step 1: `.modal` докладывается снизу при `< 900px`** (строка 90 таблицы покрытия)

В `primitives.css` сразу после блока `.modal { … }` / `@keyframes modal-in`:
```css
/* VYC-95 §4.5: на мобиле малые модалки (ConfirmModal, LinkDialog, создание и
   правка канала, создание сервера) садятся к низу, как sheet. Разметка и
   useModalFocus те же — меняется только геометрия. (0,2,0) над базой. */
@media (width < 900px) {
  .modal-overlay > .modal {
    width: 100%;
    max-width: none;
    margin-top: auto;
    border-radius: var(--radius-modal) var(--radius-modal) 0 0;
    border-bottom: none;
    padding-bottom: calc(24px + env(safe-area-inset-bottom));
  }
}
```
Проверить, что `ConfirmModal.css` не переопределяет ширину `.modal` на большей специфичности (`grep -n "\.modal" src/components/ConfirmModal.css`); если переопределяет — дописать его селектор в этот же блок, не меняя десктоп.

- [ ] **Step 2: Гейты этапа**

```bash
cd client
npx tsc --noEmit > /tmp/tsc.out 2>&1; echo "tsc exit=$?"; wc -c < /tmp/tsc.out
npx stylelint "src/**/*.css" > /tmp/sl.out 2>&1; echo "stylelint exit=$?"; wc -c < /tmp/sl.out
npm run check:i18n 2>&1 | tail -1
npm test 2>&1 | grep -E "FAIL|Tests " | sort -u
```
Expected: `tsc exit=0` / `0`; `stylelint exit=0` / `0`; «непереведённых строк не найдено.»; FAIL — только `api.network-retry.test.ts`, 3 failed.

- [ ] **Step 3: Десктоп — пиксель в пиксель**

Повторить Task 3 Step 9 в `/www/my/vycord/.superpowers/vyc95/after-s1/`. Expected как там.

- [ ] **Step 4: Визуальная матрица мобайла**

Для `W×H ∈ {375x812, 390x844, 768x1024}` × `theme ∈ {light, dark}`, все с `--touch`:
1. `/app` — корень «Серверы» + таб-бар;
2. `--click` по серверу — экран каналов (без таб-бара);
3. `--click` + `--click2` по каналу — чат;
4. вкладка «Друзья» (`--click '.tab-bar-item:nth-child(2)'`);
5. вкладка «Профиль» (`--click '.tab-bar-item:nth-child(3)'`);
6. «Профиль» → выход (`--click2 '.user-actions .panel-icon-btn.is-danger'`) — `ConfirmModal` снизу.

Плюс звонок: `--size 390x844 --touch --fake-media --preload tools/verify/inject-voice-ws.js` → чат → кнопка голоса в шапке → экран `call`; и landscape `--size 844x390` того же. Скриншоты — в `/www/my/vycord/.superpowers/vyc95/s1/`, имена `<state>-<W>-<theme>.png`. Каждый открыть и посмотреть (не только сохранить): нет пустых экранов, нет горизонтального скролла, safe-area не режет контент, таб-бар только на корнях.

- [ ] **Step 5: Руками**

Клик-проход в Chrome DevTools device mode (iPhone 12 Pro, Pixel 7), обе темы: серверы → каналы → чат → участники → назад ×3 кнопкой и системным «назад» браузера; вкладки; перезагрузка на экране чата → вернулись в чат; свайп от левого края (touch-эмуляция) возвращает на экран назад; вход в звонок и выход; модалки создания канала/сервера — снизу.

- [ ] **Step 6: Строки таблицы покрытия этапа 1**

В спеке §10 для строк 90, 93, 95, 96 (частично — allowlist ещё не пуст), 97 заменить «план» на «✅ этап 1 — <файл скриншота / тест>». Остальные строки не трогать.

- [ ] **Step 7: Предложить коммит пользователю (не коммитить)**

Файлы этапа:
```bash
git add client/src/mobile client/src/pages/app client/src/pages/AppPage.tsx \
  client/src/main.tsx \
  client/src/styles/__tests__/breakpoint-contract.test.ts client/src/styles/primitives.css \
  client/src/stores/themeStore.ts client/src/stores/__tests__/themeStore.themeColor.test.ts \
  client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts \
  client/public/manifest.webmanifest client/public/icons client/index.html \
  client/docs/design-system.md
# Спека и план лежат в каталоге, который игнорируется глобальным ~/.gitignore:
git add -f docs/superpowers/specs/2026-09-20-mobile-redesign-design.md \
  docs/superpowers/plans/2026-09-20-mobile-stage1-skeleton.md
```
Сообщение:
```
VYC-95 Мобильный каркас: стек экранов, таб-бар, bottom sheet, PWA

- AppPage → useAppController + DesktopShell (десктоп без изменений) / MobileShell
- стек экранов в history (location.state), свайп назад, reconcile со сторами
- BottomSheet/ActionSheet в overlay-контракте, useBackDismiss, useLongPress
- manifest.webmanifest, иконки, theme-color, safe-area
- контрактный тест единого брейкпоинта (allowlist наследия до этапа 7)
```
