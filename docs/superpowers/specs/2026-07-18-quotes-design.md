# Система цитат (quotes)

**Задача (Borda, «Чаты и Сообщения»):** Добавить систему цитат (quotes).

**Дата:** 2026-07-18 (V1), обновлено 2026-07-18 (V2 — многострочный ввод)
**Ветка:** `VYC-36-quotes`

## V1 → V2

V1 уже реализован и закоммичен (`c08194a`, `c51f4e4`, `e9e1960`): цитата — это признак **всего сообщения целиком** (`content` начинается с `"> "`), поле ввода — однострочный `<input>`. Полностью работает, собирается, вручную проверен через `build:vite` + API-smoke-test.

V2 (эта версия спеки) меняет две ключевые вещи, которые в V1 были осознанно исключены:

1. Поле ввода становится **многострочным** (`<textarea>` вместо `<input>`).
2. Цитата определяется **построчно**: в одном сообщении можно написать несколько строк с `"> "` подряд (цитата), а после них — обычный текст без префикса, и всё это один `content` с `\n` внутри.

Всё остальное из V1 (маркер `"> "` = `>` + пробел, левая полоса + приглушённый текст, кнопка над полем ввода, backend не трогается) остаётся в силе и распространяется на многострочный случай.

## Предпосылки (актуальное состояние на момент V2, после V1)

- Поле ввода — `<input type="text">` (`ChatArea.tsx`), рендерит `renderMessageBody`, который проверяет префикс `"> "` у всего `content`.
- Поле редактирования (`editValue`/`editInputRef`) — тоже однострочный `<input>`.
- Оба поля используют один и тот же хук `useMentionAutocomplete` (`client/src/hooks/useMentionAutocomplete.ts`), жёстко типизированный под `HTMLInputElement` (`ChangeEvent<HTMLInputElement>`, `RefObject<HTMLInputElement | null>`, `KeyboardEvent<HTMLInputElement>`). Логика хука использует только `.value`, `.selectionStart`, `.setSelectionRange()`, `.focus()` — все они есть и на `HTMLTextAreaElement`.
- `tokenizeMentions()` (`client/src/utils/mentions.ts`) — чистый regex по `content`, не завязан на переносы строк; многострочный `content` тем самым уже совместим с текущим механизмом упоминаний без изменений.
- `.message-text` в CSS не имеет `white-space: pre-wrap` (по умолчанию `normal`) — `\n` внутри текста сейчас коллапсируется браузером.
- Автотестов на фронтенде нет — верификация только через `build:vite` + ручная проверка (как в V1).

## Принятые решения (V2)

| Вопрос | Решение |
|---|---|
| Область действия цитаты | Построчно. Каждая строка `content`, начинающаяся с `"> "`, — цитата; **подряд идущие** цитатные строки визуально объединяются в один блок (одна левая полоса на группу), не по одной полосе на строку. |
| Поле ввода | `<textarea>` вместо `<input>`, и в compose, и в edit. |
| Отправка / перенос строки | Enter — отправляет (или сохраняет edit); Shift+Enter — вставляет перенос строки. |
| Высота поля | Авто-рост вместе с текстом до `max-height` (см. CSS), дальше — внутренний скролл. Пересчёт на каждое изменение значения. |
| Кнопка «Цитата»: действие | Вставляет/убирает `"> "` в начале **строки, на которой сейчас курсор** (не всего текста). |
| Кнопка «Цитата»: подсветка (`active`) | Live — отражает, процитирована ли строка под текущей позицией курсора; обновляется по `onSelect`/`onClick`/`onKeyUp`, не только по `onChange`. |
| Редактирование | Тот же `<textarea>` с теми же правилами (Enter/Shift+Enter, авто-высота), что и compose-поле — иначе многострочное сообщение нельзя было бы корректно отредактировать. |
| Формат хранения в `content` | Без изменений схемы БД/API (как в V1). `\n` — обычный символ внутри `content: string`. |
| Визуальный стиль цитаты | Как в V1: левая вертикальная полоса + отступ + приглушённый цвет текста, `display: block` на группу. |

## Frontend

### Рендер: построчный парсинг

`renderMessageBody` полностью переписывается (заменяет версию из V1):

```tsx
function renderMessageBody(content: string, members: MemberWithUser[], currentUserId?: string) {
  const lines = content.split('\n');
  const groups: { quoted: boolean; lines: string[] }[] = [];

  for (const line of lines) {
    const quoted = line.startsWith(QUOTE_PREFIX);
    const text = quoted ? line.slice(QUOTE_PREFIX.length) : line;
    const last = groups[groups.length - 1];
    if (last && last.quoted === quoted) {
      last.lines.push(text);
    } else {
      groups.push({ quoted, lines: [text] });
    }
  }

  return groups.map((group, i) => {
    const text = group.lines.join('\n');
    const rendered = renderMessageContent(text, members, currentUserId);
    return group.quoted
      ? <span key={i} className="message-quote">{rendered}</span>
      : <span key={i}>{rendered}</span>;
  });
}
```

`renderMessageContent` не меняется — `tokenizeMentions` уже корректно работает на многострочном `text` внутри группы.

Вызов в JSX (`<p className="message-text">{renderMessageBody(msg.content, members, user?.id)}</p>`) не меняется.

### CSS рендера

```css
.message-text {
  white-space: pre-wrap;
}

.message-quote {
  display: block;
  border-left: 3px solid var(--border-color);
  padding-left: 10px;
  color: var(--text-muted);
}
```

(`.message-quote` — то же правило, что в V1, без изменений; новое — только `white-space: pre-wrap` на `.message-text`.)

### Compose: textarea, автовысота, Enter/Shift+Enter

`inputRef` меняет тип на `RefObject<HTMLTextAreaElement>`. `<input>` в JSX заменяется на `<textarea>`:

```tsx
<textarea
  ref={inputRef}
  value={input}
  onChange={handleComposeChange}
  onKeyDown={handleComposeKeyDown}
  onSelect={updateQuoteButtonActive}
  onClick={updateQuoteButtonActive}
  onKeyUp={updateQuoteButtonActive}
  placeholder={`Message #${channel.name}`}
  maxLength={2000}
  rows={1}
/>
```

Обработчик Enter/Shift+Enter (заменяет неявную отправку формы по Enter, т.к. `textarea` её не делает):

```ts
const handleComposeKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
  if (composeMention.handleKeyDown(e)) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSubmit(e as unknown as FormEvent);
  }
};
```

Автовысота — эффект, реагирующий на `input`:

```ts
useEffect(() => {
  const el = inputRef.current;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}, [input]);
```

CSS:

```css
.chat-input textarea {
  width: 100%;
  padding: 13px 18px;
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  resize: none;
  max-height: 40vh;
  overflow-y: auto;
  transition: all var(--transition);
  box-shadow: var(--shadow-sm);
}

.chat-input textarea::placeholder {
  color: var(--text-muted);
}

.chat-input textarea:focus {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 3px var(--brand-subtle), var(--shadow-md);
}
```

(Заменяет блок `.chat-input input` из V1 один в один, включая `:focus`/`::placeholder`.)

### Кнопка «Цитата»: действие на текущей строке + live-подсветка

```ts
const [caretInQuoteLine, setCaretInQuoteLine] = useState(false);

const currentLineRange = (value: string, caret: number) => {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  const endIdx = value.indexOf('\n', caret);
  const end = endIdx === -1 ? value.length : endIdx;
  return { start, end };
};

const updateQuoteButtonActive = () => {
  const el = inputRef.current;
  if (!el) return;
  const caret = el.selectionStart ?? 0;
  const { start, end } = currentLineRange(input, caret);
  setCaretInQuoteLine(input.slice(start, end).startsWith(QUOTE_PREFIX));
};

const toggleQuotePrefix = () => {
  const el = inputRef.current;
  const caret = el?.selectionStart ?? input.length;
  const { start, end } = currentLineRange(input, caret);
  const line = input.slice(start, end);
  const quoted = line.startsWith(QUOTE_PREFIX);
  const newLine = quoted ? line.slice(QUOTE_PREFIX.length) : `${QUOTE_PREFIX}${line}`;
  const newValue = input.slice(0, start) + newLine + input.slice(end);
  const delta = newLine.length - line.length;

  setInput(newValue);
  setCaretInQuoteLine(!quoted);
  requestAnimationFrame(() => {
    el?.focus();
    const pos = caret + delta;
    el?.setSelectionRange(pos, pos);
  });
};
```

`updateQuoteButtonActive` также вызывается сразу после `handleChange`, чтобы подсветка обновлялась и при обычном наборе текста, а не только при перемещении курсора. Явная обёртка вместо прямой передачи `composeMention.handleChange` в `onChange`:

```ts
const handleComposeChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
  composeMention.handleChange(e);
  updateQuoteButtonActive();
};
```

`updateQuoteButtonActive` внутри `handleComposeChange` читает `input` из замыкания — на момент вызова стейт ещё не обновился (React batching), поэтому она должна читать позицию строки из `e.target.value` (нового значения), а не из `input`:

```ts
const updateQuoteButtonActive = (value: string = input, caret?: number) => {
  const el = inputRef.current;
  const pos = caret ?? el?.selectionStart ?? 0;
  const { start, end } = currentLineRange(value, pos);
  setCaretInQuoteLine(value.slice(start, end).startsWith(QUOTE_PREFIX));
};
```

При вызове из `handleComposeChange` — `updateQuoteButtonActive(e.target.value, e.target.selectionStart ?? undefined)`; при вызове из `onSelect`/`onClick`/`onKeyUp` — без аргументов (использует текущий `input` и `el.selectionStart`, которые к этому моменту синхронизированы).

Кнопка:

```tsx
<button
  type="button"
  className={`quote-toggle-btn${caretInQuoteLine ? ' active' : ''}`}
  aria-pressed={caretInQuoteLine}
  onClick={toggleQuotePrefix}
>
  {/* иконка и подпись «Цитата» — без изменений из V1 */}
</button>
```

Структура `<div className="chat-input"><div className="chat-input-toolbar">...</div><form>...</form></div>` — без изменений из V1.

### Edit: тот же подход

`editInputRef` → `RefObject<HTMLTextAreaElement>`, `<input className="message-edit-input">` → `<textarea className="message-edit-input">`. `handleEditKeyDown` получает ту же Enter/Shift+Enter логику, что и compose:

```ts
const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, messageId: string) => {
  if (editMention.handleKeyDown(e)) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    saveEdit(messageId);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
  }
};
```

Автовысота — отдельный `useEffect` на `editValue`, аналогичный compose-полю (тот же паттерн, другой ref/state).

Кнопка «Цитата» на редактирование **не** распространяется (в V1 её там не было, задача её туда не добавляла) — правки `"> "` при редактировании делаются вручную, набором текста, как и раньше.

CSS `.message-edit-input` — тот же принцип, что и `.chat-input textarea` (`resize: none`, авто-высота через JS, `max-height` + `overflow-y: auto`), точные значения по образцу существующего блока `.message-edit-input` в файле.

### Хук `useMentionAutocomplete`: обобщение типов

Меняются только generic-типы, поведение — нет:

```diff
- inputRef: RefObject<HTMLInputElement>;
+ inputRef: RefObject<HTMLTextAreaElement>;
  ...
- const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
+ const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
  ...
- const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
+ const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
```

`selectEntry`, `reset`, `entryKey`, вся логика вычисления `mentionQuery` по `@` и caret — без изменений.

## Edge cases

- Пустая цитата (строка `"> "` без текста после маркера) — как в V1, не блокируется отдельно.
- `">текст"` без пробела — не цитата (как в V1), правило не меняется, теперь просто применяется к каждой строке отдельно, а не к сообщению целиком.
- Три и более чередующихся блока (`"> a\nb\n> c"`) — даёт три группы (quote, plain, quote) с двумя отдельными левыми полосами; ожидаемо, не является багом.
- Пустая строка (`""`) между двумя цитатными блоками (`"> a\n\n> b"`) — пустая строка не начинается с `"> "`, поэтому это **три** группы (quote/plain/quote), а не одна — полосы визуально разрываются. Это соответствует построчному правилу и не требует спецобработки.
- `Shift+Enter` на последней строке при пустом `input` — просто добавляет `\n`, `input.trim()` в `handleSubmit` всё ещё не даст отправить чисто пробельное сообщение.
- Максимальная высота textarea (`max-height: 40vh`) на очень длинных сообщениях — внутренний скролл, сообщение целиком (`maxLength={2000}`) всё равно влезает в `content`, просто не видно целиком без скролла поля перед отправкой.

## Backend

Не затрагивается (как в V1). Ни миграций, ни изменений `domain.Message`, ни изменений API/WS-протокола. Уже подтверждено вручную в V1 (API возвращает `content` byte-for-byte, включая `"> "`).

## Тестирование

Автотестов нет — ручная проверка через `npm run dev:vite` (после `nvm use 22`, см. `client/README`/предыдущий опыт — системный Node 18 не тянет Vite 8):

1. Обычное однострочное сообщение — рендер не изменился.
2. `"> hello world"` (одна строка) — как в V1, левая полоса, без видимого `"> "`.
3. Многострочная цитата: Shift+Enter между строками, обе с `"> "` — рендерится как **один** блок с одной полосой на две строки.
4. Цитата + обычный текст: `"> quote\ntext"` — цитата с полосой, под ней — обычный текст без полосы, оба в одном сообщении.
5. Чередование `"> a\nb\n> c"` — две отдельные полосы (quote/plain/quote), без слипания.
6. Enter без Shift — отправляет сообщение (не переносит строку).
7. Shift+Enter — переносит строку, не отправляет.
8. Кнопка «Цитата»: курсор на пустой строке → клик → `"> "` в начале этой строки, курсор остаётся на ней; клик ещё раз на той же строке → префикс убирается.
9. Кнопка «Цитата»: multi-line ввод, курсор перемещается стрелками/кликом между процитированной и обычной строкой — подсветка кнопки включается/выключается вслед за курсором без дополнительных действий.
10. Авто-высота: печать нескольких строк подряд — поле растёт; после `max-height` — появляется внутренний скролл, форма не растёт бесконечно.
11. Упоминание внутри многострочной цитаты — `"> @username hello\nworld"` — `@username` подсвечен как обычно.
12. Редактирование многострочного сообщения — карандаш → textarea показывает реальные переносы строк (не `\n` как текст) → Shift+Enter/Enter работают так же, как в compose → после сохранения рендер остаётся корректным (группы цитат/текста).
13. Мобильная раскладка (`max-width: 768px`) — textarea, тулбар, автовысота не ломают layout.
