# Система цитат (quotes)

**Задача (Borda, «Чаты и Сообщения»):** Добавить систему цитат (quotes).

**Дата:** 2026-07-18
**Ветка:** `VYC-36-quotes`

## Предпосылки

Текущее состояние чата (проверено чтением `client/src/components/ChatArea.tsx` и `ChatArea.css`):

- Поле ввода — однострочный `<input type="text">` (не textarea, не contenteditable). Enter отправляет форму, многострочный ввод не поддерживается.
- Рендер текста сообщения — чистый plain text, единственная существующая разметка — подсветка упоминаний через `tokenizeMentions()` (`client/src/utils/mentions.ts`).
- Никакого markdown-парсинга (bold/italic/code/blockquote) нет ни на фронтенде, ни на бэкенде.
- Тип `Message` (фронт `client/src/types/index.ts`, бэк `server/internal/domain/message.go`) не содержит полей вроде `reply_to_id` — и не должен: эта фича не про "ответ на конкретное сообщение", а про markdown-подобную разметку `>` внутри текста.
- В `ChatArea.css:287-289` уже существует правило `.chat-input form { position: relative; }`, которое сейчас мертво: класс `chat-input` в JSX (`ChatArea.tsx:402`) висит прямо на `<form>`, вложенного `<form>` внутри `.chat-input`-контейнера нет.
- Автотестов на фронтенде нет вообще (`client/`: ни одного `*.test.*`/`*.spec.*`, нет testing-фреймворка в `package.json`).

## Принятые решения

| Вопрос | Решение |
|---|---|
| Область действия цитаты | Всё сообщение целиком (если `content` начинается с `"> "`), не построчно. Однострочный `<input>` не меняется на textarea. |
| Формат хранения в `content` | Без изменений схемы БД/API. Маркер `"> "` — часть обычного `content: string`. Никаких новых полей, никакой миграции, бэкенд не трогается. |
| Визуальный стиль цитаты | Discord-style: левая вертикальная полоса + отступ + приглушённый цвет текста, внутри существующего бабла сообщения (без отдельной рамки/фона). |
| Кнопка над полем ввода | Вставляет `"> "` в начало поля и ставит фокус; повторный клик при уже вставленном префиксе убирает его (toggle). Подсвечивается (`active`), когда поле уже начинается с `"> "`. |
| Оформление кнопки | Иконка (quote-глиф, тот же стиль что edit/delete-иконки в файле) + подпись «Цитата». |
| Редактирование цитированного сообщения | Не требует спецобработки: `startEdit` уже кладёт сырой `msg.content` (с `"> "`) в `editValue`, рендер после сохранения проходит тот же путь, что и обычные сообщения. |

## Frontend (`client/src/components/ChatArea.tsx`, `ChatArea.css`)

### Определение и рендер цитаты

Константа рядом с существующим `renderMessageContent`:

```ts
const QUOTE_PREFIX = '> ';
```

Новая функция `renderMessageBody`, оборачивающая существующий `renderMessageContent`:

```tsx
function renderMessageBody(content: string, members: MemberWithUser[], currentUserId?: string) {
  if (!content.startsWith(QUOTE_PREFIX)) {
    return renderMessageContent(content, members, currentUserId);
  }
  const body = content.slice(QUOTE_PREFIX.length);
  return <span className="message-quote">{renderMessageContent(body, members, currentUserId)}</span>;
}
```

Вызов на `ChatArea.tsx:360` меняется:

```diff
- <p className="message-text">{renderMessageContent(msg.content, members, user?.id)}</p>
+ <p className="message-text">{renderMessageBody(msg.content, members, user?.id)}</p>
```

Упоминания внутри цитаты продолжают работать, так как `renderMessageContent` вызывается на теле цитаты без изменений.

`input.trim()` в `handleSubmit` (строка 164) уже нормализует ведущие пробелы, так что `"  > текст"` и `"> текст"` в БД попадут одинаково — отдельная нормализация не нужна.

### CSS цитаты

Новый блок в `ChatArea.css` рядом с `.mention`:

```css
.message-quote {
  display: block;
  border-left: 3px solid var(--border-color);
  padding-left: 10px;
  color: var(--text-muted);
}
```

Бабл сообщения (`.message-text` — фон/рамка/скругления) не меняется.

### Кнопка над полем ввода

Структурная правка `ChatArea.tsx:402-429`. Было:

```tsx
<form className="chat-input" onSubmit={handleSubmit}>
  <input ... />
  {mention dropdown}
</form>
```

Стало:

```tsx
<div className="chat-input">
  <div className="chat-input-toolbar">
    <button
      type="button"
      className={`quote-toggle-btn${input.startsWith(QUOTE_PREFIX) ? ' active' : ''}`}
      aria-pressed={input.startsWith(QUOTE_PREFIX)}
      onClick={toggleQuotePrefix}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
      <span>Цитата</span>
    </button>
  </div>
  <form onSubmit={handleSubmit}>
    <input ... />
    {mention dropdown}
  </form>
</div>
```

Класс `chat-input` переносится с `<form>` на новый внешний `<div>` — CSS-правило `.chat-input { padding: ... }` продолжает работать без изменений. Ранее мёртвое правило `.chat-input form { position: relative; }` начинает применяться к `<form>` и сохраняет текущее позиционирование дропдауна упоминаний (`.mention-dropdown { position: absolute; bottom: calc(100% + 6px); ... }`) без изменений в его CSS.

Логика тоггла рядом с `handleSubmit`:

```ts
const toggleQuotePrefix = () => {
  setInput((prev) => (prev.startsWith(QUOTE_PREFIX) ? prev.slice(QUOTE_PREFIX.length) : `${QUOTE_PREFIX}${prev}`));
  requestAnimationFrame(() => inputRef.current?.focus());
};
```

### CSS тулбара и кнопки

```css
.chat-input-toolbar {
  display: flex;
  margin-bottom: 6px;
}

.quote-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-muted);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}

.quote-toggle-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.quote-toggle-btn.active {
  background: var(--brand-50);
  border-color: var(--brand-color);
  color: var(--brand-600);
}
```

Все переменные (`--radius-sm`, `--transition`, `--brand-600` и т.д.) уже используются в файле.

## Edge cases

- Пустая цитата (`"> "` без текста после маркера) технически проходит `input.trim()` (строка непустая) и отправляется — не блокируется отдельно, аналогично любому другому "бессмысленному" сообщению (например `"..."`). Дополнительная валидация не нужна (YAGNI).
- Сообщение вида `">текст"` без пробела после `>` НЕ считается цитатой (нет визуального оформления) — маркер строго `"> "` (`>` + пробел), как в стандартном markdown blockquote.

## Backend

Не затрагивается. Ни миграций, ни изменений `domain.Message`, ни изменений API/WS-протокола.

## Тестирование

Автотестов на фронтенде в проекте нет — верификация ручная через `npm run dev` (Electron/браузер):

1. Отправить обычное сообщение — рендер не изменился.
2. Отправить сообщение через кнопку «Цитата» (клик → `"> "` в поле → ввод текста → отправка) — проверить левую полосу + приглушённый цвет текста.
3. Отправить сообщение, напечатав `"> текст"` вручную без кнопки — тот же результат.
4. Повторный клик по кнопке при уже вставленном `"> "` — префикс убирается (toggle), кнопка теряет подсветку.
5. Напечатать `"> "`, проверить что кнопка подсвечена (`active`) ещё до отправки.
6. Отправить `"> @username текст"` — упоминание внутри цитаты подсвечивается как обычно.
7. Отредактировать цитированное сообщение (edit) — в поле редактирования виден сырой `"> "`, после сохранения рендер остаётся цитатой.
8. Мобильная раскладка (`max-width: 768px`) — тулбар и кнопка не ломают layout.
