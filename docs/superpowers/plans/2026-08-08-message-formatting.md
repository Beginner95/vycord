# Форматирование текстового сообщения (B/I/U, ссылки, списки, цитата) — план реализации

> **Для агентных исполнителей:** ОБЯЗАТЕЛЬНЫЙ под-навык: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для реализации этого плана по задачам. Шаги используют чекбоксы (`- [ ]`) для отслеживания.

**Цель:** Расширить панель ввода сообщения кнопками B/I/U, ссылки, нумерованного и маркированного списка (и убрать слово «Цитата» из кнопки цитаты), с рендерингом сообщений в Markdown-разметке и открытием ссылок в системном браузере.

**Архитектура:** Сообщения остаются plain-text строкой с Markdown-маркерами (как Discord). Чистые функции парсинга/трансформации вынесены в `utils/markdown.ts` и `utils/textTransforms.ts` (юнит-тестируются через vitest), рендеринг в React — в `ChatArea.tsx`. Внешние ссылки открываются через `shell.openExternal` в Electron.

**Технологии:** React + TypeScript + Vite, vitest (добавляется), i18n, Electron main process.

## Global Constraints

- Типовой регистр: `noUnusedLocals`/`noUnusedParameters` строгие — никакого мёртвого кода. Каждая задача обязана компилироваться (`npx tsc --noEmit`) независимо.
- Никакого `dangerouslySetInnerHTML` — только React-элементы.
- Никаких сторонних Markdown-библиотек — только собственные парсеры.
- Ссылки: допустимые протоколы `http:`, `https:`, `mailto:`, `www.`; `javascript:` и прочие — рендерить как обычный текст.
- Значения ключей i18n добавлять в `ru.ts` и `en.ts` синхронно (скрипт `npm run check:i18n`).
- Редактирование сообщений использует тот же рендеринг и тот же набор кнопок, что и новое сообщение.
- Путь к модулям — алиас `@/` → `client/src/` (works в vitest через vite.config alias).

---

### Task 1: Добавить vitest и настроить запуск тестов

**Files:**
- Modify: `client/package.json`
- Modify: `client/vite.config.ts`

**Interfaces:**
- Consumes: —
- Produces: команда `npm test` (vitest run) из `client/`; vitest настраивается через `vite.config.ts`.

- [ ] **Step 1: Добавить vitest в devDependencies**

Run (из `client/`):
```bash
cd /www/my/vycord/client && npm install --save-dev vitest
```
Expected: vitest появляется в `package.json` devDependencies и `package-lock.json`.

- [ ] **Step 2: Добавить npm-скрипты тестов**

В `client/package.json` в блок `scripts` добавить:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Переключить vite.config.ts на vitest/config**

Заменить весь `client/vite.config.ts` на:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'node' },
});
```

- [ ] **Step 4: Прогнать тесты (должны пройти — пока их нет)**

Run:
```bash
cd /www/my/vycord/client && npm test
```
Expected: `No test files found` (или 0 тестов), код выхода 0.

- [ ] **Step 5: Проверить, что сборка не сломалась**

Run:
```bash
cd /www/my/vycord/client && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd /www/my/vycord && git add client/package.json client/package-lock.json client/vite.config.ts && git commit -m "test: добавить vitest и скрипт npm test"
```

---

### Task 2: Модуль `utils/markdown.ts` — inline-парсер и блоки

**Files:**
- Create: `client/src/utils/markdown.ts`
- Test: `client/src/utils/__tests__/markdown.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
```ts
export type MdInlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInlineNode[] }
  | { type: 'em'; children: MdInlineNode[] }
  | { type: 'u'; children: MdInlineNode[] }
  | { type: 'link'; label: MdInlineNode[]; url: string };

export type MessageBlock =
  | { kind: 'plain'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'ol'; items: string[] }
  | { kind: 'ul'; items: string[] };

export function isUnsafeUrl(url: string): boolean;   // true если протокол не из списка
export function normalizeLinkHref(url: string): string; // www. → https://www.
export function parseInline(text: string): MdInlineNode[];
export function blockify(content: string): MessageBlock[];
```

- [ ] **Step 1: Написать падающие тесты**

`client/src/utils/__tests__/markdown.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseInline, blockify, isUnsafeUrl, normalizeLinkHref } from '@/utils/markdown';

describe('parseInline', () => {
  it('жирный **b**', () => {
    expect(parseInline('**b**')).toEqual([{ type: 'strong', children: [{ type: 'text', text: 'b' }] }]);
  });
  it('курсив *i*', () => {
    expect(parseInline('*i*')).toEqual([{ type: 'em', children: [{ type: 'text', text: 'i' }] }]);
  });
  it('подчёркнутый __u__', () => {
    expect(parseInline('__u__')).toEqual([{ type: 'u', children: [{ type: 'text', text: 'u' }] }]);
  });
  it('ссылка [label](https://a.com)', () => {
    expect(parseInline('[s](https://a.com)')).toEqual([
      { type: 'link', label: [{ type: 'text', text: 's' }], url: 'https://a.com' },
    ]);
  });
  it('несмешанный текст и голый URL', () => {
    expect(parseInline('go https://ex.com now')).toEqual([
      { type: 'text', text: 'go ' },
      { type: 'link', label: [{ type: 'text', text: 'https://ex.com' }], url: 'https://ex.com' },
      { type: 'text', text: ' now' },
    ]);
  });
  it('небезопасная ссылка остаётся текстом', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ type: 'text', text: '[x](javascript:alert(1))' }]);
  });
  it('незакрытый маркер — обычный текст', () => {
    expect(parseInline('**open')).toEqual([{ type: 'text', text: '**open' }]);
  });
});

describe('blockify', () => {
  it('цитаты группируются', () => {
    expect(blockify('> a\n> b')).toEqual([{ kind: 'quote', text: 'a\nb' }]);
  });
  it('нумерованный список', () => {
    expect(blockify('1. a\n2. b')).toEqual([{ kind: 'ol', items: ['a', 'b'] }]);
  });
  it('маркированный список', () => {
    expect(blockify('- a\n- b')).toEqual([{ kind: 'ul', items: ['a', 'b'] }]);
  });
  it('смешанные блоки', () => {
    expect(blockify('plain\n- a')).toEqual([
      { kind: 'plain', text: 'plain' },
      { kind: 'ul', items: ['a'] },
    ]);
  });
});

describe('isUnsafeUrl / normalizeLinkHref', () => {
  it('unsafe', () => {
    expect(isUnsafeUrl('javascript:alert(1)')).toBe(true);
    expect(isUnsafeUrl('data:text/html,x')).toBe(true);
  });
  it('safe', () => {
    expect(isUnsafeUrl('https://a.com')).toBe(false);
    expect(isUnsafeUrl('http://a.com')).toBe(false);
    expect(isUnsafeUrl('mailto:a@b.c')).toBe(false);
  });
  it('normalize www', () => {
    expect(normalizeLinkHref('www.example.com')).toBe('https://www.example.com');
    expect(normalizeLinkHref('https://a.com')).toBe('https://a.com');
  });
});
```

- [ ] **Step 2: Прогнать тесты (должны упасть — модуля нет)**

Run:
```bash
cd /www/my/vycord/client && npm test
```
Expected: FAIL, `Cannot find module '@/utils/markdown'`.

- [ ] **Step 3: Реализовать `utils/markdown.ts`**

Создать `client/src/utils/markdown.ts`:
```ts
export type MdInlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInlineNode[] }
  | { type: 'em'; children: MdInlineNode[] }
  | { type: 'u'; children: MdInlineNode[] }
  | { type: 'link'; label: MdInlineNode[]; url: string };

export type MessageBlock =
  | { kind: 'plain'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'ol'; items: string[] }
  | { kind: 'ul'; items: string[] };

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/;
const QUOTE_PREFIX = '> ';

export function isUnsafeUrl(url: string): boolean {
  const t = url.trim().toLowerCase();
  return !(t.startsWith('http://') || t.startsWith('https://') || t.startsWith('mailto:') || t.startsWith('www.'));
}

export function normalizeLinkHref(url: string): string {
  const t = url.trim();
  return t.startsWith('www.') ? `https://${t}` : t;
}

export function parseInline(text: string): MdInlineNode[] {
  const nodes: MdInlineNode[] = [];
  let i = 0;
  const pushText = (s: string) => {
    if (!s) return;
    const last = nodes[nodes.length - 1];
    if (last && last.type === 'text') last.text += s;
    else nodes.push({ type: 'text', text: s });
  };

  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '**' || two === '__') {
      const close = text.indexOf(two, i + 2);
      if (close !== -1) {
        const child = parseInline(text.slice(i + 2, close));
        nodes.push(two === '**' ? { type: 'strong', children: child } : { type: 'u', children: child });
        i = close + 2;
        continue;
      }
      pushText(two);
      i += 2;
      continue;
    }
    const c = text[i];
    if (c === '*') {
      const close = text.indexOf('*', i + 1);
      if (close !== -1) {
        nodes.push({ type: 'em', children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
      pushText('*');
      i += 1;
      continue;
    }
    if (c === '[') {
      const m = LINK_RE.exec(text.slice(i));
      if (m && !isUnsafeUrl(m[2])) {
        nodes.push({ type: 'link', label: parseInline(m[1]), url: m[2].trim() });
        i += m[0].length;
        continue;
      }
    }
    const urlM = URL_RE.exec(text.slice(i));
    if (urlM && urlM.index === 0) {
      nodes.push({ type: 'link', label: [{ type: 'text', text: urlM[0] }], url: urlM[0] });
      i += urlM[0].length;
      continue;
    }
    pushText(c);
    i += 1;
  }
  return nodes;
}

export function blockify(content: string): MessageBlock[] {
  const lines = content.split('\n');
  const blocks: MessageBlock[] = [];
  for (const raw of lines) {
    if (raw.startsWith(QUOTE_PREFIX)) {
      const text = raw.slice(QUOTE_PREFIX.length);
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'quote') last.text += `\n${text}`;
      else blocks.push({ kind: 'quote', text });
      continue;
    }
    const num = /^(\d+)\.\s+(.*)$/.exec(raw);
    if (num) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'ol') last.items.push(num[2]);
      else blocks.push({ kind: 'ol', items: [num[2]] });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(raw);
    if (bullet && bullet[1].length > 0) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'ul') last.items.push(bullet[1]);
      else blocks.push({ kind: 'ul', items: [bullet[1]] });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'plain') last.text += `\n${raw}`;
    else blocks.push({ kind: 'plain', text: raw });
  }
  return blocks;
}
```

- [ ] **Step 4: Прогнать тесты (должны пройти)**

Run:
```bash
cd /www/my/vycord/client && npm test
```
Expected: PASS (все кейсы выше).

- [ ] **Step 5: Commit**

```bash
cd /www/my/vycord && git add client/src/utils/markdown.ts client/src/utils/__tests__/markdown.test.ts && git commit -m "feat: markdown inline-парсер и блокирование сообщений"
```

---

### Task 3: Модуль `utils/textTransforms.ts` — утилиты для кнопок

**Files:**
- Create: `client/src/utils/textTransforms.ts`
- Test: `client/src/utils/__tests__/textTransforms.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
```ts
export interface LineToggle { value: string; start: number; end: number; allPrefixed: boolean; }
export function toggleWrap(value: string, start: number, end: number, marker: string): LineToggle;
export function toggleQuote(value: string, start: number, end: number): LineToggle;
export function toggleBullet(value: string, start: number, end: number): LineToggle;
export function toggleNumbered(value: string, start: number, end: number): LineToggle;
```

- [ ] **Step 1: Написать падающие тесты**

`client/src/utils/__tests__/textTransforms.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { toggleWrap, toggleQuote, toggleBullet, toggleNumbered } from '@/utils/textTransforms';

describe('toggleWrap', () => {
  it('оборачивает выделение', () => {
    expect(toggleWrap('abc', 1, 2, '**')).toEqual({ value: 'a**b**c', start: 3, end: 4, allPrefixed: false });
  });
  it('сворачивает, если маркеры в выделении', () => {
    expect(toggleWrap('a**b**c', 1, 6, '**')).toEqual({ value: 'abc', start: 1, end: 2, allPrefixed: false });
  });
  it('коллапсированная позиция — пустая пара маркеров', () => {
    expect(toggleWrap('abc', 1, 1, '**')).toEqual({ value: 'a****bc', start: 3, end: 3, allPrefixed: false });
  });
});

describe('toggleQuote', () => {
  it('добавляет > к выбранной строке (выделение смещается на внутренний текст)', () => {
    expect(toggleQuote('a\nb', 0, 1)).toEqual({ value: '> a\nb', start: 2, end: 3, allPrefixed: false });
  });
  it('убирает > , если строка уже процитирована', () => {
    expect(toggleQuote('> a', 0, 3)).toEqual({ value: 'a', start: 0, end: 0, allPrefixed: true });
  });
});

describe('toggleBullet', () => {
  it('добавляет "- " (выделение смещается на внутренний текст)', () => {
    expect(toggleBullet('a\nb', 0, 1)).toEqual({ value: '- a\nb', start: 2, end: 3, allPrefixed: false });
  });
});

describe('toggleNumbered', () => {
  it('добавляет "1. " (выделение смещается на внутренний текст)', () => {
    expect(toggleNumbered('a\nb', 0, 1)).toEqual({ value: '1. a\nb', start: 3, end: 4, allPrefixed: false });
  });
  it('убирает номера со всех выбранных строк', () => {
    expect(toggleNumbered('1. a\n2. b', 0, 9)).toEqual({ value: 'a\nb', start: 0, end: 3, allPrefixed: true });
  });
});
```

- [ ] **Step 2: Прогнать тесты (должны упасть)**

Run:
```bash
cd /www/my/vycord/client && npm test
```
Expected: FAIL, `Cannot find module '@/utils/textTransforms'`.

- [ ] **Step 3: Реализовать `utils/textTransforms.ts`**

Создать `client/src/utils/textTransforms.ts`:
```ts
export interface LineToggle {
  value: string;
  start: number;
  end: number;
  allPrefixed: boolean;
}

function lineStartIndex(value: string, pos: number): number {
  return pos <= 0 ? 0 : value.lastIndexOf('\n', pos - 1) + 1;
}

function lineEndIndex(value: string, from: number, start: number): number {
  const idx = value.indexOf('\n', Math.max(from, start));
  return idx === -1 ? value.length : idx;
}

function toggleLines(
  value: string,
  start: number,
  end: number,
  isPrefixed: (line: string) => boolean,
  removePrefix: (line: string) => string,
  addPrefix: (line: string) => string,
): LineToggle {
  const startIdx = lineStartIndex(value, start);
  const selEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const endIdx = lineEndIndex(value, selEnd, startIdx);
  const block = value.slice(startIdx, endIdx);
  const lines = block.split('\n');
  const allPrefixed = lines.every(isPrefixed);
  const finalLines = lines.map((line) =>
    allPrefixed ? removePrefix(line) : isPrefixed(line) ? line : addPrefix(line),
  );
  const newValue = value.slice(0, startIdx) + finalLines.join('\n') + value.slice(endIdx);
  const shiftFor = (pos: number) => {
    const li = (value.slice(startIdx, pos).match(/\n/g) ?? []).length;
    let shift = 0;
    for (let i = 0; i <= li && i < lines.length; i++) shift += finalLines[i].length - lines[i].length;
    return shift;
  };
  const s = start + shiftFor(start);
  const e = end + shiftFor(end);
  return {
    value: newValue,
    start: Math.max(0, Math.min(s, newValue.length)),
    end: Math.max(0, Math.min(e, newValue.length)),
    allPrefixed,
  };
}

export function toggleWrap(value: string, start: number, end: number, marker: string): LineToggle {
  const sel = value.slice(start, end);
  if (sel.length >= marker.length * 2 && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(marker.length, sel.length - marker.length);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length, allPrefixed: false };
  }
  const wrapped = marker + sel + marker;
  const s = start + marker.length;
  return {
    value: value.slice(0, start) + wrapped + value.slice(end),
    start: s,
    end: s + sel.length,
    allPrefixed: false,
  };
}

export const toggleQuote = (value: string, start: number, end: number) =>
  toggleLines(value, start, end, (l) => l.startsWith('> '), (l) => l.slice(2), (l) => `> ${l}`);

export const toggleBullet = (value: string, start: number, end: number) =>
  toggleLines(value, start, end, (l) => l.startsWith('- '), (l) => l.slice(2), (l) => `- ${l}`);

export const toggleNumbered = (value: string, start: number, end: number) =>
  toggleLines(
    value,
    start,
    end,
    (l) => /^\d+\.\s/.test(l),
    (l) => l.replace(/^\d+\.\s/, ''),
    (l) => `1. ${l}`,
  );
```

- [ ] **Step 4: Прогнать тесты (должны пройти)**

Run:
```bash
cd /www/my/vycord/client && npm test
```
Expected: PASS.

- [ ] **Step 5: Проверить сборку**

Run:
```bash
cd /www/my/vycord/client && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd /www/my/vycord && git add client/src/utils/textTransforms.ts client/src/utils/__tests__/textTransforms.test.ts && git commit -m "feat: утилиты переключения markdown-разметки (wrap/quote/list)"
```

---

### Task 4: Рендеринг markdown в `ChatArea` (замена `renderMessageBody`)

**Files:**
- Modify: `client/src/components/ChatArea.tsx` (функции `renderMessageContent`/`renderMessageBody`, строки 73–124; `<p className="message-text">` на строке 668)

**Interfaces:**
- Consumes: `parseInline`, `blockify`, `normalizeLinkHref`, тип `MdInlineNode` из `@/utils/markdown` (Task 2).
- Produces: `renderMessageBody(content, members, t, currentUserId)` рендерит `<strong>/<em>/<u>/<a>/<ol>/<ul>/<span.message-quote>`; сигнатура не меняется.

- [ ] **Step 1: Добавить импорты**

В начало `client/src/components/ChatArea.tsx` (после строки 15, `import { useT, useDateFormat, type TFunc } from '@/i18n';`) добавить:
```ts
import { Fragment, type ReactNode } from 'react';
import { parseInline, blockify, normalizeLinkHref, type MdInlineNode } from '@/utils/markdown';
```

- [ ] **Step 2: Заменить функции рендеринга**

Заменить определение `renderMessageBody` (строки 102–124) на новое, добавив помощник `renderInlineNodes`. Функция `renderMessageContent` (строки 73–100) не меняется — используется для текстовых листьев:

```tsx
function renderInlineNodes(nodes: MdInlineNode[], members: MemberWithUser[], t: TFunc, currentUserId?: string): ReactNode {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={i}>{renderMessageContent(n.text, members, t, currentUserId)}</Fragment>;
      case 'strong':
        return <strong key={i}>{renderInlineNodes(n.children, members, t, currentUserId)}</strong>;
      case 'em':
        return <em key={i}>{renderInlineNodes(n.children, members, t, currentUserId)}</em>;
      case 'u':
        return <u key={i}>{renderInlineNodes(n.children, members, t, currentUserId)}</u>;
      case 'link':
        return (
          <a key={i} href={normalizeLinkHref(n.url)} target="_blank" rel="noopener noreferrer">
            {renderInlineNodes(n.label, members, t, currentUserId)}
          </a>
        );
    }
  });
}

function renderMessageBody(content: string, members: MemberWithUser[], t: TFunc, currentUserId?: string) {
  return blockify(content).map((b, i) => {
    switch (b.kind) {
      case 'plain':
        return <span key={i}>{renderInlineNodes(parseInline(b.text), members, t, currentUserId)}</span>;
      case 'quote':
        return <span key={i} className="message-quote">{renderInlineNodes(parseInline(b.text), members, t, currentUserId)}</span>;
      case 'ol':
        return (
          <ol key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{renderInlineNodes(parseInline(it), members, t, currentUserId)}</li>
            ))}
          </ol>
        );
      case 'ul':
        return (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{renderInlineNodes(parseInline(it), members, t, currentUserId)}</li>
            ))}
          </ul>
        );
    }
  });
}
```

- [ ] **Step 3: Заменить `<p className="message-text">` на `<div>`**

Строка 668: `<p className="message-text">{renderMessageBody(...)}</p>` → `<div className="message-text">{renderMessageBody(...)}</div>`
(списки `<ul>/<ol>` недопустимы внутри `<p>`; `renderRich` остаётся единственным дочерним элементом).

- [ ] **Step 4: Проверить сборку**

Run:
```bash
cd /www/my/vycord/client && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 5: Ручная проверка**

Запустить dev (`cd /www/my/vycord/client && npm run dev`), отправить сообщение `**ж** *и* __п__ [ссылка](https://example.com)`, проверить рендер `<strong>/<em>/<u>/<a>` и что `javascript:`-ссылка рендерится текстом.

- [ ] **Step 6: Commit**

```bash
cd /www/my/vycord && git add client/src/components/ChatArea.tsx && git commit -m "feat: рендеринг markdown (B/I/U/ссылки/списки) в сообщениях"
```

---

### Task 5: i18n ключи панели ввода

**Files:**
- Modify: `client/src/i18n/locales/ru.ts`
- Modify: `client/src/i18n/locales/en.ts`

**Interfaces:**
- Consumes: —
- Produces: строки `chat.bold`, `chat.italic`, `chat.underline`, `chat.link`, `chat.numberedList`, `chat.bulletedList`, `chat.linkText`, `chat.linkUrl`, `chat.linkUrlInvalid`, `chat.insert`, `chat.cancel` (в `ru.ts` и `en.ts`). `chat.quote` остаётся (используется в `aria-label`).

- [ ] **Step 1: Добавить ключи в `ru.ts`**

Внутри `chat: {` (после строки 46 `quote: 'Цитата',`) добавить:
```ts
    bold: 'Жирный',
    italic: 'Курсив',
    underline: 'Подчёркнутый',
    link: 'Вставить ссылку',
    numberedList: 'Нумерованный список',
    bulletedList: 'Маркированный список',
    linkText: 'Текст ссылки',
    linkUrl: 'URL',
    linkUrlInvalid: 'Введите корректную ссылку (http/https/www/mailto)',
    insert: 'Вставить',
    cancel: 'Отмена',
```

- [ ] **Step 2: Добавить ключи в `en.ts`**

Аналогично после `quote:`:
```ts
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    link: 'Insert link',
    numberedList: 'Numbered list',
    bulletedList: 'Bulleted list',
    linkText: 'Link text',
    linkUrl: 'URL',
    linkUrlInvalid: 'Enter a valid link (http/https/www/mailto)',
    insert: 'Insert',
    cancel: 'Cancel',
```

- [ ] **Step 3: Проверить согласованность**

Run:
```bash
cd /www/my/vycord/client && npm run check:i18n
```
Expected: PASS. Если скрипт ругается только на неиспользуемые ключи — это ок, ключи подхватятся в Task 6/7.

- [ ] **Step 4: Commit**

```bash
cd /www/my/vycord && git add client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts && git commit -m "feat(i18n): ключи панели форматирования сообщений"
```

---

### Task 6: Компонент `LinkDialog`

**Files:**
- Create: `client/src/components/LinkDialog.tsx`
- Create: `client/src/components/LinkDialog.css`

**Interfaces:**
- Consumes: `isUnsafeUrl` из `@/utils/markdown` (Task 2), `useT`, ключи `chat.linkText`/`chat.linkUrl`/`chat.linkUrlInvalid`/`chat.cancel`/`chat.insert` (Task 5).
- Produces:
```tsx
export function LinkDialog(props: { open: boolean; onClose: () => void; onInsert: (label: string, url: string) => void }): JSX.Element | null;
```

- [ ] **Step 1: Создать `LinkDialog.tsx`**

`client/src/components/LinkDialog.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { useT } from '@/i18n';
import { isUnsafeUrl } from '@/utils/markdown';
import './LinkDialog.css';

interface LinkDialogProps {
  open: boolean;
  onClose: () => void;
  onInsert: (label: string, url: string) => void;
}

export function LinkDialog({ open, onClose, onInsert }: LinkDialogProps) {
  const t = useT();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (open) { setLabel(''); setUrl(''); setError(false); }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const u = url.trim();
    if (!u || isUnsafeUrl(u)) { setError(true); return; }
    onInsert(label.trim(), u);
    onClose();
  };

  return (
    <div className="link-dialog-backdrop" onMouseDown={onClose}>
      <div className="link-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <label className="link-dialog-field">
          <span>{t('chat.linkText')}</span>
          <input value={label} onChange={(e) => { setLabel(e.target.value); setError(false); }} autoFocus />
        </label>
        <label className="link-dialog-field">
          <span>{t('chat.linkUrl')}</span>
          <input
            className={error ? 'error' : ''}
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(false); }}
            placeholder="https://"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
          />
        </label>
        {error && <div className="link-dialog-error">{t('chat.linkUrlInvalid')}</div>}
        <div className="link-dialog-actions">
          <button type="button" className="link-dialog-cancel" onClick={onClose}>{t('chat.cancel')}</button>
          <button type="button" className="link-dialog-submit" onClick={submit}>{t('chat.insert')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Создать `LinkDialog.css`**

`client/src/components/LinkDialog.css`. Сначала проверить, какие CSS-переменные существуют: `grep -n -- "--danger\|--shadow-lg\|--bg-elevated\|--bg-secondary\|--brand-color" client/src/index.css`. Использовать существующие. Пример:
```css
.link-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 24px;
}

.link-dialog {
  width: 100%;
  max-width: 420px;
  background: var(--bg-elevated, #2b2d31);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.link-dialog-field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--text-muted); }
.link-dialog-field input {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
}
.link-dialog-field input.error { border-color: var(--danger-color, #f23f42); }
.link-dialog-error { color: var(--danger-color, #f23f42); font-size: 12px; }
.link-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.link-dialog-cancel, .link-dialog-submit {
  padding: 7px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background: var(--bg-secondary, #383a40);
  color: var(--text-primary);
}
.link-dialog-submit { background: var(--brand-color); border-color: var(--brand-color); color: #fff; }
```

- [ ] **Step 3: Проверить сборку**

Run:
```bash
cd /www/my/vycord/client && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /www/my/vycord && git add client/src/components/LinkDialog.tsx client/src/components/LinkDialog.css && git commit -m "feat: диалог вставки ссылки (текст + URL)"
```

---

### Task 7: Панель инструментов B/I/U/списки/цитата, ссылка и вставка из буфера в `ChatArea`

**Files:**
- Modify: `client/src/components/ChatArea.tsx`
- Modify: `client/src/components/ChatArea.css`

**Interfaces:**
- Consumes: `toggleQuote`, `toggleBullet`, `toggleNumbered`, `toggleWrap` из `@/utils/textTransforms` (Task 3); `isUnsafeUrl` из `@/utils/markdown` (Task 2); `LinkDialog` (Task 6); ключи i18n (Task 5).
- Produces: панель `.chat-input-toolbar` с кнопками; генерализованные `applyRangeToggle`/`wrapSelection`; диалог и paste-вставка работают и в compose, и в edit.

- [ ] **Step 1: Импорты**

В `client/src/components/ChatArea.tsx`:
- В реакт-импорт добавить тип `ClipboardEvent`:
```ts
import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent, type ChangeEvent, type ClipboardEvent } from 'react';
```
- Добавить `type RefObject`:
```ts
import type { RefObject } from 'react';
```
- Добавить:
```ts
import { LinkDialog } from '@/components/LinkDialog';
import { toggleQuote, toggleBullet, toggleNumbered, toggleWrap, type LineToggle } from '@/utils/textTransforms';
import { isUnsafeUrl } from '@/utils/markdown';
```

- [ ] **Step 2: Общие помощники**

Возле `toggleQuotePrefixRange` (строка ~353) добавить:
```tsx
const applyRangeToggle = (
  value: string,
  setValue: (v: string) => void,
  ref: RefObject<HTMLTextAreaElement | null>,
  fn: (v: string, s: number, e: number) => LineToggle,
) => {
  const el = ref.current;
  if (!el) return;
  const s = el.selectionStart ?? value.length;
  const e = el.selectionEnd ?? value.length;
  const r = fn(value, s, e);
  setValue(r.value);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(r.start, r.end);
  });
};

const wrapSelection = (
  value: string,
  setValue: (v: string) => void,
  ref: RefObject<HTMLTextAreaElement | null>,
  marker: string,
) => {
  const el = ref.current;
  if (!el) return;
  const s = el.selectionStart ?? value.length;
  const e = el.selectionEnd ?? value.length;
  const r = toggleWrap(value, s, e, marker);
  setValue(r.value);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(r.start, r.end);
  });
};
```

- [ ] **Step 3: Переписать quote-обработчик через `toggleQuote`**

Заменить тело `toggleQuotePrefixRange` (строки 353–364):
```tsx
const toggleQuotePrefixRange = (start: number, end: number) => {
  const el = inputRef.current;
  const r = toggleQuote(input, start, end);
  setInput(r.value);
  setCaretInQuoteLine(!r.allPrefixed);
  requestAnimationFrame(() => {
    el?.focus();
    el?.setSelectionRange(r.start, r.end);
  });
};
```
Обработчик `toggleEditQuotePrefixRange` заменить аналогично (используя `editValue`/`setEditValue`/`editInputRef`):
```tsx
const toggleEditQuotePrefixRange = (start: number, end: number) => {
  const el = editInputRef.current;
  const r = toggleQuote(editValue, start, end);
  setEditValue(r.value);
  requestAnimationFrame(() => {
    el?.focus();
    el?.setSelectionRange(r.start, r.end);
  });
};
```

- [ ] **Step 4: Добавить compose/edit-обработчики**

После `toggleQuotePrefix` (строка ~371) добавить:
```tsx
const composeWrap = (marker: string) => wrapSelection(input, setInput, inputRef, marker);
const composeBullet = () => applyRangeToggle(input, setInput, inputRef, toggleBullet);
const composeNumbered = () => applyRangeToggle(input, setInput, inputRef, toggleNumbered);

const editWrap = (marker: string) => wrapSelection(editValue, setEditValue, editInputRef, marker);
const editBullet = () => applyRangeToggle(editValue, setEditValue, editInputRef, toggleBullet);
const editNumbered = () => applyRangeToggle(editValue, setEditValue, editInputRef, toggleNumbered);

const [linkTarget, setLinkTarget] = useState<'compose' | 'edit' | null>(null);
const openLinkFor = (target: 'compose' | 'edit') => setLinkTarget(target);

const insertLink = (label: string, url: string) => {
  const isEdit = linkTarget === 'edit';
  const value = isEdit ? editValue : input;
  const ref = isEdit ? editInputRef : inputRef;
  const setValue = isEdit ? setEditValue : setInput;
  const el = ref.current;
  if (!el) return;
  const text = label || url;
  const token = `[${text}](${url})`;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  setValue(next);
  setLinkTarget(null);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  });
};

const handleComposePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
  const el = e.currentTarget;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  const sel = el.value.slice(start, end);
  if (start !== end && sel.trim() && text.trim() && !isUnsafeUrl(text.trim())) {
    e.preventDefault();
    const token = `[${sel.trim()}](${text.trim()})`;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setInput(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }
  setCaretInQuoteLine(false);
};
```

- [ ] **Step 5: Панель compose — заменить блок панели (строки 709–719)**

Заменить на:
```tsx
<div className="chat-input-toolbar">
  <button
    type="button"
    className={`toolbar-btn${caretInQuoteLine ? ' active' : ''}`}
    aria-pressed={caretInQuoteLine}
    aria-label={t('chat.quote')}
    title={t('chat.quote')}
    onClick={toggleQuotePrefix}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
  </button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.bold')} title={t('chat.bold')} onClick={() => composeWrap('**')}>
    <strong className="toolbar-txt">B</strong>
  </button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.italic')} title={t('chat.italic')} onClick={() => composeWrap('*')}>
    <em className="toolbar-txt">I</em>
  </button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.underline')} title={t('chat.underline')} onClick={() => composeWrap('__')}>
    <u className="toolbar-txt">U</u>
  </button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.link')} title={t('chat.link')} onClick={() => openLinkFor('compose')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
  </button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.numberedList')} title={t('chat.numberedList')} onClick={composeNumbered}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h12"/><path d="M4 12h12"/><path d="M4 18h12"/><path d="M15 7.5l2.5-2.5 1.5 1.5L17.5 9z"/><path d="M15 14l2.5-2.5 1.5 1.5L17.5 15.5z"/><path d="M15 20.5l2.5-2.5 1.5 1.5L17.5 22z"/></svg>
  </button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.bulletedList')} title={t('chat.bulletedList')} onClick={composeBullet}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>
  </button>
</div>
```
На `<textarea>` compose (строка ~721) добавить атрибут `onPaste={handleComposePaste}`.

- [ ] **Step 6: Панель edit**

Внутри `message-edit-wrapper` (после `<textarea>` редактирования, ~строка 649) добавить мини-панель (`onChange` редактирования обновит `editValue`; без подсветки цитаты):
```tsx
<div className="chat-input-toolbar">
  <button type="button" className="toolbar-btn" aria-label={t('chat.bold')} title={t('chat.bold')} onClick={() => editWrap('**')}><strong className="toolbar-txt">B</strong></button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.italic')} title={t('chat.italic')} onClick={() => editWrap('*')}><em className="toolbar-txt">I</em></button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.underline')} title={t('chat.underline')} onClick={() => editWrap('__')}><u className="toolbar-txt">U</u></button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.link')} title={t('chat.link')} onClick={() => openLinkFor('edit')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
  </button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.numberedList')} title={t('chat.numberedList')} onClick={editNumbered}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h12"/><path d="M4 12h12"/><path d="M4 18h12"/><path d="M15 7.5l2.5-2.5 1.5 1.5L17.5 9z"/><path d="M15 14l2.5-2.5 1.5 1.5L17.5 15.5z"/><path d="M15 20.5l2.5-2.5 1.5 1.5L17.5 22z"/></svg>
  </button>
  <button type="button" className="toolbar-btn" aria-label={t('chat.bulletedList')} title={t('chat.bulletedList')} onClick={editBullet}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>
  </button>
</div>
```

- [ ] **Step 7: Рендер диалога**

Перед закрывающим `</main>` (после блоков `FloatingQuoteButton`, ~строка 772) добавить:
```tsx
<LinkDialog
  open={linkTarget !== null}
  onClose={() => setLinkTarget(null)}
  onInsert={insertLink}
/>
```

- [ ] **Step 8: CSS для `.toolbar-btn`**

В `client/src/components/ChatArea.css` заменить существующий блок `.chat-input-toolbar` (строки 301–304) и `.quote-toggle-btn`* (строки 306–330) на:
```css
.chat-input-toolbar {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition);
}

.toolbar-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.toolbar-btn.active { background: var(--brand-50); border-color: var(--brand-color); color: var(--brand-600); }

.toolbar-txt { font-size: 14px; font-weight: 600; line-height: 1; }
.toolbar-txt em { font-style: italic; }
.toolbar-txt u { text-decoration: underline; }
```

- [ ] **Step 9: Проверка сборки**

Run:
```bash
cd /www/my/vycord/client && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 10: Ручной тест**

- Кнопки B/I/U/списки работают в compose и edit; повторное нажатие снимает разметку.
- Слово «Цитата» исчезло, осталась иконка.
- Кнопка ссылки открывает диалог; пустой URL блокирует с ошибкой; `[текст](url)` вставляется.
- Выделение текста + Ctrl+V с URL в буфере → выделение становится `[текст](url)`.

- [ ] **Step 11: Commit**

```bash
cd /www/my/vycord && git add client/src/components/ChatArea.tsx client/src/components/ChatArea.css && git commit -m "feat: панель форматирования B/I/U, ссылка, списки + вставка URL в выделение (compose+edit)"
```

---

### Task 8: Открытие внешних ссылок в системном браузере (Electron)

**Files:**
- Modify: `client/electron/main.ts`

**Interfaces:**
- Consumes: —
- Produces: обработчики `setWindowOpenHandler` и `will-navigate`, открывающие внешние ссылки через `shell.openExternal`.

- [ ] **Step 1: Добавить импорт `shell`**

В строке 1 `client/electron/main.ts` добавить `shell` в импорт из `electron`.

- [ ] **Step 2: Добавить хелпер и обработчики в `createWindow`**

Внутри `createWindow()` после `mainWindow.loadURL(...)`/`loadFile(...)` и перед `mainWindow.on('closed', ...)` добавить:
```ts
  const openExternal = (url: string) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow!.webContents.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });
```

- [ ] **Step 3: Собрать electron-main и проверить тип**

Run:
```bash
cd /www/my/vycord/client && npm run build:electron-main
```
Expected: exit 0.

- [ ] **Step 4: Ручная проверка**

Запустить приложение (`cd /www/my/vycord/client && npm run dev:electron`), отправить сообщение со ссылкой, кликнуть по ней → открывается системный браузер, окно приложения не уводит от SPA. Ссылка `[x](javascript:...)` рендерится текстом.

- [ ] **Step 5: Commit**

```bash
cd /www/my/vycord && git add client/electron/main.ts && git commit -m "feat(electron): открытие внешних ссылок в системном браузере"
```

---

### Task 9: Финальная проверка

**Files:**
- —

- [ ] **Step 1: Прогнать все юнит-тесты**

Run:
```bash
cd /www/my/vycord/client && npm test
```
Expected: PASS.

- [ ] **Step 2: Проверить i18n**

Run:
```bash
cd /www/my/vycord/client && npm run check:i18n
```
Expected: PASS.

- [ ] **Step 3: Полная сборка клиента**

Run:
```bash
cd /www/my/vycord/client && npm run build:vite && npm run build:electron-main
```
Expected: exit 0.

- [ ] **Step 4: Ручной смоук-тест**

- Отправить сообщение с `**b** *i* __u__`, списками `1. a` / `- b`, ссылкой `[текст](https://example.com)`, голым URL `https://example.com` — всё рендерится корректно.
- Цитата показывается иконкой без слова.
- Кнопки B/I/U/списки/ссылка оборачивают выделение, повторное нажатие снимает, работают при редактировании.
- Ctrl+V c URL в буфере на непустом выделении превращает его в ссылку.
- В Electron клик по ссылке открывает системный браузер.
- `[x](javascript:alert(1))` не является кликабельной ссылкой.

- [ ] **Step 5: Commit (если остались незакоммиченные правки)**

```bash
cd /www/my/vycord && git add -A && git commit -m "chore: финальная проверка форматирования сообщений" || echo "нет изменений"
```

---

## Self-Review

- **Спец-покрытие:** B/I/U/ссылка/нум. список/марк. список — Task 7; убрать слово «Цитата» — Task 7 (кнопка только иконкой); диалог текст+url — Task 6/7; `[url](url)` при пустом label — Task 7 (`label || url`); выделение+Ctrl+V URL → ссылка — Task 7; клик по ссылке в браузере/Electron — Task 8; авто-ссылка голых URL — Task 2/4; редактирование — Task 4/7; безопасность `javascript:` — Task 2/4/7/8.
- **Плейсхолдеры:** отсутствуют; все шаги содержат конкретный код и команды.
- **Согласованность типов:** `LineToggle`/`toggleWrap`/`toggleQuote`/`toggleBullet`/`toggleNumbered` заданы в Task 3 и использованы в Task 7; `parseInline`/`blockify`/`normalizeLinkHref`/`isUnsafeUrl`/`MdInlineNode` заданы в Task 2 и использованы в Task 4/7/6; `LinkDialog` props заданы в Task 6 и использованы в Task 7. Зависимости задач идут по порядку: каждая собирается независимо.