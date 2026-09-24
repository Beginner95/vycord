// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MediaLightbox } from '../MediaLightbox';
import { normalizeHtml, stubBrowser } from './chatHarness';
import type { Attachment } from '@/types';

beforeAll(stubBrowser);
afterEach(cleanup);

const att = (id: string, kind: Attachment['kind'], name: string, type: string): Attachment => ({
  id, channel_id: 'c1', user_id: 'u1', kind, file_name: name, content_type: type, size_bytes: 10,
  url: `/api/v1/attachments/${id}/content?exp=1&sig=x`, created_at: '2026-09-20T09:00:00Z',
});
const images = () => [att('a', 'image', 'one.png', 'image/png'), att('b', 'image', 'two.png', 'image/png'), att('c', 'image', 'three.png', 'image/png')];

const snap = (name: string) => expect(normalizeHtml(document.body.innerHTML)).toMatchFileSnapshot(`./__snapshots__/MediaLightbox.${name}.html`);
const mount = (attachments: Attachment[], index: number) =>
  render(<MediaLightbox attachments={attachments} index={index} onIndexChange={vi.fn()} onClose={vi.fn()} />);

describe('MediaLightbox DOM (desktop parity, снято до VYC-95 этапа 3)', () => {
  it('middle image, both arrows', async () => { mount(images(), 1); await snap('middle'); });
  it('first image, forward arrow only', async () => { mount(images(), 0); await snap('first'); });
  it('video', async () => { mount([att('v', 'video', 'clip.mp4', 'video/mp4')], 0); await snap('video'); });
});
