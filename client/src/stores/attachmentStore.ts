import { create } from 'zustand';
import type { Attachment } from '@/types';

export interface DraftAttachment {
  /** Локальный id: у файла ещё нет серверного, пока идёт загрузка. */
  localId: string;
  file: File;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  attachment?: Attachment;
  errorCode?: string;
  abort: () => void;
}

interface AttachmentState {
  /** Черновики по каналам: уход в другой канал не должен терять загрузку. */
  drafts: Map<string, DraftAttachment[]>;
  add: (channelId: string, draft: DraftAttachment) => void;
  update: (channelId: string, localId: string, patch: Partial<DraftAttachment>) => void;
  remove: (channelId: string, localId: string) => void;
  clear: (channelId: string) => void;
  getDrafts: (channelId: string) => DraftAttachment[];
}

export const useAttachmentStore = create<AttachmentState>((set, get) => ({
  drafts: new Map(),

  add: (channelId, draft) =>
    set((s) => {
      const next = new Map(s.drafts);
      next.set(channelId, [...(next.get(channelId) ?? []), draft]);
      return { drafts: next };
    }),

  update: (channelId, localId, patch) =>
    set((s) => {
      const list = s.drafts.get(channelId);
      if (!list) return s;
      const next = new Map(s.drafts);
      next.set(
        channelId,
        list.map((d) => (d.localId === localId ? { ...d, ...patch } : d)),
      );
      return { drafts: next };
    }),

  remove: (channelId, localId) =>
    set((s) => {
      const list = s.drafts.get(channelId);
      if (!list) return s;
      const next = new Map(s.drafts);
      next.set(channelId, list.filter((d) => d.localId !== localId));
      return { drafts: next };
    }),

  clear: (channelId) =>
    set((s) => {
      const next = new Map(s.drafts);
      next.delete(channelId);
      return { drafts: next };
    }),

  getDrafts: (channelId) => get().drafts.get(channelId) ?? [],
}));
