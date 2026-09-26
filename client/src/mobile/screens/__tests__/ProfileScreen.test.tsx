// client/src/mobile/screens/__tests__/ProfileScreen.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProfileScreen } from '@/mobile/screens/ProfileScreen';
import { controller, nav } from './fixtures';

vi.mock('@/services/noiseCancellation', () => ({
  noiseCancellationService: { getState: () => ({ isEnabled: false }), onStateChange: () => () => {} },
}));

afterEach(cleanup);

function mount() {
  const n = nav();
  const c = controller();
  render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'profile' }], b: 0 } }]}>
      <ProfileScreen ctx={{ c, nav: n, joinVoice: vi.fn() }} />
    </MemoryRouter>,
  );
  return { n, c };
}

describe('ProfileScreen (VYC-95 этап 5)', () => {
  it('карточка показывает username и email', () => {
    mount();
    expect(document.body.textContent).toContain('anna');
    expect(document.body.textContent).toContain('anna@example.com');
  });

  it('пункт «Профиль» ведёт на settings{profile}', () => {
    const { n } = mount();
    fireEvent.click(document.querySelectorAll('.mobile-row')[0]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'settings', section: 'profile' });
  });

  it('пункт «Язык» (последний) ведёт на settings{language}', () => {
    const { n } = mount();
    fireEvent.click(document.querySelectorAll('.mobile-row')[5]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'settings', section: 'language' });
  });

  it('пункт «О приложении» (последний) ведёт на settings{about}', () => {
    const { n } = mount();
    fireEvent.click(document.querySelectorAll('.mobile-row')[6]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'settings', section: 'about' });
  });

  it('«Выйти» требует подтверждения перед c.logout', () => {
    const { c } = mount();
    fireEvent.click(document.querySelector('.profile-logout-btn')!);
    expect(c.logout).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.confirm-modal-actions .btn-danger')!);
    expect(c.logout).toHaveBeenCalled();
  });
});
