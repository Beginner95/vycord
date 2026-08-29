import { describe, it, expect, beforeEach } from 'vitest';
import { usePaletteStore } from '../paletteStore';

describe('paletteStore', () => {
  beforeEach(() => usePaletteStore.setState({ isOpen: false, command: null }));

  it('opens and closes', () => {
    usePaletteStore.getState().open();
    expect(usePaletteStore.getState().isOpen).toBe(true);
    usePaletteStore.getState().close();
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it('stamps each command with a fresh id', () => {
    usePaletteStore.getState().searchInChannel('c1', 'баг');
    const first = usePaletteStore.getState().command;
    usePaletteStore.getState().searchInChannel('c1', 'баг');
    const second = usePaletteStore.getState().command;
    expect(first?.id).not.toBe(second?.id);
  });

  it('carries the channel id and payload', () => {
    usePaletteStore.getState().jumpToMessage('c1', 'm9');
    expect(usePaletteStore.getState().command).toMatchObject({
      kind: 'chat-jump', channelId: 'c1', messageId: 'm9',
    });
  });

  it('clears only the command whose id matches', () => {
    usePaletteStore.getState().searchInChannel('c1', 'a');
    const stale = usePaletteStore.getState().command!.id;
    usePaletteStore.getState().searchInChannel('c1', 'b');
    usePaletteStore.getState().clearCommand(stale);
    expect(usePaletteStore.getState().command).not.toBeNull();
    usePaletteStore.getState().clearCommand(usePaletteStore.getState().command!.id);
    expect(usePaletteStore.getState().command).toBeNull();
  });
});
