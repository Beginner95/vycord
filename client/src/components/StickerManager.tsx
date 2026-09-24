import { useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import type { Sticker } from '@/types';
import { ConfirmModal } from '@/components/ConfirmModal';
import { StickerManagerBody } from '@/components/StickerManagerBody';
import { useServerStickers } from '@/components/useServerStickers';
import './StickerManager.css';

interface StickerManagerProps {
  serverId: string;
  onClose: () => void;
  onStickersChanged?: () => void;
}

export function StickerManager({ serverId, onClose, onStickersChanged }: StickerManagerProps) {
  const t = useT();
  const manager = useServerStickers(serverId, onStickersChanged);
  // Храним стикер целиком, а не id: заголовок подтверждения подставляет его имя.
  const [confirmDelete, setConfirmDelete] = useState<Sticker | null>(null);

  const handleDelete = (sticker: Sticker) => {
    setConfirmDelete(null);
    void manager.remove(sticker);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sticker-manager" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{t('chat.manageStickersTitle')}</h2>
          <button
            type="button"
            className="modal-close-btn"
            title={t('common.close')}
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <StickerManagerBody manager={manager} onRequestDelete={setConfirmDelete} />
      </div>

      {
        // Сестра .sticker-manager внутри оверлея, а не её потомок — тот же приём,
        // что и у ConfirmModal в Settings.tsx: только так клик по фону
        // подтверждения действительно доходит до onClick={onClose} этого оверлея
        // и e.stopPropagation() в ConfirmModal проверяется по-настоящему.
        // Внутри .sticker-manager его гасил бы её собственный stopPropagation.
        //
        // Строчные //, а не блочный /* */: stripComments в check-i18n.mjs
        // вырезает только // и ОДНОСТРОЧНЫЕ /* */, так что многострочный блок —
        // структурная слепая зона (CONSTRAINTS §5). Это гигиена по ФОРМЕ, а не
        // починка реальной находки: конкретно этот текст эвристика не ловит ни
        // в каком виде — ни одна строка не содержит ни голого >текста<, ни
        // placeholder|title|aria-label|alt="…", ни alert(/confirm(. Проверено
        // эмпирически на ревью M4 T9: прежний /* */-блок вернули в дерево и
        // прогнали check:i18n — те же 4 предупреждения ErrorBoundary, ноль
        // новых. T10 ведёт этот гейт к нулю, поэтому форму чистим заранее.
      }
      <ConfirmModal
        open={confirmDelete !== null}
        title={t('chat.deleteStickerTitle', { name: confirmDelete?.name ?? '' })}
        body={t('chat.deleteStickerBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => { if (confirmDelete) handleDelete(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
