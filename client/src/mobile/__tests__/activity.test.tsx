// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useChannelActivity, useServerActivity, __setActivityOverride, type ChannelActivity } from '@/mobile/activity';
import { ActivityMeta, useActivitySubtitle } from '@/mobile/components/ActivityMeta';

afterEach(() => { __setActivityOverride(null); cleanup(); });

const base: ChannelActivity = { preview: null, timestamp: null, unreadCount: null, hasUnread: false };

function Probe({ id }: { id: string }) {
  const a = useChannelActivity(id);
  const sub = useActivitySubtitle(a);
  return <div data-sub={sub ?? ''}><ActivityMeta activity={a} /></div>;
}

describe('activity extension point', () => {
  it('returns null for both scopes without an override', () => {
    function P() {
      return <i data-ch={String(useChannelActivity('c1'))} data-sv={String(useServerActivity('s1'))} />;
    }
    render(<P />);
    expect(document.querySelector('i')?.getAttribute('data-ch')).toBe('null');
    expect(document.querySelector('i')?.getAttribute('data-sv')).toBe('null');
  });

  it('passes the id and the scope to the override', () => {
    const seen: Array<[string, string]> = [];
    __setActivityOverride((id, scope) => { seen.push([id, scope]); return base; });
    function P() { useChannelActivity('c1'); useServerActivity('s1'); return null; }
    render(<P />);
    expect(seen).toEqual([['c1', 'channel'], ['s1', 'server']]);
  });

  it('renders nothing when the activity is null', () => {
    render(<Probe id="c1" />);
    expect(document.querySelector('[data-sub]')?.getAttribute('data-sub')).toBe('');
    expect(document.querySelector('.activity-badge')).toBeNull();
    expect(document.querySelector('.activity-time')).toBeNull();
  });

  it('renders a text preview as «Автор: текст»', () => {
    __setActivityOverride(() => ({ ...base, preview: { authorName: 'Аня', kind: 'text', text: 'привет' } }));
    render(<Probe id="c1" />);
    expect(document.querySelector('[data-sub]')?.getAttribute('data-sub')).toBe('Аня: привет');
  });

  it('renders non-text previews by kind', () => {
    for (const [kind, expected] of [['attachment', 'Аня: Вложение'], ['sticker', 'Аня: Стикер'], ['call', 'Аня: Звонок']] as const) {
      __setActivityOverride(() => ({ ...base, preview: { authorName: 'Аня', kind } }));
      const { unmount } = render(<Probe id="c1" />);
      expect(document.querySelector('[data-sub]')?.getAttribute('data-sub')).toBe(expected);
      unmount();
    }
  });

  it('shows a count badge, clamped at 99+', () => {
    __setActivityOverride(() => ({ ...base, unreadCount: 1234, hasUnread: true }));
    render(<Probe id="c1" />);
    expect(document.querySelector('.activity-badge')?.textContent).toBe('99+');
  });

  it('clamps the badge exactly at the 99/100 boundary and hides it at zero', () => {
    for (const [count, expected] of [[99, '99'], [100, '99+'], [0, null]] as const) {
      __setActivityOverride(() => ({ ...base, unreadCount: count, hasUnread: count > 0 }));
      const { unmount } = render(<Probe id="c1" />);
      expect(document.querySelector('.activity-badge')?.textContent ?? null).toBe(expected);
      unmount();
    }
  });

  it('labels the badge and the dot for assistive tech', () => {
    __setActivityOverride(() => ({ ...base, unreadCount: 3, hasUnread: true }));
    const first = render(<Probe id="c1" />);
    expect(document.querySelector('.activity-badge')?.getAttribute('role')).toBe('img');
    expect(document.querySelector('.activity-badge')?.getAttribute('aria-label')).toBeTruthy();
    first.unmount();
    __setActivityOverride(() => ({ ...base, unreadCount: null, hasUnread: true }));
    render(<Probe id="c1" />);
    expect(document.querySelector('.activity-dot')?.getAttribute('aria-label')).toBeTruthy();
  });

  it('shows a plain dot when the count is unknown', () => {
    __setActivityOverride(() => ({ ...base, unreadCount: null, hasUnread: true }));
    render(<Probe id="c1" />);
    expect(document.querySelector('.activity-dot')).not.toBeNull();
    expect(document.querySelector('.activity-badge')).toBeNull();
  });

  it('shows today as HH:MM and older days as a date', () => {
    const today = new Date();
    today.setHours(14, 30, 0, 0);
    __setActivityOverride(() => ({ ...base, timestamp: today.toISOString() }));
    const first = render(<Probe id="c1" />);
    expect(document.querySelector('.activity-time')?.textContent).toMatch(/^\d{2}:\d{2}$/);
    first.unmount();

    __setActivityOverride(() => ({ ...base, timestamp: '2020-03-04T10:00:00.000Z' }));
    render(<Probe id="c1" />);
    const older = document.querySelector('.activity-time')?.textContent ?? '';
    expect(older).not.toMatch(/^\d{2}:\d{2}$/);
    expect(older.length).toBeGreaterThan(0);
  });
});
