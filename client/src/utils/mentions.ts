import type { TKey } from '@/i18n';
import type { MemberWithUser } from '@/types';

/** Роли из старой системы: встречаются в исторических сообщениях как <@&owner>. */
export type LegacyMentionRole = 'owner' | 'admin' | 'member';

export type MentionToken =
  | { type: 'text'; value: string }
  | { type: 'user'; value: string }
  | { type: 'role'; value: LegacyMentionRole }
  | { type: 'everyone'; value: string };

const MENTION_RE = /<@([0-9a-fA-F-]{36})>|<@&(owner|admin|member)>|@everyone/g;

/** Метки ролей старой системы — ключи словаря, переводятся в точке рендера. */
export const LEGACY_ROLE_KEYS: Record<LegacyMentionRole, TKey> = {
  owner: 'chat.legacyRoleOwner',
  admin: 'chat.legacyRoleAdmin',
  member: 'chat.legacyRoleMember',
};

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
      tokens.push({ type: 'role', value: match[2] as LegacyMentionRole });
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

// A plain <textarea> has one editable string — it can't show "@username"
// while secretly holding "<@uuid>" the way the rendered message can. These
// two functions move a draft across that boundary: display form in the
// input the user edits, wire form (what the backend's own mention regex in
// server/internal/usecase/mentions.go parses) everywhere else.

/** Wire (`<@uuid>`) -> display (`@username`) for loading a draft into an editable field. */
export function toDisplayMentions(content: string, members: MemberWithUser[]): string {
  return tokenizeMentions(content)
    .map((token) => {
      switch (token.type) {
        case 'text':
          return token.value;
        case 'role':
          return `<@&${token.value}>`;
        case 'everyone':
          return token.value;
        case 'user': {
          const member = members.find((m) => m.user_id === token.value);
          return member ? `@${member.username}` : `<@${token.value}>`;
        }
      }
    })
    .join('');
}

/** Display (`@username`) -> wire (`<@uuid>`) for the text a draft actually sends. */
export function toWireMentions(content: string, members: MemberWithUser[]): string {
  return content.replace(/@(\S+)/g, (match, name: string) => {
    const member = members.find((m) => m.username === name);
    return member ? `<@${member.user_id}>` : match;
  });
}
