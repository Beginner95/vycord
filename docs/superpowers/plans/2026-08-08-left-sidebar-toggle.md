# Скрытие/показ левого сайдбара — план реализации

> **Для агентных исполнителей:** ОБЯЗАТЕЛЬНЫЙ SUB-SKILL: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для пошаговой реализации. Шаги используют чек-боксы (`- [ ]`).

**Цель:** добавить кнопку-гуттер, скрывающую весь левый блок (ServerList + ChannelSidebar) на десктопе, с сохранением состояния в localStorage.

**Архитектура:** локальное состояние `leftSidebarHidden` в `AppPage.tsx`, атрибут `data-left-sidebar` на `.app-layout`, CSS прячет `.server-list`/`.channel-sidebar`. Гуттер — тонкая колонка 16px слева.

**Технологии:** React (TypeScript), CSS, существующая i18n-система.

## Global Constraints

- Юнит-тестов на клиенте нет — проверка через `tsc --noEmit`, `npm run build:vite`, `node scripts/check-i18n.mjs`.
- Работает только на десктопе (ширина > 768px); медиазапрос `@media (max-width: 768px)` уже управляет мобильными панелями.
- Скрываем **весь** левый блок, не по отдельности.
- Состояние сохраняется в localStorage под ключом `vycord.leftSidebarHidden`.
- Новая функциональность не трогает существующую мобильную навигацию (`data-mobile-panel`).

---

### Task 1: i18n-ключи `sidebar.hide` / `sidebar.show`

**Файлы:**
- Modify: `client/src/i18n/locales/ru.ts`
- Modify: `client/src/i18n/locales/en.ts`

**Интерфейсы:**
- Consumes: существующая структура словаря (объекты верхнего уровня: `common`, `chat`, `server`…)
- Produces: новые ключи `sidebar.hide`, `sidebar.show` в объекте `sidebar` — используются в Task 2

- [ ] **Step 1: Добавить ключи в ru.ts**

После блока `server: { ... }` (перед закрывающей структурой словаря) добавить top-level объект:

```ts
  sidebar: {
    hide: 'Скрыть сайдбар',
    show: 'Показать сайдбар',
  },
```

- [ ] **Step 2: Добавить ключи в en.ts**

```ts
  sidebar: {
    hide: 'Hide sidebar',
    show: 'Show sidebar',
  },
```

- [ ] **Step 3: Проверить i18n**

Run: `node scripts/check-i18n.mjs` (в `client/`)
Expected: `check-i18n: непереведённых строк не найдено.`

- [ ] **Step 4: Commit**

```bash
git add client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(i18n): ключи sidebar.hide/show"
```

---

### Task 2: Состояние и кнопка-гуттер в AppPage

**Файлы:**
- Modify: `client/src/pages/AppPage.tsx` (область состояния ~строка 84 и блок `.app-layout` ~строки 465–513)

**Интерфейсы:**
- Consumes: `useState` из React, `t` из `useT()` (уже есть в AppPage)
- Produces: атрибут `data-left-sidebar` на `.app-layout` и элемент `.sidebar-gutter` — используются стилями в Task 3

- [ ] **Step 1: Добавить состояние и обработчик**

Вставить после `const [voiceParticipants, setVoiceParticipants] = useState<Map<string, string[]>>(new Map());` (строка ~84):

```ts
const [leftSidebarHidden, setLeftSidebarHidden] = useState<boolean>(
    () => window.localStorage.getItem('vycord.leftSidebarHidden') === '1'
);

const toggleLeftSidebar = () => {
  setLeftSidebarHidden((v) => {
    const next = !v;
    window.localStorage.setItem('vycord.leftSidebarHidden', next ? '1' : '0');
    return next;
  });
};
```

- [ ] **Step 2: Добавить атрибут на `.app-layout`**

Открывающий тег `.app-layout` (строка ~465) изменить на:

```jsx
<div className="app-layout" data-mobile-panel={mobilePanel} data-in-call={inGroupCall ? 'true' : 'false'} data-left-sidebar={leftSidebarHidden ? 'hidden' : 'shown'}>
```

- [ ] **Step 3: Добавить кнопку-гуттер в начало layout**

Сразу после открывающего `<div className="app-layout" ...>` и перед `<ServerList`:

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

- [ ] **Step 4: Проверка типов**

Run: `npx tsc --noEmit` (в `client/`)
Expected: без ошибок (exit 0)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/AppPage.tsx
git commit -m "feat: состояние и кнопка-гуттер для левого сайдбара"
```

---

### Task 3: CSS для гуттера и скрытия сайдбаров

**Файлы:**
- Modify: `client/src/pages/AppPage.css` (добавить правила после `.app-layout[data-in-call]`, а также внутрь существующего `@media (max-width: 768px)`)

**Интерфейсы:**
- Consumes: атрибут `data-left-sidebar`, элемент `.sidebar-gutter` (из Task 2)
- Produces: визуальное скрытие/показ; пустой вывод

- [ ] **Step 1: Добавить стили гуттера и скрытия**

После блока `.app-layout[data-in-call="true"] .chat-area { display: none; }` вставить:

```css
/* ── Left sidebar collapse toggle (desktop only) ── */
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

.app-layout[data-left-sidebar="hidden"] .server-list { display: none; }
.app-layout[data-left-sidebar="hidden"] .channel-sidebar { display: none; }
```

- [ ] **Step 2: Скрыть гуттер на мобильном**

Внутри существующего `@media (max-width: 768px) { ... }` добавить:

```css
.sidebar-gutter {
    display: none;
  }
```

- [ ] **Step 3: Проверка сборки**

Run: `npm run build:vite` (в `client/`)
Expected: сборка успешна (`✓ built in ...`)

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/AppPage.css
git commit -m "feat: css скрытия левого сайдбара и кнопки-гуттера"
```

---

## Проверка по спеке (вручную, ширина > 768px)

1. Кнопка «◀» скрывает `ServerList` и `ChannelSidebar`; слева остаётся гуттер с «▶».
2. «▶» возвращает сайдбары.
3. Состояние переживает перезагрузку (localStorage).
4. Скрытие работает и при активном групповом звонке.
5. На мобильном (<768px) навигация не изменилась, гуттера нет.