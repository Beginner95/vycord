# Quote From Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user selects text — either inside the compose/edit `<textarea>` or in the rendered chat message list — show a floating "Цитата" button next to the selection that turns the selected text into a quote (`"> "` prefix per line), instead of requiring the caret-only toolbar button.

**Architecture:** One new reusable hook, `useFloatingSelectionToolbar` (`client/src/hooks/`), that shows/hides a floating button based on a pluggable `getSelectionInfo` callback (mouse-point-based for `<textarea>`, `Range`-based for the chat message list) and calls a pluggable `onConfirm`. It's used three times inside `ChatArea.tsx` — compose, edit, and the chat message list — each supplying its own selection-detection strategy and confirm action. The existing caret-only `toggleQuotePrefix` is first generalized (Task 1) to operate on `[selectionStart, selectionEnd]` instead of just the caret line, so both the existing toolbar button and the new floating button share one implementation.

**Tech Stack:** React + TypeScript (existing `ChatArea.tsx`/`ChatArea.css`), one new hook file, no new npm dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-quote-from-selection-design.md` — every requirement below traces back to it.
- No new dependencies (npm) — everything is buildable with what's already imported.
- No backend changes: no migration, no `domain.Message` field, no API/WS payload change. `content` stays a plain string; `"> "` per-line quoting is unchanged from the existing V1/V2 quotes feature.
- Quoting from the chat list always targets the **compose** field, never the edit field, even while a message is being edited elsewhere.
- No author attribution is inserted — only the selected text with `"> "` per line.
- Quoting from chat inserts at the **start** of the compose field, pushing any existing draft down, separated by one `\n`.
- Desktop only (mouse + keyboard) — no touch/pointer-event handling in this plan.
- UI copy stays Russian, consistent with the rest of the file (button label `"Цитата"`, same as the existing toolbar button).
- Client has **no unit test runner** (no vitest/jest in `client/package.json`, no `*.test.*`/`*.spec.*` files anywhere in `client/`). Every task is verified via `cd client && npm run build:vite` (tsc type-check + build, with `noUnusedLocals`/`noUnusedParameters` both enabled in `client/tsconfig.json` — unused variables/params are compile errors, not just lint warnings) plus manual browser QA — not automated tests.
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
    -d '{"username":"selectquotetester","email":"selectquotetester@example.com","password":"testpass123"}'
  ```
  If it errors with "already exists" (re-running this plan on a machine where an earlier task's QA already ran), log in instead:
  ```bash
  curl -s -X POST http://localhost:8080/api/v1/auth/login -H "Content-Type: application/json" \
    -d '{"email":"selectquotetester@example.com","password":"testpass123"}'
  ```
  Either call returns `{"token": "...", ...}`. Open `http://localhost:5173` in a browser, log in as `selectquotetester` / `testpass123`, create a server + text channel through the UI (or reuse one from earlier QA sessions) so there's a channel to select and messages to send from the browser directly — this plan's QA is all mouse/keyboard-driven in the browser, no curl needed after this point.

---

## Task 1: Generalize the quote toggle to operate on a selection range

**Files:**
- Modify: `client/src/components/ChatArea.tsx:22-27` (replace `currentLineRange`), `:225-254` (`updateQuoteButtonActive`, `toggleQuotePrefix`)

**Interfaces:**
- Produces: `lineRangeForSelection(value: string, start: number, end: number): { lineStart: number; lineEnd: number }` — pure function, replaces `currentLineRange`.
- Produces: `toggleQuoteLinesInRange(value: string, start: number, end: number): { newValue: string; delta: number; allQuoted: boolean; shiftFor: (pos: number) => number }` — pure function. `toggleQuotePrefixRange` (below) wraps it for the compose field; Task 3 adds an edit-field equivalent that wraps it the same way, using `shiftFor` the same way. Task 4's `insertQuoteIntoCompose` does **not** use it — that's a different operation (always-add prefixing into a fresh block, not a toggle) with its own logic.
- Produces: `toggleQuotePrefixRange(start: number, end: number): void` — new function on `ChatArea`, consumed by Task 2 (floating button `onConfirm` for compose) and by the existing toolbar button (now generalized, see Step 3).

This task only changes compose-field logic; the toolbar button ("Цитата" above the compose field) is the only UI already wired to it, so it's fully testable through that existing button — no new UI yet.

- [ ] **Step 1: Replace `currentLineRange` with `lineRangeForSelection` + add `toggleQuoteLinesInRange`**

In `client/src/components/ChatArea.tsx`, replace (currently lines 22–27):

```tsx
function currentLineRange(value: string, caret: number) {
  const start = caret <= 0 ? 0 : value.lastIndexOf('\n', caret - 1) + 1;
  const endIdx = value.indexOf('\n', caret);
  const end = endIdx === -1 ? value.length : endIdx;
  return { start, end };
}
```

with:

```tsx
function lineRangeForSelection(value: string, start: number, end: number) {
  const lineStart = start <= 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  // A selection that ends exactly at the start of a new line (e.g. Shift+Down
  // stopping at column 0 of the next line) has selected 0 characters of that
  // line — don't treat it as touched.
  const selEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const searchFrom = Math.max(selEnd, lineStart);
  const endIdx = value.indexOf('\n', searchFrom);
  const lineEnd = endIdx === -1 ? value.length : endIdx;
  return { lineStart, lineEnd };
}

function toggleQuoteLinesInRange(value: string, start: number, end: number) {
  const { lineStart, lineEnd } = lineRangeForSelection(value, start, end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allQuoted = lines.every((line) => line.startsWith(QUOTE_PREFIX));
  const newLines = lines.map((line) => {
    if (allQuoted) return line.slice(QUOTE_PREFIX.length);
    return line.startsWith(QUOTE_PREFIX) ? line : `${QUOTE_PREFIX}${line}`;
  });
  const newBlock = newLines.join('\n');
  const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  const delta = newBlock.length - block.length;

  // How far a position within [lineStart, lineEnd] shifts after the toggle: the
  // sum of the per-line length deltas for every line up to and including the
  // line the position sits on. A line's prefix is always inserted/removed at
  // that line's own start, which is at-or-before any position within it, so
  // that line's full delta always applies — this is the same reasoning the
  // old single-line `toggleQuotePrefix` relied on (`pos = caret + delta`),
  // generalized to a block that can contain several lines with different
  // per-line deltas (e.g. a mixed selection where some lines were already
  // quoted and others weren't, in add-mode).
  const shiftFor = (pos: number) => {
    const lineIndex = (value.slice(lineStart, pos).match(/\n/g) ?? []).length;
    let shift = 0;
    for (let i = 0; i <= lineIndex && i < lines.length; i++) {
      shift += newLines[i].length - lines[i].length;
    }
    return shift;
  };

  return { newValue, delta, allQuoted, shiftFor };
}
```

For `start === end` (a plain caret, no selection), `lineRangeForSelection` produces the exact same `{ lineStart, lineEnd }` as the old `currentLineRange(value, caret)` did — the `end > start` guard on the trailing-newline check is `false`, so `selEnd = end = caret`, and `searchFrom = Math.max(caret, lineStart) = caret` (since `lineStart <= caret` always), matching `value.indexOf('\n', caret)` from the old function.

- [ ] **Step 2: Update `updateQuoteButtonActive` to use `lineRangeForSelection`**

In `client/src/components/ChatArea.tsx`, replace (currently lines 225–230):

```tsx
  const updateQuoteButtonActive = (value: string = input, caret?: number) => {
    const el = inputRef.current;
    const pos = caret ?? el?.selectionStart ?? 0;
    const { start, end } = currentLineRange(value, pos);
    setCaretInQuoteLine(value.slice(start, end).startsWith(QUOTE_PREFIX));
  };
```

with:

```tsx
  const updateQuoteButtonActive = (value: string = input, caret?: number) => {
    const el = inputRef.current;
    const pos = caret ?? el?.selectionStart ?? 0;
    const { lineStart, lineEnd } = lineRangeForSelection(value, pos, pos);
    setCaretInQuoteLine(value.slice(lineStart, lineEnd).startsWith(QUOTE_PREFIX));
  };
```

- [ ] **Step 3: Replace `toggleQuotePrefix` with a range-aware version, generalizing the existing toolbar button**

In `client/src/components/ChatArea.tsx`, replace (currently lines 237–254):

```tsx
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

with:

```tsx
  const toggleQuotePrefixRange = (start: number, end: number) => {
    const el = inputRef.current;
    const { newValue, allQuoted, shiftFor } = toggleQuoteLinesInRange(input, start, end);
    const newStart = start + shiftFor(start);
    const newEnd = end + shiftFor(end);
    setInput(newValue);
    setCaretInQuoteLine(!allQuoted);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newStart, newEnd);
    });
  };

  const toggleQuotePrefix = () => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    toggleQuotePrefixRange(start, end);
  };
```

`toggleQuotePrefix` (bound to the existing toolbar button's `onClick`) now reads **both** `selectionStart` and `selectionEnd` instead of just the caret — so if the user has an active multi-line selection and clicks the existing "Цитата" button, it now toggles the whole selection instead of only the line the caret happens to sit on. When there's no selection (`start === end`), behavior is unchanged from before.

- [ ] **Step 4: Type-check and build**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
cd client && npm run build:vite
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manual verification**

Open `http://localhost:5173`, log in, open a channel:

- Regression check: click "Цитата" with just a caret (no selection) on an empty line — behaves exactly as before (adds `"> "`, click again removes it).
- Type two lines (`first`, Shift+Enter, `second`). Select both lines with the mouse (drag from start of `first` to end of `second`) or Shift+Down+End. Click "Цитата" — **both** lines get `"> "` prepended.
- With both lines still selected (now quoted), click "Цитата" again — both `"> "` prefixes are removed.
- Type three lines (`a`, Shift+Enter, `b`, Shift+Enter, `c`). Select from partway through `a` to the very start of `c` (e.g. click mid-`a`, Shift+click at column 0 of `c`) — this selects all of `a`, all of `b`, and 0 characters of `c`. Click "Цитата" — only `a` and `b` get quoted, `c` is untouched.
- Select a single word in the middle of an unquoted line, click "Цитата" — the **whole line** containing that word gets quoted (matches existing single-line behavior, now reached via the range path since `allQuoted` is computed over the one-line block).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ChatArea.tsx
git commit -m "feat(chat): generalize quote toggle to operate on a selection range"
```

---

## Task 2: Floating quote button for compose-field selection

**Files:**
- Create: `client/src/hooks/useFloatingSelectionToolbar.ts`
- Modify: `client/src/components/ChatArea.tsx` (import hook, add `FloatingQuoteButton` component, wire `composeSelectionToolbar`, render it)
- Modify: `client/src/components/ChatArea.css` (add `.floating-quote-btn`)

**Interfaces:**
- Consumes: `toggleQuotePrefixRange` (Task 1).
- Produces: `useFloatingSelectionToolbar({ containerRef, getSelectionInfo, onConfirm, resubscribeKey? }): { visible: boolean; x: number; y: number; confirm: () => void }` — the hook Task 3 and Task 4 both call again with their own arguments.
- Produces: `FloatingQuoteButton` component (`{ x: number; y: number; onConfirm: () => void }`) — reused as-is by Task 3 and Task 4.

- [ ] **Step 1: Create the hook**

Create `client/src/hooks/useFloatingSelectionToolbar.ts`:

```ts
import { useEffect, useRef, useState, type RefObject } from 'react';

export interface SelectionInfo {
  text: string;
  x: number;
  y: number;
}

interface UseFloatingSelectionToolbarArgs {
  containerRef: RefObject<HTMLElement | null>;
  getSelectionInfo: (e: MouseEvent) => SelectionInfo | null;
  onConfirm: (text: string) => void;
  /**
   * Extra value to re-run the subscription effect on. Needed whenever
   * containerRef.current mounts *after* this hook's first render (e.g. a
   * ref attached only inside a conditional branch) — passing the value
   * that changes when that branch becomes active (e.g. `channel?.id`,
   * `editingId`) re-attaches listeners to the freshly mounted node.
   */
  resubscribeKey?: unknown;
}

export function useFloatingSelectionToolbar({
  containerRef,
  getSelectionInfo,
  onConfirm,
  resubscribeKey,
}: UseFloatingSelectionToolbarArgs) {
  const [state, setState] = useState<SelectionInfo | null>(null);
  const getSelectionInfoRef = useRef(getSelectionInfo);
  const onConfirmRef = useRef(onConfirm);
  getSelectionInfoRef.current = getSelectionInfo;
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (e: MouseEvent) => {
      const info = getSelectionInfoRef.current(e);
      if (!info || info.text.trim().length === 0) {
        setState(null);
        return;
      }
      const clampedX = Math.max(70, Math.min(info.x, window.innerWidth - 70));
      setState({ ...info, x: clampedX });
    };

    const hide = () => setState(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('input', hide);
    container.addEventListener('scroll', hide);
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', hide);

    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('input', hide);
      container.removeEventListener('scroll', hide);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', hide);
    };
  }, [containerRef, resubscribeKey]);

  const confirm = () => {
    if (!state) return;
    onConfirmRef.current(state.text);
    setState(null);
  };

  return { visible: state !== null, x: state?.x ?? 0, y: state?.y ?? 0, confirm };
}
```

`getSelectionInfo`/`onConfirm` are stashed in refs and read through `.current` inside the effect so the effect itself doesn't need them in its dependency array (they're new closures every render) — only `containerRef`/`resubscribeKey` control re-subscription. The `mousedown`(document, capture-less)/`input`/`scroll`/`resize`/`Escape` listeners dismiss the tooltip; a click on the floating button itself calls `preventDefault()` (Step 3 below) which suppresses the focus-shift that would otherwise fire before the document `mousedown` listener runs — same technique already used for the existing mention-dropdown `<li onMouseDown>` at `ChatArea.tsx:438-441`.

- [ ] **Step 2: Add the `FloatingQuoteButton` component**

In `client/src/components/ChatArea.tsx`, add the import (currently line 9, after the `useMentionAutocomplete` import):

```tsx
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { useFloatingSelectionToolbar } from '@/hooks/useFloatingSelectionToolbar';
```

Then, immediately after `renderMessageBody`'s closing `}` (currently line 80), before `export function ChatArea` (currently line 82), insert:

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
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
      <span>Цитата</span>
    </button>
  );
}
```

Same quote icon as the existing toolbar button, for visual consistency.

- [ ] **Step 3: Wire the hook to the compose textarea**

In `client/src/components/ChatArea.tsx`, immediately after `toggleQuotePrefix`'s closing `};` (from Task 1, Step 3), insert:

```tsx

  const composeSelectionToolbar = useFloatingSelectionToolbar({
    containerRef: inputRef,
    resubscribeKey: channel?.id,
    getSelectionInfo: (e) => {
      const el = inputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null || start === end) return null;
      const text = el.value.slice(start, end);
      return { text, x: e.clientX, y: e.clientY + 16 };
    },
    onConfirm: () => {
      const el = inputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null) return;
      toggleQuotePrefixRange(start, end);
    },
  });
```

`resubscribeKey: channel?.id` matters here: `channel` can genuinely be `null` on first render (see `client/src/pages/AppPage.tsx:349`, `currentChannel` state starts `null` before any channel is picked) — in that render, the compose `<textarea>` isn't in the DOM at all (`ChatArea`'s early-return branch at line 331 renders instead), so `inputRef.current` is `null` when the hook's effect first runs. Without `resubscribeKey`, the effect would never re-run once a channel is later selected and the textarea mounts, and the floating button would never appear. `onConfirm` ignores the `text` argument the hook would pass and re-reads `inputRef.current.selectionStart/selectionEnd` directly instead — `toggleQuotePrefixRange` needs the numeric offsets, not just the substring, and those offsets are still valid at click time because the button's `onMouseDown` `preventDefault()` (Step 2) stops the textarea from losing its selection.

- [ ] **Step 4: Render the button**

In `client/src/components/ChatArea.tsx`, find the closing tags of the chat-input block (currently lines 534–535):

```tsx
      </div>
    </main>
  );
```

Replace with:

```tsx
      </div>

      {composeSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={composeSelectionToolbar.x}
          y={composeSelectionToolbar.y}
          onConfirm={composeSelectionToolbar.confirm}
        />
      )}
    </main>
  );
```

- [ ] **Step 5: Style the button**

In `client/src/components/ChatArea.css`, at the end of the file (after the existing `.mention-dropdown li.active, .mention-dropdown li:hover` rule, currently ending at line 531), append:

```css

/* ── Floating quote toolbar ── */
.floating-quote-btn {
  position: fixed;
  z-index: 1000;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--shadow-md);
}

.floating-quote-btn:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 6: Type-check and build**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
cd client && npm run build:vite
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Manual verification**

Open `http://localhost:5173`, log in, open a channel:

- Type a line of text in the compose field, select part of it with the mouse (click-drag) — a small "Цитата" button appears near the release point.
- Click it — the touched line(s) become quoted (same effect as the Task 1 toolbar-button test), the button disappears, and the textarea keeps focus with the selection preserved, now shifted past the inserted `"> "` prefixes (via `shiftFor`).
- Select an already-quoted line and click the floating button — the `"> "` prefix is removed.
- Select text, then press `Escape` (without clicking the button) — the button disappears, no text is changed.
- Select text, then click anywhere else in the page (not the button) — the button disappears.
- Select text so the button appears, then keep typing (replacing the selection) — the button disappears (via the `input` listener) instead of sticking around pointing at stale text.
- If the compose field has enough lines to scroll internally, select text then scroll the field — button disappears.
- Resize the browser window while the button is visible — it disappears, no console errors.
- Switch to a different channel with no channel currently selected (e.g. right after logging in with no channel picked, if your app flow allows landing there), then select a channel and confirm the floating button still works on the first try (regression check for `resubscribeKey`).

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/useFloatingSelectionToolbar.ts client/src/components/ChatArea.tsx client/src/components/ChatArea.css
git commit -m "feat(chat): add floating quote button for compose selection"
```

---

## Task 3: Floating quote button for edit-field selection

**Files:**
- Modify: `client/src/components/ChatArea.tsx` (new `toggleEditQuotePrefixRange`, `editSelectionToolbar`, render the button)

**Interfaces:**
- Consumes: `useFloatingSelectionToolbar`, `FloatingQuoteButton`, `toggleQuoteLinesInRange` (Tasks 1–2).
- Produces: `toggleEditQuotePrefixRange(start: number, end: number): void` — used only by this task's own `onConfirm`.

- [ ] **Step 1: Add the edit-field toggle function**

In `client/src/components/ChatArea.tsx`, immediately after the edit auto-height effect (currently lines 267–272):

```tsx
  useEffect(() => {
    const el = editInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editValue, editingId]);
```

insert:

```tsx

  const toggleEditQuotePrefixRange = (start: number, end: number) => {
    const el = editInputRef.current;
    const { newValue, shiftFor } = toggleQuoteLinesInRange(editValue, start, end);
    const newStart = start + shiftFor(start);
    const newEnd = end + shiftFor(end);
    setEditValue(newValue);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newStart, newEnd);
    });
  };

  const editSelectionToolbar = useFloatingSelectionToolbar({
    containerRef: editInputRef,
    resubscribeKey: editingId,
    getSelectionInfo: (e) => {
      const el = editInputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null || start === end) return null;
      const text = el.value.slice(start, end);
      return { text, x: e.clientX, y: e.clientY + 16 };
    },
    onConfirm: () => {
      const el = editInputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null) return;
      toggleEditQuotePrefixRange(start, end);
    },
  });
```

Unlike the compose field, the edit field has no `caretInQuoteLine`/toolbar-button state to keep in sync — it never had a toolbar button (per the existing V1/V2 quotes design, edits are quoted by typing `"> "` manually or, as of this task, via the floating button). `resubscribeKey: editingId` is required for the same reason `channel?.id` was required in Task 2: `editInputRef`'s `<textarea>` mounts and unmounts each time `editingId` changes (switching which message is being edited, or starting/stopping editing), rendered conditionally at `ChatArea.tsx:419-431` inside the messages `.map()`. Without re-subscribing on `editingId`, the hook's effect would only ever see `editInputRef.current === null` (its value at the time `ChatArea` first mounted, before any message was being edited).

- [ ] **Step 2: Render the button**

In `client/src/components/ChatArea.tsx`, find the block added in Task 2 Step 4:

```tsx
      {composeSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={composeSelectionToolbar.x}
          y={composeSelectionToolbar.y}
          onConfirm={composeSelectionToolbar.confirm}
        />
      )}
    </main>
  );
```

Replace with:

```tsx
      {composeSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={composeSelectionToolbar.x}
          y={composeSelectionToolbar.y}
          onConfirm={composeSelectionToolbar.confirm}
        />
      )}
      {editSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={editSelectionToolbar.x}
          y={editSelectionToolbar.y}
          onConfirm={editSelectionToolbar.confirm}
        />
      )}
    </main>
  );
```

- [ ] **Step 3: Type-check and build**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
cd client && npm run build:vite
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Manual verification**

Open `http://localhost:5173`, log in, open a channel:

- Send a two-line message (`Shift+Enter` between lines). Click the pencil (edit) icon.
- Select both lines in the edit field with the mouse — the floating "Цитата" button appears.
- Click it — both lines get `"> "` prepended in the edit field; press `Enter` to save — the rendered message shows a single quote block spanning both lines (per the existing per-line grouping renderer).
- Edit the same message again, select the now-quoted lines, click the floating button again — prefixes are removed; save and confirm the rendered message is plain text again.
- Start editing one message, then (without saving) somehow triggering a switch to editing a different message is not directly possible in this UI (only one `editingId` at a time via the pencil icon) — instead: cancel the edit (`Escape`), start editing a **different** message, select text there, and confirm the floating button still appears and works (regression check for `resubscribeKey: editingId`).
- Select text in the edit field, click elsewhere to blur/cancel the edit (`onBlur={cancelEdit}` already exists) — confirm no console errors from the toolbar hook trying to read a since-unmounted `editInputRef.current`.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ChatArea.tsx
git commit -m "feat(chat): add floating quote button for edit selection"
```

---

## Task 4: Quote selected chat text into the compose field

**Files:**
- Modify: `client/src/components/ChatArea.tsx` (new `chatMessagesRef`, `insertQuoteIntoCompose`, `chatSelectionToolbar`, ref on `.chat-messages`, render the button)

**Interfaces:**
- Consumes: `useFloatingSelectionToolbar`, `FloatingQuoteButton` (Task 2), `updateQuoteButtonActive` (existing, from before this plan).
- Produces: `insertQuoteIntoCompose(text: string): void` — used only by this task's `onConfirm`.

- [ ] **Step 1: Add a ref to the chat message list container**

In `client/src/components/ChatArea.tsx`, find the `inputRef` declaration (currently line 89):

```tsx
  const inputRef = useRef<HTMLTextAreaElement>(null);
```

Immediately after it, insert:

```tsx
  const chatMessagesRef = useRef<HTMLDivElement>(null);
```

Then find the `.chat-messages` div (currently line 366):

```tsx
      <div className="chat-messages">
```

Replace with:

```tsx
      <div className="chat-messages" ref={chatMessagesRef}>
```

- [ ] **Step 2: Add `insertQuoteIntoCompose` and wire the hook**

In `client/src/components/ChatArea.tsx`, immediately after the `composeSelectionToolbar` declaration added in Task 2 Step 3 (right after its closing `});`), insert:

```tsx

  const insertQuoteIntoCompose = (text: string) => {
    const el = inputRef.current;
    if (!el) return;
    const quotedBlock = text
      .split('\n')
      .map((line) => (line.startsWith(QUOTE_PREFIX) ? line : `${QUOTE_PREFIX}${line}`))
      .join('\n');
    const newValue = input.length === 0 ? quotedBlock : `${quotedBlock}\n${input}`;
    const caret = input.length === 0 ? quotedBlock.length : quotedBlock.length + 1;
    setInput(newValue);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
      updateQuoteButtonActive(newValue, caret);
    });
  };

  const chatSelectionToolbar = useFloatingSelectionToolbar({
    containerRef: chatMessagesRef,
    resubscribeKey: channel?.id,
    getSelectionInfo: () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (!chatMessagesRef.current?.contains(range.commonAncestorContainer)) return null;
      const text = sel.toString();
      if (text.trim().length === 0) return null;
      const rect = range.getBoundingClientRect();
      return { text, x: rect.right, y: rect.bottom + 8 };
    },
    onConfirm: (text) => {
      insertQuoteIntoCompose(text);
      window.getSelection()?.removeAllRanges();
    },
  });
```

`getSelectionInfo` here ignores the `MouseEvent` parameter the hook's type declares — a callback with fewer declared parameters than the caller passes is valid in TypeScript, and it's exactly `noUnusedParameters`-clean since the parameter is never *named*, not merely unused. Positioning uses `Range.getBoundingClientRect()` (works because the chat message list is regular DOM, unlike a `<textarea>`) instead of the mouse-event coordinates the two `<textarea>` usages rely on. `insertQuoteIntoCompose` always prepends to `input` (the compose field) regardless of `editingId` — there's no branch on edit state here, satisfying the "quoting from chat always targets compose" constraint by construction, since this function never touches `editValue`/`editInputRef` at all. Deduplicates `"> "` per line (a selection that already includes quoted text from the original message won't get double-prefixed), and reuses the existing `updateQuoteButtonActive` (defined before Task 1's changes, unaffected by them) to keep the toolbar button's highlight state correct after the insert — the caret lands right after the inserted block, which is the last quoted line when the draft was empty, or the first character of the (unrelated, possibly-unquoted) pre-existing draft otherwise, so the highlight must be recomputed rather than hardcoded.

- [ ] **Step 3: Render the button**

In `client/src/components/ChatArea.tsx`, find the block from Task 3 Step 2:

```tsx
      {editSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={editSelectionToolbar.x}
          y={editSelectionToolbar.y}
          onConfirm={editSelectionToolbar.confirm}
        />
      )}
    </main>
  );
```

Replace with:

```tsx
      {editSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={editSelectionToolbar.x}
          y={editSelectionToolbar.y}
          onConfirm={editSelectionToolbar.confirm}
        />
      )}
      {chatSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={chatSelectionToolbar.x}
          y={chatSelectionToolbar.y}
          onConfirm={chatSelectionToolbar.confirm}
        />
      )}
    </main>
  );
```

- [ ] **Step 4: Type-check and build**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
cd client && npm run build:vite
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manual verification**

Open `http://localhost:5173`, log in, open a channel with at least two or three sent messages (send some test messages from the UI if needed):

- Select text inside one message (drag across a few words) — the floating "Цитата" button appears near the end of the selection.
- Click it — the selected text appears at the **start** of the compose field with `"> "` prepended, caret lands right after it, textarea is focused. If the compose field had unsent draft text, confirm it's still there, now pushed below the inserted quote block, separated by one line break.
- Send the message — confirm it renders as a quote block (existing per-line grouping) followed by whatever plain text was in the draft.
- Repeat with the compose field completely empty beforehand — confirm no stray leading/trailing blank line in the sent message.
- Select text spanning **two consecutive messages** (drag from inside one message's text into the next one's) — click the button — confirm all captured lines get `"> "` (some content from each message).
- Select an already-quoted portion of an existing message (a message that itself starts with `"> "`) — click the button — confirm the inserted text does **not** get a doubled `"> > "` prefix.
- Start editing one of your own messages (pencil icon), then, without touching the edit field, select text in a *different* message in the list and click the floating "Цитата" button there — confirm the quoted text lands in the **compose** field (not the open edit field), and the edit-in-progress is untouched.
- Click outside any selection, or press `Escape` after selecting — button disappears without inserting anything.
- Scroll the message list while the button is visible — button disappears.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ChatArea.tsx
git commit -m "feat(chat): quote selected chat text into compose via floating button"
```
