import { useMediaDeviceStore } from '@/stores/mediaDeviceStore';

// Констрейнты микрофона переехали сюда из groupCall.ts (исторический багаж:
// - channelCount ideal:1 → Opus mono, защита от macOS stereo-кетчеров pion;
// - sampleRate ideal:48000 → Opus native, без ресемплинга на Android).
const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function withExactDevice(
  constraints: MediaTrackConstraints,
  kind: 'audioinput' | 'videoinput',
): MediaTrackConstraints {
  const id = useMediaDeviceStore.getState().selected[kind];
  return id ? { ...constraints, deviceId: { exact: id } } : constraints;
}

/** Микрофон: базовая цепочка + deviceId выбранного устройства (если выбран). */
export function buildMicConstraints(): MediaTrackConstraints {
  return withExactDevice(MIC_AUDIO_CONSTRAINTS, 'audioinput');
}

/** Камера: пустые constraints либо deviceId выбранной камеры. */
export function buildCameraConstraints(): MediaTrackConstraints {
  return withExactDevice({}, 'videoinput');
}

/**
 * Получение локального потока с учётом выбранных устройств. Если выбранное
 * устройство недоступно/занято, цепочка деградирует к системным дефолтам и
 * в самом конце — к звонку без локальных медиа. Не бросает.
 */
export async function acquireUserMedia(): Promise<MediaStream | null> {
  const mic = buildMicConstraints();
  const cam = buildCameraConstraints();
  const { selected } = useMediaDeviceStore.getState();
  const hasSelection = selected.audioinput !== '' || selected.videoinput !== '';
  const attempts: MediaStreamConstraints[] = hasSelection
    ? [
        { audio: mic, video: cam },
        { audio: mic, video: false },
        { audio: true, video: true },
        { audio: true, video: false },
        { audio: false, video: true },
      ]
    : [
        { audio: mic, video: cam },
        { audio: mic, video: false },
        { audio: false, video: true },
      ];
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      // Пробуем следующую комбинацию.
    }
  }
  return null;
}
