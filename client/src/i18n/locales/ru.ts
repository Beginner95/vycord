import { plural } from '../plural';

export const ru = {
  common: {
    save: 'Сохранить',
    cancel: 'Отмена',
    delete: 'Удалить',
    close: 'Закрыть',
    loading: 'Загрузка...',
  },
  auth: {},
  chat: {},
  call: {
    participants: plural({
      one: '{{count}} участник',
      few: '{{count}} участника',
      many: '{{count}} участников',
      other: '{{count}} участника',
    }),
  },
  settings: {},
  server: {},
  channel: {},
  update: {},
  errors: {
    unknown: 'Неизвестная ошибка',
  },
};

export type Dictionary = typeof ru;
