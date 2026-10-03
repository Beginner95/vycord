// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
vi.mock('@/services/desktopAttention', () => ({ requestAttention: vi.fn() }));
vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
import { IncomingCallCard } from '@/components/directCall/IncomingCallCard';
import { readFileSync } from 'node:fs';
import { requestAttention } from '@/services/desktopAttention';
import { useDirectCallStore } from '@/stores/directCallStore';

const bob = { id: 'bob', username: 'bob' };

describe('IncomingCallCard', () => {
  afterEach(cleanup);
  beforeEach(() => useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false, missed: [], lastError: null }));

  it('скрыта без входящего', () => {
    const { container } = render(<IncomingCallCard />);
    expect(container.innerHTML).toBe('');
    expect(document.querySelector('.incoming-call-card')).toBeNull();
  });

  it('показывает звонящего и вызывает accept/reject', () => {
    const accept = vi.fn();
    const reject = vi.fn();
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: false }, accept, reject });
    render(<IncomingCallCard />);
    expect(screen.getByText('bob')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /принять|accept/i }));
    fireEvent.click(screen.getByRole('button', { name: /отклонить|decline/i }));
    expect(accept).toHaveBeenCalled();
    expect(reject).toHaveBeenCalled();
  });

  it('при wouldSwitch предупреждает о завершении текущего звонка', () => {
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: true } });
    render(<IncomingCallCard />);
    expect(screen.getByText(/завершит текущий|end your current/i)).toBeTruthy();
  });

  it('без wouldSwitch предупреждения нет', () => {
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: false } });
    render(<IncomingCallCard />);
    expect(screen.queryByText(/завершит текущий|end your current/i)).toBeNull();
  });

  it('requestAttention — один раз на callId, не на ре-рендер', () => {
    vi.mocked(requestAttention).mockClear();
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: false } });
    const { rerender } = render(<IncomingCallCard />);
    rerender(<IncomingCallCard />);
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: true } });
    rerender(<IncomingCallCard />);
    expect(requestAttention).toHaveBeenCalledTimes(1);
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c2', peer: bob, wouldSwitch: false } });
    rerender(<IncomingCallCard />);
    expect(requestAttention).toHaveBeenCalledTimes(2);
  });

  it('alertdialog с именем и описанием', () => {
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: false } });
    render(<IncomingCallCard />);
    const el = screen.getByRole('alertdialog');
    expect(el.getAttribute('aria-label')).toBeTruthy();
    expect(document.getElementById(el.getAttribute('aria-describedby')!)).not.toBeNull();
  });

  it('CSS-контракт: карточка строго выше --z-toast, остальные тосты уступают место', () => {
    const css = readFileSync('src/components/directCall/IncomingCallCard.css', 'utf8');
    expect(css).toMatch(/z-index:\s*calc\(var\(--z-toast\) \+ 1\)/);
    expect(css).toMatch(/body:has\(\.incoming-call-card\) \.call-error-toast/);
    expect(css).toMatch(/body:has\(\.incoming-call-card\) \.missed-call-stack/);
  });
});
