import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useUnreadStore, firstUnreadId } from '../unreadStore';
import type { Message } from '@/types';

const m = (id: string, ts: string, kind: Message['kind'] = 'user'): Message => ({
  id, channel_id: 'c', user_id: 'u', content: 'x', kind, created_at: ts, updated_at: ts,
});

beforeEach(() => {
  window.localStorage.removeItem('vycord.lastRead');
  useUnreadStore.setState({ lastRead: {} });
});

describe('unreadStore', () => {
  it('markRead stores and persists the mark', () => {
    useUnreadStore.getState().markRead('c1', 'm9', '2026-08-25T12:00:00Z');
    expect(useUnreadStore.getState().lastRead.c1).toEqual({ messageId: 'm9', ts: '2026-08-25T12:00:00Z' });
    expect(JSON.parse(window.localStorage.getItem('vycord.lastRead')!)).toHaveProperty('c1');
  });
  it('firstUnreadId: no mark → null (first visit shows no divider)', () => {
    expect(firstUnreadId(undefined, [m('a', '2026-08-25T10:00:00Z')])).toBeNull();
  });
  it('firstUnreadId: returns first message after the mark', () => {
    const mark = { messageId: 'a', ts: '2026-08-25T10:00:00Z' };
    const msgs = [m('a', '2026-08-25T10:00:00Z'), m('b', '2026-08-25T10:01:00Z'), m('c', '2026-08-25T10:02:00Z')];
    expect(firstUnreadId(mark, msgs)).toBe('b');
  });
  it('firstUnreadId: everything read → null', () => {
    const mark = { messageId: 'b', ts: '2026-08-25T10:01:00Z' };
    const msgs = [m('a', '2026-08-25T10:00:00Z'), m('b', '2026-08-25T10:01:00Z')];
    expect(firstUnreadId(mark, msgs)).toBeNull();
  });
  it('firstUnreadId: empty list → null', () => {
    expect(firstUnreadId({ messageId: 'a', ts: '2026-08-25T10:00:00Z' }, [])).toBeNull();
  });
  it('firstUnreadId: skips a call row, returns the next real message', () => {
    const mark = { messageId: 'a', ts: '2026-08-25T10:00:00Z' };
    const msgs = [
      m('a', '2026-08-25T10:00:00Z'),
      m('b', '2026-08-25T10:01:00Z', 'call'),
      m('c', '2026-08-25T10:02:00Z'),
    ];
    expect(firstUnreadId(mark, msgs)).toBe('c');
  });
  it('markRead overwrites a corrupt localStorage payload', () => {
    // Переименован осознанно. Под прежним именем «survives a corrupt payload»
    // тест НЕ проверял то, что обещал: catch живёт в load(), а load() вызывается
    // при инициализации стора, то есть на импорте модуля — раньше любого
    // beforeEach и раньше этой строки. К моменту setItem стор уже построен, и
    // испорченное значение здесь не читает никто. Что тест действительно
    // проверяет — что markRead перезатирает мусор в хранилище, — и это его новое
    // имя. Настоящую половину закрывают три теста ниже.
    window.localStorage.setItem('vycord.lastRead', '{not json');
    useUnreadStore.getState().markRead('c1', 'm1', '2026-08-25T12:00:00Z');
    expect(useUnreadStore.getState().lastRead.c1.messageId).toBe('m1');
    expect(JSON.parse(window.localStorage.getItem('vycord.lastRead')!)).toHaveProperty('c1');
  });
});

// load() читает localStorage ровно один раз — в аргументе create(), то есть на
// импорте модуля. Единственный способ проверить его — импортировать модуль
// заново после того, как хранилище уже заполнено, поэтому здесь vi.resetModules()
// и динамический import вместо статического useUnreadStore сверху файла.
describe('unreadStore: load() at module import', () => {
  const freshLastRead = async () => {
    vi.resetModules();
    const fresh = await import('../unreadStore');
    return fresh.useUnreadStore.getState().lastRead;
  };

  afterEach(() => {
    window.localStorage.removeItem('vycord.lastRead');
    vi.resetModules();
  });

  it('reads a valid payload back', async () => {
    // Положительный контроль, без которого {} в тестах ниже неотличимо от
    // «load() вообще не выполнялся» и все они всегда зелёные.
    const mark = { messageId: 'm9', ts: '2026-08-25T12:00:00Z' };
    window.localStorage.setItem('vycord.lastRead', JSON.stringify({ c9: mark }));
    expect(await freshLastRead()).toEqual({ c9: mark });
  });

  it('falls back to {} on a syntactically corrupt payload (the catch)', async () => {
    window.localStorage.setItem('vycord.lastRead', '{not json');
    expect(await freshLastRead()).toEqual({});
  });

  it('falls back to {} on valid JSON that is not an object (the typeof guard)', async () => {
    // Отдельная ветка от catch: JSON.parse('42') не бросает, и без проверки
    // typeof стор получил бы число вместо словаря отметок.
    window.localStorage.setItem('vycord.lastRead', '42');
    expect(await freshLastRead()).toEqual({});
    window.localStorage.setItem('vycord.lastRead', 'null');
    expect(await freshLastRead()).toEqual({});
  });
});
