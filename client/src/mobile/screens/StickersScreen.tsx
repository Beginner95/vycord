import { useState } from 'react';
import type { Sticker } from '@/types';
import { useT } from '@/i18n';
import { FormScreen } from '@/mobile/components/FormScreen';
import { ConfirmModal } from '@/components/ConfirmModal';
import { StickerManagerBody } from '@/components/StickerManagerBody';
import { useServerStickers } from '@/components/useServerStickers';
import './StickersScreen.css';

/** Стикеры сервера (спека §5.9, решение D5 плана этапа 2). Нижней кнопки нет:
 *  «Загрузить» живёт в инлайновом блоке превью тела и появляется, когда выбран
 *  файл. Drag&drop на таче недостижим — клик по дропзоне открывает выбор файла.
 *  Подтверждение удаления рисует сам экран (тело его не знает), рядом с
 *  FormScreen, а не в нём: оверлей — не потомок прокручиваемого тела. */
export function StickersScreen({ serverId, onBack, onStickersChanged }: {
  serverId: string;
  onBack: () => void;
  onStickersChanged?: () => void;
}) {
  const t = useT();
  const manager = useServerStickers(serverId, onStickersChanged);
  // Стикер целиком, а не id: заголовок подтверждения подставляет его имя.
  const [pendingDelete, setPendingDelete] = useState<Sticker | null>(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const sticker = pendingDelete;
    setPendingDelete(null);
    void manager.remove(sticker);
  };

  return (
    <>
      <FormScreen title={t('chat.manageStickersTitle')} onBack={onBack}>
        <div className="stickers-screen">
          <StickerManagerBody manager={manager} onRequestDelete={setPendingDelete} />
        </div>
      </FormScreen>
      <ConfirmModal
        open={pendingDelete !== null}
        title={t('chat.deleteStickerTitle', { name: pendingDelete?.name ?? '' })}
        body={t('chat.deleteStickerBody')}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
