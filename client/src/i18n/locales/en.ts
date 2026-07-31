import { plural } from '../plural';
import type { Dictionary } from './ru';

export const en: Dictionary = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    close: 'Close',
    loading: 'Loading...',
  },
  auth: {},
  chat: {},
  call: {
    participants: plural({
      one: '{{count}} participant',
      other: '{{count}} participants',
    }),
  },
  settings: {},
  server: {},
  channel: {},
  update: {},
  errors: {
    unknown: 'Unknown error',
  },
};
