import { Image, File as FileIcon, Smile, Sticker } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { useT } from '@/i18n';

interface Props {
  onClose: () => void;
  onPickFiles: (accept: string) => void;
  onEmoji: () => void;
  /** undefined — стикеров нет (гость / нет обработчика). */
  onStickers?: () => void;
  /** Гость звонка: только текст и эмодзи. */
  textOnly: boolean;
}

export function MobileAttachSheet({ onClose, onPickFiles, onEmoji, onStickers, textOnly }: Props) {
  const t = useT();
  const ic = (I: typeof Image) => <I size={20} strokeWidth={1.8} />;
  const items: ContextMenuItem[] = [];
  if (!textOnly) {
    items.push({ label: t('mobile.attachMedia'), icon: ic(Image), onClick: () => onPickFiles('image/*,video/*') });
    items.push({ label: t('mobile.attachFile'), icon: ic(FileIcon), onClick: () => onPickFiles('') });
  }
  items.push({ label: t('mobile.attachEmoji'), icon: ic(Smile), onClick: onEmoji });
  if (!textOnly && onStickers) items.push({ label: t('mobile.attachStickers'), icon: ic(Sticker), onClick: onStickers });
  return <ActionSheet open onClose={onClose} title={t('mobile.composerPlus')} items={items} />;
}
