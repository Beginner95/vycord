import { Radio, Users, MonitorUp, Volume2 } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import type { CallStageModel } from '@/components/useCallStageModel';
import { useT } from '@/i18n';

export type CallOverflowSub = 'quality' | 'volume' | 'guests' | 'screenQuality' | null;

const CAN_SHARE = typeof navigator !== 'undefined' && 'getDisplayMedia' in (navigator.mediaDevices ?? {});

/**
 * Пункты «⋯»-шторки мобильной сцены звонка (`CallOverflowSheets`). По
 * образцу `useServerMenuItems`/`useChannelMenuItems` этапа 2: строит
 * `ContextMenuItem[]` из модели звонка + локального состояния «какая
 * подшторка открыта» (передаётся вызывающим как `onOpenSub`).
 *
 * Файл — `.tsx`, не `.ts`: содержит JSX (иконки пунктов), а `tsc` парсит JSX
 * только в файлах с этим расширением (см. `jsx: "react-jsx"` в tsconfig и
 * house style — `useServerMenuItems.tsx`/`useChannelMenuItems.tsx` этапа 2
 * тоже `.tsx` по той же причине).
 *
 * «Гости» показывается, если приглашать может текущий участник
 * (`guestLinksEnabled && !isGuestMode`), ИЛИ если в канале уже есть гости
 * (`guestsPresent`, из `useGuestManagementStore.channelGuests`) — гость,
 * которого выгоняют, не должен зависеть от того, разрешены ли ссылки прямо
 * сейчас.
 *
 * «Демонстрация экрана» — только если платформа умеет `getDisplayMedia`.
 * Начать демонстрацию на мобиле = выбрать качество (`onOpenSub('screenQuality')`,
 * а `handleSelectQuality` из модели дальше сама вызывает
 * `groupCallService.startScreenShare()` → `getDisplayMedia` → системный
 * пикер); остановить — сразу `handleToggleScreenShare()`, без подшторки.
 */
export function useCallOverflowItems(
  m: Pick<CallStageModel, 'guestLinksEnabled' | 'isGuestMode' | 'isScreenSharing' | 'handleToggleScreenShare'>,
  guestsPresent: boolean,
  onOpenSub: (sub: CallOverflowSub) => void,
): ContextMenuItem[] {
  const t = useT();
  const items: ContextMenuItem[] = [
    { label: t('call.qualityDetails'), icon: <Radio size={18} strokeWidth={1.8} />, onClick: () => onOpenSub('quality') },
    { label: t('mobile.callVolumeAction'), icon: <Volume2 size={18} strokeWidth={1.8} />, onClick: () => onOpenSub('volume') },
  ];
  if ((m.guestLinksEnabled && !m.isGuestMode) || guestsPresent) {
    items.push({ label: t('call.ctlGuests'), icon: <Users size={18} strokeWidth={1.8} />, onClick: () => onOpenSub('guests') });
  }
  if (CAN_SHARE) {
    items.push({
      label: m.isScreenSharing ? t('call.stopScreenShare') : t('call.shareScreen'),
      icon: <MonitorUp size={18} strokeWidth={1.8} />,
      onClick: () => { if (m.isScreenSharing) void m.handleToggleScreenShare(); else onOpenSub('screenQuality'); },
    });
  }
  return items;
}
