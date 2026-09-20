// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { isBlockingOverlayOpen } from '@/hooks/useModalFocus';

afterEach(cleanup);
const inRouter = (ui: React.ReactNode) => (
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>{ui}</MemoryRouter>
);

describe('BottomSheet', () => {
  it('renders nothing when closed', () => {
    render(inRouter(<BottomSheet open={false} onClose={() => {}}>x</BottomSheet>));
    expect(document.querySelector('.sheet')).toBeNull();
  });

  it('joins the overlay contract: .modal-overlay scrim, blocking, dialog role', () => {
    render(inRouter(<BottomSheet open onClose={() => {}} title="T">x</BottomSheet>));
    expect(document.querySelector('.modal-overlay.sheet-overlay > .sheet')).not.toBeNull();
    expect(document.querySelector('.sheet')?.getAttribute('role')).toBe('dialog');
    expect(isBlockingOverlayOpen()).toBe(true);
  });

  it('Escape and scrim click close it; a click inside does not', () => {
    const onClose = vi.fn();
    render(inRouter(<BottomSheet open onClose={onClose}><button type="button">in</button></BottomSheet>));
    fireEvent.click(document.querySelector('.sheet button')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.sheet-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('only the top sheet reacts to Escape', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { rerender } = render(inRouter(<BottomSheet open onClose={outer}>a</BottomSheet>));
    await act(async () => {});
    rerender(inRouter(<><BottomSheet open onClose={outer}>a</BottomSheet><BottomSheet open onClose={inner}>b</BottomSheet></>));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('ActionSheet', () => {
  it('runs the item and closes; danger items come last; disabled shows its reason', () => {
    const onClose = vi.fn();
    const del = vi.fn();
    const edit = vi.fn();
    render(inRouter(
      <ActionSheet open onClose={onClose} items={[
        { label: 'Delete', onClick: del, danger: true },
        { label: 'Edit', onClick: edit },
        { label: 'Nope', onClick: vi.fn(), disabled: true, disabledReason: 'Why not' },
      ]} />,
    ));
    const labels = [...document.querySelectorAll('.action-sheet-item')].map((b) => b.querySelector('.action-sheet-label')?.textContent);
    expect(labels).toEqual(['Edit', 'Nope', 'Delete']);
    expect(document.body.textContent).toContain('Why not');
    fireEvent.click(document.querySelectorAll('.action-sheet-item')[0]);
    expect(edit).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
