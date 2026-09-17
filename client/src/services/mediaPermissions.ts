import type { ElectronAPI, MediaAccessStatusResult } from '@/types/electron';

export interface DeniedMediaKinds {
  cameraDenied: boolean;
  microphoneDenied: boolean;
}

const DENIED_STATUSES = new Set<MediaAccessStatusResult['camera']>(['denied', 'restricted']);

const NOTHING_DENIED: DeniedMediaKinds = { cameraDenied: false, microphoneDenied: false };

/**
 * Pre-flight macOS TCC check, run before getUserMedia. On any build without
 * the IPC bridge (web build, pre-this-feature client, non-macOS) there's no
 * equivalent gate to check, so this resolves to "nothing denied" rather than
 * blocking the caller.
 */
export async function getDeniedMediaKinds(
  api: Pick<ElectronAPI, 'getMediaAccessStatus'> | undefined,
): Promise<DeniedMediaKinds> {
  if (!api?.getMediaAccessStatus) return NOTHING_DENIED;
  try {
    const status = await api.getMediaAccessStatus();
    return {
      cameraDenied: DENIED_STATUSES.has(status.camera),
      microphoneDenied: DENIED_STATUSES.has(status.microphone),
    };
  } catch {
    return NOTHING_DENIED;
  }
}
