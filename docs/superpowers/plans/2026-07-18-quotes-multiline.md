# VYC-36 — Multiline Quotes (V2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-line compose/edit `<input>` with a multiline `<textarea>` (Enter sends, Shift+Enter inserts a newline, auto-growing height) and change quote detection from "whole message" to "per line, with consecutive `"> "` lines merged into one visual block" — so a user can write a few quoted lines followed by plain text in one message.

**Architecture:** Same single-component approach as V1: everything lives in `client/src/components/ChatArea.tsx` / `ChatArea.css`, plus a small generalization of the existing `client/src/hooks/useMentionAutocomplete.ts` hook (its types are hardcoded to `HTMLInputElement`; the logic itself is element-agnostic). Four sequential tasks: (1) line-grouping renderer, (2) compose textarea, (3) per-line quote-toggle button with live highlight, (4) edit textarea. Each task compiles and is manually verifiable on its own.

**Tech Stack:** React + TypeScript (existing `ChatArea.tsx`/`ChatArea.css`/`useMentionAutocomplete.ts`), no new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-quotes-design.md` (V2 section) — every requirement below traces back to it.
- No new dependencies (npm) — everything is buildable with what's already imported.
- No backend changes: no migration, no `domain.Message` field, no API/WS payload change. `content` stays a plain string; `\n` is just a character in it.
- Quote marker is exactly `"> "` (`>` followed by one space), evaluated **per line** in V2 (not per whole message as in V1).
- Enter sends/saves; Shift+Enter inserts a newline. This applies to both the compose field and the edit field.
- UI copy stays Russian, consistent with the rest of the file (`Удалить сообщение?`, `(изменено)`, button label `"Цитата"` — unchanged from V1).
- Client has **no unit test runner** (no vitest/jest in `client/package.json`, no `*.test.*`/`*.spec.*` files anywhere in `client/`). Every task is verified via `cd client && npm run build:vite` (tsc type-check + build) plus manual browser QA — not automated tests.
- **Node version:** the system Node is 18.19.1; Vite 8 requires 20.19+/22.12+. Before running any `npm`/`npx` command in `client/`, run:
  ```bash
  export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
  ```
- **Local dev stack for manual QA** (needed starting Task 1): Postgres + Redis run in Docker (`docker ps` — containers `vycord-db` / `vycord-redis`; if not running: `docker compose up -d postgres redis` from the repo root). If `docker exec vycord-db psql -U vycord -d vycord -c '\dt'` shows no `users` table, run `make migrate-up` from the repo root first. Then, in two separate terminals (or background processes):
  ```bash
  # API server — repo root, uses docker-compose.yml defaults (db "vycord", user "vycord"), NOT the mydiscrod creds in the repo-root .env
  cd server && JWT_SECRET=dev-test-secret go run ./cmd/api

  # Client — client/, port 5173 specifically: it's the one origin from
  # server/internal/delivery/http/middleware/cors.go's AllowedOrigins that
  # a plain `vite --port <N>` dev server can bind to (other allowed origins
  # are prod hosts / port 80). Any other port gets blocked by CORS.
  cd client && VITE_API_URL=http://localhost:8080 VITE_WS_URL=ws://localhost:8080 npx vite --port 5173 --strictPort
  ```
  Register a throwaway test user once (safe — `vycord` is a local dev-only DB already used for ad-hoc/e2e test users):
  ```bash
  curl -s -X POST http://localhost:8080/api/v1/auth/register -H "Content-Type: application/json" \
    -d '{"username":"quotetester","email":"quotetester@example.com","password":"testpass123"}'
  ```
  If it errors with "already exists" (re-running this plan on a machine where Task 1's QA already ran), log in instead:
  ```bash
  curl -s -X POST http://localhost:8080/api/v1/auth/login -H "Content-Type: application/json" \
    -d '{"email":"quotetester@example.com","password":"testpass123"}'
  ```
  Either call returns `{"token": "...", ...}` — save that JWT, it's needed for Task 1's curl-based verification (the compose UI can't type a literal newline until Task 2 lands).

---

## Task 1: Render `content` as grouped quote/plain line-blocks

**Files:**
- Modify: `client/src/components/ChatArea.tsx:51-57` (rewrite `renderMessageBody`)
- Modify: `client/src/components/ChatArea.css` (add `white-space: pre-wrap` to `.message-text`)

**Interfaces:**
- Produces: `renderMessageBody(content: string, members: MemberWithUser[], currentUserId?: string): React.ReactNode` — same signature as the V1 version it replaces (already consumed at `ChatArea.tsx:375`, no caller change needed).

This task only changes how existing `content` strings are rendered. The compose UI is still the V1 single-line `<input>` at this point (Task 2 makes it multiline), so multi-line test content is created directly via the API with curl, using the local dev stack from Global Constraints.

- [ ] **Step 1: Replace `renderMessageBody`**

In `client/src/components/ChatArea.tsx`, replace (currently lines 51–57):

```tsx
function renderMessageBody(content: string, members: MemberWithUser[], currentUserId?: string) {
  if (!content.startsWith(QUOTE_PREFIX)) {
    return renderMessageContent(content, members, currentUserId);
  }
  const body = content.slice(QUOTE_PREFIX.length);
  return <span className="message-quote">{renderMessageContent(body, members, currentUserId)}</span>;
}
```

with:

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

`renderMessageContent` itself is unchanged — `tokenizeMentions` (`client/src/utils/mentions.ts`) is a plain regex scan and already works fine on a multi-line `text` argument.

- [ ] **Step 2: Preserve line breaks visually**

In `client/src/components/ChatArea.css`, insert immediately before the existing `.message.other .message-text { ... }` rule (currently line 135):

```css
.message-text {
  white-space: pre-wrap;
}

```

Without this, the browser collapses `\n` inside text nodes and every line would render on one visual line regardless of `renderMessageBody`'s grouping.

- [ ] **Step 3: Type-check and build**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
cd client && npm run build:vite
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Manual verification via curl**

With the local dev stack up (Global Constraints) and `TOKEN` set to the JWT from register/login:

```bash
BASE=http://localhost:8080/api/v1

# Reuse an existing server/channel if you already have one from earlier QA,
# otherwise create one:
SRV_ID=$(curl -s -X POST $BASE/servers -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"name":"QuoteMultilineQA"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
CH_ID=$(curl -s -X POST $BASE/servers/$SRV_ID/channels -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"name":"general","type":"text"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# Two consecutive quote lines followed by plain text, all in one message:
curl -s -X POST $BASE/channels/$CH_ID/messages -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"content":"> first quoted line\n> second quoted line\nplain text after"}'

# Interleaved quote/plain/quote:
curl -s -X POST $BASE/channels/$CH_ID/messages -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"content":"> a\nb\n> c"}'
```

Open `http://localhost:5173`, log in as `quotetester` / `testpass123`, open the `QuoteMultilineQA` server / `general` channel:
- First message: **one** left border spanning "first quoted line" + "second quoted line", then "plain text after" below it with no border.
- Second message: three visually distinct segments — quoted "a", plain "b", quoted "c" — with two separate left borders (not one continuous one).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ChatArea.tsx client/src/components/ChatArea.css
git commit -m "feat(chat): parse and render quote blocks per-line"
```

---

## Task 2: Multiline compose input (textarea, Enter/Shift+Enter, auto-height)

**Files:**
- Modify: `client/src/hooks/useMentionAutocomplete.ts` (generalize element type from `HTMLInputElement` to `HTMLTextAreaElement`)
- Modify: `client/src/components/ChatArea.tsx` (`inputRef` type, new `handleComposeKeyDown`, new auto-height effect, compose JSX)
- Modify: `client/src/components/ChatArea.css` (`.chat-input input` → `.chat-input textarea`, including the mobile `@media` override)

**Interfaces:**
- Consumes: `renderMessageBody` (Task 1, unchanged signature).
- Produces: `handleComposeKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void` — consumed by Task 3 only indirectly (Task 3 does not modify this function, but relies on the textarea it's attached to already existing).
- Changes the type of `useMentionAutocomplete`'s `inputRef`/`handleChange`/`handleKeyDown` params from `HTMLInputElement` to `HTMLTextAreaElement` — both call sites (`composeMention` in this task's scope, `editMention` used by Task 4) must keep compiling, so `editInputRef` in Task 4 will need the same type change before this hook change and the edit `<input>` type-check cleanly together. Until Task 4 lands, `client/src/components/ChatArea.tsx` will **not** type-check as a whole after this task's hook change alone — Step 2 below updates `editInputRef`'s type too (a one-line change, without touching the edit JSX/behavior) specifically so the file keeps compiling at the end of this task.

- [ ] **Step 1: Generalize `useMentionAutocomplete` to `HTMLTextAreaElement`**

In `client/src/hooks/useMentionAutocomplete.ts`, apply these three changes:

```diff
   value: string;
   setValue: (value: string) => void;
-  inputRef: RefObject<HTMLInputElement | null>;
+  inputRef: RefObject<HTMLTextAreaElement | null>;
   members: MemberWithUser[];
```

```diff
-  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
+  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
```

```diff
-  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
+  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
```

Nothing else in the file changes — `.value`, `.selectionStart`, `.setSelectionRange()`, `.focus()` all exist identically on `HTMLTextAreaElement`.

- [ ] **Step 2: Update `editInputRef`'s type (keeps the file compiling; edit JSX itself changes in Task 4)**

In `client/src/components/ChatArea.tsx`, find (currently line 207):

```tsx
  const editInputRef = useRef<HTMLInputElement>(null);
```

Replace with:

```tsx
  const editInputRef = useRef<HTMLTextAreaElement>(null);
```

This alone would break the edit `<input ref={editInputRef} ...>` JSX's type (a `RefObject<HTMLTextAreaElement>` can't attach to an `<input>`). To avoid touching edit behavior in this task, also change just the tag name at `ChatArea.tsx:363` and `ChatArea.tsx:372` from `<input` / `/>` to `<textarea` / `></textarea>`, keeping every prop identical (`className="message-edit-input"`, `value={editValue}`, `onChange={editMention.handleChange}`, `onKeyDown={(e) => handleEditKeyDown(e, msg.id)}`, `onBlur={cancelEdit}`, `maxLength={2000}`, `autoFocus`, dropping the now-invalid `type` isn't needed since `<input>` here never had a `type` prop). This is a pure element-tag swap with no behavior change yet — Task 4 adds Shift+Enter/auto-height for it. Concretely, replace (currently lines 363–372):

```tsx
                        <input
                          ref={editInputRef}
                          className="message-edit-input"
                          value={editValue}
                          onChange={editMention.handleChange}
                          onKeyDown={(e) => handleEditKeyDown(e, msg.id)}
                          onBlur={cancelEdit}
                          maxLength={2000}
                          autoFocus
                        />
```

with:

```tsx
                        <textarea
                          ref={editInputRef}
                          className="message-edit-input"
                          value={editValue}
                          onChange={editMention.handleChange}
                          onKeyDown={(e) => handleEditKeyDown(e, msg.id)}
                          onBlur={cancelEdit}
                          maxLength={2000}
                          rows={1}
                          autoFocus
                        />
```

(`rows={1}` added so it doesn't default to the browser's 2-row `<textarea>` minimum before Task 4's auto-height effect exists — harmless single-line rendering until then.) `handleEditKeyDown`'s parameter type at `ChatArea.tsx:246` also needs updating for this to type-check:

```diff
-  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>, messageId: string) => {
+  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, messageId: string) => {
```

- [ ] **Step 3: Change `inputRef`'s type**

In `client/src/components/ChatArea.tsx`, find (currently line 81):

```tsx
  const inputRef = useRef<HTMLInputElement>(null);
```

Replace with:

```tsx
  const inputRef = useRef<HTMLTextAreaElement>(null);
```

- [ ] **Step 4: Add the Enter/Shift+Enter handler**

In `client/src/components/ChatArea.tsx`, immediately after `handleSubmit`'s closing `};` (currently lines 185–198), insert:

```tsx

  const handleComposeKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composeMention.handleKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };
```

`composeMention.handleKeyDown` already calls `e.preventDefault()` internally when it handles arrow/Enter/Escape for the mention dropdown and returns `true` in that case, so the `Enter` branch below only fires when the dropdown isn't consuming the key.

- [ ] **Step 5: Add the auto-height effect**

In `client/src/components/ChatArea.tsx`, immediately after the existing channel-change effect (currently lines 100–104):

```tsx
  useEffect(() => {
    inputRef.current?.focus();
    composeMention.reset();
    editMention.reset();
  }, [channel?.id]);
```

insert:

```tsx

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);
```

- [ ] **Step 6: Replace the compose `<input>` with `<textarea>`**

In `client/src/components/ChatArea.tsx`, replace (currently lines 446–454):

```tsx
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={composeMention.handleChange}
            onKeyDown={composeMention.handleKeyDown}
            placeholder={`Message #${channel.name}`}
            maxLength={2000}
          />
```

with:

```tsx
          <textarea
            ref={inputRef}
            value={input}
            onChange={composeMention.handleChange}
            onKeyDown={handleComposeKeyDown}
            placeholder={`Message #${channel.name}`}
            maxLength={2000}
            rows={1}
          />
```

(The quote-toggle button just above this, at `ChatArea.tsx:437-438`, still reads `input.startsWith(QUOTE_PREFIX)` at this point — that's the V1 whole-message check. It keeps compiling and keeps working for single-line input; Task 3 replaces it with the per-current-line live check.)

- [ ] **Step 7: Replace the `.chat-input input` CSS with `.chat-input textarea`**

In `client/src/components/ChatArea.css`, replace (currently lines 326–346):

```css
.chat-input input {
  width: 100%;
  padding: 13px 18px;
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: all var(--transition);
  box-shadow: var(--shadow-sm);
}

.chat-input input::placeholder {
  color: var(--text-muted);
}

.chat-input input:focus {
  border-color: var(--brand-color);
  box-shadow: 0 0 0 3px var(--brand-subtle), var(--shadow-md);
}
```

with:

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

- [ ] **Step 8: Fix the mobile font-size override**

`ChatArea.css` has a `@media (max-width: 768px)` block (starts at line 415) with a rule that stops the browser auto-zooming on focus for touch inputs — it still targets the old `input` selector and would silently stop applying once the element becomes a `<textarea>`. In `client/src/components/ChatArea.css`, inside that media query, replace (currently lines 462–464):

```css
  .chat-input input {
    font-size: 16px;
  }
```

with:

```css
  .chat-input textarea {
    font-size: 16px;
  }
```

- [ ] **Step 9: Type-check and build**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
cd client && npm run build:vite
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 10: Manual verification**

Start the local dev stack (Global Constraints) if not already running, open `http://localhost:5173`, log in, open any channel:

- Type text, press Enter — message sends, field clears.
- Type text, press Shift+Enter — cursor moves to a new line, field does **not** send, and the field visibly grows by one line.
- Keep pressing Shift+Enter — the field keeps growing until it hits the max height, then an internal scrollbar appears inside the field instead of it growing further.
- Type `> quoted\nplain` (via Shift+Enter between the two lines) and send — confirm it renders per Task 1's grouping (quote block, then plain line).
- Type `@` and confirm the mention dropdown still opens and positions correctly above the textarea (not broken by the type change).
- Resize the window to ≤768px (or use responsive dev tools) — the field still renders at 16px font (no unwanted mobile zoom-on-focus).

- [ ] **Step 11: Commit**

```bash
git add client/src/components/ChatArea.tsx client/src/components/ChatArea.css client/src/hooks/useMentionAutocomplete.ts
git commit -m "feat(chat): use multiline textarea for the compose input"
```

---

## Task 3: Quote-toggle button acts on the current line, with live highlight

**Files:**
- Modify: `client/src/components/ChatArea.tsx` (new `currentLineRange` helper, new `caretInQuoteLine` state, new `updateQuoteButtonActive`/`handleComposeChange`, rewritten `toggleQuotePrefix`, compose JSX wiring)

**Interfaces:**
- Consumes: `QUOTE_PREFIX` (existing module constant), `inputRef`/`input`/`setInput` (Task 2).
- Produces: `caretInQuoteLine: boolean` state — read only by this task's own JSX (button `className`/`aria-pressed`). No other task depends on it.

- [ ] **Step 1: Add the `ChangeEvent` type import**

In `client/src/components/ChatArea.tsx`, find the top import (currently line 1):

```tsx
import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
```

Replace with:

```tsx
import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent, type ChangeEvent } from 'react';
```

- [ ] **Step 2: Add the `currentLineRange` helper**

In `client/src/components/ChatArea.tsx`, immediately after the `QUOTE_PREFIX` constant (currently line 20):

```tsx
const QUOTE_PREFIX = '> ';
```

insert:

```tsx

function currentLineRange(value: string, caret: number) {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  const endIdx = value.indexOf('\n', caret);
  const end = endIdx === -1 ? value.length : endIdx;
  return { start, end };
}
```

- [ ] **Step 3: Add `caretInQuoteLine` state**

In `client/src/components/ChatArea.tsx`, find (currently line 78):

```tsx
  const [input, setInput] = useState('');
```

Replace with:

```tsx
  const [input, setInput] = useState('');
  const [caretInQuoteLine, setCaretInQuoteLine] = useState(false);
```

- [ ] **Step 4: Add `updateQuoteButtonActive` and `handleComposeChange`, rewrite `toggleQuotePrefix`**

In `client/src/components/ChatArea.tsx`, replace the existing `toggleQuotePrefix` (currently lines 215–218):

```tsx
  const toggleQuotePrefix = () => {
    setInput((prev) => (prev.startsWith(QUOTE_PREFIX) ? prev.slice(QUOTE_PREFIX.length) : `${QUOTE_PREFIX}${prev}`));
    requestAnimationFrame(() => inputRef.current?.focus());
  };
```

with:

```tsx
  const updateQuoteButtonActive = (value: string = input, caret?: number) => {
    const el = inputRef.current;
    const pos = caret ?? el?.selectionStart ?? 0;
    const { start, end } = currentLineRange(value, pos);
    setCaretInQuoteLine(value.slice(start, end).startsWith(QUOTE_PREFIX));
  };

  const handleComposeChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    composeMention.handleChange(e);
    updateQuoteButtonActive(e.target.value, e.target.selectionStart ?? undefined);
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

`updateQuoteButtonActive`'s `value`/`caret` params default to the closure's `input` state and the textarea's live `selectionStart` — used by the `onSelect`/`onClick`/`onKeyUp` wiring in Step 5, where `input` is already current. `handleComposeChange` passes `e.target.value`/`e.target.selectionStart` explicitly instead, because inside the same `onChange` event React hasn't yet re-rendered with the new `input` state — the closure's `input` is still the pre-keystroke value.

- [ ] **Step 5: Wire the textarea and button to the new state**

In `client/src/components/ChatArea.tsx`, replace the quote button + textarea block (currently lines 451–470):

```tsx
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
          <textarea
            ref={inputRef}
            value={input}
            onChange={composeMention.handleChange}
            onKeyDown={handleComposeKeyDown}
            placeholder={`Message #${channel.name}`}
            maxLength={2000}
            rows={1}
          />
```

with:

```tsx
          <button
            type="button"
            className={`quote-toggle-btn${caretInQuoteLine ? ' active' : ''}`}
            aria-pressed={caretInQuoteLine}
            onClick={toggleQuotePrefix}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
            <span>Цитата</span>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleComposeChange}
            onKeyDown={handleComposeKeyDown}
            onSelect={() => updateQuoteButtonActive()}
            onClick={() => updateQuoteButtonActive()}
            onKeyUp={() => updateQuoteButtonActive()}
            placeholder={`Message #${channel.name}`}
            maxLength={2000}
            rows={1}
          />
```

- [ ] **Step 6: Reset the button state on channel switch**

In `client/src/components/ChatArea.tsx`, find the channel-change effect (currently lines 100–104, right above the auto-height effect added in Task 2):

```tsx
  useEffect(() => {
    inputRef.current?.focus();
    composeMention.reset();
    editMention.reset();
  }, [channel?.id]);
```

Replace with:

```tsx
  useEffect(() => {
    inputRef.current?.focus();
    composeMention.reset();
    editMention.reset();
    setCaretInQuoteLine(false);
  }, [channel?.id]);
```

(Without this, switching channels while the button is highlighted would leave it highlighted even though the new channel's `input` state is `''` — an empty line is never quoted.)

- [ ] **Step 7: Type-check and build**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
cd client && npm run build:vite
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8: Manual verification**

Open `http://localhost:5173`, log in, open a channel:

- Empty field, click "Цитата" — `"> "` appears, cursor stays right after it, button becomes highlighted (`active`).
- Click "Цитата" again (cursor still on that line) — the `"> "` prefix is removed, button un-highlights.
- Type `first line`, Shift+Enter, type `second line` — cursor is now on line 2 (unquoted). Click "Цитата" — only line 2 gets `"> "` prepended; line 1 is untouched.
- With the cursor still on line 2 (now quoted), use the Up arrow key to move the cursor to line 1 (unquoted) — the button un-highlights without any click, purely from the caret move.
- Click directly into a quoted line with the mouse — button highlights; click into a plain line — button un-highlights.
- Switch to a different channel and back — button is not highlighted when the (now empty) field is empty.

- [ ] **Step 9: Commit**

```bash
git add client/src/components/ChatArea.tsx
git commit -m "feat(chat): apply quote toggle to the current line with live highlight"
```

---

## Task 4: Multiline edit input (textarea, Enter/Shift+Enter, auto-height)

**Files:**
- Modify: `client/src/components/ChatArea.tsx` (`handleEditKeyDown` Shift+Enter behavior, new auto-height effect for the edit field)
- Modify: `client/src/components/ChatArea.css` (`.message-edit-input` sizing)

**Interfaces:**
- Consumes: `editInputRef`/`editValue`/`editingId` (already `HTMLTextAreaElement`-typed and rendered as `<textarea>` since Task 2 Step 2 — this task only adds behavior, not the element swap).

- [ ] **Step 1: Make Enter/Shift+Enter work in the edit field**

In `client/src/components/ChatArea.tsx`, find `handleEditKeyDown` (currently lines 296–305):

```tsx
  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, messageId: string) => {
    if (editMention.handleKeyDown(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(messageId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };
```

Replace the `Enter` condition with:

```tsx
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

- [ ] **Step 2: Add the edit field's auto-height effect**

This effect's dependency array reads `editValue`/`editingId`, so — unlike the callback *body* of a `useEffect`, which only runs after the whole component function has executed once and would compile fine anywhere — the dependency array itself is evaluated inline, in render order. It must therefore go **after** `editValue`/`editingId` are declared, not next to the compose auto-height effect from Task 2 Step 5 (which sits above them). In `client/src/components/ChatArea.tsx`, find the `editMention` declaration (currently lines 258–264):

```tsx
  const editMention = useMentionAutocomplete({
    value: editValue,
    setValue: setEditValue,
    inputRef: editInputRef,
    members,
    currentUserRole,
  });
```

Immediately after that closing `});`, insert:

```tsx

  useEffect(() => {
    const el = editInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editValue, editingId]);
```

(Depends on `editingId` too, not just `editValue`, so the field sizes correctly the moment editing starts — `editValue` is set together with `editingId` in `startEdit`, but if they were equal on a re-render with unchanged `editValue` the effect wouldn't otherwise re-run.)

- [ ] **Step 3: Size the edit textarea with CSS**

In `client/src/components/ChatArea.css`, replace `.message-edit-input` (currently lines 265–274):

```css
.message-edit-input {
  width: 100%;
  padding: 8px 14px;
  border: 1.5px solid var(--brand-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}
```

with:

```css
.message-edit-input {
  width: 100%;
  padding: 8px 14px;
  border: 1.5px solid var(--brand-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  resize: none;
  max-height: 40vh;
  overflow-y: auto;
}
```

- [ ] **Step 4: Type-check and build**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
cd client && npm run build:vite
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manual verification**

Open `http://localhost:5173`, log in, open a channel:

- Send a multi-line message: `> quoted line one`, Shift+Enter, `> quoted line two`, Shift+Enter, `plain line`.
- Click the pencil (edit) icon on that message — the edit field shows the content as **real line breaks** (three visual lines), not a flattened single line.
- Press Shift+Enter inside the edit field — a new line is inserted, message is not saved.
- Press Enter — message saves; rendered result still shows one merged quote block (two lines) followed by the plain line, per Task 1's grouping.
- Press Escape while editing — edit is cancelled, original message unchanged.
- Edit field visibly grows as lines are added, caps at the same max-height/scroll behavior as the compose field.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ChatArea.tsx client/src/components/ChatArea.css
git commit -m "feat(chat): use multiline textarea for message editing"
```
