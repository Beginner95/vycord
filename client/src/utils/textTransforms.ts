export interface LineToggle {
  value: string;
  start: number;
  end: number;
  allPrefixed: boolean;
}

/**
 * A textarea whose value is React state. Structurally compatible with a React
 * `RefObject<HTMLTextAreaElement | null>` without importing React here — this
 * module stays a plain string/DOM utility.
 */
export interface TextareaTarget {
  ref: { current: HTMLTextAreaElement | null };
  value: string;
  setValue: (value: string) => void;
}

/**
 * Every editor surface (composer, message editor, and Task 7's Composer)
 * applies transforms the same way: read the live selection, run a pure
 * transform, push the result into React state, then restore focus and the
 * selection on the next frame — after React has re-rendered the textarea.
 */
function applyAndRestore(target: TextareaTarget, result: LineToggle) {
  const el = target.ref.current;
  if (!el) return;
  target.setValue(result.value);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(result.start, result.end);
  });
}

/** Run a line-level toggle (quote/bullet/numbered) over the current selection. */
export function applyLineToggle(
  target: TextareaTarget,
  fn: (value: string, start: number, end: number) => LineToggle,
) {
  const el = target.ref.current;
  if (!el) return;
  const start = el.selectionStart ?? target.value.length;
  const end = el.selectionEnd ?? target.value.length;
  applyAndRestore(target, fn(target.value, start, end));
}

/** Wrap (or unwrap) the current selection with `marker`. */
export function applyWrap(target: TextareaTarget, marker: string) {
  const el = target.ref.current;
  if (!el) return;
  const start = el.selectionStart ?? target.value.length;
  const end = el.selectionEnd ?? target.value.length;
  applyAndRestore(target, toggleWrap(target.value, start, end, marker));
}

/** Replace the current selection with `text`, leaving the caret after it. */
export function insertAtCaret(target: TextareaTarget, text: string) {
  const el = target.ref.current;
  if (!el) return;
  const start = el.selectionStart ?? target.value.length;
  const end = el.selectionEnd ?? target.value.length;
  const caret = start + text.length;
  applyAndRestore(target, {
    value: target.value.slice(0, start) + text + target.value.slice(end),
    start: caret,
    end: caret,
    allPrefixed: false,
  });
}

/** Markdown link token for `insertAtCaret`. Falls back to the URL as the label. */
export const linkToken = (label: string, url: string) => `[${label || url}](${url})`;

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
  addPrefix: (line: string, index: number) => string,
): LineToggle {
  const startIdx = lineStartIndex(value, start);
  const selEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const endIdx = lineEndIndex(value, selEnd, startIdx);
  const block = value.slice(startIdx, endIdx);
  const lines = block.split('\n');
  const allPrefixed = lines.every(isPrefixed);
  const finalLines = lines.map((line, i) =>
    allPrefixed ? removePrefix(line) : isPrefixed(line) ? line : addPrefix(line, i),
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
    (l, i) => `${i + 1}. ${l}`,
  );
