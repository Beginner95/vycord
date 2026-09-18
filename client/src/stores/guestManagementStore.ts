import { create } from 'zustand';
import { apiService } from '@/services/api';
import { publicWebUrl } from '@/services/callCredentials';
import type { CallGuest, GuestLink } from '@/types';

/**
 * Гости звонка глазами участника с аккаунтом: свои ссылки, гости в звонке и
 * очередь лобби (docs/superpowers/specs/2026-09-17-guest-call-link-design.md,
 * раздел 4). Состояние приходит из двух источников — HTTP при открытии
 * поповера и события хаба через мост callStore.
 *
 * Секрет ссылки здесь не хранится нигде, кроме `lastLink`: он существует ровно
 * столько, сколько открыт поповер, из которого его копируют.
 */

export interface GuestLobbyRequest {
  channel_id: string;
  guest_id: string;
  display_name: string;
  link_id: string;
  link_created_by?: string;
}

export interface GuestLobbyResolved {
  channel_id: string;
  guest_id: string;
  result: string;
  by_user_id?: string;
}

export interface GuestParticipantsEvent {
  channel_id: string;
  guests: { id: string; display_name: string }[];
}

export interface LobbyEntry extends GuestLobbyRequest {
  /** Кто решил — заполняется, когда впустил или отклонил кто-то другой. */
  resolvedBy?: string;
  resolvedResult?: string;
}

interface GuestManagementState {
  channelId: string | null;
  links: GuestLink[];
  guests: CallGuest[];
  /** Гости голосового канала по данным хаба: id вида «guest:<uuid>». */
  channelGuests: Map<string, { id: string; display_name: string }[]>;
  lobby: LobbyEntry[];
  lastLink: { id: string; url: string } | null;

  refresh: (channelId: string) => Promise<void>;
  createLink: (channelId: string) => Promise<{ id: string; url: string } | null>;
  revoke: (linkId: string) => Promise<void>;
  admit: (guestId: string) => Promise<void>;
  reject: (guestId: string) => Promise<void>;
  kick: (guestId: string, ban: boolean) => Promise<void>;

  onLobbyRequest: (payload: GuestLobbyRequest) => void;
  onLobbyResolved: (payload: GuestLobbyResolved) => void;
  onGuestParticipants: (payload: GuestParticipantsEvent) => void;

  reset: () => void;
}

const empty = () => ({
  channelId: null,
  links: [] as GuestLink[],
  guests: [] as CallGuest[],
  channelGuests: new Map<string, { id: string; display_name: string }[]>(),
  lobby: [] as LobbyEntry[],
  lastLink: null,
});

export const useGuestManagementStore = create<GuestManagementState>((set, get) => ({
  ...empty(),

  refresh: async (channelId) => {
    const state = await apiService.listGuestLinks(channelId);
    set({ channelId, links: state.links ?? [], guests: state.guests ?? [] });
  },

  createLink: async (channelId) => {
    const created = await apiService.createGuestLink(channelId);
    // Ссылку собирает клиент: серверу веб-домен неизвестен, а в Electron
    // location.origin — это file://.
    const url = `${publicWebUrl()}/guest#${created.secret}`;
    const link = { id: created.id, url };
    set({ lastLink: link });
    await get().refresh(channelId);
    return link;
  },

  revoke: async (linkId) => {
    await apiService.revokeGuestLink(linkId);
    set((s) => ({
      links: s.links.filter((l) => l.id !== linkId),
      guests: s.guests.filter((g) => g.link_id !== linkId),
      lastLink: s.lastLink?.id === linkId ? null : s.lastLink,
    }));
  },

  admit: async (guestId) => {
    await apiService.admitGuest(guestId);
    set((s) => ({ lobby: s.lobby.filter((entry) => entry.guest_id !== guestId) }));
  },

  reject: async (guestId) => {
    await apiService.rejectGuest(guestId);
    set((s) => ({ lobby: s.lobby.filter((entry) => entry.guest_id !== guestId) }));
  },

  kick: async (guestId, ban) => {
    await apiService.kickGuest(guestId, ban);
    set((s) => ({ guests: s.guests.filter((g) => g.id !== guestId) }));
  },

  onLobbyRequest: (payload) => {
    set((s) =>
      s.lobby.some((entry) => entry.guest_id === payload.guest_id)
        ? {}
        : { lobby: [...s.lobby, payload] },
    );
  },

  onLobbyResolved: (payload) => {
    set((s) => ({ lobby: s.lobby.filter((entry) => entry.guest_id !== payload.guest_id) }));
  },

  onGuestParticipants: (payload) => {
    set((s) => {
      const next = new Map(s.channelGuests);
      if (payload.guests.length === 0) {
        next.delete(payload.channel_id);
      } else {
        next.set(payload.channel_id, payload.guests);
      }
      return { channelGuests: next };
    });
  },

  reset: () => set(empty()),
}));

/** Имя гостя по его идентификатору в звонке («guest:<uuid>»). */
export function guestDisplayName(identity: string): string | null {
  const { channelGuests } = useGuestManagementStore.getState();
  for (const guests of channelGuests.values()) {
    const match = guests.find((guest) => guest.id === identity);
    if (match) return match.display_name;
  }
  return null;
}
