// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { TabBar } from '@/mobile/components/TabBar';

afterEach(cleanup);

describe('TabBar', () => {
  it('three tabs, active one marked, click selects', () => {
    const onSelect = vi.fn();
    render(<TabBar active="friends" onSelect={onSelect} friendsBadge={0} />);
    const items = document.querySelectorAll('.tab-bar-item');
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute('aria-current')).toBe('page');
    expect(items[1].classList.contains('is-active')).toBe(true);
    fireEvent.click(items[2]);
    expect(onSelect).toHaveBeenCalledWith('profile');
  });

  it('friends badge caps at 99+ and hides at 0', () => {
    const { rerender } = render(<TabBar active="servers" onSelect={() => {}} friendsBadge={0} />);
    expect(document.querySelector('.tab-bar-badge')).toBeNull();
    rerender(<TabBar active="servers" onSelect={() => {}} friendsBadge={150} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });
});
