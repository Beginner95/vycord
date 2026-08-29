import { create } from 'zustand';

// Канал команд существует ТОЛЬКО для двух действий чат-поверхности: панель
// MessageSearch и jumpToMessage живут внутри ChatArea и не поднимаются наверх
// (им нужны channel + локальный historyMode/highlightedId/ref). Всё остальное
// палитра вызывает прямыми колбэками AppPage — см. решение 5.
export type PaletteCommand =
  | { kind: 'chat-search'; id: number; channelId: string; query: string }
  | { kind: 'chat-jump'; id: number; channelId: string; messageId: string };

interface PaletteState {
  isOpen: boolean;
  command: PaletteCommand | null;
  open: () => void;
  close: () => void;
  searchInChannel: (channelId: string, query: string) => void;
  jumpToMessage: (channelId: string, messageId: string) => void;
  /** Снимает команду, только если это всё ещё она: потребитель не должен
   *  затирать более новую команду, пришедшую между рендером и эффектом. */
  clearCommand: (id: number) => void;
}

let nextCommandId = 1;

export const usePaletteStore = create<PaletteState>((set) => ({
  isOpen: false,
  command: null,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  searchInChannel: (channelId, query) =>
    set({ command: { kind: 'chat-search', id: nextCommandId++, channelId, query } }),
  jumpToMessage: (channelId, messageId) =>
    set({ command: { kind: 'chat-jump', id: nextCommandId++, channelId, messageId } }),
  clearCommand: (id) => set((state) => (state.command?.id === id ? { command: null } : state)),
}));
