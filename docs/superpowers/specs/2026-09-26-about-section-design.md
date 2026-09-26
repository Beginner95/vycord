# VYC-98 «О приложении» — design

Дата: 2026-09-26. Ветка: `VYC-98-about`.

## Что делаем

Новый раздел настроек «О приложении» на десктопе и в мобильной (PWA) версии:

1. Шапка: иконка приложения + название «Vycord»
2. Описание — суть приложения
3. Текущая версия (`__APP_VERSION__` из `package.json`, сейчас 2.5.1)
4. Строка «GitHub» → `https://github.com/Beginner95/vycord`
5. Строка «Сообщить о проблеме» → `https://github.com/Beginner95/vycord/issues`

## Подход

Единый компонент `AboutBody.tsx`, монтируется на обе платформы — тот же
паттерн, что `ProfileAccountBody`/`PrivacyBody`/`LanguageBody` (VYC-95).
Отдельная модалка или две реализации — отклонены (см. brainstorming).

## Изменения

### Новые файлы

- `client/src/components/settings/AboutBody.tsx` — тело раздела:
  - `<div class="settings-section">` (общий контейнер, отступы как у
    `AppearanceSettings`)
  - шапка `<div class="about-header">`: иконка `/icon.png` (~72px, радиус
    `--radius-card`) по центру + название «Vycord» (`--ink`)
  - описание по центру, `--muted`
  - разделитель `--line`, затем строки:
    - «Версия» — `setting-row`, значение `--muted`, не кликабельная
    - «GitHub» — кликабельная `setting-row` + модификатор
      `setting-row-link`: `ArrowUpRight` 16px справа, hover — `--accent-text`
    - «Сообщить о проблеме» — то же
  - внешние ссылки: `<a target="_blank" rel="noopener noreferrer">`
    (паттерн `MessageRow.tsx:67`)
- `client/src/components/settings/AboutBody.css` — только шапка и
  `setting-row-link` (всё остальное берёт из `Settings.css`). Токены из
  tokens.css, новых raw-цветов нет. Классы по дизайн-системе: `about-header`,
  `about-logo`, `about-name`, `setting-row-link` (последний — на
  существующей базе `setting-row`).

### Правки существующих

- `client/src/components/Settings.tsx` (desktop): `SettingsTab` += `'about'`;
  `TABS` += вкладка с иконкой `Info` и `labelKey: settings.tabAbout`; рендер
  `{activeTab === 'about' && <AboutBody />}`; импорт `Info` из lucide-react
- `client/src/mobile/nav/types.ts`: `SettingsSection` += `'about'`
- `client/src/mobile/screens/ProfileScreen.tsx`: `ROWS` += пункт «О
  приложении», **последней строкой** (после «Язык» — тест
  `ProfileScreen.test.tsx:39` хардкодит индекс `[5]` для «Язык» и не
  ломается)
- `client/src/mobile/screens/SettingsScreen.tsx`: `TITLE_KEY` += `about` →
  `settings.tabAbout`; рендер `{section === 'about' && <AboutBody />}`
- `client/src/i18n/locales/ru.ts` (источник) и `en.ts` (в одном коммите):
  - `settings.tabAbout`: «О приложении» / «About»
  - `settings.aboutDescription`: «Мессенджер для голосовых и видеозвонков,
    чатов и своих серверов — с нейроочисткой шума» / «A messenger for voice
    and video calls, chats and your own servers — with AI noise cancellation»
  - `settings.aboutVersionLabel`: «Версия» / «Version»
  - `settings.aboutGithub`: «GitHub» / «GitHub»
  - `settings.aboutReportIssue`: «Сообщить о проблеме» / «Report an issue»
  - Название «Vycord» — имя собственное, вне i18n

Версия: `__APP_VERSION__` уже определён в `vite.config` из `package.json`
(define) и используется в `services/errorReporting.ts`; новый механизм не
нужен.

## Тестирование

- Новый `AboutBody.test.tsx`: рендер тела — описание, версия, обе ссылки с
  корректными `href`
- Гейты (из `client/`, см. `client/CLAUDE.md`):
  - `npx tsc --noEmit` — ноль байт на выходе (ловит рассинхрон ru/en)
  - `npx stylelint "src/**/*.css"` — ноль байт
  - `npm run check:i18n` — «непереведённых строк не найдено.»
  - `npm test` — ровно 3 фейла, все в `api.network-retry.test.ts` (красно
    by design; новое не должно добавить фейлов)
- Ручная проверка: обе темы, узкая ширина (см. дизайн-система,
    «click through»), клик по ссылкам

## Вне объёма

- Лицензия MIT (отклонена пользователем)
- Отдельная страница/модалка «О приложении» со скриншотами (YAGNI)
- Показ URL текстом