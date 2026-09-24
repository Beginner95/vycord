// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { MobileListRow } from '@/mobile/components/MobileListRow';

afterEach(cleanup);

const TITLE = 'Волчья стая';
const SUBTITLE = 'Аня, Борис в голосе';

describe('MobileListRow', () => {
  it('renders avatar slot, title, subtitle and meta', () => {
    render(
      <MobileListRow
        avatar={<span data-testid="av" />}
        title={TITLE}
        subtitle={SUBTITLE}
        meta={<span data-testid="meta" />}
      />,
    );
    expect(document.querySelector('.mobile-row')).not.toBeNull();
    expect(document.querySelector('.mobile-row-avatar [data-testid="av"]')).not.toBeNull();
    expect(document.querySelector('.mobile-row-title')?.textContent).toBe(TITLE);
    expect(document.querySelector('.mobile-row-sub')?.textContent).toBe(SUBTITLE);
    expect(document.querySelector('.mobile-row-meta [data-testid="meta"]')).not.toBeNull();
  });

  it('omits the subtitle node entirely when there is none', () => {
    render(<MobileListRow avatar={null} title="X" />);
    expect(document.querySelector('.mobile-row-sub')).toBeNull();
  });

  it('is a real button and fires onClick', () => {
    const onClick = vi.fn();
    render(<MobileListRow avatar={null} title="X" onClick={onClick} />);
    const row = document.querySelector('.mobile-row') as HTMLButtonElement;
    expect(row.tagName).toBe('BUTTON');
    expect(row.type).toBe('button');
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('spreads long-press handlers onto the row', () => {
    const handlers = { onPointerDown: vi.fn(), onContextMenu: vi.fn() };
    render(<MobileListRow avatar={null} title="X" longPress={handlers as never} />);
    fireEvent.pointerDown(document.querySelector('.mobile-row')!);
    expect(handlers.onPointerDown).toHaveBeenCalled();
  });
});
