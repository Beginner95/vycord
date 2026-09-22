// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ExpressionPicker } from '../ExpressionPicker';
import { useExpressionRecentsStore } from '@/stores/expressionRecentsStore';
import { normalizeHtml, stickerItems, stubBrowser } from './chatHarness';

beforeAll(stubBrowser);
beforeEach(() => {
  useExpressionRecentsStore.setState({ v: 1, emoji: {}, stickers: {}, lastTab: 'emoji' });
});
afterEach(cleanup);

const snap = (name: string) => expect(normalizeHtml(document.body.innerHTML)).toMatchFileSnapshot(`./__snapshots__/ExpressionPicker.${name}.html`);
const stickers = () => ({ serverId: 's1', items: stickerItems(), onSend: vi.fn(async () => true), onManage: vi.fn() });

describe('ExpressionPicker DOM (desktop parity, снято до VYC-95 этапа 3)', () => {
  it('single emoji tab, no strip', async () => {
    render(<ExpressionPicker tabs={['emoji']} onClose={vi.fn()} onSelectEmoji={vi.fn()} />);
    await snap('emoji-only');
  });
  it('emoji + stickers, emoji tab active', async () => {
    render(<ExpressionPicker tabs={['emoji', 'stickers']} onClose={vi.fn()} onSelectEmoji={vi.fn()} stickers={stickers()} />);
    await snap('tabs-emoji');
  });
  it('emoji + stickers, stickers tab active', async () => {
    const { container } = render(<ExpressionPicker tabs={['emoji', 'stickers']} onClose={vi.fn()} onSelectEmoji={vi.fn()} stickers={stickers()} />);
    fireEvent.click(container.querySelectorAll('[role="tab"]')[1]);
    await snap('tabs-stickers');
  });
});
