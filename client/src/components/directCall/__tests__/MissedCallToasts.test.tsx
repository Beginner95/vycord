// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
import { MissedCallToasts } from '@/components/directCall/MissedCallToasts';
import { useDirectCallStore } from '@/stores/directCallStore';

const bob = { id: 'bob', username: 'bob' };

describe('MissedCallToasts', () => {
  afterEach(cleanup);
  beforeEach(() => useDirectCallStore.setState({ phase: { kind: 'idle' }, missed: [], lastError: null }));

  it('пусто без пропущенных', () => {
    const { container } = render(<MissedCallToasts />);
    expect(container.innerHTML).toBe('');
  });

  it('«Перезвонить» вызывает call(peer) и dismissMissed', () => {
    const call = vi.fn();
    const dismissMissed = vi.fn();
    useDirectCallStore.setState({ missed: [{ callId: 'c1', peer: bob, at: 1 }], call, dismissMissed });
    render(<MissedCallToasts />);
    expect(screen.getByText(/Пропущенный звонок от bob|Missed call from bob/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /перезвонить|call back/i }));
    expect(dismissMissed).toHaveBeenCalledWith('c1');
    expect(call).toHaveBeenCalledWith(bob);
  });

  it('крестик только закрывает', () => {
    const call = vi.fn();
    const dismissMissed = vi.fn();
    useDirectCallStore.setState({ missed: [{ callId: 'c1', peer: bob, at: 1 }], call, dismissMissed });
    render(<MissedCallToasts />);
    fireEvent.click(screen.getByRole('button', { name: /закрыть|close/i }));
    expect(dismissMissed).toHaveBeenCalledWith('c1');
    expect(call).not.toHaveBeenCalled();
  });

  it('CSS-контракт: десктопная стопка сверху справа, не у нижнего края (композер, «Пригласить друзей»)', () => {
    const css = readFileSync('src/components/directCall/MissedCallToasts.css', 'utf8');
    const base = css.match(/^\.missed-call-stack \{[^}]*\}/m)![0];
    expect(base).toMatch(/top:\s*68px/);
    expect(base).not.toMatch(/bottom:/);
  });
});
