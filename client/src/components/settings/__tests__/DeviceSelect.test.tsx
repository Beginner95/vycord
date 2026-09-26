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
