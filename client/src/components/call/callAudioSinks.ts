// Реестр <audio> внешнего хоста звука звонка (мобильный CallAudioHost) для
// переключения устройства вывода. CallStageModel.applySinkId перебирает свои
// <video> и вдобавок зовёт applySinkToCallAudio — так кнопка динамика экрана
// звонка достаёт и элементы хоста, которые живут вне этого экрана. На десктопе
// хоста нет, реестр пуст, и вызов ничего не меняет.

type SinkElement = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

const elements = new Set<SinkElement>();
// Последнее выбранное устройство: элемент, появившийся после переключения
// (новый участник), должен звучать туда же, а не в устройство по умолчанию.
let currentSinkId: string | null = null;

function applyTo(el: SinkElement, deviceId: string): void {
  el.setSinkId?.(deviceId).catch(() => {});
}

/** Регистрирует элемент; возвращает функцию снятия с учёта. */
export function registerCallAudioElement(el: HTMLMediaElement): () => void {
  const sinkEl = el as SinkElement;
  elements.add(sinkEl);
  if (currentSinkId !== null) applyTo(sinkEl, currentSinkId);
  return () => { elements.delete(sinkEl); };
}

export function applySinkToCallAudio(deviceId: string): void {
  currentSinkId = deviceId;
  for (const el of elements) applyTo(el, deviceId);
}

/** Сброс выбора по окончании звонка: следующий звонок начинается с устройства по умолчанию. */
export function resetCallAudioSink(): void {
  currentSinkId = null;
}
