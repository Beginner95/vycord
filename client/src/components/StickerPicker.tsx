import { useT } from '@/i18n';
import type { Sticker } from '@/types';
import { resolveUploadUrl } from '@/services/api';
import './StickerPicker.css';

interface StickerPickerProps {
  stickers: Sticker[];
  onSelect: (s: Sticker) => void;
  onClose: () => void;
  onManage?: () => void;
}

export function StickerPicker({ stickers, onSelect, onManage }: StickerPickerProps) {
  const t = useT();
  return (
    <div className="sticker-picker" role="dialog">
      <div className="sticker-picker-grid">
        {stickers.length === 0 ? (
          <div className="sticker-picker-empty">{t('chat.noStickers')}</div>
        ) : (
          stickers.map((s) => (
            <button key={s.id} type="button" className="sticker-picker-cell" onClick={() => onSelect(s)}>
              <img src={resolveUploadUrl(s.image_url)} alt={s.name} />
            </button>
          ))
        )}
      </div>
      {onManage && (
        <button type="button" className="sticker-picker-manage-btn" onClick={onManage}>
          {t('chat.manageStickers')}
        </button>
      )}
    </div>
  );
}