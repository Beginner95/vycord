import { create } from 'zustand';
import type { Attachment, Message } from '@/types';

/** Локальная запись голосового до/во время отправки (VYC-101). Никогда не уходит на сервер. */
export interface PendingVoice {
  blob: Blob;
  objectUrl: string;
  mimeType: string;
  durationMs: number;
  waveform: number[];
  /** Есть, если загрузка прошла — retry тогда не грузит файл заново. */
  attachment?: Attachment;
}

/** Client-only delivery state for optimistic send (spec §4.4). Never sent to the server. */
export type ChatMessage = Message & { deliveryState?: 'sending' | 'failed'; pendingVoice?: PendingVoice };

interface MessageState {
  messages: ChatMessage[];
  loading: boolean;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  replaceMessage: (id: string, message: ChatMessage) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  loading: false,

  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  replaceMessage: (id, message) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? message : m)),
    })),
  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((m) => m.id !== id) })),
  clearMessages: () => set({ messages: [] }),
  setLoading: (loading) => set({ loading }),
}));
