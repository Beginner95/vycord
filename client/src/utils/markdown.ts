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
