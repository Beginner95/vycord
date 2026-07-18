# Цитата по выделению текста

**Задача (VYC-36, продолжение):** система цитат уже реализована (см. `2026-07-18-quotes-design.md`, V1+V2) — маркер `"> "` построчно, toggle-кнопка в тулбаре применяется к строке под кареткой. Эта задача добавляет **предложение сделать цитату при выделении текста** — мышью или клавиатурой (Shift+стрелки), как в ленте чата (чужие/свои сообщения), так и внутри compose/edit textarea.

**Дата:** 2026-07-18
**Ветка:** `VYC-36-quotes`

## Предпосылки (актуальное состояние)

- Цитирование сейчас работает только через кнопку тулбара, которая оперирует **позицией каретки**, а не выделением: `currentLineRange(value, caret)` находит одну строку под кареткой, `selectionEnd` нигде не читается как отдельная граница диапазона.
- В ленте чата (`.chat-messages`, `ChatArea.tsx`) нет вообще никакой JS-обработки выделения текста — оно работает как нативное поведение браузера, `window.getSelection()`/`selectionchange` не используются.
- В проекте нет ни одного существующего паттерна «плавающий тултип по выделению» (grep по `getSelection|selectionchange|contextmenu|floating|popover` ничего не находит, кроме комментария `--bg-elevated /* Floating elements */` в `index.css`).
- `Selection`/`Range` API работает только для реального DOM (подходит для ленты чата), но не даёт `getBoundingClientRect()` для текста внутри `<textarea>` — там нет DOM-узлов на каждый символ.
- Автотестов на фронтенде нет (как и в предыдущих частях VYC-36) — верификация через `build:vite` + ручное QA.

## Принятые решения

| Вопрос | Решение |
|---|---|
| Выделение в ленте чата → что делает кнопка | Вставляет выделенный текст как цитату **в compose-поле** (reply-with-quote), не в поле редактирования, даже если в этот момент открыт edit другого сообщения. |
| Атрибуция автора | Нет. Только текст с `"> "` построчно, без `"Ответ @Username"` и подобного — не меняет модель данных (`content` остаётся plain string). |
| Место вставки в compose | В начало поля, сдвигая уже набранный черновик вниз (`quotedBlock + '\n' + existingInput`). Каретка встаёт сразу после цитаты. |
| Выделение внутри textarea (compose/edit) → что делает кнопка | Применяет тот же toggle, что и кнопка тулбара, но ко **всем строкам, попавшим в диапазон выделения** (не только к строке под кареткой). |
| Toggle-семантика диапазона | Если **все** строки диапазона уже квотированы → убрать `"> "` у всех; иначе → добавить `"> "` всем строкам диапазона, у которых его ещё нет. |
| UI предложения | Плавающая тултип-кнопка рядом с выделением (как в Medium/Twitter), а не горячая клавиша и не пункт контекстного меню. |
| Область охвата | Только desktop (мышь + клавиатура). Touch/mobile не реализуется в этой задаче — на touch-устройствах браузер показывает своё нативное меню при выделении, которое конфликтовало бы с кастомным тултипом. |
| Технический подход к позиционированию | Один общий хук `useFloatingSelectionToolbar` с подключаемой стратегией вычисления координат (см. ниже), а не глобальный document-listener и не два независимых хука с дублированной show/hide-логикой. |

## Frontend

### Новый хук `client/src/hooks/useFloatingSelectionToolbar.ts`

```ts
interface SelectionInfo {
  text: string;
  rect: DOMRect;
}

interface UseFloatingSelectionToolbarArgs {
  containerRef: RefObject<HTMLElement | null>;
  getSelectionInfo: () => SelectionInfo | null;
  onConfirm: (text: string) => void;
}

function useFloatingSelectionToolbar({
  containerRef,
  getSelectionInfo,
  onConfirm,
}: UseFloatingSelectionToolbarArgs) {
  const [state, setState] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      const info = getSelectionInfo();
      if (!info || info.text.trim().length === 0) {
        setState(null);
        return;
      }
      const x = clampToViewport(info.rect.right, window.innerWidth);
      setState({ x, y: info.rect.bottom, text: info.text });
    };

    const handleDismiss = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      setState(null);
    };

    container.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleDismiss, true);
    document.addEventListener('keydown', handleDismiss);
    container.addEventListener('scroll', handleDismiss);
    window.addEventListener('resize', handleDismiss);
    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleDismiss, true);
      document.removeEventListener('keydown', handleDismiss);
      container.removeEventListener('scroll', handleDismiss);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [containerRef, getSelectionInfo]);

  const confirm = () => {
    if (!state) return;
    onConfirm(state.text);
    setState(null);
  };

  return { visible: state !== null, x: state?.x ?? 0, y: state?.y ?? 0, confirm };
}
```

`handleDismiss` на `mousedown` использует capture-фазу (`true`), чтобы отработать раньше клика по самой кнопке — сама кнопка использует `onMouseDown` c `preventDefault()` (см. компонент ниже), поэтому `window.getSelection()`/`selectionStart-End` не сбрасываются до вызова `confirm()`.

### Компонент `<FloatingQuoteButton>` (в `ChatArea.tsx`)

```tsx
function FloatingQuoteButton({ x, y, onConfirm }: { x: number; y: number; onConfirm: () => void }) {
  return (
    <button
      type="button"
      className="floating-quote-btn"
      style={{ left: x, top: y }}
      onMouseDown={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      {/* иконка цитаты + подпись «Цитата», тот же визуальный язык, что у quote-toggle-btn */}
    </button>
  );
}
```

CSS: `position: fixed`, `z-index` выше `.message-actions`/`.mention-dropdown`, фон `var(--bg-elevated)`, `box-shadow: var(--shadow-md)`.

### Использование №1 — лента чата

```tsx
const chatMessagesRef = useRef<HTMLDivElement>(null);

const chatSelectionToolbar = useFloatingSelectionToolbar({
  containerRef: chatMessagesRef,
  getSelectionInfo: () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!chatMessagesRef.current?.contains(range.commonAncestorContainer)) return null;
    return { text: sel.toString(), rect: range.getBoundingClientRect() };
  },
  onConfirm: (text) => {
    insertQuoteIntoCompose(text);
    window.getSelection()?.removeAllRanges();
  },
});
```

`<div className="chat-messages" ref={chatMessagesRef}>` — добавляется `ref` к существующему контейнеру, разметка внутри не меняется.

`insertQuoteIntoCompose`:

```ts
const insertQuoteIntoCompose = (text: string) => {
  const el = inputRef.current;
  if (!el) return;
  const quotedBlock = text
    .split('\n')
    .map((line) => (line.startsWith(QUOTE_PREFIX) ? line : `${QUOTE_PREFIX}${line}`))
    .join('\n');
  const newValue = input.length === 0 ? quotedBlock : `${quotedBlock}\n${input}`;
  setInput(newValue);
  const caret = quotedBlock.length + 1;
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(caret, caret);
    updateQuoteButtonActive(newValue, caret);
  });
};
```

### Использование №2 и №3 — compose и edit textarea

Для textarea `Range.getBoundingClientRect()` недоступен — координаты берутся из `mouseup`-события напрямую:

```ts
const composeSelectionToolbar = useFloatingSelectionToolbar({
  containerRef: inputRef, // HTMLTextAreaElement тоже подходит как container
  getSelectionInfo: () => {
    const el = inputRef.current;
    if (!el || el.selectionStart === el.selectionEnd) return null;
    const text = el.value.slice(el.selectionStart!, el.selectionEnd!);
    const rect = lastMouseUpPoint.current; // {x, y} из отдельного onMouseUp на textarea, обновляется перед вызовом
    return rect ? { text, rect: rectFromPoint(rect) } : null;
  },
  onConfirm: () => {
    const el = inputRef.current;
    if (!el) return;
    toggleQuotePrefixRange(el.selectionStart!, el.selectionEnd!);
  },
});
```

Второй независимый вызов — для `editInputRef`/`editValue`, по тому же образцу (аналогично тому, как сейчас два независимых вызова `useMentionAutocomplete`).

`rectFromPoint({x, y})` — вспомогательная функция, возвращающая `DOMRect`-подобный объект с `right = x`, `bottom = y` (переиспользует общий интерфейс `SelectionInfo.rect`, не требуя реального `Range`).

### Генерализация toggle под диапазон строк

`toggleQuotePrefix` (caret-режим) переименовывается/оборачивается в `toggleQuotePrefixRange(start, end)`:

```ts
const toggleQuotePrefixRange = (start: number, end: number) => {
  const el = inputRef.current;
  if (!el) return;

  let lineStart = input.lastIndexOf('\n', start - 1) + 1;
  let lineEndIdx = input.indexOf('\n', Math.max(end - 1, lineStart));
  let lineEnd = lineEndIdx === -1 ? input.length : lineEndIdx;
  // не включать строку, если выделение заканчивается ровно на её начале (0 символов затронуто)
  if (end > start && end === lineStart && end !== start) {
    lineEnd = lineStart - 1 >= 0 ? input.lastIndexOf('\n', start - 1) : lineStart;
  }

  const block = input.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allQuoted = lines.every((l) => l.startsWith(QUOTE_PREFIX) || l.length === 0);
  const newLines = lines.map((l) => {
    if (allQuoted) return l.startsWith(QUOTE_PREFIX) ? l.slice(QUOTE_PREFIX.length) : l;
    return l.startsWith(QUOTE_PREFIX) ? l : `${QUOTE_PREFIX}${l}`;
  });
  const newBlock = newLines.join('\n');
  const newValue = input.slice(0, lineStart) + newBlock + input.slice(lineEnd);
  const delta = newBlock.length - block.length;

  setInput(newValue);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start, end + delta);
    updateQuoteButtonActive(newValue, end + delta);
  });
};

const toggleQuotePrefix = () => {
  const el = inputRef.current;
  const caret = el?.selectionStart ?? input.length;
  toggleQuotePrefixRange(caret, caret);
};
```

Кнопка тулбара «Цитата» вызывает `toggleQuotePrefix()` (без изменений снаружи), плавающая кнопка — `toggleQuotePrefixRange(selectionStart, selectionEnd)` напрямую. `updateQuoteButtonActive` (существующая функция, живёт как есть) продолжает пересчитывать `caretInQuoteLine` после любой из операций.

То же самое (`toggleQuotePrefixRange` + `updateQuoteButtonActive`) переиспользуется для edit-поля через `editValue`/`editInputRef`, аналогично текущей паре compose/edit.

## Edge cases

- **Выделение через несколько сообщений в ленте** — не блокируется; `window.getSelection().toString()` возвращает весь захваченный текст, включая переносы строк, которые браузер сам вставляет между блочными элементами.
- **Дедупликация префикса при цитировании из чата** — если в выделенном тексте уже есть строки с `"> "` (пользователь выделил уже процитированный фрагмент), повторный `"> "` не добавляется этим строкам.
- **Пустое/пробельное выделение** — тултип не показывается (`text.trim().length === 0`).
- **Граница диапазона в textarea** — если `selectionEnd` приходится ровно на начало новой строки без единого выделенного символа на ней (Shift+стрелка вниз останавливается в начале следующей строки) — эта строка не включается в toggle-диапазон.
- **Composer недоступен** (нет прав писать в канал, `inputRef.current` пуст) — `insertQuoteIntoCompose` ничего не делает (guard по ref).
- **Кнопка вылезает за край экрана** — `x`-координата клэмпится по ширине viewport в `useFloatingSelectionToolbar`.
- **Клик по самой кнопке не должен сбрасывать выделение раньше времени** — обеспечивается `onMouseDown` + `preventDefault()` на кнопке и capture-фазой `mousedown`-листенера скрытия.
- **Выделение в чате при открытом edit другого сообщения** — цитата всё равно уходит в compose, edit-поле не трогается.

## Backend

Не затрагивается. Формат `content` не меняется (по-прежнему plain string с `"> "`-префиксами построчно, как в V1/V2 quotes-дизайне).

## Тестирование

Автотестов на фронтенде нет — верификация через `npm run build:vite` (после `nvm use 22`) + ручное QA:

1. Выделить текст в одном чужом сообщении → рядом появляется кнопка «Цитата» → клик → текст вставлен цитатой в начало compose, существующий черновик сдвинут вниз, каретка сразу после цитаты.
2. Выделить текст, охватывающий 2-3 сообщения подряд → корректная построчная цитата всех строк.
3. Выделить кусок непроцитированной строки в compose (в уже напечатанном тексте) мышью → клик по плавающей кнопке → вся строка(и) становится цитатой, выделение сохраняется.
4. Выделить диапазон из смеси цитированных/нецитированных строк в compose → клик → все строки диапазона становятся цитатой.
5. Выделить полностью уже цитированный диапазон → клик → префикс снимается со всех строк диапазона.
6. Те же сценарии (3-5) в edit-textarea при редактировании своего сообщения.
7. Клик вне тултипа / `Escape` / скролл ленты или textarea → тултип скрывается без побочных эффектов и без потери фактического выделения браузера (для случая 8 ниже).
8. Кнопка тулбара «Цитата» (по caret) и подсветка `caretInQuoteLine` продолжают корректно работать и синхронизироваться после операций через плавающую кнопку.
9. Resize окна при открытом тултипе — тултип скрывается, ошибок в консоли нет.
10. Проверка в светлой и тёмной теме — контраст и позиционирование кнопки.
11. Selection API отсутствует/выделение схлопнулось между `mouseup` и кликом (например, пользователь начал печатать) — кнопка не должна вызывать `onConfirm` с устаревшим/пустым текстом.
