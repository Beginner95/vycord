// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StrictMode, useState, type ReactNode } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useMobileNav, type MobileNav } from '@/mobile/nav/useMobileNav';
import { useBackDismiss } from '@/mobile/sheets/useBackDismiss';

afterEach(cleanup);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

let nav!: MobileNav;
let setOpen!: (v: boolean) => void;
const onClose = vi.fn();

function Harness() {
  nav = useMobileNav();
  const [open, _setOpen] = useState(false);
  setOpen = _setOpen;
  useBackDismiss(open, () => { onClose(); _setOpen(false); });
  return null;
}

const mount = (strict = false) => {
  const tree: ReactNode = (
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
      <Harness />
    </MemoryRouter>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

describe('useBackDismiss', () => {
  it('opening pushes one sheet entry, closing pops it', async () => {
    onClose.mockClear();
    mount();
    act(() => setOpen(true));
    await flush();
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers', 'sheet']);
    act(() => setOpen(false));
    await flush();
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers']);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('system back closes the sheet via onClose', async () => {
    onClose.mockClear();
    mount();
    act(() => setOpen(true));
    await flush();
    await act(async () => { nav.back(); });
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers']);
  });

  it('StrictMode double-mount does not double-push', async () => {
    onClose.mockClear();
    mount(true);
    act(() => setOpen(true));
    await flush();
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers', 'sheet']);
  });

  it('navigating forward from an open sheet replaces it; closing does not pop the new screen', async () => {
    onClose.mockClear();
    mount();
    act(() => setOpen(true));
    await flush();
    act(() => { nav.push({ kind: 'createServer' }); });
    act(() => setOpen(false));
    await flush();
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers', 'createServer']);
  });
});
