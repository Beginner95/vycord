export type MentionToken =
  | { type: 'text'; value: string }
  | { type: 'user'; value: string }
  | { type: 'role'; value: 'owner' | 'admin' | 'member' }
  | { type: 'everyone'; value: string };

const MENTION_RE = /<@([0-9a-fA-F-]{36})>|<@&(owner|admin|member)>|@everyone/g;

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  admin: 'Админ',
  member: 'Участник',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

// tokenizeMentions разбивает текст сообщения на обычный текст и токены
// упоминаний — тот же формат, что парсит бэкенд (server/internal/usecase/mentions.go),
// но здесь также извлекаются токены ролей (<@&role>) для рендера, т.к. они
// не требуют серверной валидации.
export function tokenizeMentions(content: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }
    if (match[1]) {
      tokens.push({ type: 'user', value: match[1] });
    } else if (match[2]) {
      tokens.push({ type: 'role', value: match[2] as 'owner' | 'admin' | 'member' });
    } else {
      tokens.push({ type: 'everyone', value: '@everyone' });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    tokens.push({ type: 'text', value: content.slice(lastIndex) });
  }
  return tokens;
}
