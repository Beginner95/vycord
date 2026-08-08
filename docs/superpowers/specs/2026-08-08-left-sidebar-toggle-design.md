# Скрытие/показ левого сайдбара (десктоп)

**Дата:** 2026-08-08
**Область:** только клиент (`client/src/pages/AppPage.tsx`, `AppPage.css`, i18n). Подход A — состояние в AppPage + CSS.

## Проблема

Слева в `app-layout` расположены два сайдбара: `ServerList` (72px, колонка серверов) и `ChannelSidebar` (260px, колонка каналов). Нет способа скрыть их, чтобы освободить место под контент (чат/звонок). На узких десктопных окнах сайдбары съедают много пространства.

## Цель

Добавить возможность скрывать/показывать **весь левый блок** (ServerList + ChannelSidebar). Управление — тонкая вертикальная полоса слева (пока скрыт) + кнопка на границе (когда виден). Состояние сохраняется в localStorage. Функция работает только на десктопе (ширина > 768px); на мобильном ничего не меняется.

## Что сознательно не делаем (вне скоупа)

- **Не выносим состояние в глобальную стору** (zustand). Для одного UI-тумблера достаточно локального состояния в AppPage.
- **Не скрываем сайдбары по отдельности** — только весь левый блок вместе.
- **Мобильная навигация** — не трогаем, на `<768px` поведение панелей (`data-mobile-panel`) остаётся прежним.

## Состояние и персистентность

В `AppPage.tsx`:

```ts
const STORAGE_KEY = 'vycord.leftSidebarHidden';
const [leftSidebarHidden, setLeftSidebarHidden] = useState<boolean>(
  () => window.localStorage.getItem(STORAGE_KEY) === '1'
);

const toggleLeftSidebar = () => {
  setLeftSidebarHidden((v) => {
    const next = !v;
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    return next;
  });
};
```

## Разметка `.app-layout`

- На `.app-layout` добавляется атрибут `data-left-sidebar={leftSidebarHidden ? 'hidden' : 'shown'}`.
- В начало `.app-layout` добавляется левый «гуттер» (всегда присутствует, тонкая колонка):

```jsx
<button
  className="sidebar-gutter"
  onClick={toggleLeftSidebar}
  aria-label={leftSidebarHidden ? t('sidebar.show') : t('sidebar.hide')}
  title={leftSidebarHidden ? t('sidebar.show') : t('sidebar.hide')}
>
  {leftSidebarHidden ? '▶' : '◀'}
</button>
```

Когда сайдбары видимы — гуттер показывает «◀» (свернуть). Когда скрыты — «▶» (развернуть).

## CSS (в `AppPage.css`)

```css
.sidebar-gutter {
  width: 16px;
  min-width: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border: none;
  border-right: 1px solid var(--border-subtle);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
}

.sidebar-gutter:hover {
  color: var(--text-primary);
}

/* Скрываем сайдбары только на десктопе */
.app-layout[data-left-sidebar="hidden"] .server-list { display: none; }
.app-layout[data-left-sidebar="hidden"] .channel-sidebar { display: none; }
```

Когда `server-list` и `channel-sidebar` исчезают из flex-потока (`display:none`), контент (`chat-area` / `group-call-overlay`) и `user-list` автоматически расширяются — дополнительные правила ширины не нужны.

Скрыть «гуттер» на мобильном (навигация ведётся по `data-mobile-panel`):

```css
@media (max-width: 768px) {
  .sidebar-gutter { display: none; }
}
```

## i18n

Добавить ключи в `ru.ts` и `en.ts`:

- `sidebar.hide` — RU: «Скрыть сайдбар» / EN: «Hide sidebar»
- `sidebar.show` — RU: «Показать сайдбар» / EN: «Show sidebar»

## Проверка

Юнит-тестов на клиенте нет. Проверка вручную на dev-сервере (десктоп, ширина > 768px):

1. Кнопка «◀» скрывает и `ServerList`, и `ChannelSidebar`.
2. После скрытия остаётся доступная кнопка «▶» на левой границе, возвращающая сайдбары.
3. Состояние сохраняется после перезагрузки страницы (localStorage).
4. При активном групповом звонке скрытие так же работает (сайдбары скрываются, звонок занимает контент).
5. На мобильном (ширина < 768px) навигация по панелям не изменилась, гуттера нет.