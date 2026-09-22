import { useEffect, useState } from 'react';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { CallQualitySheet } from './CallQualitySheet';
import { CallVolumeSheet } from './CallVolumeSheet';
import { MobileGuestSheet } from './MobileGuestSheet';
import { MobileScreenQualitySheet } from './MobileScreenQualitySheet';
import { useCallOverflowItems, type CallOverflowSub } from './useCallOverflowItems';
import type { CallStageModel } from '@/components/useCallStageModel';
import { useT } from '@/i18n';

interface CallOverflowSheetsProps {
  open: boolean;
  onClose: () => void;
  model: CallStageModel;
  guestsPresent: boolean;
  // D6: тап по индикатору качества в шапке (MobileCallScreen's onOpenQuality)
  // должен открывать CallQualitySheet напрямую, а не список «⋯». Only read
  // on the open:false→true transition (see the effect below) — the sheet
  // stays mounted across opens, so this can't just be an initial useState.
  initialSub?: CallOverflowSub;
}

/**
 * «⋯»-шторка мобильной сцены звонка и все её подшторки. Живёт рядом с
 * `MobileCallScreen`, не внутри него — экран сам не знает про шторки
 * (зеркалит `ChatScreen`+`MessageActionsSheet` этапа 3, T7 рендерит это как
 * соседа `MobileCallScreen` внутри `renderScreen`'а обёртки экрана `call`).
 *
 * `sub` держит, какая подшторка открыта; закрытие любой подшторки
 * (`closeAll`) закрывает и верхний `ActionSheet` — открывать его заново с
 * нуля дешевле, чем возвращаться в список пунктов после действия.
 */
export function CallOverflowSheets({ open, onClose, model: m, guestsPresent, initialSub }: CallOverflowSheetsProps) {
  const t = useT();
  const [sub, setSub] = useState<CallOverflowSub>(initialSub ?? null);
  // The component stays mounted across opens/closes (it's rendered whenever
  // overflowModel is non-null, not whenever open is true), so an initial
  // useState value alone only fires once, on first mount — a later open with
  // a different initialSub (quality → generic → quality again) would keep
  // stale state. Re-derive on every open:false→true transition instead.
  useEffect(() => {
    if (open) setSub(initialSub ?? null);
  }, [open, initialSub]);
  const items = useCallOverflowItems(m, guestsPresent, (s) => setSub(s));
  const closeAll = () => { setSub(null); onClose(); };

  return (
    <>
      <ActionSheet open={open && sub === null} onClose={onClose} title={t('mobile.callActions')} items={items} />
      <CallQualitySheet open={sub === 'quality'} onClose={closeAll} metrics={m.localQuality} />
      <CallVolumeSheet open={sub === 'volume'} onClose={closeAll} m={m} />
      {m.callChannelId && (
        <MobileGuestSheet open={sub === 'guests'} onClose={closeAll} channelId={m.callChannelId} />
      )}
      <MobileScreenQualitySheet
        open={sub === 'screenQuality'}
        onClose={closeAll}
        onSelect={(q) => { closeAll(); void m.handleSelectQuality(q); }}
      />
    </>
  );
}
