// client/src/mobile/screens/__tests__/SettingsScreen.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

// themeStore читает matchMedia в момент импорта (AppearanceSettings тянет его
// через SettingsScreen), а jsdom его не определяет.
vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
import { SettingsScreen } from '@/mobile/screens/SettingsScreen';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/services/noiseCancellation', () => ({
  noiseCancellationService: {
    getState: () => ({ isEnabled: false, isLoading: false }),
    onStateChange: () => () => {},
    setEnabled: vi.fn(async () => {}),
  },
  NoiseCancellationService: { isSupported: () => true },
}));

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 'u1', username: 'anna', email: 'anna@example.com',
      show_last_seen: true, allow_friend_requests: 'everyone', allow_dm_from: 'friends',
    } as never,
  });
});
afterEach(cleanup);

describe('SettingsScreen (VYC-95 этап 5)', () => {
  it.each([
    ['profile', 'Профиль', 'anna@example.com'],
    ['privacy', 'Приватность', 'Показывать последний визит'],
    ['audio', 'Аудио', 'Проверка микрофона'],
    ['video', 'Видео', 'Камера'],
    ['appearance', 'Внешний вид', 'Тема'],
    ['language', 'Язык', 'Язык интерфейса'],
  ] as const)('section=%s — заголовок и тело', (section, title, bodyText) => {
    render(<SettingsScreen section={section} onBack={() => {}} />);
    expect(document.querySelector('.screen-header-name')?.textContent).toBe(title);
    expect(document.body.textContent).toContain(bodyText);
  });

  it('кнопка «назад» зовёт onBack', () => {
    const onBack = vi.fn();
    render(<SettingsScreen section="profile" onBack={onBack} />);
    fireEvent.click(document.querySelector('.screen-header-btn')!);
    expect(onBack).toHaveBeenCalled();
  });
});
