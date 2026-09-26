import { useCallback, useState } from 'react';
import { useT } from '@/i18n';
import { useMediaDeviceStore } from '@/stores/mediaDeviceStore';

const SUPPORTED = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/**
 * Циклический переключатель устройства вывода звука (D7): нет отдельного
 * выпадающего списка на мобиле — кнопка «⋯»/иконка динамика просто идёт по
 * кругу по доступным audiooutput-устройствам и применяет `setSinkId` через
 * переданный `applySinkId` (см. `CallStageModel.applySinkId`, T2).
 *
 * Список устройств читается из mediaDeviceStore — тот же источник, что у
 * настроек: псевдоустройства default/communications отфильтрованы, обновление
 * по devicechange делает вотчер стора.
 *
 * `supported` требует хотя бы двух устройств: с одним циклический
 * переключатель бессмыслен, кнопка скрывается так же, как при отсутствии
 * `setSinkId` в браузере.
 */
export function useAudioOutput(applySinkId: (deviceId: string) => void) {
  const t = useT();
  const devices = useMediaDeviceStore((s) => s.devices.audiooutput);
  const [index, setIndex] = useState(0);

  const cycle = useCallback(() => {
    if (devices.length === 0) return;
    const next = (index + 1) % devices.length;
    setIndex(next);
    applySinkId(devices[next].deviceId);
  }, [devices, index, applySinkId]);

  const current = devices[index];
  const currentLabel = current?.label || t('call.speakerDefault');

  return { supported: SUPPORTED && devices.length > 1, cycle, currentLabel };
}
