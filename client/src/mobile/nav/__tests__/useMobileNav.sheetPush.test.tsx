// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { useMobileNav, type MobileNav } from '@/mobile/nav/useMobileNav';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';

const ITEM = 'go-create';
let nav!: MobileNav;
let setOpen!: (v: boolean) => void;

function Host() {
  nav = useMobileNav();
  const [open, _setOpen] = useState(false);
  setOpen = _setOpen;
  return (
    <>
      <div data-testid="top">{nav.top.kind}</div>
      <ActionSheet
        open={open}
        onClose={() => _setOpen(false)}
        items={[{ label: ITEM, onClick: () => nav.push({ kind: 'createServer' }) }]}
      />
    </>
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  window.history.replaceState({ usr: { m: [{ kind: 'servers' }], b: 0 }, key: 'k0', idx: 0 }, '', '/app');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ActionSheet item that pushes a screen (real BrowserRouter)', () => {
  it('the pushed screen replaces the sheet entry and is not undone by history.go(-1)', async () => {
    const go = vi.spyOn(window.history, 'go');
    const back = vi.spyOn(window.history, 'back');
    const { getByText, getByTestId } = render(<BrowserRouter><Host /></BrowserRouter>);
    act(() => setOpen(true));
    await settle();
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers', 'sheet']);

    // Как в реальном браузере: нативный клик вне act(), чтобы срочный рендер
    // (setOpen(false)) и переход роутера (startTransition) шли разными проходами.
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      getByText(ITEM).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true;
    }
    await settle();

    expect(go).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(getByTestId('top').textContent).toBe('createServer');
    expect(nav.stack.map((s) => s.kind)).toEqual(['servers', 'createServer']);
  });
});
