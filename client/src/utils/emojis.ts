import type { TKey } from '@/i18n';

export interface EmojiCategory {
  id: string;
  /** Ключ словаря, а не текст: заголовки секций видны пользователю. */
  labelKey: TKey;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: 'smileys', labelKey: 'chat.emojiCategory.smileys', emojis: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😜', '🤪', '🤔', '😎', '🤩', '🥳', '😭', '😡', '😱', '🥺', '😴', '🤯', '🥱'] },
  { id: 'gestures', labelKey: 'chat.emojiCategory.gestures', emojis: ['👋', '🤚', '🖐️', '✋', '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '🙏', '🤝', '💪', '👈', '👉', '☝️', '👇'] },
  { id: 'animals', labelKey: 'chat.emojiCategory.animals', emojis: ['🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦄', '🐝', '🐢', '🐙', '🦋'] },
  { id: 'food', labelKey: 'chat.emojiCategory.food', emojis: ['🍎', '🍌', '🍓', '🍉', '🍇', '🍕', '🍔', '🍟', '🌭', '🍿', '🍩', '🍪', '🎂', '🍰', '🍫', '☕', '🍺', '🥤', '🍦', '🥟'] },
  { id: 'activities', labelKey: 'chat.emojiCategory.activities', emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🎳', '🏆', '🥇', '🎮', '🎲', '🎯', '🎸', '🎹', '🎤', '🎧', '🎬', '✈️', '🚗', '🚀', '🏠'] },
  { id: 'objects', labelKey: 'chat.emojiCategory.objects', emojis: ['💡', '🔑', '📱', '💻', '🖥️', '⌚', '📷', '🎥', '📝', '📚', '✏️', '🖊️', '📌', '📎', '🔒', '🔨', '🎁', '💊', '🧲', '🛒'] },
  { id: 'symbols', labelKey: 'chat.emojiCategory.symbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💯', '❗', '❓', '❗', '⭐', '✨', '🔥', '💤', '💢', '💥', '✅', '❌'] },
];
