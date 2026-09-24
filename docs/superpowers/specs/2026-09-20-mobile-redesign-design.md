# VYC-95 — мобильный редизайн клиента: дизайн

> Статус: дизайн утверждён по секциям в сессии 2026-09-20, ждёт ревью спеки.
> Исходный промт: `docs/superpowers/prompts/2026-09-19-mobile-redesign.md` (§ ниже
> со ссылкой «промт §N» — оттуда). Ветка `VYC-95-create-mobile-design` от
> `main` @ `e752c3f`.

## 0. Цель и границы

При `width < 900px` клиент получает настоящий мобильный UX в духе Telegram:
нижний таб-бар **Серверы / Друзья / Профиль**, стек экранов со свайпом «назад»
и синхронизацией с history, bottom sheets вместо поповеров и меню, touch-first
взаимодействия, полноэкранный звонок, PWA-установка. **100% функциональности
сохраняется** (таблица покрытия, §10). **Десктоп (≥ 900px) не меняется ни на
пиксель** — проверяется попиксельным сравнением скриншотов 1280×800.

Вне объёма (промт §8): личные сообщения (VYC-91), реальные превью/счётчики
непрочитанного (только точка расширения §5.6), service worker / офлайн / push,
нативные обёртки, изменения сервера и протокола, новые продуктовые фичи.

### Принятые решения

| Тема | Решение |
|---|---|
| Процесс | Одна спека; подробный план пишется **на каждый этап** перед его реализацией; коммит этапа делает пользователь по предложенному сообщению |
| Архитектура | **Подход A**: общий контроллер + две оболочки (`DesktopShell` — сегодняшний JSX без изменений DOM; `MobileShell` — новый модуль `src/mobile/`) |
| Брейкпоинт | Одна пара `(width < 900px)` / `(width >= 900px)`; планшет 600–899 — **тот же стек**, что телефон |
| Холодный старт | Корень вкладки «Серверы»; перезагрузка посреди навигации восстанавливает экран из `history.state` |
| Тап по серверу | Открывает список каналов **без** автооткрытия чата |
| Вход в звонок | Сразу полноэкранный экран звонка; свёрнутый — `CallPill` |
| Входящий p2p | Полноэкранный; приглашение в групповой звонок — неблокирующая плашка |
| Свайп сообщения → цитата | Не делаем (конфликт со свайпом «назад»), follow-up |
| PWA-иконки | Временные апскейлы `favicon.png` (37×36); исходник ≥ 512 — follow-up |
| Electron | `minWidth: 900` → мобильная оболочка в Electron недостижима; манифест им игнорируется |

### Состояние trunk'а (на 2026-09-20)

`CLAUDE.md` называет trunk'ом `develop`, но релизы v2.4.x идут в `main`.
`HEAD..origin/develop` = один коммит (`1fd530e`, VYC-93), чьё содержимое уже в
`main`, кроме 6 строк focus-ring на `.composer-field` (`Composer.css`). На эту
задачу не влияет; ничего не мёржим. `origin/redesign` не существует — раздел
`CLAUDE.md` про неё устарел (сообщить пользователю, не править молча).

## 1. Архитектура

```
AppPage.tsx           ← развилка: useIsMobile() ? <MobileShell/> : <DesktopShell/>
  src/pages/app/
    useAppController.ts   ← вся логика из AppPage: loadServers, selectServer,
                            selectChannel, join/leave, удаления, WS-подписки,
                            create/join server, logout
    useCallRing.ts        ← voice_call_ring/cancel + рингтон (из AppPage)
    useVoiceParticipants.ts ← voice_state/voice_participants
    DesktopShell.tsx      ← сегодняшний JSX AppPage, DOM идентичен
  src/mobile/
    breakpoint.ts         ← MOBILE_MQ, useIsMobile()
    MobileShell.tsx       ← стек + таб-бар + CallPill + оверлеи
    nav/                  ← types, navReducer, useMobileNav, useEdgeSwipeBack
    sheets/               ← BottomSheet, ActionSheet, useBackDismiss
    gestures/             ← useLongPress, usePinchZoom
    screens/              ← экраны §5–§7
    components/           ← ScreenHeader, TabBar, MobileListRow, CallPill
    activity.ts           ← точка расширения §5.6
```

Контроллер вызывается **один раз** в `AppPage` и передаётся в оболочку
пропсом (`c: AppController`); побочные эффекты (WS-подписки,
`initCallBridge`, `initFriendBridge`, загрузка серверов) не дублируются при
смене оболочки на ресайзе. Автооткрытие первого канала при выборе сервера —
опция контроллера: `useAppController({ autoOpenChannel: !isMobile })`
(реализовано так на этапе 1; `selectServer` опций не принимает).

**Цена подхода A, замеченная на ревью этапа 1:** пересечение 900px на вебе
теперь перемонтирует дерево (оболочки разные), то есть теряются позиция
прокрутки, якорь непрочитанного и несохранённый черновик композера. В Electron
недостижимо (`minWidth: 900`).

Правило переиспользования (промт §5): мобильная оболочка — отдельные модули;
содержимое (лента, композер, плитки, формы) переиспользуется через **точечные
швы**, а не ветки `if (mobile)`:

| Компонент | Шов |
|---|---|
| `ChatArea` | проп `header?: ReactNode` (есть → вместо встроенной шапки); проп `searchMode?: 'inline' \| 'screen'` |
| `Composer` | проп `enterSends` (по умолчанию `true`; мобайл — `!coarsePointer`); проп `variant: 'mobile'` меняет только раскладку кнопок |
| `CallStage` | состояние → `useCallStageModel()`, плитки → `src/components/call/*`; десктопный `CallStage` = компоновка с тем же DOM |
| `ServerMenu` / `ChannelSidebar` / `FriendRow` | пункты меню → `useServerMenuItems` / `useChannelMenuItems` / `useFriendMenuItems` (возвращают `ContextMenuItem[]`) |
| `EditServerModal`, `ManageInvitesModal`, `StickerManager`, `FindServerModal`, создание сервера | тело → `*Body`-компонент; модалка и мобильный экран его оборачивают |
| `Settings` | разделы экспортируются отдельными компонентами; модалка компонует их как сейчас |
| `MessageRow` | проп `onLongPress?`; hover-действия прячутся `(hover: none)` |

## 2. Брейкпоинт

- TS: `src/mobile/breakpoint.ts` — `export const MOBILE_MQ = '(width < 900px)'`,
  `useIsMobile()` на `matchMedia` + `useSyncExternalStore` (SSR-safe нет нужды).
- CSS: литералы `(width < 900px)` / `(width >= 900px)` (PostCSS в сборке нет,
  `@custom-media` не заработает без нового тулинга).
- **Контрактный тест** `src/styles/__tests__/breakpoint-contract.test.ts` (по
  образцу `overlay-scrim-contract.test.ts`): все `@media` с условием по ширине
  во всех `src/**/*.css` ∈ { `width < 900px`, `width >= 900px`,
  `900px <= width < 1200px`, `width < 1200px` } (последние две — десктопные
  бенды AppPage, не мобильные). Временный allowlist старых `<= 768px` /
  `<= 640px` / `<= 720px` блоков с указанием файла; в этапе 7 он опустел
  (`LEGACY = {}`, см. строку 96 §10).
  Комбинации с `(hover: none)` и т.п. допустимы.

## 3. Навигация

### 3.1 Модель

```ts
type TabId = 'servers' | 'friends' | 'profile';     // + 'chats' в VYC-91
type Screen =
  | { kind: 'servers' } | { kind: 'friends' } | { kind: 'profile' }   // корни
  | { kind: 'channels'; serverId: string }
  | { kind: 'chat'; channelId: string }
  | { kind: 'channelInfo'; channelId: string }
  | { kind: 'call' }
  | { kind: 'serverSettings' | 'invites' | 'stickers'; serverId: string }
  | { kind: 'createServer' } | { kind: 'findServer' } | { kind: 'search' }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'friendAdd' }
  | { kind: 'guestCall' } | { kind: 'guestChat' } | { kind: 'guestParticipants' } // /guest, §7
  | { kind: 'sheet'; id: string };       // запись в истории под открытый sheet
type Stack = Screen[];                   // stack[0] — корень вкладки; на /guest — guestCall
```

`navReducer.ts` — чистые функции: `push`, `pop`, `replace`, `switchTab`
(→ `[root(tab)]`), `tabOf(stack)`, `isRoot(stack)`, `truncateInvalid(stack,
{servers, channels})`. Добавление вкладки «Чаты» (VYC-91) = новый `TabId`,
корень и `{kind:'dm'}` — без переделки.

### 3.2 Синхронизация с history

- Стек живёт в `location.state.m` роутера (`BrowserRouter` на вебе,
  `HashRouter` в Electron — оба поддерживают state).
- `push(s)` → `navigate(location.pathname, { state: { m: [...stack, s] } })`;
  `back()` → `navigate(-1)`; `replace` / `switchTab` → `navigate(…, { replace: true })`.
- Заход без `m` (первый вход, deep link, `/app` из закладки) → `replace` на
  `[{kind:'servers'}]`.
- Перезагрузка: `history.state` переживает reload → стек восстанавливается.
  Экраны, чьи сущности ещё не загружены, показывают скелетон; после загрузки
  `truncateInvalid` срезает стек до ближайшего валидного экрана (сервер/канал
  удалён или доступ потерян).
- Смена вкладки возможна только с корня (таб-бар виден лишь там), поэтому
  отдельные стеки по вкладкам не нужны.

### 3.3 Стек ↔ сторы

Экран — из стека, данные — из `serverStore`. Эффект в `MobileShell`: вершина
`chat{channelId}` (или `channelInfo`) и `currentChannel?.id !== channelId` →
`controller.selectChannel(channel)`; вершина `channels{serverId}` и
`currentServer?.id !== serverId` → `controller.selectServer(server, {openChannel:false})`.
Уход назад из чата канал **не** сбрасывает (WS-подписка на канал остаётся — как
на десктопе). `handleServerRemoved` / `handleChannelRemoved` контроллера
дополнительно зовут `truncateInvalid`.

### 3.4 Жест «назад» и переходы

- `useEdgeSwipeBack`: pointer-события, старт в `clientX ≤ 20`, фиксация оси
  после 10px (горизонталь доминирует), экран следует за пальцем; отпускание при
  смещении > 35% ширины или скорости > 0.5 px/ms → `back()`, иначе возврат.
  Выключен на корнях и на экране `call`. Пороги — чистая функция
  `decideSwipe({dx, dy, vx, width})`, TDD.
- Анимация: push — slide-in справа, pop — обратно, ≤ 250ms, `var(--ease-out)`;
  `prefers-reduced-motion` → только fade. Смонтированы верхний и предыдущий
  экраны (предыдущий нужен для свайпа), остальные размонтированы.
- iOS Safari имеет собственный свайп назад по истории: он вызывает тот же
  `popstate` → поведение совпадает; наш жест срабатывает в standalone-PWA, где
  системного нет.

### 3.5 Хром

- `TabBar`: 3 вкладки (иконка 22 + подпись), высота 56 + `safe-area-inset-bottom`,
  фон `--panel`, хэрлайн `--line` сверху, активная — `--accent-text`. Бейдж
  входящих заявок на «Друзьях». Виден только при `isRoot(stack)`.
- `ScreenHeader`: высота 56 + `safe-area-inset-top`; «назад» 44×44, заголовок +
  подзаголовок (обрезка многоточием), ≤ 2 иконки 44×44 справа; хэрлайн
  появляется при прокрутке контента.
- Оболочка: `height: 100dvh`, `overflow: hidden`; `TitleBar`, `.sidebar-gutter`,
  `.app-account-dock` на мобиле не рендерятся (их роли: Профиль, CallPill).

## 4. Sheets и overlay-контракт

### 4.1 `BottomSheet`

- Портал в `body`: `.modal-overlay.sheet-overlay > .sheet`. Использует
  **`useModalFocus(open, ref, onClose)`** — стек слоёв (Escape закрывает только
  верхний), ловушка Tab, `[data-autofocus]`, восстановление фокуса,
  `isBlockingOverlayOpen()`. Вторая система оверлеев не создаётся;
  `overlay-scrim-contract.test.ts` проходит без правки allowlist.
- z-index — `--z-overlay`; вложенность (sheet → ConfirmModal, sheet → sheet)
  решается порядком DOM, как для вложенных модалок сегодня.
- Геометрия: ширина `min(100%, 560px)` по центру; `max-height: 90dvh`; верхние
  углы `--radius-modal`; `padding-bottom: env(safe-area-inset-bottom)`. Фон
  `--panel`, ручка `--line-strong`, тень `--shadow-modal`, скрим `--scrim`.
  Новых токенов нет.
- Жест: тянут ручка и заголовок; тело — только при `scrollTop === 0`. Закрытие
  при смещении > 30% высоты или скорости > 0.5 px/ms, иначе возврат. Ручке —
  `touch-action: none`, телу — `overscroll-behavior: contain`.
- Анимация slide-up / fade (reduced-motion).

### 4.2 Закрытие «назад» — `useBackDismiss(open, onClose)`

При открытии кладёт `{kind:'sheet', id}` через `push`. `popstate`, убравший эту
запись → `onClose()`. Закрытие иным путём (скрим, свайп, Escape, выбор пункта)
→ `back()`, чтобы запись не «висела». Если sheet закрывается одновременно с
навигацией вперёд (пункт меню открывает экран), используется `replace` вместо
`back()+push`. TDD.

### 4.3 `ActionSheet`

`BottomSheet` + список `ContextMenuItem[]` (тот же тип, что у десктопного
`ContextMenu`): строки 52px, иконка 20, опасные пункты отдельной группой в
конце (правило board 1d), `disabledReason` — второй строкой.

### 4.4 Long-press — `useLongPress(cb, { ms: 450, moveTolerance: 8 })`

Отмена при смещении > допуска, скролле, `pointercancel`; гасит нативное
`contextmenu` на тач-вводе. На строках с long-press — `-webkit-touch-callout:
none`, `user-select: none` (в ленте текст копируется пунктом «Копировать»).
TDD на таймер/допуск.

### 4.5 Что куда переезжает

| Десктоп | Мобайл |
|---|---|
| `ContextMenu` сервера / канала / друга | `ActionSheet` (long-press или «⋯») |
| hover-действия сообщения | long-press → `ActionSheet` из `useMessageActions` |
| `GuestInvitePopover`, `VolumeControlPopover`, `ScreenSharePicker` (источник/качество), тултип качества | `BottomSheet` с тем же содержимым |
| `ExpressionPicker` (эмодзи/стикеры), `AttachmentButton` | «＋» композера → `ActionSheet` «Фото и видео / Файл / Эмодзи / Стикеры»; эмодзи и стикеры — `BottomSheet` с вкладками (`EmojiPanel` / `StickerPanel`) |
| `ConfirmModal`, `LinkDialog`, `CreateChannelModal`, `EditChannelModal` | остаются модалками; CSS `(width < 900px)` докладывает `.modal` снизу как sheet — разметка и хук те же |
| `EditServerModal`, `ManageInvitesModal`, `StickerManager`, `FindServerModal`, создание сервера, `Settings` | полноэкранные экраны стека через `*Body` (поэтому `.settings-modal` НЕ входит в правило «модалка снизу» этапа 1) |
| `CommandPalette` (⌘K) | экран `search` |
| `useDismissOnOutside`-поповеры | на мобиле не монтируются — их заменяют sheets (ловушка «внутри `.modal-overlay` теряется Escape» не возникает) |

### 4.6 Контракт меню-шторок (этап 2)

`ActionSheet` зовёт свой `onClose()` **до** `onClick` пункта. Поэтому
`ServerMenuSheet` / `ChannelMenuSheet` держат внутреннее состояние потока
(`none` / `confirm` / `rename` / `error`) и отдают `ActionSheet` отложенный на
микрозадачу `closeSheet`. Проп `onClose` хоста означает «взаимодействие с меню
закончено» и вызывается **ровно один раз**: либо шторку закрыли без выбора
пункта с потоком, либо поток закончился (отмена, успех, ошибка — после тоста
5 с). Хост держит сущность смонтированной (`open={x !== null}` + `server={x}`) и
обнуляет её только в `onClose`; тост ошибки живёт внутри компонента. Без
`onDeleted` пункт удаления скрыт. Пустое меню (нет прав) закрывается само. Стейл-
результат запроса не может завершить более новый поток (`flowSeq`).

Навигация из шторки: `nav.push` поверх записи `sheet` **заменяет** её. Порядок
«закрыть шторку → push» безопасен только благодаря метке ожидающей навигации в
`useMobileNav` (`location.key` + TTL): react-router 7 применяет `navigate()`
через `startTransition`, и без неё срочный рендер от закрытия шторки затирал
синхронный стек устаревшим — `useBackDismiss` вызывал `history.go(-1)` и откатывал
переход (найдено только в настоящем браузере; в jsdom не воспроизводилось без
специального теста).

## 5. Экраны аккаунта

### 5.1 Общее

`MobileListRow`: слот аватара/иконки 48, заголовок (`--ink`, 16/600),
вторая строка (`--muted`, 14), справа мета (время `--muted-2` / бейдж), высота ≥
64, хэрлайн `--line` с отступом под аватар, тач-фидбек `--canvas-2`. Фон экранов
`--canvas`. Тач-цели ≥ 44×44. Иконки lucide, `strokeWidth={1.8}`, размеры по
design-system.

### 5.2 Вкладка «Серверы» (корень)

- Шапка «Серверы»: поиск (→ `search`), «＋» → `ActionSheet` «Создать сервер»
  (→ `createServer`) / «Найти сервер или ввести код» (→ `findServer`).
- Строка сервера: аватар-скруглённый квадрат (`--radius-card`) на `--canvas-2`
  с `--ink` (**не** `--rail-*`: rail-разметка на `--canvas` запрещена без
  переопределения и фона, и ink — здесь rail-стили не используются вовсе).
  Вторая строка — голос, если известен (`voiceParticipants` × каналы
  **текущего** сервера), иначе пусто; данных о чужих серверах не выдумываем.
  Справа — `useServerActivity` (§5.6). Приватный — иконка замка 14.
- Long-press → `useServerMenuItems`. Пусто → существующая карточка «Нет
  серверов» (две кнопки).

### 5.3 `channels{serverId}`

Шапка: имя сервера / «N участников», «⋯» → меню сервера (настройки,
инвайты, стикеры, пригласить друзей, создать канал, удалить с подтверждением).
Строка канала: `#` в круге 48, имя, вторая строка «Аня, Борис +1 в голосе»
(из `voiceParticipants` + `members`) или превью (§5.6). Long-press → меню
канала (переименовать; удалить — `disabled` с `deleteLastDisabled` у последнего).
Тап → `chat`.

### 5.4 `chat{channelId}`

- `ChatArea` с `header={<ScreenHeader …/>}`: «назад», `#канал` /
  «сервер · N в звонке», справа — звонок (войти → `push(call)`; уже в нём →
  `push(call)`) и поиск. Тап по заголовку → `channelInfo`.
- Поиск: `MessageSearch` в режиме `screen` — во весь экран поверх ленты,
  выбор результата прокручивает ленту к сообщению (существующая логика).
- `VoiceBanner`, баннер гостей («N гостей видят сообщения»), разделители дней,
  «Новые сообщения», «к последним», подгрузка истории — без изменений логики.
- Лента: `overscroll-behavior: contain`; `(hover: none)` прячет hover-панель;
  long-press → `useMessageActions`: «Цитировать», «Копировать текст»,
  «Изменить» (своё), «Удалить» (своё/право, `ConfirmModal`), для неотправленных
  «Повторить» / «Отменить». Реакций нет — не добавляем.
- `FloatingQuoteButton` остаётся (выделение текста на тач-вводе вызывает
  `selectionchange`) — проверить на эмуляции, при неработоспособности
  цитирование закрыто пунктом sheet'а.
- Композер: шрифт 16px; автогроу до 6 строк; слева «＋», справа «Отправить»
  (скрыта при пустом поле без вложений); `enterSends = !coarsePointer` — на
  тач-вводе Enter переносит строку; кнопка «Aa» раскрывает `FormattingToolbar`
  над полем; `LinkDialog` — sheet-стиль; `MentionDropdown` — во всю ширину над
  композером; трей вложений с прогрессом/повтором/удалением — как есть.
  Drag&drop на тач-вводе недостижим — вложения через «＋» (выбор файлов, в т.ч.
  камера через `accept` без `capture`, чтобы система предложила выбор).
- Клавиатура: viewport-meta `interactive-widget=resizes-content` + оболочка
  `100dvh`; для iOS (meta игнорируется) — `useVisualViewportInset()` пишет
  `--keyboard-inset` на оболочку (JS-injected ⇒ потребители с фоллбеком
  `var(--keyboard-inset, 0px)`, внести в список design-system.md).
- Медиа: `MediaLightbox` полноэкранный (свайп влево/вправо — листание, вниз —
  закрыть; кнопки скачать/fullscreen как есть), `VideoPlayer` / `AudioPlayer` —
  тач-цели ≥ 44.

### 5.5 `channelInfo{channelId}`

Шапка «назад». Иконка `#` 72, имя, сервер. Ряд кнопок: «Звонок»,
«Поиск», «Пригласить гостя» (при праве и активном звонке). Секции:
«Участники» — `UserList` в мобильной раскладке (онлайн/офлайн, last seen с
приватностью, «в голосе · канал»; тап → `ActionSheet` «Позвонить»),
«Гости» (при наличии: удалить / удалить и заблокировать),
«Канал» (переименовать / удалить).

### 5.6 Точка расширения: активность каналов

`src/mobile/activity.ts`:

```ts
export interface ActivityPreview {
  authorName: string;
  kind: 'text' | 'attachment' | 'sticker' | 'call';
  text?: string;               // только для kind === 'text'
}
export interface ChannelActivity {
  preview: ActivityPreview | null;
  timestamp: string | null;    // ISO 8601
  unreadCount: number | null;  // null — число неизвестно
  hasUnread: boolean;          // «есть непрочитанное» (точка без числа)
}
export function useChannelActivity(channelId: string): ChannelActivity | null;
export function useServerActivity(serverId: string): ChannelActivity | null; // агрегат
/** Только для тестов и проб. */
export function __setActivityOverride(fn: ((id: string, scope: 'channel' | 'server') => ChannelActivity | null) | null): void;
```

Сейчас оба хука → `null` (без override). Строки не знают источника данных:
`null` → строка выглядит как в §5.2/§5.3; иначе — превью «Автор: текст» /
«📎 Вложение» / «Стикер» / «Звонок» (i18n), время (сегодня — ЧЧ:ММ, иначе
дата), бейдж `unreadCount` («99+» свыше 99) или точка `hasUnread`. Будущая
задача (серверные метки прочтения, API, WS-событие) меняет только тела хуков.
Визуальная проверка — оба состояния (override из пробы: длинный текст, 1234
непрочитанных, обе темы).

### 5.7 Вкладка «Друзья» (корень)

Шапка «Друзья», «＋» → `friendAdd` (sheet с `AddFriendForm`). Сегменты
Онлайн / Все / Ожидают (с бейджем) / Заблокированные — горизонтальный
сегмент-контрол. Строки — `MobileListRow` (аватар с присутствием, статус);
тап → `ActionSheet` из `useFriendMenuItems` (позвонить, удалить, заблокировать /
разблокировать); заявки — inline-кнопки «Принять / Отклонить / Отменить» 44px.
Бейдж входящих — на иконке вкладки.

### 5.8 Вкладка «Профиль» (корень)

Карточка: аватар 72, username, email; строка статуса микрофона и шумодава
(«NC on», из `UserPanel`). Список: Профиль / Приватность / Звук / Видео /
Внешний вид / Язык → `settings{section}` рендерит существующий компонент
раздела (аватар с кропом `AvatarCropModal` — модалка в sheet-стиле). Внизу
«Выйти» (`btn-danger-soft`) → `ConfirmModal`.

### 5.9 Полноэкранные формы

`createServer` (имя, приватность), `findServer` (`FindServerModal`-тело:
поиск, по коду с числом участников, «создать свой»), `serverSettings`
(`EditServerModal`-тело: имя, иконка с кропом, приватность, тумблер гостевых
ссылок, удаление), `invites` (`ManageInvitesModal`-тело + карточка
«Пригласить друзей»), `stickers` (`StickerManager`-тело: загрузка, имя,
удаление). Одна основная кнопка внизу экрана над safe-area/клавиатурой.

### 5.10 `search` (замена ⌘K)

Поле поиска в шапке (autofocus), группы как в `CommandPalette`: каналы
текущего сервера, сообщения текущего канала (при открытом канале), действия
(создать канал, войти в голос, настройки, тема, создать/найти сервер, искать в
канале). Использует `paletteFilter` и тот же поисковый API; хоткей не нужен.

### 5.11 Auth

Структура `AuthPage` без изменений; CSS-полировка `(width < 900px)`: поля 16px,
safe-area, основная кнопка у низа, клавиатура не перекрывает поле. `OtpCodeInput`
— проверить `autocomplete="one-time-code"` + `inputmode="numeric"` (добавить при
отсутствии). Все сценарии: OTP (повтор с таймером, смена email), пароль,
неподтверждённый email, выбор username.

## 6. Звонки

### 6.1 Разрез `CallStage`

Плитки (`StageTile`, `StageThumb`, `ConnectionIndicator`, …) → `src/components/call/`;
состояние/обработчики (мик, камера, шаринг, фокус, фуллскрин, громкость,
пикеры, лобби, предупреждения) → `useCallStageModel({ onLeave })`. Десктопный
`CallStage` — компоновка с идентичным DOM (скриншот 1280 до/после, тесты
`callStage.test.ts`). `callStore`, `services/call.ts`, `groupCall.ts` не
меняются.

### 6.2 `MobileCallScreen` (экран `call`)

- Фон `--stage-*`; таб-бар и свайп-назад выключены.
- Верх (safe-area): «свернуть» (`ChevronDown` → `back()`), `#канал`, таймер,
  индикатор качества (тап → sheet: потери/пинг/битрейт). «Переподключение…» —
  плашка под верхом. Баннер «X показывает экран — Смотреть / Скрыть».
- Сетка — `mobileGridLayout(count, orientation)` (чистая, TDD): 1 → весь экран;
  2 → вертикально (landscape — горизонтально); 3–4 → 2×2; ≥ 5 → 2 колонки с
  прокруткой. Своя плитка — PiP в углу при ≥ 2 плитках (перетаскивается к
  ближайшему углу).
- Тап по плитке → фокус (плитка на весь экран, остальные — лента снизу);
  повторный → сетка. Long-press по плитке → sheet громкости участника.
- Панель (safe-area), кнопки 56 с подписями: Микрофон · Камера · Динамик ·
  Чат · «⋯» · Выйти (`--stage-danger`).
  - Динамик — `setSinkId` при наличии (Android Chrome), иначе скрыт.
  - Чат → `push(chat{callChannelId})`, в шапке чата — `CallPill`.
  - «⋯» → `ActionSheet`: Пригласить гостя (sheet `GuestInvitePopover`-тела),
    Демонстрация экрана (только если `getDisplayMedia` есть; пикер качества —
    sheet), Качество связи, Громкость участников (sheet со слайдерами), Гости
    в звонке.
- Предупреждения о правах медиа и «вошли без камеры и микрофона» —
  существующие баннеры в мобильной раскладке.
- Просмотр демонстрации: фокус → «на весь экран» (`requestFullscreen` +
  `screen.orientation.lock('landscape')` в `try`); `usePinchZoom` (двумя
  пальцами, двойной тап — сброс; TDD) на видео, `touch-action: none` на нём
  при активном зуме.
- Лобби: `GuestLobbyToast` — плашка под верхом (впустить / отклонить /
  «и ещё N» → sheet со всеми).

### 6.3 `CallPill`

«● #канал · 03:12» + кнопка мика. Над таб-баром на корнях, под `ScreenHeader` на
прочих экранах, скрыта на `call`. Тап → `back()` до `call`, если он в стеке, иначе
`push(call)` (через `selectChannel` канала звонка, если нужно). Заменяет
`CallDock` на мобиле.

### 6.4 p2p (`CallUI`) и приглашения

- Входящий: `.p2p-overlay.is-incoming` на мобиле — `inset: 0`, крупные «Принять»
  (`--online`) / «Отклонить» (`--danger`), safe-area. Логика не меняется;
  запись в `isBlockingOverlayOpen` уже есть.
- Активный p2p — CSS-раскладка по правилам §6.2 (вертикальная, PiP, нижняя панель).
- `CallNotifBanner` («X зовёт вас в #канал»): плашка сверху с safe-area;
  «Войти» → `selectChannel` + `join` + `push(chat)` + `push(call)`.
- Split-handle на мобиле не рендерится.

## 7. Гостевая страница `/guest`

- `entry`: колонка — превью камеры 4:3, тумблеры мик/камера под ним, имя (16px,
  `autocomplete="nickname"`, `enterkeyhint="go"`), «Попросить войти» прижата к
  низу над safe-area/клавиатурой; «в звонке: N».
- Ошибки (`guestErrors.ts`): битая ссылка, неподдерживаемый браузер,
  нет доступа к медиа (с «войти без них») — полноэкранные состояния с одним
  действием. Проверить текст про in-app браузеры; при отсутствии — добавить
  подсказку (i18n ru+en).
- `lobby` / `joining`: центр + «Отменить». `connecting` / `resuming`: спиннер.
- `in_call`: `MobileCallScreen` в гостевом режиме (`onLeave`); «Чат» и
  «Участники» — экраны поверх звонка (через `useMobileNav`, корень `guestCall`),
  бейдж непрочитанного на «Чат»; «вы видите сообщения с момента входа».
- `ended` (left / kicked / revoked / guestsDisabled / rejected / timeout /
  disconnected / sessionExpired): полноэкранная карточка + CTA регистрации.
- `GuestCallView.css` `(width <= 720px)` → `(width < 900px)` (сделано этапом 6 — правило удалено, а не мигрировано; см. «Этап 6 — отложено»).

## 8. PWA

- `public/manifest.webmanifest`: `name` «VYCORD», `short_name` «VYCORD»,
  `start_url` `/app`, `scope` `/`, `display` `standalone`, `orientation` `any`,
  `background_color` / `theme_color` — литерал цвета `--canvas` светлой темы
  (JSON не читает `tokens.css`; добавить манифест в список не-CSS исключений
  design-system.md), иконки: `icons/icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png` (`purpose: maskable`, логотип в safe-zone 80%).
- `index.html`: `<link rel="manifest">`, `theme-color` ×2 c
  `media="(prefers-color-scheme: …)"` + `themeStore` обновляет
  `meta[name=theme-color]` под выбранную тему, `apple-touch-icon` 180,
  `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`
  `black-translucent`, viewport `…, viewport-fit=cover,
  interactive-widget=resizes-content`.
- Иконки — временные апскейлы `favicon.png` на фоне с полями (ImageMagick,
  команда в плане этапа 1); follow-up — исходник ≥ 512.
- Без service worker. `base: './'` → пути в манифесте относительно документа
  проверить на `/app` и `/guest`. Electron (`file://`) игнорирует манифест —
  проверить, что `npm run build` проходит.
- `public/favicon.svg` — дефолтный логотип Vite, не используется
  `index.html` → удалить в этапе 7 (или follow-up, если где-то используется).
  **Сделано в этапе 7:** ссылок на файл нигде не было (приложение использует
  `favicon.png`) — `client/public/favicon.svg` удалён.

## 9. Этапы (каждый — предлагаемый коммит)

1. **Каркас**: 1280-скриншоты «до»; `breakpoint.ts` + контрактный тест;
   вынос `useAppController` / `DesktopShell` (десктоп пиксель-в-пиксель);
   `nav/*`, `TabBar`, `ScreenHeader`, `BottomSheet` / `ActionSheet` /
   `useBackDismiss`, `useLongPress`; PWA + safe-area; `MobileShell`, который на
   первом шаге монтирует существующие панели как экраны стека (servers →
   channels → chat → call → members) — без потери функций.
2. **Серверы и каналы**: §5.2, §5.3, §5.9, `useServerMenuItems`,
   `useChannelMenuItems`, `activity.ts`.
3. **Чат**: §5.4, §5.5, §5.10, `useMessageActions`, лайтбокс.
4. **Звонки**: §6.
5. **Друзья и профиль**: §5.7, §5.8, §5.11.
6. **Гость**: §7.
7. **Зачистка**: удаление `data-mobile-panel`-модели и `onMobileBack*`,
   все компонентные брейкпоинты → `< 900px`, пустой allowlist, сверка §10.
   **Сделано (этап 7)**: удалён мёртвый блок `@media (width < 900px)` в
   `AppPage.css` (модель `data-mobile-panel` + «navigation affordances»;
   `DesktopShell` ниже 900px не монтируется); из `HomeView`, `ChatArea`,
   `UserList`, `ChannelSidebar` убраны никогда не передававшийся проп
   `onMobileBack`, кнопки «назад» и скрытые обёртки `.home-view-mobile-header` /
   `.user-list-mobile-header` вместе с CSS; из `CallStage` — `onMobileBackToChat`
   и `.stage-back-btn`; удалены легаси-блоки `<= 768px` / `<= 640px` в
   `CallStage.css` (6 блоков, относившихся только к `CallStage`),
   `ChannelSidebar.css`, `CommandPalette.css`, `FriendsPanel.css`,
   `ServerList.css`; общий блок `.stage-focus-btn` / `.stage-volume-btn` /
   `.stage-share-badge` (им пользуется и `MobileCallScreen` через
   `RemoteParticipantTile`) перенесён на `@media (width < 900px)`;
   `LEGACY = {}` в `breakpoint-contract.test.ts`; новый охранный тест
   `legacy-mobile-model.test.ts`; сверка §10 — ниже; хвосты — «Этап 7 —
   отложено и найдено по пути» и «Итоговые follow-ups» в §13.

## 10. Таблица покрытия

Колонка «Проверка» заполнялась при приёмке каждого этапа: «✅ + скриншот/шаг».
**Итог этапа 7:** ни одна строка не осталась «план»/⏳. Значения: «✅» —
подтверждено указанным доказательством; «принято (этап 7)» — осознанное
закрытие без полной проверки, причина и оставшийся пробел указаны в самой строке
(не подтверждение). Оговорка о доказательствах: `.superpowers/` в git-игнорe, и
часть материалов старых этапов на диске не сохранилась — снимки этапа 6
(`.superpowers/sdd/2026-09-23-mobile-stage6-guest/shots/*`, строки 65–69) и
`BASE_TREE`/`snap.sh` этапа 5 (строка 97) на момент сверки отсутствуют; эти
ссылки — историческая запись того, что проверялось, а не воспроизводимое
доказательство. Остальные пути `.superpowers/vyc95/s1…s5` сверены по файловой системе — на месте
(в строке 42 шаблон `info-{390x844,info-scroll}-*` содержал опечатку; реальный
файл — `info-scroll-390x844-{light,dark}.png`, строка исправлена).

| # | Функция (промт §3) | Десктоп | Мобайл: где живёт | Этап | Проверка |
|---|---|---|---|---|---|
| **Auth** |
| 1 | Вход по email-коду (OTP, повтор с таймером, смена email) | `AuthPage`, `OtpCodeInput` | `AuthPage` (CSS-полировка), OTP `one-time-code` + `numeric` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/auth-code-{light,dark}.png` (шаг `code`, таймер «Отправить повторно через 60 с», «Изменить email»), мок `POST /auth/otp/request` |
| 2 | Вход по паролю | `AuthPage` | `AuthPage` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/auth-password-{light,dark}.png` |
| 3 | Подтверждение неподтверждённого email | `AuthPage` | `AuthPage` | 5 | принято (этап 7): ✅ этап 5 для общего шага, ветка `email_not_verified` без отдельного снимка — тот же шаг `code`/тот же JSX-блок `AuthPage.tsx`, что и п.1 (различается только текст `codeSent ? … : t('auth.emailNotVerifiedTitle')`, разметка идентична); скриншот снят для варианта `codeSent=true` (п.1), ветка `email_not_verified` (из `handlePasswordSubmit`) отдельно не переснята — общий CSS-полиш (T6) применяется к обеим веткам одинаково, т.к. в файле нет шаг-специфичных стилей. Итог этапа 7: принято без пересъёмки — она потребовала бы мока `POST /auth/login` с ответом `email_not_verified`, а разметка/CSS ветки идентичны уже снятой. Пробел (только отдельный снимок этой ветки) не блокирует |
| 4 | Выбор username при регистрации | `AuthPage` | `AuthPage` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/auth-username-{light,dark}.png`, мок `POST /auth/otp/verify` → `username_required` |
| **Серверы** |
| 5 | Список серверов | `ServerList` | вкладка «Серверы», `MobileListRow` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/servers-390x844-{light,dark}.png`, `ServersScreen.test.tsx` |
| 6 | «Главная» (друзья) | `ServerList` → `HomeView` | вкладка «Друзья» | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/friends-{online,all,pending,blocked}-{light,dark}.png`, `FriendsScreen.test.tsx` |
| 7 | Создать сервер (имя, приватность) | модалка в `AppPage` | «Серверы» → «＋» → экран `createServer` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile2/create-server-390x844-{light,dark}.png`, `CreateServerScreen.test.tsx` |
| 8 | Найти сервер по имени / коду, вступить, число участников | `FindServerModal` | «＋» → экран `findServer` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile2/find-server-390x844-{light,dark}.png`, `FindServerScreen.test.tsx`, `FindServerBody.test.tsx` |
| 9 | Меню сервера | `ServerMenu` (`ContextMenu`) | long-press строки / «⋯» в `channels` → `ActionSheet` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/servers-menu-390x844-*.png`, `channels-server-menu-390x844-*.png`, `serverMenu.test.tsx` |
| 10 | Настройки сервера: имя, иконка с кропом, приватность, тумблер гостевых ссылок | `EditServerModal`, `AvatarCropModal` | экран `serverSettings` (кроп — модалка sheet-стиля) | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/server-settings-{375x812,390x844,768x1024}-*.png`; кроп-модалка — только тесты (jsdom не декодирует картинку) |
| 11 | Инвайт-ссылки: создать / копировать / отозвать, счётчик | `ManageInvitesModal` | экран `invites` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/invites-390x844-*.png`, `InvitesScreen.test.tsx` |
| 12 | Карточка «Пригласить друзей» | `ManageInvitesModal` / меню | экран `invites` + пункт меню сервера | 2 | ✅ этап 2 — карточка на `.superpowers/vyc95/s2/mobile/invites-390x844-*.png`; создание при первом копировании — `InvitesScreen.test.tsx` |
| 13 | Удалить сервер (подтверждение) | `ServerMenu` → `ConfirmModal` | меню сервера → `ConfirmModal` (sheet-стиль) | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/delete-confirm-390x844-*.png` (ConfirmModal шторкой), `serverMenu.test.tsx` (поток, ошибка, двойной тап) |
| 14 | Стикеры сервера: загрузка, имя, удаление | `StickerManager` | экран `stickers` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/stickers-390x844-*.png`, `StickerManagerBody.test.tsx`; подсказка дропзоны — `stickerDropHint` = «Перетащите файл сюда или нажмите, чтобы выбрать»: тач-путь («нажмите, чтобы выбрать») в строке уже есть — принято (этап 7), отдельной мобильной формулировки не будет |
| **Каналы** |
| 15 | Список каналов | `ChannelSidebar` | экран `channels` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/channels-{375x812,390x844}-*.png`, `ChannelsScreen.test.tsx` |
| 16 | Создать канал | `CreateChannelModal` | меню сервера → модалка sheet-стиля | 2 | ✅ этап 2 (пункт меню) + принято (этап 7) для самой модалки — пункт «Создать канал» есть в `useServerMenuItems.tsx` → `ServerMenuSheet` (i18n `channel.createChannelMenu`); то же действие из палитры открывает ту же модалку — `SearchScreen.test.tsx` (`setCreateChannelOpen(true)`). `CreateChannelModal` — потребитель примитива `.modal` (`modal-overlay`/`modal`), который ниже 900px становится шторкой (`primitives.css`, `@media (width < 900px)`, общий вид — `.superpowers/vyc95/s1/confirm-390-{light,dark}.png`). Отдельный снимок самой модалки не делается: собственной мобильной вёрстки у неё нет, полноэкранная форма отклонена (см. «Этап 2 — отложено»). Не проверено в браузере: именно эта модалка; отдельного теста пункта меню в `serverMenu.test.tsx` нет (по grep) — доказательство пункта — код и палитровый тест |
| 17 | Переименовать канал | `EditChannelModal` | long-press канала / `channelInfo` → модалка | 2 | ✅ этап 2 — пункт на `.superpowers/vyc95/s2/mobile/channel-menu-390x844-*.png`, `channelMenu.test.tsx` (в т.ч. гонка сохранения); снимка самой модалки нет |
| 18 | Удалить канал (последний нельзя) | `ChannelSidebar` меню | long-press / `channelInfo`, `disabledReason` | 2 | ✅ этап 2 — пункты на `.superpowers/vyc95/s2/mobile/channel-menu-390x844-*.png`; `disabledReason` у последнего канала и повторная проверка при удалении — `channelMenu.test.tsx` |
| 19 | Индикатор голоса в канале и кто в нём | `ChannelSidebar`, `VoiceBanner` | вторая строка канала; `VoiceBanner` в чате | 2–3 | ✅ этап 2 (вторая строка) + этап 3 (`VoiceBanner` — только снимок `.superpowers/vyc95/s3/mobile/frames/voice-390x844-*.png`; теста, рендерящего `VoiceBanner`, нет) |
| 20 | У канала и чат, и звонок | `ChatArea` + `CallStage` | `chat` + кнопка звонка → `call` | 3–4 | ✅ этап 3 + этап 4 — `chat`: кнопка звонка в шапке (`ChatScreen.tsx`) входит в звонок, если вы не в нём, и открывает экран `call`, если уже в нём — `client/src/mobile/screens/__tests__/ChatScreen.test.tsx` («the call button joins when not in the call and opens the call screen when in it»); экран `call` — этап 4, не этап 3 (строки 45–61 выше: `MobileCallScreen.test.tsx`, `.superpowers/vyc95/s4/mobile/`, `mobile-refix/`); переход `chat` → `call` и обратно (`CallPill`) — строки 58–59 |
| **Чат** |
| 21 | Лента, разделители дней, «Новые сообщения», «к последним», подгрузка истории | `ChatArea` | `chat` (та же `ChatArea`) | 3 | ✅ этап 3 — `ChatArea.dom.test.tsx`, `ChatScreen.test.tsx`, `.superpowers/vyc95/s3/mobile/frames/chat-{top,mid}-390x844-*.png` |
| 22 | Правка («изменено») | `MessageRow` hover | long-press → «Изменить» | 3 | ✅ этап 3 — `MessageRow.mobile.test.tsx`, `.superpowers/vyc95/s3/mobile/frames/edit-390x844-*.png` |
| 23 | Удаление (подтверждение) | `MessageRow` → `ConfirmModal` | long-press → «Удалить» → `ConfirmModal` | 3 | ✅ этап 3 — `useMessageActions`/`MessageActionsSheet.test.tsx` |
| 24 | Статусы «отправляется / не отправлено → повторить / отменить» | `MessageRow` | inline + long-press «Повторить/Отменить» | 3 | ✅ этап 3 — `MessageRow.mobile.test.tsx` |
| 25 | Цитирование | `MessageRow` hover | long-press → «Цитировать» | 3 | ✅ этап 3 — `useMessageActions.test.tsx`, `verify-c-report.md` проба 6 |
| 26 | Плавающая кнопка цитаты при выделении | `FloatingQuoteButton` | та же (проверка на тач-вводе); запасной путь — пункт sheet'а | 3 | ✅ этап 3 — запасной путь (long-press → «Цитировать») покрыт; сам компонент не переделывался (десктопная логика, seam не требовался) |
| 27 | Упоминания с автодополнением | `MentionDropdown` | над композером во всю ширину | 3 | ✅ этап 3 — `Composer.mobile.test.tsx` |
| 28 | Форматирование: жирный, курсив, подчёркнутый, списки | `FormattingToolbar` (хоткеи) | кнопка «Aa» → панель над полем | 3 | ✅ этап 3 — `Composer.mobile.test.tsx`, `.superpowers/vyc95/s3/mobile/frames/aa-390x844-*.png` |
| 29 | Ссылка | `LinkDialog` | из панели «Aa» → `LinkDialog` sheet-стиля | 3 | ✅ этап 3 — та же панель «Aa», `Composer.mobile.test.tsx` |
| 30 | Эмодзи (частые + категории) | `ExpressionPicker`, `EmojiPanel` | «＋» → sheet «Эмодзи» | 3 | ✅ этап 3 — `ExpressionPicker.dom.test.tsx`, `MobileExpressionSheet`, `.superpowers/vyc95/s3/mobile/frames/emoji-*.png` |
| 31 | Стикеры | `StickerPanel` | «＋» → sheet «Стикеры» | 3 | ✅ этап 3 — та же `MobileExpressionSheet` (вторая вкладка), `.superpowers/vyc95/s3/mobile/frames/stickers-*.png` |
| 32 | Вложения image/video/audio/file | `AttachmentButton` | «＋» → «Фото и видео / Файл» | 3 | ✅ этап 3 — `useFilePicker`, `MobileAttachSheet`, `verify-c-report.md` проба 8 (`input.click()` синхронно) |
| 33 | Трей вложений: прогресс, повтор, удаление | `AttachmentTray` | над композером, как есть | 3 | ✅ этап 3 — desktop-компонент без seam'ов (не мобилизировался, поведение унаследовано), `Composer.mobile.test.tsx` |
| 34 | Drag&drop | `ChatArea` | недостижим на тач-вводе; эквивалент — «＋» | 3 | ✅ этап 3 — эквивалент «＋» покрыт (см. п. 32), сам d&d на тач-вводе недостижим по определению |
| 35 | Лайтбокс: листание, скачивание, fullscreen | `MediaLightbox` | полноэкранный, свайпы, landscape | 3 | ✅ этап 3 — `lightboxSwipe.test.ts`, `MediaLightbox.swipe.test.tsx`, `.superpowers/vyc95/s3/mobile/frames/lightbox-{390x844,844x390}-*.png`, `verify-c-report.md` проба 9 |
| 36 | `AudioPlayer`, `VideoPlayer` | — | в ленте, тач-цели ≥ 44 | 3 | ✅ этап 3 — `verify-c-report.md` проба 11 (`audio-play-btn` ±21px); наезд `.attachment-download`/`.audio-time` найден и исправлен (Verify B D2) |
| 37 | Строки событий звонков (начал, длительность, участники, гости) | `CallEventRow` | в ленте, как есть | 3 | ✅ этап 3 — desktop-компонент без seam'ов, снимка в матрице нет (фикстуры без call-событий), не мобилизировался намеренно (обычная строка ленты) |
| 38 | Поиск по каналу | `MessageSearch` | иконка в шапке `chat` / `channelInfo` → полноэкранный режим | 3 | ✅ этап 3 — `ChatArea.seams.test.tsx`, `MobileMessageSearch`, `.superpowers/vyc95/s3/mobile/frames/search-{empty,q,none}-390x844-*.png`, `verify-c-report.md` пробы 1, 3 |
| 39 | Пустые состояния (нет серверов, тишина в канале, приветствие) | `ChatArea` | те же карточки в `chat` / «Серверы» | 2–3 | ✅ этап 2 (нет серверов) + этап 3 («тишина в канале» — `.superpowers/vyc95/s3/mobile/frames/empty-390x844-*.png`, `ChatScreen.test.tsx`) |
| 40 | Бейдж гостя в сообщениях | `MessageRow` | как есть | 3 | ✅ этап 3 — desktop-компонент без seam'ов (CSS уже мобильный из этапа 1), поведение унаследовано |
| 41 | Баннер «N гостей видят сообщения» | `ChatArea` | под шапкой `chat` | 3 | ✅ этап 3 — desktop-компонент без seam'ов, поведение унаследовано |
| **Участники** |
| 42 | Онлайн / офлайн, last seen (приватность) | `UserList` | `channelInfo` → «Участники» | 3 | ✅ этап 3 — `useMemberList.test.tsx`, `ChannelInfoScreen.test.tsx`, `.superpowers/vyc95/s3/mobile/frames/info-390x844-*.png`, `info-scroll-390x844-*.png` |
| 43 | «В голосе · канал» | `UserList` | `channelInfo` | 3 | ✅ этап 3 — `useMemberList.test.tsx` (`voiceNameFor`) |
| 44 | Позвонить пользователю | `UserList` | тап по участнику → `ActionSheet` «Позвонить» | 3 | ✅ этап 3 — `ChannelInfoScreen.test.tsx`, `.superpowers/vyc95/s3/mobile/frames/info-call-390x844-*.png` |
| **Звонки** |
| 45 | Войти / выйти в групповой звонок | `ChatArea`, `CallStage` | кнопка в шапке `chat`, `VoiceBanner`, `channelInfo`; «Выйти» на панели | 4 | ✅ этап 4 — вход этапа 3 (кнопка в шапке `chat` — `ChatScreen.test.tsx`; `VoiceBanner`/`channelInfo` тестами не покрыты), «Выйти» — `MobileCallScreen.test.tsx` (`m.handleLeaveGroupCall`) |
| 46 | Сетка плиток | `CallStage` | `mobileGridLayout` | 4 | ✅ этап 4 — `callStage.test.ts` (8 кейсов, портрет/пейзаж/1–5+), визуально `.superpowers/vyc95/s4/mobile{,-refix}/`; раскладка изначально не заполняла экран для 1–4 участников (блокер приёмки T9) — исправлено (см. «отложено» и ledger), пересъёмка подтвердила |
| 47 | Фокус на участнике | `CallStage` | тап по плитке | 4 | ✅ этап 4 — `MobileCallScreen.test.tsx`; именная подпись добавлена приёмочным фиксом (изначально отсутствовала) |
| 48 | Fullscreen | `CallStage` | экран уже полный; fullscreen — для демонстрации | 4 | ✅ этап 4 — экран сам полноэкранный; `requestFullscreen`+`screen.orientation.lock('landscape')` на фокусе демонстрации (`MobileCallScreen.tsx`, в `try`) — не проверено на реальном устройстве |
| 49 | Микрофон / камера | `CallStage` | нижняя панель | 4 | ✅ этап 4 — `MobileCallScreen.test.tsx`, 56×56 подтверждено пробой `elementFromPoint` |
| 50 | Демонстрация экрана (источник, качество) | `ScreenSharePicker` | «⋯» → только при `getDisplayMedia`; пикер — sheet | 4 | ✅ этап 4 — `useCallOverflowItems.test.ts` (гейт по `getDisplayMedia`, живой браузерный пробой оба направления), `MobileScreenQualitySheet`/`ScreenQualityBody`; источник (Electron-пикер) на мобиле недостижим по определению (§0) — только браузерный путь |
| 51 | Просмотр чужой демонстрации («Смотреть») + баннер «X показывает экран» | `CallStage` | фокус → fullscreen, landscape, pinch-zoom | 4 | ✅ этап 4 — баннер `MobileCallScreen.test.tsx`, `usePinchZoom`/`pinchZoom.test.ts` (6 кейсов), fullscreen+landscape-lock — см. строку 48 |
| 52 | Громкость участника | `VolumeControlPopover` | long-press плитки / «⋯» → «Громкость участников» | 4 | принято (этап 7) — частично: «⋯» → `CallVolumeSheet` (`client/src/mobile/call/CallVolumeSheet.tsx`, слайдеры всех участников) реализовано; тестом покрыт только пункт меню «Громкость участников» (`client/src/mobile/call/useCallOverflowItems.test.ts`), сама шторка со слайдерами тестом НЕ покрыта (`CallVolumeSheet` не встречается ни в одном тесте; `MobileCallScreen.test.tsx` лишь подставляет громкостные пропы); кнопка громкости на самой плитке `RemoteParticipantTile` смонтирована, но не подключена (`isVolumePopoverOpen={false}`, `onToggleVolumePopover={() => {}}` в `MobileCallScreen.tsx`) — видимая, но ничего не делающая кнопка. Функция «громкость участника» на мобиле достижима, поэтому строка принята; сама кнопка на плитке — реальный дефект, вынесен в «Итоговые follow-ups» (подключить к `CallVolumeSheet` или скрыть) |
| 53 | Индикатор качества с деталями | `ConnectionIndicator` | верх экрана → sheet | 4 | ✅ этап 4 — `CallQualitySheet`, оба входа (тап по индикатору в шапке и «⋯» → «Качество связи») ведут в один и тот же sheet напрямую (D6); изначально тап по шапке открывал общее меню «⋯» вместо прямого перехода — блокер приёмки T9, исправлено, подтверждено живым кликом |
| 54 | «Переподключение…» | `CallStage` | плашка под верхом | 4 | ✅ этап 4 — `MobileCallScreen.test.tsx` |
| 55 | Предупреждения о разрешениях медиа, «вошли без камеры/мика» | `CallStage` | баннеры в мобильной раскладке | 4 | ✅ этап 4 — `m.stageError`/`mediaWarning` из общего хука, тост переиспользует `.error-toast` |
| 56 | Входящий личный звонок (принять / отклонить) | `CallUI` | полноэкранный `.p2p-overlay.is-incoming` | 4 | ✅ этап 4 — только CSS (`CallUI.tsx` не менялся), `.superpowers/vyc95/s4/mobile/p2p-incoming-*.png` |
| 57 | Исходящий / активный личный звонок, завершить | `CallUI` | мобильная раскладка `.p2p-overlay.is-active` | 4 | ✅ этап 4 — только CSS; PiP фиксированного угла (без перетаскивания, D4 — отличие от группового звонка, осознанное); `.superpowers/vyc95/s4/mobile/p2p-active-*.png` |
| 58 | Сплит «звонок ↔ чат», возврат в чат | `call-split-handle` | «Чат» на панели ↔ `CallPill` | 4 | ✅ этап 4 — на мобиле нет сплита (не подходит формату экрана), функционально эквивалентно: кнопка «Чат» на панели звонка → push `chat`, `CallPill` в шапке чата → назад в `call` |
| 59 | Возврат в звонок из другого места | `CallDock` | `CallPill` | 4 | ✅ этап 4 — `CallPill.test.tsx`, оба варианта размещения (`root`/`stacked`) визуально подтверждены; `CallDock`/`DesktopShell` не тронуты |
| 60 | «X зовёт вас в звонок» | `CallNotifBanner` | плашка сверху, «Войти» → `call` | 4 | ✅ этап 4 — только CSS (safe-area), `CallNotifBanner.tsx` не менялся |
| 61 | Динамик (вывод звука) | — (настройки) | кнопка «Динамик» при `setSinkId` | 4 | ✅ этап 4 — `useAudioOutput.test.ts` (гейт по `setSinkId` + >1 устройства), кнопка на панели, `MobileCallScreen.test.tsx`; изначально не была подключена к экрану — блокер приёмки T9, исправлено; реальное многоустройственное переключение не проверено (нет устройства), плюс известный дефект dev-режима — см. «отложено» |
| **Гости** |
| 62 | Пригласить гостя: создать, копировать, мои ссылки, отозвать | `GuestInvitePopover` | «⋯» звонка / `channelInfo` → sheet | 4 | ✅ этап 4 — `GuestInviteBody` (общее тело, вынесено из `GuestInvitePopover`), `MobileGuestSheet`; десктопный поповер не покрыт файловым снимком (не открывается в фикстурах `CallStage.dom.test.tsx`) — проверен отдельным скриншотом реального клика в приёмке T9, AE=0 |
| 63 | Лобби: впустить / отклонить, «и ещё N» | `GuestLobbyToast` | плашка в звонке + sheet со всеми | 4 | ✅ этап 4 — desktop-компонент без seam'ов, переиспользован как есть (гейт `!isGuestMode`, как на десктопе) |
| 64 | Список гостей: удалить / удалить и заблокировать | `GuestInvitePopover` | «⋯» → «Гости в звонке»; `channelInfo` | 4 | ✅ этап 4 — решение D5: пункты «Пригласить гостя» (62) и «Гости в звонке» (64) — один и тот же `MobileGuestSheet` (десктопный поповер тоже не разделяет эти функции); `channelInfo` не получил интеграцию гостей на этом этапе (см. D7 этапа 3 — за пределами этапа 3, этап 4 её тоже не добавляет, только «⋯» звонка) |
| 65 | `/guest`: имя, превью камеры/мика, «попросить войти» | `GuestPage` | §7 `entry` | 6 | ✅ этап 6 — живой `smoke.mjs` (`--anon --touch --size 390x844`, store-фикстура через `useGuestCallStore.setState`), обе темы: `.superpowers/sdd/2026-09-23-mobile-stage6-guest/shots/guest-entry-390-fixed.png` (light), `guest-entry-dark.png`; `getComputedStyle` пробой подтверждено `font-size: 16px` на имени (без iOS-зума) и `min-height: 44px` на тумблерах/сабмите; найден-и-исправлен дефект — `.guest-preview` имел `aspect-ratio: 16/9` без мобильного override (спека требует 4:3) — добавлен `@media (width < 900px) { .guest-preview { aspect-ratio: 4/3 } }` в `GuestPage.css`, подтверждено пробой (`width/height` = 1.333 на мобиле, 1.778 на десктопе — не тронут) |
| 66 | `/guest`: ожидание | `GuestPage` | §7 `lobby` | 6 | ✅ этап 6 — `smoke.mjs` со `phase: 'lobby'` через `useGuestCallStore.setState`, 390×844: `.superpowers/sdd/2026-09-23-mobile-stage6-guest/shots/guest-lobby-light.png` — карточка читаема, «Отменить» подпадает под `.guest-card .btn { min-height: 44px }` |
| 67 | `/guest`: звонок с «Чат / Участники» | `GuestCallView` | `MobileCallScreen` + экраны поверх | 6 | принято (этап 7): этап 6, частично (см. «Этап 6 — отложено»; файлы снимков на диске не сохранились, см. оговорку в начале §10) — `smoke.mjs` со `useCallStore`/`useGuestCallStore.setState` (поля — как в `GuestMobileCallShell.test.tsx`), 390×844: `MobileCallScreen` рендерится вместо десктопной `GuestCallView` (`.superpowers/sdd/2026-09-23-mobile-stage6-guest/shots/guest-incall-v2-mobile.png`, бейдж непрочитанного «2» на кнопке чата виден); клик по кнопке чата открывает `GuestChatScreen` на весь экран с обеими репликами и «вы видите сообщения с момента входа» (`guest-chat-open.png`), «Назад» подтверждён программно (`hasBackBtn`/пропадание текста «Чат»). Найден-и-исправлен дефект — у экрана «Участники» не было НИ ОДНОГО UI-триггера (`nav.push({kind:'guestParticipants'})` нигде не вызывался): добавлен опциональный проп `onOpenParticipants` в `MobileCallScreen` (тот же приём, что уже задействован для `chatUnreadCount` — аутентифицированный `CallScreen` проп не передаёт, поведение не меняется) + кнопка в шапке, подключена в `GuestMobileCallShell`; подтверждено кликом через харнесс — открывается ростер с обеими строками (`guest-participants-open.png`). Найден-НЕ-исправлен дефект — см. «Этап 6 — отложено» (бейдж «вы» в ростере). Итог этапа 7: принято; бейдж «вы» — в «Итоговые follow-ups»; живой бэкенд для гостевого звонка при сверке не использовался (тесты: `GuestMobileCallShell.test.tsx`, `GuestChatScreen.test.tsx`, `GuestParticipantsScreen.test.tsx`, `MobileCallScreen.test.tsx`). Этап 7 починил в этой области тест `GuestCallView.dom.test.tsx` (зависел от реальных часов — разделитель «Сегодня»/«Вчера»; теперь `Date` зафиксирован на 2026-09-23T12:00Z) |
| 68 | `/guest`: экраны завершения (8 причин) + CTA регистрации | `GuestPage` | §7 `ended` | 6 | принято (этап 7): этап 6, частично — компонент-снимок сделан для одной причины (`kicked`): `.superpowers/sdd/2026-09-23-mobile-stage6-guest/shots/guest-ended-dark.png` (файлов на диске больше нет — см. оговорку в начале §10) (карточка + CTA «Создать аккаунт»/«Закрыть»); остальные 7 причин рендерятся тем же `GuestNotice`/`GuestEnded` с другим текстом из `END_REASON_KEYS` — не переснимались по отдельности (честно не расследовано дальше в рамках этой приёмки). Итог этапа 7: принято без пересъёмки остальных 7 причин — один компонент, отличается только текст; риск низкий, не подтверждено снимками |
| 69 | `/guest`: неподдерживаемый браузер, нет доступа к медиа, битая ссылка | `GuestPage`, `guestErrors` | полноэкранные состояния | 6 | принято (этап 7): этап 6, частично — «битая ссылка» подтверждена живым прогоном `--anon --path /guest` без секрета: `.superpowers/sdd/2026-09-23-mobile-stage6-guest/shots/guest-missing-link.png` (файла на диске больше нет — см. оговорку в начале §10); «неподдерживаемый браузер» и «нет доступа к медиа» не переснимались в этой приёмке (честный пробел, не расследовано дальше). Итог этапа 7: принято — оба состояния отрисовываются тем же `GuestNotice`, что уже подтверждён на «битой ссылке» и `ended`; «нет доступа к медиа» и «неподдерживаемый браузер» в браузере не смотрели (для них нужен реальный отказ `getUserMedia`/старый UA), отдельных тестов на `guestErrors` нет. Не подтверждено |
| **Друзья** |
| 70 | Вкладки Онлайн / Все / Ожидают / Заблокированные | `FriendsPanel` | вкладка «Друзья», сегмент-контрол | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/friends-{online,all,pending,blocked}-{light,dark}.png`, `FriendsScreen.test.tsx` |
| 71 | Входящие / исходящие: принять / отклонить / отменить | `FriendsPanel` | inline-кнопки в «Ожидают» | 5 | ✅ этап 5 — кнопки на скриншоте `.superpowers/vyc95/s5/friends-pending-{light,dark}.png`; вызов `apiService.acceptFriendRequest`/`deleteFriendRequest` — `FriendsScreen.test.tsx` («инлайн «Принять» зовёт apiService.acceptFriendRequest»), клик «Принять/Отклонить/Отменить» через фикстуру не воспроизводился (нужен мок POST) |
| 72 | Добавить друга по username | `AddFriendForm` | «＋» → sheet `friendAdd` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/friends-addsheet-{light,dark}.png`, `FriendsScreen.test.tsx` («+» открывает шторку); сама отправка — неизменённый `AddFriendForm` |
| 73 | Удалить, заблокировать / разблокировать | `FriendRow` `ContextMenu` | тап → `ActionSheet` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/friends-actionsheet-{online,blocked}-{light,dark}.png` (разный набор пунктов: онлайн-друг — Позвонить/Удалить/Заблокировать, заблокированный — только Разблокировать), `FriendsScreen.test.tsx` |
| 74 | Бейдж входящих заявок | `ServerList` «Дом» | иконка вкладки «Друзья» | 5 | ✅ этап 5 — бейдж «1» виден на всех скриншотах `.superpowers/vyc95/s5/friends-*.png` (таб-бар, иконка «Друзья») |
| 75 | Позвонить другу | `FriendRow` | `ActionSheet` «Позвонить» | 5 | ✅ этап 5 — пункт «Позвонить Полина» на `.superpowers/vyc95/s5/friends-actionsheet-online-{light,dark}.png`, `FriendsScreen.test.tsx` («Позвонить» зовёт callService) |
| **Профиль и настройки** |
| 76 | Профиль: аватар с кропом, удаление, username, email | `ProfileSettings` | «Профиль» → `settings{profile}` | 5 | принято (этап 7): этап 5, частично — `.superpowers/vyc95/s5/settings-1-{light,dark}.png` (username/email, кнопки «Изменить аватар»/«Удалить аватар»); сам кроп-поповер (выбор файла) не открывается в headless-фикстуре — тот же пробел, что этап 2 отметил для десктопной версии того же `AvatarCropModal`. Итог этапа 7: принято — выбор файла (`<input type=file>`) в headless недоступен; кроп-модалка — тот же компонент, что на строке 10, покрыт только тестами; проверка на устройстве — в «Итоговые follow-ups» |
| 77 | Приватность: last seen, кто добавляет в друзья, кто пишет | `Settings` | `settings{privacy}` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/settings-2-{light,dark}.png` |
| 78 | Звуки: сообщения, звонки, вход/выход, громкость, тест | `AudioSettings` | `settings{audio}` | 5 | ✅ этап 5 — найден и исправлен в приёмке T7: строка «Проверка звуков» наезжала на собственный текст на мобильной ширине, исправлено `@media (width < 900px)`-переопределением в `Settings.css` (`.setting-row-actions{flex-basis:100%}`), десктоп не тронут (`compare`/pixel-diff AE=0). До/после: `.superpowers/vyc95/s5/settings-3-{light,dark}.png` (было) vs `settings-3-{light,dark}-after-fix.png` (стало) — см. «Этап 5 — отложено» ниже |
| 79 | Шумодав DeepFilterNet3 с загрузкой модели | `AudioSettings` | `settings{audio}` | 5 | ✅ этап 5 — тумблер и подпись «Шумоподавление (DeepFilterNet3)» на `.superpowers/vyc95/s5/settings-3-{light,dark}.png`; фактическая загрузка модели (сетевой воркер) не воспроизводилась |
| 80 | Тест микрофона с уровнем | `AudioSettings` | `settings{audio}` | 5 | ✅ этап 5 — «Проверка микрофона» + кнопка «Проверить» + полоска уровня на `.superpowers/vyc95/s5/settings-3-{light,dark}.png` |
| 81 | Устройства ввода / вывода | `AudioSettings` | `settings{audio}` (вывод — где есть `setSinkId`) | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/settings-3-devices-light.png` (проскроллено ниже сгиба: «Устройство ввода»/«Устройство вывода») |
| 82 | Выбор камеры | `VideoSettings` | `settings{video}` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/settings-4-{light,dark}.png` |
| 83 | Тема | `AppearanceSettings` | `settings{appearance}` + действие в `search` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/settings-5-{light,dark}.png` |
| 84 | Язык ru / en | `Settings` | `settings{language}` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/settings-6-{light,dark}.png`, `npm run check:i18n` |
| 85 | Выход из аккаунта | `UserPanel`, `Settings` | «Профиль» → «Выйти» → `ConfirmModal` | 5 | ✅ этап 5 — `.superpowers/vyc95/s5/profile-logout-{light,dark}.png` (шторка подтверждения «Выйти из аккаунта?») |
| 86 | Статус микрофона и шумодава | `UserPanel` | карточка «Профиль»; мик — `CallPill` / панель звонка | 5 | ✅ этап 5 — карточка профиля переключает «В сети» / «В сети · NC вкл.» в зависимости от `noiseCancellationService` — `.superpowers/vyc95/s5/profile-root-ncon-{light,dark}.png` vs `profile-root-ncoff-{light,dark}.png`; статус микрофона показывается вне карточки (`CallPill`/панель звонка) — вне периметра этого пункта на этой карточке |
| **Прочее** |
| 87 | Командная палитра: поиск каналов и сообщений, быстрые действия | `CommandPalette` (⌘K) | экран `search` (иконка на «Серверах») | 3 | ✅ этап 3 — `usePaletteSearch.test.tsx`, `SearchScreen.test.tsx`, `.superpowers/vyc95/s3/mobile/frames/search-screen-*.png`, `verify-c-report.md` пробы 4–5 (цепочка навигации, ⌘K идемпотентен) |
| 88 | `UpdateBanner` (только Electron) | `UpdateBanner` | не показывается на вебе; проверка, что не ломает раскладку | 7 | ✅ этап 7 (с оговоркой) — `UpdateBanner.tsx` рендерится только при `window.electronAPI?.update`, а Electron-окно не бывает уже 900px (`electron/main.ts`: `minWidth: 900`; мобильная оболочка — `< 900px`), поэтому в реальном продукте на мобильной раскладке баннер недостижим. Проверено в живом браузере (харнесс, `--touch --size 390x844`): баннер смонтирован во временном модуле с подставным `window.electronAPI.update` (состояние `available`, версия 9.9.9) — `scrollWidth` = `innerWidth` = 390 (горизонтального переполнения нет), баннер 390×55 при `top: 40px`, текст «Доступна версия 9.9.9» и кнопки «Установить» (104×34) / «Позже» (73×34) читаемы и умещаются в одну строку: `.superpowers/vyc95/s7/updatebanner-390-light.png` (пробa — `ub-eval.js` там же). Оговорки: рендер синтетический (вне `MobileShell`, светлая тема, без заголовочной панели); кнопки 34px < 44px (тач-цель) — принято, так как на мобиле баннер недостижим; `top: 40px` рассчитан на `TitleBar`, которого `MobileShell` не монтирует, и не учитывает safe-area — то же основание |
| 89 | `ErrorBoundary` с отправкой фидбэка | `ErrorBoundary` | та же страница, мобильная вёрстка | 7 | принято (этап 7): ✅ только «нет горизонтального переполнения на 390px», известные дефекты открыты (⚠ ниже) — проверено в живом браузере (харнесс `--touch --size 390x844`; `CrashFallback` смонтирован во временном модуле внутри `ErrorBoundary` с бросающим потомком, `Sentry.ErrorBoundary` показал реальный fallback): `scrollWidth` = `innerWidth` = 390, карточка 342px (`left` 24 / `right` 366, отступ 24px), заголовок, текст, «Перезагрузить» (276×34), «Скопировать», раскрываемая форма отзыва (textarea 276×64) читаемы: `.superpowers/vyc95/s7/errorboundary-390-light.png` (проба — `eb-eval.js` там же). Только светлая тема. ⚠ Известные дефекты, НЕ исправлены (вынесены в «Итоговые follow-ups»; п.2–3 нарушают ограничения проекта на мобильную эргономику — не косметика): (1) строка `Event ID` (`.error-boundary-event-row`) шире контентной области карточки — `kbd` перенесён на две строки посреди идентификатора («ID:» / хэш), кнопка «Скопировать» выходит за внутренний отступ 32px (правый край 359 при внутренней границе 334) — но остаётся внутри карточки и экрана; (2) `textarea` отзыва — `font-size: 13px` (< 16px → iOS Safari приблизит страницу при фокусе); (3) тач-цели «Скопировать» 26px, остальные 34px (< 44px). Раскладку они не ломают, но п.2–3 — реальные мобильные дефекты. |
| 90 | `ConfirmModal` | модалка | sheet-стиль (CSS) | 1 | ✅ этап 1 — `.superpowers/vyc95/s1/confirm-390-{light,dark}.png` |
| 91 | Контекстные меню → touch-альтернатива везде | `ContextMenu` ×3 | `ActionSheet` (сервер, канал, друг) | 2, 5 | ✅ этап 2+5 — сервер и канал: этап 2 (`ActionSheet`, снимки выше); меню друга: `.superpowers/vyc95/s5/friends-actionsheet-{online,blocked}-{light,dark}.png`, `FriendsScreen.test.tsx` |
| 92 | Hover-зависимые элементы → touch-эквивалент | разное | long-press / видимые кнопки (`(hover: none)`) | 3–4 | ✅ этап 3+4 — этап 4 аудит `CallStage.css`/`CallUI.css`/`VolumeControlPopover.css`/`ScreenSharePicker.css`/`GuestInvitePopover.css` (приёмка T9, шаг 5): все hover-only места либо накрыты правилом `@media (width < 900px)` в `CallStage.css` (`.stage-focus-btn` / `.stage-volume-btn` / `.stage-share-badge`; `RemoteParticipantTile` — тот же компонент на десктопе и мобиле; в этапе 7 это правило перенесено с унаследованного `<= 768px` на `< 900px`, так что полоса 769–899px больше не выпадает — обоснование по чтению CSS, в реальном браузере на 850px не проверено), либо принадлежат десктопной `.stage-focus-main`-разметке, которую `MobileCallScreen` не монтирует вовсе |
| **Архитектурные требования** |
| 93 | Вкладка «Чаты» (VYC-91) добавляется без переделки | — | `TabId` + корень + `Screen` | 1 | ✅ этап 1 — `src/mobile/nav/types.ts`, `navReducer.test.ts` |
| 94 | Превью / счётчики непрочитанного — точка расширения | — | `activity.ts`, оба состояния | 2 | ✅ этап 2 — оба состояния: с override (длинный текст, время, «99+», обе темы) `.superpowers/vyc95/s2/mobile/servers-activity-390x844-*.png`, `channels-activity-390x844-*.png`; без override — `servers-390x844-*.png`; `activity.test.tsx` |
| 95 | PWA: манифест, иконки, theme-color достижимы | — | §8 | 1 | ✅ этап 1 — проба `probe-pwa.js` на `/app`, `/guest` и на `dist/` |
| 95a | PWA: раскладка в standalone под вырезом и домашней полоской | — | §8 | 1 → проверка на устройстве | принято (этап 7) — только на устройстве: верхний инсет отдан `.mobile-shell`; в эмуляции `env()` = 0, поэтому подтвердить можно лишь на реальном устройстве (в «Итоговые follow-ups»). Найдено этапом 7 по чтению CSS: экран звонка аутентифицированного пользователя, вероятно, применяет верхний инсет дважды (`.mobile-shell` + `.mcs-topbar`) — тоже требует проверки на устройстве |
| 96 | Один брейкпоинт | 3 значения | контрактный тест, пустой allowlist | 1, 7 | ✅ этап 7 — `LEGACY = {}` в `breakpoint-contract.test.ts` (каждый `@media` по ширине во всех `src/**/*.css` ∈ 4 разрешённых условий, allowlist наследия пуст); новый охранный тест `client/src/styles/__tests__/legacy-mobile-model.test.ts` не даёт вернуться `data-mobile-panel`, `onMobileBack`, `mobile-back-btn`, `chat-back-btn`, `stage-back-btn`, `user-list-mobile-header`, `home-view-mobile-header`; оба теста зелёные в полном прогоне `npm test -- --run` |
| 97 | Десктоп не изменился | — | 1280×800 до/после, `compare -metric AE` = 0 | 1–7 | ✅ этап 1 — 14 состояний, ≤ 2px (шум 2px); ✅ этап 3 — 42 состояния (`desktop-identity.md`), 40×AE=0 + 2×AA-дрожание на контекстных меню (не регрессия, переснято 4×), плюс отдельная находка/фикс: правка D2 (аудио-вложение) изначально протекла на десктоп (AE=9810 на состоянии с аудио, вне исходных 42 состояний) — переведена внутрь `@media (width < 900px)`, повторный замер AE=2; ✅ этап 4 — 7 новых звонковых состояний × 2 темы (сетка/фокус/демонстрация/поповер приглашения гостя/пикер качества демонстрации/p2p входящий/p2p активный), все AE=0 кроме p2p-входящего/светлая = AE 15 из ~1 024 000px (0.0015%) — объяснено фазой CSS-анимации пульсации иконки (`p2p-pulse`, не менялась этим этапом), не регрессия. Файловые снимки `CallStage.dom.test.tsx`/`CallUI.dom.test.tsx` (T1) оставались зелёными на каждой из 9 задач этапа, включая приёмочный фикс-раунд, подтверждая, что вынос `useCallStageModel`/`src/components/call/*` и правка `GuestInvitePopover.tsx`/`ScreenSharePicker.tsx` не тронули десктопный DOM; ✅ этап 5 — байтовая идентичность вместо AE-сравнения ДО фикс-раунда 1: `git diff` между деревом ДО задачи 1 (`abedee2d…`) и текущим рабочим деревом на момент первого прохода приёмки (`058f12a…`, см. `.superpowers/sdd/2026-09-22-mobile-stage5-friends-profile/{BASE_TREE,snap.sh}`) для `client/src/components/Settings.tsx`, `Settings.css`, `pages/app/DesktopShell.tsx` — пусто (файлы не менялись вообще, только новые mobile-файлы добавлены и `ProfileSettings.tsx` расщеплён на переиспользуемые тела в задаче 2); живой скриншот `Settings.tsx` 1280×800, 4 вкладки × 2 темы — `.superpowers/vyc95/s5/desktop-settings-{1,2,3,4}-{light,dark}.png`, визуальных отличий от эталона нет. Фикс-раунд 1 (п.78, «Проверка звуков») добавил в `Settings.css` РОВНО ОДИН новый блок `@media (width < 900px) { .setting-row-actions {…} }`, не трогающий ни одно безусловное/десктопное правило — байтовая идентичность для этого файла после фикс-раунда 1 закономерно уже не нулевая (диф есть), поэтому идентичность для конкретно этой правки доказана иначе: попарный pixel-diff `desktop-settings-2-{light,dark}.png` (до фикса) против `desktop-settings-2-{light,dark}-after-fix.png` (после) — `PIL.ImageChops.difference` даёт `bbox=None`/`extrema=((0,0),(0,0),(0,0))` на обе темы, т.е. AE=0 буквально на состоянии, где правка теоретически могла что-то задеть (подробности — «Этап 5 — отложено», запись про п.78); ✅ этап 6 — CSS-правки этапа мобиле-гейченые (`@media (width < 900px)` или файлы, монтируемые только JS-развилкой `useIsMobile`); TSX-правки задачи 3 в `GuestPage.tsx` безусловные, но на десктопе пиксельно-нейтральны: класс `guest-card-entry` (своих правил вне мобильного `@media` нет), атрибуты `autoComplete="nickname"`/`enterKeyHint="go"` у поля имени (не влияют на отрисовку) и JSX подсказки про in-app браузер (рендерится только при `denied` + in-app UA, т.е. на десктопе практически никогда); вынос `GuestChatBody`/`GuestParticipantsBody` (задача 2) закреплён замороженным DOM-снимком задачи 1. Сверх этого: `.guest-preview { aspect-ratio: 4/3 }` (п.65) живёт внутри уже существующего `@media (width < 900px)` в `GuestPage.css`, не трогая безусловное `aspect-ratio: 16/9`; подтверждено пробой на 1440×900 — `previewRatio` = 1.778 (не изменился), живой скриншот `.superpowers/sdd/2026-09-23-mobile-stage6-guest/shots/guest-entry-desktop.png`, `guest-incall-desktop-full.png` (полный `CallStage` на десктопной ширине рендерится как раньше); `onOpenParticipants` в `MobileCallScreen.tsx`/`.css` (п.67) — опциональный проп по прецеденту `chatUnreadCount`, аутентифицированный `CallScreen`/`renderScreen.tsx` его не передаёт → кнопка не рендерится, `MobileCallScreen.test.tsx` (18 тестов, авторизованный флоу) остался зелёным без изменений (финальный фикс-раунд сделал `onBack` опциональным и добавил тесты гостевых пропов — авторизованные 18 тестов не менялись); правка `breakpoint-contract.test.ts` — тестовый файл, не влияет на приложение; принято (этап 7) (без пиксельного сравнения в браузере — доказательство по снимкам DOM и `git diff`, не по AE): `git diff HEAD --stat` для `client/src/pages/app/DesktopShell.tsx` и `client/src/pages/AppPage.tsx` — пусто (файлы не менялись; `AppPage.css` менялся — удалён только мёртвый блок `@media (width < 900px)`, ниже 900px `DesktopShell` не монтируется). Изменены (`Auth.css` и `MobileCallScreen.css` — только комментарии): `CallStage.tsx/.css`, `ChannelSidebar.tsx/.css`, `ChatArea.tsx/.css`, `HomeView.tsx/.css`, `UserList.tsx/.css`, `CommandPalette.css`, `FriendsPanel.css`, `ServerList.css`, `AppPage.css`, `MobileShell.css`, i18n (`ru.ts`/`en.ts`, ключ `chat.back` удалён), тесты. Замороженные DOM-снимки: на этапе 7 (задача 1) `ChatArea.*`/`UserList.*` пересняты без мок-кнопки «назад» от `onMobileBack` (реальный продакшен-DOM; этой кнопки в продакшене никогда не было) и добавлены `ChannelSidebar.*`/`HomeView.*`; после задач 3–5 `ChatArea.*`, `ChannelSidebar.*`, `CallStage.*` и остальные снимки побайтово равны этой базе, изменились только `UserList.*` и `HomeView.home` — ровно на поддерево скрытой обёртки `.user-list-mobile-header` / `.home-view-mobile-header` (`display: none`, пикселей не даёт). Все снимки проходят без `-u` в полном прогоне. Легаси-блоки `<= 768px`/`<= 640px` в удалённых CSS относились только к ширинам < 900px, где десктопные компоненты не монтируются (кроме общего блока тайлов звонка — он мигрирован на `< 900px`, эффект в 769–899px: чипы плитки 28→40px, opacity 1, `left` бейджа 40→52px; ≤ 768px без изменений). Не проверено: харнесс-скриншоты 1280×800 до/после для этапа 7 не снимались (нужен бэкенд/фикстуры). Прочие снимки этапов 1–6 не пересматривались |

## 11. Проверка

- **TDD** (Vitest): `navReducer`; `useMobileNav` + history (`MemoryRouter`,
  jsdom через `// @vitest-environment jsdom` в файле — глобально `node`);
  `useBackDismiss`; `decideSwipe` (край и sheet); `useLongPress`;
  `mobileGridLayout`; `usePinchZoom`; `activity.ts` (null + override);
  `breakpoint-contract`; `BottomSheet` (стек слоёв, Escape только верхнего,
  закрытие по back).
- **Гейты** каждого этапа (из `client/`): `npx tsc --noEmit` — 0 байт;
  `npx stylelint "src/**/*.css"` — 0 байт; `npm run check:i18n` — «непереведённых
  строк не найдено.»; `npm test` — ровно 3 падения, все в
  `api.network-retry.test.ts`.
- **Визуально** (`tools/verify/smoke.mjs`, свежий `npm run dev:vite`, креды —
  `set -a; source tools/verify/.env; set +a`): 375×812, 390×844, 768×1024 с
  `--touch` × `--theme light|dark`; 844×390 для звонка и лайтбокса; звонок —
  `--fake-media --preload tools/verify/inject-voice-ws.js`. Пробы по
  `probe-template.js`, каждая сначала показана падающей; удаляются в конце
  задачи; всё созданное на проде убирается пробой.
- **Десктоп**: скриншоты 1280×800 (сервер/канал, звонок, настройки, друзья,
  обе темы) снимаются **до** этапа 1 и сравниваются после каждого этапа
  (`compare -metric AE` = 0; расхождение из-за живых данных — повторный снимок
  с тем же состоянием, а не списание).
- **Руками**: клик-проход в обеих темах на узкой ширине после каждого этапа.
- **Приёмка**: §10 — каждая строка «✅ + ссылка на скриншот / шаг»; гейты
  зелёные; манифест валиден (Chrome DevTools Application / `--eval-file`,
  проверяющий `manifest` fetch + иконки 200).

## 12. Риски

| Риск | Смягчение |
|---|---|
| Вынос контроллера и разрез `CallStage` сдвигают десктоп | Попиксельное сравнение 1280 после каждого шага этапа, а не только в конце |
| `location.state` конфликтует с навигацией роутера `/app` ↔ `/login` | Стек читается только на `/app` и `/guest`; logout делает обычный `Navigate` |
| iOS: `visualViewport`, `100dvh`, отсутствие `setSinkId` / `orientation.lock` / `getDisplayMedia` | Фиче-детект, фоллбеки §5.4/§6.2; эмуляция не заменяет устройство — отметить в отчёте, что проверено только в эмуляции |
| Двойная подписка эффектов при смене оболочки на ресайзе | Контроллер вызывается в `AppPage` выше развилки |
| Прод-residue от проб | Пробы, создающие данные, удаляют их в `finally` |

## 12a. Известная деградация полосы 769–899px (этап 1)

*(Описание на момент этапа 1; актуальное состояние — в абзаце «Что закрыл этап 7» ниже.)* Оболочка мобильная уже с 899px, а 17 компонентных блоков включают мобильную
вёрстку только на `<= 768px` (наследие M6 decision 5). В полосе 769–899
экраны стека показывают десктопные панели: список серверов остаётся узким
тёмным rail'ом, его мобильная шапка `.server-list-mobile-header` скрыта.
Навигация при этом работает (аффордансы включены оболочкой). Полоса
выравнивается на этапе 7 вместе с остальными брейкпоинтами; до тех пор это
**известная и принятая** деградация, а не регрессия.

**Что закрыл этап 7 (и что нет).** Закрыто: все легаси-блоки `<= 768px` /
`<= 640px` удалены (`LEGACY = {}`, `breakpoint-contract.test.ts` требует, чтобы
любая `@media` по ширине была одной из четырёх разрешённых) — те компоненты, что
монтируются только в `DesktopShell` (`ChannelSidebar`, `CommandPalette`,
`FriendsPanel`, `ServerList`, `CallStage`-специфичные блоки), ниже 900px не
рендерятся вовсе, так что их блоки были недостижимы; единственный общий блок
(кнопки и бейдж плитки звонка: `.stage-focus-btn` / `.stage-volume-btn` /
`.stage-share-badge`, которыми через `RemoteParticipantTile` пользуется и
`MobileCallScreen`) перенесён на `@media (width < 900px)`. Это снимает
записанную этапом 4 деградацию тач-управления плиткой в полосе 769–899px
(эффект на 769–899px: чипы плитки 28→40px, `opacity: 1`, `left` бейджа
40→52px; на ≤ 768px без изменений). Это обоснование по чтению CSS: проверка
в браузере на ~850px не выполнялась (харнесс нужен бэкенд/фикстуры). Остаётся:
скрытая легаси-разметка в `ServerList.tsx` (`.server-list-mobile-header`,
`.server-icon-name`, базовый CSS `display: none`) не удалена (нет замороженного
снимка, визуального эффекта нет) — «Этап 7 — отложено и найдено по пути». Прочих
остатков «узкого rail'а серверов» в этой полосе спека этапа 1 не описывает, и
на этапе 7 отдельно они не пересматривались.

## 13. Follow-ups

### Итоговые follow-ups (сверка этапа 7)

Единый список того, что реально осталось. Разделы «Этап 1…6 — отложено» ниже —
**исторические** («закрыто этапом 7 / перенесено в итоговый список»): пункты
оттуда либо закрыты, либо продублированы здесь; новый список — только этот.

**Дефекты и доработки**

- Бейдж «вы» в ростере гостя никогда не показывается: `isSelf = row.id ===
  selfIdentity` сравнивает id с префиксом `guest:` и без (`GuestParticipantsBody.tsx`;
  дефект унаследован от `GuestCallView`) → Этап 6.
- Кнопка громкости на плитке мобильного звонка видна, но ничего не делает
  (`isVolumePopoverOpen={false}` в `MobileCallScreen.tsx`) — подключить к
  `CallVolumeSheet` или скрыть → Этап 4, строка 52.
- Экран звонка: тост ошибки без safe-area и не попадает в fullscreen-элемент;
  fullscreen фокуса демонстрации не закрывается, когда шаринг остановлен;
  `usePinchZoom` — ветка `pan` недостижима → Этап 4.
- `useAudioOutput`: `mounted`-реф ломается при двойном вызове эффектов React 19
  StrictMode в dev (кнопка «Динамик» ненадёжна под `npm run dev:vite`) → Этап 4.
- `ErrorBoundary` на мобиле: строка Event ID шире контентной области карточки и
  переносится посреди идентификатора; `textarea` отзыва — 13px (< 16px, iOS-зум);
  тач-цели 26–34px → Этап 7, строка 89.
- Тач-цели < 44px: `.video-seek` / `.audio-seek`, `.attachment-download` /
  `.attachment-expand` (28×28), `fmt-btn` вне композера — общее решение (`::after`) → Этап 3.
- Мелочи `useLongPress` (таймер не отменяется, если `pressable` стал `false`;
  `fired` сбрасывается только на touch-`pointerdown`) и лайтбокса (мультитач
  перезаписывает `start`, `pointerup` без проверки `pointerId`, нет
  `lostpointercapture`) → Этап 3.
- Неудачный `joinServer` глотается — на экране «Найти сервер» нет обратной
  связи; карточка «Пригласить друзей» и список инвайтов держат независимые копии
  состояния → Этап 2.
- `MobileGuestSheet`: список гостей (кик/бан) не подтверждён с живым бэкендом →
  Этап 4.
- Унификация `use*MenuItems` с десктопными `ServerMenu` / `ChannelSidebar`
  (D1 плана этапа 2) → Этап 2.
- `ServerList.tsx` всё ещё рендерит скрытую легаси-разметку
  (`.server-list-mobile-header`, `.server-icon-name`; базовый CSS `display: none`) —
  не удалена: нет снимка, эффекта нет → Этап 7.
- `CallStage.css` держит правила чипов плитки, от которых зависит мобильный экран
  звонка; в мобильный бандл они попадают только через статические импорты
  `DesktopShell` / `GuestCallView` — хрупко при ленивой загрузке; перенести рядом с
  `RemoteParticipantTile` → Этап 7.
- Недостижимые блоки `< 900px` в десктопных файлах (компоненты монтируются только
  в `DesktopShell`, ниже 900px его нет): `ChannelSidebar.css` ~289 (`@media
  (hover: none) and (width < 900px) .channel-join-voice`; `ChannelSidebar` —
  только десктоп); `UserList.css` ~198 (`.user-list` / `.user-item` /
  `.call-user-btn` под `(width < 900px)`; `UserList` монтируется только в
  `DesktopShell.tsx:191`, мобильные экраны этих классов не используют);
  `AppPage.css` ~142 (`.app-account-dock` — рендерится только
  `DesktopShell.tsx:209`). Убрать вместе со скрытой легаси-разметкой `ServerList`
  (пункт выше) после заморозки DOM-снимка `ServerList` → Этап 7.
- В `MobileCallScreen.css` нет переопределения `left` для `.stage-share-badge`,
  поэтому действует перенесённое `left: 52px` из `CallStage.css` — проверить, что
  это желаемо → Этап 7.

**Продукт / инфраструктура (известны со старта)**

- Исходник иконки ≥ 512 → настоящие PWA-иконки (и `public/icon.ico` для
  electron-builder).
- Свайп сообщения → цитата.
- Реальные превью / счётчики непрочитанного (сервер + `activity.ts`).
- `CLAUDE.md`: раздел про `redesign` / `develop` устарел.
- Focus-ring `.composer-field` из `origin/develop` (6 строк) — при следующем
  выравнивании веток.

**Только на устройстве (эмуляция не заменяет)**

- Верхний инсет / вырез / домашняя полоска в standalone (строка 95a); вероятное
  двойное применение верхнего инсета на экране звонка (`.mobile-shell` +
  `.mcs-topbar`) → Этап 7.
- Многоустройственное переключение `setSinkId`; `screen.orientation.lock`;
  fullscreen+landscape демонстрации → Этап 4.
- Вставка эмодзи из шторки может поднять экранную клавиатуру поверх `BottomSheet`
  (Android); поведение `--keyboard-inset` в формах на iOS → Этапы 2–3.
- Аватар-кроп (выбор файла) и остальные 7 причин завершения гостя, «нет доступа
  к медиа» / «неподдерживаемый браузер» — не подтверждены снимками → строки 68, 69, 76.

**Тесты и мелкий долг (не влияют на поведение)**

- Снимок `ChatArea.welcome.html` содержит vite-путь ассета; фикстура
  `m1 '<@u1>'` — не валидный uuid → Этап 3.
- Не закреплено тестами: идемпотентность хоста `MessageActionsSheet`; `accept` /
  `change→addFiles` file-picker'а; Enter-приоритет mention-дропдауна при
  `enterSends`; 6 UA-маркеров `inAppBrowser` (проверены 2) → Этапы 3, 6.
- `design-system.md:101`: grep для JS-инжектируемых свойств — `--include='*.tsx'`,
  расширить на `*.ts` → Этап 3.
- Харнесс: `smoke.mjs` без `--touch` не выставляет буквальный `--size`; прямой
  `import()` стора в `--eval-file` может попасть в другой инстанс модуля (пустой
  `#root` без ошибок) — вписать в `client/tools/verify/README.md` → Этапы 5, 6.
- Не сделано на этапе 7: проверка в браузере кнопок плитки мобильного звонка
  (`.stage-focus-btn` / `.stage-volume-btn` / `.stage-share-badge`) на ~850px —
  доказано только чтением CSS (§12a; нужен бэкенд/фикстуры для харнесса) → Этап 7.
- Не сделано на этапе 7: пиксельное сравнение десктопа 1280×800 до/после (строка
  97) — вместо него DOM-снимки и `git diff` → Этап 7.
- Косметика `GuestMobileCallShell` / `GuestChatBody` (комментарии), структурное
  правило ширины `.guest-card .btn`, `voiceNameFor` вызывается дважды,
  `.mobile-row.is-offline` живёт в `ChannelInfoScreen.css` → Этапы 3, 6.

**Закрыто этапом 7 (было в списках ниже):** мёртвые ветки `onMobileBack` в
`ChannelSidebar` и остальных; дохлое правило `.mobile-shell
.user-list-mobile-header`; легаси-блоки `CallStage.css` (с миграцией общего блока
на `< 900px`); `public/favicon.svg`; полоса смешения `/guest` 721–899px
(закрыта на этапе 6 развилкой `GuestPage` → `GuestMobileCallShell`);
`--keyboard-inset` для форм (шелл сжимается на `--keyboard-inset` с этапа 3 —
остаётся только проверка на устройстве).

### Изначальный список (на старте; сохранён для истории)

- Исходник иконки ≥ 512 → настоящие PWA-иконки (и `public/icon.ico` для
  electron-builder, которого нет в репо).
- Свайп сообщения → цитата.
- Реальные превью / счётчики непрочитанного (сервер + `activity.ts`).
- `CLAUDE.md`: раздел про `redesign`/`develop` устарел.
- Focus-ring `.composer-field` из `origin/develop` (6 строк) — при следующем
  выравнивании веток.

### Этап 2 — отложено и найдено по пути

> Исторический раздел: закрыто этапом 7 / перенесено в «Итоговые follow-ups».

- Мобильная формулировка подсказки дропзоны стикеров (сейчас «Перетащите файл…» —
  десктопная строка); тот же вопрос для других строк, перенесённых с десктопа.
- `--keyboard-inset` для липкой панели действий формы (§5.4): пока клавиатура,
  открытая `autoFocus`, на iOS закроет кнопку. Этап 3 (`useVisualViewportInset`).
- Две независимые копии состояния инвайтов: карточка «Пригласить друзей» и список
  ссылок не видят ссылок друг друга — поднять `invites` в тело.
- Неудачный `joinServer` глотается контроллером: на экране «Найти сервер» нет
  обратной связи (десктопная модалка закрывалась).
- Меню-шторки: «создать канал» открывает десктопную `CreateChannelModal` (в
  sheet-стиле этапа 1) — полноэкранная форма в этапе 7 при необходимости.
- Мёртвые ветки `onMobileBack` в `ChannelSidebar` — этап 7 (зачистка).
- Унификация `use*MenuItems` с десктопными `ServerMenu`/`ChannelSidebar` (D1 плана) —
  после этапа 7.
- Голос в строках списков проверен только unit-тестами (в фикстурах нет голоса).

### Этап 3 — отложено и найдено по пути

> Исторический раздел: закрыто этапом 7 / перенесено в «Итоговые follow-ups».

- `ChatArea.welcome.html` (снимок Task 1) содержит vite-путь ассета — плохо
  переживёт смену сборки; фикстура `m1 '<@u1>'` не валидный uuid-упоминание,
  так что рендер упоминаний не покрыт базовым снимком.
- `design-system.md:101` grep для JS-injected свойств использует
  `--include='*.tsx'`, а `--keyboard-inset` инжектится в `keyboard.ts` —
  расширить на `*.ts` при следующей правке документа.
- `MessageActionsSheet`: пустое меню вызывает `onClose` дважды в dev
  StrictMode — хост обязан быть идемпотентным (учтено в `ChatArea`, но не
  закреплено тестом на уровне контракта).
- `useLongPress`: таймер не отменяется, если `pressable` становится `false`
  посреди удержания; `fired` сбрасывается только на touch-`pointerdown`
  (хук ещё с этапа 1, не переписывался).
- Мелкие тестовые пробелы (не влияют на поведение): file-picker не проверяет
  `accept`/`change→addFiles`; нет теста Enter-приоритета между
  mention-дропдауном и `enterSends=true`; `ExpressionPickerProps.tabs`
  остался типизирован как `ExpressionTab[]`, а не `as const`-литерал.
- `.chat-search-layer` без явного `z-index` — при одновременно открытом
  `ExpressionPicker` (z-index 30) теоретически может перекрыть, но на
  мобиле экспрешн-пикер живёт в sheet поверх, так что путь недостижим на
  практике; закрепить явным токеном при следующей правке слоёв.
- Лайтбокс: `setPointerCapture` больше не перехватывает клик по `<video>`
  (Task 8, реальный баг, исправлен), но остаются мелочи — второй палец
  мультитач перезаписывает `start`, `pointerup` не проверяет `pointerId`,
  нет обработки `lostpointercapture`; тач-цели `.video-seek`/`.audio-seek`
  всё ещё < 44px (спека §5.1).
- `voiceNameFor` в строке участника `ChannelInfoScreen` вызывается дважды;
  `.mobile-row.is-offline` живёт в `ChannelInfoScreen.css`, логичнее — в
  общем `MobileListRow.css`; неактивные строки (сам себе/офлайн) остаются
  `<button>`, хотя недоступны для тапа.
- `SearchScreen`: `actions`-`useMemo` пересчитывается на каждый рендер
  (зависимости `c`, `ctx`); переход «Войти в голос»/настройки/тема не
  снимает `search` со стека (после звонка «назад» возвращает на экран
  поиска, а не туда, откуда искали) — UX-заметка, не баг.
- Дохлое правило `.mobile-shell .user-list-mobile-header` в
  `MobileShell.css:71` — зачистка на этапе 7.
- Мобильная опечатка десктопного паттерна: заголовок шторки эмодзи/стикеров
  всегда «Эмодзи» независимо от активной вкладки (вероятно намеренно —
  заголовок пикера, а не вкладки; не переделывалось).
- `.attachment-download`/`.attachment-expand` (28×28) и `fmt-btn` вне
  композера (`.msg-edit` теперь 44×44 явным правилом, но остальные места,
  где `FormattingToolbar` мог бы встретиться, не проверялись) — не имеют
  `::after`-компенсации тач-зоны, в отличие от `.audio-play-btn`; общая
  зачистка паттерна — на этапе 7.
- Найден и исправлен в приёмке (Verify B): аватар-инициал без картинки в
  `channelInfo` не был центрирован (`.channel-info-avatar` без
  `display:flex`) — блокер, исправлен; кнопка «Скачать» наезжала на
  `.audio-time` у аудио-вложения на мобиле — исправлено, но первая версия
  фикса протекла на десктоп (см. п. 97 таблицы покрытия) — исправлено
  повторно, десктопная идентичность перепроверена.
- Найдено в финальном ревью, исправлено: панель управления видео в ленте
  (`.video-player-bar`, `VideoPlayer.css`) была невидима на тач-вводе (нет
  hover) — тот же класс дефекта, что уже решён для `.attachment-download`;
  инлайн-редактор сообщения игнорировал `enterSends` (Enter всегда сохранял
  правку, перенос строки на мобильной клавиатуре ввести было нечем); мост
  ⌘K (`MobileShell.tsx`) мог подменить в стеке открытую шторку вместо того,
  чтобы не трогать её.
- Найдено в финальном ревью, отложено (не подтверждено на живом
  устройстве): вставка эмодзи из мобильной шторки программно фокусирует
  поле ввода (`insertAtCaret`/`applyAndRestore`), что на Android Chrome
  теоретически может поднять экранную клавиатуру поверх ещё открытой
  `BottomSheet` (она портируется в `document.body`, вне сжатия
  `--keyboard-inset`); на iOS `focus()` вне жеста клавиатуру не поднимает —
  эффект платформозависимый, требует проверки на реальном Android.
- Расширившаяся полоса смешения десктопной/мобильной вёрстки на `/guest`
  (721–899px вместо 721–768px, после унификации брейкпоинта) — входные
  данные для этапа 4 (гости), не дефект этого этапа.

### Этап 4 — отложено и найдено по пути

> Исторический раздел: закрыто этапом 7 / перенесено в «Итоговые follow-ups».

- Легаси-блоки `CallStage.css` (`<= 768px` × 6, `<= 640px` × 1, allowlist
  `breakpoint-contract.test.ts`) стали мёртвым кодом: экран `call` больше не
  монтирует десктопный `CallStage` на мобиле (`MobileCallScreen` заменяет его
  с этапа 4, T7) — блоки не тронуты этим этапом намеренно (десктопная
  `CallStage.css` не менялась вовсе), зачистка — этап 7 вместе с остальным
  allowlist'ом.
- Кнопка громкости на `RemoteParticipantTile` в мобильной сетке звонка —
  визуальный no-op: `isVolumePopoverOpen`/её обработчики захардкожены в
  `MobileCallScreen`, реальная регулировка громкости участника живёт только в
  `CallVolumeSheet` («⋯» → «Громкость участников», слайдеры на всех сразу).
  Строка покрытия 52 — «частично» по этой причине (итог — «принято», этап 7).
- Найдено в приёмке (re-review приёмочного фикс-раунда, не подтверждена
  повторным дедлайном): `useAudioOutput.ts`'s `mounted`-реф не восстанавливается
  после двойного вызова эффектов React 19 StrictMode в dev-режиме
  (`npm run dev:vite`), из-за чего `setDevices()` молча пропускается —
  подтверждено инструментированным логом: `enumerateDevices()` реально
  получает устройства, но `mounted.current` уже `false` к моменту `.then`.
  Механизм специфичен для dev-режима (StrictMode не дублирует эффекты в
  production-сборке) — реальные пользователи, вероятно, не затронуты, но живая
  проверка кнопки «Динамик» через `npm run dev:vite` при этом ненадёжна.
  Не исправлено (файл вне периметра приёмочного фикс-раунда) — follow-up.
- Реальное многоустройственное переключение аудиовывода (`setSinkId`,
  порядок/метки `enumerateDevices()`) не проверено — нет физического
  устройства с несколькими выходами в окружении верификации.
- `screen.orientation.lock('landscape')` на фокусе демонстрации — по спеке в
  `try` (браузер может игнорировать вне полноэкранного режима на части
  Android), не проверено на реальном устройстве.
- PiP в p2p-звонке — фиксированный угол без перетаскивания (решение D4,
  отличие от группового `MobileCallScreen`, где PiP перетаскивается между
  четырьмя углами) — осознанное упрощение: у p2p ровно одна локальная
  плитка, угол выбирать не из чего.
- `CallPill` в варианте `stacked` (`position: fixed` под шапкой некорневого
  экрана) перекрывает верх реальной ленты сообщений, если в канале есть
  история — решение D9 предвидело это и просило приёмку лишь подтвердить,
  что перекрытие не наезжает на что-то похуже; подтверждено (T9) — остаётся
  принятым компромиссом, не дефектом.
- `channelInfo` (этап 3) по-прежнему не получил интеграцию управления гостями
  — пункты «Пригласить гостя»/«Гости в звонке» доступны только из «⋯» самого
  звонка (строки покрытия 62/64); спека не требовала переноса в
  `channelInfo` на этом этапе, это не регрессия.
- `MobileGuestSheet`'а секция списка гостей (кик/бан) не подтверждена
  рендером в офлайн-фикстуре приёмки (вероятно завязана на живой запрос,
  который недостижим без бэкенда в среде верификации) — секция создания
  ссылки подтверждена, список — нет; стоит точечно перепроверить с реальным
  бэкендом перед продакшен-релизом этапа.
- Мелкие косметические огрехи, не исправлялись (Minor, зафиксированы в
  ledger, не блокировали приёмку): устаревший комментарий в `MobileShell.css`
  всё ещё упоминает `.call-stage` в правиле, откуда класс уже убран (D10);
  `.call-pill`'s `border-radius` избыточно дублирует `.mobile-call-dock`'s
  для варианта `root` (тот же токен, конфликта нет).
- Найдено в финальном ревью ветки, **отложено осознанно** (не исправлено в
  рамках этапа): в полосе **769–899px** (Android-планшеты, развёрнутые
  складные телефоны, десктопный браузер, сжатый до мобильной оболочки)
  `RemoteParticipantTile`'s тап-в-фокус/громкость завязаны на унаследованный
  `@media (width <= 768px)`-фоллбек видимости (`CallStage.css`), который не
  покрывает полный диапазон `< 900px`, на котором монтируется мобильная
  оболочка — кнопки в этой узкой полосе технически хит-тестятся, но
  визуально невидимы (opacity: 0, без hover на тач-вводе). Тот же класс
  «известной и принятой деградации 769–899px», что уже задокументирован в
  §12a для других компонентов с этапа 1 — не новая регрессия этого этапа,
  а то же наследие, в которое попало и переиспользование `RemoteParticipantTile`
  (решение D3). **Важное следствие для этапа 7**: запланированная зачистка
  легаси-блоков `<= 768px` в `CallStage.css` (см. выше — «стали мёртвым
  кодом») в этой конкретной полосе НЕ мертва — это единственное, что вообще
  делает управление тач-плитками видимым на мобиле. Удаление блока без
  замены на `< 900px`-эквивалент на этапе 7 тихо регрессирует управление
  плитками звонка на ВСЕХ мобильных ширинах, не только в узкой полосе.
  Этап 7 обязан это учесть до удаления.
- Найдено в финальном ревью ветки, **отложено** (Minor, follow-up):
  `usePinchZoom`'s ветка `pan` недостижима в продукте — `lastMid` обнуляется
  на каждом `pointerup`/`pointercancel`, так что одиночный палец после
  снятия второго никогда не попадает в условие пана; зум демонстрации
  экрана работает (до 4×), но всегда от центра, без возможности сдвинуть
  изображение. Пан не требуется явно спекой §6.2 (только зум+сброс двойным
  тапом), так что это юзабилити-пробел, а не невыполненное требование.
- Найдено в финальном ревью ветки, **отложено** (Minor, follow-up): тост
  ошибки/предупреждения звонка на мобиле (`.error-toast`, переиспользован
  как есть) не учитывает safe-area и может лечь поверх шапки экрана на
  вырезанном устройстве; в отличие от десктопа (M6 T12: портал в fullscreen
  top layer) мобильный тост не перенаправляется в fullscreen-элемент —
  ошибка демонстрации, поднятая во время просмотра чужого шаринга в
  fullscreen, окажется в DOM, но не будет видна (тот же класс дефекта, что
  M6 T12 когда-то нашёл и исправил на десктопе).
- Найдено в финальном ревью ветки, **отложено** (Minor, follow-up):
  fullscreen фокуса демонстрации не закрывается автоматически, если
  делящийся прекращает шаринг, оставаясь в фокусе — эффект в
  `MobileCallScreen.tsx` рано выходит, когда `sharing` становится `false`;
  восстановимо кнопкой «назад к сетке» (она остаётся доступна внутри
  fullscreen-элемента), но не автоматически.
- `CallNotifBanner`'s мобильный блок пересчитан за-constrained на очень узких
  вьюпортах (<364px: `left/right: 12px` + унаследованный `max-width: 340px`
  оставляет узкий зазор справа из-за CSS-переконстрейна) — тот же нюанс,
  что уже отмечен и принят в ревью Task 8, подтверждён повторно финальным
  ревью ветки; не мешает реалистичному диапазону устройств этого приложения.

### Этап 5 — отложено и найдено по пути

> Исторический раздел: закрыто этапом 7 / перенесено в «Итоговые follow-ups».

- **Найдено и исправлено в приёмке (Task 7):** строка «Проверка звуков» в
  `AudioSettings` (`settings{audio}`, п.78) на мобильной ширине (~390–500px)
  визуально наезжала текстом заголовка/описания на 4 тестовые кнопки
  (Сообщение/Звонок/Вход/Выход). Воспроизведено в обеих темах (до фикса):
  `.superpowers/vyc95/s5/settings-3-{light,dark}.png`,
  `settings-3-devices-light.png`. Корень (подтверждён `getBoundingClientRect`
  пробой, не догадкой): `.setting-row-info { flex: 1; min-width: 0 }` в
  `client/src/components/Settings.css` позволяет колонке заголовка/описания
  сжаться почти до нуля (измерено: 23px при доступных ~468px), а
  `flex-wrap: wrap` на `.setting-row` это не предотвращает — по спецификации
  flexbox элемент с `flex-basis: 0%`/`min-width: 0` всегда «помещается» на
  текущей строке, поэтому `.setting-row-actions` (кнопки) не переносится на
  свою строку, а встаёт рядом со сжатой колонкой; неразрывные слова описания
  визуально вылезают за пределы своего 23px-бокса поверх кнопок. Комментарий
  в файле (`/* flex-wrap: wrap added in T7 */`, строка ~113) фиксирует более
  раннюю находку той же природы и её частичное решение — на десктопной
  панели настроек (`.settings-modal`, ~640px) колонка никогда не сжимается
  настолько сильно, поэтому там дефект не проявлялся. Исправлено фикс-раундом
  1 (после первого прохода приёмки): добавлен mobile-only override —
  `@media (width < 900px) { .setting-row-actions { flex-basis: 100%;
  justify-content: flex-start; } }` в конце `Settings.css`, форсирующий
  перенос кнопок на свою строку независимо от найденной особенности
  flex-wrap, не трогая ни одно десктопное правило. Подтверждено: мобильный
  снимок после фикса — `settings-3-{light,dark}-after-fix.png` (текст больше
  не перекрывается); десктопный `.settings-modal` на 1280×800 —
  **пиксельно идентичен** снимку до фикса (`desktop-settings-2-{light,dark}
  .png` vs `desktop-settings-2-{light,dark}-after-fix.png`, попарное
  сравнение `PIL.ImageChops.difference` → `bbox=None`, `extrema=((0,0),
  (0,0),(0,0))` на обе темы, т.е. AE=0 буквально, не «≤ 2px шума»);
  `Settings.dom.test.tsx` снапшот не изменился (0 diff, CSS-only правка);
  полный гейт-прогон после фикса — без регрессий (см. отчёт задачи 7,
  «Fix round 1»).
- **Найдено в приёмке, не дефект (уточнение для будущих проверок):**
  визуальный харнесс (`tools/verify/smoke.mjs`) в этой рабочей среде не
  соблюдает запрошенный `--size 390x844` буквально — реальный
  `window.innerWidth/innerHeight` оказывается ~500×757 независимо от
  контента страницы (подтверждено на голом `/app --anon`, без каких-либо
  фикстур этой задачи). Не влияет на правильность выводов этой приёмки:
  500px всё ещё меньше брейкпоинта мобильной оболочки (`< 900px`), и ни один
  CSS-файл, тронутый в этапе 5 (`FriendsScreen.css`, `ProfileScreen.css`,
  `SettingsScreen.css`), не содержит внутренних `@media`-точек уже, а
  скриншоты этапов 2–4 (например `.superpowers/vyc95/s4/mobile/*.png`)
  зафиксированы ровно 390×844 — то есть эффект либо специфичен для текущего
  окружения/версии Chrome, либо для порядка флагов в этом сеансе; не
  расследовано дальше (не относится к коду этого этапа), стоит перепроверить
  перед следующей визуальной приёмкой.
- Строки покрытия §10 п.3 («подтверждение неподтверждённого email») и п.76
  (аватар-кроп) приняты с честной пометкой «частично» — см. сами строки:
  первая делит JSX/CSS с уже подтверждённым п.1 и не была отдельно
  переснята в ветке `email_not_verified`; второй — тот же
  headless-ограниченный пробел (`<input type=file>`), что этап 2 уже отметил
  для десктопного `AvatarCropModal`, не новый для этого этапа.

### Этап 6 — отложено и найдено по пути

> Исторический раздел: закрыто этапом 7 / перенесено в «Итоговые follow-ups».

- **Найдено и исправлено в приёмке:** гейт `npm test -- --run` изначально
  давал 4 упавших теста вместо ожидаемых 3 (сверх `api.network-retry.test.ts`)
  — `src/styles/__tests__/breakpoint-contract.test.ts` ожидал запись
  `'pages/GuestCallView.css': { 'width <= 720px': 1 }` в своём списке `LEGACY`,
  но этот блок (`.guest-side` под `@media (width <= 720px)`) был **удалён**,
  а не мигрирован, задачей 4 этого этапа — решение D2 плана
  (`docs/superpowers/plans/2026-09-23-mobile-stage6-guest.md`): после развилки
  `GuestPage` → `GuestMobileCallShell` ниже 900px `GuestCallView` рендерится
  только на ≥ 900px, правило стало недостижимым, и перенос порога
  (буквальная строка спеки §7 `(width <= 720px) → (width < 900px)`) оставил бы
  мёртвое правило, похожее на рабочее — сам тест предупреждает об этом в
  своём комментарии («исправленный блок… требует правки этого списка»).
  Запись убрана из `LEGACY`; гейт вернулся к ровно 3 падениям, все в
  `api.network-retry.test.ts`.
- **Найдено и исправлено в приёмке:** превью камеры на `/guest` `entry` имело
  `aspect-ratio: 16/9` без мобильного override, хотя спека §7 явно требует
  4:3 на мобиле («превью камеры 4:3»); задачи 1–5 эту строку спеки не
  затрагивали. Исправлено (см. п.65 таблицы покрытия) добавлением
  мобиле-гейченого правила в `GuestPage.css`; десктоп не тронут (безусловное
  правило осталось 16/9).
- **Найдено и исправлено в приёмке:** у мобильного гостевого звонка не было
  НИ ОДНОГО способа открыть экран «Участники» — `GuestParticipantsScreen`
  существовал (задача 5 этого этапа) и был подключён к стеку навигации в
  `GuestMobileCallShell` (задача 4; с финального фикс-раунда — оверлеем
  поверх слоя звонка, см. запись ниже), но нигде в коде не было вызова
  `nav.push({ kind: 'guestParticipants' })` — ни в `MobileCallScreen`
  (топ-бар — только сворачивание и качество связи), ни в «⋯»-шторке
  (`useCallOverflowItems`'s пункт «Гости» — это управление гостевыми
  ссылками для АВТОРИЗОВАННОГО участника, гейтится `guestLinksEnabled &&
  !isGuestMode`, гость его никогда не видит). Обе задачи 4 и 5 сфокусировались
  на самих экранах/спинере/чате и разошлись по этой конкретной ниточке. Это
  не гипотетический риск — реальный гость на мобиле физически не мог увидеть
  список участников звонка. Исправлено (см. п.67): добавлен опциональный
  проп `onOpenParticipants?: () => void` в `MobileCallScreen` (тот же
  паттерн, что уже применён для `chatUnreadCount` задачей 4 — авторизованный
  `CallScreen` его не передаёт, поведение и вёрстка не меняются) и кнопка
  «Участники» (иконка `Users`, `.mcs-participants-btn`) в топ-баре рядом с
  индикатором качества; подключено в `GuestMobileCallShell.tsx`
  (`onOpenParticipants={() => nav.push({ kind: 'guestParticipants' })}`).
  Подтверждено вживую через харнесс: кнопка появляется, клик открывает
  ростер с обеими строками. `MobileCallScreen.test.tsx` (18 тестов,
  авторизованный флоу без этого пропа) остался зелёным.
- **Найдено и исправлено финальным ревью всей ветки этапа:**
  (C1) гость навсегда терял звук после открытия чата/ростера — шелл
  возвращал `GuestChatScreen` *вместо* сцены, размонтируя удалённые `<video>`
  (из них и играет аудио), а эффект привязки потоков `useCallStageModel`
  (зависимости `[participants, focusedUserId]`) после «Назад» их не
  перепривязывал. Теперь слой звонка остаётся смонтированным и только
  прячется (`visibility: hidden`, как `.mobile-screen.is-under`), экраны
  чата/ростера — оверлей поверх; `useCallStageModel` монтируется только в
  `in_call` (как десктопная `CallStage`). Регрессия —
  `GuestMobileCallShell.test.tsx` («C1: …», падает на прежнем коде).
  (I1) шеврон «свернуть» в шапке у гостя был привязан к `leave()` и молча
  завершал сессию — `onBack` в `MobileCallScreen` стал опциональным, гость
  его не передаёт (выход — красная кнопка панели); авторизованный
  `CallScreen` передаёт, как раньше. (I2) «Попросить войти» на экране входа
  реально прижата к низу: `align-self: stretch` у `.guest-card-entry` +
  `margin-top: auto` у `.guest-submit` вместо недействовавших `height: 100%`/
  `space-between`, фон карточки прозрачный. (I3) у шелла звонка появились
  `useVisualViewportInset` + `height: calc(100dvh - var(--keyboard-inset, 0px))`
  и safe-area-отступы (`GuestMobileCallShell.css`); экраны до звонка
  (entry/lobby/notice/ended) этим не затронуты. Плюс засев стека
  `[{ kind: 'guestCall' }]` при монтировании (как в `MobileShell`) и тесты
  бейджа непрочитанного («99+») и кнопки «Участники» в
  `MobileCallScreen.test.tsx`. Живым харнессом этот фикс-раунд не
  переснимался — только jsdom-тесты и чтение CSS.
- **Найдено, НЕ исправлено (реальный дефект, за пределами этого этапа):**
  бейдж «вы» в ростере участников гостя (`GuestParticipantsBody.tsx`) никогда
  не отображается на собственной строке гостя. Причина: `isSelf = row.id ===
  selfIdentity`, где `selfIdentity = guest:${guestId}` (с префиксом
  `guest:`), но `row.id` для гостевых строк — это `g.id` из
  `participants.guests` (см. `GuestParticipantGuest.id` в
  `guestGateway.ts`), без префикса — сравнение никогда не совпадает.
  Воспроизведено и на живом снимке (`.superpowers/sdd/2026-09-23-mobile-stage6-guest/shots/guest-participants-open.png`
  — «Аня» с бейджем «Гость», но без «вы»). Это **не регрессия этого этапа**:
  комментарий в файле («та же логика, что была встроена в `GuestCallView`»)
  и происхождение файла (задача 2 этого этапа просто вынесла существующую
  логику из desktop-компонента в общее тело, не переписывая её) указывают, что дефект
  существовал уже в исходной `GuestCallView` до всего мобильного редизайна —
  сравнение `row.id === selfIdentity` с тем же префиксом, скорее всего, было
  неверным с самого начала фичи гостевых ссылок. Не исправлено в этом этапе:
  (а) это добавляет риск для desktop-кода, который приёмка стадии 6 не
  уполномочена трогать без отдельного прохода/ревью; (б) правильный фикс
  требует решить, править ли `isSelf` (снять префикс) или сам источник
  `participants.guests[].id` (добавить префикс) — а второе затрагивает
  `directoryFrom()` и, возможно, серверный контракт `guest_id`, что выходит
  за рамки «дёшево и безопасно». Follow-up: завести отдельную задачу на
  исправление `GuestParticipantsBody.tsx`'s `isSelf`, с проверкой на обоих
  экранах (desktop `GuestCallView`, mobile `GuestParticipantsScreen`).
- **Честно не расследовано (нехватка времени в этой приёмке):** из 8 причин
  завершения звонка гостя (`GuestEndReason`) визуально переснята только одна
  (`kicked`); экраны «неподдерживаемый браузер» и «нет доступа к медиа» (п.69)
  не переснимались вовсе. Все используют один и тот же компонент
  (`GuestNotice`/`GuestEnded`) с разным текстом из `END_REASON_KEYS`/
  `guestErrors.ts` — риск оценивается как низкий (общая раскладка уже
  подтверждена на `ended`/`kicked` и на «битая ссылка»), но это не
  подтверждено снимком для каждого состояния отдельно.
- **Уточнение для будущих визуальных приёмок (харнесс, не код):**
  `tools/verify/smoke.mjs` без флага `--touch` не выставляет буквально
  запрошенный `--size WxH` (тот же эффект, что уже отмечен «Этап 5 —
  отложено» — воспроизведено снова в этой приёмке, `window.innerWidth`
  оказывался ~500px вместо 390px). Флаг `--touch`
  (`Emulation.setDeviceMetricsOverride`) даёт буквальный запрошенный
  viewport — использован во всех скриншотах этой приёмки, `winW`/`winH`
  подтверждены пробой (390×844). Также обнаружено и обойдено: `--eval-file`/
  `--probe` скрипты, импортирующие модуль стора «в лоб»
  (`import('/src/stores/callStore.ts')`), могут попасть в ДРУГОЙ инстанс
  модуля, если dev-сервер уже отдал странице этот файл с cache-busting query
  (`?t=…`) — обновление стора тогда молча не долетает до смонтированного
  дерева (в случае `MobileCallScreen`/`CallStage`, которые условно рендерят
  `null`/пусто без `isInGroupCall`, это выглядело как полностью пустой
  `#root` без единой ошибки в консоли — ложно похоже на краш). Обход:
  резолвить реальный URL через `performance.getEntriesByType('resource')`
  перед `import()`. Не относится к коду приложения — особенность dev-сборки
  Vite + техники прямого `import()` в CDP-eval.
- **Перенесённые мелкие находки задач 2–4 (не форсированы этим планом,
  фиксируются здесь по требованию брифа задачи 6):**
  - Задача 2: над `useMemo` для `members` в `GuestChatBody.tsx` не хватает
    пояснительного комментария из исходного примера кода в плане —
    косметика, не обязательно.
  - Задача 3: `inAppBrowser.test.ts` проверяет только 2 из 6 UA-маркеров
    (дословно по брифу задачи 3) — пробел в покрытии, можно расширить
    отдельным заходом.
  - Задача 3: `.guest-card .btn { min-height: 44px }` гарантирует только
    высоту тач-таргета, ширина половины требования 44px держится на
    случайной ширине содержимого — сегодня достаточно, но стоит структурного
    правила ширины, если когда-нибудь появится кнопка с короткой подписью.
  - Задача 4: `GuestMobileCallShell` держит эффекты `useCallStageModel`
    (watch/unwatch демонстрации экрана) работающими, пока гость находится на
    `guestChat`/`guestParticipants`, в отличие от авторизованного
    `CallScreen`, который полностью размонтируется при переходе в чат —
    вероятно безобидно, стоит однострочного комментария, фиксирующего это
    расхождение осознанно.
  - Задача 4: проверка тайминга `connecting`/`resuming` в
    `useCallStageModel` не до конца покрыла случай `callChannelId === null`
    — низкий риск по прямому осмотру хука, доработка не оправдана.

### Этап 7 — отложено и найдено по пути

> Подробная запись находок этапа 7. **Источник истины для открытых пунктов —
> «Итоговые follow-ups» выше**; все открытые пункты этого раздела продублированы там
> (кроме процессуальной заметки об устаревших ссылках на `.superpowers/` — последний
> пункт раздела).

- `ServerList.tsx` всё ещё рендерит скрытую легаси-разметку
  (`.server-list-mobile-header`, `.server-icon-name`; базовый CSS
  `display: none`) — не удалена: нет замороженного снимка `ServerList` /
  `DesktopShell`, визуального эффекта нет. Охранный тест
  `legacy-mobile-model.test.ts` этот токен намеренно не запрещает.
- `CallStage.css` содержит правила, от которых зависит мобильный экран звонка
  (классы чипов плитки), и в мобильный бандл они попадают только через
  статические импорты `DesktopShell` / `GuestCallView` — хрупко, если те
  станут ленивыми; перенести рядом с `RemoteParticipantTile`.
- `ChannelSidebar.css` ~289: `@media (hover: none) and (width < 900px)
  .channel-join-voice` недостижим (`ChannelSidebar` — только десктоп).
- Экран звонка аутентифицированного пользователя, вероятно, применяет верхний
  инсет дважды (`.mobile-shell` padding-top + `.mcs-topbar`) — нужна проверка на
  устройстве (в эмуляции `env()` = 0).
- Бейдж «вы» в ростере гостя (`GuestParticipantsBody.tsx`, префикс `guest:`) —
  уже описан в «Этап 6 — отложено».
- В `MobileCallScreen.css` нет переопределения `left` для `.stage-share-badge`,
  поэтому действует перенесённое `left: 52px` из `CallStage.css`.
- Не сделано: проверка в браузере кнопок плитки звонка на ~850px (харнесс
  требует бэкенд/фикстуры) — рассуждение по чтению CSS; и пиксельное сравнение
  десктопа 1280×800 для этапа 7 (см. строку 97).
- Строки 88/89: `ErrorBoundary` и `UpdateBanner` проверены в браузере на 390px
  синтетически (временный модуль, харнесс; темп-файл удалён); найденные мелочи
  `ErrorBoundary` — в «Итоговые follow-ups». `UpdateBanner` на мобиле
  недостижим (`minWidth: 900` у окна Electron).
- Найдено и исправлено по пути: тест `GuestCallView.dom.test.tsx` (этап 6)
  зависел от реальных часов («Сегодня» / «Вчера») — теперь `Date` зафиксирован
  на 2026-09-23T12:00Z. Удалён неиспользуемый i18n-ключ `chat.back`. Комментарий
  в `ChatArea.css` про то, кто включает `.chat-call-btn`, приведён в
  соответствие (теперь — `.mobile-shell`).
- Устаревшие ссылки на материалы этапов 5–6 в `.superpowers/` (см. оговорку в
  начале §10) — при следующей приёмке класть доказательства в
  отслеживаемое место или ссылаться только на существующие файлы.

### Правки по ручному тестированию (2026-09-24)

Сделано: композер (порядок `[поле][Aa][😊][📎][отправить]`, шторка скрепки — только «Фото и видео»/«Файл»), сетка звонка без PiP (моя плитка — обычная ячейка), фокус на любом участнике включая себя, кнопка «на весь экран» на главном видео фокус-вида, прокрутка чата к низу при входе в канал (`useStickToBottom`, десктоп и мобильный), иконки приложения из `public/image.png`, textarea ниже на 2px. В `useCallStageModel` добавлен чисто аддитивный `reattachRemoteStreams` (звук удалённых после пересоздания плиток при фокусе на себе).

Отложено:
- **Демонстрация экрана с телефона.** Мобильные браузеры (Chrome Android, iOS Safari) не поддерживают `getDisplayMedia`, пункт «⋯» скрыт по `CAN_SHARE`. Нужна нативная оболочка (Capacitor/Android) — отдельный этап со своей спекой.
- Иконки растянуты из источника 201×200: крупные размеры мягкие, нужна версия ≥512px.

Не проверено на устройстве: звук собеседника после «сетка → фокус на себе → сетка»; iOS-плеер при `webkitEnterFullscreen` (нет наших кнопок, иконка не переключается — нет `fullscreenchange`); прокрутка чата с вложениями в браузере (баг воспроизведён только чтением кода); тост ошибки не виден в fullscreen (`m.stageError` вне `.mcs-focus-main`).

### Правки VYC-96 (звук/камера в фоне, PWA)

Сделано:
- **`CallAudioHost`** (`client/src/mobile/call/CallAudioHost.tsx`) — постоянный хост звука группового звонка на уровне `MobileShell`: удалённые участники звучат через него, а не через `<video>` плиток (те немые, `useCallStageModel({ externalAudio: true })`). Звук больше не пропадает, когда стек навигации размонтирует экран звонка (свёрнутый звонок, лайтбокс поверх чата). Гость и десктоп звучат через плитки, как раньше.
- **`useBackgroundCamera`** (`client/src/mobile/call/useBackgroundCamera.ts`) — при сворачивании (visibility `hidden`, дебаунс 400 мс) камера выключается тем же путём, что кнопкой, устройство освобождается, у собеседников вместо замершего кадра — чёрный; на `visible` камера возвращается, если до сворачивания была включена. Демонстрацию и выключенную пользователем камеру не трогает.
- **`forceMobileViewport`** (`client/src/mobile/forceMobileViewport.ts`) — на телефоне в режиме «Версия для ПК» (и в установленной с него PWA) прописывает в `<meta name="viewport">` физическую ширину устройства, чтобы сработала мобильная раскладка. На десктопе и планшетах ничего не делает.
- **События `camera_off` / `camera_on`** — по образцу `mic_muted`/`mic_unmuted`. Сервер (`websocket.go` `handleCameraState`) рассылает их с `user_id` отправителя и зеркалит гостям (`mirrorToGuests`); гость может их слать (`guestRelayableTypes`). Клиент: `callBus`/`guestGateway` пропускают их; `callStore.remoteCameraOff` (нет записи = камера «вкл»), очистка при уходе участника, реконнекте и выходе. Отправка — единственная подписка моста на смену `isVideoOff` в `callStore` (кнопка сцены, `CallDock`/`CallPill`, `useBackgroundCamera`, вход гостя); при входе в звонок объявляется начальное состояние; при появлении участников (`onPeerJoined`) своё состояние переобъявляется одним событием с дебаунсом 300 мс — так поздно вошедшие узнают о выключенных камерах. `remoteCameraOff` переживает реконнект SFU (resume не шлёт остальным `participant_joined`, и они свою камеру не переобъявят); ушедших за время обрыва отсеивают `onPeerSnapshot`/`onPeerLeft`. После реконнекта (`onReconnected`) и после переподключения шлюза гостя (повторный `admitted` в фазе `in_call`) своё состояние мика и камеры объявляется заново. `RemoteParticipantTile` (опц. проп `cameraOff`), фокус-вид мобильного экрана и десктопной сцены показывают аватар вместо чёрного кадра; демонстрация экрана имеет приоритет.

Порядок деплоя: **сначала сервер, потом клиент.** Старый сервер незнакомый тип пишет в лог (`unknown message type`) и выбрасывает, соединение не рвёт; гостевой шлюз молча отбрасывает типы вне allowlist. Старый клиент событий не шлёт и не слушает — у его собеседников плитка ведёт себя как раньше (чёрный кадр при выключенной камере), у него самого — тоже.

Не проверено вживую: сворачивание на реальных Android/iOS и приход `camera_off` к собеседнику; P2P-звонок 1:1 (`CallUI.tsx`, `callService`) событий камеры не шлёт и не слушает — вне объёма.

### Ограничение: микрофон при свёрнутом приложении (VYC-96, 2026-09-24)

Проверено на Android 10 (Chrome/PWA) диагностикой `kind=background-audio` (GlitchTip): через ~4–5 с после сворачивания захват микрофона отдаёт цифровую тишину, при этом `AudioContext` = `running`, сырой трек `live`/не `muted`, пакеты идут (~50/с), страница не заморожена; звук возвращается при возврате в приложение. Обход шумоподавления на время фона (`useBackgroundNcBypass`) тишину не убрал → причина не в цепочке NC и не в CPU, а в глушении микрофона idle-приложения самой ОС (Android 9+). Средствами веба это не обходится. Решение владельца: оставить как есть, принять ограничение. Варианты на будущее: Picture-in-Picture (не гарантирован, зависит от версии Chrome) либо нативная оболочка (Capacitor/Android) с foreground-сервисом `microphone` — вместе с шарингом экрана с телефона. Камера при сворачивании выключается (аватарка у собеседников, `camera_off`/`camera_on`), звук собеседников играет через `CallAudioHost`. `useBackgroundNcBypass` остаётся в коде без пользы для этой проблемы (можно удалить).
