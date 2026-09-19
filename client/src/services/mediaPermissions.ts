import type { ElectronAPI, MediaAccessStatusResult } from '@/types/electron';

export interface DeniedMediaKinds {
  cameraDenied: boolean;
  microphoneDenied: boolean;
}

const DENIED_STATUSES = new Set<MediaAccessStatusResult['camera']>(['denied', 'restricted']);

const NOTHING_DENIED: DeniedMediaKinds = { cameraDenied: false, microphoneDenied: false };

/**
 * Pre-flight macOS TCC check, run before getUserMedia. Когда доступно
 * requestMediaAccess, сначала показывает системный запрос для ещё не решённых
 * камеры/микрофона. On any build without
 * the IPC bridge (web build, pre-this-feature client, non-macOS) there's no
 * equivalent gate to check, so this resolves to "nothing denied" rather than
 * blocking the caller.
 */
export async function getDeniedMediaKinds(
  api: Pick<ElectronAPI, 'getMediaAccessStatus' | 'requestMediaAccess'> | undefined,
): Promise<DeniedMediaKinds> {
  if (!api) return NOTHING_DENIED;
  try {
    let status: MediaAccessStatusResult | undefined;
    if (api.requestMediaAccess) {
      // Системный запрос TCC до getUserMedia; сбой IPC не должен блокировать звонок.
      status = await api.requestMediaAccess().catch(() => undefined);
    }
    if (!status && api.getMediaAccessStatus) {
      status = await api.getMediaAccessStatus();
    }
    if (!status) return NOTHING_DENIED;
    return {
      cameraDenied: DENIED_STATUSES.has(status.camera),
      microphoneDenied: DENIED_STATUSES.has(status.microphone),
    };
  } catch {
    return NOTHING_DENIED;
  }
}
