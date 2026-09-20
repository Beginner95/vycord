export type TabId = 'servers' | 'friends' | 'profile';

export type SettingsSection = 'profile' | 'privacy' | 'audio' | 'video' | 'appearance' | 'language';

export type Screen =
  | { kind: 'servers' }
  | { kind: 'friends' }
  | { kind: 'profile' }
  | { kind: 'channels'; serverId: string }
  | { kind: 'chat'; channelId: string }
  | { kind: 'channelInfo'; channelId: string }
  | { kind: 'call' }
  | { kind: 'serverSettings'; serverId: string }
  | { kind: 'invites'; serverId: string }
  | { kind: 'stickers'; serverId: string }
  | { kind: 'createServer' }
  | { kind: 'findServer' }
  | { kind: 'search' }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'friendAdd' }
  | { kind: 'guestCall' }
  | { kind: 'guestChat' }
  | { kind: 'guestParticipants' }
  | { kind: 'sheet'; id: string };

export type Stack = readonly Screen[];
