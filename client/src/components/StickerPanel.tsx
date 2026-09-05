import { useRef, useState } from 'react';
import { Clock, Settings2, Sticker as StickerIcon } from 'lucide-react';
import {
  useExpressionRecentsStore,
  topStickers,
  FREQUENT_STICKER_LIMIT,
} from '@/stores/expressionRecentsStore';
import { resolveUploadUrl } from '@/services/api';
import { useT } from '@/i18n';
import type { Sticker } from '@/types';

export interface StickerPanelProps {
  serverId: string;
  items: Sticker[];
  /** Резолвится в true при успехе; при неудаче панель остаётся открытой. */
  onSend: (s: Sticker) => Promise<boolean>;
  onManage?: () => void;
}

const FREQUENT_ID = 'frequent';
const ALL_ID = 'all';

export function StickerPanel({ serverId, items, onSend, onManage }: StickerPanelProps) {
  const t = useT();
  const recordSticker = useExpressionRecentsStore((s) => s.recordSticker);

  // Снимок на момент открытия, как в EmojiPanel: плитка не должна уезжать
  // из-под курсора. Хранятся id — резолвим их по живому списку и МОЛЧА
  // выбрасываем промахи, иначе удалённый стикер даёт битую картинку.
  const [frequentIds] = useState(() =>
    topStickers(useExpressionRecentsStore.getState(), serverId, FREQUENT_STICKER_LIMIT),
  );
  const byId = new Map(items.map((s) => [s.id, s]));
  const frequent = frequentIds.map((id) => byId.get(id)).filter((s): s is Sticker => !!s);

  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState(frequent.length ? FREQUENT_ID : ALL_ID);

  const jumpTo = (id: string) => {
    setActive(id);
    sectionRefs.current.get(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const choose = (s: Sticker) => {
    void onSend(s).then((ok) => { if (ok) recordSticker(serverId, s.id); });
  };

  const section = (id: string, title: string, list: Sticker[]) => (
    <section
      key={id}
      className="expression-section"
      ref={(el) => {
        if (el) sectionRefs.current.set(id, el);
        else sectionRefs.current.delete(id);
      }}
    >
      <h3 className="expression-section-title">{title}</h3>
      <div className="expression-sticker-grid">
        {list.map((s) => (
          <button
            key={`${id}-${s.id}`}
            type="button"
            className="expression-sticker-cell"
            onClick={() => choose(s)}
          >
            <img src={resolveUploadUrl(s.image_url)} alt={s.name} />
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <>
      <div className="expression-picker-body">
        {items.length === 0 ? (
          <div className="expression-sticker-empty">{t('chat.noStickers')}</div>
        ) : (
          <>
            {frequent.length > 0 && section(FREQUENT_ID, t('chat.frequentlyUsed'), frequent)}
            {section(ALL_ID, t('chat.stickers'), items)}
          </>
        )}
      </div>
      <div className="expression-picker-anchors">
        {frequent.length > 0 && (
          <button
            type="button"
            className={`expression-picker-anchor${active === FREQUENT_ID ? ' is-active' : ''}`}
            onClick={() => jumpTo(FREQUENT_ID)}
            title={t('chat.frequentlyUsed')}
            aria-label={t('chat.frequentlyUsed')}
          >
            <Clock size={15} strokeWidth={1.8} />
          </button>
        )}
        <button
          type="button"
          className={`expression-picker-anchor${active === ALL_ID ? ' is-active' : ''}`}
          onClick={() => jumpTo(ALL_ID)}
          title={t('chat.stickers')}
          aria-label={t('chat.stickers')}
        >
          <StickerIcon size={15} strokeWidth={1.8} />
        </button>
        {onManage && (
          // Не полноширинный футер, как было у .sticker-picker: в общей полосе
          // высота панели одинакова на всех вкладках.
          <button
            type="button"
            className="expression-picker-anchor expression-picker-manage"
            onClick={onManage}
            title={t('chat.manageStickers')}
            aria-label={t('chat.manageStickers')}
          >
            <Settings2 size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </>
  );
}
