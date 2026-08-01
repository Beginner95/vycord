import { useMemo, useState, type RefObject, type ChangeEvent, type KeyboardEvent } from 'react';
import type { MemberWithUser } from '@/types';
import { LEGACY_ROLE_KEYS, type LegacyMentionRole } from '@/utils/mentions';
import { useT } from '@/i18n';

export type MentionEntry =
  | { kind: 'user'; id: string; label: string }
  | { kind: 'role'; role: LegacyMentionRole; label: string }
  | { kind: 'everyone'; label: string };

interface UseMentionAutocompleteArgs {
  value: string;
  setValue: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  members: MemberWithUser[];
  canMentionEveryone: boolean;
}

export function useMentionAutocomplete({
  value,
  setValue,
  inputRef,
  members,
  canMentionEveryone,
}: UseMentionAutocompleteArgs) {
  const t = useT();
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const mentionEntries: MentionEntry[] = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const entries: MentionEntry[] = [];

    for (const m of members) {
      if (m.username.toLowerCase().includes(q)) {
        entries.push({ kind: 'user', id: m.user_id, label: m.username });
      }
    }

    const roleEntries: Array<{ role: LegacyMentionRole; label: string }> = [
      { role: 'owner', label: t(LEGACY_ROLE_KEYS.owner) },
      { role: 'admin', label: t(LEGACY_ROLE_KEYS.admin) },
      { role: 'member', label: t(LEGACY_ROLE_KEYS.member) },
    ];
    for (const r of roleEntries) {
      if (r.label.toLowerCase().includes(q) || r.role.includes(q)) {
        entries.push({ kind: 'role', role: r.role, label: r.label });
      }
    }

    if (canMentionEveryone && 'everyone'.includes(q)) {
      entries.push({ kind: 'everyone', label: 'everyone' });
    }

    return entries;
  }, [mentionQuery, members, canMentionEveryone, t]);

  const reset = () => {
    setMentionQuery(null);
    setMentionIndex(0);
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setValue(val);

    const caret = e.target.selectionStart ?? val.length;
    const upToCaret = val.slice(0, caret);
    const atIndex = upToCaret.lastIndexOf('@');
    if (atIndex === -1 || /\s/.test(upToCaret.slice(atIndex + 1))) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(upToCaret.slice(atIndex + 1));
    setMentionIndex(0);
  };

  const selectEntry = (entry: MentionEntry) => {
    const caret = inputRef.current?.selectionStart ?? value.length;
    const upToCaret = value.slice(0, caret);
    const atIndex = upToCaret.lastIndexOf('@');
    if (atIndex === -1) return;

    const token =
      entry.kind === 'user' ? `<@${entry.id}>` :
      entry.kind === 'role' ? `<@&${entry.role}>` :
      '@everyone';

    const before = value.slice(0, atIndex);
    const after = value.slice(caret);
    setValue(`${before}${token} ${after}`);
    setMentionQuery(null);

    requestAnimationFrame(() => {
      const pos = before.length + token.length + 1;
      inputRef.current?.setSelectionRange(pos, pos);
      inputRef.current?.focus();
    });
  };

  // Возвращает true, если клавиша обработана навигацией по дропдауну (вызывающий должен остановиться и не выполнять свою логику Enter/Escape).
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (mentionQuery === null || mentionEntries.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % mentionEntries.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + mentionEntries.length) % mentionEntries.length);
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      selectEntry(mentionEntries[mentionIndex]);
      return true;
    }
    if (e.key === 'Escape') {
      setMentionQuery(null);
      return true;
    }
    return false;
  };

  const entryKey = (entry: MentionEntry) =>
    entry.kind === 'user' ? entry.id : entry.kind === 'role' ? entry.role : 'everyone';

  return { mentionQuery, mentionIndex, mentionEntries, handleChange, handleKeyDown, selectEntry, reset, entryKey };
}
