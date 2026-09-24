import { Image, File as FileIcon } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { useT } from '@/i18n';

interface Props {
  onClose: () => void;
  onPickFiles: (accept: string) => void;
}

/** Шторка скрепки: только вложения. Эмодзи/стикеры — отдельная кнопка композера. */
export function MobileAttachSheet({ onClose, onPickFiles }: Props) {
  const t = useT();
  const ic = (I: typeof Image) => <I size={20} strokeWidth={1.8} />;
  const items: ContextMenuItem[] = [
    { label: t('mobile.attachMedia'), icon: ic(Image), onClick: () => onPickFiles('image/*,video/*') },
    { label: t('mobile.attachFile'), icon: ic(FileIcon), onClick: () => onPickFiles('') },
  ];
  return <ActionSheet open onClose={onClose} title={t('mobile.composerAttach')} items={items} />;
}
