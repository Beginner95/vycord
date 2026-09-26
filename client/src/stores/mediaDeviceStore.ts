import { create } from 'zustand';

export const DEVICE_KINDS = ['audioinput', 'audiooutput', 'videoinput'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export type PermissionState = 'unknown' | 'granted' | 'denied';

const STORAGE_KEY = 'vycord_media_devices';

const EMPTY_SELECTED: Record<DeviceKind, string> = { audioinput: '', audiooutput: '', videoinput: '' };
const EMPTY_DEVICES: Record<DeviceKind, MediaDeviceInfo[]> = { audioinput: [], audiooutput: [], videoinput: [] };

// Псевдоустройства Chromium: им соответствует опция «Система по умолчанию» ('').
export function isRealDevice(d: MediaDeviceInfo): boolean {
  return d.deviceId !== 'default' && d.deviceId !== 'communications';
}

function loadSelected(): Record<DeviceKind, string> {
  const result = { ...EMPTY_SELECTED };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Partial<Record<DeviceKind, string>>;
    for (const kind of DEVICE_KINDS) {
      if (typeof parsed[kind] === 'string') result[kind] = parsed[kind];
    }
  } catch {
    // Невалидный JSON — молча начинаем с пустого выбора.
  }
  return result;
}

function persistSelected(selected: Record<DeviceKind, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
  } catch {
    // Storage недоступен (приватный режим и т.п.) — выбор живёт до перезагрузки.
  }
}

interface MediaDeviceState {
  devices: Record<DeviceKind, MediaDeviceInfo[]>;
  selected: Record<DeviceKind, string>;
  permissions: Record<DeviceKind, PermissionState>;
  ensurePermission: (kind: DeviceKind) => Promise<void>;
  refreshDevices: () => Promise<void>;
  setSelected: (kind: DeviceKind, deviceId: string) => void;
  prune: () => void;
}

export const useMediaDeviceStore = create<MediaDeviceState>((set, get) => ({
  devices: { ...EMPTY_DEVICES },
  selected: loadSelected(),
  permissions: { audioinput: 'unknown', audiooutput: 'unknown', videoinput: 'unknown' },

  ensurePermission: async (kind) => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    if (get().permissions[kind] === 'granted') {
      await get().refreshDevices();
      return;
    }
    const constraints: MediaStreamConstraints = kind === 'audioinput' ? { audio: true } : { video: true };
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      set((s) => ({ permissions: { ...s.permissions, [kind]: 'denied' } }));
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      set((s) => ({ permissions: { ...s.permissions, [kind]: 'granted' } }));
    }
    // Даже при отказе перечисляем: списки покажут устройства с пустыми метками.
    await get().refreshDevices();
  },

  refreshDevices: async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const next: Record<DeviceKind, MediaDeviceInfo[]> = {
        audioinput: [], audiooutput: [], videoinput: [],
      };
      for (const device of all) {
        if (isRealDevice(device)) next[device.kind].push(device);
      }
      set({ devices: next });
      get().prune();
    } catch {
      // Ошибка перечисления некритична: списки остаются прежними.
    }
  },

  setSelected: (kind, deviceId) => {
    const next = { ...get().selected, [kind]: deviceId };
    set({ selected: next });
    persistSelected(next);
  },

  prune: () => {
    const { devices, selected } = get();
    const next = { ...selected };
    let changed = false;
    for (const kind of DEVICE_KINDS) {
      if (next[kind] !== '' && !devices[kind].some((d) => d.deviceId === next[kind])) {
        next[kind] = '';
        changed = true;
      }
    }
    if (changed) {
      set({ selected: next });
      persistSelected(next);
    }
  },
}));

let watching = false;
/** Разовый вотчер devicechange: списки устройств живут, пока приложение открыто. */
export function watchDeviceChange(): void {
  if (watching || typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
  watching = true;
  let timer: number | undefined;
  navigator.mediaDevices.addEventListener('devicechange', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void useMediaDeviceStore.getState().refreshDevices();
    }, 300);
  });
}