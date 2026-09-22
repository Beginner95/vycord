# VYC-95 — этап 3: чат. План реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ САБ-СКИЛЛ: superpowers:subagent-driven-development.
> Шаги помечены чекбоксами (`- [ ]`).

**Цель:** заменить смонтированный на этапе 1 десктопный `ChatArea` мобильным
экраном `chat`, дать сообщениям long-press-меню, композеру — мобильную
раскладку («＋», шторки эмодзи/стикеров/вложений, кнопка отправки по
содержимому), лайтбоксу — жесты и back-закрытие, каналу — экран `channelInfo`,
приложению — экран `search` вместо ⌘K; добавить `--keyboard-inset`.

**Архитектура:** `ChatArea` / `Composer` / `MessageRow` / `MediaLightbox` /
`ExpressionPicker` получают **именованные швы** (необязательные пропсы; без них
DOM десктопа побайтно прежний). Всё мобильное содержимое швов живёт в
`src/mobile/` (`MessageActionsSheet`, `MobileMessageSearch`, `MobileAttachSheet`,
`MobileExpressionSheet`, `useFilePicker`, `useLightboxSwipe`). Экран `chat`
(`ChatScreen`) собирает `ChatArea` с `ScreenHeader`. Логика участников и палитры
выносится в хуки (`useMemberList`, `usePaletteSearch`), которыми пользуются и
десктопные компоненты, и мобильные экраны. Прежде чем трогать любой общий
компонент, T1 снимает его DOM с нетронутого кода в файловые снимки.

**Стек:** React 19, TypeScript, Zustand 5, react-router-dom 7, Vitest 4 +
@testing-library/react, lucide-react, обычный CSS на компонент.

**Спека:** `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`
(§1 таблица швов, §4.4, §4.5, §5.4, §5.5, §5.10, §9; строки покрытия 19, 20 (часть),
21–44, 87, 92; follow-up этапа 2 про `--keyboard-inset`).

**Предыдущий этап:** `docs/superpowers/plans/2026-09-20-mobile-stage2-servers-channels.md`
(закоммичен, `5555d72`).

## Global Constraints

- **Десктоп (≥ 900px) не меняется ни на пиксель и ни на узел DOM.** Любая правка
  в `src/components/*` — только необязательные пропсы, которые на десктопе
  `undefined`, и вынос кода без смены порядка/классов узлов. Гарантия: файловые
  снимки DOM из T1 остаются зелёными на КАЖДОЙ задаче, затрагивающей эти файлы;
  T12 — скриншоты 1280×800 против нетронутого оригинала.
- **Один брейкпоинт.** Новые CSS-файлы под `src/mobile/` не содержат
  `@media (width …)` вообще (рендерятся только на мобиле). В существующих
  компонентных файлах блоки `@media (width <= 768px)` **переводятся** на
  `@media (width < 900px)` (условие из allowlist), а файл вычёркивается из
  `LEGACY` в `src/styles/__tests__/breakpoint-contract.test.ts`. Тест — гейт:
  правки списка обязательны ровно там, где файл менялся.
- **Токены только ролевые.** Ни одного literal-цвета вне `tokens.css`. Радиусы —
  из шкалы (`--radius-chip|row|btn|card|tile|composer|modal|bar|pill`), **12px в
  шкале нет** (дважды ловили на этапе 2). Анимации — `--transition` / `--ease-out`
  + `@media (prefers-reduced-motion: reduce)`.
- **Иконки** — lucide, явный `size` и `strokeWidth={1.8}`.
- **Классы** — `component-thing` / `is-*`, без числовых z-index (слои — `--z-*`
  или порядок DOM), без новых систем оверлеев: только `.modal-overlay` +
  `useModalFocus` (шторки — `BottomSheet`/`ActionSheet` этапа 1).
- **`var(--x, fallback)` только там, где это оговорено** (`--keyboard-inset` —
  JS-инжектируемое свойство, его потребители несут фоллбек; см. design-system.md).
- **i18n:** ни одной пользовательской строки в коде. Новые ключи — в оба
  `src/i18n/locales/ru.ts` и `en.ts`. Гейт: `npm run check:i18n` →
  «непереведённых строк не найдено.». В тестах кириллицу в JSX-подобных строках
  выносить в константы (эвристика check-i18n).
- **Тач-цели ≥ 44×44** (спека §5.1). Для мелких визуальных контролов (плееры)
  допустимо расширить зону нажатия псевдоэлементом (`inset: -6px` вокруг 32px),
  проверка — пробой `elementFromPoint`, а не `getBoundingClientRect`.
- **Гейты (из `client/`; корневого `package.json` нет):**
  `npx tsc --noEmit` — exit 0, ноль байт; `npx stylelint "src/**/*.css"` — exit 0,
  ноль байт; `npm run check:i18n` — «непереведённых строк не найдено.»;
  `npm test` — ровно 3 падения, все в `api.network-retry.test.ts`. **Этот файл не
  чинить.** **Скрипты гейтов и конфиги не править** (`scripts/check-i18n.mjs`,
  `.stylelintrc*`, `vite.config.ts`) — исполнитель на этапе 2 правил гейт под свой
  тест и был откачен.
- **Коммиты и пуши делает пользователь.** Исполнители НЕ выполняют `git commit`,
  `git add`, `git push`, `git stash`, не мёржат и не ребейзят. Сообщение коммита
  предлагается в T12. Никогда не добавлять Claude как co-author.
- **Никогда `git add -A` / `git add .`** (в корне лежит неотслеживаемая
  `design_handoff_discord_redesign/`).
- Все `npm` / `npx` / `node` — из `client/`. Dev-сервер — `npm run dev:vite`.
- **Снимки DOM никогда не обновлять** (`vitest -u`, `--update` запрещены). Снимок
  меняется только осознанной правкой десктопного DOM, чего на этом этапе нет.

## Решения этого плана (приняты автором плана, менять только с обоснованием)

- **D1. Швы `ChatArea` — именованные пропсы.** `header`, `searchMode`,
  `messageActions`, `composerVariant`, `enterSends`, `historyOverlays`, `active`.
  Отступление от таблицы спеки §1: `header` может быть **функцией**
  `(api: { openSearch(): void }) => ReactNode`, потому что состояние поиска живёт
  внутри `ChatArea`, а кнопка поиска — в мобильной шапке. Без этого шапке пришлось
  бы дублировать состояние.
- **D2. Удалять чужие сообщения нельзя — паритет с десктопом.** Спека пишет
  «Удалить (своё/право)», но права на удаление чужих сообщений в `PERMISSIONS` нет,
  а десктопный `MessageRow` считает `canModify = isOwn`. Мобайл повторяет десктоп.
- **D3. `FloatingQuoteButton` на тач-строках недостижим.** Спека §4.4 требует
  `user-select: none` на строках с long-press (иначе жест конфликтует с системным
  выделением слова), а §5.4 просит проверить выделение. Побеждает жест; цитирование
  закрыто пунктом «Цитировать» (целиком сообщение). Строка покрытия 26 — ⏳ частично.
  Кнопка остаётся смонтированной и работает для выделения в самом композере.
- **D4. Снимки DOM — файловые (`toMatchFileSnapshot`), а не литералы в тестах.**
  На этапе 2 литералы работали для небольших модалок; `ChatArea` даёт десятки КБ
  разметки, и эвристика check-i18n принимала бы их за JSX. Снимки снимаются на
  нетронутом коде (T1) и коммитятся как свидетельство.
- **D5. Блоки `<= 768px` переводятся на `< 900px` в файлах, которые этап трогает**
  (`ChatArea`, `Composer`, `MessageRow`, `MessageSearch`, `VoiceBanner`,
  `MediaLightbox`, `VideoPlayer`, `MessageAttachments`, `UserList`). Это безопасно
  для десктопа по определению (≥ 900 условие не срабатывает) и сокращает
  `LEGACY`; остальное — этап 7. `CommandPalette.css` (`<= 640px`) остаётся: палитра
  на мобиле больше не монтируется, блок мёртв — удалит этап 7.
- **D6. Правка сообщения на мобиле — встроенный `MessageEditor` с явными
  «Отмена / Сохранить»** и БЕЗ отмены по blur: на тач-клавиатуре нет Escape, а
  blur-отмена съедает тап по кнопке (iOS не фокусирует `<button>`).
- **D7. `channelInfo` без «Пригласить гостя» и «Гости».** Обе вещи требуют выноса
  тела `GuestInvitePopover` (этап 4, строки 62 и 64). В `channelInfo` этапа 3
  входят: шапка-назад, герой, кнопки «Звонок» и «Поиск», «Участники» (+ строка
  «Пригласить друзей» при праве), «Управление каналом» (переименовать/удалить через
  `ChannelMenuSheet` этапа 2).
- **D8. Экран `search`.** Вход: иконка на «Серверах» и аппаратный ⌘K/Ctrl+K
  (`paletteStore.isOpen` → `push(search)`; десктопная `CommandPalette` на мобиле не
  монтируется). Группа «Сообщения» и действие «Искать в канале» есть, только если
  **непосредственно под `search` в стеке лежит `chat`**. Результаты ложатся
  **поверх** `search` (он остаётся в стеке — привычное «назад к результатам»).
  Сообщение/поиск в канале: команда в `paletteStore` + `nav.back()` на чат.
- **D9. Команды палитры (`chat-search`, `chat-jump`) `ChatArea` принимает только
  при `active`** (проп, по умолчанию `true`). `ChatScreen` передаёт «чат — верхний
  экран стека»; иначе поиск открылся бы под перекрывающим экраном и запушил
  `sheet`-запись поверх чужого экрана.
- **D10. Подзаголовок шапки чата:** «сервер · в звонке: N» при N > 0, иначе
  «сервер · N участников». Спека пишет только «N в звонке»; пустой звонок не
  должен показывать «0 в звонке».
- **D11. iOS-клавиатура:** `--keyboard-inset` уменьшает высоту `.mobile-shell`
  (`calc(100dvh - var(--keyboard-inset, 0px))`) — этим же закрывается перекрытая
  клавиатурой липкая кнопка форм этапа 2. Проверено только в эмуляции: реальный
  iOS — в отчёте как непроверенный.
- **D12. Без тоста «Скопировано».** Закрытие шторки — обратная связь. Follow-up.

## Структура файлов

**Создаются:**

| Файл | Ответственность |
|---|---|
| `src/components/__tests__/{ChatArea,ExpressionPicker,MediaLightbox,UserList,CommandPalette}.dom.test.tsx` + `__snapshots__/*.html`, `chatHarness.tsx` | T1: снимки DOM десктопа, снятые ДО правок |
| `src/mobile/pointer.ts` | `useCoarsePointer()` |
| `src/mobile/keyboard.ts` | `keyboardInset()`, `useVisualViewportInset()` |
| `src/mobile/chat/useMessageActions.tsx` | пункты long-press-меню сообщения |
| `src/mobile/chat/MessageActionsSheet.tsx` | `ActionSheet` над `useMessageActions` |
| `src/mobile/components/MobileMessageSearch.tsx` + `.css` | слой поиска по каналу на весь экран + back-закрытие |
| `src/mobile/sheets/BackDismissGate.tsx` | безрендерная обёртка `useBackDismiss` для внешних оверлеев |
| `src/mobile/hooks/useFilePicker.tsx` | скрытый `<input type=file>` + `open(accept)` |
| `src/mobile/components/MobileAttachSheet.tsx` | «＋» композера → `ActionSheet` |
| `src/mobile/components/MobileExpressionSheet.tsx` + `.css` | эмодзи/стикеры в `BottomSheet` |
| `src/components/ExpressionBody.tsx` | вкладки + панели пикера (общее тело) |
| `src/mobile/gestures/lightboxSwipe.ts` + `useLightboxSwipe.ts` | решение свайпа + хук |
| `src/mobile/screens/ChatScreen.tsx` + `.css` | экран `chat` |
| `src/components/useMemberList.ts` | онлайн/офлайн/last seen/голос участников |
| `src/mobile/screens/ChannelInfoScreen.tsx` + `.css` | экран `channelInfo` |
| `src/hooks/usePaletteSearch.ts` | поиск сообщений палитры (debounce) |
| `src/mobile/screens/SearchScreen.tsx` + `.css` | экран `search` |
| тесты рядом с каждым модулем (см. задачи) | |

**Меняются:** `src/components/{ChatArea,Composer,MessageRow,MessageSearch,MediaLightbox,ExpressionPicker,UserList,CommandPalette}.tsx`
+ `.css` (`ChatArea`, `Composer`, `MessageRow`, `MessageSearch`, `VoiceBanner`,
`MediaLightbox`, `VideoPlayer`, `AudioPlayer`, `MessageAttachments`, `UserList`,
`ExpressionPicker`), `src/pages/app/AppOverlays.tsx`, `src/mobile/{MobileShell.tsx,MobileShell.css}`,
`src/mobile/screens/{renderScreen.tsx,ServersScreen.tsx}`, `src/i18n/locales/{ru,en}.ts`,
`src/styles/__tests__/breakpoint-contract.test.ts`, `client/docs/design-system.md`,
`docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`.

**Порядок задач важен:** T1 (снимки) → T2 (независимые примитивы) → T3–T5
(швы `MessageRow`, `Composer`) → T6 (`ChatArea`) → T7 (`ChatScreen`) → T8 (лайтбокс) →
T9 (`channelInfo`) → T10 (`search`) → T11 (сшивка) → T12 (приёмка).

---

### Task 1: снимки DOM десктопа с нетронутого кода

**Файлы:**
- Создать: `client/src/components/__tests__/chatHarness.tsx`
- Создать: `client/src/components/__tests__/ChatArea.dom.test.tsx`
- Создать: `client/src/components/__tests__/ExpressionPicker.dom.test.tsx`
- Создать: `client/src/components/__tests__/MediaLightbox.dom.test.tsx`
- Создать: `client/src/components/__tests__/UserList.dom.test.tsx`
- Создать: `client/src/components/__tests__/CommandPalette.dom.test.tsx`
- Создаются тестами: `client/src/components/__tests__/__snapshots__/*.html`

**Интерфейсы:**
- Потребляет: ничего (код `src/components/*` НЕ трогать — задача снимает его как есть).
- Производит: `chatHarness.tsx` — `stubBrowser()`, `fixedNow`, фикстуры
  `channel`, `serverA`, `me`, `otherUser`, `messages()`; их берут T4–T8.

Цель: зафиксировать DOM ДО правок, чтобы «десктоп не изменился» проверялось
diff'ом снимка, а не глазами. **Не менять ни одного файла вне `__tests__/`.**

- [ ] **Шаг 1: прочитать нужное.** `src/stores/{messageStore,serverStore,callStore,paletteStore,unreadStore,guestManagementStore}.ts`,
  `src/components/ChatArea.tsx` (эффекты и что он зовёт из `apiService` / `wsService` /
  `audioService`), и как этап 2 строил такие тесты:
  `src/components/__tests__/FindServerModal.dom.test.tsx` (шапка, моки, константы).

- [ ] **Шаг 2: `chatHarness.tsx`** — общие фикстуры и заглушки браузера.

```tsx
import { vi } from 'vitest';
import type { Channel, MemberWithUser, Server, User } from '@/types';
import type { ChatMessage } from '@/stores/messageStore';

/** Фиксированное «сейчас»: разделители дней и время строк не зависят от прогона. */
export const fixedNow = new Date('2026-09-20T12:00:00Z');

export const me = { id: 'u1', username: 'anna', email: 'a@x' } as User;
export const otherUser = { user_id: 'u2', username: 'boris' } as MemberWithUser;
export const serverA = { id: 's1', name: 'Wolves', owner_id: 'u1' } as Server;
export const channel: Channel = {
  id: 'c1', server_id: 's1', name: 'general', position: 0, created_at: '', updated_at: '',
};

const base = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm', channel_id: 'c1', user_id: 'u2', kind: 'user', content: '',
  created_at: '2026-09-20T09:05:00Z', updated_at: '2026-09-20T09:05:00Z', ...over,
});

/** Чужой текст с форматированием, своё изменённое, своё неотправленное, стикер. */
export function messages(): ChatMessage[] {
  return [
    base({ id: 'm1', content: 'hello **bold** and <@u1>' }),
    base({ id: 'm2', user_id: 'u1', content: 'my text', updated_at: '2026-09-20T09:10:00Z', created_at: '2026-09-20T09:06:00Z' }),
    base({ id: 'pending-1', user_id: 'u1', content: 'failed one', created_at: '2026-09-20T09:07:00Z', updated_at: '2026-09-20T09:07:00Z', deliveryState: 'failed' }),
    base({ id: 'm4', sticker_id: 'st1', content: '', sticker: { id: 'st1', server_id: 's1', name: 'wow', image_url: '/u/wow.png' } as never }),
  ];
}

/** Заглушки того, чего нет в jsdom и что зовёт чат. Добавляй только то, чего
 *  требует прогон, не «на всякий случай». */
export function stubBrowser(): void {
  process.env.TZ = 'UTC';
  Element.prototype.scrollIntoView = vi.fn();
  class IO { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } }
  (globalThis as unknown as { IntersectionObserver: typeof IO }).IntersectionObserver = IO;
  window.matchMedia = vi.fn((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}
```

- [ ] **Шаг 3: `ChatArea.dom.test.tsx`.** Скелет (моки — в самом файле, `vi.mock`
  поднимается только из него). Довести до зелёного, добавляя заглушки по одной.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatArea } from '../ChatArea';
import { useMessageStore } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { channel, fixedNow, me, messages, otherUser, serverA, stubBrowser } from './chatHarness';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listStickers: vi.fn(async () => []),
      getUserById: vi.fn(async () => ({ id: 'u2', username: 'boris' })),
      searchMessages: vi.fn(async () => ({ results: [], total: 0 })),
      getMessagesAround: vi.fn(async () => []),
      getMessages: vi.fn(async () => []),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

beforeAll(stubBrowser);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(fixedNow);
  useMessageStore.setState({ messages: messages(), loading: false });
  useServerStore.setState({ currentServer: serverA, servers: [serverA], serversLoaded: true, members: [otherUser], channels: [channel], permissions: new Map() });
  useCallStore.setState({ callChannelId: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const props = () => ({ channel, user: me, voiceParticipants: new Map([['c1', ['u2']]]), onJoinVoice: vi.fn(), onShowCall: vi.fn(), onShowMembers: vi.fn(), onMobileBack: vi.fn() });
const snap = (name: string) => expect(document.body.innerHTML).toMatchFileSnapshot(`./__snapshots__/ChatArea.${name}.html`);
const mount = (p = props()) => render(<MemoryRouter><ChatArea {...p} /></MemoryRouter>);

describe('ChatArea DOM (desktop parity, снято до VYC-95 этапа 3)', () => {
  it('channel with messages', async () => { mount(); await act(async () => {}); await snap('channel'); });
  it('loading skeleton', async () => { useMessageStore.setState({ messages: [], loading: true }); mount(); await snap('loading'); });
  it('quiet channel', async () => { useMessageStore.setState({ messages: [] }); mount(); await snap('quiet'); });
  it('no channel, no servers', async () => { useServerStore.setState({ servers: [] }); mount({ ...props(), channel: null as never }); await snap('no-servers'); });
  it('no channel, servers exist', async () => { mount({ ...props(), channel: null as never }); await snap('welcome'); });
  it('search panel open', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.chat-search-btn')!);
    await act(async () => {});
    await snap('search');
  });
  it('inline editor open on own message', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.msg-row.is-own .msg-action-btn[aria-label]:not(.is-danger)')!);
    await snap('editing');
  });
  it('delete confirm open', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.msg-row.is-own .msg-action-btn.is-danger')!);
    await snap('delete-confirm');
  });
  it('emoji picker open', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.composer-icon-btn')!);
    await snap('emoji-picker');
  });
});
```
  Выбор селекторов «первой из двух кнопок своего сообщения» подогнать под реальный
  DOM (кнопки: цитата, изменить, удалить — в этом порядке). Если снимок содержит
  недетерминированное (случайные id `useId`, `Date.now()`-числа) — это надо
  **нормализовать в тесте** (замена `:r\d+:` → `:rN:`), а не игнорировать.

- [ ] **Шаг 4: остальные четыре теста** по тому же образцу (`toMatchFileSnapshot`,
  `document.body.innerHTML`):
  - `ExpressionPicker.dom.test.tsx`: `tabs=['emoji']` (одна вкладка, без полосы);
    `tabs=['emoji','stickers']` с `stickers={{serverId:'s1', items:[два стикера], onSend, onManage}}`
    на вкладке «Эмодзи» и после клика по вкладке «Стикеры». Сбросить
    `useExpressionRecentsStore` перед каждым тестом.
  - `MediaLightbox.dom.test.tsx`: картинка с индексом 1 из 3 (обе стрелки), первая
    картинка (только «вперёд»), видео.
  - `UserList.dom.test.tsx`: моки `apiService.getOnlineUsers/getLastSeenBatch`,
    `useServerStore` с 3 участниками (один онлайн, два офлайн), `voiceParticipants`
    с онлайн-участником в канале, права `CREATE_INVITE` (карточка приглашения) и без;
    состояние карточки с созданным инвайтом не снимать.
  - `CommandPalette.dom.test.tsx`: `usePaletteStore.setState({ isOpen: true })`;
    пустой запрос (каналы + действия) и запрос `'gen'`; `Element.prototype.scrollIntoView` стаб.

- [ ] **Шаг 5: прогнать и проверить, что снимки записались.**

Run: `cd client && npx vitest run src/components/__tests__/ChatArea.dom.test.tsx src/components/__tests__/ExpressionPicker.dom.test.tsx src/components/__tests__/MediaLightbox.dom.test.tsx src/components/__tests__/UserList.dom.test.tsx src/components/__tests__/CommandPalette.dom.test.tsx`
Expected: PASS, файлы `.html` появились в `__snapshots__/`.
Затем **второй прогон той же командой**: PASS и ни одного «written» в выводе (снимок
детерминирован). Если второй прогон пишет/падает — доработать нормализацию.

- [ ] **Шаг 6: убедиться, что код не тронут.**

Run: `cd /www/my/vycord && git status --short`
Expected: только новые файлы в `client/src/components/__tests__/`. Ни одного `M`.

- [ ] **Шаг 7: гейты** `npx tsc --noEmit`, `npx stylelint "src/**/*.css"`,
  `npm run check:i18n`, `npm test` (3 штатных падения).

---

### Task 2: примитивы — `useCoarsePointer`, `--keyboard-inset`

**Файлы:**
- Создать: `client/src/mobile/pointer.ts`, `client/src/mobile/keyboard.ts`
- Создать: `client/src/mobile/__tests__/pointer.test.tsx`, `client/src/mobile/__tests__/keyboard.test.tsx`
- Изменить: `client/src/mobile/MobileShell.tsx`, `client/src/mobile/MobileShell.css`
- Изменить: `client/docs/design-system.md`

**Интерфейсы:**
- Производит: `useCoarsePointer(): boolean`; `keyboardInset(vv: {height:number; offsetTop:number}, innerHeight: number): number`;
  `useVisualViewportInset(target: RefObject<HTMLElement | null>): void`;
  `KEYBOARD_INSET_VAR = '--keyboard-inset'`.

- [ ] **Шаг 1: тест `keyboard.test.tsx` (красный).**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { keyboardInset, useVisualViewportInset, KEYBOARD_INSET_VAR } from '@/mobile/keyboard';

describe('keyboardInset', () => {
  it('is what the visual viewport lost, minus its scroll offset', () => {
    expect(keyboardInset({ height: 500, offsetTop: 0 }, 844)).toBe(344);
    expect(keyboardInset({ height: 500, offsetTop: 40 }, 844)).toBe(304);
  });
  it('treats a small delta (collapsing URL bar) as no keyboard', () => {
    expect(keyboardInset({ height: 800, offsetTop: 0 }, 844)).toBe(0);
  });
  it('never goes negative', () => {
    expect(keyboardInset({ height: 900, offsetTop: 0 }, 844)).toBe(0);
  });
});

function setViewport(vv: unknown, innerHeight = 844) {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
}
function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  useVisualViewportInset(ref);
  return <div ref={ref} data-testid="shell" />;
}
afterEach(() => { cleanup(); setViewport(undefined); });

describe('useVisualViewportInset', () => {
  it('writes the property, follows resize/scroll and clears it on unmount', () => {
    const vv = Object.assign(new EventTarget(), { height: 500, offsetTop: 0 });
    setViewport(vv);
    const { getByTestId, unmount } = render(<Probe />);
    const el = getByTestId('shell');
    expect(el.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('344px');
    act(() => { vv.height = 844; vv.dispatchEvent(new Event('resize')); });
    expect(el.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('0px');
    act(() => { vv.height = 600; vv.offsetTop = 20; vv.dispatchEvent(new Event('scroll')); });
    expect(el.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('224px');
    unmount();
    expect(el.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('');
  });
  it('does nothing without visualViewport', () => {
    setViewport(undefined);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('shell').style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('');
  });
});
```

- [ ] **Шаг 2: `pointer.test.tsx` (красный)** — по образцу `breakpoint.test.tsx`
  (`stubMatchMedia` с запросом `(pointer: coarse)`): начальное значение, реакция на
  `change`, отписка при размонтировании.

- [ ] **Шаг 3: прогнать** `npx vitest run src/mobile/__tests__/keyboard.test.tsx src/mobile/__tests__/pointer.test.tsx` → FAIL (модулей нет).

- [ ] **Шаг 4: реализация.**

```ts
// client/src/mobile/pointer.ts
import { useSyncExternalStore } from 'react';

/** Основной указатель — палец (нет точного курсора). Мобильный Enter в композере
 *  переносит строку, а не отправляет (спека §5.4). */
export const COARSE_MQ = '(pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(COARSE_MQ);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(COARSE_MQ).matches, () => false);
}
```

```ts
// client/src/mobile/keyboard.ts
import { useEffect, type RefObject } from 'react';

export const KEYBOARD_INSET_VAR = '--keyboard-inset';
/** Меньше — это сворачивающаяся адресная строка, а не клавиатура. */
const KEYBOARD_MIN_PX = 80;

export function keyboardInset(vv: { height: number; offsetTop: number }, innerHeight: number): number {
  const raw = Math.round(innerHeight - vv.height - vv.offsetTop);
  return raw >= KEYBOARD_MIN_PX ? raw : 0;
}

/** Спека §5.4: на iOS `interactive-widget=resizes-content` игнорируется, поэтому
 *  высоту, отнятую клавиатурой у visualViewport, пишем в `--keyboard-inset` на
 *  оболочку (JS-инжектируемое свойство: потребители несут фоллбек `0px`). */
export function useVisualViewportInset(target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = target.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;
    const apply = () => el.style.setProperty(KEYBOARD_INSET_VAR, `${keyboardInset(vv, window.innerHeight)}px`);
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      el.style.removeProperty(KEYBOARD_INSET_VAR);
    };
  }, [target]);
}
```

- [ ] **Шаг 5: оболочка.** В `MobileShell.tsx`: `const shellRef = useRef<HTMLDivElement>(null);`,
  `useVisualViewportInset(shellRef);`, `<div className="mobile-shell" ref={shellRef}>`.
  В `MobileShell.css` заменить `height: 100dvh;` на
  `height: calc(100dvh - var(--keyboard-inset, 0px));` (комментарий: единственный
  потребитель; на Chrome с `resizes-content` значение 0, на iOS сжимает оболочку).

- [ ] **Шаг 6: `design-system.md`.** В списке «JS-injected properties» добавить
  `--keyboard-inset` и расширить команду `grep` этим именем (по образцу соседних).

- [ ] **Шаг 7: прогон** тестов шага 3 → PASS; затем весь `src/mobile` и
  `npx vitest run src/mobile/__tests__/MobileShell.nav.test.tsx src/mobile/__tests__/MobileShell.stage2.test.tsx` → PASS.

- [ ] **Шаг 8: гейты** (tsc, stylelint, check:i18n, npm test).

---

### Task 3: `useMessageActions` и `MessageActionsSheet`

**Файлы:**
- Создать: `client/src/mobile/chat/useMessageActions.tsx`, `client/src/mobile/chat/MessageActionsSheet.tsx`
- Создать: `client/src/mobile/chat/__tests__/useMessageActions.test.tsx`, `client/src/mobile/chat/__tests__/MessageActionsSheet.test.tsx`
- Изменить: `client/src/i18n/locales/ru.ts`, `client/src/i18n/locales/en.ts`

**Интерфейсы:**
- Потребляет: `ContextMenuItem` (`@/components/ContextMenu`), `ActionSheet` (`@/mobile/sheets/ActionSheet`),
  `ChatMessage`, `toDisplayMentions`.
- Производит:
  ```ts
  export interface MessageActionsInput {
    msg: ChatMessage; canModify: boolean; members: MemberWithUser[];
    onQuote(): void; onEdit(): void; onDelete(): void; onRetry(): void; onDiscard(): void;
  }
  export function useMessageActions(i: MessageActionsInput): ContextMenuItem[];
  export function MessageActionsSheet(p: {
    msg: ChatMessage | null; isOwn: boolean; members: MemberWithUser[]; onClose(): void;
    onQuote(m: ChatMessage): void; onEdit(m: ChatMessage): void; onDelete(m: ChatMessage): void;
    onRetry(m: ChatMessage): void; onDiscard(m: ChatMessage): void;
  }): JSX.Element | null;
  ```
  Порядок пунктов: отправленное — Цитировать, Копировать текст, Изменить, Удалить (danger);
  неотправленное (`failed`) — Повторить, Отменить (danger); `sending` — пусто; стикер —
  только Удалить (и только своё); сообщение без текста (только вложения) — без
  «Цитировать/Копировать».

- [ ] **Шаг 1: i18n.** В `mobile` добавить ключи (ru / en):
  `msgActions` «Действия с сообщением» / «Message actions»; `msgQuote` «Цитировать» / «Quote»;
  `msgCopy` «Копировать текст» / «Copy text»; `msgRetry` «Повторить отправку» / «Retry sending»;
  `msgDiscard` «Отменить отправку» / «Discard». «Изменить»/«Удалить» — `common.edit` / `common.delete`.

- [ ] **Шаг 2: тест `useMessageActions.test.tsx` (красный).**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMessageActions } from '@/mobile/chat/useMessageActions';
import { toDisplayMentions } from '@/utils/mentions';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';

const UID = '11111111-1111-1111-1111-111111111111';
const members = [{ user_id: UID, username: 'boris' } as MemberWithUser];
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channel_id: 'c1', user_id: 'u1', kind: 'user', content: 'text',
  created_at: 't', updated_at: 't', ...over,
});
const handlers = () => ({ onQuote: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn(), onDiscard: vi.fn() });
const items = (m: ChatMessage, canModify: boolean, h = handlers()) =>
  renderHook(() => useMessageActions({ msg: m, canModify, members, ...h })).result.current;

const writeText = vi.fn(async () => {});
beforeEach(() => { writeText.mockClear(); Object.assign(navigator, { clipboard: { writeText } }); });

describe('useMessageActions', () => {
  it('own sent text: quote, copy, edit, delete (danger last)', () => {
    const h = handlers();
    const list = items(msg(), true, h);
    expect(list.map((i) => !!i.danger)).toEqual([false, false, false, true]);
    list[0].onClick(); list[2].onClick(); list[3].onClick();
    expect(h.onQuote).toHaveBeenCalledOnce();
    expect(h.onEdit).toHaveBeenCalledOnce();
    expect(h.onDelete).toHaveBeenCalledOnce();
  });

  it("someone else's text: quote and copy only", () => {
    const list = items(msg({ user_id: 'u2' }), false);
    expect(list).toHaveLength(2);
    expect(list.some((i) => i.danger)).toBe(false);
  });

  it('copy puts the DISPLAY form of mentions on the clipboard, not <@uuid>', () => {
    const content = `hi <@${UID}>`;
    items(msg({ content }), true)[1].onClick();
    expect(writeText).toHaveBeenCalledWith(toDisplayMentions(content, members));
    expect(writeText).not.toHaveBeenCalledWith(content);
  });

  it('own sticker: delete only; foreign sticker: nothing', () => {
    const own = items(msg({ sticker_id: 'st', content: '' }), true);
    expect(own).toHaveLength(1);
    expect(own[0].danger).toBe(true);
    expect(items(msg({ sticker_id: 'st', content: '', user_id: 'u2' }), false)).toHaveLength(0);
  });

  it('attachment-only own message: edit and delete, no quote/copy', () => {
    expect(items(msg({ content: '' }), true)).toHaveLength(2);
  });

  it('failed: retry then discard (danger); sending: nothing', () => {
    const h = handlers();
    const failed = items(msg({ deliveryState: 'failed' }), true, h);
    expect(failed.map((i) => !!i.danger)).toEqual([false, true]);
    failed[0].onClick(); failed[1].onClick();
    expect(h.onRetry).toHaveBeenCalledOnce();
    expect(h.onDiscard).toHaveBeenCalledOnce();
    expect(items(msg({ deliveryState: 'sending' }), true)).toEqual([]);
  });
});
```

- [ ] **Шаг 3: тест `MessageActionsSheet.test.tsx` (красный).** Обёртка `MemoryRouter`
  (внутри `BottomSheet` — `useBackDismiss` → `useMobileNav`). Проверить: при `msg=null`
  ничего не рендерится; при своём тексте открыт `[role=dialog]` с 4 `.action-sheet-item`;
  клик по «Удалить» зовёт `onDelete(msg)` с тем же объектом и `onClose`; для сообщения
  `sending` (пустой список) — `onClose` вызван, шторки нет.

- [ ] **Шаг 4: прогон** → FAIL.

- [ ] **Шаг 5: реализация.**

```tsx
// client/src/mobile/chat/useMessageActions.tsx
import { Copy, Pencil, Quote, RotateCw, Trash2 } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';
import { toDisplayMentions } from '@/utils/mentions';
import { useT } from '@/i18n';

export interface MessageActionsInput {
  msg: ChatMessage;
  /** Своё и не гость: правка/удаление (у гостя звонка таких эндпоинтов нет). */
  canModify: boolean;
  members: MemberWithUser[];
  onQuote(): void;
  onEdit(): void;
  onDelete(): void;
  onRetry(): void;
  onDiscard(): void;
}

const icon = (Icon: typeof Quote) => <Icon size={20} strokeWidth={1.8} />;

/** Пункты long-press-меню сообщения (спека §5.4). Те же правила доступности, что у
 *  hover-панели десктопного MessageRow: у неотправленного нет серверного id (только
 *  «повторить/отменить»), у стикера нечего цитировать и править. */
export function useMessageActions(i: MessageActionsInput): ContextMenuItem[] {
  const t = useT();
  const { msg } = i;
  if (msg.deliveryState === 'sending') return [];
  if (msg.deliveryState === 'failed') {
    return [
      { label: t('mobile.msgRetry'), icon: icon(RotateCw), onClick: i.onRetry },
      { label: t('mobile.msgDiscard'), icon: icon(Trash2), danger: true, onClick: i.onDiscard },
    ];
  }
  const items: ContextMenuItem[] = [];
  if (!msg.sticker_id && msg.content.trim().length > 0) {
    items.push({ label: t('mobile.msgQuote'), icon: icon(Quote), onClick: i.onQuote });
    items.push({
      label: t('mobile.msgCopy'),
      icon: icon(Copy),
      // В буфер — отображаемая форма («@boris»), а не проводная <@uuid>.
      onClick: () => { void navigator.clipboard?.writeText(toDisplayMentions(msg.content, i.members))?.catch(() => {}); },
    });
  }
  if (i.canModify && !msg.sticker_id) items.push({ label: t('common.edit'), icon: icon(Pencil), onClick: i.onEdit });
  if (i.canModify) items.push({ label: t('common.delete'), icon: icon(Trash2), danger: true, onClick: i.onDelete });
  return items;
}
```

```tsx
// client/src/mobile/chat/MessageActionsSheet.tsx
import { useEffect } from 'react';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { useT } from '@/i18n';
import { useMessageActions } from './useMessageActions';

interface Props {
  msg: ChatMessage | null;
  isOwn: boolean;
  members: MemberWithUser[];
  onClose: () => void;
  onQuote: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
  onDiscard: (m: ChatMessage) => void;
}

/** Шторка действий над сообщением. Потока «после выбора» нет (подтверждение
 *  удаления и редактор живут в ChatArea), поэтому контракт D8 этапа 2 не нужен:
 *  ActionSheet зовёт onClose() ДО onClick, а пункт уже держит свою запись. */
export function MessageActionsSheet(props: Props) {
  if (!props.msg) return null;
  return <Body {...props} msg={props.msg} />;
}

function Body({ msg, isOwn, members, onClose, onQuote, onEdit, onDelete, onRetry, onDiscard }: Props & { msg: ChatMessage }) {
  const t = useT();
  const items = useMessageActions({
    msg, members, canModify: isOwn,
    onQuote: () => onQuote(msg), onEdit: () => onEdit(msg), onDelete: () => onDelete(msg),
    onRetry: () => onRetry(msg), onDiscard: () => onDiscard(msg),
  });
  // Пустое меню (отправляется, чужой стикер) — закрыть, не показывая пустую шторку.
  const empty = items.length === 0;
  useEffect(() => { if (empty) onClose(); }, [empty]);
  if (empty) return null;
  return <ActionSheet open onClose={onClose} title={t('mobile.msgActions')} items={items} />;
}
```

- [ ] **Шаг 6: прогон** новых тестов → PASS. **Шаг 7: гейты.**

---

### Task 4: шов `MessageRow` — long-press и правка с кнопками

**Файлы:**
- Изменить: `client/src/components/MessageRow.tsx`, `client/src/components/MessageRow.css`
- Создать: `client/src/components/__tests__/MessageRow.mobile.test.tsx`
- Изменить: `client/src/styles/__tests__/breakpoint-contract.test.ts`

**Интерфейсы:**
- Потребляет: `useLongPress` (`@/mobile/gestures/useLongPress`).
- Производит: новые необязательные пропсы `MessageRow`:
  `onLongPress?: () => void` — включает long-press на корне строки (класс `is-pressable`);
  `editActions?: boolean` — во встроенном редакторе показывать «Отмена / Сохранить» и
  НЕ отменять правку по blur. Без них DOM идентичен прежнему.

- [ ] **Шаг 1: тест (красный).** Образец событий — `mobile/gestures/__tests__/useLongPress.test.tsx`.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MessageRow } from '@/components/MessageRow';
import type { ChatMessage } from '@/stores/messageStore';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const msg: ChatMessage = { id: 'm1', channel_id: 'c1', user_id: 'u1', kind: 'user', content: 'text', created_at: 't', updated_at: 't' };
const base = () => ({
  msg, isOwn: true, isContinuation: false, displayName: 'anna', isEditing: false, highlighted: false, entered: false,
  members: [], canMentionEveryone: false,
  onStartEdit: vi.fn(), onCancelEdit: vi.fn(), onSaveEdit: vi.fn(async () => {}), onDelete: vi.fn(), onQuote: vi.fn(),
});
const row = (c: HTMLElement) => c.querySelector('.msg-row') as HTMLElement;
const touchDown = (el: HTMLElement) => fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 5, clientY: 5 });

describe('MessageRow long-press seam', () => {
  it('fires onLongPress after the hold and marks the row pressable', () => {
    const onLongPress = vi.fn();
    const { container } = render(<MessageRow {...base()} onLongPress={onLongPress} />);
    expect(row(container).classList.contains('is-pressable')).toBe(true);
    touchDown(row(container));
    act(() => { vi.advanceTimersByTime(460); });
    expect(onLongPress).toHaveBeenCalledOnce();
  });

  it('ignores a mouse hold', () => {
    const onLongPress = vi.fn();
    const { container } = render(<MessageRow {...base()} onLongPress={onLongPress} />);
    fireEvent.pointerDown(row(container), { pointerType: 'mouse', button: 0 });
    act(() => { vi.advanceTimersByTime(600); });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('is inert without the prop: no class, no handlers', () => {
    const { container } = render(<MessageRow {...base()} />);
    expect(row(container).classList.contains('is-pressable')).toBe(false);
  });

  it('is inert while the row is being edited', () => {
    const onLongPress = vi.fn();
    const { container } = render(<MessageRow {...base()} isEditing onLongPress={onLongPress} />);
    touchDown(row(container));
    act(() => { vi.advanceTimersByTime(600); });
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe('MessageRow editActions', () => {
  it('shows Cancel and Save, and blur does NOT cancel', () => {
    const p = base();
    const { container } = render(<MessageRow {...p} isEditing editActions />);
    const ta = container.querySelector('.msg-edit-input') as HTMLTextAreaElement;
    fireEvent.blur(ta);
    expect(p.onCancelEdit).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.msg-edit-actions button')).toHaveLength(2);
  });

  it('Save sends the trimmed wire text; Cancel cancels', () => {
    const p = base();
    const { container } = render(<MessageRow {...p} isEditing editActions />);
    const ta = container.querySelector('.msg-edit-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '  new text  ' } });
    const [cancel, save] = [...container.querySelectorAll('.msg-edit-actions button')];
    fireEvent.click(save);
    expect(p.onSaveEdit).toHaveBeenCalledWith('new text');
    fireEvent.click(cancel);
    expect(p.onCancelEdit).toHaveBeenCalledOnce();
  });

  it('without editActions the editor is exactly as before: blur cancels, no buttons', () => {
    const p = base();
    const { container } = render(<MessageRow {...p} isEditing />);
    fireEvent.blur(container.querySelector('.msg-edit-input')!);
    expect(p.onCancelEdit).toHaveBeenCalledOnce();
    expect(container.querySelector('.msg-edit-actions')).toBeNull();
  });
});
```

- [ ] **Шаг 2: прогон** → FAIL.

- [ ] **Шаг 3: `MessageRow.tsx`.**
  1. Импорт `useLongPress`; в `MessageRowProps` добавить с комментариями
     `onLongPress?: () => void;` («long-press на корне строки (мобильная шторка действий); мышь игнорируется»)
     и `editActions?: boolean;` («явные «Отмена / Сохранить» в редакторе, без отмены по blur —
     на тач-клавиатуре нет Escape, а blur съедает тап по кнопке»).
  2. В `MessageRow` (до `return`): `const longPress = useLongPress(() => props.onLongPress?.());`
     `const pressable = !!props.onLongPress && !isEditing;`
  3. В `rowClass` добавить `pressable ? 'is-pressable' : ''`.
  4. Корневой `<div data-message-id={msg.id} className={rowClass}>` →
     `<div data-message-id={msg.id} className={rowClass} {...(pressable ? longPress : undefined)}>`.
  5. `MessageEditor`: достать `editActions`, `onSaveEdit` уже есть; добавить `const t = useT();`
     (в файле уже импортирован); `onBlur={() => { if (!linkOpen && !editActions) onCancelEdit(); }}`;
     после `<FormattingToolbar … />` (перед `<MentionDropdown>`):
```tsx
      {editActions && (
        <div className="msg-edit-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancelEdit}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={() => void onSaveEdit(toWireMentions(value, members).trim())}>{t('common.save')}</button>
        </div>
      )}
```
     и получить `editActions` из пропсов в сигнатуре `MessageEditor`.

- [ ] **Шаг 4: `MessageRow.css`.**
  - Блок `@media (width <= 768px)` → `@media (width < 900px)`.
  - Блоки `@media (hover: none)` (reachability) и `@media (hover: none) and (width < 900px)`
    (стековая строка кнопок) **не трогать**: строки БЕЗ long-press (гостевой чат `/guest` до этапа 6,
    десктопный тач-экран) продолжают ими пользоваться. Скрываем панель только у строк, чьё
    действие уже переехало в long-press, и только там, где нет мыши (узкое окно с мышью сохраняет
    hover-поповер — мышь long-press игнорирует). Новый блок сразу после существующих:
```css
/* Строка с long-press (мобильная оболочка, спека §5.4): панель действий на таче
   заменена шторкой. «Отменить» неотправленного — в шторке, «повторить» — inline-кнопка
   `.msg-delivery.is-failed`. */
@media (hover: none) {
  .msg-row.is-pressable .msg-actions {
    display: none;
  }
}
```
  - Добавить:
```css
/* Строка с long-press: системное меню/выделение слова конфликтует с жестом
   (спека §4.4). Копирование — пунктом «Копировать текст» шторки. */
.msg-row.is-pressable {
  -webkit-touch-callout: none;
  user-select: none;
}

/* Мобильный редактор: явные кнопки под полем, тач-цели 44. */
.msg-edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}

.msg-edit-actions .btn {
  min-height: 44px;
}
```
  - `.msg-edit-input` на мобиле — `font-size: 16px` (в блоке `< 900px`; иначе iOS зумит).

- [ ] **Шаг 5: `breakpoint-contract.test.ts`** — убрать `'components/MessageRow.css'` из `LEGACY`.

- [ ] **Шаг 6: прогон** `npx vitest run src/components/__tests__/MessageRow.mobile.test.tsx src/components/__tests__/ChatArea.dom.test.tsx src/styles` → PASS
  (`ChatArea.dom` — паритет T1 не сломан).

- [ ] **Шаг 7: гейты** (tsc, stylelint, i18n, npm test).

---

### Task 5: шов `Composer` — мобильная раскладка, шторки, `enterSends`

**Файлы:**
- Создать: `client/src/components/ExpressionBody.tsx`
- Изменить: `client/src/components/ExpressionPicker.tsx`, `client/src/components/ExpressionPicker.css`
- Создать: `client/src/mobile/hooks/useFilePicker.tsx`
- Создать: `client/src/mobile/components/MobileAttachSheet.tsx`
- Создать: `client/src/mobile/components/MobileExpressionSheet.tsx`, `MobileExpressionSheet.css`
- Изменить: `client/src/components/Composer.tsx`, `client/src/components/Composer.css`
- Создать: `client/src/components/__tests__/Composer.mobile.test.tsx`
- Изменить: `client/src/i18n/locales/{ru,en}.ts`, `client/src/styles/__tests__/breakpoint-contract.test.ts`

**Интерфейсы:**
- Потребляет: `BottomSheet`, `ActionSheet`, `EmojiPanel`, `StickerPanel`.
- Производит:
  - `ExpressionBody(props: Pick<ExpressionPickerProps, 'tabs'|'initialTab'|'onSelectEmoji'|'stickers'>)`
    — вкладки и панели пикера; `ExpressionPicker` = `div.expression-picker[role=dialog]` + `ExpressionBody`;
  - `useFilePicker(onFiles: (f: FileList) => void): { open(accept: string): void; input: ReactNode }`;
  - `Composer` пропсы `variant?: 'desktop' | 'mobile'` (по умолчанию `'desktop'`),
    `enterSends?: boolean` (по умолчанию `true`).

- [ ] **Шаг 1: i18n** — `mobile.composerPlus` «Добавить» / «Add»; `attachMedia` «Фото и видео» / «Photos and videos»;
  `attachFile` «Файл» / «File»; `attachEmoji` «Эмодзи» / «Emoji»; `attachStickers` «Стикеры» / «Stickers».

- [ ] **Шаг 2: `ExpressionBody`** — перенести из `ExpressionPicker.tsx` в новый файл **всю**
  логику состояния (`useExpressionRecentsStore`, `pick`, `active`, эффект синхронизации
  `initialTab`, `select`, `label`) и разметку **внутри** корневого `div` (полоса вкладок +
  панели) БЕЗ изменений. `ExpressionPicker` остаётся с `useDismissOnOutside` и
  корневым `div`:

```tsx
export function ExpressionPicker({ onClose, ...body }: ExpressionPickerProps) {
  const ref = useDismissOnOutside<HTMLDivElement>(onClose);
  return (
    <div className="expression-picker" role="dialog" ref={ref}>
      <ExpressionBody {...body} />
    </div>
  );
}
```
  Комментарии-обоснования (про `lastTab`, `initialTab`, синхронизацию) переезжают с кодом.
  Проверка: `ExpressionPicker.dom.test.tsx` (T1) и `ExpressionPicker.test.tsx` — PASS без правок.

- [ ] **Шаг 3: `useFilePicker`.**

```tsx
import { useRef, type ReactNode } from 'react';

/** Скрытый input, ЖИВУЩИЙ в композере: ActionSheet размонтируется сразу после тапа,
 *  а диалог выбора файла отвечает позже — input внутри шторки терял бы change.
 *  `accept` без `capture`: система сама предлагает камеру / галерею / файлы. */
export function useFilePicker(onFiles: (files: FileList) => void): { open(accept: string): void; input: ReactNode } {
  const ref = useRef<HTMLInputElement>(null);
  return {
    open(accept) {
      const el = ref.current;
      if (!el) return;
      el.accept = accept;
      el.value = '';
      el.click();
    },
    input: (
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        className="composer-attach-input"
        onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); }}
      />
    ),
  };
}
```

- [ ] **Шаг 4: шторки.**

```tsx
// MobileAttachSheet.tsx
import { Image, File as FileIcon, Smile, Sticker } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { useT } from '@/i18n';

interface Props {
  onClose: () => void;
  onPickFiles: (accept: string) => void;
  onEmoji: () => void;
  /** undefined — стикеров нет (гость / нет обработчика). */
  onStickers?: () => void;
  /** Гость звонка: только текст и эмодзи. */
  textOnly: boolean;
}

export function MobileAttachSheet({ onClose, onPickFiles, onEmoji, onStickers, textOnly }: Props) {
  const t = useT();
  const ic = (I: typeof Image) => <I size={20} strokeWidth={1.8} />;
  const items: ContextMenuItem[] = [];
  if (!textOnly) {
    items.push({ label: t('mobile.attachMedia'), icon: ic(Image), onClick: () => onPickFiles('image/*,video/*') });
    items.push({ label: t('mobile.attachFile'), icon: ic(FileIcon), onClick: () => onPickFiles('') });
  }
  items.push({ label: t('mobile.attachEmoji'), icon: ic(Smile), onClick: onEmoji });
  if (!textOnly && onStickers) items.push({ label: t('mobile.attachStickers'), icon: ic(Sticker), onClick: onStickers });
  return <ActionSheet open onClose={onClose} title={t('mobile.composerPlus')} items={items} />;
}
```
```tsx
// MobileExpressionSheet.tsx
import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { ExpressionBody } from '@/components/ExpressionBody';
import type { ExpressionPickerProps } from '@/components/ExpressionPicker';
import { useT } from '@/i18n';
import './MobileExpressionSheet.css';

export function MobileExpressionSheet({ onClose, ...body }: ExpressionPickerProps) {
  const t = useT();
  return (
    <BottomSheet open onClose={onClose} title={t('mobile.attachEmoji')}>
      <div className="expression-sheet-body">
        <ExpressionBody {...body} />
      </div>
    </BottomSheet>
  );
}
```
  `MobileExpressionSheet.css`: `.expression-sheet-body` повторяет для потомков то, что им даёт
  `.expression-picker` (прочитать `ExpressionPicker.css` строки 1–130: flex-колонка, скролл
  `.expression-picker-body`, привязка размеров): `display:flex; flex-direction:column;
  height: min(60dvh, 420px); min-height: 0;` + переопределения внутренних размеров, если
  они привязаны к `.expression-picker` (селекторы вида `.expression-picker .x` оценить: при
  необходимости дописать зеркальные `.expression-sheet-body .x`, **не меняя** существующие).
  Стикеры `expression-sticker-grid` — плитки ≥ 44.

- [ ] **Шаг 5: тест `Composer.mobile.test.tsx` (красный).** Мок `@/services/api`
  (нужен только `apiService` для загрузок — не вызывается), `MemoryRouter`-обёртка (шторки
  зовут `useBackDismiss`), `IntersectionObserver` не нужен.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Composer } from '@/components/Composer';

afterEach(cleanup);

const channel = { id: 'c1', name: 'general', server_id: 's1' };
const mount = (over: Record<string, unknown> = {}) => {
  const onSend = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
      <Composer channel={channel} members={[]} canMentionEveryone={false} onSend={onSend}
        serverStickers={[]} onSendSticker={vi.fn(async () => true)} variant="mobile" {...over} />
    </MemoryRouter>,
  );
  return { ...utils, onSend, field: utils.container.querySelector('.composer-input') as HTMLTextAreaElement };
};
const send = (c: HTMLElement) => c.querySelector('.composer-send');

describe('Composer mobile variant', () => {
  it('has a plus button and none of the desktop emoji/attach buttons', () => {
    const { container } = mount();
    expect(container.querySelector('.composer-plus-btn')).not.toBeNull();
    expect(container.querySelector('.composer-attach-btn')).toBeNull();
    expect(container.querySelectorAll('.composer-icon-btn')).toHaveLength(1); // только «＋»
  });

  it('shows Send only when there is something to send', () => {
    const { container, field } = mount();
    expect(send(container)).toBeNull();
    fireEvent.change(field, { target: { value: 'hi' } });
    expect(send(container)).not.toBeNull();
    fireEvent.change(field, { target: { value: '   ' } });
    expect(send(container)).toBeNull();
  });

  it('Enter sends by default and inserts a newline when enterSends is false', () => {
    const a = mount();
    fireEvent.change(a.field, { target: { value: 'hi' } });
    fireEvent.keyDown(a.field, { key: 'Enter' });
    expect(a.onSend).toHaveBeenCalledWith('hi', undefined);
    cleanup();
    const b = mount({ enterSends: false });
    fireEvent.change(b.field, { target: { value: 'hi' } });
    fireEvent.keyDown(b.field, { key: 'Enter' });
    expect(b.onSend).not.toHaveBeenCalled();
  });

  it('plus opens the sheet with four actions; Stickers opens the sheet on the stickers tab', () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.composer-plus-btn')!);
    expect(document.querySelectorAll('.sheet .action-sheet-item')).toHaveLength(4);
    fireEvent.click(document.querySelectorAll('.sheet .action-sheet-item')[3]);
    // ActionSheet закрывается в микрозадаче; ждём шторку стикеров
    return screen.findByRole('tab', { selected: true }).then((tab) => {
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(document.querySelector('.expression-sheet-body')).not.toBeNull();
    });
  });

  it('the file input lives in the composer and outlives the sheet', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { container } = mount();
    fireEvent.click(container.querySelector('.composer-plus-btn')!);
    fireEvent.click(document.querySelectorAll('.sheet .action-sheet-item')[1]); // «Файл»
    expect(click).toHaveBeenCalledOnce();
    expect(container.querySelector('.composer-attach-input')).not.toBeNull();
    click.mockRestore();
  });

  it('textOnly (guest): the sheet offers only emoji', () => {
    const { container } = mount({ textOnly: true });
    fireEvent.click(container.querySelector('.composer-plus-btn')!);
    expect(document.querySelectorAll('.sheet .action-sheet-item')).toHaveLength(1);
  });
});
```
  Подогнать ожидаемые числа/селекторы под реальный DOM (тест — спецификация поведения,
  не снимок вёрстки).

- [ ] **Шаг 6: прогон** → FAIL.

- [ ] **Шаг 7: `Composer.tsx`.**
  1. Импорты: `Plus` из lucide, `MobileAttachSheet`, `MobileExpressionSheet`, `useFilePicker`.
  2. Пропсы: `variant?: 'desktop' | 'mobile'; enterSends?: boolean;` (JSDoc: «мобильная
     раскладка кнопок: только раскладка, логика та же»; «мобайл: `!coarsePointer`»).
     В деструктуризации: `variant = 'desktop', enterSends = true`.
  3. `const mobile = variant === 'mobile';`
     `const [pickerTab, setPickerTab] = useState<'emoji' | 'stickers'>('emoji');`
     `const filePicker = useFilePicker((files) => uploads.addFiles(files));`
     `const canSend = !!input.trim() || readyAttachments.length > 0;`
  4. `handleKeyDown`: `if (enterSends && e.key === 'Enter' && !e.shiftKey)`.
  5. Форма (порядок узлов десктопа сохранить буквально):
```tsx
      <form className="composer-field" onSubmit={handleSubmit}>
        {mobile && (
          <button
            type="button"
            className="composer-icon-btn composer-plus-btn"
            aria-label={t('mobile.composerPlus')}
            onClick={() => setAttachOpen(true)}
          >
            <Plus size={22} strokeWidth={1.8} />
          </button>
        )}
        <textarea … без изменений … />
        <button … Aa … без изменений />
        {!mobile && ( …кнопка эмодзи, как была… )}
        {!mobile && !textOnly && ( …<AttachmentButton …/> как был… )}
        {(!mobile || canSend) && ( …кнопка отправки, как была… )}
        {mobile && filePicker.input}
        <MentionDropdown mention={mention} />
      </form>
```
  6. Пикер и шторки (вместо текущего блока `pickerOpen && <ExpressionPicker …/>`):
```tsx
      {pickerOpen && (() => {
        const stickerProps = textOnly || !onSendSticker ? undefined : { …как было… };
        const shared = {
          tabs: textOnly || !onSendSticker ? (['emoji'] as const) : (['emoji', 'stickers'] as const),
          initialTab: mobile ? pickerTab : ('emoji' as const),
          onClose: () => setPickerOpen(false),
          onSelectEmoji: (emoji: string) => insertAtCaret(target, emoji),
          stickers: stickerProps,
        };
        return mobile ? <MobileExpressionSheet {...shared} /> : <ExpressionPicker {...shared} />;
      })()}
      {mobile && attachOpen && (
        <MobileAttachSheet
          textOnly={textOnly}
          onClose={() => setAttachOpen(false)}
          onPickFiles={(accept) => filePicker.open(accept)}
          onEmoji={() => { setPickerTab('emoji'); setPickerOpen(true); }}
          onStickers={onSendSticker ? () => { setPickerTab('stickers'); setPickerOpen(true); } : undefined}
        />
      )}
```
     Тип `tabs` привести к `ExpressionTab[]` как сейчас (`['emoji','stickers']` литерал было).
     Логику `stickers.onSend` / `onManage` перенести как есть. **Проверить**: `ActionSheet`
     зовёт `onClose()` ДО `onClick` → `setAttachOpen(false)` и следом `setPickerOpen(true)`:
     порядок безопасен (разные флаги).

- [ ] **Шаг 8: `Composer.css`.**
  - Блок `@media (width <= 768px)` → `@media (width < 900px)`.
  - Внутри: `.composer-input { font-size: 16px; max-height: calc(6 * 1.55em + 10px); }`
    (автогроу до 6 строк, спека §5.4: `line-height 1.55`, вертикальный padding 5+5);
    `.composer-plus-btn`: без своих размеров — берёт `.composer-icon-btn` (40×40 в блоке;
    поднять до 44×44 для `.composer-plus-btn, .composer-aa, .composer-icon-btn`).
  - `.mention-dropdown` внутри композера на мобиле — во всю ширину поля:
    `.composer-field .mention-dropdown { left: 0; right: 0; min-width: 0; max-height: 40dvh; }`
    (проверить, что перекрытие `MentionDropdown.css` выигрывает специфичностью (0,2,0)).
  - `.composer-root .fmt-toolbar` на мобиле: горизонтальный скролл без переноса, кнопки ≥ 44.

- [ ] **Шаг 9: `breakpoint-contract.test.ts`** — убрать `components/Composer.css` из `LEGACY`.

- [ ] **Шаг 10: прогон** `npx vitest run src/components/__tests__ src/styles` → PASS
  (снимки T1 — `ExpressionPicker.dom`, `ChatArea.dom` (эмодзи-пикер) зелёные).

- [ ] **Шаг 11: гейты.**

---

### Task 6: шов `ChatArea`

**Файлы:**
- Изменить: `client/src/components/ChatArea.tsx`, `ChatArea.css`, `MessageSearch.tsx`, `MessageSearch.css`, `VoiceBanner.css`
- Создать: `client/src/mobile/sheets/BackDismissGate.tsx`
- Создать: `client/src/mobile/components/MobileMessageSearch.tsx`, `MobileMessageSearch.css`
- Создать: `client/src/components/__tests__/ChatArea.seams.test.tsx`
- Изменить: `client/src/styles/__tests__/breakpoint-contract.test.ts`

**Интерфейсы:**
- Потребляет: `MessageActionsSheet` (T3), `MessageRow` `onLongPress`/`editActions` (T4),
  `Composer` `variant`/`enterSends` (T5), `useBackDismiss`.
- Производит: новые необязательные пропсы `ChatArea`:
```ts
export interface ChatHeaderApi { openSearch(): void }
header?: ReactNode | ((api: ChatHeaderApi) => ReactNode);   // есть → вместо .chat-header
searchMode?: 'inline' | 'screen';                            // 'screen' — MobileMessageSearch
messageActions?: 'hover' | 'sheet';                          // 'sheet' — long-press → шторка
composerVariant?: 'desktop' | 'mobile';
enterSends?: boolean;
historyOverlays?: boolean;   // лайтбокс закрывается системным «назад» (BackDismissGate)
active?: boolean;            // false — команды палитры не обрабатываются (D9), по умолчанию true
```
  и `MessageSearchProps` (экспорт из `MessageSearch.tsx`).

- [ ] **Шаг 1: тест `ChatArea.seams.test.tsx` (красный).** Те же моки и `chatHarness`, что в T1.

```tsx
// @vitest-environment jsdom
// Шапка файла как у ChatArea.dom.test.tsx: те же vi.mock('@/services/api' | '@/services/websocket'),
// beforeAll(stubBrowser), beforeEach с сидированием сторов. Дополнительно импортировать:
//   waitFor, screen из '@testing-library/react'; usePaletteStore из '@/stores/paletteStore';
//   apiService из '@/services/api'; DELETE_TITLE = 'Удалить сообщение?' (константа).
const tree = (p: Partial<React.ComponentProps<typeof ChatArea>> = {}) => (
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ChatArea channel={channel} user={me} {...p} />
  </MemoryRouter>
);
const mount = (p: Partial<React.ComponentProps<typeof ChatArea>> = {}) => render(tree(p));
const searchHeader = ({ openSearch }: { openSearch(): void }) => (
  <button type="button" className="probe-header" onClick={openSearch}>hdr</button>
);

describe('ChatArea seams', () => {
  it('a custom header replaces .chat-header; a function header gets openSearch', async () => {
    const { container } = mount({ header: searchHeader, searchMode: 'screen' });
    expect(container.querySelector('.chat-header')).toBeNull();
    fireEvent.click(container.querySelector('.probe-header')!);
    await act(async () => {});
    expect(container.querySelector('.chat-search-layer .message-search')).not.toBeNull();
  });

  it('without header the built-in one is rendered (desktop)', () => {
    expect(mount().container.querySelector('.chat-header')).not.toBeNull();
  });

  it('screen search closes when a result is chosen and the jump runs', async () => {
    vi.useRealTimers(); // debounce поиска — реальные 300 мс
    vi.mocked(apiService.searchMessages).mockResolvedValueOnce({
      results: [{ id: 'm1', username: 'boris', content: 'hello', created_at: '2026-09-20T09:05:00Z' }], total: 1,
    } as never);
    const { container } = mount({ header: searchHeader, searchMode: 'screen' });
    fireEvent.click(container.querySelector('.probe-header')!);
    fireEvent.change(container.querySelector('.message-search-field')!, { target: { value: 'hello' } });
    const result = await waitFor(() => {
      const el = container.querySelector('.message-search-result');
      if (!el) throw new Error('no result yet');
      return el;
    }, { timeout: 2000 });
    fireEvent.click(result);
    await waitFor(() => expect(apiService.getMessagesAround).toHaveBeenCalledWith('c1', 'm1'));
    expect(container.querySelector('.chat-search-layer')).toBeNull();
  });

  it('messageActions="sheet": long-press on a message opens the sheet; Delete opens the confirm', async () => {
    vi.useRealTimers(); // long-press 450 мс — реальные таймеры + waitFor
    const { container } = mount({ messageActions: 'sheet' });
    const row = container.querySelector('.msg-row.is-own:not(.is-failed)') as HTMLElement;
    fireEvent.pointerDown(row, { pointerType: 'touch', button: 0, clientX: 3, clientY: 3 });
    await screen.findByRole('dialog', {}, { timeout: 1500 });
    const del = [...document.querySelectorAll('.sheet .action-sheet-item')].pop()!;
    fireEvent.click(del);
    expect(await screen.findByText(DELETE_TITLE)).toBeTruthy(); // ConfirmModal
  });

  it('hover mode (default): rows have no long-press class', () => {
    expect(mount().container.querySelector('.msg-row.is-pressable')).toBeNull();
  });

  it('active={false}: a palette command is left untouched until the chat is active', async () => {
    const view = mount({ active: false, searchMode: 'screen' });
    act(() => usePaletteStore.getState().searchInChannel('c1', 'q'));
    expect(usePaletteStore.getState().command).not.toBeNull();
    expect(view.container.querySelector('.message-search')).toBeNull();
    view.rerender(tree({ active: true, searchMode: 'screen' }));
    await waitFor(() => expect(view.container.querySelector('.message-search')).not.toBeNull());
    expect(usePaletteStore.getState().command).toBeNull();
  });
});
```
  Селекторы и числа подогнать под реальный DOM прогоном — тесты задают поведение, а не разметку.

- [ ] **Шаг 2: прогон** → FAIL.

- [ ] **Шаг 3: `MessageSearch.tsx`** — `interface MessageSearchProps` → `export interface MessageSearchProps`. Больше ничего.

- [ ] **Шаг 4: `BackDismissGate.tsx`, `MobileMessageSearch.tsx/.css`.**

```tsx
// BackDismissGate.tsx
import { useBackDismiss } from './useBackDismiss';

/** `useBackDismiss` для оверлеев общих компонентов, которые не могут сами звать
 *  хук роутера (десктопные тесты и вёрстка идут без Router). */
export function BackDismissGate({ open, onClose }: { open: boolean; onClose: () => void }) {
  useBackDismiss(open, onClose);
  return null;
}
```
```tsx
// MobileMessageSearch.tsx
import { MessageSearch, type MessageSearchProps } from '@/components/MessageSearch';
import { useBackDismiss } from '@/mobile/sheets/useBackDismiss';
import './MobileMessageSearch.css';

/** Спека §5.4: поиск по каналу — во весь экран поверх ленты; системное «назад»
 *  закрывает его (запись в истории), а не уводит из чата. */
export function MobileMessageSearch(props: MessageSearchProps) {
  useBackDismiss(true, props.onClose);
  return (
    <div className="chat-search-layer">
      <MessageSearch {...props} />
    </div>
  );
}
```
```css
/* MobileMessageSearch.css — рендерится только на мобиле, @media не нужен. */
.chat-search-layer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
}

/* Слой идёт в DOM ПОСЛЕ композера и кнопки «к последним» — рисуется поверх них
   порядком DOM (позиционированные элементы без z-index). Кнопка «к последним»
   стоит позже слоя и иначе торчала бы поверх результатов. */
.chat-search-layer ~ .chat-jump-btn {
  display: none;
}

/* Панель поиска — не боковая колонка, а весь слой. (0,2,0) > базовый (0,1,0). */
.chat-search-layer > .message-search {
  position: static;
  flex: 1;
  width: 100%;
  max-width: none;
  min-height: 0;
  border-left: none;
}
```
  Прочитать базовый `.message-search` в `MessageSearch.css` и переопределить **всё**, что
  делает его боковой панелью (`position`, `right`, `width`, границы).

- [ ] **Шаг 5: `ChatArea.tsx`.**
  1. Импорты: `MessageActionsSheet`, `MobileMessageSearch`, `BackDismissGate`, `type MessageSearchProps` не нужен.
  2. Пропсы (интерфейс `ChatAreaProps`) — добавить семь из «Интерфейсов» с JSDoc; в сигнатуре
     деструктурировать: `header, searchMode = 'inline', messageActions = 'hover', composerVariant = 'desktop', enterSends = true, historyOverlays = false, active = true`.
  3. Хелперы: `const openSearch = () => { setSearchSeed(null); setSearchOpen(true); };`
     `const closeSearch = () => { setSearchOpen(false); setSearchSeed(null); };`
     (кнопка поиска десктопного header остаётся со СВОЕЙ логикой тумблера — не менять).
  4. Эффект команд палитры: `if (!cmd) return;` → `if (!cmd || !active) return;` и `active`
     в deps.
  5. Шапка: обернуть существующий блок `<div className="chat-header">…</div>` (в ветке с
     каналом) в `{header === undefined && ( … )}`, ниже:
     `{header !== undefined && (typeof header === 'function' ? header({ openSearch }) : header)}`.
     Содержимое блока и порядок соседей (`VoiceBanner`, `.chat-messages`, …) — как есть.
  6. Ряд сообщения — в `<MessageRow …/>` добавить:
```tsx
                    onLongPress={messageActions === 'sheet' && msg.deliveryState !== 'sending' ? () => setActionsMsg(msg) : undefined}
                    editActions={messageActions === 'sheet'}
```
  7. Состояние `const [actionsMsg, setActionsMsg] = useState<ChatMessage | null>(null);` +
     сброс в эффекте смены канала (`setActionsMsg(null)`).
  8. Композер: `variant={composerVariant}` `enterSends={enterSends}`.
  9. Поиск (вместо текущего блока `{searchOpen && (<MessageSearch …/>)}`):
```tsx
      {searchOpen && (searchMode === 'screen' ? (
        <MobileMessageSearch
          key={searchSeed?.id ?? 0}
          channel={channel}
          initialQuery={searchSeed?.query}
          // Экран поиска закрывает весь чат: после выбора результата слой убираем,
          // иначе прокрутка к сообщению происходила бы под ним.
          onJumpToMessage={(id) => { closeSearch(); void jumpToMessage(id); }}
          onClose={closeSearch}
        />
      ) : (
        <MessageSearch … как было … />
      ))}
```
  10. Лайтбокс: внутрь `{lightbox && ( <> … </> )}`:
      `{historyOverlays && <BackDismissGate open onClose={() => setLightbox(null)} />}` перед
      `<MediaLightbox …/>` (десктоп: `historyOverlays=false` → узлов нет).
  11. После `ConfirmModal`:
```tsx
      {messageActions === 'sheet' && (
        <MessageActionsSheet
          msg={actionsMsg}
          isOwn={actionsMsg?.user_id === user?.id}
          members={members}
          onClose={() => setActionsMsg(null)}
          onQuote={(m) => insertQuoteIntoCompose(m.content)}
          onEdit={(m) => setEditingId(m.id)}
          onDelete={(m) => setConfirmDeleteId(m.id)}
          onRetry={(m) => retrySend(m)}
          onDiscard={(m) => removeMessage(m.id)}
        />
      )}
```
      (тот же контракт колбэков, что у hover-кнопок ряда).

- [ ] **Шаг 6: CSS.**
  - `ChatArea.css`: блок `@media (width <= 768px)` → `@media (width < 900px)`; в нём добавить
    `.chat-messages { overscroll-behavior: contain; }` (спека §5.4).
  - `MessageSearch.css`, `VoiceBanner.css`: `@media (width <= 768px)` → `@media (width < 900px)`.
    В блоке `MessageSearch` для мобилы: `.message-search-field { font-size: 16px; }`,
    `.message-search-close, .message-search-clear { width: 44px; height: 44px; }`,
    `.message-search-result { min-height: 64px; }`.
  - `breakpoint-contract.test.ts`: убрать `components/ChatArea.css`, `MessageSearch.css`, `VoiceBanner.css` из `LEGACY`.

- [ ] **Шаг 7: прогон** `npx vitest run src/components/__tests__ src/styles` → PASS.
  `ChatArea.dom` (T1) — **зелёный без правки снимков** — главный критерий задачи.

- [ ] **Шаг 8: гейты.**

---

### Task 7: экран `chat`

**Файлы:**
- Создать: `client/src/mobile/screens/ChatScreen.tsx`, `ChatScreen.css`
- Изменить: `client/src/mobile/screens/renderScreen.tsx`
- Создать: `client/src/mobile/screens/__tests__/ChatScreen.test.tsx`
- Изменить: `client/src/i18n/locales/{ru,en}.ts`

**Интерфейсы:**
- Потребляет: `ChatArea` швы (T6), `ScreenHeader`, `useCoarsePointer` (T2), `ScreenCtx`.
- Производит: `ChatScreen({ channelId, ctx })`.

- [ ] **Шаг 1: i18n** — `mobile.chatSubtitleCall`: «{{server}} · в звонке: {{count}}» /
  «{{server}} · in call: {{count}}»; `mobile.chatSubtitleMembers` не нужен: использовать
  `tp('call.participants', n)` как десктоп (`{{server}} · ` собрать в коде).

- [ ] **Шаг 2: тест `ChatScreen.test.tsx` (красный).**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatScreen } from '@/mobile/screens/ChatScreen';
import type { AppController } from '@/pages/app/useAppController';
import { useMessageStore } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { messages, stubBrowser } from '@/components/__tests__/chatHarness';
import { controller, nav, ch, s1 } from './fixtures';

// vi.mock('@/services/api' …) и vi.mock('@/services/websocket' …) — дословно как в ChatArea.dom.test.tsx.

const JOIN = 'Подключиться';
const SHOW_CALL = 'Звонок';
const SEARCH = 'Поиск сообщений';
const BACK = 'Назад';
const IN_CALL = 'в звонке';

beforeAll(stubBrowser);
beforeEach(() => {
  useMessageStore.setState({ messages: messages(), loading: false });
  useServerStore.setState({ currentServer: s1, servers: [s1], serversLoaded: true, members: [], channels: [ch], permissions: new Map() });
  useCallStore.setState({ callChannelId: null });
});
afterEach(cleanup);

const byLabel = (label: string) =>
  [...document.querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === label) as HTMLElement;

const stack = [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c1' }] as const;

function mount(over: Partial<AppController> = {}) {
  const c = controller({ currentChannel: ch, ...over });
  const n = { ...nav(), stack, top: stack[2] } as ReturnType<typeof nav>;
  const joinVoice = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: stack, b: 2 } }]}>
      <ChatScreen channelId="c1" ctx={{ c, nav: n, joinVoice }} />
    </MemoryRouter>,
  );
  return { ...utils, n, joinVoice };
}

describe('ChatScreen', () => {
  it('waits while the store still points at another channel', () => {
    mount({ currentChannel: null });
    expect(document.querySelector('.mobile-screen-loading')).not.toBeNull();
    expect(document.querySelector('.chat-area')).toBeNull();
  });

  it('renders the screen header instead of the desktop one', () => {
    mount();
    expect(document.querySelector('.screen-header-name')?.textContent).toBe(`#${ch.name}`);
    expect(document.querySelector('.screen-header-sub')?.textContent).toContain(s1.name);
    expect(document.querySelector('.chat-header')).toBeNull();
  });

  it('subtitle counts people in the call only when somebody is in it', () => {
    mount({ voiceParticipants: new Map([['c1', ['u2', 'u3']]]) });
    expect(document.querySelector('.screen-header-sub')?.textContent).toContain(IN_CALL);
  });

  it('tapping the title opens channel info; the back button goes back', () => {
    const { n } = mount();
    fireEvent.click(document.querySelector('.screen-header-title.is-tappable')!);
    expect(n.push).toHaveBeenCalledWith({ kind: 'channelInfo', channelId: 'c1' });
    fireEvent.click(byLabel(BACK));
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('the call button joins when not in the call and opens the call screen when in it', () => {
    const a = mount();
    fireEvent.click(byLabel(JOIN));
    expect(a.joinVoice).toHaveBeenCalledWith(ch);
    cleanup();
    useCallStore.setState({ callChannelId: 'c1' });
    const b = mount();
    fireEvent.click(byLabel(SHOW_CALL));
    expect(b.n.push).toHaveBeenCalledWith({ kind: 'call' });
  });

  it('the search button opens the full-screen search layer', async () => {
    mount();
    fireEvent.click(byLabel(SEARCH));
    await act(async () => {});
    expect(document.querySelector('.chat-search-layer .message-search')).not.toBeNull();
  });

  it('uses the mobile composer', () => {
    mount();
    expect(document.querySelector('.composer-plus-btn')).not.toBeNull();
    expect(document.querySelector('.composer-attach-btn')).toBeNull();
  });
});
```

- [ ] **Шаг 3: реализация.**

```tsx
// client/src/mobile/screens/ChatScreen.tsx
import { Headphones, Search } from 'lucide-react';
import { ChatArea } from '@/components/ChatArea';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { useCoarsePointer } from '@/mobile/pointer';
import { useCallStore } from '@/stores/callStore';
import { useT, useTp } from '@/i18n';
import type { ScreenCtx } from './types';
import './ChatScreen.css';

/** Экран `chat` (спека §5.4): ChatArea в мобильной раскладке. */
export function ChatScreen({ channelId, ctx }: { channelId: string; ctx: ScreenCtx }) {
  const { c, nav, joinVoice } = ctx;
  const t = useT();
  const tp = useTp();
  const coarse = useCoarsePointer();
  const callChannelId = useCallStore((s) => s.callChannelId);
  const channel = c.currentChannel?.id === channelId ? c.currentChannel : null;
  if (!channel) return <div className="mobile-screen-loading" />;

  const inThisCall = callChannelId === channelId;
  const inCall = c.voiceParticipants.get(channelId)?.length ?? 0;
  const serverName = c.currentServer?.name ?? '';
  const subtitle = inCall > 0
    ? t('mobile.chatSubtitleCall', { server: serverName, count: String(inCall) })
    : `${serverName} · ${tp('call.participants', c.members.length)}`;
  // Чат — верхний экран стека: только тогда он принимает команды палитры (D9).
  const active = nav.top.kind === 'chat' && nav.top.channelId === channelId;

  return (
    <ChatArea
      channel={channel}
      user={c.user}
      active={active}
      header={({ openSearch }) => (
        <ScreenHeader
          title={`#${channel.name}`}
          subtitle={subtitle}
          onBack={nav.back}
          onTitleClick={() => nav.push({ kind: 'channelInfo', channelId })}
          actions={
            <>
              <button
                type="button"
                className={`screen-header-btn${inThisCall ? ' is-in-call' : ''}`}
                aria-label={inThisCall ? t('call.showCall') : t('call.joinVoice')}
                onClick={() => (inThisCall ? nav.push({ kind: 'call' }) : joinVoice(channel))}
              >
                <Headphones size={22} strokeWidth={1.8} />
              </button>
              <button type="button" className="screen-header-btn" aria-label={t('chat.searchMessages')} onClick={openSearch}>
                <Search size={22} strokeWidth={1.8} />
              </button>
            </>
          }
        />
      )}
      searchMode="screen"
      messageActions="sheet"
      composerVariant="mobile"
      enterSends={!coarse}
      historyOverlays
      onJoinVoice={joinVoice}
      onShowCall={inThisCall ? () => nav.push({ kind: 'call' }) : undefined}
      onCreateServer={() => nav.push({ kind: 'createServer' })}
      onFindServer={() => nav.push({ kind: 'findServer' })}
      voiceParticipants={c.voiceParticipants}
    />
  );
}
```
  `ChatScreen.css`: `.screen-header-btn.is-in-call { color: var(--accent-text); background: var(--accent-soft); }`.
  Убедиться, что `useTp` возвращает строку для `call.participants` (как в ChatArea).

- [ ] **Шаг 4: `renderScreen.tsx`** — удалить локальную `ChatScreen`, импортировать новую;
  убрать ставшие ненужными импорты (`ChatArea`, `useCallStore`, если больше не нужны для `CallScreen` — он их
  использует, оставить).

- [ ] **Шаг 5: прогон** `npx vitest run src/mobile` → PASS (обновить `renderScreen.test.tsx` /
  `MobileShell.*.test.tsx` только там, где они опирались на прежний `ChatScreen`: `onMobileBack`, `chat-members-btn`).

- [ ] **Шаг 6: гейты.**

---

### Task 8: лайтбокс и медиа на мобиле

**Файлы:**
- Создать: `client/src/mobile/gestures/lightboxSwipe.ts`, `useLightboxSwipe.ts`
- Создать: `client/src/mobile/gestures/__tests__/lightboxSwipe.test.ts`
- Изменить: `client/src/components/MediaLightbox.tsx`, `MediaLightbox.css`, `VideoPlayer.css`, `AudioPlayer.css`, `MessageAttachments.css`
- Создать: `client/src/components/__tests__/MediaLightbox.swipe.test.tsx`
- Изменить: `client/src/styles/__tests__/breakpoint-contract.test.ts`

**Интерфейсы:**
- Производит: `decideLightboxSwipe(i: { dx; dy; vx; vy; width; height }): 'prev' | 'next' | 'close' | null`;
  `useLightboxSwipe(cb: { onPrev(); onNext(); onClose() })` → `{ handlers, style }`.

- [ ] **Шаг 1: тест решения (красный).**

```ts
import { describe, it, expect } from 'vitest';
import { decideLightboxSwipe as d } from '@/mobile/gestures/lightboxSwipe';

const base = { vx: 0, vy: 0, width: 400, height: 800 };
describe('decideLightboxSwipe', () => {
  it('swipe left past 20% width → next; right → prev', () => {
    expect(d({ ...base, dx: -100, dy: 5 })).toBe('next');
    expect(d({ ...base, dx: 100, dy: 5 })).toBe('prev');
  });
  it('a fast short flick pages too, a slow short drag does not', () => {
    expect(d({ ...base, dx: -30, dy: 0, vx: -0.7 })).toBe('next');
    expect(d({ ...base, dx: -30, dy: 0, vx: -0.1 })).toBeNull();
  });
  it('swipe down past 25% height (or fast) → close; up never closes', () => {
    expect(d({ ...base, dx: 4, dy: 250 })).toBe('close');
    expect(d({ ...base, dx: 4, dy: 50, vy: 0.9 })).toBe('close');
    expect(d({ ...base, dx: 4, dy: -300 })).toBeNull();
  });
  it('the dominant axis wins', () => {
    expect(d({ ...base, dx: -120, dy: 200 })).toBe('close');
    expect(d({ ...base, dx: -200, dy: 120 })).toBe('next');
  });
  it('tiny movement is a tap, not a gesture', () => {
    expect(d({ ...base, dx: 6, dy: 4, vx: 1, vy: 1 })).toBeNull();
  });
});
```

- [ ] **Шаг 2: реализация решения.**

```ts
// client/src/mobile/gestures/lightboxSwipe.ts
export type LightboxSwipe = 'prev' | 'next' | 'close' | null;

const TAP_SLOP = 12;          // px — меньше это тап
const PAGE_FRACTION = 0.2;    // доля ширины
const CLOSE_FRACTION = 0.25;  // доля высоты
const FLICK_X = 0.5;          // px/мс
const FLICK_Y = 0.6;          // px/мс
const FLICK_MIN = 24;         // px — быстрый щелчок короче не считается

export function decideLightboxSwipe(i: { dx: number; dy: number; vx: number; vy: number; width: number; height: number }): LightboxSwipe {
  const ax = Math.abs(i.dx);
  const ay = Math.abs(i.dy);
  if (Math.max(ax, ay) < TAP_SLOP) return null;
  if (ay > ax) {
    if (i.dy <= 0) return null;
    return i.dy > i.height * CLOSE_FRACTION || (i.dy >= FLICK_MIN && i.vy > FLICK_Y) ? 'close' : null;
  }
  const passed = ax > i.width * PAGE_FRACTION || (ax >= FLICK_MIN && Math.abs(i.vx) > FLICK_X);
  if (!passed) return null;
  return i.dx < 0 ? 'next' : 'prev';
}
```
  (сверить с тестом: `dx:-120,dy:200` — вертикаль доминирует → close; `{dx:4,dy:50,vy:.9}` → 50≥24, vy>.6 → close.)

- [ ] **Шаг 3: хук `useLightboxSwipe.ts`.**

```ts
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { decideLightboxSwipe } from './lightboxSwipe';

/** Что жест не забирает: свои органы управления и ссылки. */
const IGNORE = 'button, a, input, [data-no-swipe]';

export function useLightboxSwipe(cb: { onPrev(): void; onNext(): void; onClose(): void }) {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const last = useRef({ x: 0, y: 0, t: 0, vx: 0, vy: 0 });
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest(IGNORE)) return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      last.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, vx: 0, vy: 0 };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s || e.pointerId !== s.id) return;
      const dt = e.timeStamp - last.current.t;
      if (dt > 0) last.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, vx: (e.clientX - last.current.x) / dt, vy: (e.clientY - last.current.y) / dt };
      setOffset({ dx: e.clientX - s.x, dy: e.clientY - s.y });
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const s = start.current;
      start.current = null;
      setOffset(null);
      if (!s) return;
      const decision = decideLightboxSwipe({
        dx: e.clientX - s.x, dy: e.clientY - s.y, vx: last.current.vx, vy: last.current.vy,
        width: window.innerWidth, height: window.innerHeight,
      });
      if (decision === 'next') cbRef.current.onNext();
      else if (decision === 'prev') cbRef.current.onPrev();
      else if (decision === 'close') cbRef.current.onClose();
    },
    onPointerCancel() { start.current = null; setOffset(null); },
  };

  // Экран следует за пальцем по доминирующей оси; в покое style нет (десктопный DOM прежний).
  let style: CSSProperties | undefined;
  if (offset) {
    const horizontal = Math.abs(offset.dx) >= Math.abs(offset.dy);
    style = { transform: horizontal ? `translateX(${offset.dx}px)` : `translateY(${Math.max(0, offset.dy)}px)`, transition: 'none' };
  }
  return { handlers, style };
}
```

- [ ] **Шаг 4: тест `MediaLightbox.swipe.test.tsx` (красный).** Три картинки, индекс 1;
  `pointerDown` (touch) → `pointerMove` → `pointerUp` на `.lightbox-content`: влево на 150px →
  `onIndexChange(2)`; вправо → `onIndexChange(0)`; вниз на 400px (`window.innerHeight` 768 → >25%)
  → `onClose`; жест, начатый на кнопке «скачать», игнорируется; мышиный pointer игнорируется;
  на крайних индексах свайп «за край» не зовёт `onIndexChange`.
  Позиции задавать `clientX/clientY` в `fireEvent.pointerX`. `timeStamp` — по умолчанию.
  Ошибка тестов jsdom с `setPointerCapture` — уже обработана `?.`.

- [ ] **Шаг 5: `MediaLightbox.tsx`.** Импорт `useLightboxSwipe`; после `useModalFocus`:
```tsx
  const swipe = useLightboxSwipe({
    onPrev: () => { if (index > 0) onIndexChange(index - 1); },
    onNext: () => { if (index < attachments.length - 1) onIndexChange(index + 1); },
    onClose,
  });
```
  на `<div className="lightbox-content" onClick={…}>` добавить `{...swipe.handlers} style={swipe.style}`.
  Прочих изменений в DOM нет. `MediaLightbox.dom.test.tsx` (T1) — зелёный.

- [ ] **Шаг 6: CSS.**
  - `MediaLightbox.css`: `@media (width <= 768px)` → `@media (width < 900px)`; внутри:
    `.lightbox-nav { width: 44px; height: 64px; }`, `.lightbox-close { width: 44px; height: 44px;
    top: calc(12px + env(safe-area-inset-top)); right: 12px; }`,
    `.lightbox-content { touch-action: none; }`, `.lightbox-bar { padding-bottom: calc(8px + env(safe-area-inset-bottom)); }`,
    `.lightbox-media { max-height: 100dvh; }` (альбомная ориентация 844×390 — картинка не вылезает);
    `.lightbox-download { min-height: 44px; }`.
  - `VideoPlayer.css`, `AudioPlayer.css`, `MessageAttachments.css`: блок(и) `<= 768px` → `< 900px`;
    у `.video-play-btn`, `.video-mute-btn` и кнопки play в `AudioPlayer` — расширение зоны
    нажатия до 44:
```css
@media (width < 900px) {
  .video-play-btn,
  .video-mute-btn {
    position: relative;
    width: 32px;
    height: 32px;
  }

  .video-play-btn::after,
  .video-mute-btn::after {
    content: '';
    position: absolute;
    inset: -6px;
  }
}
```
    (`.video-seek` / ползунок аудио — `min-height: 44px` области нажатия через
    `padding-block`/обёртку, если полоса не разъезжается; проверить на скриншоте T12.)
  - `breakpoint-contract.test.ts`: убрать `MediaLightbox.css`, `MessageAttachments.css`, `VideoPlayer.css`.

- [ ] **Шаг 7: прогон** `npx vitest run src/mobile/gestures src/components/__tests__ src/styles` → PASS.

- [ ] **Шаг 8: гейты.**

---

### Task 9: `channelInfo`

**Файлы:**
- Создать: `client/src/components/useMemberList.ts`
- Изменить: `client/src/components/UserList.tsx`, `UserList.css`
- Создать: `client/src/mobile/screens/ChannelInfoScreen.tsx`, `ChannelInfoScreen.css`
- Изменить: `client/src/mobile/screens/renderScreen.tsx`
- Создать: `client/src/mobile/screens/__tests__/ChannelInfoScreen.test.tsx`
- Изменить: `client/src/i18n/locales/{ru,en}.ts`, `client/src/styles/__tests__/breakpoint-contract.test.ts`

**Интерфейсы:**
- Производит:
```ts
export function useMemberList(voiceParticipants?: Map<string, string[]>): {
  onlineMembers: MemberWithUser[];
  offlineMembers: MemberWithUser[];
  /** «в голосовом · канал» для онлайн-участника или null. */
  voiceNameFor(m: MemberWithUser, online: boolean): string | null;
  /** «был(а) …» для офлайн-участника или null (скрыто приватностью / не видели). */
  lastSeenFor(m: MemberWithUser, online: boolean): string | null;
};
export function ChannelInfoScreen({ channelId, ctx }: { channelId: string; ctx: ScreenCtx }): JSX.Element;
```

- [ ] **Шаг 1: i18n** — `mobile.channelInfo` «О канале» / «Channel info»; `mobile.infoCall` «Звонок» / «Call»;
  `mobile.infoSearch` «Поиск» / «Search»; `mobile.manageChannel` «Управление каналом» / «Manage channel»;
  `mobile.channelSection` «Канал» / «Channel».
  Остальное переиспользуется: `chat.members`, `server.online`/`offline`, `server.callUser`, `server.inVoice`,
  `mobile.inviteFriends`.

- [ ] **Шаг 2: вынос `useMemberList` из `UserList.tsx`.** Перенести в хук: `useOnlineIds()`,
  `useMemo` разбиения на онлайн/офлайн, `offlineUserIdsKey`, эффект загрузки last seen (с
  `chunkUserIds`), состояние `lastSeenById`, `locale`, `tp`, `voiceChannelNameFor`, обёртки
  `voiceNameFor` / `lastSeenFor`. Экспорты `chunkUserIds`, `lastSeenLabel` **остаются в
  `UserList.tsx`** (их импортирует `UserList.lastSeen.test.ts`), хук импортирует их оттуда — циклическая
  зависимость запрещена: перенести обе функции в `useMemberList.ts` и **ре-экспортировать** из
  `UserList.tsx` (`export { chunkUserIds, lastSeenLabel } from './useMemberList';`).
  `UserList` вызывает хук и рендерит ровно прежнюю разметку. Карточка приглашения и состояния
  `invite*` остаются в `UserList` (мобильный вход на «пригласить» — экран `invites`).
  Проверка: `UserList.dom.test.tsx` (T1) + `UserList.lastSeen.test.ts` — PASS без правок.

- [ ] **Шаг 3: `UserList.css`** — `@media (width <= 768px)` → `< 900px`; убрать из `LEGACY`.
  (Блок мобильной раскладки `UserList` становится мёртвым — `channelInfo` его не использует;
  удаление `.user-list-mobile-header` и `onMobileBack` — этап 7.)

- [ ] **Шаг 4: тест `ChannelInfoScreen.test.tsx` (красный).**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChannelInfoScreen } from '@/mobile/screens/ChannelInfoScreen';
import type { AppController } from '@/pages/app/useAppController';
import type { MemberWithUser, PermissionSet } from '@/types';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { callService } from '@/services/call';
import { controller, nav, ch, s1 } from './fixtures';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      getOnlineUsers: vi.fn(async () => [{ id: 'u2' }]),
      getLastSeenBatch: vi.fn(async () => ({})),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));
vi.mock('@/services/call', () => ({ callService: { startCall: vi.fn(async () => null) } }));

const boris = { user_id: 'u2', username: 'Борис' } as MemberWithUser;
const vera = { user_id: 'u3', username: 'Вера' } as MemberWithUser;
const perms = (bits: bigint, isOwner = false): PermissionSet => ({ isOwner, bits, highestPosition: 0 });

const HEADER = 'О канале';
const CALL = 'Звонок';
const SEARCH = 'Поиск';
const MANAGE = 'Управление каналом';
const INVITE = 'Пригласить друзей';
const EDIT = 'Редактировать';
const CALL_BORIS = 'Позвонить Борис';
const IN_VOICE = 'в голосовом · общий';

const stack = [
  { kind: 'servers' }, { kind: 'channels', serverId: 's1' },
  { kind: 'chat', channelId: 'c1' }, { kind: 'channelInfo', channelId: 'c1' },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  usePaletteStore.setState({ command: null });
  useCallStore.setState({ callChannelId: null });
  useServerStore.setState({
    members: [boris, vera], channels: [ch], currentServer: s1,
    permissions: new Map([['s1', perms(0n, true)]]),
  });
});
afterEach(cleanup);

function mount(over: Partial<AppController> = {}) {
  const c = controller({
    currentChannel: ch, members: [boris, vera], voiceParticipants: new Map([['c1', ['u2']]]), ...over,
  });
  const n = { ...nav(), stack, top: stack[3] } as ReturnType<typeof nav>;
  render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: stack, b: 3 } }]}>
      <ChannelInfoScreen channelId="c1" ctx={{ c, nav: n, joinVoice: vi.fn() }} />
    </MemoryRouter>,
  );
  return { c, n };
}
const text = () => document.body.textContent ?? '';
const rowByTitle = (title: string) =>
  [...document.querySelectorAll('.mobile-row')].find(
    (r) => r.querySelector('.mobile-row-title-text')?.textContent === title,
  ) as HTMLElement | undefined;
const actionByText = (label: string) =>
  [...document.querySelectorAll('.channel-info-action')].find((b) => b.textContent === label) as HTMLElement;
const noRights = () => {
  useServerStore.setState({ permissions: new Map([['s1', perms(0n)]]) });
  return { currentServer: { ...s1, owner_id: 'u9' } } as Partial<AppController>;
};

describe('ChannelInfoScreen', () => {
  it('header, hero and member sections; back goes back', async () => {
    const { n } = mount();
    expect(document.querySelector('.screen-header-name')?.textContent).toBe(HEADER);
    expect(document.querySelector('.channel-info-name')?.textContent).toBe(ch.name);
    expect(document.querySelector('.channel-info-server')?.textContent).toBe(s1.name);
    await waitFor(() => expect(document.querySelectorAll('.channel-info-category')).toHaveLength(2));
    expect(rowByTitle('Борис')).toBeTruthy();
    expect(rowByTitle('Вера')).toBeTruthy();
    fireEvent.click(document.querySelector('.screen-header-btn')!);
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('shows «в голосовом · канал» for an online member in the call', async () => {
    mount();
    await waitFor(() => expect(text()).toContain(IN_VOICE));
  });

  it('tapping an online member offers a call; offline members are inert', async () => {
    mount();
    await waitFor(() => expect(rowByTitle('Борис')).toBeTruthy());
    fireEvent.click(rowByTitle('Вера')!);
    expect(document.querySelector('.sheet')).toBeNull();
    fireEvent.click(rowByTitle('Борис')!);
    const item = [...document.querySelectorAll('.sheet .action-sheet-item')]
      .find((i) => i.textContent?.includes(CALL_BORIS))!;
    fireEvent.click(item);
    expect(callService.startCall).toHaveBeenCalledWith('u2');
  });

  it('«Звонок» joins and REPLACES the info screen with the call screen', () => {
    const { c, n } = mount();
    fireEvent.click(actionByText(CALL));
    expect(c.joinVoice).toHaveBeenCalledWith(ch);
    expect(n.replaceStack).toHaveBeenCalledWith([...stack.slice(0, -1), { kind: 'call' }]);
  });

  it('«Звонок» while already in this call does not join again', () => {
    useCallStore.setState({ callChannelId: 'c1' });
    const { c, n } = mount();
    fireEvent.click(actionByText(CALL));
    expect(c.joinVoice).not.toHaveBeenCalled();
    expect(n.replaceStack).toHaveBeenCalledOnce();
  });

  it('«Поиск» queues the chat-search command BEFORE going back', () => {
    const { n } = mount();
    n.back = vi.fn(() => {
      // К моменту возврата команда уже в сторе: чат подхватит её, став верхним экраном.
      expect(usePaletteStore.getState().command).toMatchObject({ kind: 'chat-search', channelId: 'c1' });
    });
    fireEvent.click(actionByText(SEARCH));
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('the invite row needs the right and leads to the invites screen', () => {
    const { n } = mount();
    fireEvent.click(rowByTitle(INVITE)!);
    expect(n.push).toHaveBeenCalledWith({ kind: 'invites', serverId: 's1' });
    cleanup();
    mount(noRights());
    expect(rowByTitle(INVITE)).toBeUndefined();
  });

  it('«Управление каналом» is gated by MANAGE_CHANNELS and opens the channel menu', () => {
    mount();
    fireEvent.click(rowByTitle(MANAGE)!);
    expect([...document.querySelectorAll('.sheet .action-sheet-item')].some((i) => i.textContent?.includes(EDIT))).toBe(true);
    cleanup();
    mount(noRights());
    expect(rowByTitle(MANAGE)).toBeUndefined();
  });
});
```

- [ ] **Шаг 5: реализация `ChannelInfoScreen.tsx`.**

```tsx
import { useState } from 'react';
import { Hash, Headphones, Search, UserPlus, Settings2 } from 'lucide-react';
import type { MemberWithUser } from '@/types';
import { Avatar } from '@/components/Avatar';
import { useMemberList } from '@/components/useMemberList';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { ChannelMenuSheet } from '@/mobile/menus/ChannelMenuSheet';
import { useServerStore } from '@/stores/serverStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { useCallStore } from '@/stores/callStore';
import { callService } from '@/services/call';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';
import type { ScreenCtx } from './types';
import './ChannelInfoScreen.css';

/** Экран `channelInfo` (спека §5.5). «Пригласить гостя» и «Гости» — этап 4 (D7). */
export function ChannelInfoScreen({ channelId, ctx }: { channelId: string; ctx: ScreenCtx }) {
  const { c, nav } = ctx;
  const t = useT();
  const list = useMemberList(c.voiceParticipants);
  const [callTarget, setCallTarget] = useState<MemberWithUser | null>(null);
  const [manage, setManage] = useState(false);
  const callChannelId = useCallStore((s) => s.callChannelId);
  const perms = useServerStore((s) => (c.currentServer ? s.permissions.get(c.currentServer.id) : undefined));

  const channel = c.currentChannel?.id === channelId ? c.currentChannel : null;
  if (!channel || !c.currentServer) return <div className="mobile-screen-loading" />;
  const server = c.currentServer;
  const canInvite = can(perms, PERMISSIONS.CREATE_INVITE) || server.owner_id === c.user?.id;
  const canManage = can(perms, PERMISSIONS.MANAGE_CHANNELS);
  const inThisCall = callChannelId === channelId;

  const toCall = () => {
    if (!inThisCall) c.joinVoice(channel);
    // channelInfo ЗАМЕНЯЕМ экраном звонка: назад из звонка — в чат, а не в «о канале».
    nav.replaceStack([...nav.stack.slice(0, -1), { kind: 'call' }]);
  };
  const toSearch = () => {
    // Команду ставим ДО возврата: чат под нами не «активен» (D9) и подхватит её,
    // когда станет верхним экраном.
    usePaletteStore.getState().searchInChannel(channelId, '');
    nav.back();
  };

  const row = (m: MemberWithUser, online: boolean) => {
    const sub = list.voiceNameFor(m, online) ? t('server.inVoice', { channel: list.voiceNameFor(m, online)! }) : list.lastSeenFor(m, online);
    const callable = online && !!c.user && m.user_id !== c.user.id;
    return (
      <MobileListRow
        key={m.user_id}
        className={online ? undefined : 'is-offline'}
        avatar={<Avatar url={m.avatar_url} username={m.username} className="channel-info-avatar" />}
        title={m.username}
        subtitle={sub ?? undefined}
        onClick={callable ? () => setCallTarget(m) : undefined}
      />
    );
  };

  return (
    <div className="channel-info">
      <ScreenHeader title={t('mobile.channelInfo')} onBack={nav.back} />
      <div className="channel-info-scroll">
        <div className="channel-info-hero">
          <span className="channel-info-icon"><Hash size={32} strokeWidth={1.8} /></span>
          <h2 className="channel-info-name">{channel.name}</h2>
          <p className="channel-info-server">{server.name}</p>
        </div>
        <div className="channel-info-actions">
          <button type="button" className="channel-info-action" onClick={toCall}>
            <Headphones size={22} strokeWidth={1.8} /><span>{t('mobile.infoCall')}</span>
          </button>
          <button type="button" className="channel-info-action" onClick={toSearch}>
            <Search size={22} strokeWidth={1.8} /><span>{t('mobile.infoSearch')}</span>
          </button>
        </div>

        <h3 className="channel-info-section">{t('chat.members')}</h3>
        {canInvite && (
          <MobileListRow
            avatar={<span className="channel-info-icon is-small"><UserPlus size={20} strokeWidth={1.8} /></span>}
            title={t('mobile.inviteFriends')}
            onClick={() => nav.push({ kind: 'invites', serverId: server.id })}
          />
        )}
        <div className="channel-info-category">{t('server.online')} — {list.onlineMembers.length}</div>
        {list.onlineMembers.map((m) => row(m, true))}
        <div className="channel-info-category">{t('server.offline')} — {list.offlineMembers.length}</div>
        {list.offlineMembers.map((m) => row(m, false))}

        {canManage && (
          <>
            <h3 className="channel-info-section">{t('mobile.channelSection')}</h3>
            <MobileListRow
              avatar={<span className="channel-info-icon is-small"><Settings2 size={20} strokeWidth={1.8} /></span>}
              title={t('mobile.manageChannel')}
              onClick={() => setManage(true)}
            />
          </>
        )}
      </div>

      <ActionSheet
        open={callTarget !== null}
        onClose={() => setCallTarget(null)}
        title={callTarget?.username}
        items={callTarget ? [{
          label: t('server.callUser', { name: callTarget.username }),
          icon: <Headphones size={20} strokeWidth={1.8} />,
          onClick: () => { void callService.startCall(callTarget.user_id); },
        }] : []}
      />
      <ChannelMenuSheet
        channel={manage ? channel : null}
        serverId={server.id}
        channelCount={c.channels.filter((ch) => ch.server_id === server.id).length}
        open={manage}
        onClose={() => setManage(false)}
        onDeleted={(id) => c.channelRemoved(id)}
      />
    </div>
  );
}
```
  `ActionSheet` с `title={undefined}` допустим. Иконка `Settings2` — проверить наличие в установленной версии lucide, иначе `SlidersHorizontal`.
  **Внимание к `ActionSheet` и `callTarget`**: `onClose` обнуляет `callTarget` ДО `onClick` —
  замыкание пункта уже держит `callTarget` из рендера, поэтому вызов безопасен (D8 этапа 2 —
  про иное). Если тест покажет обратное — держать `callTarget` до микрозадачи.

  `ChannelInfoScreen.css` (без `@media`): `.channel-info { display:flex; flex-direction:column; flex:1; min-height:0; }`,
  `.channel-info-scroll { flex:1; overflow-y:auto; overscroll-behavior: contain; }`,
  герой по центру (`--canvas-2` фон иконки 72×72, радиус `--radius-card`), ряд из двух кнопок
  `.channel-info-action` (flex:1, min-height 64, столбик иконка+подпись, фон `--canvas-2`, радиус
  `--radius-card`, `--ink`), `.channel-info-category` (`--muted`, 13/600, верхний регистр по правилам
  соседних экранов), `.channel-info-avatar` 48×48 круглый, `.channel-info-icon` 72×72 (`.is-small` 48×48),
  `.mobile-row.is-offline { opacity: 0.6 }` — **проверить**, что `MobileListRow.css` не задаёт своего.

- [ ] **Шаг 6: `renderScreen.tsx`:** `case 'channelInfo': return <ChannelInfoScreen channelId={screen.channelId} ctx={ctx} />;`
  (убрать `UserList` из импортов, если больше не используется).

- [ ] **Шаг 7: прогон** `npx vitest run src/mobile src/components/__tests__ src/styles` → PASS. **Шаг 8: гейты.**

---

### Task 10: экран `search`

**Файлы:**
- Создать: `client/src/hooks/usePaletteSearch.ts`
- Изменить: `client/src/components/CommandPalette.tsx`
- Создать: `client/src/hooks/__tests__/usePaletteSearch.test.tsx`
- Создать: `client/src/mobile/screens/SearchScreen.tsx`, `SearchScreen.css`
- Создать: `client/src/mobile/screens/__tests__/SearchScreen.test.tsx`
- Изменить: `client/src/mobile/screens/{renderScreen.tsx,ServersScreen.tsx}`, `client/src/mobile/MobileShell.tsx`, `client/src/pages/app/AppOverlays.tsx`
- Изменить: `client/src/i18n/locales/{ru,en}.ts`

**Интерфейсы:**
- Производит:
```ts
export function usePaletteSearch(active: boolean, channel: Channel | null, trimmed: string): {
  messages: PaletteMessage[]; total: number; loading: boolean; error: string | null;
};
export function SearchScreen({ ctx, channelId }: { ctx: ScreenCtx; channelId: string | null }): JSX.Element;
// AppOverlays: showPalette?: boolean (по умолчанию true)
```

- [ ] **Шаг 1: i18n** — `mobile.search` «Поиск» / «Search» (иконка «Серверов» и подпись шапки экрана).
  Плейсхолдер поля — существующий `palette.placeholder`, группы — `palette.group*`, пусто — `palette.empty`.

- [ ] **Шаг 2: вынос `usePaletteSearch`.** Перенести из `CommandPalette.tsx` дословно четыре
  `useState` (`messages`, `messagesTotal`, `messagesLoading`, `messagesError`) и эффект
  debounce-поиска (включая комментарий про 120 мс, `cancelled`, `PALETTE_DEBOUNCE_MS`, `CAP_MESSAGES`,
  `PALETTE_MIN_QUERY`) в хук с сигнатурой выше (`isOpen` → `active`, `currentChannel` → `channel`,
  `t` берётся внутри `useT()`). `CommandPalette`:
  `const { messages, total: messagesTotal, loading: messagesLoading, error: messagesError } = usePaletteSearch(isOpen, currentChannel, trimmed);`
  Тест хука (красный до выноса): при `active=false`/пустом запросе — пусто и без сетевого вызова;
  запрос ≥ 2 символов — после 120 мс один `apiService.searchMessages(channel.id, q, CAP_MESSAGES, 0)`;
  смена запроса до срабатывания отменяет предыдущий; ошибка → `error`. Прогнать
  `CommandPalette.dom.test.tsx` (T1) — PASS без правок.

- [ ] **Шаг 3: тест `SearchScreen.test.tsx` (красный).**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SearchScreen } from '@/mobile/screens/SearchScreen';
import type { AppController } from '@/pages/app/useAppController';
import type { Channel, PermissionSet } from '@/types';
import { apiService } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { useThemeStore } from '@/stores/themeStore';
import { controller, nav, ch, s1 } from './fixtures';

const RESULT = { id: 'm9', username: 'Борис', content: 'привет мир', created_at: '2026-09-20T09:00:00Z' };
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: { ...actual.apiService, searchMessages: vi.fn(async () => ({ results: [RESULT], total: 1 })) },
  };
});

const flood: Channel = { ...ch, id: 'c2', name: 'флудилка', position: 1 };
const perms = (bits: bigint, isOwner = false): PermissionSet => ({ isOwner, bits, highestPosition: 0 });

const PLACEHOLDER = 'Каналы, сообщения, действия…';
const G_CHANNELS = 'Каналы — этот сервер';
const G_MESSAGES = 'Сообщения — в этом канале';
const G_ACTIONS = 'Действия';
const A_CREATE_SERVER = 'Создать сервер';
const A_FIND_SERVER = 'Найти сервер';
const A_SETTINGS = 'Открыть настройки';
const A_CREATE_CHANNEL = 'Создать канал';
const A_THEME_DARK = 'Включить тёмную тему';
const A_SEARCH_IN = 'Искать в канале #общий';
const A_JOIN_VOICE = 'Войти в голосовой «общий»';
const SHOW_ALL = 'Показать все результаты';
const BACK = 'Назад';

beforeEach(() => {
  vi.clearAllMocks();
  usePaletteStore.setState({ command: null, isOpen: false });
  useServerStore.setState({ permissions: new Map([['s1', perms(0n, true)]]), currentServer: s1 });
  useThemeStore.setState({ theme: 'light' });
});
afterEach(cleanup);

function mount(channelId: string | null, over: Partial<AppController> = {}) {
  const c = controller({ channels: [ch, flood], currentChannel: ch, ...over });
  const n = nav();
  const joinVoice = vi.fn();
  render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
      <SearchScreen ctx={{ c, nav: n, joinVoice }} channelId={channelId} />
    </MemoryRouter>,
  );
  return { c, n, joinVoice, input: document.querySelector('.search-input') as HTMLInputElement };
}
const titles = () => [...document.querySelectorAll('.mobile-row-title-text')].map((e) => e.textContent);
const groups = () => [...document.querySelectorAll('.search-group')].map((e) => e.textContent);
const row = (title: string) =>
  [...document.querySelectorAll('.mobile-row')].find(
    (r) => r.querySelector('.mobile-row-title-text')?.textContent === title,
  ) as HTMLElement;
const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });

describe('SearchScreen', () => {
  it('focuses the field; an empty query shows channels and actions', () => {
    const { input } = mount(null);
    expect(document.activeElement).toBe(input);
    expect(input.placeholder).toBe(PLACEHOLDER);
    expect(groups()).toEqual([G_CHANNELS, G_ACTIONS]);
  });

  it('a channel row opens channels + chat on top of the search entry', () => {
    const { n, input } = mount(null);
    type(input, 'флуд');
    expect(titles()[0]).toBe('флудилка');
    fireEvent.click(row('флудилка'));
    expect(n.pushMany).toHaveBeenCalledWith([{ kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c2' }]);
  });

  it('without a chat below there is no message group and no channel-bound actions', () => {
    const { input } = mount(null);
    type(input, 'привет');
    expect(groups()).not.toContain(G_MESSAGES);
    expect(titles()).not.toContain(A_SEARCH_IN);
    expect(titles()).not.toContain(A_JOIN_VOICE);
    expect(apiService.searchMessages).not.toHaveBeenCalled();
  });

  it('with a chat below a message result queues chat-jump and goes back', async () => {
    const { n, input } = mount('c1');
    type(input, 'привет');
    await waitFor(() => expect(groups()).toContain(G_MESSAGES));
    n.back = vi.fn(() => {
      expect(usePaletteStore.getState().command).toMatchObject({ kind: 'chat-jump', channelId: 'c1', messageId: 'm9' });
    });
    fireEvent.click(row('Борис'));
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('«show all» queues chat-search with the query and goes back', async () => {
    vi.mocked(apiService.searchMessages).mockResolvedValueOnce({ results: [RESULT], total: 9 } as never);
    const { n, input } = mount('c1');
    type(input, 'привет');
    await waitFor(() => expect(titles()).toContain(SHOW_ALL));
    fireEvent.click(row(SHOW_ALL));
    expect(usePaletteStore.getState().command).toMatchObject({ kind: 'chat-search', channelId: 'c1', query: 'привет' });
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('«search in channel» queues chat-search and goes back', () => {
    const { n } = mount('c1');
    fireEvent.click(row(A_SEARCH_IN));
    expect(usePaletteStore.getState().command).toMatchObject({ kind: 'chat-search', channelId: 'c1', query: '' });
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('actions navigate or delegate to the controller', () => {
    const { c, n, joinVoice } = mount('c1');
    fireEvent.click(row(A_CREATE_SERVER));
    expect(n.push).toHaveBeenCalledWith({ kind: 'createServer' });
    fireEvent.click(row(A_FIND_SERVER));
    expect(n.push).toHaveBeenCalledWith({ kind: 'findServer' });
    fireEvent.click(row(A_SETTINGS));
    expect(c.ui.setSettingsOpen).toHaveBeenCalledWith(true);
    fireEvent.click(row(A_CREATE_CHANNEL));
    expect(c.ui.setCreateChannelOpen).toHaveBeenCalledWith(true);
    fireEvent.click(row(A_JOIN_VOICE));
    expect(joinVoice).toHaveBeenCalledWith(ch);
    fireEvent.click(row(A_THEME_DARK));
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('the create-channel action is hidden without MANAGE_CHANNELS', () => {
    useServerStore.setState({ permissions: new Map([['s1', perms(0n)]]) });
    mount(null, { currentServer: { ...s1, owner_id: 'u9' } });
    expect(titles()).not.toContain(A_CREATE_CHANNEL);
  });

  it('the back button goes back; nothing found shows the empty text', () => {
    const { n, input } = mount(null);
    type(input, 'zzzzzz');
    expect(document.querySelector('.search-status')?.textContent).toContain('zzzzzz');
    fireEvent.click([...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === BACK)!);
    expect(n.back).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Шаг 4: реализация `SearchScreen.tsx`.**

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, Hash, Moon, Plus, Search, Settings as SettingsIcon, Sun, Volume2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { usePaletteSearch } from '@/hooks/usePaletteSearch';
import { usePaletteStore } from '@/stores/paletteStore';
import { useThemeStore } from '@/stores/themeStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { can, PERMISSIONS } from '@/utils/permissions';
import { snippetAround, splitMatches } from '@/utils/searchSnippet';
import {
  buildPalette, shouldShowEmptyState, PALETTE_MAX_QUERY,
  type PaletteActionDef, type PaletteRow,
} from '@/utils/paletteFilter';
import { useT, useDateFormat } from '@/i18n';
import type { ScreenCtx } from './types';
import './SearchScreen.css';

const GROUP_LABEL = { channels: 'palette.groupChannels', messages: 'palette.groupMessages', actions: 'palette.groupActions' } as const;

/** Экран `search` (спека §5.10, D8): CommandPalette без хоткеев и оверлея. Сообщения
 *  и «искать в канале» — только если под экраном лежит чат (`channelId`). */
export function SearchScreen({ ctx, channelId }: { ctx: ScreenCtx; channelId: string | null }) {
  const { c, nav } = ctx;
  const t = useT();
  const fmt = useDateFormat();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const channel = useMemo(() => c.channels.find((ch) => ch.id === channelId) ?? null, [c.channels, channelId]);
  const trimmed = query.trim();
  const found = usePaletteSearch(true, channel, trimmed);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const callChannelId = useCallStore((s) => s.callChannelId);
  const perms = useServerStore((s) => (c.currentServer ? s.permissions.get(c.currentServer.id) : undefined));
  const canManageChannels = can(perms, PERMISSIONS.MANAGE_CHANNELS);

  const goBackWith = (cmd: () => void) => { cmd(); nav.back(); };

  const actions: PaletteActionDef[] = useMemo(() => {
    const defs: PaletteActionDef[] = [];
    if (c.currentServer && canManageChannels) {
      defs.push({ id: 'create-channel', label: t('palette.createChannel'), run: () => c.ui.setCreateChannelOpen(true) });
    }
    if (channel && callChannelId !== channel.id) {
      defs.push({ id: 'join-voice', label: t('palette.joinVoice', { channel: channel.name }), run: () => ctx.joinVoice(channel) });
    }
    defs.push({ id: 'open-settings', label: t('palette.openSettings'), run: () => c.ui.setSettingsOpen(true) });
    defs.push({
      id: 'theme',
      label: theme === 'dark' ? t('palette.themeLight') : t('palette.themeDark'),
      run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    });
    defs.push({ id: 'create-server', label: t('palette.createServer'), run: () => nav.push({ kind: 'createServer' }) });
    defs.push({ id: 'find-server', label: t('palette.findServer'), run: () => nav.push({ kind: 'findServer' }) });
    if (channel) {
      defs.push({
        id: 'search-in-channel',
        label: t('palette.searchInChannel', { channel: channel.name }),
        run: () => goBackWith(() => usePaletteStore.getState().searchInChannel(channel.id, '')),
      });
    }
    return defs;
  }, [t, c, nav, ctx, channel, callChannelId, canManageChannels, theme, setTheme]);

  const model = useMemo(() => buildPalette({
    query, channels: c.channels, actions,
    messages: found.messages, messagesTotal: found.total, hasChannel: !!channel,
    messagesLoading: found.loading, messagesError: found.error,
  }), [query, c.channels, actions, found, channel]);

  const activate = (row: PaletteRow) => {
    if (row.kind === 'channel') {
      nav.pushMany([{ kind: 'channels', serverId: row.channel.server_id }, { kind: 'chat', channelId: row.channel.id }]);
    } else if (row.kind === 'action') {
      row.action.run();
    } else if (row.kind === 'message' && channel) {
      goBackWith(() => usePaletteStore.getState().jumpToMessage(channel.id, row.message.id));
    } else if (row.kind === 'show-all' && channel) {
      goBackWith(() => usePaletteStore.getState().searchInChannel(channel.id, trimmed));
    }
  };

  const actionIcon = (id: string): ReactNode => {
    const p = { size: 20, strokeWidth: 1.8 } as const;
    switch (id) {
      case 'create-channel': case 'create-server': return <Plus {...p} />;
      case 'join-voice': return <Volume2 {...p} />;
      case 'open-settings': return <SettingsIcon {...p} />;
      case 'theme': return theme === 'dark' ? <Sun {...p} /> : <Moon {...p} />;
      default: return <Search {...p} />;
    }
  };

  const renderRow = (row: PaletteRow): ReactNode => {
    switch (row.kind) {
      case 'status':
        return <div className="search-status" key={row.id}>{row.id === 'messages-loading' ? t('palette.searching') : row.text}</div>;
      case 'channel':
        return <MobileListRow key={row.id} avatar={<span className="search-icon"><Hash size={20} strokeWidth={1.8} /></span>} title={row.channel.name} onClick={() => activate(row)} />;
      case 'action':
        return <MobileListRow key={row.id} avatar={<span className="search-icon">{actionIcon(row.action.id)}</span>} title={row.action.label} onClick={() => activate(row)} />;
      case 'show-all':
        return <MobileListRow key={row.id} avatar={<span className="search-icon"><Search size={20} strokeWidth={1.8} /></span>} title={t('palette.showAll')} onClick={() => activate(row)} />;
      case 'message':
        return (
          <MobileListRow
            key={row.id}
            avatar={<Avatar username={row.message.username} className="search-avatar" />}
            title={row.message.username}
            subtitle={splitMatches(snippetAround(row.message.content, trimmed), trimmed).map((part, i) =>
              part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}
            meta={<span className="activity-time">{fmt.formatDayMonth(new Date(row.message.created_at))}</span>}
            onClick={() => activate(row)}
          />
        );
    }
  };

  return (
    <div className="search-screen">
      <header className="search-header">
        <button type="button" className="screen-header-btn" aria-label={t('common.back')} onClick={nav.back}>
          <ChevronLeft size={24} strokeWidth={1.8} />
        </button>
        <input
          ref={inputRef}
          className="search-input"
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('palette.placeholder')}
          maxLength={PALETTE_MAX_QUERY}
        />
      </header>
      <div className="search-list">
        {model.groups.map((g) => (
          <section key={g.key} aria-label={t(GROUP_LABEL[g.key])}>
            <h2 className="search-group">{t(GROUP_LABEL[g.key])}</h2>
            {g.rows.map(renderRow)}
          </section>
        ))}
        {shouldShowEmptyState(model, query) && <div className="search-status">{t('palette.empty', { query: trimmed })}</div>}
      </div>
    </div>
  );
}
```
  `SearchScreen.css` (без `@media`): `.search-screen {display:flex; flex-direction:column; flex:1; min-height:0}`;
  `.search-header` — как `.screen-header` (высота 56, `--canvas`, хэрлайн `--line`) — **не** копировать
  правила: использовать общий класс `screen-header` на `<header>` (`className="screen-header search-header"`),
  а `.search-input` — `flex:1; min-width:0; height:40px; font-size:16px; background:var(--canvas-2); border:none;
  border-radius: var(--radius-pill); padding: 0 16px; color: var(--ink)`; `.search-list {flex:1; overflow-y:auto;
  overscroll-behavior: contain}`; `.search-group` (`--muted` 13/600, паддинг 16/8); `.search-icon`/`.search-avatar`
  48×48 (иконка — круг `--canvas-2`); `.search-status` (`--muted`, паддинг 16); `mark { background: var(--accent-soft); color: inherit }`
  (проверить, что так же сделано в `CommandPalette.css` для `mark`, и взять те же токены).

- [ ] **Шаг 5: `renderScreen.tsx`:**
```tsx
    case 'search': {
      // Чат непосредственно под search — источник группы «Сообщения» (D8).
      const idx = ctx.nav.stack.indexOf(screen);
      const below = idx > 0 ? ctx.nav.stack[idx - 1] : undefined;
      return <SearchScreen ctx={ctx} channelId={below?.kind === 'chat' ? below.channelId : null} />;
    }
```
  `ServersScreen.tsx`: в `actions` шапки перед «＋» добавить кнопку
  `<button type="button" className="screen-header-btn" aria-label={t('mobile.search')} onClick={() => nav.push({ kind: 'search' })}><Search size={24} strokeWidth={1.8} /></button>`
  (импорт `Search`). Проверить тесты этапа 2: они берут «последнюю» кнопку шапки как «＋»
  (`lastHeaderButton`) — порядок «поиск, ＋» это сохраняет; тесты, берущие `[0]`/`querySelector('.screen-header-actions button')`,
  обновить на «＋» по `aria-label`.

- [ ] **Шаг 6: `AppOverlays.tsx`.** Проп `showPalette?: boolean` (по умолчанию `true`),
  `{showPalette && (<CommandPalette … />)}`. Десктоп — без изменений (`AppOverlays` в `DesktopShell` не получает проп).

- [ ] **Шаг 7: `MobileShell.tsx`.**
  - `<AppOverlays … showPalette={false} />`.
  - Мост аппаратного ⌘K (D8):
```tsx
  const paletteOpen = usePaletteStore((s) => s.isOpen);
  useEffect(() => {
    if (!paletteOpen) return;
    usePaletteStore.getState().close();
    if (nav.top.kind !== 'search') nav.push({ kind: 'search' });
  }, [paletteOpen]); // nav — актуальный из рендера, эффект запускается сменой флага
```
    (импорт `usePaletteStore`). Хоткей `usePaletteHotkey` (`AppPage`) продолжает открывать стор; гейт
    `isBlockingOverlayOpen()` (открытая шторка) остаётся.

- [ ] **Шаг 8: прогон** `npx vitest run src/hooks src/components/__tests__ src/mobile` → PASS
  (включая `CommandPalette.dom` и `MobileShell.*`). **Шаг 9: гейты.**

---

### Task 11: сшивка этапа

**Файлы:**
- Изменить: `client/src/mobile/MobileShell.css`
- Создать: `client/src/mobile/__tests__/MobileShell.stage3.test.tsx`
- Изменить: `client/src/mobile/screens/__tests__/renderScreen.test.tsx` (если ссылается на удалённое)

- [ ] **Шаг 1: интеграционный тест `MobileShell.stage3.test.tsx` (красный → зелёный).** Реальные
  `MobileShell`, `renderScreen` и экраны; заглушены оверлеи и звонковый UI, как в `MobileShell.stage2.test.tsx`.
  История — `MemoryRouter` с несколькими записями, чтобы `navigate(-1)` действительно куда-то шёл.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { AppController } from '@/pages/app/useAppController';
import type { Channel, Server } from '@/types';

vi.mock('@/pages/app/AppOverlays', () => ({ AppOverlays: () => null }));
vi.mock('@/components/CallUI', () => ({ CallUI: () => null }));
vi.mock('@/components/CallDock', () => ({ CallDock: () => null }));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listStickers: vi.fn(async () => []),
      getUserById: vi.fn(async () => ({ id: 'u2', username: 'Борис' })),
      searchMessages: vi.fn(async () => ({ results: [], total: 0 })),
      getMessagesAround: vi.fn(async () => []),
      getMessages: vi.fn(async () => []),
      getOnlineUsers: vi.fn(async () => []),
      getLastSeenBatch: vi.fn(async () => ({})),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

import { MobileShell } from '@/mobile/MobileShell';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { controller } from '@/mobile/screens/__tests__/fixtures';
import { messages, stubBrowser } from '@/components/__tests__/chatHarness';

const alpha = { id: 's1', name: 'Альфа', owner_id: 'u1' } as Server;
const general = { id: 'c1', server_id: 's1', name: 'общий', position: 0, created_at: '', updated_at: '' } as Channel;

const EDIT = 'Изменить';
const SEARCH = 'Поиск';
const SEARCH_MESSAGES = 'Поиск сообщений';
const BACK = 'Назад';
const PLACEHOLDER = 'Каналы, сообщения, действия…';

const S = [{ kind: 'servers' }] as const;
const C = [...S, { kind: 'channels', serverId: 's1' }] as const;
const H = [...C, { kind: 'chat', channelId: 'c1' }] as const;
const entry = (m: readonly unknown[], b: number) => ({ pathname: '/app', state: { m, b } });

let go: ReturnType<typeof useNavigate>;
function Grab() { go = useNavigate(); return null; }

const selectServer = vi.fn(async (s: Server) => { useServerStore.setState({ currentServer: s, channels: [general] }); });
const selectChannel = vi.fn(async (ch: Channel) => { useServerStore.setState({ currentChannel: ch }); });

function Host() {
  const currentServer = useServerStore((s) => s.currentServer);
  const currentChannel = useServerStore((s) => s.currentChannel);
  const channels = useServerStore((s) => s.channels);
  const c: AppController = controller({
    servers: [alpha], currentServer, currentChannel, channels, members: [], selectServer, selectChannel,
  });
  return (<><Grab /><MobileShell c={c} /></>);
}
const mount = (entries: ReturnType<typeof entry>[] = [entry(S, 0), entry(C, 1), entry(H, 2)], index = entries.length - 1) =>
  render(<MemoryRouter initialEntries={entries} initialIndex={index}><Host /></MemoryRouter>);

const flush = () => act(async () => {});
const top = () => document.querySelector('.mobile-screen.is-top') as HTMLElement;
const byLabel = (root: ParentNode, label: string) =>
  [...root.querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === label) as HTMLElement;
const goBack = () => act(async () => { go(-1); });

beforeAll(stubBrowser);
beforeEach(() => {
  vi.clearAllMocks();
  usePaletteStore.setState({ isOpen: false, command: null });
  useMessageStore.setState({ messages: messages(), loading: false });
  useServerStore.setState({
    servers: [alpha], serversLoaded: true, currentServer: alpha, channels: [general], currentChannel: general,
    members: [], permissions: new Map(),
  });
});
afterEach(cleanup);

describe('MobileShell stage 3 (real chat screens)', () => {
  it('the chat screen has the mobile header and composer, not the desktop header', async () => {
    mount(); await flush();
    expect(document.querySelector('.screen-header-name')?.textContent).toBe('#общий');
    expect(document.querySelector('.composer-plus-btn')).not.toBeNull();
    expect(document.querySelector('.chat-header')).toBeNull();
  });

  it('long-press on an own message opens the sheet; Edit shows explicit buttons; Cancel closes the editor', async () => {
    mount(); await flush();
    const own = document.querySelector('.msg-row.is-own:not(.is-failed)') as HTMLElement;
    fireEvent.pointerDown(own, { pointerType: 'touch', button: 0, clientX: 4, clientY: 4 });
    await waitFor(() => expect(document.querySelector('.sheet')).not.toBeNull(), { timeout: 1500 });
    fireEvent.click([...document.querySelectorAll('.sheet .action-sheet-item')].find((i) => i.textContent?.includes(EDIT))!);
    await waitFor(() => expect(document.querySelector('.msg-edit-actions')).not.toBeNull());
    fireEvent.click(document.querySelector('.msg-edit-actions .btn-secondary')!);
    await waitFor(() => expect(document.querySelector('.msg-edit-actions')).toBeNull());
  });

  it('tapping the title opens channel info; back returns to the chat', async () => {
    mount(); await flush();
    fireEvent.click(document.querySelector('.screen-header-title.is-tappable')!);
    await waitFor(() => expect(document.querySelector('.channel-info')).not.toBeNull());
    fireEvent.click(byLabel(top(), BACK));
    await waitFor(() => expect(document.querySelector('.channel-info')).toBeNull());
    expect(document.querySelector('.composer-plus-btn')).not.toBeNull();
  });

  it('channel info → Search returns to the chat and opens the search layer (D9)', async () => {
    mount(); await flush();
    fireEvent.click(document.querySelector('.screen-header-title.is-tappable')!);
    await waitFor(() => expect(document.querySelector('.channel-info')).not.toBeNull());
    fireEvent.click([...document.querySelectorAll('.channel-info-action')].find((b) => b.textContent === SEARCH)!);
    await waitFor(() => expect(document.querySelector('.chat-search-layer')).not.toBeNull());
    expect(document.querySelector('.channel-info')).toBeNull();
  });

  it('system back closes the search layer, not the chat', async () => {
    mount(); await flush();
    fireEvent.click(byLabel(document, SEARCH_MESSAGES));
    await waitFor(() => expect(document.querySelector('.chat-search-layer')).not.toBeNull());
    await goBack();
    await waitFor(() => expect(document.querySelector('.chat-search-layer')).toBeNull());
    expect(document.querySelector('.composer-plus-btn')).not.toBeNull();
  });

  it('Servers → search → channel; back goes channels, then search', async () => {
    mount([entry(S, 0)]); await flush();
    fireEvent.click(byLabel(document.querySelector('.servers-screen')!, SEARCH));
    await waitFor(() => expect(document.querySelector('.search-screen')).not.toBeNull());
    fireEvent.change(document.querySelector('.search-input')!, { target: { value: 'общ' } });
    fireEvent.click([...document.querySelectorAll('.mobile-row')].find((r) => r.textContent?.includes('общий'))!);
    await waitFor(() => expect(document.querySelector('.composer-plus-btn')).not.toBeNull());
    await goBack();
    await waitFor(() => expect(document.querySelector('.channels-screen')).not.toBeNull());
    await goBack();
    await waitFor(() => expect(document.querySelector('.search-screen')).not.toBeNull());
  });

  it('hardware ⌘K opens the search screen and never mounts the desktop palette', async () => {
    mount(); await flush();
    act(() => usePaletteStore.getState().open());
    await waitFor(() => expect(document.querySelector('.search-screen')).not.toBeNull());
    expect(usePaletteStore.getState().isOpen).toBe(false);
    expect((document.querySelector('.search-input') as HTMLInputElement).placeholder).toBe(PLACEHOLDER);
    expect(document.querySelector('.palette-dialog')).toBeNull();
  });

  it('a lightbox opens over the chat and system back closes only the lightbox', async () => {
    const withImage = messages();
    withImage[0] = {
      ...withImage[0],
      attachments: [{
        id: 'a1', channel_id: 'c1', user_id: 'u2', kind: 'image', file_name: 'p.png', content_type: 'image/png',
        size_bytes: 10, url: '/api/v1/attachments/a1/content?exp=1&sig=x', created_at: '2026-09-20T09:05:00Z',
      }],
    };
    useMessageStore.setState({ messages: withImage });
    mount(); await flush();
    fireEvent.click(document.querySelector('.attachment-image')!);
    await waitFor(() => expect(document.querySelector('.lightbox-root')).not.toBeNull());
    await goBack();
    await waitFor(() => expect(document.querySelector('.lightbox-root')).toBeNull());
    expect(document.querySelector('.composer-plus-btn')).not.toBeNull();
  });
});
```

- [ ] **Шаг 2: `MobileShell.css`** — удалить из списка «панелей, ещё не переписанных» селектор
  `.mobile-screen > .user-list` (экрана больше нет); комментарий обновить: остались `.chat-area`
  (корень ChatArea всё ещё панель), `.call-stage`, `.home-view`.

- [ ] **Шаг 3: прогон всего набора** `npm test` → ровно 3 падения (`api.network-retry`).
  Красные `MobileShell.*` / `renderScreen.*` — чинить их **ожидания**, если они опирались на
  прежнюю связку `ChatArea` (`onMobileBack`, `chat-members-btn`, `UserList`); код не ослаблять.

- [ ] **Шаг 4: гейты.**

---

### Task 12: приёмка этапа

**Файлы:** правка `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`; скриншоты/пробы —
только в `.superpowers/vyc95/s3/` (git-ignored, свидетельство).

Это задача контролёра плана (не исполнителя): требует браузера и решений. Схема — как на этапе 2
(`.superpowers/vyc95/s2/run-rest.sh`, `shoot-desktop-extra.sh`, `NOISE.md`, `fixtures.js`).

- [ ] **Шаг 1: полные гейты** из `client/`: `npx tsc --noEmit` (0 байт), `npx stylelint "src/**/*.css"`
  (0 байт), `npm run check:i18n`, `npm test` (ровно 3 падения в `api.network-retry.test.ts`).
  `git status --short`: нет `M` вне ожидаемых файлов; `git diff --stat` по `src/components/__tests__/__snapshots__/`
  — пусто (снимки не менялись).

- [ ] **Шаг 2: десктоп против нетронутого оригинала.** `/tmp/vyc95-base` (pre-VYC-95, :3101) и рабочее
  дерево (:3100), оба dev-серверы свежие (`ls -l` на процессе/лог позже последней правки).
  14 состояний этапов 1–2 + новые чатовые: чат с поиском открытым, редактор сообщения, эмодзи-пикер,
  лайтбокс, палитра ⌘K, список участников. `compare -metric AE`; шум ≤ 2 px (`NOISE.md`); >2 — разбирать.

- [ ] **Шаг 3: мобильная матрица** `--touch`, `--theme light|dark`, 375×812 / 390×844 / 768×1024:
  `chat` (лента с разделителями, «Новые сообщения», гость, вложения image/video/audio/file, стикер,
  неотправленное), пустой канал («тишина»), композер (пустой / с текстом / многострочный 6+ строк /
  панель «Aa» / упоминание), шторка «＋», шторки эмодзи и стикеров, шторка действий сообщения (своё /
  чужое / неотправленное), редактор с кнопками, поиск по каналу (пусто / результаты / ничего),
  `channelInfo` (герой, участники, голос, управление), `search` (пусто / запрос / сообщения),
  лайтбокс 390×844 и **844×390**, `VoiceBanner`. Пробы создающие данные — удаляют их в `finally`.
  Каждый кадр — просмотреть.

- [ ] **Шаг 4: реальный браузер (то, чего не ловит jsdom — урок этапа 2).** Пробы `probe-template.js`, каждая
  сначала красная: (а) открыть поиск в чате → системное «назад» закрывает слой; (б) открыть
  лайтбокс → «назад» закрывает лайтбокс; (в) `channelInfo → Поиск` открывает поиск ПОСЛЕ возврата в чат;
  (г) `search → канал → назад → назад` возвращает на `search`, потом на «Серверы»; (д) long-press
  на строке сообщения (эмуляция touch) открывает шторку и не выделяет текст; (е) `--keyboard-inset`:
  подменить `visualViewport` (CDP `Emulation.setDeviceMetricsOverride` / `Input` с клавиатурой) и
  убедиться, что `.mobile-shell` сжимается, композер остаётся над «клавиатурой»; (ж) тач-цели:
  `elementFromPoint` в ±21 px от центра каждой кнопки плееров/лайтбокса/шапок/композера попадает в
  контрол или его потомка; (з) **аудит hover-зависимого (строка 92)**: в CSS чатовых компонентов найти
  всё, что показывается только по `:hover` / `:focus-within` (`grep -n "opacity: 0\|visibility: hidden\|pointer-events: none"`
  рядом с `:hover` в `MessageRow`, `MessageAttachments`, `AttachmentTray`, `VideoPlayer`, `AudioPlayer`,
  `UserList`, `ExpressionPicker`) и на `--touch` убедиться, что у каждого есть тач-путь (видимая кнопка,
  long-press или `(hover: none)`-правило). Список найденного и вердикт по каждому — в ledger.

- [ ] **Шаг 5: обновить спеку.** Строки покрытия 19, 20 (часть «чат→звонок»: кнопка есть, экран — этап 4),
  21–38, 39 (закрыть «тишина/приветствие»), 40–44, 87, 92 — «✅ этап 3 + свидетельство»; строка 26 —
  «⏳ частично (D3)»; 42–44 — с оговоркой D7 про гостей. В §9/«Этап 3 — отложено» записать:
  D1–D12, отложенное (тост «Скопировано», «Гости»/«Пригласить гостя» в `channelInfo` → этап 4,
  цитирование фрагмента выделением на тач-вводе, ⌘K из глубокого стека оставляет search под результатами,
  iOS-клавиатура/`safe-area` не проверены на устройстве, `CommandPalette.css` `<= 640px` и мобильные блоки
  `ChatArea.css`/`UserList.css` для удалённых панелей — этап 7). `LEGACY` остаётся: `CallStage`,
  `ChannelSidebar`, `CommandPalette`, `FriendsPanel`, `ServerList`, `GuestCallView`.

- [ ] **Шаг 6: закрыть ledger** (`STAGE 3 COMPLETE`) и подготовить сообщение пользователю с
  перечнем файлов для `git add` (явные пути, без `-A`/`.`; `git add -f` для этого плана —
  каталог `docs/superpowers/plans/` в `.gitignore`), предложенным сообщением коммита
  (без `Co-Authored-By`), списком решений, принятых за пользователя, отложенным и непроверенным.
  Предложение сообщения:

```
VYC-95 Мобильный чат: экран чата, шторки, поиск, channelInfo

- экран chat: ChatArea с ScreenHeader, поиск по каналу на весь экран, back-закрытие
- long-press по сообщению → шторка действий (цитировать, копировать, изменить, удалить, повторить)
- композер: «＋» (фото/файл/эмодзи/стикеры), кнопка отправки по содержимому, Enter не отправляет на таче
- лайтбокс: свайпы и закрытие жестом, back закрывает; тач-цели плееров ≥ 44
- экран channelInfo (участники, звонок, поиск, управление каналом) и экран search вместо ⌘K
- --keyboard-inset + useVisualViewportInset; десктопный DOM не изменён (файловые снимки)
```
