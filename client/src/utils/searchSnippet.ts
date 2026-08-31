/** Обрезает длинный текст окном вокруг первого совпадения. */
export function snippetAround(content: string, query: string, radius = 80): string {
  if (content.length <= radius * 2) return content;
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return `${content.slice(0, radius * 2)}…`;
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + query.length + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

/** Режет текст на совпавшие/несовпавшие куски. Пустой запрос — единственный
 *  вход, на котором прежний цикл в MessageSearch не продвигался (indexOf('')
 *  возвращает pos) и вешал вкладку; здесь он отсекается явно. */
export function splitMatches(text: string, query: string): SnippetPart[] {
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: SnippetPart[] = [];
  let pos = 0;
  for (;;) {
    const idx = lower.indexOf(q, pos);
    if (idx === -1) break;
    if (idx > pos) parts.push({ text: text.slice(pos, idx), match: false });
    parts.push({ text: text.slice(idx, idx + q.length), match: true });
    pos = idx + q.length;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false });
  return parts;
}
