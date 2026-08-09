# Группировка сообщений по дате — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в ленту текстового канала визуальные разделители, группирующие сообщения по календарным дням, с метками «Сегодня», «Вчера» и полной датой «01 февраля 2026».

**Architecture:** Вариант А — точечное сравнение соседних сообщений внутри существующего `messages.map` в `ChatArea.tsx`. Дата-логика вынесена в чистые функции в `i18n/format.ts` (тестируются без React). `format.ts` остаётся самодостаточным (импортирует только `react`, `localeStore` и `locales/*`), чтобы не создавать цикл с `i18n/index.ts`.

**Tech Stack:** React 19, TypeScript, Zustand, самописная i18n (`ru.ts`/`en.ts`), vitest (environment: node), чистый CSS.

## Global Constraints

- Справочник форматов — `client/src/i18n/format.ts` (хук `useDateFormat` + чистые функции).
- Ключи добавляются в `client/src/i18n/locales/ru.ts` И `en.ts` (ru — источник типа `Dictionary`).
- Формат полной даты (ru): «01 февраля 2026» — день с ведущим нулём, склоняемый месяц в родительном падеже, год. Без «г.». Intl `month:'long'` даёт «1 февраля 2026 г.» — НЕ использовать.
- «Сегодня»/«Вчера» — по локальному дню сообщения относительно локального дня `new Date()` на момент рендера.
- Разделитель рендерится через `<Fragment>` в `messages.map`; `key` живёт на `Fragment` (импорт `Fragment` уже есть в `ChatArea.tsx:20`).
- Компакт-группировка НЕ склеивает разные дни.
- Стили — в `DayDivider.css` на CSS-переменных темы (`--bg-base`, `--border-subtle`, `--text-muted`).
- Команды: `npx vitest run`, `npm test`, `npm run check:i18n`, `npm run build:vite` (вкл. `tsc`).

---

### Task 1: Чистые функции даты `isSameCalendarDay` + `resolveDayLabel` + тесты

**Files:**
- Create: `client/src/utils/__tests__/format.test.ts`
- Modify: `client/src/i18n/format.ts`

**Interfaces:**
- Produces (из `format.ts`):
  - `export function isSameCalendarDay(a: Date, b: Date): boolean`
  - `export function resolveDayLabel(date: Date, now: Date, locale: string, t: (key: string) => string): string`
  - `export const RU_MONTHS_GENITIVE: string[]` (12, родительный падеж)
  - `export const EN_MONTHS: string[]` (12)

TDD: сначала тест (фейл), затем реализация (пас).

- [ ] **Step 1: Написать падающий тест**

Создать `client/src/utils/__tests__/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isSameCalendarDay, resolveDayLabel, RU_MONTHS_GENITIVE, EN_MONTHS } from '@/i18n/format';

const ruT = (key: string) => (key === 'chat.today' ? 'Сегодня' : 'Вчера');
const enT = (key: string) => (key === 'chat.today' ? 'Today' : 'Yesterday');

describe('isSameCalendarDay', () => {
  it('сравнивает по локальному календарному дню', () => {
    expect(isSameCalendarDay(new Date(2026, 1, 1, 0, 0, 0), new Date(2026, 1, 1, 23, 59, 59))).toBe(true);
    expect(isSameCalendarDay(new Date(2026, 1, 1), new Date(2026, 1, 2))).toBe(false);
  });
});

describe('resolveDayLabel', () => {
  const NOW = new Date(2026, 1, 5, 12, 0, 0); // 5 февраля 2026

  it('сегодня → «Сегодня»', () => {
    expect(resolveDayLabel(new Date(2026, 1, 5, 8, 30), NOW, 'ru', ruT)).toBe('Сегодня');
  });
  it('вчера → «Вчера»', () => {
    expect(resolveDayLabel(new Date(2026, 1, 4, 20, 0), NOW, 'ru', ruT)).toBe('Вчера');
  });
  it('ru: «01 февраля 2026» c ведущим нулём и склоняемым месяцем, без «г.»', () => {
    expect(resolveDayLabel(new Date(2026, 1, 1), NOW, 'ru', ruT)).toBe('01 февраля 2026');
  });
  it('ru: однозначный день с нулём «03 января 2026»', () => {
    expect(resolveDayLabel(new Date(2026, 0, 3), NOW, 'ru', ruT)).toBe('03 января 2026');
  });
  it('en: «February 1, 2026»', () => {
    expect(resolveDayLabel(new Date(2026, 1, 1), NOW, 'en', enT)).toBe('February 1, 2026');
  });
  it('en: Today / Yesterday', () => {
    expect(resolveDayLabel(new Date(2026, 1, 5), NOW, 'en', enT)).toBe('Today');
    expect(resolveDayLabel(new Date(2026, 1, 4), NOW, 'en', enT)).toBe('Yesterday');
  });
});

describe('month dictionaries', () => {
  it('RU_MONTHS_GENITIVE: 12 месяцев, февраль → «февраля»', () => {
    expect(RU_MONTHS_GENITIVE).toHaveLength(12);
    expect(RU_MONTHS_GENITIVE[1]).toBe('февраля');
  });
  it('EN_MONTHS: 12 названий, февраль → «February»', () => {
    expect(EN_MONTHS).toHaveLength(12);
    expect(EN_MONTHS[1]).toBe('February');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/utils/__tests__/format.test.ts`
Expected: FAIL — «Cannot find module» / функции не определены.

- [ ] **Step 3: Реализовать функции в `format.ts`**

В начало `client/src/i18n/format.ts` (перед `TIME_OPTS`) добавить:

```ts
export const RU_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function resolveDayLabel(
  date: Date,
  now: Date,
  locale: string,
  t: (key: string) => string,
): string {
  if (isSameCalendarDay(date, now)) return t('chat.today');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) return t('chat.yesterday');
  const day = String(date.getDate()).padStart(2, '0');
  if (locale === 'ru') {
    return `${day} ${RU_MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}`;
  }
  return `${EN_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
```

Примечание: логика «вчера» через `new Date(y, m, d - 1)` корректно обрабатывает переход через границу месяцев/лет (Date это нормализует). Точное время `now` не важно — используем конструктор, обнуляющий время.

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npx vitest run src/utils/__tests__/format.test.ts`
Expected: PASS (2 в isSameCalendarDay, 6 в resolveDayLabel, 2 в month dictionaries = 10).

- [ ] **Step 5: Проверить сборку**

Run: `npm run build:vite`
Expected: tsc + vite build без ошибок.

- [ ] **Step 6: Commit**

```bash
git add client/src/i18n/format.ts client/src/utils/__tests__/format.test.ts
git commit -m "feat(i18n): isSameCalendarDay/resolveDayLabel и тесты"
```

---

### Task 2: i18n-ключи «Сегодня»/«Вчера»

**Files:**
- Modify: `client/src/i18n/locales/ru.ts` (секция `chat`)
- Modify: `client/src/i18n/locales/en.ts` (секция `chat`)

**Interfaces:**
- Produces: ключи `chat.today`, `chat.yesterday` (тип `TKey` подхватит `Dictionary` автоматически).

- [ ] **Step 1: Добавить ключи в ru.ts**

После `edited: ' (изменено)',` (стр. 65) добавить:

```ts
    today: 'Сегодня',
    yesterday: 'Вчера',
```

- [ ] **Step 2: Добавить ключи в en.ts**

После `edited: ' (edited)',` (стр. 66) добавить:

```ts
    today: 'Today',
    yesterday: 'Yesterday',
```

- [ ] **Step 3: Проверить i18n**

Run: `npm run check:i18n`
Expected: «непереведённых строк не найдено».

- [ ] **Step 4: Commit**

```bash
git add client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat(i18n): ключи Сегодня/Вчера"
```

---

### Task 3: Метод `formatFullDate` в `useDateFormat`

**Files:**
- Modify: `client/src/i18n/format.ts`

**Interfaces:**
- Consumes: `isSameCalendarDay`/`resolveDayLabel` (Task 1), `useLocaleStore` (locale), словари `ru`/`en` (Task 2).
- Produces: метод `formatFullDate(date: Date): string` на объекте из `useDateFormat()`.

**N.B. про цикл. импорт:** `index.ts` ре-экспортирует `useDateFormat` из `format.ts` (стр. 9). Если `format.ts` начнёт импортировать `useT` из `index.ts` — получим цикл. Поэтому здесь НЕ импортируем `useT`; берём словари напрямую из `./locales/ru` и `./locales/en`.

- [ ] **Step 1: Добавить импорты словарей и реализовать форматтер**

В `client/src/i18n/format.ts`:

1. Добавить импорты вверху (после `useLocaleStore`):

```ts
import { ru } from './locales/ru';
import { en } from './locales/en';
import type { Dictionary } from './locales/ru';
```

2. Добавить карту словарей рядом с константами форматов:

```ts
const DICTS: Record<string, Dictionary> = { ru, en };
```

3. Вставить функцию-маппер в `resolveDayLabel`-вызов. Заменить блок `return useMemo(...)` в хуке:

Было:

```ts
  return useMemo(
    () => ({
      formatTime: (date: Date) => date.toLocaleTimeString(locale, TIME_OPTS),
      formatDayMonth: (date: Date) => date.toLocaleDateString(locale, DAY_MONTH_OPTS),
    }),
    [locale],
  );
```

Стало:

```ts
  return useMemo(
    () => ({
      formatTime: (date: Date) => date.toLocaleTimeString(locale, TIME_OPTS),
      formatDayMonth: (date: Date) => date.toLocaleDateString(locale, DAY_MONTH_OPTS),
      formatFullDate: (date: Date) => {
        const dict = DICTS[locale];
        const t = (key: string) =>
          key === 'chat.today' ? dict.chat.today : dict.chat.yesterday;
        return resolveDayLabel(date, new Date(), locale, t);
      },
    }),
    [locale],
  );
```

Примечание: `dict.chat.today`/`dict.chat.yesterday` имеют тип `string` (ключа `chat` полностью строковые, не plural) — это подходит под сигнатуру `(key)=>string`.

**Проверка типа:** `resolveDayLabel` импортирован в Task 1 как `export`. Он определён в том же файле, импорт не нужен.

- [ ] **Step 2: Собрать**

Run: `npm run build:vite`
Expected: без ошибок.

- [ ] **Step 3: Run test (убедиться, что чистая функция не сломалась)**

Run: `npx vitest run src/utils/__tests__/format.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/i18n/format.ts
git commit -m "feat(i18n): formatFullDate в useDateFormat"
```

---

### Task 4: Экспорт чистых функций из `i18n/index.ts`

**Files:**
- Modify: `client/src/i18n/index.ts` (строка 9)

**Interfaces:**
- Consumes: — (ре-экспорт уже существующих функций из `format.ts`).
- Produces: `isSameCalendarDay` доступен как `@/i18n` import.

- [ ] **Step 1: Расширить ре-экспорт**

Заменить строку 9:

```ts
export { useDateFormat } from './format';
```

на:

```ts
export { useDateFormat, isSameCalendarDay, resolveDayLabel } from './format';
```

- [ ] **Step 2: Собрать**

Run: `npm run build:vite`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add client/src/i18n/index.ts
git commit -m "refactor(i18n): экспорт isSameCalendarDay из format"
```

---

### Task 5: Компонент-разделитель `DayDivider` + стили

**Files:**
- Create: `client/src/components/DayDivider.tsx`
- Create: `client/src/components/DayDivider.css`

**Interfaces:**
- Produces: `export function DayDivider({ label }: { label: string })` — отрисовывает линию по бокам и текст по центру.

- [ ] **Step 1: Создать `DayDivider.tsx`**

```tsx
import './DayDivider.css';

interface DayDividerProps {
  label: string;
}

export function DayDivider({ label }: DayDividerProps) {
  return (
    <div className="date-divider" role="separator" aria-label={label}>
      <span className="date-divider__line" />
      <span className="date-divider__label">{label}</span>
      <span className="date-divider__line" />
    </div>
  );
}
```

- [ ] **Step 2: Создать `DayDivider.css`**

```css
.date-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 24px 0 6px;
}

.date-divider__line {
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

.date-divider__label {
  flex-shrink: 0;
  padding: 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.01em;
  background: var(--bg-base);
}
```

Фон `--bg-base` у `__label` перекрывает линию, благодаря чему линия «ныряет» за текст (эффект сквозной линии по бокам). `--bg-base` — фон `.chat-area` (см. `ChatArea.css:6`), совпадает.

- [ ] **Step 3: Проверить сборку**

Run: `npm run build:vite`
Expected: без ошибок. (`dayChanged` ещё не используется — `noUnusedLocals` сработает только в Task 6, когда внедрим в цикл. Проверка ниже в Task 6.)

- [ ] **Step 4: Commit**

```bash
git add client/src/components/DayDivider.tsx client/src/components/DayDivider.css
git commit -m "feat(chat): компонент-разделитель DayDivider"
```

---

### Task 6: Внедрить разделители в `ChatArea.tsx`

**Files:**
- Modify: `client/src/components/ChatArea.tsx`

**Interfaces:**
- Consumes: `DayDivider` (Task 5), `isSameCalendarDay` (Task 4), `useDateFormat().formatFullDate` (Task 3).

- [ ] **Step 1: Импорты**

1. Дополнить импорт из `@/i18n` (строка 19):

```tsx
import { useT, useDateFormat, isSameCalendarDay, type TFunc } from '@/i18n';
```

2. Добавить импорт `DayDivider` после `import { Avatar } from '@/components/Avatar';` (строка 17):

```tsx
import { DayDivider } from '@/components/DayDivider';
```

- [ ] **Step 2: Деструктуризация formatFullDate**

Строка 143:

```tsx
const { formatTime, formatFullDate } = useDateFormat();
```

- [ ] **Step 3: Вычислить dayChanged и обновить isCompact**

Заменить строки 670-674:

```tsx
  const prevMsg = messages[idx - 1];
  const isFromMe = msg.user_id === user?.id;
  const isCompact =
    prevMsg &&
    prevMsg.user_id === msg.user_id &&
    new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 420000;
```

на:

```tsx
  const prevMsg = messages[idx - 1];
  const msgDate = new Date(msg.created_at);
  const dayChanged =
    !prevMsg ||
    !isSameCalendarDay(msgDate, new Date(prevMsg.created_at));
  const isFromMe = msg.user_id === user?.id;
  const isCompact =
    !!prevMsg &&
    !dayChanged &&
    prevMsg.user_id === msg.user_id &&
    new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 420000;
```

- [ ] **Step 4: Отрисовка через Fragment**

Текущий `return (` (строка 689) и `<div key={msg.id}` (строка 691). Заменить так, чтобы:

- `<Fragment key={msg.id}>` стал корневым;
- `key={msg.id}` у внутреннего `<div>` убрать (иначе дубль ключа);
- перед `<div>` вставить разделитель.

Было:

```tsx
              return (
                <div
                  key={msg.id}
                  data-message-id={msg.id}
                  className={`message ${isCompact ? 'compact' : ''} ...
```

Стало:

```tsx
              return (
                <Fragment key={msg.id}>
                  {dayChanged && <DayDivider label={formatFullDate(msgDate)} />}
                  <div
                    data-message-id={msg.id}
                    className={`message ${isCompact ? 'compact' : ''} ...
```

И в конце, где закрывается `<div>` сообщения и `);` (строка ~790) — после `</div>` добавить `</Fragment>`:

```tsx
                    </div>
                  </div>
                  </Fragment>
                );
```

Точный закрывающий фрагмент нужно сверить с фактическим кодом (вложенность `.message-content` и `.message`). В результате JSX:

```tsx
return (
  <Fragment key={msg.id}>
    {dayChanged && <DayDivider label={formatFullDate(msgDate)} />}
    <div data-message-id={msg.id} className="...">
      ...существующее содержимое без внешнего key...
    </div>
  </Fragment>
);
```

`dayChanged && element` в JSX возвращает `false` при `dayChanged === false` — React не рендерит, ничего не сломает (в `__tests__`/lintе не ругается).

- [ ] **Step 5: Собрать и проверить**

Run: `npm run build:vite && npm run check:i18n`
Expected: без ошибок, tsc находит <Fragment> (импортирован на строке 20 — уже есть).

- [ ] **Step 6: Ручная проверка**

Run: `npm run dev:vite` (приложение в браузере) — в канале с сообщениями в разные дни.
Expected:
- перед первым сообщением ленты и перед каждой новой датой появляется разделитель;
- метки «Сегодня»/«Вчера» корректны;
- линия по бокам, текст по центру;
- компакт-группа не склеивает сообщения разных дней;
- история/jump-to-message показывает корректные разделители на загруженном диапазоне.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/ChatArea.tsx
git commit -m "feat(chat): разделители по дням в ленте сообщений"
```

---

## Self-Review

**Сверка со спекой:**
- Группы по дням (тр.1) — Task 6 (`isSameCalendarDay` в `dayChanged`).
- «Сегодня/Вчера/полная дата» (тр.2-3) — Task 1 (`resolveDayLabel`) + Task 2 (ключи) + Task 3 (`formatFullDate`).
- Линия по бокам (тр.4) — Task 5 (`DayDivider.css`).
- Компакт не склеивает дни (тр.5) — Task 6 (`!dayChanged` в `isCompact`).
- Разделитель в начале и в history (тр.6) — Task 6 (перед первым сообщением; пересчёт из массива при замене).
- Тестирование — Task 1 юнит (vitest) + Task 6 ручная проверка + build/check:i18n.

**No placeholders:** в каждом шаге — полный код и команды; финальная версия resolveDayLabel задана явно (без TBD).

**Type consistency:** `isSameCalendarDay(a,b): boolean`, `resolveDayLabel(date,now,locale,t)`, `formatFullDate(date): string`, `DayDivider({label:string})` согласованы между Tasks.

**Cycle-import risk:** Task 3 использует `ru/en` словари напрямую (не `useT` из `index.ts`), избегая цикла `format.ts`↔`index.ts`.