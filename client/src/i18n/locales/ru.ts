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
  settings: {
    language: 'Язык',
    languageDescription: 'Язык интерфейса приложения',
    languageNameRu: 'Русский',
    languageNameEn: 'English',
  },
  server: {},
  channel: {},
  update: {},
  errors: {
    unknown: 'Неизвестная ошибка',
  },
};

export type Dictionary = typeof ru;
