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
  `<= 640px` / `<= 720px` блоков с указанием файла; на этапе 7 он пустеет.
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
- `GuestCallView.css` `(width <= 720px)` → `(width < 900px)`.

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

## 10. Таблица покрытия

Колонка «Проверка» заполняется при приёмке: «✅ + скриншот/шаг». Сейчас —
«план».

| # | Функция (промт §3) | Десктоп | Мобайл: где живёт | Этап | Проверка |
|---|---|---|---|---|---|
| **Auth** |
| 1 | Вход по email-коду (OTP, повтор с таймером, смена email) | `AuthPage`, `OtpCodeInput` | `AuthPage` (CSS-полировка), OTP `one-time-code` + `numeric` | 5 | план |
| 2 | Вход по паролю | `AuthPage` | `AuthPage` | 5 | план |
| 3 | Подтверждение неподтверждённого email | `AuthPage` | `AuthPage` | 5 | план |
| 4 | Выбор username при регистрации | `AuthPage` | `AuthPage` | 5 | план |
| **Серверы** |
| 5 | Список серверов | `ServerList` | вкладка «Серверы», `MobileListRow` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/servers-390x844-{light,dark}.png`, `ServersScreen.test.tsx` |
| 6 | «Главная» (друзья) | `ServerList` → `HomeView` | вкладка «Друзья» | 5 | план |
| 7 | Создать сервер (имя, приватность) | модалка в `AppPage` | «Серверы» → «＋» → экран `createServer` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile2/create-server-390x844-{light,dark}.png`, `CreateServerScreen.test.tsx` |
| 8 | Найти сервер по имени / коду, вступить, число участников | `FindServerModal` | «＋» → экран `findServer` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile2/find-server-390x844-{light,dark}.png`, `FindServerScreen.test.tsx`, `FindServerBody.test.tsx` |
| 9 | Меню сервера | `ServerMenu` (`ContextMenu`) | long-press строки / «⋯» в `channels` → `ActionSheet` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/servers-menu-390x844-*.png`, `channels-server-menu-390x844-*.png`, `serverMenu.test.tsx` |
| 10 | Настройки сервера: имя, иконка с кропом, приватность, тумблер гостевых ссылок | `EditServerModal`, `AvatarCropModal` | экран `serverSettings` (кроп — модалка sheet-стиля) | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/server-settings-{375x812,390x844,768x1024}-*.png`; кроп-модалка — только тесты (jsdom не декодирует картинку) |
| 11 | Инвайт-ссылки: создать / копировать / отозвать, счётчик | `ManageInvitesModal` | экран `invites` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/invites-390x844-*.png`, `InvitesScreen.test.tsx` |
| 12 | Карточка «Пригласить друзей» | `ManageInvitesModal` / меню | экран `invites` + пункт меню сервера | 2 | ✅ этап 2 — карточка на `.superpowers/vyc95/s2/mobile/invites-390x844-*.png`; создание при первом копировании — `InvitesScreen.test.tsx` |
| 13 | Удалить сервер (подтверждение) | `ServerMenu` → `ConfirmModal` | меню сервера → `ConfirmModal` (sheet-стиль) | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/delete-confirm-390x844-*.png` (ConfirmModal шторкой), `serverMenu.test.tsx` (поток, ошибка, двойной тап) |
| 14 | Стикеры сервера: загрузка, имя, удаление | `StickerManager` | экран `stickers` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/stickers-390x844-*.png`, `StickerManagerBody.test.tsx`; ⏳ подсказка дропзоны «Перетащите…» — десктопная строка, мобильная формулировка позже |
| **Каналы** |
| 15 | Список каналов | `ChannelSidebar` | экран `channels` | 2 | ✅ этап 2 — `.superpowers/vyc95/s2/mobile/channels-{375x812,390x844}-*.png`, `ChannelsScreen.test.tsx` |
| 16 | Создать канал | `CreateChannelModal` | меню сервера → модалка sheet-стиля | 2 | ⏳ этап 2: пункт «Создать канал» в меню сервера есть (тест); модалка открывается прежней `CreateChannelModal` в sheet-стиле этапа 1 — снимок этапа 7 |
| 17 | Переименовать канал | `EditChannelModal` | long-press канала / `channelInfo` → модалка | 2 | ✅ этап 2 — пункт на `.superpowers/vyc95/s2/mobile/channel-menu-390x844-*.png`, `channelMenu.test.tsx` (в т.ч. гонка сохранения); снимка самой модалки нет |
| 18 | Удалить канал (последний нельзя) | `ChannelSidebar` меню | long-press / `channelInfo`, `disabledReason` | 2 | ✅ этап 2 — пункты на `.superpowers/vyc95/s2/mobile/channel-menu-390x844-*.png`; `disabledReason` у последнего канала и повторная проверка при удалении — `channelMenu.test.tsx` |
| 19 | Индикатор голоса в канале и кто в нём | `ChannelSidebar`, `VoiceBanner` | вторая строка канала; `VoiceBanner` в чате | 2–3 | ⏳ частично: вторая строка «Аня, Борис +1 в голосе» — unit-тесты `voiceLine`/`ChannelsScreen`/`ServersScreen`, снимка нет (в фикстурах нет голоса); `VoiceBanner` — этап 3 |
| 20 | У канала и чат, и звонок | `ChatArea` + `CallStage` | `chat` + кнопка звонка → `call` | 3–4 | план |
| **Чат** |
| 21 | Лента, разделители дней, «Новые сообщения», «к последним», подгрузка истории | `ChatArea` | `chat` (та же `ChatArea`) | 3 | план |
| 22 | Правка («изменено») | `MessageRow` hover | long-press → «Изменить» | 3 | план |
| 23 | Удаление (подтверждение) | `MessageRow` → `ConfirmModal` | long-press → «Удалить» → `ConfirmModal` | 3 | план |
| 24 | Статусы «отправляется / не отправлено → повторить / отменить» | `MessageRow` | inline + long-press «Повторить/Отменить» | 3 | план |
| 25 | Цитирование | `MessageRow` hover | long-press → «Цитировать» | 3 | план |
| 26 | Плавающая кнопка цитаты при выделении | `FloatingQuoteButton` | та же (проверка на тач-вводе); запасной путь — пункт sheet'а | 3 | план |
| 27 | Упоминания с автодополнением | `MentionDropdown` | над композером во всю ширину | 3 | план |
| 28 | Форматирование: жирный, курсив, подчёркнутый, списки | `FormattingToolbar` (хоткеи) | кнопка «Aa» → панель над полем | 3 | план |
| 29 | Ссылка | `LinkDialog` | из панели «Aa» → `LinkDialog` sheet-стиля | 3 | план |
| 30 | Эмодзи (частые + категории) | `ExpressionPicker`, `EmojiPanel` | «＋» → sheet «Эмодзи» | 3 | план |
| 31 | Стикеры | `StickerPanel` | «＋» → sheet «Стикеры» | 3 | план |
| 32 | Вложения image/video/audio/file | `AttachmentButton` | «＋» → «Фото и видео / Файл» | 3 | план |
| 33 | Трей вложений: прогресс, повтор, удаление | `AttachmentTray` | над композером, как есть | 3 | план |
| 34 | Drag&drop | `ChatArea` | недостижим на тач-вводе; эквивалент — «＋» | 3 | план |
| 35 | Лайтбокс: листание, скачивание, fullscreen | `MediaLightbox` | полноэкранный, свайпы, landscape | 3 | план |
| 36 | `AudioPlayer`, `VideoPlayer` | — | в ленте, тач-цели ≥ 44 | 3 | план |
| 37 | Строки событий звонков (начал, длительность, участники, гости) | `CallEventRow` | в ленте, как есть | 3 | план |
| 38 | Поиск по каналу | `MessageSearch` | иконка в шапке `chat` / `channelInfo` → полноэкранный режим | 3 | план |
| 39 | Пустые состояния (нет серверов, тишина в канале, приветствие) | `ChatArea` | те же карточки в `chat` / «Серверы» | 2–3 | ⏳ частично: карточка «Нет серверов» — `.superpowers/vyc95/s2/mobile2/servers-empty-390x844-*.png`; «тишина в канале»/«приветствие» — этап 3 |
| 40 | Бейдж гостя в сообщениях | `MessageRow` | как есть | 3 | план |
| 41 | Баннер «N гостей видят сообщения» | `ChatArea` | под шапкой `chat` | 3 | план |
| **Участники** |
| 42 | Онлайн / офлайн, last seen (приватность) | `UserList` | `channelInfo` → «Участники» | 3 | план |
| 43 | «В голосе · канал» | `UserList` | `channelInfo` | 3 | план |
| 44 | Позвонить пользователю | `UserList` | тап по участнику → `ActionSheet` «Позвонить» | 3 | план |
| **Звонки** |
| 45 | Войти / выйти в групповой звонок | `ChatArea`, `CallStage` | кнопка в шапке `chat`, `VoiceBanner`, `channelInfo`; «Выйти» на панели | 4 | план |
| 46 | Сетка плиток | `CallStage` | `mobileGridLayout` | 4 | план |
| 47 | Фокус на участнике | `CallStage` | тап по плитке | 4 | план |
| 48 | Fullscreen | `CallStage` | экран уже полный; fullscreen — для демонстрации | 4 | план |
| 49 | Микрофон / камера | `CallStage` | нижняя панель | 4 | план |
| 50 | Демонстрация экрана (источник, качество) | `ScreenSharePicker` | «⋯» → только при `getDisplayMedia`; пикер — sheet | 4 | план |
| 51 | Просмотр чужой демонстрации («Смотреть») + баннер «X показывает экран» | `CallStage` | фокус → fullscreen, landscape, pinch-zoom | 4 | план |
| 52 | Громкость участника | `VolumeControlPopover` | long-press плитки / «⋯» → «Громкость участников» | 4 | план |
| 53 | Индикатор качества с деталями | `ConnectionIndicator` | верх экрана → sheet | 4 | план |
| 54 | «Переподключение…» | `CallStage` | плашка под верхом | 4 | план |
| 55 | Предупреждения о разрешениях медиа, «вошли без камеры/мика» | `CallStage` | баннеры в мобильной раскладке | 4 | план |
| 56 | Входящий личный звонок (принять / отклонить) | `CallUI` | полноэкранный `.p2p-overlay.is-incoming` | 4 | план |
| 57 | Исходящий / активный личный звонок, завершить | `CallUI` | мобильная раскладка `.p2p-overlay.is-active` | 4 | план |
| 58 | Сплит «звонок ↔ чат», возврат в чат | `call-split-handle` | «Чат» на панели ↔ `CallPill` | 4 | план |
| 59 | Возврат в звонок из другого места | `CallDock` | `CallPill` | 4 | план |
| 60 | «X зовёт вас в звонок» | `CallNotifBanner` | плашка сверху, «Войти» → `call` | 4 | план |
| 61 | Динамик (вывод звука) | — (настройки) | кнопка «Динамик» при `setSinkId` | 4 | план |
| **Гости** |
| 62 | Пригласить гостя: создать, копировать, мои ссылки, отозвать | `GuestInvitePopover` | «⋯» звонка / `channelInfo` → sheet | 4 | план |
| 63 | Лобби: впустить / отклонить, «и ещё N» | `GuestLobbyToast` | плашка в звонке + sheet со всеми | 4 | план |
| 64 | Список гостей: удалить / удалить и заблокировать | `GuestInvitePopover` | «⋯» → «Гости в звонке»; `channelInfo` | 4 | план |
| 65 | `/guest`: имя, превью камеры/мика, «попросить войти» | `GuestPage` | §7 `entry` | 6 | план |
| 66 | `/guest`: ожидание | `GuestPage` | §7 `lobby` | 6 | план |
| 67 | `/guest`: звонок с «Чат / Участники» | `GuestCallView` | `MobileCallScreen` + экраны поверх | 6 | план |
| 68 | `/guest`: экраны завершения (8 причин) + CTA регистрации | `GuestPage` | §7 `ended` | 6 | план |
| 69 | `/guest`: неподдерживаемый браузер, нет доступа к медиа, битая ссылка | `GuestPage`, `guestErrors` | полноэкранные состояния | 6 | план |
| **Друзья** |
| 70 | Вкладки Онлайн / Все / Ожидают / Заблокированные | `FriendsPanel` | вкладка «Друзья», сегмент-контрол | 5 | план |
| 71 | Входящие / исходящие: принять / отклонить / отменить | `FriendsPanel` | inline-кнопки в «Ожидают» | 5 | план |
| 72 | Добавить друга по username | `AddFriendForm` | «＋» → sheet `friendAdd` | 5 | план |
| 73 | Удалить, заблокировать / разблокировать | `FriendRow` `ContextMenu` | тап → `ActionSheet` | 5 | план |
| 74 | Бейдж входящих заявок | `ServerList` «Дом» | иконка вкладки «Друзья» | 5 | план |
| 75 | Позвонить другу | `FriendRow` | `ActionSheet` «Позвонить» | 5 | план |
| **Профиль и настройки** |
| 76 | Профиль: аватар с кропом, удаление, username, email | `ProfileSettings` | «Профиль» → `settings{profile}` | 5 | план |
| 77 | Приватность: last seen, кто добавляет в друзья, кто пишет | `Settings` | `settings{privacy}` | 5 | план |
| 78 | Звуки: сообщения, звонки, вход/выход, громкость, тест | `AudioSettings` | `settings{audio}` | 5 | план |
| 79 | Шумодав DeepFilterNet3 с загрузкой модели | `AudioSettings` | `settings{audio}` | 5 | план |
| 80 | Тест микрофона с уровнем | `AudioSettings` | `settings{audio}` | 5 | план |
| 81 | Устройства ввода / вывода | `AudioSettings` | `settings{audio}` (вывод — где есть `setSinkId`) | 5 | план |
| 82 | Выбор камеры | `VideoSettings` | `settings{video}` | 5 | план |
| 83 | Тема | `AppearanceSettings` | `settings{appearance}` + действие в `search` | 5 | план |
| 84 | Язык ru / en | `Settings` | `settings{language}` | 5 | план |
| 85 | Выход из аккаунта | `UserPanel`, `Settings` | «Профиль» → «Выйти» → `ConfirmModal` | 5 | план |
| 86 | Статус микрофона и шумодава | `UserPanel` | карточка «Профиль»; мик — `CallPill` / панель звонка | 5 | план |
| **Прочее** |
| 87 | Командная палитра: поиск каналов и сообщений, быстрые действия | `CommandPalette` (⌘K) | экран `search` (иконка на «Серверах») | 3 | план |
| 88 | `UpdateBanner` (только Electron) | `UpdateBanner` | не показывается на вебе; проверка, что не ломает раскладку | 7 | план |
| 89 | `ErrorBoundary` с отправкой фидбэка | `ErrorBoundary` | та же страница, мобильная вёрстка | 7 | план |
| 90 | `ConfirmModal` | модалка | sheet-стиль (CSS) | 1 | ✅ этап 1 — `.superpowers/vyc95/s1/confirm-390-{light,dark}.png` |
| 91 | Контекстные меню → touch-альтернатива везде | `ContextMenu` ×3 | `ActionSheet` (сервер, канал, друг) | 2, 5 | ⏳ частично: сервер и канал — ✅ этап 2 (`ActionSheet`, снимки выше); меню друга — этап 5 |
| 92 | Hover-зависимые элементы → touch-эквивалент | разное | long-press / видимые кнопки (`(hover: none)`) | 3–4 | план |
| **Архитектурные требования** |
| 93 | Вкладка «Чаты» (VYC-91) добавляется без переделки | — | `TabId` + корень + `Screen` | 1 | ✅ этап 1 — `src/mobile/nav/types.ts`, `navReducer.test.ts` |
| 94 | Превью / счётчики непрочитанного — точка расширения | — | `activity.ts`, оба состояния | 2 | ✅ этап 2 — оба состояния: с override (длинный текст, время, «99+», обе темы) `.superpowers/vyc95/s2/mobile/servers-activity-390x844-*.png`, `channels-activity-390x844-*.png`; без override — `servers-390x844-*.png`; `activity.test.tsx` |
| 95 | PWA: манифест, иконки, theme-color достижимы | — | §8 | 1 | ✅ этап 1 — проба `probe-pwa.js` на `/app`, `/guest` и на `dist/` |
| 95a | PWA: раскладка в standalone под вырезом и домашней полоской | — | §8 | 1 → проверка на устройстве | ⏳ верхний инсет отдан `.mobile-shell`; в эмуляции `env()` = 0, поэтому подтверждается только на реальном устройстве |
| 96 | Один брейкпоинт | 3 значения | контрактный тест, пустой allowlist | 1, 7 | ⏳ этап 1 — `breakpoint-contract.test.ts` зелёный, allowlist наследия пока не пуст (этап 7) |
| 97 | Десктоп не изменился | — | 1280×800 до/после, `compare -metric AE` = 0 | 1–7 | ✅ этап 1 — 14 состояний против нетронутого HEAD, все ≤ 2px при измеренном шуме 2px |

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

Оболочка мобильная уже с 899px, а 17 компонентных блоков включают мобильную
вёрстку только на `<= 768px` (наследие M6 decision 5). В полосе 769–899
экраны стека показывают десктопные панели: список серверов остаётся узким
тёмным rail'ом, его мобильная шапка `.server-list-mobile-header` скрыта.
Навигация при этом работает (аффордансы включены оболочкой). Полоса
выравнивается на этапе 7 вместе с остальными брейкпоинтами; до тех пор это
**известная и принятая** деградация, а не регрессия.

## 13. Follow-ups (известные на старте)

- Исходник иконки ≥ 512 → настоящие PWA-иконки (и `public/icon.ico` для
  electron-builder, которого нет в репо).
- Свайп сообщения → цитата.
- Реальные превью / счётчики непрочитанного (сервер + `activity.ts`).
- `CLAUDE.md`: раздел про `redesign`/`develop` устарел.
- Focus-ring `.composer-field` из `origin/develop` (6 строк) — при следующем
  выравнивании веток.

### Этап 2 — отложено и найдено по пути

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
