// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
import { CallErrorToast } from '@/components/directCall/CallErrorToast';
import { useDirectCallStore } from '@/stores/directCallStore';

describe('CallErrorToast', () => {
  afterEach(cleanup);
  beforeEach(() => { vi.useFakeTimers(); useDirectCallStore.setState({ lastError: null }); });
  afterEach(() => vi.useRealTimers());

  it('показывает текст для forbidden и гасит ошибку через 5 с', () => {
    render(<CallErrorToast />);
    act(() => useDirectCallStore.setState({ lastError: 'forbidden' }));
    expect(screen.getByText(/только от друзей|only accepts calls from friends/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(useDirectCallStore.getState().lastError).toBeNull();
  });

  it('rate_limited: текст про слишком частые звонки', () => {
    render(<CallErrorToast />);
    act(() => useDirectCallStore.setState({ lastError: 'rate_limited' }));
    expect(screen.getByRole('alert').textContent).toMatch(/слишком много звонков|too many calls/i);
  });

  it('not_found молча', () => {
    const { container } = render(<CallErrorToast />);
    act(() => useDirectCallStore.setState({ lastError: 'not_found' }));
    expect(container.innerHTML).toBe('');
  });
});
