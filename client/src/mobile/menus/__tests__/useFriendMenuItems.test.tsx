// client/src/mobile/menus/__tests__/useFriendMenuItems.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFriendMenuItems } from '@/mobile/menus/useFriendMenuItems';
import { t } from '@/i18n';

const user = { user_id: 'u2', username: 'Борис' };

describe('useFriendMenuItems', () => {
  it('без действий — пустой список', () => {
    const { result } = renderHook(() => useFriendMenuItems(user, {}));
    expect(result.current).toEqual([]);
  });

  it('онлайн-друг: звонок первым, затем удалить/заблокировать опасной группой', () => {
    const { result } = renderHook(() => useFriendMenuItems(user, {
      onCall: vi.fn(), onRemove: vi.fn(), onBlock: vi.fn(),
    }));
    expect(result.current.map((i) => i.label)).toEqual([
      t('server.callUser', { name: 'Борис' }), t('friends.remove'), t('friends.block'),
    ]);
    expect(result.current[1].danger).toBe(true);
    expect(result.current[2].danger).toBe(true);
  });

  it('заблокированный: только «Разблокировать»', () => {
    const { result } = renderHook(() => useFriendMenuItems(user, { onUnblock: vi.fn() }));
    expect(result.current.map((i) => i.label)).toEqual([t('friends.unblock')]);
  });
});
