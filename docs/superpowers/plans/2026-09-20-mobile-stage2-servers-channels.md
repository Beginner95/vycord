# VYC-95 — этап 2: серверы и каналы. План реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ САБ-СКИЛЛ: superpowers:subagent-driven-development.
> Шаги помечены чекбоксами (`- [ ]`).

**Цель:** заменить смонтированные на этапе 1 десктопные панели `ServerList` и
`ChannelSidebar` настоящими мобильными экранами «Серверы» и `channels`, дать
серверу и каналу тач-меню (`ActionSheet`), вынести пять модалок сервера в
полноэкранные формы стека и завести точку расширения «активность каналов».

**Архитектура:** экраны живут в `src/mobile/screens/`, строки — общий
`MobileListRow`, меню — пара «чистый хук `use*MenuItems` + компонент `*MenuSheet`,
который держит поток (ActionSheet → ConfirmModal/модалка → API)». Полноэкранные
формы получают тело существующей модалки, вынесенное в `*Body` с render-prop'ом
на кнопки: десктопная модалка передаёт ровно свою сегодняшнюю разметку кнопок,
поэтому её DOM не меняется ни на узел.

**Стек:** React 19, TypeScript, Zustand 5, react-router-dom 7, Vitest 4 +
@testing-library/react, lucide-react, обычный CSS на компонент.

**Спека:** `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`
(§4.3, §4.5, §5.1, §5.2, §5.3, §5.6, §5.9; строки покрытия 5, 7–18, 19, 39, 91, 94).

**Предыдущий этап:** `docs/superpowers/plans/2026-09-20-mobile-stage1-skeleton.md`
(закоммичен, `cbe3f2a`).

## Global Constraints

- **Десктоп (≥ 900px) не меняется ни на пиксель.** Любая правка в
  `src/components/*` этого этапа — только вынос тела в `*Body` без изменения
  порядка и классов узлов. Проверка — задача 13.
- **Один брейкпоинт.** Новые CSS-файлы не содержат `@media (width …)` вообще:
  всё под `src/mobile/` рендерится только на мобиле (развилка в `AppPage`).
  `src/styles/__tests__/breakpoint-contract.test.ts` упадёт на любом новом
  медиазапросе по ширине вне allowlist — это гейт, а не рекомендация.
- **Токены только ролевые.** Ни одного literal-цвета вне `tokens.css`. Радиусы —
  из шкалы (`--radius-chip|row|btn|card|tile|composer|modal|bar|pill`), 12px в
  шкале нет. Анимации — `--transition` / `--ease-out`, с
  `@media (prefers-reduced-motion: reduce)`.
- **Иконки** — lucide, всегда явный `size` и `strokeWidth={1.8}`.
- **Классы** — `component-thing` / `is-*`, без числовых z-index (слои — через
  `--z-*`), без новых систем оверлеев: только `.modal-overlay` + `useModalFocus`.
- **i18n:** ни одной пользовательской строки в коде. Новые ключи — и в
  `src/i18n/locales/ru.ts`, и в `src/i18n/locales/en.ts`. Гейт:
  `npm run check:i18n` → «непереведённых строк не найдено.».
- **Тач-цели ≥ 44×44**, строки списка ≥ 64 высотой (спека §5.1).
- **Гейты (из `client/`, всегда из `client/`, корневого `package.json` нет):**
  `npx tsc --noEmit` — exit 0 и ноль байт вывода;
  `npx stylelint "src/**/*.css"` — exit 0 и ноль байт;
  `npm run check:i18n` — «непереведённых строк не найдено.»;
  `npm test` — ровно 3 падения, все в `api.network-retry.test.ts`.
  **Этот файл не чинить** — он красный by design.
- **Коммиты и пуши делает пользователь.** Исполнители задач НЕ выполняют
  `git commit`, `git add`, `git push`, не мёржат и не ребейзят. Изменения
  остаются в рабочем дереве; сообщение коммита предлагается в задаче 13.
- **Никогда `git add -A` / `git add .`** (в корне лежит незатреканная
  `design_handoff_discord_redesign/`).
- Все `npm` / `npx` / `node` — из `client/`. Dev-сервер — `npm run dev:vite`.

## Решения этого плана (приняты автором плана, менять только с обоснованием)

- **D1. Хуки меню — мобильные.** `useServerMenuItems` / `useChannelMenuItems`
  живут в `src/mobile/menus/` и используются только мобилой. Десктопные
  `ServerMenu` и `ChannelSidebar` НЕ переписываются под них: константа этапа —
  «десктоп не меняется», а выигрыш от переиспользования (3 строки прав) меньше
  риска. Унификация — follow-up после этапа 7.
- **D2. Иконки поиска в шапке «Серверы» на этом этапе нет.** Экран `search`
  (§5.10) — этап 3 (строка покрытия 87). Пустая кнопка, ведущая на заглушку,
  хуже её отсутствия.
- **D3. «Пригласить друзей» и список инвайт-ссылок — один экран `invites`:**
  сверху карточка «Пригласить друзей» (создать при необходимости + копировать),
  ниже список ссылок с копированием и отзывом. Закрывает строки покрытия 11 и 12.
- **D4. Контракт выноса тела модалки.** `*Body` рендерит ТОЛЬКО содержимое (поля,
  списки, ошибки) и получает `renderActions` — функцию, рисующую кнопки. Десктопная
  модалка передаёт ровно тот JSX, что у неё сейчас (`<div className="modal-actions">…`),
  мобильный экран — свой `<div className="form-screen-actions">…`. Так «десктоп не
  изменился» проверяется чтением диффа, а не только скриншотом.
- **D5. Экран `stickers` — без отдельной нижней кнопки.** Основное действие
  («Загрузить») появляется в инлайновом блоке превью только когда выбран файл;
  дублировать его в подвале незачем. Осознанное отступление от §5.9.
- **D6. Кнопки «войти в голос» в строке канала нет** — спека §5.3 её не
  описывает, вход в звонок остаётся в шапке чата (`chat-call-btn`, включён
  оболочкой этапа 1) и в `VoiceBanner`. Функция не теряется; строка покрытия 45
  — этап 4.
- **D7. `ChatArea`, `CallStage`, `UserList`, `HomeView` этот этап не трогает** —
  они остаются смонтированными панелями этапа 1 (этапы 3–5).

- **D8. Контракт `ServerMenuSheet` / `ChannelMenuSheet` (выявлен на T3/T4).**
  `ActionSheet` зовёт свой `onClose()` ДО `onClick` выбранного пункта. Поэтому
  оба компонента держат внутреннее состояние потока (`flow`) и отдают
  `ActionSheet` отложенный на микрозадачу `closeSheet`. Проп `onClose` хоста
  означает «взаимодействие с меню закончено» и вызывается РОВНО ОДИН РАЗ:
  либо когда шторку закрыли без выбора пункта с потоком, либо в конце потока
  (отмена, успех, ошибка). Хост обязан держать сущность смонтированной, пока не
  придёт `onClose`: `open={x !== null}` + `server={x}`, а НЕ обнуление `x` в
  момент выбора пункта. `onDeleted` — необязательный: без него пункт удаления
  скрыт, поэтому хосты экранов «Серверы» и каналов его передают всегда.

## Структура файлов

**Создаются:**

| Файл | Ответственность |
|---|---|
| `src/mobile/components/MobileListRow.tsx` + `.css` | строка списка §5.1 (аватар 48, заголовок, подзаголовок, мета) |
| `src/mobile/components/ActivityMeta.tsx` | отрисовка `ChannelActivity`: подзаголовок-превью, время, бейдж |
| `src/mobile/components/FormScreen.tsx` + `.css` | каркас полноэкранной формы: шапка + скролл-тело + липкие кнопки |
| `src/mobile/activity.ts` | точка расширения §5.6: `useChannelActivity` / `useServerActivity` / `__setActivityOverride` |
| `src/mobile/voiceLine.ts` | чистая сборка строки «Аня, Борис +1 в голосе» |
| `src/mobile/menus/useServerMenuItems.tsx` | пункты меню сервера по правам |
| `src/mobile/menus/ServerMenuSheet.tsx` | ActionSheet + подтверждение удаления + ошибки |
| `src/mobile/menus/useChannelMenuItems.tsx` | пункты меню канала по правам |
| `src/mobile/menus/ChannelMenuSheet.tsx` | ActionSheet + `EditChannelModal` + удаление с гейтом последнего канала |
| `src/mobile/screens/ServersScreen.tsx` + `.css` | §5.2 |
| `src/mobile/screens/ChannelsScreen.tsx` + `.css` | §5.3 |
| `src/mobile/screens/CreateServerScreen.tsx` | §5.9 |
| `src/mobile/screens/FindServerScreen.tsx` | §5.9 |
| `src/mobile/screens/ServerSettingsScreen.tsx` | §5.9 |
| `src/mobile/screens/InvitesScreen.tsx` + `.css` | §5.9 + D3 |
| `src/mobile/screens/StickersScreen.tsx` | §5.9 |
| `src/components/FindServerBody.tsx` | тело `FindServerModal` |
| `src/components/EditServerBody.tsx` | тело `EditServerModal` |
| `src/components/ManageInvitesBody.tsx` | тело `ManageInvitesModal` |
| `src/components/StickerManagerBody.tsx` | тело `StickerManager` |
| `src/pages/app/CreateServerForm.tsx` | тело `CreateServerModal` |

**Меняются:** `src/i18n/locales/ru.ts`, `src/i18n/locales/en.ts`,
`src/components/FindServerModal.tsx`, `src/components/EditServerModal.tsx`,
`src/components/ManageInvitesModal.tsx`, `src/components/StickerManager.tsx`,
`src/pages/app/CreateServerModal.tsx`, `src/pages/app/AppOverlays.tsx`,
`src/mobile/screens/renderScreen.tsx`, `src/mobile/MobileShell.tsx`,
`src/mobile/MobileShell.css`.

---

### Task 1: `MobileListRow` и словарь

**Файлы:**
- Создать: `client/src/mobile/components/MobileListRow.tsx`
- Создать: `client/src/mobile/components/MobileListRow.css`
- Создать: `client/src/mobile/components/__tests__/MobileListRow.test.tsx`
- Изменить: `client/src/i18n/locales/ru.ts` (блок `mobile:`, сейчас 5 ключей)
- Изменить: `client/src/i18n/locales/en.ts` (блок `mobile:`)

**Интерфейсы:**
- Производит: `MobileListRow` (props ниже) и ключи `mobile.*`, которыми пользуются
  задачи 2–12.

- [ ] **Шаг 1: ключи словаря**

В `ru.ts` блок `mobile` (он уже существует, рядом с `tabBar`/`tabServers`/
`tabFriends`/`tabProfile`/`sheetHandle`) дополняется. `plural` уже импортирован
первой строкой файла:

```ts
    addServer: 'Добавить сервер',
    createServerAction: 'Создать сервер',
    findServerAction: 'Найти сервер или ввести код',
    privateServer: 'Приватный сервер',
    serverActions: 'Действия сервера',
    channelActions: 'Действия канала',
    membersCount: plural({
      one: '{{count}} участник',
      few: '{{count}} участника',
      many: '{{count}} участников',
      other: '{{count}} участника',
    }),
    voiceLine: '{{names}} в голосе',
    voiceMore: '{{names}} +{{count}}',
    activityAttachment: 'Вложение',
    activitySticker: 'Стикер',
    activityCall: 'Звонок',
    activityPreview: '{{author}}: {{text}}',
    unreadCount: 'Непрочитанных: {{count}}',
    hasUnread: 'Есть непрочитанные',
    inviteFriends: 'Пригласить друзей',
    channelsEmpty: 'В этом сервере пока нет каналов',
```

В `en.ts` — те же ключи в том же порядке:

```ts
    addServer: 'Add server',
    createServerAction: 'Create server',
    findServerAction: 'Find a server or enter a code',
    privateServer: 'Private server',
    serverActions: 'Server actions',
    channelActions: 'Channel actions',
    membersCount: plural({
      one: '{{count}} member',
      other: '{{count}} members',
    }),
    voiceLine: '{{names}} in voice',
    voiceMore: '{{names}} +{{count}}',
    activityAttachment: 'Attachment',
    activitySticker: 'Sticker',
    activityCall: 'Call',
    activityPreview: '{{author}}: {{text}}',
    unreadCount: 'Unread: {{count}}',
    hasUnread: 'Unread messages',
    inviteFriends: 'Invite friends',
    channelsEmpty: 'This server has no channels yet',
```

- [ ] **Шаг 2: тест строки (упадёт — компонента нет)**

`client/src/mobile/components/__tests__/MobileListRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { MobileListRow } from '@/mobile/components/MobileListRow';

afterEach(cleanup);

describe('MobileListRow', () => {
  it('renders avatar slot, title, subtitle and meta', () => {
    render(
      <MobileListRow
        avatar={<span data-testid="av" />}
        title="Волчья стая"
        subtitle="Аня, Борис в голосе"
        meta={<span data-testid="meta" />}
      />,
    );
    expect(document.querySelector('.mobile-row')).not.toBeNull();
    expect(document.querySelector('.mobile-row-avatar [data-testid="av"]')).not.toBeNull();
    expect(document.querySelector('.mobile-row-title')?.textContent).toBe('Волчья стая');
    expect(document.querySelector('.mobile-row-sub')?.textContent).toBe('Аня, Борис в голосе');
    expect(document.querySelector('.mobile-row-meta [data-testid="meta"]')).not.toBeNull();
  });

  it('omits the subtitle node entirely when there is none', () => {
    render(<MobileListRow avatar={null} title="X" />);
    expect(document.querySelector('.mobile-row-sub')).toBeNull();
  });

  it('is a real button and fires onClick', () => {
    const onClick = vi.fn();
    render(<MobileListRow avatar={null} title="X" onClick={onClick} />);
    const row = document.querySelector('.mobile-row') as HTMLButtonElement;
    expect(row.tagName).toBe('BUTTON');
    expect(row.type).toBe('button');
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('spreads long-press handlers onto the row', () => {
    const handlers = { onPointerDown: vi.fn(), onContextMenu: vi.fn() };
    render(<MobileListRow avatar={null} title="X" longPress={handlers as never} />);
    fireEvent.pointerDown(document.querySelector('.mobile-row')!);
    expect(handlers.onPointerDown).toHaveBeenCalled();
  });
});
```

- [ ] **Шаг 3: прогнать — должен упасть**

Из `client/`:
```bash
npx vitest run src/mobile/components/__tests__/MobileListRow.test.tsx
```
Ожидается: FAIL, `Failed to resolve import "@/mobile/components/MobileListRow"`.

- [ ] **Шаг 4: компонент**

`client/src/mobile/components/MobileListRow.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { LongPressHandlers } from '@/mobile/gestures/useLongPress';
import './MobileListRow.css';

interface MobileListRowProps {
  /** Слот 48×48: аватар сервера, «#» канала, аватар пользователя. */
  avatar: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Справа: время, бейдж непрочитанного, иконка. */
  meta?: ReactNode;
  /** Иконка после заголовка (замок приватного сервера). */
  titleIcon?: ReactNode;
  onClick?: () => void;
  longPress?: LongPressHandlers;
  className?: string;
}

/** Строка списка мобильных экранов (спека §5.1). Всегда <button>: тач-фидбек и
 *  доступность бесплатно, поэтому вложенных кнопок внутри строки быть не может —
 *  второстепенные действия живут в меню по длинному нажатию. */
export function MobileListRow({
  avatar, title, subtitle, meta, titleIcon, onClick, longPress, className,
}: MobileListRowProps) {
  return (
    <button
      type="button"
      className={`mobile-row${className ? ` ${className}` : ''}`}
      onClick={onClick}
      {...longPress}
    >
      <span className="mobile-row-avatar">{avatar}</span>
      <span className="mobile-row-text">
        <span className="mobile-row-title">
          {title}
          {titleIcon}
        </span>
        {subtitle && <span className="mobile-row-sub">{subtitle}</span>}
      </span>
      {meta && <span className="mobile-row-meta">{meta}</span>}
    </button>
  );
}
```

- [ ] **Шаг 5: CSS**

`client/src/mobile/components/MobileListRow.css`:

```css
/* VYC-95 §5.1. Файл монтируется только мобильной оболочкой — медиазапросов нет. */
.mobile-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 8px 16px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  user-select: none;
}

.mobile-row:active {
  background: var(--canvas-2);
}

.mobile-row-avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
}

.mobile-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
  /* Хэрлайн с отступом под аватар: слева его не видно, как в телеграмных
     списках. Псевдоэлемент, а не border строки, — иначе линия шла бы и под
     аватаром. */
  position: relative;
  align-self: stretch;
  justify-content: center;
  padding: 8px 0;
}

.mobile-row-text::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: var(--line);
}

.mobile-row:last-child .mobile-row-text::after {
  display: none;
}

.mobile-row-title {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--ink);
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mobile-row-sub {
  overflow: hidden;
  color: var(--muted);
  font-size: 14px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mobile-row-meta {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  align-self: stretch;
  justify-content: center;
  color: var(--muted-2);
  font-size: 12px;
}
```

- [ ] **Шаг 6: прогнать тест — должен пройти**

```bash
npx vitest run src/mobile/components/__tests__/MobileListRow.test.tsx
```
Ожидается: 4 passed.

- [ ] **Шаг 7: гейты**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```
Ожидается: два первых — пустой вывод, третий — «непереведённых строк не найдено.».
Коммит не делать (Global Constraints).

---

### Task 2: точка расширения «активность каналов»

**Файлы:**
- Создать: `client/src/mobile/activity.ts`
- Создать: `client/src/mobile/components/ActivityMeta.tsx`
- Создать: `client/src/mobile/__tests__/activity.test.tsx`

**Интерфейсы:**
- Потребляет: ключи `mobile.activity*`, `mobile.unreadCount`, `mobile.hasUnread`
  (задача 1); `useDateFormat`, `isSameCalendarDay` из `@/i18n`.
- Производит:
  ```ts
  useChannelActivity(channelId: string): ChannelActivity | null
  useServerActivity(serverId: string): ChannelActivity | null
  __setActivityOverride(fn: ((id: string, scope: 'channel' | 'server') => ChannelActivity | null) | null): void
  // ActivityMeta.tsx
  useActivitySubtitle(a: ChannelActivity | null): string | null
  ActivityMeta({ activity }: { activity: ChannelActivity | null }): ReactNode
  ```
  Задачи 5 и 6 рисуют подзаголовок строки как `voiceLine ?? useActivitySubtitle(...)`,
  а правую колонку — как `<ActivityMeta activity={…} />`.

- [ ] **Шаг 1: тест (упадёт — модуля нет)**

`client/src/mobile/__tests__/activity.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useChannelActivity, useServerActivity, __setActivityOverride, type ChannelActivity } from '@/mobile/activity';
import { ActivityMeta, useActivitySubtitle } from '@/mobile/components/ActivityMeta';

afterEach(() => { __setActivityOverride(null); cleanup(); });

const base: ChannelActivity = { preview: null, timestamp: null, unreadCount: null, hasUnread: false };

function Probe({ id }: { id: string }) {
  const a = useChannelActivity(id);
  const sub = useActivitySubtitle(a);
  return <div data-sub={sub ?? ''}><ActivityMeta activity={a} /></div>;
}

describe('activity extension point', () => {
  it('returns null for both scopes without an override', () => {
    function P() {
      return <i data-ch={String(useChannelActivity('c1'))} data-sv={String(useServerActivity('s1'))} />;
    }
    render(<P />);
    expect(document.querySelector('i')?.getAttribute('data-ch')).toBe('null');
    expect(document.querySelector('i')?.getAttribute('data-sv')).toBe('null');
  });

  it('passes the id and the scope to the override', () => {
    const seen: Array<[string, string]> = [];
    __setActivityOverride((id, scope) => { seen.push([id, scope]); return base; });
    function P() { useChannelActivity('c1'); useServerActivity('s1'); return null; }
    render(<P />);
    expect(seen).toEqual([['c1', 'channel'], ['s1', 'server']]);
  });

  it('renders nothing when the activity is null', () => {
    render(<Probe id="c1" />);
    expect(document.querySelector('div')?.getAttribute('data-sub')).toBe('');
    expect(document.querySelector('.activity-badge')).toBeNull();
    expect(document.querySelector('.activity-time')).toBeNull();
  });

  it('renders a text preview as «Автор: текст»', () => {
    __setActivityOverride(() => ({ ...base, preview: { authorName: 'Аня', kind: 'text', text: 'привет' } }));
    render(<Probe id="c1" />);
    expect(document.querySelector('div')?.getAttribute('data-sub')).toBe('Аня: привет');
  });

  it('renders non-text previews by kind', () => {
    for (const [kind, expected] of [['attachment', 'Аня: Вложение'], ['sticker', 'Аня: Стикер'], ['call', 'Аня: Звонок']] as const) {
      __setActivityOverride(() => ({ ...base, preview: { authorName: 'Аня', kind } }));
      const { unmount } = render(<Probe id="c1" />);
      expect(document.querySelector('div')?.getAttribute('data-sub')).toBe(expected);
      unmount();
    }
  });

  it('shows a count badge, clamped at 99+', () => {
    __setActivityOverride(() => ({ ...base, unreadCount: 1234, hasUnread: true }));
    render(<Probe id="c1" />);
    expect(document.querySelector('.activity-badge')?.textContent).toBe('99+');
  });

  it('shows a plain dot when the count is unknown', () => {
    __setActivityOverride(() => ({ ...base, unreadCount: null, hasUnread: true }));
    render(<Probe id="c1" />);
    expect(document.querySelector('.activity-dot')).not.toBeNull();
    expect(document.querySelector('.activity-badge')).toBeNull();
  });

  it('shows today as HH:MM and older days as a date', () => {
    const today = new Date();
    today.setHours(14, 30, 0, 0);
    __setActivityOverride(() => ({ ...base, timestamp: today.toISOString() }));
    const first = render(<Probe id="c1" />);
    expect(document.querySelector('.activity-time')?.textContent).toMatch(/^\d{2}:\d{2}$/);
    first.unmount();

    __setActivityOverride(() => ({ ...base, timestamp: '2020-03-04T10:00:00.000Z' }));
    render(<Probe id="c1" />);
    const older = document.querySelector('.activity-time')?.textContent ?? '';
    expect(older).not.toMatch(/^\d{2}:\d{2}$/);
    expect(older.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Шаг 2: прогнать — должен упасть**

```bash
npx vitest run src/mobile/__tests__/activity.test.tsx
```
Ожидается: FAIL на резолве `@/mobile/activity`.

- [ ] **Шаг 3: модуль активности**

`client/src/mobile/activity.ts` (сигнатуры — дословно из спеки §5.6):

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

type Override = ((id: string, scope: 'channel' | 'server') => ChannelActivity | null) | null;

// Серверных меток прочтения ещё нет (спека §0: превью и счётчики — вне границ
// VYC-95). Хуки возвращают null, строки списков это понимают и выглядят как в
// §5.2/§5.3. Когда появится API, меняются ТОЛЬКО тела этих двух хуков.
let override: Override = null;

/** Только для тестов и проб. */
export function __setActivityOverride(fn: Override): void {
  override = fn;
}

export function useChannelActivity(channelId: string): ChannelActivity | null {
  return override ? override(channelId, 'channel') : null;
}

export function useServerActivity(serverId: string): ChannelActivity | null {
  return override ? override(serverId, 'server') : null;
}
```

- [ ] **Шаг 4: отрисовка активности**

`client/src/mobile/components/ActivityMeta.tsx`:

```tsx
import { useT, useDateFormat, isSameCalendarDay } from '@/i18n';
import type { ChannelActivity } from '@/mobile/activity';

/** Подзаголовок строки: «Автор: текст» / «Автор: Вложение» и т.д. */
export function useActivitySubtitle(activity: ChannelActivity | null): string | null {
  const t = useT();
  const p = activity?.preview;
  if (!p) return null;
  const body = p.kind === 'text'
    ? (p.text ?? '')
    : p.kind === 'attachment'
      ? t('mobile.activityAttachment')
      : p.kind === 'sticker'
        ? t('mobile.activitySticker')
        : t('mobile.activityCall');
  return t('mobile.activityPreview', { author: p.authorName, text: body });
}

/** Правая колонка строки: время и бейдж/точка непрочитанного. */
export function ActivityMeta({ activity }: { activity: ChannelActivity | null }) {
  const t = useT();
  const { formatTime, formatDayMonth } = useDateFormat();
  if (!activity) return null;
  const when = activity.timestamp ? new Date(activity.timestamp) : null;
  const timeText = when && !Number.isNaN(when.getTime())
    ? (isSameCalendarDay(when, new Date()) ? formatTime(when) : formatDayMonth(when))
    : null;
  const count = activity.unreadCount;
  return (
    <>
      {timeText && <span className="activity-time">{timeText}</span>}
      {count !== null && count > 0 && (
        <span className="activity-badge" aria-label={t('mobile.unreadCount', { count: String(count) })}>
          {count > 99 ? '99+' : count}
        </span>
      )}
      {count === null && activity.hasUnread && (
        <span className="activity-dot" aria-label={t('mobile.hasUnread')} />
      )}
    </>
  );
}
```

Стили `.activity-time` / `.activity-badge` / `.activity-dot` появятся в
`MobileListRow.css` следующим шагом — компонент рисуется только внутри
`.mobile-row-meta`.

- [ ] **Шаг 5: стили активности**

Дописать в конец `client/src/mobile/components/MobileListRow.css`:

```css
.activity-time {
  color: var(--muted-2);
  font-size: 12px;
  line-height: 1;
}

.activity-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.activity-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-pill);
  background: var(--accent);
}
```

Перед записью убедиться, что `--accent` и `--on-accent` действительно существуют
в `src/styles/tokens.css` (`grep -n "accent" src/styles/tokens.css`); если имена
другие — взять фактические имена ролевых токенов акцента, новых НЕ заводить.

- [ ] **Шаг 6: прогнать тесты — должны пройти**

```bash
npx vitest run src/mobile/__tests__/activity.test.tsx
```
Ожидается: 8 passed.

- [ ] **Шаг 7: гейты**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```

---

### Task 3: меню сервера

**Файлы:**
- Создать: `client/src/mobile/menus/useServerMenuItems.tsx`
- Создать: `client/src/mobile/menus/ServerMenuSheet.tsx`
- Создать: `client/src/mobile/menus/__tests__/serverMenu.test.tsx`

**Интерфейсы:**
- Потребляет: `ContextMenuItem` из `@/components/ContextMenu`, `ActionSheet`,
  `ConfirmModal`, `can`/`PERMISSIONS`, `apiService`, `useServerStore`.
- Производит:
  ```ts
  interface ServerMenuActions {
    onCreateChannel?: () => void;
    onSettings?: () => void;
    onInvites?: () => void;
    onStickers?: () => void;
    onDelete?: () => void;     // ServerMenuSheet подставляет сюда своё подтверждение
  }
  useServerMenuItems(server: Server, user: User | null, a: ServerMenuActions): ContextMenuItem[]

  interface ServerMenuSheetProps {
    server: Server | null;         // null → ничего не рендерится
    user: User | null;
    open: boolean;
    onClose: () => void;
    onCreateChannel?: () => void;
    onSettings?: () => void;
    onInvites?: () => void;
    onStickers?: () => void;
    onDeleted?: (serverId: string) => void;   // после успешного DELETE
  }
  ServerMenuSheet(props): ReactNode
  ```
  Задачи 5 и 6 рендерят `ServerMenuSheet` и передают навигацию в `on*`.

- [ ] **Шаг 1: тесты (упадут)**

`client/src/mobile/menus/__tests__/serverMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Server, User, PermissionSet } from '@/types';
import { PERMISSIONS } from '@/utils/permissions';
import { useServerStore } from '@/stores/serverStore';
import { useServerMenuItems } from '@/mobile/menus/useServerMenuItems';
import { ServerMenuSheet } from '@/mobile/menus/ServerMenuSheet';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, deleteServer: vi.fn(async () => {}) } };
});
import { apiService } from '@/services/api';

afterEach(cleanup);

const owner: User = { id: 'u1' } as User;
const stranger: User = { id: 'u2' } as User;
const server: Server = { id: 's1', name: 'Стая', owner_id: 'u1' } as Server;

const perms = (bits: bigint, isOwner = false): PermissionSet => ({ isOwner, bits, highestPosition: 0 });
const setPerms = (p: PermissionSet | undefined) => {
  useServerStore.setState({ permissions: new Map(p ? [['s1', p]] : []) });
};

const allActions = {
  onCreateChannel: vi.fn(), onSettings: vi.fn(), onInvites: vi.fn(), onStickers: vi.fn(), onDelete: vi.fn(),
};

function Items({ user }: { user: User | null }) {
  const items = useServerMenuItems(server, user, allActions);
  return <ul>{items.map((i) => <li key={i.label} data-danger={String(!!i.danger)}>{i.label}</li>)}</ul>;
}
const labels = () => [...document.querySelectorAll('li')].map((li) => li.textContent);

beforeEach(() => { setPerms(undefined); vi.clearAllMocks(); });

describe('useServerMenuItems', () => {
  it('gives the owner every action, with delete last and dangerous', () => {
    setPerms(perms(0n, true));
    render(<Items user={owner} />);
    expect(labels().length).toBe(5);
    expect(document.querySelectorAll('li')[4].getAttribute('data-danger')).toBe('true');
  });

  it('hides delete from a non-owner who can manage the server', () => {
    setPerms(perms(PERMISSIONS.MANAGE_SERVER | PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.CREATE_INVITE));
    render(<Items user={stranger} />);
    expect(document.querySelectorAll('li[data-danger="true"]').length).toBe(0);
  });

  it('gives a member with only CREATE_INVITE exactly one item', () => {
    setPerms(perms(PERMISSIONS.CREATE_INVITE));
    render(<Items user={stranger} />);
    expect(labels().length).toBe(1);
  });

  it('gives a member with no permissions no items at all', () => {
    setPerms(perms(0n));
    render(<Items user={stranger} />);
    expect(labels().length).toBe(0);
  });

  it('omits an item whose callback was not supplied', () => {
    setPerms(perms(0n, true));
    function Partial() {
      const items = useServerMenuItems(server, owner, { onSettings: vi.fn() });
      return <ul>{items.map((i) => <li key={i.label}>{i.label}</li>)}</ul>;
    }
    render(<Partial />);
    expect(labels().length).toBe(1);
  });
});

const sheet = (over: Partial<React.ComponentProps<typeof ServerMenuSheet>> = {}) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ServerMenuSheet server={server} user={owner} open onClose={vi.fn()} onSettings={vi.fn()} {...over} />
  </MemoryRouter>,
);

describe('ServerMenuSheet', () => {
  it('renders the items as an ActionSheet', async () => {
    setPerms(perms(0n, true));
    sheet();
    await act(async () => {});
    expect(document.querySelector('.sheet .action-sheet-item')).not.toBeNull();
  });

  it('deletes only after confirmation and reports the removal', async () => {
    setPerms(perms(0n, true));
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    sheet({ onDeleted, onClose, onDelete: undefined });
    await act(async () => {});
    const del = [...document.querySelectorAll('.action-sheet-item')].find((b) => b.classList.contains('is-danger'))!;
    fireEvent.click(del);
    await act(async () => {});
    expect(apiService.deleteServer).not.toHaveBeenCalled();
    const confirm = document.querySelector('.confirm-modal .btn-danger, .confirm-modal .btn-primary') as HTMLButtonElement;
    fireEvent.click(confirm);
    await act(async () => {});
    expect(apiService.deleteServer).toHaveBeenCalledWith('s1');
    expect(onDeleted).toHaveBeenCalledWith('s1');
  });

  it('renders nothing when there is no server', () => {
    sheet({ server: null });
    expect(document.querySelector('.sheet')).toBeNull();
  });
});
```

- [ ] **Шаг 2: прогнать — упадёт**

```bash
npx vitest run src/mobile/menus/__tests__/serverMenu.test.tsx
```

- [ ] **Шаг 3: хук пунктов**

`client/src/mobile/menus/useServerMenuItems.tsx`:

```tsx
import { Hash, Settings as SettingsIcon, Smile, Trash2, UserPlus } from 'lucide-react';
import type { Server, User } from '@/types';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { useServerStore } from '@/stores/serverStore';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';

export interface ServerMenuActions {
  onCreateChannel?: () => void;
  onSettings?: () => void;
  onInvites?: () => void;
  onStickers?: () => void;
  onDelete?: () => void;
}

/** Пункты меню сервера для ActionSheet (спека §4.3, §5.3). Пункт появляется,
 *  только если есть И право, И обработчик: на корне «Серверы» обработчика
 *  «создать канал» нет — этот пункт принадлежит экрану каналов. */
export function useServerMenuItems(server: Server, user: User | null, a: ServerMenuActions): ContextMenuItem[] {
  const t = useT();
  const perms = useServerStore((s) => s.permissions.get(server.id));
  const isOwner = server.owner_id === user?.id;
  const canManage = can(perms, PERMISSIONS.MANAGE_SERVER) || isOwner;
  const canManageChannels = can(perms, PERMISSIONS.MANAGE_CHANNELS);
  const canInvite = can(perms, PERMISSIONS.CREATE_INVITE);

  const items: ContextMenuItem[] = [];
  if (canManageChannels && a.onCreateChannel) {
    items.push({ label: t('channel.createChannelMenu'), icon: <Hash size={20} strokeWidth={1.8} />, onClick: a.onCreateChannel });
  }
  if (canInvite && a.onInvites) {
    items.push({ label: t('mobile.inviteFriends'), icon: <UserPlus size={20} strokeWidth={1.8} />, onClick: a.onInvites });
  }
  if (canManage && a.onSettings) {
    items.push({ label: t('server.editMenu'), icon: <SettingsIcon size={20} strokeWidth={1.8} />, onClick: a.onSettings });
  }
  if (canManage && a.onStickers) {
    items.push({ label: t('chat.manageStickersTitle'), icon: <Smile size={20} strokeWidth={1.8} />, onClick: a.onStickers });
  }
  // Удаление сервера — привилегия владения и на бэкенде (DeleteServer проверяет
  // только owner_id), роль с MANAGE_SERVER снести сервер не может.
  if (isOwner && a.onDelete) {
    items.push({ label: t('server.deleteMenu'), icon: <Trash2 size={20} strokeWidth={1.8} />, danger: true, onClick: a.onDelete });
  }
  return items;
}
```

- [ ] **Шаг 4: компонент потока**

`client/src/mobile/menus/ServerMenuSheet.tsx`:

```tsx
import { useRef, useState } from 'react';
import type { Server, User } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { useT } from '@/i18n';
import { useServerMenuItems } from './useServerMenuItems';

interface ServerMenuSheetProps {
  server: Server | null;
  user: User | null;
  open: boolean;
  onClose: () => void;
  onCreateChannel?: () => void;
  onSettings?: () => void;
  onInvites?: () => void;
  onStickers?: () => void;
  onDeleted?: (serverId: string) => void;
}

/** Мобильный аналог ServerMenu: те же права и тот же поток удаления, но
 *  ActionSheet вместо ContextMenu (спека §4.5). Десктопный ServerMenu не
 *  трогаем — «десктоп не меняется» дороже переиспользования. */
export function ServerMenuSheet(props: ServerMenuSheetProps) {
  // Гейт снаружи: внутреннее тело вызывает useServerMenuItems, которому нужен
  // непустой сервер. Ни одного хука до этой проверки — правила хуков целы.
  if (!props.server) return null;
  return <Body {...props} server={props.server} />;
}

function Body({
  server, user, open, onClose, onCreateChannel, onSettings, onInvites, onStickers, onDeleted,
}: ServerMenuSheetProps & { server: Server }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletingRef = useRef(false);

  const items = useServerMenuItems(server, user, {
    onCreateChannel, onSettings, onInvites, onStickers,
    onDelete: onDeleted ? () => setConfirming(true) : undefined,
  });

  const handleDelete = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    try {
      await apiService.deleteServer(server.id);
      useServerStore.getState().removeServer(server.id);
      setConfirming(false);
      onDeleted?.(server.id);
    } catch (err) {
      setConfirming(false);
      setError(apiErrorText(err, t));
      setTimeout(() => setError(null), 5000);
    } finally {
      deletingRef.current = false;
    }
  };

  return (
    <>
      <ActionSheet open={open && !confirming} onClose={onClose} title={server.name} items={items} />
      <ConfirmModal
        open={confirming}
        title={t('server.deleteTitle', { name: server.name })}
        body={t('server.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => void handleDelete()}
        onCancel={() => { setConfirming(false); onClose(); }}
      />
      {error && <div className="error-toast">{error}</div>}
    </>
  );
}
```

Замечание про `open && !confirming`: ActionSheet владеет записью в истории
(`useBackDismiss`), и держать его открытым под подтверждением значило бы две
записи на один жест. Выбор пункта закрывает шторку (`ActionSheet` зовёт
`onClose()` перед `onClick`), поэтому к моменту `confirming` шторка уже закрыта —
условие здесь страхует порядок, а не меняет его.

- [ ] **Шаг 5: прогнать тесты — должны пройти**

```bash
npx vitest run src/mobile/menus/__tests__/serverMenu.test.tsx
```
Ожидается: 8 passed. Если селектор кнопки подтверждения в тесте не находит
элемент — открыть `src/components/ConfirmModal.tsx` и взять фактические классы,
тест подогнать под компонент (не наоборот).

- [ ] **Шаг 6: гейты**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```

---

### Task 4: меню канала

**Файлы:**
- Создать: `client/src/mobile/menus/useChannelMenuItems.tsx`
- Создать: `client/src/mobile/menus/ChannelMenuSheet.tsx`
- Создать: `client/src/mobile/menus/__tests__/channelMenu.test.tsx`

**Интерфейсы:**
- Производит:
  ```ts
  useChannelMenuItems(channel: Channel, opts: {
    canManage: boolean; isLast: boolean; onRename?: () => void; onDelete?: () => void;
  }): ContextMenuItem[]

  interface ChannelMenuSheetProps {
    channel: Channel | null;
    serverId: string;
    channelCount: number;      // для гейта последнего канала
    open: boolean;
    onClose: () => void;
    onDeleted?: (channelId: string) => void;
  }
  ChannelMenuSheet(props): ReactNode
  ```

- [ ] **Шаг 1: тесты (упадут)**

`client/src/mobile/menus/__tests__/channelMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Channel, PermissionSet } from '@/types';
import { PERMISSIONS } from '@/utils/permissions';
import { useServerStore } from '@/stores/serverStore';
import { useChannelMenuItems } from '@/mobile/menus/useChannelMenuItems';
import { ChannelMenuSheet } from '@/mobile/menus/ChannelMenuSheet';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, deleteChannel: vi.fn(async () => {}) } };
});
import { apiService } from '@/services/api';

afterEach(cleanup);

const channel: Channel = { id: 'c1', server_id: 's1', name: 'общий', position: 0, created_at: '', updated_at: '' };
const perms = (bits: bigint): PermissionSet => ({ isOwner: false, bits, highestPosition: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  useServerStore.setState({ permissions: new Map([['s1', perms(PERMISSIONS.MANAGE_CHANNELS)]]) });
});

function Items({ canManage, isLast }: { canManage: boolean; isLast: boolean }) {
  const items = useChannelMenuItems(channel, { canManage, isLast, onRename: vi.fn(), onDelete: vi.fn() });
  return (
    <ul>
      {items.map((i) => (
        <li key={i.label} data-disabled={String(!!i.disabled)} data-reason={i.disabledReason ?? ''}>{i.label}</li>
      ))}
    </ul>
  );
}

describe('useChannelMenuItems', () => {
  it('gives rename and delete to a manager', () => {
    render(<Items canManage isLast={false} />);
    expect(document.querySelectorAll('li').length).toBe(2);
    expect(document.querySelectorAll('li')[1].getAttribute('data-disabled')).toBe('false');
  });

  it('disables delete for the last channel and says why', () => {
    render(<Items canManage isLast />);
    const del = document.querySelectorAll('li')[1];
    expect(del.getAttribute('data-disabled')).toBe('true');
    expect(del.getAttribute('data-reason')).not.toBe('');
  });

  it('gives a member without MANAGE_CHANNELS nothing', () => {
    render(<Items canManage={false} isLast={false} />);
    expect(document.querySelectorAll('li').length).toBe(0);
  });
});

const sheet = (over: Partial<React.ComponentProps<typeof ChannelMenuSheet>> = {}) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ChannelMenuSheet channel={channel} serverId="s1" channelCount={2} open onClose={vi.fn()} {...over} />
  </MemoryRouter>,
);

describe('ChannelMenuSheet', () => {
  it('deletes after confirmation', async () => {
    const onDeleted = vi.fn();
    sheet({ onDeleted });
    await act(async () => {});
    const del = [...document.querySelectorAll('.action-sheet-item')].find((b) => b.classList.contains('is-danger'))!;
    fireEvent.click(del);
    await act(async () => {});
    fireEvent.click(document.querySelector('.confirm-modal .btn-danger, .confirm-modal .btn-primary') as HTMLButtonElement);
    await act(async () => {});
    expect(apiService.deleteChannel).toHaveBeenCalledWith('s1', 'c1');
    expect(onDeleted).toHaveBeenCalledWith('c1');
  });

  it('refuses to delete the last channel even if the list shrank while the sheet was open', async () => {
    sheet({ channelCount: 1 });
    await act(async () => {});
    const del = [...document.querySelectorAll('.action-sheet-item')].find((b) => b.classList.contains('is-danger'))!;
    expect(del.hasAttribute('disabled')).toBe(true);
    expect(apiService.deleteChannel).not.toHaveBeenCalled();
  });

  it('opens the rename modal', async () => {
    sheet();
    await act(async () => {});
    const rename = document.querySelectorAll('.action-sheet-item')[0] as HTMLButtonElement;
    fireEvent.click(rename);
    await act(async () => {});
    expect(document.querySelector('.modal-overlay .modal')).not.toBeNull();
  });
});
```

- [ ] **Шаг 2: прогнать — упадёт**

```bash
npx vitest run src/mobile/menus/__tests__/channelMenu.test.tsx
```

- [ ] **Шаг 3: хук пунктов**

`client/src/mobile/menus/useChannelMenuItems.tsx`:

```tsx
import { Pencil, Trash2 } from 'lucide-react';
import type { Channel } from '@/types';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { useT } from '@/i18n';

interface ChannelMenuOptions {
  canManage: boolean;
  /** Последний канал сервера — удаление недоступно (гейт есть и на бэкенде). */
  isLast: boolean;
  onRename?: () => void;
  onDelete?: () => void;
}

/** Пункты меню канала (спека §5.3). Те же ключи и та же логика, что у
 *  ContextMenu в ChannelSidebar, включая disabledReason у последнего канала. */
export function useChannelMenuItems(channel: Channel, o: ChannelMenuOptions): ContextMenuItem[] {
  const t = useT();
  const items: ContextMenuItem[] = [];
  if (o.canManage && o.onRename) {
    items.push({ label: t('channel.editMenu'), icon: <Pencil size={20} strokeWidth={1.8} />, onClick: o.onRename });
  }
  if (o.canManage && o.onDelete) {
    items.push({
      label: t('channel.deleteMenu'),
      icon: <Trash2 size={20} strokeWidth={1.8} />,
      danger: true,
      disabled: o.isLast,
      disabledReason: t('channel.deleteLastDisabled'),
      onClick: o.onDelete,
    });
  }
  return items;
}
```

- [ ] **Шаг 4: компонент потока**

`client/src/mobile/menus/ChannelMenuSheet.tsx`:

```tsx
import { useRef, useState } from 'react';
import type { Channel } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { can, PERMISSIONS } from '@/utils/permissions';
import { ConfirmModal } from '@/components/ConfirmModal';
import { EditChannelModal } from '@/components/EditChannelModal';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { useT } from '@/i18n';
import { useChannelMenuItems } from './useChannelMenuItems';

interface ChannelMenuSheetProps {
  channel: Channel | null;
  serverId: string;
  channelCount: number;
  open: boolean;
  onClose: () => void;
  onDeleted?: (channelId: string) => void;
}

export function ChannelMenuSheet(props: ChannelMenuSheetProps) {
  if (!props.channel) return null;
  return <Body {...props} channel={props.channel} />;
}

function Body({ channel, serverId, channelCount, open, onClose, onDeleted }: ChannelMenuSheetProps & { channel: Channel }) {
  const t = useT();
  const perms = useServerStore((s) => s.permissions.get(serverId));
  const canManage = can(perms, PERMISSIONS.MANAGE_CHANNELS);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletingRef = useRef(false);

  const items = useChannelMenuItems(channel, {
    canManage,
    isLast: channelCount <= 1,
    onRename: () => setRenaming(true),
    onDelete: onDeleted ? () => setConfirming(true) : undefined,
  });

  const handleDelete = async () => {
    // Список мог измениться (WS от другого клиента), пока открыто подтверждение —
    // перепроверяем гейт последнего канала по стору, а не по пропу.
    if (useServerStore.getState().channels.length <= 1) {
      setConfirming(false);
      setError(t('channel.deleteLastDisabled'));
      setTimeout(() => setError(null), 5000);
      return;
    }
    if (deletingRef.current) return;
    deletingRef.current = true;
    try {
      await apiService.deleteChannel(serverId, channel.id);
      useServerStore.getState().removeChannel(channel.id);
      setConfirming(false);
      onDeleted?.(channel.id);
    } catch (err) {
      setConfirming(false);
      setError(apiErrorText(err, t));
      setTimeout(() => setError(null), 5000);
    } finally {
      deletingRef.current = false;
    }
  };

  return (
    <>
      <ActionSheet open={open && !renaming && !confirming} onClose={onClose} title={channel.name} items={items} />
      {renaming && (
        <EditChannelModal serverId={serverId} channel={channel} onClose={() => { setRenaming(false); onClose(); }} />
      )}
      <ConfirmModal
        open={confirming}
        title={t('channel.deleteTitle', { name: channel.name })}
        body={t('channel.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => void handleDelete()}
        onCancel={() => { setConfirming(false); onClose(); }}
      />
      {error && <div className="error-toast">{error}</div>}
    </>
  );
}
```

- [ ] **Шаг 5: прогнать тесты — должны пройти**

```bash
npx vitest run src/mobile/menus/__tests__/channelMenu.test.tsx
```
Ожидается: 6 passed.

- [ ] **Шаг 6: гейты**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```

---
### Task 5: экран «Серверы»

**Файлы:**
- Создать: `client/src/mobile/voiceLine.ts`
- Создать: `client/src/mobile/__tests__/voiceLine.test.ts`
- Создать: `client/src/mobile/screens/types.ts`
- Создать: `client/src/mobile/screens/ServersScreen.tsx`
- Создать: `client/src/mobile/screens/ServersScreen.css`
- Создать: `client/src/mobile/screens/__tests__/fixtures.tsx` (общие фикстуры тестов экранов)
- Создать: `client/src/mobile/screens/__tests__/ServersScreen.test.tsx`
- Изменить: `client/src/mobile/screens/renderScreen.tsx` (только перенос типа `ScreenCtx`)

**Интерфейсы:**
- Потребляет: `MobileListRow` (задача 1), `useServerActivity` + `ActivityMeta` +
  `useActivitySubtitle` (задача 2), `ServerMenuSheet` (задача 3), `useLongPress`,
  `ActionSheet`, `ScreenHeader`.
- Производит:
  ```ts
  // screens/types.ts — переезд из renderScreen.tsx, содержимое НЕ меняется
  export interface ScreenCtx { c: AppController; nav: MobileNav; joinVoice: (channel: Channel) => void }
  // voiceLine.ts
  export interface VoiceLineParts { names: string[]; extra: number }
  export function voiceLineParts(ids: readonly string[], nameOf: (id: string) => string, max?: number): VoiceLineParts | null
  // ServersScreen.tsx
  export function ServersScreen({ ctx }: { ctx: ScreenCtx }): ReactNode
  ```
  Задача 6 переиспользует `voiceLineParts` и `ScreenCtx`, задача 12 монтирует
  `ServersScreen` в `renderScreen`.

- [ ] **Шаг 1: тест чистой сборки голосовой строки (упадёт)**

`client/src/mobile/__tests__/voiceLine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { voiceLineParts } from '@/mobile/voiceLine';

const nameOf = (id: string) => ({ u1: 'Аня', u2: 'Борис', u3: 'Вера', u4: 'Глеб' }[id] ?? id.slice(0, 8));

describe('voiceLineParts', () => {
  it('returns null when nobody is in voice', () => {
    expect(voiceLineParts([], nameOf)).toBeNull();
  });

  it('keeps a single name without a remainder', () => {
    expect(voiceLineParts(['u1'], nameOf)).toEqual({ names: ['Аня'], extra: 0 });
  });

  it('keeps two names without a remainder', () => {
    expect(voiceLineParts(['u1', 'u2'], nameOf)).toEqual({ names: ['Аня', 'Борис'], extra: 0 });
  });

  it('counts everyone past the limit', () => {
    expect(voiceLineParts(['u1', 'u2', 'u3', 'u4'], nameOf)).toEqual({ names: ['Аня', 'Борис'], extra: 2 });
  });

  it('honours a custom limit', () => {
    expect(voiceLineParts(['u1', 'u2', 'u3'], nameOf, 1)).toEqual({ names: ['Аня'], extra: 2 });
  });

  it('falls back to a short id for an unknown user, like the desktop sidebar', () => {
    expect(voiceLineParts(['deadbeef-1111'], nameOf)).toEqual({ names: ['deadbeef'], extra: 0 });
  });
});
```

- [ ] **Шаг 2: прогнать — упадёт**

```bash
npx vitest run src/mobile/__tests__/voiceLine.test.ts
```

- [ ] **Шаг 3: реализация**

`client/src/mobile/voiceLine.ts`:

```ts
export interface VoiceLineParts {
  names: string[];
  /** Сколько участников не поместилось в names. */
  extra: number;
}

/** «Аня, Борис +1 в голосе» (спека §5.2, §5.3) — чистая часть без i18n:
 *  строку собирает компонент через mobile.voiceLine / mobile.voiceMore. */
export function voiceLineParts(
  ids: readonly string[],
  nameOf: (id: string) => string,
  max = 2,
): VoiceLineParts | null {
  if (ids.length === 0) return null;
  return { names: ids.slice(0, max).map(nameOf), extra: Math.max(0, ids.length - max) };
}
```

- [ ] **Шаг 4: прогнать — пройдёт**

```bash
npx vitest run src/mobile/__tests__/voiceLine.test.ts
```
Ожидается: 6 passed.

- [ ] **Шаг 5: перенести `ScreenCtx` в отдельный модуль**

Создать `client/src/mobile/screens/types.ts`:

```ts
import type { Channel } from '@/types';
import type { MobileNav } from '@/mobile/nav/useMobileNav';
import type { AppController } from '@/pages/app/useAppController';

export interface ScreenCtx {
  c: AppController;
  nav: MobileNav;
  joinVoice: (channel: Channel) => void; // вход + экран звонка
}
```

В `client/src/mobile/screens/renderScreen.tsx` удалить объявление
`export interface ScreenCtx { … }` вместе с тремя импортами типов, которые после
этого остаются неиспользованными (`Channel`, `MobileNav`, `AppController` —
последний нужен `ProfileRoot`/`ChannelsScreen`, проверить по факту), и добавить
рядом с остальными импортами:

```ts
import type { ScreenCtx } from './types';

export type { ScreenCtx } from './types';
```

Реэкспорт обязателен: `MobileShell.tsx` импортирует `type ScreenCtx` именно из
`./screens/renderScreen`, и этот файл задача 5 менять не должна.

- [ ] **Шаг 6: тест экрана (упадёт)**

Фикстуры выносятся в `client/src/mobile/screens/__tests__/fixtures.tsx` и
экспортируют `user`, `s1`, `s2`, `ch`, `members`, `nav()`, `controller(over?)` —
ими пользуются тесты задач 5, 6 и 12. Ниже они показаны внутри теста; при
реализации объявления `user … controller` переезжают в `fixtures.tsx`, а тест
начинается со строки `import { controller, nav } from './fixtures';`.

`client/src/mobile/screens/__tests__/ServersScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Server, Channel, User, MemberWithUser, PermissionSet } from '@/types';
import type { AppController } from '@/pages/app/useAppController';
import type { MobileNav } from '@/mobile/nav/useMobileNav';
import { useServerStore } from '@/stores/serverStore';
import { ServersScreen } from '@/mobile/screens/ServersScreen';
import { __setActivityOverride } from '@/mobile/activity';

afterEach(() => { __setActivityOverride(null); cleanup(); });

const user: User = { id: 'u1' } as User;
const s1: Server = { id: 's1', name: 'Волчья стая', owner_id: 'u1' } as Server;
const s2: Server = { id: 's2', name: 'Тихий омут', owner_id: 'u9', is_private: true } as Server;
const ch: Channel = { id: 'c1', server_id: 's1', name: 'общий', position: 0, created_at: '', updated_at: '' };
const members: MemberWithUser[] = [{ user_id: 'u2', username: 'Борис' } as MemberWithUser];

const nav = (): MobileNav => ({
  stack: [{ kind: 'servers' }], top: { kind: 'servers' }, tab: 'servers', valid: true,
  push: vi.fn(), pushMany: vi.fn(), back: vi.fn(), replaceStack: vi.fn(), switchTab: vi.fn(),
});

const controller = (over: Partial<AppController> = {}): AppController => ({
  user, servers: [s1, s2], currentServer: s1, channels: [ch], currentChannel: null, members,
  pendingCount: 0, voiceParticipants: new Map(), callNotif: null,
  selectServer: vi.fn(async () => {}), selectChannel: vi.fn(async () => {}), selectHome: vi.fn(),
  joinVoice: vi.fn(), goToCall: vi.fn(), serverRemoved: vi.fn(), channelRemoved: vi.fn(),
  joinServer: vi.fn(async () => {}), serverJoined: vi.fn(), createServer: vi.fn(async () => {}),
  joinCallNotif: vi.fn(), dismissCallNotif: vi.fn(), logout: vi.fn(), subscribe: () => () => {},
  ui: {
    findServerOpen: false, setFindServerOpen: vi.fn(), settingsOpen: false, setSettingsOpen: vi.fn(),
    createChannelOpen: false, setCreateChannelOpen: vi.fn(), createServerOpen: false, setCreateServerOpen: vi.fn(),
  },
  ...over,
});

const mount = (c: AppController, n: MobileNav = nav()) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ServersScreen ctx={{ c, nav: n, joinVoice: vi.fn() }} />
  </MemoryRouter>,
);

const perms = (bits: bigint, isOwner = false): PermissionSet => ({ isOwner, bits, highestPosition: 0 });
beforeEach(() => { useServerStore.setState({ permissions: new Map([['s1', perms(0n, true)]]) }); });

describe('ServersScreen', () => {
  it('renders one row per server with its name', () => {
    mount(controller());
    const rows = [...document.querySelectorAll('.mobile-row')];
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.mobile-row-title')?.textContent).toContain('Волчья стая');
  });

  it('opens the channels screen on tap', () => {
    const n = nav();
    mount(controller(), n);
    fireEvent.click(document.querySelectorAll('.mobile-row')[1]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'channels', serverId: 's2' });
  });

  it('shows who is in voice on the current server only', () => {
    mount(controller({ voiceParticipants: new Map([['c1', ['u2', 'u3', 'u4']]]) }));
    const subs = [...document.querySelectorAll('.mobile-row-sub')].map((n) => n.textContent);
    expect(subs[0]).toContain('Борис');
    expect(subs[0]).toContain('+2');
    // У чужого сервера данных о голосе нет — ничего не выдумываем.
    expect(document.querySelectorAll('.mobile-row')[1].querySelector('.mobile-row-sub')).toBeNull();
  });

  it('falls back to the activity preview when nobody is in voice', () => {
    __setActivityOverride((id) => (id === 's1'
      ? { preview: { authorName: 'Аня', kind: 'text', text: 'привет' }, timestamp: null, unreadCount: 3, hasUnread: true }
      : null));
    mount(controller());
    expect(document.querySelector('.mobile-row-sub')?.textContent).toBe('Аня: привет');
    expect(document.querySelector('.activity-badge')?.textContent).toBe('3');
  });

  it('opens the server menu on long press and not on a plain tap', async () => {
    const n = nav();
    mount(controller(), n);
    const row = document.querySelectorAll('.mobile-row')[0];
    fireEvent.pointerDown(row, { pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(document.querySelector('.sheet')).not.toBeNull();
    expect(n.push).not.toHaveBeenCalled();
  });

  it('offers create and find from the header «+»', async () => {
    const n = nav();
    mount(controller(), n);
    fireEvent.click(document.querySelector('.screen-header-actions button')!);
    await act(async () => {});
    const items = [...document.querySelectorAll('.action-sheet-item')];
    expect(items.length).toBe(2);
    fireEvent.click(items[1]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'findServer' });
  });

  it('shows the empty card with both buttons when there are no servers', () => {
    const n = nav();
    mount(controller({ servers: [], currentServer: null }), n);
    expect(document.querySelectorAll('.mobile-row').length).toBe(0);
    const buttons = [...document.querySelectorAll('.mobile-empty .btn')];
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[0]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'createServer' });
  });
});
```

- [ ] **Шаг 7: прогнать — упадёт**

```bash
npx vitest run src/mobile/screens/__tests__/ServersScreen.test.tsx
```

- [ ] **Шаг 8: экран**

`client/src/mobile/screens/ServersScreen.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Lock, Plus } from 'lucide-react';
import type { Server } from '@/types';
import { resolveUploadUrl } from '@/services/api';
import { useT } from '@/i18n';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { ActivityMeta, useActivitySubtitle } from '@/mobile/components/ActivityMeta';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { ServerMenuSheet } from '@/mobile/menus/ServerMenuSheet';
import { useLongPress } from '@/mobile/gestures/useLongPress';
import { useServerActivity } from '@/mobile/activity';
import { voiceLineParts } from '@/mobile/voiceLine';
import type { ScreenCtx } from './types';
import './ServersScreen.css';

/** Корень вкладки «Серверы» (спека §5.2). */
export function ServersScreen({ ctx }: { ctx: ScreenCtx }) {
  const { c, nav } = ctx;
  const t = useT();
  const [addOpen, setAddOpen] = useState(false);
  const [menuServer, setMenuServer] = useState<Server | null>(null);

  // Голос известен только про ТЕКУЩИЙ сервер: загружены каналы лишь его одного.
  const voiceIds = useMemo(() => {
    const ids: string[] = [];
    for (const ch of c.channels) ids.push(...(c.voiceParticipants.get(ch.id) ?? []));
    return ids;
  }, [c.channels, c.voiceParticipants]);

  const nameOf = useMemo(() => {
    const byId = new Map(c.members.map((m) => [m.user_id, m.username] as const));
    return (id: string) => byId.get(id) ?? id.slice(0, 8);
  }, [c.members]);

  return (
    <div className="servers-screen">
      <ScreenHeader
        title={t('mobile.tabServers')}
        actions={
          <button type="button" className="screen-header-btn" aria-label={t('mobile.addServer')} onClick={() => setAddOpen(true)}>
            <Plus size={24} strokeWidth={1.8} />
          </button>
        }
      />
      <div className="servers-list">
        {c.servers.length === 0 ? (
          <div className="mobile-empty">
            <h2 className="mobile-empty-title">{t('chat.noServersTitle')}</h2>
            <p className="mobile-empty-body">{t('chat.noServersBody')}</p>
            <div className="mobile-empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => nav.push({ kind: 'createServer' })}>
                {t('server.create')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => nav.push({ kind: 'findServer' })}>
                {t('chat.haveCode')}
              </button>
            </div>
          </div>
        ) : (
          c.servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              voiceIds={server.id === c.currentServer?.id ? voiceIds : []}
              nameOf={nameOf}
              onOpen={() => nav.push({ kind: 'channels', serverId: server.id })}
              onMenu={() => setMenuServer(server)}
            />
          ))
        )}
      </div>

      <ActionSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t('mobile.addServer')}
        items={[
          { label: t('mobile.createServerAction'), onClick: () => nav.push({ kind: 'createServer' }) },
          { label: t('mobile.findServerAction'), onClick: () => nav.push({ kind: 'findServer' }) },
        ]}
      />
      <ServerMenuSheet
        server={menuServer}
        user={c.user}
        open={menuServer !== null}
        onClose={() => setMenuServer(null)}
        onInvites={menuServer ? () => nav.push({ kind: 'invites', serverId: menuServer.id }) : undefined}
        onSettings={menuServer ? () => nav.push({ kind: 'serverSettings', serverId: menuServer.id }) : undefined}
        onStickers={menuServer ? () => nav.push({ kind: 'stickers', serverId: menuServer.id }) : undefined}
        onDeleted={(id) => { setMenuServer(null); c.serverRemoved(id); }}
      />
    </div>
  );
}

function ServerRow({
  server, voiceIds, nameOf, onOpen, onMenu,
}: {
  server: Server;
  voiceIds: string[];
  nameOf: (id: string) => string;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const t = useT();
  const longPress = useLongPress(onMenu);
  const activity = useServerActivity(server.id);
  const activitySub = useActivitySubtitle(activity);

  const parts = voiceLineParts(voiceIds, nameOf);
  const voiceText = parts
    ? t('mobile.voiceLine', {
        names: parts.extra > 0
          ? t('mobile.voiceMore', { names: parts.names.join(', '), count: String(parts.extra) })
          : parts.names.join(', '),
      })
    : null;

  return (
    <MobileListRow
      avatar={
        server.icon_url
          ? <img className="server-avatar" src={resolveUploadUrl(server.icon_url)} alt="" />
          : <span className="server-avatar">{server.name.charAt(0).toUpperCase()}</span>
      }
      title={server.name}
      titleIcon={server.is_private
        ? <Lock size={14} strokeWidth={1.8} aria-label={t('mobile.privateServer')} />
        : undefined}
      subtitle={voiceText ?? activitySub ?? undefined}
      meta={<ActivityMeta activity={activity} />}
      onClick={onOpen}
      longPress={longPress}
    />
  );
}
```

- [ ] **Шаг 9: CSS экрана**

`client/src/mobile/screens/ServersScreen.css`:

```css
/* VYC-95 §5.2. Только мобильная оболочка — медиазапросов нет. */
.servers-screen {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: var(--canvas);
}

.servers-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: env(safe-area-inset-bottom);
}

/* Аватар сервера: скруглённый квадрат на --canvas-2 с --ink. Стили рельса
   (--rail-*) здесь НЕ используются: на --canvas они требуют переопределения и
   фона, и текста (спека §5.2). */
.server-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-card);
  background: var(--canvas-2);
  color: var(--ink);
  font-size: 18px;
  font-weight: 600;
  object-fit: cover;
}

```

- [ ] **Шаг 9a: общие стили пустого состояния**

Классы `.mobile-empty*` нужны и экрану каналов (задача 6), поэтому они живут не
в `ServersScreen.css`, а в общем для оболочки `client/src/mobile/MobileShell.css`
— дописать в его конец, ПЕРЕД блоком `@keyframes`:

```css
/* Пустые состояния экранов списков (спека §5.2, §5.3). */
.mobile-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
}

.mobile-empty-title {
  margin: 0;
  color: var(--ink);
  font-size: 18px;
  font-weight: 600;
}

.mobile-empty-body {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

.mobile-empty-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 320px;
  margin-top: 8px;
}
```

- [ ] **Шаг 10: прогнать тесты экрана — должны пройти**

```bash
npx vitest run src/mobile/screens/__tests__/ServersScreen.test.tsx src/mobile/__tests__/voiceLine.test.ts
```
Ожидается: 7 + 6 passed. Селекторы шапки (`.screen-header-actions button`) сверить
с `src/mobile/components/ScreenHeader.tsx` — он уже существует и не меняется.

- [ ] **Шаг 11: гейты**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```

---

### Task 6: экран каналов

**Файлы:**
- Создать: `client/src/mobile/screens/ChannelsScreen.tsx`
- Создать: `client/src/mobile/screens/ChannelsScreen.css`
- Создать: `client/src/mobile/screens/__tests__/ChannelsScreen.test.tsx`

**Интерфейсы:**
- Потребляет: `ScreenCtx`, `voiceLineParts` (задача 5), `MobileListRow`,
  `ActivityMeta`/`useActivitySubtitle`/`useChannelActivity`, `ServerMenuSheet`,
  `ChannelMenuSheet`, `ScreenHeader`, `useLongPress`.
- Производит: `export function ChannelsScreen({ serverId, ctx }: { serverId: string; ctx: ScreenCtx }): ReactNode`
  — задача 12 монтирует её в `renderScreen` вместо `ChannelSidebar`.

- [ ] **Шаг 1: тест (упадёт)**

`client/src/mobile/screens/__tests__/ChannelsScreen.test.tsx` — импортирует
`controller` и `nav` из `./fixtures` (задача 5), объявляет свой `mount`,
монтирующий `<ChannelsScreen serverId="s1" ctx={{ c, nav: n, joinVoice: vi.fn() }} />`
в `MemoryRouter`, и проверяет:

```tsx
describe('ChannelsScreen', () => {
  it('waits while the store still points at another server', () => {
    mount(controller({ currentServer: null }));
    expect(document.querySelector('.mobile-screen-loading')).not.toBeNull();
    expect(document.querySelectorAll('.mobile-row').length).toBe(0);
  });

  it('shows the server name and its member count in the header', () => {
    mount(controller());
    expect(document.querySelector('.screen-header-name')?.textContent).toBe('Волчья стая');
    expect(document.querySelector('.screen-header-sub')?.textContent).toContain('1');
  });

  it('renders one row per channel and opens the chat on tap', () => {
    const n = nav();
    mount(controller(), n);
    expect(document.querySelectorAll('.mobile-row').length).toBe(1);
    fireEvent.click(document.querySelector('.mobile-row')!);
    expect(n.push).toHaveBeenCalledWith({ kind: 'chat', channelId: 'c1' });
  });

  it('shows who is in voice in the channel', () => {
    mount(controller({ voiceParticipants: new Map([['c1', ['u2']]]) }));
    expect(document.querySelector('.mobile-row-sub')?.textContent).toContain('Борис');
  });

  it('opens the channel menu on long press', async () => {
    mount(controller());
    fireEvent.pointerDown(document.querySelector('.mobile-row')!, { pointerType: 'touch', button: 0, clientX: 5, clientY: 5 });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(document.querySelector('.sheet')).not.toBeNull();
  });

  it('opens the server menu from «…» in the header', async () => {
    mount(controller());
    const buttons = [...document.querySelectorAll('.screen-header-actions button')];
    fireEvent.click(buttons[buttons.length - 1]);
    await act(async () => {});
    expect(document.querySelector('.sheet')).not.toBeNull();
  });

  it('leaves for the servers root when the server is deleted', async () => {
    const n = nav();
    const c = controller();
    mount(c, n);
    const buttons = [...document.querySelectorAll('.screen-header-actions button')];
    fireEvent.click(buttons[buttons.length - 1]);
    await act(async () => {});
    const del = [...document.querySelectorAll('.action-sheet-item')].find((b) => b.classList.contains('is-danger'))!;
    fireEvent.click(del);
    await act(async () => {});
    fireEvent.click(document.querySelector('.confirm-modal .btn-danger, .confirm-modal .btn-primary') as HTMLButtonElement);
    await act(async () => {});
    expect(c.serverRemoved).toHaveBeenCalledWith('s1');
    expect(n.back).toHaveBeenCalled();
  });

  it('shows the empty-channels hint when the server has none', () => {
    mount(controller({ channels: [] }));
    expect(document.querySelector('.mobile-empty-body')).not.toBeNull();
  });
});
```

Тест удаления сервера мокает `apiService.deleteServer` тем же способом, что тест
задачи 3 — блок `vi.mock('@/services/api', …)` копируется оттуда целиком.

- [ ] **Шаг 2: прогнать — упадёт**

```bash
npx vitest run src/mobile/screens/__tests__/ChannelsScreen.test.tsx
```

- [ ] **Шаг 3: экран**

`client/src/mobile/screens/ChannelsScreen.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Hash, MoreHorizontal } from 'lucide-react';
import type { Channel } from '@/types';
import { useT, useTp } from '@/i18n';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { ActivityMeta, useActivitySubtitle } from '@/mobile/components/ActivityMeta';
import { ServerMenuSheet } from '@/mobile/menus/ServerMenuSheet';
import { ChannelMenuSheet } from '@/mobile/menus/ChannelMenuSheet';
import { useLongPress } from '@/mobile/gestures/useLongPress';
import { useChannelActivity } from '@/mobile/activity';
import { voiceLineParts } from '@/mobile/voiceLine';
import type { ScreenCtx } from './types';
import './ChannelsScreen.css';

/** Экран каналов сервера (спека §5.3). */
export function ChannelsScreen({ serverId, ctx }: { serverId: string; ctx: ScreenCtx }) {
  const { c, nav } = ctx;
  const t = useT();
  const tp = useTp();
  const [serverMenu, setServerMenu] = useState(false);
  const [channelMenu, setChannelMenu] = useState<Channel | null>(null);

  const nameOf = useMemo(() => {
    const byId = new Map(c.members.map((m) => [m.user_id, m.username] as const));
    return (id: string) => byId.get(id) ?? id.slice(0, 8);
  }, [c.members]);

  // Стек может опережать сторы (восстановление записи, переключение сервера):
  // пока стор не догнал, экран ждёт, как и на этапе 1.
  if (c.currentServer?.id !== serverId) return <div className="mobile-screen-loading" />;
  const server = c.currentServer;

  return (
    <div className="channels-screen">
      <ScreenHeader
        title={server.name}
        subtitle={tp('mobile.membersCount', c.members.length)}
        onBack={nav.back}
        actions={
          <button type="button" className="screen-header-btn" aria-label={t('mobile.serverActions')} onClick={() => setServerMenu(true)}>
            <MoreHorizontal size={24} strokeWidth={1.8} />
          </button>
        }
      />
      <div className="channels-list">
        {c.channels.length === 0 ? (
          <div className="mobile-empty">
            <p className="mobile-empty-body">{t('mobile.channelsEmpty')}</p>
          </div>
        ) : (
          c.channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              voiceIds={c.voiceParticipants.get(channel.id) ?? []}
              nameOf={nameOf}
              onOpen={() => nav.push({ kind: 'chat', channelId: channel.id })}
              onMenu={() => setChannelMenu(channel)}
            />
          ))
        )}
      </div>

      <ServerMenuSheet
        server={server}
        user={c.user}
        open={serverMenu}
        onClose={() => setServerMenu(false)}
        onCreateChannel={() => c.ui.setCreateChannelOpen(true)}
        onInvites={() => nav.push({ kind: 'invites', serverId })}
        onSettings={() => nav.push({ kind: 'serverSettings', serverId })}
        onStickers={() => nav.push({ kind: 'stickers', serverId })}
        onDeleted={(id) => { setServerMenu(false); c.serverRemoved(id); nav.back(); }}
      />
      <ChannelMenuSheet
        channel={channelMenu}
        serverId={serverId}
        channelCount={c.channels.length}
        open={channelMenu !== null}
        onClose={() => setChannelMenu(null)}
        onDeleted={(id) => { setChannelMenu(null); c.channelRemoved(id); }}
      />
    </div>
  );
}

function ChannelRow({
  channel, voiceIds, nameOf, onOpen, onMenu,
}: {
  channel: Channel;
  voiceIds: string[];
  nameOf: (id: string) => string;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const t = useT();
  const longPress = useLongPress(onMenu);
  const activity = useChannelActivity(channel.id);
  const activitySub = useActivitySubtitle(activity);

  const parts = voiceLineParts(voiceIds, nameOf);
  const voiceText = parts
    ? t('mobile.voiceLine', {
        names: parts.extra > 0
          ? t('mobile.voiceMore', { names: parts.names.join(', '), count: String(parts.extra) })
          : parts.names.join(', '),
      })
    : null;

  return (
    <MobileListRow
      avatar={<span className="channel-avatar"><Hash size={20} strokeWidth={1.8} /></span>}
      title={channel.name}
      subtitle={voiceText ?? activitySub ?? undefined}
      meta={<ActivityMeta activity={activity} />}
      onClick={onOpen}
      longPress={longPress}
    />
  );
}
```

- [ ] **Шаг 4: CSS**

`client/src/mobile/screens/ChannelsScreen.css`:

```css
/* VYC-95 §5.3. */
.channels-screen {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: var(--canvas);
}

.channels-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: env(safe-area-inset-bottom);
}

.channel-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-pill);
  background: var(--canvas-2);
  color: var(--muted);
}
```

- [ ] **Шаг 5: прогнать тесты — должны пройти**

```bash
npx vitest run src/mobile/screens/__tests__/ChannelsScreen.test.tsx
```

- [ ] **Шаг 6: гейты**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```

---
### Task 7: каркас формы и экран «Создать сервер»

**Файлы:**
- Создать: `client/src/mobile/components/FormScreen.tsx`
- Создать: `client/src/mobile/components/FormScreen.css`
- Создать: `client/src/pages/app/CreateServerForm.tsx`
- Создать: `client/src/mobile/screens/CreateServerScreen.tsx`
- Создать: `client/src/mobile/screens/__tests__/CreateServerScreen.test.tsx`
- Изменить: `client/src/pages/app/CreateServerModal.tsx`

**Интерфейсы:**
- Производит:
  ```ts
  // FormScreen.tsx
  export function FormScreen({ title, onBack, actions, children }: {
    title: string; onBack: () => void; actions?: ReactNode; children: ReactNode;
  }): ReactNode
  // CreateServerForm.tsx
  export function CreateServerForm({ onCreate, onCancel, renderActions }: {
    onCreate: (name: string, isPrivate: boolean) => Promise<void>;
    onCancel: () => void;
    renderActions: (state: { canSubmit: boolean }) => ReactNode;
  }): ReactNode
  ```
  `FormScreen` используют задачи 8–11. Кнопки формы рисует вызывающая сторона —
  это контракт D4 плана; кнопки обязаны лежать ВНУТРИ `<form>`, иначе `type="submit"`
  на мобильном экране не отправит форму.

- [ ] **Шаг 1: `FormScreen`**

`client/src/mobile/components/FormScreen.tsx`:

```tsx
import type { ReactNode } from 'react';
import { ScreenHeader } from './ScreenHeader';
import './FormScreen.css';

/** Каркас полноэкранной формы (спека §5.9): шапка с «назад», прокручиваемое
 *  тело, основная кнопка липнет к низу над safe-area. Кнопка живёт внутри
 *  формы (класс .form-screen-actions), а не в отдельном слоте: иначе
 *  type="submit" пришлось бы связывать с формой атрибутом form=. */
export function FormScreen({ title, onBack, actions, children }: {
  title: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="form-screen">
      <ScreenHeader title={title} onBack={onBack} actions={actions} />
      <div className="form-screen-body">{children}</div>
    </div>
  );
}
```

`client/src/mobile/components/FormScreen.css`:

```css
/* VYC-95 §5.9. */
.form-screen {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: var(--canvas);
}

.form-screen-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
}

.form-screen-body .input,
.form-screen-body input[type="text"],
.form-screen-body input[type="email"],
.form-screen-body input[type="password"] {
  /* 16px — иначе iOS зумит страницу при фокусе. */
  font-size: 16px;
}

.form-screen-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px -16px 0;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: var(--canvas);
}

.form-screen-actions .btn {
  width: 100%;
  min-height: 44px;
}
```

- [ ] **Шаг 2: тест экрана (упадёт)**

`client/src/mobile/screens/__tests__/CreateServerScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CreateServerScreen } from '@/mobile/screens/CreateServerScreen';

afterEach(cleanup);

const mount = (createServer: (n: string, p: boolean) => Promise<void>, back = vi.fn()) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <CreateServerScreen onCreate={createServer} onBack={back} />
  </MemoryRouter>,
);

describe('CreateServerScreen', () => {
  it('submits the trimmed name and the privacy flag', async () => {
    const createServer = vi.fn(async () => {});
    mount(createServer);
    fireEvent.change(document.querySelector('input[type="text"]')!, { target: { value: '  Стая  ' } });
    fireEvent.click(document.querySelector('input[type="checkbox"]')!);
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {});
    expect(createServer).toHaveBeenCalledWith('Стая', true);
  });

  it('keeps the screen and shows the error when creation fails', async () => {
    const createServer = vi.fn(async () => { throw new Error('boom'); });
    const back = vi.fn();
    mount(createServer, back);
    fireEvent.change(document.querySelector('input[type="text"]')!, { target: { value: 'X' } });
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {});
    expect(document.querySelector('.modal-error')).not.toBeNull();
    expect(back).not.toHaveBeenCalled();
  });

  it('has its primary button inside the form and above the safe area', () => {
    mount(vi.fn(async () => {}));
    expect(document.querySelector('form .form-screen-actions .btn-primary')).not.toBeNull();
  });
});
```

- [ ] **Шаг 3: прогнать — упадёт**

```bash
npx vitest run src/mobile/screens/__tests__/CreateServerScreen.test.tsx
```

- [ ] **Шаг 4: вынести тело из `CreateServerModal`**

`client/src/pages/app/CreateServerForm.tsx` — содержимое `<form>` из
`CreateServerModal.tsx:34-67` переносится дословно, меняется только источник
кнопок:

```tsx
import { useState, type ReactNode } from 'react';
import { apiErrorText } from '@/services/api';
import { logger } from '@/utils/logger';
import { useT } from '@/i18n';

interface CreateServerFormProps {
  onCreate: (name: string, isPrivate: boolean) => Promise<void>;
  renderActions: (state: { canSubmit: boolean }) => ReactNode;
}

/** Поля формы создания сервера. Кнопки рисует вызывающая сторона и ОБЯЗАНА
 *  вернуть их внутрь этой формы (см. план этапа 2, решение D4): модалка —
 *  своим .modal-actions, мобильный экран — .form-screen-actions. */
export function CreateServerForm({ onCreate, renderActions }: CreateServerFormProps) {
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
    <form onSubmit={submit}>
      <div className="form-group">
        <label htmlFor="server-name">{t('server.nameLabel')}</label>
        <input
          id="server-name"
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          placeholder={t('server.namePlaceholder')}
          maxLength={100}
          autoFocus
          required
        />
      </div>
      <div className="form-group form-checkbox">
        <label>
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          {t('server.privateLabel')}
        </label>
      </div>
      {error && <p className="modal-error">{error}</p>}
      {renderActions({ canSubmit: name.trim().length > 0 })}
    </form>
  );
}
```

`client/src/pages/app/CreateServerModal.tsx` становится обёрткой с ТЕМ ЖЕ DOM:

```tsx
import { useT } from '@/i18n';
import { CreateServerForm } from './CreateServerForm';

interface CreateServerModalProps {
  onClose: () => void;
  onCreate: (name: string, isPrivate: boolean) => Promise<void>;
}

export function CreateServerModal({ onClose, onCreate }: CreateServerModalProps) {
  const t = useT();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('server.create')}</h2>
        <CreateServerForm
          onCreate={onCreate}
          renderActions={() => (
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('server.createSubmit')}
              </button>
            </div>
          )}
        />
      </div>
    </div>
  );
}
```

Сверить глазами: узлы, классы и порядок в модалке те же, что были (`h2`, `form`,
два `.form-group`, `.modal-error`, `.modal-actions` с двумя кнопками). Кнопка
«Создать» на десктопе НЕ получает `disabled` — его там не было.

- [ ] **Шаг 5: мобильный экран**

`client/src/mobile/screens/CreateServerScreen.tsx`:

```tsx
import { useT } from '@/i18n';
import { FormScreen } from '@/mobile/components/FormScreen';
import { CreateServerForm } from '@/pages/app/CreateServerForm';

/** Спека §5.9. Навигацию после успеха делает не экран: контроллер шлёт
 *  serverOpened, и MobileShell открывает каналы нового сервера. */
export function CreateServerScreen({ onCreate, onBack }: {
  onCreate: (name: string, isPrivate: boolean) => Promise<void>;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <FormScreen title={t('server.create')} onBack={onBack}>
      <CreateServerForm
        onCreate={onCreate}
        renderActions={({ canSubmit }) => (
          <div className="form-screen-actions">
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {t('server.createSubmit')}
            </button>
          </div>
        )}
      />
    </FormScreen>
  );
}
```

- [ ] **Шаг 6: прогнать тесты — должны пройти**

```bash
npx vitest run src/mobile/screens/__tests__/CreateServerScreen.test.tsx
```
Ожидается: 3 passed.

- [ ] **Шаг 7: гейты + весь набор тестов**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test 2>&1 | tail -20
```
`npm test`: ровно 3 падения, все в `api.network-retry.test.ts`.

---

### Task 8: экран «Найти сервер»

**Файлы:**
- Создать: `client/src/components/FindServerBody.tsx`
- Создать: `client/src/mobile/screens/FindServerScreen.tsx`
- Изменить: `client/src/components/FindServerModal.tsx`

**Интерфейсы:**
- Производит:
  ```ts
  export function FindServerBody({ active, onJoinServer, onServerJoined, onDone, onCreateServer }: {
    active: boolean;
    onJoinServer: (server: Server) => void;
    onServerJoined: (server: Server) => void;
    onDone: () => void;        // модалка: onClose; экран: nav.back()
    onCreateServer: () => void;
  }): ReactNode
  ```

- [ ] **Шаг 1: вынести тело**

`FindServerBody.tsx` получает из `FindServerModal.tsx` ДОСЛОВНО: состояния
(`query`, `results`, `preview`, `searched`, `busy`, `joinError`), оба эффекта
(сброс при закрытии и поиск с debounce 300 мс и stale-guard'ом), `handleJoinByInvite`,
и весь JSX НАЧИНАЯ с `<input className="input" data-autofocus …>` и ДО
`</div>` перед закрывающим `.modal` включительно — то есть: поле, метку
результатов, список, `.modal-error`, `.find-server-empty`, `.find-server-footer`.
Комментарии, которые сопровождают эффекты (stale-response guard, сброс joinError
на обеих границах), переезжают вместе с кодом — они описывают именно его.

Замены имён при переезде: `open` → `active`, `onClose()` → `onDone()`.
`useModalFocus` и `if (!open) return null` НЕ переезжают — они остаются в модалке.

`FindServerModal.tsx` после правки:

```tsx
export function FindServerModal({ open, onClose, onJoinServer, onServerJoined, onCreateServer }: FindServerModalProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(open, ref, onClose);
  if (!open) return null;
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
        <FindServerBody
          active={open}
          onJoinServer={onJoinServer}
          onServerJoined={onServerJoined}
          onDone={onClose}
          onCreateServer={onCreateServer}
        />
      </div>
    </div>
  );
}
```

Порядок и классы узлов внутри `.modal` не меняются — десктоп не трогаем.

- [ ] **Шаг 2: мобильный экран**

`client/src/mobile/screens/FindServerScreen.tsx`:

```tsx
import type { Server } from '@/types';
import { useT } from '@/i18n';
import { FormScreen } from '@/mobile/components/FormScreen';
import { FindServerBody } from '@/components/FindServerBody';

export function FindServerScreen({ onJoinServer, onServerJoined, onCreateServer, onBack }: {
  onJoinServer: (server: Server) => void;
  onServerJoined: (server: Server) => void;
  onCreateServer: () => void;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <FormScreen title={t('server.findServer.title')} onBack={onBack}>
      <FindServerBody
        active
        onJoinServer={onJoinServer}
        onServerJoined={onServerJoined}
        onDone={onBack}
        onCreateServer={onCreateServer}
      />
    </FormScreen>
  );
}
```

- [ ] **Шаг 3: тест поведения тела**

`client/src/components/__tests__/FindServerBody.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { FindServerBody } from '@/components/FindServerBody';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      searchServers: vi.fn(async () => [{ id: 's9', name: 'Найденный' }]),
      previewInvite: vi.fn(async () => { throw new Error('404'); }),
      joinViaInvite: vi.fn(async () => ({ id: 's9', name: 'Найденный' })),
    },
  };
});
import { apiService } from '@/services/api';

afterEach(cleanup);

describe('FindServerBody', () => {
  it('debounces the query and lists what the search returned', async () => {
    render(<FindServerBody active onJoinServer={vi.fn()} onServerJoined={vi.fn()} onDone={vi.fn()} onCreateServer={vi.fn()} />);
    fireEvent.change(document.querySelector('input')!, { target: { value: 'най' } });
    expect(apiService.searchServers).not.toHaveBeenCalled();
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    expect(apiService.searchServers).toHaveBeenCalledWith('най');
    expect(document.querySelector('.find-server-row')?.textContent).toContain('Найденный');
  });

  it('joins a found server and finishes', async () => {
    const onJoinServer = vi.fn();
    const onDone = vi.fn();
    render(<FindServerBody active onJoinServer={onJoinServer} onServerJoined={vi.fn()} onDone={onDone} onCreateServer={vi.fn()} />);
    fireEvent.change(document.querySelector('input')!, { target: { value: 'най' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    fireEvent.click(document.querySelector('.find-server-row .btn-primary')!);
    expect(onJoinServer).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('does not search while inactive', async () => {
    vi.mocked(apiService.searchServers).mockClear();
    render(<FindServerBody active={false} onJoinServer={vi.fn()} onServerJoined={vi.fn()} onDone={vi.fn()} onCreateServer={vi.fn()} />);
    fireEvent.change(document.querySelector('input')!, { target: { value: 'най' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    expect(apiService.searchServers).not.toHaveBeenCalled();
  });
});
```

- [ ] **Шаг 4: прогнать**

```bash
npx vitest run src/components/__tests__/FindServerBody.test.tsx
```
Ожидается: 3 passed.

- [ ] **Шаг 5: гейты**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```

---

### Task 9: экран настроек сервера

**Файлы:**
- Создать: `client/src/components/EditServerBody.tsx`
- Создать: `client/src/mobile/screens/ServerSettingsScreen.tsx`
- Изменить: `client/src/components/EditServerModal.tsx`

**Интерфейсы:**
- Производит:
  ```ts
  export function EditServerBody({ server, onDone, renderActions }: {
    server: Server;
    onDone: () => void;                                   // успешное сохранение / отмена
    renderActions: (state: { saving: boolean }) => ReactNode;
  }): ReactNode
  ```

- [ ] **Шаг 1: вынести тело**

В `EditServerBody.tsx` переезжают ДОСЛОВНО: константы `ALLOWED_TYPES`,
`MAX_FILE_BYTES`, все состояния, `handleFileChange`, `handleUploadIcon`,
`handleRemoveIcon`, `handleSubmit` (в нём `onClose()` → `onDone()`), блок
`.edit-server-icon-block` со скрытым `<input type="file">`, `<form>` с тремя
`.form-group`, `.modal-error` и — вместо жёстко вшитого `.modal-actions` —
`{renderActions({ saving })}`. `AvatarCropModal` (условный рендер по `cropFile`)
переезжает вместе с телом: кроп нужен обеим оболочкам, а на мобиле он остаётся
модалкой в sheet-стиле (спека §4.5, CSS этапа 1).

`EditServerModal.tsx` остаётся оболочкой:

```tsx
export function EditServerModal({ server, onClose }: EditServerModalProps) {
  const t = useT();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{t('server.editTitle')}</h2>
          <button
            type="button"
            className="modal-close-btn"
            title={t('common.close')}
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <EditServerBody
          server={server}
          onDone={onClose}
          renderActions={({ saving }) => (
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          )}
        />
      </div>
    </div>
  );
}
```

**Внимание на структуру:** сейчас у модалки корень — фрагмент `<>` с
`.modal-overlay` и `AvatarCropModal` СЕСТРОЙ оверлея. После переезда кроп
окажется внутри `.modal` — это изменение DOM и потенциально поведения (клик по
фону кропа гасился бы `stopPropagation` модалки). Поэтому `AvatarCropModal`
остаётся там, где он есть — в `EditServerModal` как сестра оверлея, а тело
получает проп `onPickFile: (file: File | null) => void` и `cropFile` наружу:

```ts
export function EditServerBody({ server, onDone, renderActions, onCropFile }: {
  server: Server;
  onDone: () => void;
  renderActions: (state: { saving: boolean }) => ReactNode;
  /** Файл выбран — кроп показывает ВЫЗЫВАЮЩАЯ сторона (модалка — сестрой
   *  оверлея, экран — поверх себя), тело им не владеет. */
  onCropFile: (file: File) => void;
}): ReactNode
```
и загрузку обрезанной картинки (`handleUploadIcon`) тоже держит вызывающая
сторона — она же владеет `AvatarCropModal`. Экспортировать её из тела:
`export async function uploadServerIcon(serverId: string, blob: Blob): Promise<void>`
(тело функции — дословно текущий `handleUploadIcon` без `setCropFile(null)`).

- [ ] **Шаг 2: мобильный экран**

`client/src/mobile/screens/ServerSettingsScreen.tsx`:

```tsx
import { useState } from 'react';
import type { Server } from '@/types';
import { useT } from '@/i18n';
import { FormScreen } from '@/mobile/components/FormScreen';
import { EditServerBody, uploadServerIcon } from '@/components/EditServerBody';
import { AvatarCropModal } from '@/components/AvatarCropModal';

export function ServerSettingsScreen({ server, onBack }: { server: Server; onBack: () => void }) {
  const t = useT();
  const [cropFile, setCropFile] = useState<File | null>(null);
  return (
    <>
      <FormScreen title={t('server.editTitle')} onBack={onBack}>
        <EditServerBody
          server={server}
          onDone={onBack}
          onCropFile={setCropFile}
          renderActions={({ saving }) => (
            <div className="form-screen-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          )}
        />
      </FormScreen>
      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          title={t('server.cropIconTitle')}
          onCancel={() => setCropFile(null)}
          onUpload={async (blob) => { await uploadServerIcon(server.id, blob); setCropFile(null); }}
        />
      )}
    </>
  );
}
```

- [ ] **Шаг 3: тест**

`client/src/components/__tests__/EditServerBody.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import type { Server } from '@/types';
import { EditServerBody } from '@/components/EditServerBody';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      updateServer: vi.fn(async (id: string, name: string, isPrivate: boolean) => ({ id, name, is_private: isPrivate })),
      setServerGuestLinks: vi.fn(async () => { throw new Error('nope'); }),
    },
  };
});
import { apiService } from '@/services/api';

afterEach(cleanup);

const server = { id: 's1', name: 'Стая', is_private: false, guest_links_enabled: true, owner_id: 'u1' } as Server;

const mount = (onDone = vi.fn()) => {
  render(
    <EditServerBody
      server={server}
      onDone={onDone}
      onCropFile={vi.fn()}
      renderActions={({ saving }) => (
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>ok</button>
        </div>
      )}
    />,
  );
  return onDone;
};

describe('EditServerBody', () => {
  it('saves the trimmed name and the privacy flag, then finishes', async () => {
    const onDone = mount();
    fireEvent.change(document.querySelector('#edit-server-name')!, { target: { value: '  Новая стая  ' } });
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {});
    expect(apiService.updateServer).toHaveBeenCalledWith('s1', 'Новая стая', true);
    expect(onDone).toHaveBeenCalled();
  });

  it('puts the guest-links toggle back and shows the error when the request fails', async () => {
    mount();
    const guest = document.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement;
    expect(guest.checked).toBe(true);
    fireEvent.click(guest);
    await act(async () => {});
    expect(apiService.setServerGuestLinks).toHaveBeenCalledWith('s1', false);
    expect((document.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector('.modal-error')).not.toBeNull();
  });

  it('hands a chosen icon file to the caller instead of cropping it itself', () => {
    const onCropFile = vi.fn();
    render(
      <EditServerBody server={server} onDone={vi.fn()} onCropFile={onCropFile} renderActions={() => null} />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'i.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onCropFile).toHaveBeenCalledWith(file);
    expect(document.querySelector('.avatar-crop-modal')).toBeNull();
  });
});
```

Селектор `.avatar-crop-modal` сверить с `src/components/AvatarCropModal.tsx`;
смысл проверки — кроп рисует вызывающая сторона, а не тело.

- [ ] **Шаг 4: прогнать и гейты**

```bash
npx vitest run src/components/__tests__/EditServerBody.test.tsx
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```

---

### Task 10: экран инвайт-ссылок

**Файлы:**
- Создать: `client/src/components/ManageInvitesBody.tsx`
- Создать: `client/src/mobile/screens/InvitesScreen.tsx`
- Создать: `client/src/mobile/screens/InvitesScreen.css`
- Создать: `client/src/mobile/screens/__tests__/InvitesScreen.test.tsx`
- Изменить: `client/src/components/ManageInvitesModal.tsx`

**Интерфейсы:**
- Производит:
  ```ts
  export function ManageInvitesBody({ serverId, renderActions, header }: {
    serverId: string;
    renderActions: (api: { creating: boolean; create: () => void }) => ReactNode;
    /** Мобильный экран кладёт сюда карточку «Пригласить друзей» (D3). */
    header?: ReactNode;
  }): ReactNode
  ```
  Десктопная модалка `header` не передаёт — её DOM остаётся прежним.

- [ ] **Шаг 1: вынести тело**

Переезжают: состояния (`invites`, `loading`, `error`, `creating`, `copiedCode`),
эффект загрузки с `cancelled`-гвардом, `handleCreate`, `handleCopy`,
`handleRevoke`, `expiryText`, и JSX от `.modal-error` до `</ul>` включительно;
вместо `.modal-actions` — `{renderActions({ creating, create: handleCreate })}`.
`header` рендерится ПЕРЕД `.modal-error` и только если передан (десктоп его не
передаёт — узла не появляется).

`ManageInvitesModal.tsx` сохраняет `.modal-overlay > .modal > .modal-header` и
передаёт `renderActions` с сегодняшней разметкой:

```tsx
<ManageInvitesBody
  serverId={serverId}
  renderActions={({ creating, create }) => (
    <div className="modal-actions">
      <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
        {creating ? t('common.saving') : t('server.invites.create')}
      </button>
    </div>
  )}
/>
```

- [ ] **Шаг 2: карточка «Пригласить друзей» и экран**

`client/src/mobile/screens/InvitesScreen.tsx`:

```tsx
import { useState } from 'react';
import type { Invite } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { inviteExpiry } from '@/utils/inviteExpiry';
import { useT } from '@/i18n';
import { FormScreen } from '@/mobile/components/FormScreen';
import { ManageInvitesBody } from '@/components/ManageInvitesBody';
import './InvitesScreen.css';

/** Карточка «Пригласить друзей»: создаёт ссылку при первом копировании — тот
 *  же поток, что у .invite-card в UserList на десктопе (спека строка 12). */
function InviteFriendsCard({ serverId }: { serverId: string }) {
  const t = useT();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    setError('');
    let inv = invite;
    if (!inv) {
      setBusy(true);
      try {
        inv = await apiService.createInvite(serverId);
        setInvite(inv);
      } catch (err) {
        setError(apiErrorText(err, t));
        return;
      } finally {
        setBusy(false);
      }
    }
    navigator.clipboard?.writeText(inv.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sub = (() => {
    if (!invite) return t('server.inviteCard.hint');
    const exp = inviteExpiry(invite.expires_at);
    return exp.kind === 'never'
      ? t('server.inviteCard.noExpiry')
      : t('server.inviteCard.expiresDays', { days: String(exp.days) });
  })();

  return (
    <div className="invite-friends-card">
      <span className="invite-friends-title">{t('server.inviteCard.title')}</span>
      <p className="invite-friends-sub">{sub}</p>
      {error && <p className="modal-error">{error}</p>}
      <button type="button" className="btn btn-secondary" onClick={() => void copy()} disabled={busy}>
        {copied ? t('server.invites.copied') : t('server.inviteCard.copyLink')}
      </button>
    </div>
  );
}

export function InvitesScreen({ serverId, onBack }: { serverId: string; onBack: () => void }) {
  const t = useT();
  return (
    <FormScreen title={t('server.invites.title')} onBack={onBack}>
      <ManageInvitesBody
        serverId={serverId}
        header={<InviteFriendsCard serverId={serverId} />}
        renderActions={({ creating, create }) => (
          <div className="form-screen-actions">
            <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
              {creating ? t('common.saving') : t('server.invites.create')}
            </button>
          </div>
        )}
      />
    </FormScreen>
  );
}
```

`client/src/mobile/screens/InvitesScreen.css`:

```css
/* VYC-95 §5.9 + решение D3 плана этапа 2. */
.invite-friends-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--canvas-2);
}

.invite-friends-title {
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
}

.invite-friends-sub {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.invite-friends-card .btn {
  min-height: 44px;
  margin-top: 4px;
}
```

Тач-цели списка ссылок: `.invites-actions .panel-icon-btn` на мобиле должны быть
≥ 44×44. Если сегодняшний размер меньше, добавить правило в `InvitesScreen.css`
через родителя экрана (`.form-screen .invites-actions .panel-icon-btn { … }`) —
десктопный `.panel-icon-btn` при этом не меняется.

- [ ] **Шаг 3: тест**

`client/src/mobile/screens/__tests__/InvitesScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InvitesScreen } from '@/mobile/screens/InvitesScreen';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listInvites: vi.fn(async () => [{ code: 'OLD', server_id: 's1', uses: 3, created_by: 'u1' }]),
      createInvite: vi.fn(async () => ({ code: 'NEW', server_id: 's1', uses: 0, created_by: 'u1' })),
      revokeInvite: vi.fn(async () => {}),
    },
  };
});
import { apiService } from '@/services/api';

afterEach(cleanup);

const writeText = vi.fn(() => Promise.resolve());
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

const mount = () => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <InvitesScreen serverId="s1" onBack={vi.fn()} />
  </MemoryRouter>,
);

describe('InvitesScreen', () => {
  it('lists the server invites', async () => {
    mount();
    await act(async () => {});
    expect(document.querySelector('.invites-code')?.textContent).toBe('OLD');
  });

  it('creates a link from the bottom button and puts it first', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(document.querySelector('.form-screen-actions .btn-primary')!);
    await act(async () => {});
    expect(apiService.createInvite).toHaveBeenCalledWith('s1');
    expect(document.querySelectorAll('.invites-code')[0].textContent).toBe('NEW');
  });

  it('creates a link on the first copy from the «invite friends» card', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(document.querySelector('.invite-friends-card .btn')!);
    await act(async () => {});
    expect(apiService.createInvite).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('NEW');
    // Второе нажатие переиспользует уже созданную ссылку.
    fireEvent.click(document.querySelector('.invite-friends-card .btn')!);
    await act(async () => {});
    expect(apiService.createInvite).toHaveBeenCalledTimes(1);
  });

  it('revokes a link and drops its row', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(document.querySelector('.invites-actions .panel-icon-btn.is-danger')!);
    await act(async () => {});
    expect(apiService.revokeInvite).toHaveBeenCalledWith('s1', 'OLD');
    expect(document.querySelector('.invites-code')).toBeNull();
  });
});
```

- [ ] **Шаг 4: прогнать и гейты**

```bash
npx vitest run src/mobile/screens/__tests__/InvitesScreen.test.tsx
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```

---

### Task 11: экран стикеров

**Файлы:**
- Создать: `client/src/components/StickerManagerBody.tsx`
- Создать: `client/src/mobile/screens/StickersScreen.tsx`
- Изменить: `client/src/components/StickerManager.tsx`

**Интерфейсы:**
- Производит:
  ```ts
  export function StickerManagerBody({ serverId, onStickersChanged }: {
    serverId: string;
    onStickersChanged?: () => void;
  }): ReactNode
  ```
  Тело включает инлайновые кнопки загрузки (решение D5 — отдельной нижней
  кнопки у экрана нет) и собственный `ConfirmModal` удаления.

- [ ] **Шаг 1: вынести тело**

Переезжает всё, кроме `.modal-overlay`, `.modal.sticker-manager` и
`.modal-header`: состояния, оба эффекта, `acceptFile`, `handleInputChange`,
`handleDrop`, `handleUpload`, `handleDelete`, поле имени, скрытый file-input,
дропзона, блок превью, `.error-toast`, `.sticker-manager-list`.

`ConfirmModal` сегодня — СЕСТРА `.sticker-manager` внутри оверлея, и в коде
объяснено почему: внутри `.modal` его фон гасился бы `stopPropagation` модалки.
Значит, он не может переехать в тело — иначе DOM десктопной модалки изменится.

Поэтому список стикеров поднимается в хук, общий для обеих оболочек:

```ts
// client/src/components/useServerStickers.ts
export function useServerStickers(serverId: string, onChanged?: () => void): {
  stickers: Sticker[];
  error: string | null;
  setError: (e: string | null) => void;
  busy: boolean;
  upload: (name: string, file: File) => Promise<void>;
  remove: (sticker: Sticker) => Promise<void>;
}
```

Тело (`StickerManagerBody`) получает результат хука пропом и рисует поле имени,
дропзону, блок превью, `.error-toast` и сетку стикеров, а `pendingDelete`
держит вызывающая сторона: она же рендерит `ConfirmModal` — модалка на прежнем
месте (сестрой `.sticker-manager`), экран — внутри себя. Так ни DOM десктопа,
ни логика не дублируются.

- [ ] **Шаг 2: мобильный экран**

`client/src/mobile/screens/StickersScreen.tsx` — `FormScreen` с заголовком
`chat.manageStickersTitle`, внутри тело и `ConfirmModal` удаления. Нижней
кнопки нет (D5).

- [ ] **Шаг 3: тест**

`client/src/components/__tests__/StickerManagerBody.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { StickersScreen } from '@/mobile/screens/StickersScreen';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listStickers: vi.fn(async () => [{ id: 'st1', name: 'волк', image_url: '/u/1.png' }]),
      uploadSticker: vi.fn(async () => ({ id: 'st2', name: 'лиса', image_url: '/u/2.png' })),
      deleteSticker: vi.fn(async () => {}),
    },
  };
});
import { apiService } from '@/services/api';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const mount = () => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <StickersScreen serverId="s1" onBack={vi.fn()} />
  </MemoryRouter>,
);

describe('StickersScreen', () => {
  it('lists the server stickers', async () => {
    mount();
    await act(async () => {});
    expect(document.querySelectorAll('.sticker-manager-item').length).toBe(1);
  });

  it('uploads only when both a name and a file are present', async () => {
    mount();
    await act(async () => {});
    // Без файла блока превью с кнопкой «Загрузить» вообще нет.
    expect(document.querySelector('.sticker-preview-info')).toBeNull();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['x'], 's.png', { type: 'image/png' })] },
    });
    await act(async () => {});
    const upload = document.querySelector('.sticker-preview-info .btn-primary') as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    fireEvent.change(document.querySelector('input.input')!, { target: { value: 'лиса' } });
    await act(async () => {});
    fireEvent.click(document.querySelector('.sticker-preview-info .btn-primary')!);
    await act(async () => {});
    expect(apiService.uploadSticker).toHaveBeenCalled();
    expect(document.querySelectorAll('.sticker-manager-item').length).toBe(2);
  });

  it('deletes a sticker only after confirmation', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(document.querySelector('.sticker-manager-item .panel-icon-btn.is-danger')!);
    await act(async () => {});
    expect(apiService.deleteSticker).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.confirm-modal .btn-danger, .confirm-modal .btn-primary') as HTMLButtonElement);
    await act(async () => {});
    expect(apiService.deleteSticker).toHaveBeenCalledWith('s1', 'st1');
    expect(document.querySelectorAll('.sticker-manager-item').length).toBe(0);
  });
});
```

Тест назван по телу, но монтирует экран: так проверяются сразу и тело, и то,
что подтверждение удаления рисует вызывающая сторона.

- [ ] **Шаг 4: прогнать и гейты**

```bash
npx vitest run src/components/__tests__/StickerManagerBody.test.tsx
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n
```

---
### Task 12: подключение экранов к оболочке

**Файлы:**
- Изменить: `client/src/mobile/screens/renderScreen.tsx`
- Изменить: `client/src/mobile/MobileShell.tsx`
- Изменить: `client/src/mobile/MobileShell.css`
- Изменить: `client/src/pages/app/AppOverlays.tsx`
- Изменить: `client/src/mobile/__tests__/MobileShell.nav.test.tsx` (при необходимости)
- Создать: `client/src/mobile/screens/__tests__/renderScreen.test.tsx`

**Интерфейсы:**
- Потребляет всё, что произвели задачи 5–11.
- Производит: `renderScreen`, который на `servers`, `channels`, `createServer`,
  `findServer`, `serverSettings`, `invites`, `stickers` рисует новые экраны.

- [ ] **Шаг 1: тест маршрутизации экранов (упадёт)**

`client/src/mobile/screens/__tests__/renderScreen.test.tsx` — для каждого вида
экрана проверяется, что смонтирован именно он, а не заглушка
`.mobile-screen-loading`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderScreen } from '@/mobile/screens/renderScreen';
import { controller, nav } from './fixtures';

afterEach(cleanup);

const show = (screen: Parameters<typeof renderScreen>[0], c = controller()) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    {renderScreen(screen, { c, nav: nav(), joinVoice: vi.fn() })}
  </MemoryRouter>,
);

describe('renderScreen (stage 2)', () => {
  it('mounts the mobile servers screen, not the desktop rail', () => {
    show({ kind: 'servers' });
    expect(document.querySelector('.servers-screen')).not.toBeNull();
    expect(document.querySelector('.server-list')).toBeNull();
  });

  it('mounts the mobile channels screen, not the desktop sidebar', () => {
    show({ kind: 'channels', serverId: 's1' });
    expect(document.querySelector('.channels-screen')).not.toBeNull();
    expect(document.querySelector('.channel-sidebar')).toBeNull();
  });

  it.each([
    ['createServer', {}],
    ['findServer', {}],
    ['serverSettings', { serverId: 's1' }],
    ['invites', { serverId: 's1' }],
    ['stickers', { serverId: 's1' }],
  ])('mounts a full-screen form for %s', (kind, extra) => {
    show({ kind, ...extra } as never);
    expect(document.querySelector('.form-screen')).not.toBeNull();
    expect(document.querySelector('.mobile-screen-loading')).toBeNull();
  });

  it('still falls back to the stub for screens of later stages', () => {
    show({ kind: 'search' });
    expect(document.querySelector('.mobile-screen-loading')).not.toBeNull();
  });
});
```

- [ ] **Шаг 2: прогнать — упадёт**

```bash
npx vitest run src/mobile/screens/__tests__/renderScreen.test.tsx
```

- [ ] **Шаг 3: переписать `renderScreen`**

Ветки `servers` и `channels` заменяются новыми экранами; `ServerList` и
`ChannelSidebar` из файла уходят (они остаются десктопными компонентами и
используются `DesktopShell`). Добавляются пять ветвей форм:

```tsx
    case 'servers':
      return <ServersScreen ctx={ctx} />;
    case 'channels':
      return <ChannelsScreen serverId={screen.serverId} ctx={ctx} />;
    case 'createServer':
      return <CreateServerScreen onCreate={c.createServer} onBack={nav.back} />;
    case 'findServer':
      return (
        <FindServerScreen
          onJoinServer={c.joinServer}
          onServerJoined={c.serverJoined}
          onCreateServer={() => nav.push({ kind: 'createServer' })}
          onBack={nav.back}
        />
      );
    case 'serverSettings':
      return c.currentServer?.id === screen.serverId
        ? <ServerSettingsScreen server={c.currentServer} onBack={nav.back} />
        : <div className="mobile-screen-loading" />;
    case 'invites':
      return <InvitesScreen serverId={screen.serverId} onBack={nav.back} />;
    case 'stickers':
      return <StickersScreen serverId={screen.serverId} onBack={nav.back} />;
```

`serverSettings` требует объект сервера, а не только id — пока стор не выбрал
нужный сервер, экран ждёт, как и `channels` (reconcile этапа 1 сам попросит
контроллер выбрать сервер по записи стека).

- [ ] **Шаг 4: убрать десктопные пути открытия форм на мобиле**

В `ChatScreen` (в этом же файле) заменить:
```tsx
        onCreateServer={() => c.ui.setCreateServerOpen(true)}
        onFindServer={() => c.ui.setFindServerOpen(true)}
```
на
```tsx
        onCreateServer={() => nav.push({ kind: 'createServer' })}
        onFindServer={() => nav.push({ kind: 'findServer' })}
```

В `MobileShell.tsx` — `AppOverlays` получает те же переопределения (палитра ⌘K
на мобиле не открывается, но её колбэки не должны вести к модалкам):

```tsx
      <AppOverlays
        c={c}
        onOpenCreateServer={() => nav.push({ kind: 'createServer' })}
        onOpenFindServer={() => nav.push({ kind: 'findServer' })}
        onPaletteSelectChannel={…}
        …
      />
```

В `AppOverlays.tsx` добавить необязательные пропы с прежним поведением по
умолчанию — десктоп не меняется:

```tsx
interface AppOverlaysProps {
  c: AppController;
  onOpenCreateServer?: () => void;
  onOpenFindServer?: () => void;
  onPaletteSelectChannel: (channel: Channel) => void;
  onPaletteJoinVoice: (channel: Channel) => void;
  onPaletteShowChat: () => void;
}
…
  const openCreateServer = onOpenCreateServer ?? (() => c.ui.setCreateServerOpen(true));
  const openFindServer = onOpenFindServer ?? (() => c.ui.setFindServerOpen(true));
```
и использовать `openFindServer` в `CommandPalette`, `openCreateServer` — в
`FindServerModal` и `CommandPalette`. `FindServerModal` и `CreateServerModal`
остаются смонтированными: на мобиле их флаги больше никто не поднимает, так что
они просто не рендерятся.

- [ ] **Шаг 5: почистить CSS оболочки**

В `client/src/mobile/MobileShell.css` из списка «панели этапа 1» убрать
`.mobile-screen > .server-list` и `.mobile-screen > .channel-sidebar` — этих
панелей на мобиле больше нет. Остальные (`.chat-area`, `.call-stage`,
`.user-list`, `.home-view`) остаются до этапов 3–5. В блоке навигационных
аффордансов `.mobile-shell .mobile-back-btn` оставить: его всё ещё используют
`UserList` и `HomeView`; `.channel-sidebar`-specific правил там нет.

- [ ] **Шаг 6: прогнать все мобильные тесты**

```bash
npx vitest run src/mobile src/components/__tests__ src/pages
```
Ожидается: зелено. Тест `MobileShell.nav.test.tsx` мокает `renderScreen`
целиком — он не должен сломаться; если сломался, чинить тест, а не оболочку.

- [ ] **Шаг 7: гейты целиком**

```bash
npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test 2>&1 | tail -20
```
`npm test`: ровно 3 падения, все в `api.network-retry.test.ts`.

---

### Task 13: проверка этапа

**Файлы:**
- Изменить: `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md` (колонка
  «Проверка» строк 5, 7–18, 19, 39, 91, 94)
- Скриншоты: `.superpowers/vyc95/s2/`

Инструменты уже есть с этапа 1: `client/tools/verify/smoke.mjs`,
фикстуры `.superpowers/vyc95/fixtures.js`, эталонная копия нетронутого HEAD.
Читать `client/docs/verification.md` и `client/tools/verify/README.md` перед
запуском — там же записаны обе ловушки (корневой `npm`, `dev:vite`).

- [ ] **Шаг 1: гейты**

Из `client/`:
```bash
npx tsc --noEmit; echo "tsc=$?"
npx stylelint "src/**/*.css"; echo "stylelint=$?"
npm run check:i18n
npm test 2>&1 | tail -25
```
Ожидается: два нуля без вывода, «непереведённых строк не найдено.», ровно 3
падения в `api.network-retry.test.ts`.

- [ ] **Шаг 2: десктоп не изменился**

Поднять два сервера: рабочее дерево (`npm run dev:vite`, порт 3100) и копию
нетронутого `HEAD` (порт 3101 — копия делается `git worktree`-независимым
способом: `cp -al` на `node_modules`, иначе шрифт Inter не подхватится и каждый
глиф уедет на пиксель; это реальная ловушка этапа 1). Снять те же 14 состояний
1280×800 в обеих темах с одинаковыми фикстурами и сравнить:

```bash
compare -metric AE base/<state>.png after/<state>.png diff-<state>.png
```
Ожидается: 0, допустимый шум — измеренные на этапе 1 2 пикселя. Любое большее
расхождение — регрессия; чинить, а не объяснять.

Состояния обязаны включать те, что задевает этот этап: открытая модалка
«Создать сервер», «Найти сервер», настройки сервера, инвайты, менеджер
стикеров, контекстное меню сервера и канала.

- [ ] **Шаг 3: мобильная матрица**

375×812, 390×844, 768×1024 в обеих темах: корень «Серверы» (со списком и
пустой), каналы, меню сервера (шторка), меню канала (шторка, в т.ч. с
заблокированным удалением последнего канала), «＋» шторка, createServer,
findServer, serverSettings, invites, stickers. Сохранять в
`.superpowers/vyc95/s2/`, просмотреть каждый.

- [ ] **Шаг 4: оба состояния активности (строка покрытия 94)**

Прогоном с `--preload`-пробой, которая зовёт
`__setActivityOverride(() => ({ preview: { authorName: 'Аня', kind: 'text', text: '<длинный текст>' }, timestamp: new Date().toISOString(), unreadCount: 1234, hasUnread: true }))`,
снять «Серверы» и каналы в обеих темах: строка обязана показать превью с
многоточием, время и бейдж «99+». Без override — те же экраны без правой
колонки. Обе пары в отчёт.

- [ ] **Шаг 5: полоса 769–899**

Снять 850×800: оболочка мобильная, панели `chat`/`call` ещё десктопные —
известная деградация, описанная в спеке §12a. Убедиться, что новые экраны
(«Серверы», каналы, формы) на 850 выглядят как на 768, а не разъезжаются.

- [ ] **Шаг 6: обновить таблицу покрытия**

В спеке проставить «✅ этап 2 — <файл скриншота / тест>» строкам 5, 7–18, 91
(в части сервера и канала) и 94; строке 19 — «частично, этап 2: вторая строка
канала; VoiceBanner — этап 3»; строке 39 — «частично: карточка «нет серверов» на
корне». Пустых клеток не оставлять.

- [ ] **Шаг 7: предложить коммит**

Изменения остаются в рабочем дереве. Пользователю выдать сообщение:

```
VYC-95 Мобильные экраны серверов и каналов

- экраны «Серверы» и каналов на MobileListRow вместо десктопных панелей
- меню сервера и канала как ActionSheet (useServerMenuItems/useChannelMenuItems)
- полноэкранные формы: создать сервер, найти сервер, настройки, инвайты, стикеры
- тела модалок вынесены в *Body — десктопный DOM не изменился
- activity.ts: точка расширения для превью и счётчиков непрочитанного
```

и точную команду `git add` со списком путей (без `-A`, без `.`), включая
`git add -f docs/superpowers/plans/2026-09-20-mobile-stage2-servers-channels.md`
— каталог `docs/superpowers/` игнорируется глобальным `~/.gitignore`.
