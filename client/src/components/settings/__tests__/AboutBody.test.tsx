// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AboutBody } from '@/components/settings/AboutBody';

afterEach(cleanup);

describe('AboutBody (VYC-98 «О приложении»)', () => {
  it('показывает название, описание и версию', () => {
    render(<AboutBody />);
    expect(document.body.textContent).toContain('Vycord');
    expect(document.body.textContent).toContain('Мессенджер для голосовых и видеозвонков');
    expect(document.body.textContent).toContain(__APP_VERSION__);
  });

  it('ссылки ведут на репозиторий и issues и открываются в новой вкладке', () => {
    render(<AboutBody />);
    const links = document.querySelectorAll<HTMLAnchorElement>('a.setting-row-link');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://github.com/Beginner95/vycord');
    expect(links[1].getAttribute('href')).toBe('https://github.com/Beginner95/vycord/issues');
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});
