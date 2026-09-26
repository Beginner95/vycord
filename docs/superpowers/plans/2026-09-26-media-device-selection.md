# Имена и выбор устройств ввода/вывода — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Селекты устройств в настройках показывают имена реальных устройств, выбор применяется в звонках (микрофон/камера через `deviceId` в `getUserMedia`, динамики через `setSinkId`), а перечисление покрывает все устройства системы.

**Architecture:** Новый Zustand-стор `mediaDeviceStore` — единый источник списков устройств и выбора (+ `devicechange`-вотчер). Новый сервис `mediaDevices.ts` — чистые построители constraints и цепочка захвата с деградацией. Селекты читают стор, звонковый слой (`groupCall`, `call.ts`) собирает constraints через сервис, динамики применяются реактивно в `useCallStageModel`; мобильная кнопка динамика читает тот же стор.

**Tech Stack:** Zustand 5 · TypeScript · Vitest (jsdom) · существующие примитивы `.select-wrap/.select-control/.select-chevron` · кастомный i18n (`ru.ts`/`en.ts`).

**Спека:** `docs/superpowers/specs/2026-09-26-media-device-selection-design.md`

## Global Constraints

- Все npm/npx-команды запускать из `client/`; root `package.json` не существует.
- Гейты: `npx tsc --noEmit` (0 байт вывода), `npx stylelint "src/**/*.css"` (0 ошибок), `npm run check:i18n` («непереведённых строк не найдено.»), `npm test` — ровно 3 падения, все в `api.network-retry.test.ts`; **этот файл не трогать**.
- i18n: симметрия `ru.ts`/`en.ts` обязательна (гейт `check:i18n`).
- Дизайн-система: только канонические примитивы и классы; `lucide-react` иконки с явными `size` и `strokeWidth={1.8}`.
- Выбранное устройство удалено из системы → автооткат на `''` («Система по умолчанию») без ошибок.
- Девиация от спеки (согласовано): применение вывода происходит реактивно в `useCallStageModel` (эффект на `selected.audiooutput`), а не внутри `setSelected` стора — стор не импортирует модули из `components/`. Поведение то же: выбор применится и вне звонка (по вступлении), и при смене выбора во время звонка.

---

### Task 1: Стор `mediaDeviceStore` + вотчер `watchDeviceChange` + точка запуска в `main.tsx`

**Files:**
- Create: `client/src/stores/mediaDeviceStore.ts`
- Test: `client/src/stores/__tests__/mediaDeviceStore.test.ts`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `localStorage`, `navigator.mediaDevices` (guarded, `?.`)
- Produces:
  - `export type DeviceKind = 'audioinput' | 'audiooutput' | 'videoinput'`
  - `export type PermissionState = 'unknown' | 'granted' | 'denied'`
  - `export function isRealDevice(d: MediaDeviceInfo): boolean`
  - `export function watchDeviceChange(): void`
  - `export const useMediaDeviceStore: UseBoundStore<...>` с состоянием `{ devices: Record<DeviceKind, MediaDeviceInfo[]>; selected: Record<DeviceKind, string>; permissions: Record<DeviceKind, PermissionState> }` и действиями `{ ensurePermission(kind): Promise<void>; refreshDevices(): Promise<void>; setSelected(kind, deviceId): void; prune(): void }` (сигнатуры см. ниже в коде)
  - localStorage-ключ `vycord_media_devices` (`{ "audioinput": string, "audiooutput": string, "videoinput": string }`)

- [ ] **Step 1: Write the failing test**

Create `client/src/stores/__tests__/mediaDeviceStore.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

function mediaDevice(over: Partial<MediaDeviceInfo>): MediaDeviceInfo {
  return {
    deviceId: 'x-device',
    groupId: 'g',
    kind: 'audioinput',
    label: 'X',
    toJSON: () => ({}),
    ...over,
  } as MediaDeviceInfo;
}

function mockEnumerate(devices: MediaDeviceInfo[]): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { enumerateDevices: vi.fn().mockResolvedValue(devices) },
    configurable: true,
  });
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('mediaDeviceStore: refreshDevices', () => {
  it('разносит устройства по kind и выкидывает псевдоустройства default/communications', async () => {
    mockEnumerate([
      mediaDevice({ deviceId: 'default', kind: 'audioinput', label: 'Default Mic' }),
      mediaDevice({ deviceId: 'communications', kind: 'audiooutput', label: 'Comms Speakers' }),
      mediaDevice({ deviceId: 'mic1', kind: 'audioinput', label: 'Mic A' }),
      mediaDevice({ deviceId: 'mic2', kind: 'audioinput', label: 'Mic B' }),
      mediaDevice({ deviceId: 'spk1', kind: 'audiooutput', label: 'Speakers' }),
      mediaDevice({ deviceId: 'cam1', kind: 'videoinput', label: 'Webcam' }),
    ]);
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    await useMediaDeviceStore.getState().refreshDevices();
    const { devices } = useMediaDeviceStore.getState();
    expect(devices.audioinput.map((d) => d.deviceId)).toEqual(['mic1', 'mic2']);
    expect(devices.audiooutput.map((d) => d.deviceId)).toEqual(['spk1']);
    expect(devices.videoinput.map((d) => d.deviceId)).toEqual(['cam1']);
  });

  it('не падает без navigator.mediaDevices (jsdom, гости без периферии)', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    await expect(useMediaDeviceStore.getState().refreshDevices()).resolves.toBeUndefined();
  });
});

describe('mediaDeviceStore: prune', () => {
  it('сбрасывает выбор пропавшего устройства в ""', async () => {
    mockEnumerate([mediaDevice({ deviceId: 'mic1', kind: 'audioinput', label: 'Mic A' })]);
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'mic1');
    useMediaDeviceStore.getState().setSelected('videoinput', 'cam-missing');
    await useMediaDeviceStore.getState().refreshDevices();
    const { selected } = useMediaDeviceStore.getState();
    expect(selected.audioinput).toBe('mic1');
    expect(selected.videoinput).toBe('');
  });
});

describe('mediaDeviceStore: setSelected и персистентность', () => {
  it('setSelected пишет в localStorage; новая инициализация читает сохранённое', async () => {
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'mic-saved');
    expect(JSON.parse(localStorage.getItem('vycord_media_devices')!)).toEqual({
      audioinput: 'mic-saved', audiooutput: '', videoinput: '',
    });

    vi.resetModules();
    const { useMediaDeviceStore: fresh } = await import('@/stores/mediaDeviceStore');
    expect(fresh.getState().selected.audioinput).toBe('mic-saved');
  });

  it('невалидное содержимое localStorage не ломает инициализацию', async () => {
    localStorage.setItem('vycord_media_devices', '{broken json');
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    expect(useMediaDeviceStore.getState().selected).toEqual({
      audioinput: '', audiooutput: '', videoinput: '',
    });
  });
});

describe('mediaDeviceStore: ensurePermission', () => {
  it('запрашивает getUserMedia и останавливает поток', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const gum = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: gum,
      },
      configurable: true,
    });
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    await useMediaDeviceStore.getState().ensurePermission('audioinput');
    expect(gum).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(useMediaDeviceStore.getState().permissions.audioinput).toBe('granted');
  });

  it('отказ разрешения помечает kind как denied без проброса ошибки', async () => {
    const gum = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: gum,
      },
      configurable: true,
    });
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    await expect(useMediaDeviceStore.getState().ensurePermission('videoinput')).resolves.toBeUndefined();
    expect(useMediaDeviceStore.getState().permissions.videoinput).toBe('denied');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `client/`): `npx vitest run src/stores/__tests__/mediaDeviceStore.test.ts`
Expected: FAIL — «Cannot find module '@/stores/mediaDeviceStore'».

- [ ] **Step 3: Write minimal implementation**

Create `client/src/stores/mediaDeviceStore.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `client/`): `npx vitest run src/stores/__tests__/mediaDeviceStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the watcher into app boot**

Modify `client/src/main.tsx` — after `import './stores/localeStore';` (line 14) add:

```ts
import { watchDeviceChange } from './stores/mediaDeviceStore';
```

and after `initErrorReporting();` (line 23) add:

```ts
// Списки устройств ввода/вывода обновляются живьём (настройки, мобильная кнопка динамика).
watchDeviceChange();
```

- [ ] **Step 6: Full-suite sanity check**

Run (from `client/`): `npx tsc --noEmit`
Expected: exit 0, zero bytes of output.

- [ ] **Step 7: Commit**

```bash
git add client/src/stores/mediaDeviceStore.ts client/src/stores/__tests__/mediaDeviceStore.test.ts client/src/main.tsx
git commit -m "VYC-99 Стор устройств: перечисление, выбор, персист, devicechange-вотчер"
```

---

### Task 2: Сервис `mediaDevices.ts` — constraints и цепочка захвата

**Files:**
- Create: `client/src/services/mediaDevices.ts`
- Test: `client/src/services/__tests__/mediaDevices.test.ts`

**Interfaces:**
- Consumes: `useMediaDeviceStore.getState().selected` из Task 1
- Produces:
  - `export function buildMicConstraints(): MediaTrackConstraints` — базовая цепочка («channelCount ideal:1, sampleRate ideal:48000, echoCancellation, noiseSuppression, autoGainControl») + `deviceId: { exact }` выбранного микрофона, если он выбран
  - `export function buildCameraConstraints(): MediaTrackConstraints` — `{}` либо `{ deviceId: { exact } }` выбранной камеры
  - `export async function acquireUserMedia(): Promise<MediaStream | null>` — цепочка попыток с деградацией до системных дефолтов; НИКОГДА не бросает

- [ ] **Step 1: Write the failing test**

Create `client/src/services/__tests__/mediaDevices.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

function stream(): MediaStream {
  return { getTracks: () => [] } as unknown as MediaStream;
}

function mockGetUserMedia(impl: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: impl },
    configurable: true,
  });
}

describe('buildMicConstraints / buildCameraConstraints', () => {
  it('без выбранного устройства возвращает базовые constraints без deviceId', async () => {
    const { buildMicConstraints, buildCameraConstraints } = await import('@/services/mediaDevices');
    expect(buildMicConstraints().deviceId).toBeUndefined();
    expect(buildMicConstraints().channelCount).toEqual({ ideal: 1 });
    expect(buildMicConstraints().sampleRate).toEqual({ ideal: 48000 });
    expect(buildCameraConstraints()).toEqual({});
  });

  it('с выбранным устройством добавляет deviceId: { exact }', async () => {
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'mic-42');
    useMediaDeviceStore.getState().setSelected('videoinput', 'cam-7');
    const { buildMicConstraints, buildCameraConstraints } = await import('@/services/mediaDevices');
    expect(buildMicConstraints().deviceId).toEqual({ exact: 'mic-42' });
    expect(buildCameraConstraints().deviceId).toEqual({ exact: 'cam-7' });
  });
});

describe('acquireUserMedia', () => {
  it('после провала выбранного устройства деградирует к дефолтам и возвращает поток', async () => {
    const gum = vi.fn()
      .mockRejectedValueOnce(new DOMException('not available', 'OverconstrainedError'))
      .mockRejectedValueOnce(new DOMException('not available', 'OverconstrainedError'))
      .mockResolvedValueOnce(stream());
    mockGetUserMedia(gum);
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'gone-device');
    const { acquireUserMedia } = await import('@/services/mediaDevices');
    const result = await acquireUserMedia();
    expect(result).not.toBeNull();
    expect(gum).toHaveBeenCalledTimes(3);
    expect(gum.mock.calls[2][0]).toEqual({ audio: true, video: true });
  });

  it('при полном отказе возвращает null; число попыток: 3 без выбора, 5 с выбором', async () => {
    const gum = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    mockGetUserMedia(gum);
    const { acquireUserMedia } = await import('@/services/mediaDevices');
    expect(await acquireUserMedia()).toBeNull();
    expect(gum).toHaveBeenCalledTimes(3);

    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'mic-42');
    useMediaDeviceStore.getState().setSelected('videoinput', 'cam-7');
    expect(await acquireUserMedia()).toBeNull();
    expect(gum).toHaveBeenCalledTimes(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/mediaDevices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/services/mediaDevices.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/mediaDevices.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/services/mediaDevices.ts client/src/services/__tests__/mediaDevices.test.ts
git commit -m "VYC-99 Сервис mediaDevices: constraints и цепочка захвата с деградацией"
```

---

### Task 3: i18n — строка «Без названия»

**Files:**
- Modify: `client/src/i18n/locales/ru.ts`
- Modify: `client/src/i18n/locales/en.ts`

**Interfaces:** Produces ключ `settings.unnamedDevice` — потребляется DeviceSelect в Task 4.

- [ ] **Step 1: Add the strings**

In `client/src/i18n/locales/ru.ts`, after `defaultSpeakers: 'Динамики по умолчанию',` (line 367) add:

```ts
    unnamedDevice: 'Без названия',
```

In `client/src/i18n/locales/en.ts`, after `defaultSpeakers: 'Default Speakers',` (line 356) add:

```ts
    unnamedDevice: 'Unnamed device',
```

- [ ] **Step 2: Verify parity gate**

Run (from `client/`): `npm run check:i18n`
Expected: «непереведённых строк не найдено.»

- [ ] **Step 3: Commit**

```bash
git add client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "VYC-99 i18n: строка unnamedDevice"
```

---

### Task 4: Селекты устройств в настройках (общий `DeviceSelect` + `AudioSettings` + `VideoSettings`)

**Files:**
- Create: `client/src/components/settings/DeviceSelect.tsx`
- Test: `client/src/components/settings/__tests__/DeviceSelect.test.tsx`
- Modify: `client/src/components/settings/AudioSettings.tsx` (селекты строк 271-299, тест микрофона строка 81, ensurePermission на монтировании)
- Modify: `client/src/components/settings/VideoSettings.tsx`

**Interfaces:**
- Consumes: `useMediaDeviceStore` (Task 1), `buildMicConstraints` (Task 2), `settings.unnamedDevice` (Task 3)
- Produces: `export function DeviceSelect({ kind, label, defaultLabel }: { kind: DeviceKind; label: string; defaultLabel: string }): JSX.Element` — рендерит `.select-wrap` с опцией `''` = «по умолчанию» и реальными устройствами; `onChange` → `setSelected(kind, value)`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/settings/__tests__/DeviceSelect.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ru } from '@/i18n/locales/ru';

function mediaDevice(
  id: string,
  label: string,
  kind: 'audioinput' | 'audiooutput' | 'videoinput',
): MediaDeviceInfo {
  return { deviceId: id, groupId: '', kind, label, toJSON: () => ({}) } as MediaDeviceInfo;
}

beforeEach(() => {
  cleanup();
  vi.resetModules();
  localStorage.clear();
});

describe('DeviceSelect', () => {
  it('показывает опцию по умолчанию и реальные устройства; пустая метка — unnamedDevice', async () => {
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.setState({
      devices: {
        audioinput: [
          mediaDevice('mic1', 'Microphone A', 'audioinput'),
          mediaDevice('mic2', '', 'audioinput'),
        ],
        audiooutput: [],
        videoinput: [],
      },
    });
    const { DeviceSelect } = await import('@/components/settings/DeviceSelect');
    render(
      <DeviceSelect kind="audioinput" label="input" defaultLabel={ru.settings.defaultMicrophone} />,
    );
    expect(screen.getByRole('option', { name: ru.settings.defaultMicrophone })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Microphone A' })).toBeTruthy();
    expect(screen.getByRole('option', { name: ru.settings.unnamedDevice })).toBeTruthy();
  });

  it('выбор устройства сохраняется в стор и localStorage', async () => {
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.setState({
      devices: {
        audioinput: [mediaDevice('mic1', 'Mic', 'audioinput')],
        audiooutput: [],
        videoinput: [],
      },
    });
    const { DeviceSelect } = await import('@/components/settings/DeviceSelect');
    render(<DeviceSelect kind="audioinput" label="input" defaultLabel="Default" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mic1' } });
    expect(useMediaDeviceStore.getState().selected.audioinput).toBe('mic1');
    expect(JSON.parse(localStorage.getItem('vycord_media_devices')!)).toEqual({
      audioinput: 'mic1', audiooutput: '', videoinput: '',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/__tests__/DeviceSelect.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `DeviceSelect`**

Create `client/src/components/settings/DeviceSelect.tsx`:

```tsx
import { ChevronDown } from 'lucide-react';
import { useMediaDeviceStore, type DeviceKind } from '@/stores/mediaDeviceStore';
import { useT } from '@/i18n';

interface DeviceSelectProps {
  kind: DeviceKind;
  label: string;
  defaultLabel: string;
}

export function DeviceSelect({ kind, label, defaultLabel }: DeviceSelectProps) {
  const t = useT();
  const devices = useMediaDeviceStore((s) => s.devices[kind]);
  const selected = useMediaDeviceStore((s) => s.selected[kind]);
  const setSelected = useMediaDeviceStore((s) => s.setSelected);
  return (
    <span className="select-wrap">
      <select
        className="select-control"
        aria-label={label}
        value={selected}
        onChange={(e) => setSelected(kind, e.target.value)}
      >
        <option value="">{defaultLabel}</option>
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || t('settings.unnamedDevice')}
          </option>
        ))}
      </select>
      <span className="select-chevron">
        <ChevronDown size={14} strokeWidth={1.8} />
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Wire `AudioSettings`**

In `client/src/components/settings/AudioSettings.tsx`:

1. Imports: replace `import { ChevronDown, MessageSquare, Phone, LogIn, LogOut } from 'lucide-react';` (line 2) with:

```ts
import { MessageSquare, Phone, LogIn, LogOut } from 'lucide-react';
```

and add below the existing imports (after line 6 `import { useT } from '@/i18n';`):

```ts
import { DeviceSelect } from '@/components/settings/DeviceSelect';
import { useMediaDeviceStore } from '@/stores/mediaDeviceStore';
import { buildMicConstraints } from '@/services/mediaDevices';
```

2. In the component body, after `const level = useMicLevel(testStream, false);` (line 23) add:

```ts
  const ensurePermission = useMediaDeviceStore((s) => s.ensurePermission);

  // Метки устройств появляются у enumerateDevices только после выдачи
  // разрешения — тихо запрашиваем микрофон при открытии раздела «Аудио».
  useEffect(() => {
    void ensurePermission('audioinput');
  }, [ensurePermission]);
```

3. Mic test (lines 80-85): replace

```ts
      setMicError(false);
      try {
        setTestStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
      } catch (err) {
```

with

```ts
      setMicError(false);
      try {
        try {
          setTestStream(await navigator.mediaDevices.getUserMedia({ audio: buildMicConstraints() }));
        } catch {
          // Выбранное устройство занято/выдрано — пробуем системный дефолт.
          setTestStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
        }
      } catch (err) {
```

4. Replace the input select block (lines 276-283) with:

```tsx
          <DeviceSelect
            kind="audioinput"
            label={t('settings.inputDevice')}
            defaultLabel={t('settings.defaultMicrophone')}
          />
```

5. Replace the output select block (lines 291-298) with:

```tsx
          <DeviceSelect
            kind="audiooutput"
            label={t('settings.outputDevice')}
            defaultLabel={t('settings.defaultSpeakers')}
          />
```

- [ ] **Step 5: Wire `VideoSettings`**

Replace the whole `client/src/components/settings/VideoSettings.tsx` with:

```tsx
import { useEffect } from 'react';
import { useT } from '@/i18n';
import { DeviceSelect } from '@/components/settings/DeviceSelect';
import { useMediaDeviceStore } from '@/stores/mediaDeviceStore';

export function VideoSettings() {
  const t = useT();
  const ensurePermission = useMediaDeviceStore((s) => s.ensurePermission);

  // Метки камер появляются после выдачи разрешения — тихо запрашиваем
  // камеру при открытии раздела «Видео».
  useEffect(() => {
    void ensurePermission('videoinput');
  }, [ensurePermission]);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.video')}</h3>

      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.camera')}</span>
          <p className="setting-row-desc">{t('settings.cameraDescription')}</p>
        </div>
        <DeviceSelect
          kind="videoinput"
          label={t('settings.camera')}
          defaultLabel={t('settings.defaultCamera')}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests and gates**

Run: `npx vitest run src/components/settings/__tests__/DeviceSelect.test.tsx`
Expected: PASS (2 tests).

Run: `npx tsc --noEmit`
Expected: exit 0, zero bytes.

Run: `npx stylelint "src/**/*.css"`
Expected: exit 0, zero bytes (CSS не менялся, гейт подтверждает отсутствие регресса).

- [ ] **Step 7: Commit**

```bash
git add client/src/components/settings/DeviceSelect.tsx client/src/components/settings/__tests__/DeviceSelect.test.tsx client/src/components/settings/AudioSettings.tsx client/src/components/settings/VideoSettings.tsx
git commit -m "VYC-99 Селекты устройств в настройках: имена реальных устройств"
```

---

### Task 5: `groupCall` — constraints через сервис

**Files:**
- Modify: `client/src/services/groupCall.ts` (удалить `MIC_AUDIO_CONSTRAINTS` строки 55-62; `acquireMedia` строки 1763-1780; `rebuildMicPipeline` строка 1918)

**Interfaces:**
- Consumes: `buildMicConstraints`, `buildCameraConstraints`, `acquireUserMedia` (Task 2)
- Produces: `acquireMedia` сохраняет сигнатуру `Promise<MediaStream | null>`; `rebuildMicPipeline` продолжает захватывать через `buildMicConstraints()` — перезахват идёт на выбранный микрофон

- [ ] **Step 1: Remove the local constants**

In `client/src/services/groupCall.ts`, delete the comment block and `MIC_AUDIO_CONSTRAINTS` (lines 50-62):

```ts
// Explicit constraints avoid macOS/Android-specific quirks:
// - channelCount ideal:1 → Opus mono, prevents macOS from injecting stereo fmtp params
//   that older pion versions may not accept (stereo=1;sprop-stereo=1 mismatch).
// - sampleRate ideal:48000 → Opus native rate; avoids resampling artefacts on Android.
// Using ideal: (not exact) so the browser still works on devices that can't hit 48kHz.
// Module-level: acquireMedia and rebuildMicPipeline must capture identically.
const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
```

(The rationale comment lives on in `client/src/services/mediaDevices.ts`.)

- [ ] **Step 2: Add the service import**

Find the import block at the top of `groupCall.ts` and add:

```ts
import { acquireUserMedia, buildCameraConstraints, buildMicConstraints } from '@/services/mediaDevices';
```

- [ ] **Step 3: Rewrite `acquireMedia`**

Replace lines 1763-1780 with:

```ts
  private async acquireMedia(): Promise<MediaStream | null> {
    gcLog(this.currentUserId, 'getUserMedia constraints', {
      audio: buildMicConstraints(),
      video: buildCameraConstraints(),
    });
    const stream = await acquireUserMedia();
    if (stream === null) {
      gcLog(this.currentUserId, 'no media devices available, joining without local media');
    }
    return stream;
  }
```

- [ ] **Step 4: Update `rebuildMicPipeline`**

Replace line 1918:

```ts
      rawAudio = await navigator.mediaDevices.getUserMedia({ audio: MIC_AUDIO_CONSTRAINTS });
```

with:

```ts
      rawAudio = await navigator.mediaDevices.getUserMedia({ audio: buildMicConstraints() });
```

- [ ] **Step 5: Verify**

Run (from `client/`): `npx tsc --noEmit`
Expected: exit 0, zero bytes (доказывает, что других ссылок на `MIC_AUDIO_CONSTRAINTS` не осталось).

- [ ] **Step 6: Commit**

```bash
git add client/src/services/groupCall.ts
git commit -m "VYC-99 groupCall: захват идёт на выбранные микрофон/камеру"
```

---

### Task 6: `call.ts` (P2P) — захват через `acquireUserMedia`

**Files:**
- Modify: `client/src/services/call.ts` (startCall строки 56-74, acceptCall строки 133-151)

**Interfaces:**
- Consumes: `acquireUserMedia` (Task 2)
- Produces: оба метода используют одну цепочку; блоки `getDeniedMediaKinds` и `createChain` остаются на месте

- [ ] **Step 1: Add the import**

At the top of `client/src/services/call.ts` add:

```ts
import { acquireUserMedia } from '@/services/mediaDevices';
```

- [ ] **Step 2: Rewrite the capture block in `startCall`**

Replace lines 55-74:

```ts
      // Get local media stream; fall back to audio-only, then video-only, then nothing
      try {
        let rawStream: MediaStream;
        try {
          rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } catch {
          rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
        this.localStream = await noiseCancellationService.createChain(rawStream);
        this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
        this._microphoneAvailable = this.localStream.getAudioTracks().length > 0;
      } catch {
        // No audio device — try video-only, or proceed without local media
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
        } catch {
          this.localStream = null;
        }
      }
```

with:

```ts
      // Get local media stream; acquireUserMedia сам деградирует: выбранные
      // устройства → системные дефолты → audio-only → video-only → без медиа.
      try {
        const rawStream = await acquireUserMedia();
        if (rawStream) {
          this.localStream = await noiseCancellationService.createChain(rawStream);
          this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
          this._microphoneAvailable = this.localStream.getAudioTracks().length > 0;
        } else {
          this.localStream = null;
        }
      } catch {
        this.localStream = null;
      }
```

- [ ] **Step 3: Rewrite the capture block in `acceptCall`**

Replace lines 133-151:

```ts
      try {
        let rawStream: MediaStream;
        try {
          rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } catch {
          rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
        this.localStream = await noiseCancellationService.createChain(rawStream);
        this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
        this._microphoneAvailable = this.localStream.getAudioTracks().length > 0;
      } catch {
        // No audio device — try video-only, or proceed without local media
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
        } catch {
          this.localStream = null;
        }
      }
```

with:

```ts
      const rawStream = await acquireUserMedia();
      if (rawStream) {
        try {
          this.localStream = await noiseCancellationService.createChain(rawStream);
          this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
          this._microphoneAvailable = this.localStream.getAudioTracks().length > 0;
        } catch {
          this.localStream = null;
        }
      } else {
        this.localStream = null;
      }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: exit 0, zero bytes.

- [ ] **Step 5: Commit**

```bash
git add client/src/services/call.ts
git commit -m "VYC-99 call.ts: захват через acquireUserMedia с учётом выбранных устройств"
```

---

### Task 7: `useCallStageModel` — применение выбранного динамика

**Files:**
- Modify: `client/src/components/useCallStageModel.ts` (setRemoteVideoRef строки 660-667; после applySinkId строка 679)
- Modify: `client/src/components/useCallStageModel.test.ts`

**Interfaces:**
- Consumes: `useMediaDeviceStore` (Task 1), собственная `applySinkId`
- Produces: эффект, который при монтировании модели и при смене `selected.audiooutput` применяет выбранный sink ко всем текущим видео и реестру (`applySinkToCallAudio` внутри `applySinkId`); новые удалённые видео получают sink в `setRemoteVideoRef`

- [ ] **Step 1: Write the failing test**

Modify `client/src/components/useCallStageModel.test.ts`:

1. Add to `beforeEach` (line 23) — чистое состояние выбора между тестами:

```ts
  localStorage.clear();
```

2. Append a new describe block at the end of the file:

```ts
describe('useCallStageModel: выбранный динамик из настроек', () => {
  it('применяет выбранный deviceId к зарегистрированным звуковым элементам на монтировании', async () => {
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audiooutput', 'sink-1');
    const el = document.createElement('video') as HTMLVideoElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    el.setSinkId = setSinkId;
    const { registerCallAudioElement } = await import('@/components/call/callAudioSinks');
    const unregister = registerCallAudioElement(el);
    const { result } = renderHook(() => useCallStageModel());
    expect(setSinkId).toHaveBeenCalledWith('sink-1');
    expect(() => result.current.applySinkId('device-1')).not.toThrow();
    unregister();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/useCallStageModel.test.ts`
Expected: FAIL — выбранный sink не применяется (setSinkId не вызван).

- [ ] **Step 3: Implement**

In `client/src/components/useCallStageModel.ts`:

1. Add import (к остальным импортам стора):

```ts
import { useMediaDeviceStore } from '@/stores/mediaDeviceStore';
```

2. Extend `setRemoteVideoRef` (lines 660-667) — новые плитки получают выбранный sink при монтировании:

```ts
  const setRemoteVideoRef = useCallback((userId: string, el: HTMLVideoElement | null) => {
    if (el) {
      // С внешним хостом звука плитка немая с момента монтирования — до
      // приаттачивания потока, чтобы autoPlay не успел зазвучать.
      if (externalAudioRef.current) el.muted = true;
      const sinkId = useMediaDeviceStore.getState().selected.audiooutput;
      if (sinkId) {
        const withSink = el as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> };
        withSink.setSinkId?.(sinkId).catch(() => {});
      }
      remoteVideoRefsMap.current.set(userId, el);
    } else remoteVideoRefsMap.current.delete(userId);
  }, []);
```

3. After the `applySinkId` definition (after line 679) add:

```ts
  const selectedOutputId = useMediaDeviceStore((s) => s.selected.audiooutput);
  // Выбранный в настройках динамик применяется при монтировании экрана звонка
  // и при смене выбора во время звонка; поздние плитки покрываются
  // setRemoteVideoRef выше, а элементы внешнего хоста — реестром callAudioSinks.
  useEffect(() => {
    if (selectedOutputId) applySinkId(selectedOutputId);
  }, [applySinkId, selectedOutputId]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/useCallStageModel.test.ts`
Expected: PASS (все тесты файла, включая новый).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/useCallStageModel.ts client/src/components/useCallStageModel.test.ts
git commit -m "VYC-99 useCallStageModel: применение выбранного динамика"
```

---

### Task 8: Мобильная кнопка динамика — данные из стора

**Files:**
- Modify: `client/src/mobile/hooks/useAudioOutput.ts`
- Modify: `client/src/mobile/hooks/__tests__/useAudioOutput.test.ts`

**Interfaces:**
- Consumes: `useMediaDeviceStore.getState`/селектор (Task 1)
- Produces: контракт `{ supported, cycle, currentLabel }` без изменений (MobileCallScreen не трогаем). Поведенческая дельта: список — только реальные устройства (псевдоустройства `default`/`communications` отфильтрованы стором), обновляется через `devicechange`-вотчер

- [ ] **Step 1: Rework the failing test**

Replace the whole `client/src/mobile/hooks/__tests__/useAudioOutput.test.ts` with:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { ru } from '@/i18n/locales/ru';

function mediaDevice(
  id: string,
  kind: 'audioinput' | 'audiooutput' | 'videoinput',
  label: string,
): MediaDeviceInfo {
  return { deviceId: id, groupId: '', kind, label, toJSON: () => ({}) } as MediaDeviceInfo;
}

async function seedOutputDevices(devices: MediaDeviceInfo[]): Promise<void> {
  const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
  useMediaDeviceStore.setState({
    devices: {
      audioinput: devices.filter((d) => d.kind === 'audioinput'),
      audiooutput: devices.filter((d) => d.kind === 'audiooutput'),
      videoinput: [],
    },
    selected: { audioinput: '', audiooutput: '', videoinput: '' },
  });
}

// SUPPORTED — `'setSinkId' in HTMLMediaElement.prototype` — is computed once
// at module load, so each scenario resets the module registry and imports
// fresh after arranging the prototype, matching the pattern used for other
// module-scoped feature detection in this repo (themeStore.themeColor.test.ts).
describe('useAudioOutput — setSinkId absent from the prototype', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId;
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('is unsupported even with multiple output devices', async () => {
    await seedOutputDevices([
      mediaDevice('a', 'audiooutput', 'Speakers'),
      mediaDevice('b', 'audiooutput', 'Headphones'),
    ]);
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(vi.fn()));
    expect(result.current.supported).toBe(false);
  });
});

describe('useAudioOutput — setSinkId supported', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId;
  });

  it('cycles through output devices in order and wraps around, calling applySinkId with the deviceId', async () => {
    await seedOutputDevices([
      mediaDevice('a', 'audiooutput', 'Speakers'),
      mediaDevice('b', 'audiooutput', 'Headphones'),
      mediaDevice('mic1', 'audioinput', 'Built-in mic'),
    ]);
    const applySinkId = vi.fn();
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(applySinkId));
    expect(result.current.supported).toBe(true);

    act(() => result.current.cycle());
    expect(applySinkId).toHaveBeenLastCalledWith('b');

    act(() => result.current.cycle());
    expect(applySinkId).toHaveBeenLastCalledWith('a');
    expect(applySinkId).toHaveBeenCalledTimes(2);
  });

  it('is unsupported with exactly one output device', async () => {
    await seedOutputDevices([mediaDevice('a', 'audiooutput', 'Speakers')]);
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(vi.fn()));
    expect(result.current.supported).toBe(false);
  });

  it('falls back to call.speakerDefault when the current device has no label', async () => {
    await seedOutputDevices([
      mediaDevice('a', 'audiooutput', ''),
      mediaDevice('b', 'audiooutput', ''),
    ]);
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(vi.fn()));
    // currentLabel = current?.label || t('call.speakerDefault') — пустая метка
    // проваливается сквозь || к переведённому фолбэку (Minor M8). Список теперь
    // приходит из стора, где псевдоустройства default/communications отфильтрованы.
    expect(result.current.currentLabel).toBe(ru.call.speakerDefault);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mobile/hooks/__tests__/useAudioOutput.test.ts`
Expected: FAIL — хук всё ещё зовёт enumerateDevices, стор не читает.

- [ ] **Step 3: Rewrite the hook**

Replace the whole `client/src/mobile/hooks/useAudioOutput.ts` with:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/mobile/hooks/__tests__/useAudioOutput.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full-suite check**

Run: `npx vitest run src/components/useCallStageModel.test.ts src/mobile/hooks/__tests__/useAudioOutput.test.ts src/mobile/screens/__tests__/MobileCallScreen.test.tsx src/mobile/call/__tests__/CallAudioHost.test.tsx`
Expected: PASS (MobileCallScreen и CallAudioHost мокают хук — не сломались).

- [ ] **Step 6: Commit**

```bash
git add client/src/mobile/hooks/useAudioOutput.ts client/src/mobile/hooks/__tests__/useAudioOutput.test.ts
git commit -m "VYC-99 Мобильная кнопка динамика читает список из mediaDeviceStore"
```

---

### Task 9: Финальная верификация

**Files:**
- Нет изменений кода

- [ ] **Step 1: Все гейты**

Run (каждую из `client/`):

```bash
npx tsc --noEmit
npx stylelint "src/**/*.css"
npm run check:i18n
npm test
```

Expected:
- `tsc`: exit 0, zero bytes
- `stylelint`: exit 0, zero bytes
- `check:i18n`: «непереведённых строк не найдено.»
- `npm test`: ровно 3 падения, все в `api.network-retry.test.ts` — никаких других файлов

- [ ] **Step 2: Проверка отсутствия расхождений**

Run: `git status --short`
Expected: работающая копия чистая (все изменения закоммичены).

- [ ] **Step 3: Manual click-through**

С dev-сервером (`npm run dev:vite`) в браузере, в обеих темах и на узкой ширине:
1. Настройки → Аудио → «Устройства»: селекты ввода/вывода показывают реальные имена устройств, опция «…по умолчанию» первая и активна
2. Выбрать другой микрофон → тест микрофона идёт на нём (уровень реагирует)
3. Настройки → Видео → Камера: отображается имя камеры
4. Переключить динамик → звук звонка переключается (проверить в звонке с участником или с тестовым рингтоном)
5. Подключить/отключить USB-гарнитуру при открытых настройках → список обновился без перезагрузки (devicechange)
6. На мобильном viewport: кнопка динамика на экране звонка циклит реальные динамики

- [ ] **Step 4: Итоговый коммит-лог**

Run: `git log --oneline -9`
Expected: 7 коммитов от этой ветки (спека + 6 задач + финал).