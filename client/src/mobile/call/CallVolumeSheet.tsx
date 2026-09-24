import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import type { CallStageModel } from '@/components/useCallStageModel';
import { useT } from '@/i18n';
import './CallVolumeSheet.css';

interface CallVolumeSheetProps {
  open: boolean;
  onClose: () => void;
  m: CallStageModel;
}

/** Слайдер громкости на каждого участника: простой список, не поповер над
 *  одной кнопкой (в отличие от десктопного `VolumeControlPopover`) — на
 *  мобиле нет отдельной кнопки на плитку, откуда его было бы открыть. */
export function CallVolumeSheet({ open, onClose, m }: CallVolumeSheetProps) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('mobile.callVolumeAction')}>
      <div className="call-volume-sheet-body">
        {m.participants.length === 0 && <p className="call-volume-sheet-empty">{t('mobile.callVolumeEmpty')}</p>}
        {m.participants.map((p) => (
          <div key={p.userId} className="call-volume-sheet-row">
            <span className="call-volume-sheet-name">{m.nameFor(p.userId)}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={m.participantVolumes[p.userId] ?? 100}
              aria-label={t('call.participantVolume')}
              onChange={(e) => m.onVolumeChange(p.userId, Number(e.target.value))}
            />
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
