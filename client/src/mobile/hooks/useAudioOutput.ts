import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';

const SUPPORTED = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/**
 * Циклический переключатель устройства вывода звука (D7): нет отдельного
 * выпадающего списка на мобиле — кнопка «⋯»/иконка динамика просто идёт по
 * кругу по доступным audiooutput-устройствам и применяет `setSinkId` через
 * переданный `applySinkId` (см. `CallStageModel.applySinkId`, T2).
 *
 * `supported` требует хотя бы двух устройств: с одним циклический
 * переключатель бессмыслен, кнопка скрывается так же, как при отсутствии
 * `setSinkId` в браузере.
 */
export function useAudioOutput(applySinkId: (deviceId: string) => void) {
  const t = useT();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [index, setIndex] = useState(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    if (!SUPPORTED || !navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    if (!mounted.current) return;
    setDevices(all.filter((d) => d.kind === 'audiooutput'));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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
