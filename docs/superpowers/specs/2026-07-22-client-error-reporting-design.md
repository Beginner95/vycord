# Error reporting для клиента (VYC — борда: «📱 Клиент»)

Дата: 2026-07-22

## Проблема

Продовые баги клиента (веб + Electron) сейчас невоспроизводимы: код ловит ошибки
~25 разрозненными `console.error(...)` по всему `client/src` (websocket.ts,
call.ts, groupCall.ts, ChatArea.tsx, AppPage.tsx, GroupCallUI.tsx,
noiseCancellation.ts, UserList.tsx, AudioSettings.tsx), которые видны только
в devtools конкретного пользователя и никуда не сохраняются. Нет
`ErrorBoundary`, нет глобального перехвата необработанных исключений/promise
rejection, нет привязки ошибки к версии сборки. Разработчик узнаёт о баге
только если пользователь сам его описал.

## Решение

Self-hosted **GlitchTip** (Sentry-protocol-совместимый, MIT, без лимитов на
события) как error-tracking backend + `@sentry/react` в клиенте,
`@sentry/electron` в Electron main-процессе, плюс кастомный fallback-экран
ErrorBoundary в фирменном стиле приложения.

### Почему GlitchTip, а не hosted Sentry

Вся остальная инфраструктура проекта (Postgres, Redis, coturn, деплой) уже
self-hosted на одном VPS через `docker-compose.prod.yml` — GlitchTip
логично продолжает этот подход: бесплатно без лимита событий, данные не
уходят к третьей стороне, использует тот же Sentry-протокол/SDK, что и
hosted-вариант (легко мигрировать при необходимости).

## 1. Инфраструктура

**Проверено напрямую по образу** (`docker pull glitchtip/glitchtip:latest`,
`docker inspect`, `docker run --entrypoint cat .../bin/start.sh` и соседние
скрипты — версия `GLITCHTIP_VERSION=6.2.2`): начиная с этой версии GlitchTip
**больше не использует Celery** (пакет не установлен в образе) — фоновые
задачи и периодический шедулинг реализованы через собственный пакет
`django-vtasks` («valkey/postgres django tasks backend», подтверждено
`pip show`), поэтому `REDIS_URL` по-прежнему нужен (Valkey-протокол
Redis-совместим), а вот команд `./manage.py migrate` как отдельного шага и
скрипта `./bin/run-celery-with-beat.sh` в образе не существует — есть только
`bin/start.sh`, диспетчеризующий по переменной `SERVER_ROLE`
(`web` / `worker` / `worker_with_beat` / `all_in_one`) на
`bin/run-web.sh` / `bin/run-worker.sh` / `bin/run-all-in-one.sh`.

`bin/run-all-in-one.sh` — режим, который сам образ считает рекомендованным
для однонодных инсталляций: на старте (идемпотентно, если `SKIP_INIT` не
выставлен) прогоняет `manage.py migrate --no-input --skip-checks`,
`manage.py maintain_partitions` и создание cache-таблицы, включает embedded
worker (`GLITCHTIP_EMBED_WORKER=true`) и поднимает web через `granian` на
порту `${PORT:-8000}` (порт `8000` — реальный дефолт образа, подтверждён
`docker inspect .Config.ExposedPorts`).

Поэтому вместо изначально задуманных трёх сервисов (`migrate`/`web`/`worker`)
в `docker-compose.prod.yml` — **два** сервиса:

- `glitchtip-db-init` — one-shot, создаёт БД `glitchtip` в существующем
  Postgres (см. ниже) — сам образ GlitchTip создать базу не может, только
  мигрировать в уже существующую.
- `glitchtip` — единственный контейнер приложения, `SERVER_ROLE=all_in_one`,
  слушает `127.0.0.1:8000:8000` (bind только на localhost, наружу через
  nginx, как `api`/`client`). Зависит от `postgres`/`redis` (healthy) и
  `glitchtip-db-init` (completed).

Переиспользуются существующие `postgres` и `redis` контейнеры:
- Отдельная база `glitchtip` в том же Postgres-инстансе (создаётся
  миграцией/`CREATE DATABASE` при первом деплое).
- Redis — тот же контейнер, отдельный db-индекс (например `redis://redis:6379/1`),
  чтобы не пересекаться с использованием hub/presence.

Переменные окружения (`.env.prod`):
- `GLITCHTIP_SECRET_KEY` — генерируется один раз (`openssl rand -hex 32`).
- `GLITCHTIP_DOMAIN=https://errors.vycord.webvaha.ru`
- `GLITCHTIP_DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/glitchtip`
- `GLITCHTIP_REDIS_URL=redis://redis:6379/1`
- `EMAIL_URL=consolemail://` (email отключён/в консоль — не нужны SMTP-креды
  ради MVP; можно донастроить позже)
- `ENABLE_ORGANIZATION_CREATION=true` (для первичного создания организации
  через UI после деплоя)

Nginx: новый файл `deploy/nginx/errors.vycord.webvaha.ru.conf` по образцу
`api.vycord.webvaha.ru.conf` — `proxy_pass http://127.0.0.1:8000`, редирект
80→443, `ssl_certificate` на новый сертификат.

**Ручные шаги на сервере (выполняет пользователь, не автоматизируются)**:
1. DNS A-запись `errors.vycord.webvaha.ru` → IP VPS.
2. `certbot certonly` для нового домена (аналогично тому, как заведён
   `api.vycord.webvaha.ru`).
3. `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`.
4. Зайти на `https://errors.vycord.webvaha.ru`, создать первого юзера/организацию
   (`ENABLE_ORGANIZATION_CREATION=true` только на этот момент, затем можно
   выключить), создать проект `vycord-client`, скопировать DSN.
5. Вписать DSN в `.env.prod` как `VITE_SENTRY_DSN` и передать его как
   `build.args` в сервис `client` в `docker-compose.prod.yml` (по аналогии с
   `VITE_API_URL`).

## 2. SDK и инструментирование клиента

### Инициализация (renderer / web)

`client/src/services/errorReporting.ts`:
```
initErrorReporting() // вызывается один раз из main.tsx перед рендером
```
- `Sentry.init({ dsn, environment, release, integrations, tracesSampleRate: 0 })`
  — perf-мониторинг не нужен (MVP — только ошибки), `tracesSampleRate: 0`
  экономит события.
- Инициализация выполняется, только если `import.meta.env.VITE_SENTRY_DSN`
  задан **и** `import.meta.env.PROD` — в dev по умолчанию ничего никуда не
  уходит (не засоряем GlitchTip локальным шумом при разработке).
- `release` — версия из `package.json`, прокидывается через
  `vite.config.ts` → `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`.
- Тег `platform`: `web` / `electron-renderer` — определяется по наличию
  `window.electronAPI` (уже прокидывается через существующий preload
  contextBridge).
- `beforeBreadcrumb`/`beforeSend`: санитайзер, вырезающий `token=...` из
  query-строк URL (WS/SFU-подключения передают JWT как query-параметр — см.
  `call.ts`/`groupCall.ts`), чтобы токены не улетали в события.
- Необработанные исключения и unhandled promise rejection ловятся дефолтными
  интеграциями SDK автоматически — отдельного кода не требуется.

### Electron main process

В самом начале `client/electron/main.ts` (до `app.whenReady()`):
```
Sentry.init({ dsn, environment, release: app.getVersion() })
```
из `@sentry/electron/main` — отдельная от renderer инициализация, ловит
краши main-процесса и нативные крэши (встроенный crashReporter). DSN тот же,
но событие помечено тегом `platform: electron-main`.

### Логгер-обёртка

`client/src/utils/logger.ts`:
```ts
logger.error(message: string, error: unknown, extra?: Record<string, unknown>)
```
- Пишет в `console.error` (сохраняем текущее поведение для локальной
  отладки) и параллельно вызывает `Sentry.captureException(error, { tags: {...}, extra })`.
- Заменяются существующие точечные `console.error(...)` во всех
  перечисленных выше файлах на `logger.error(...)` с тегом модуля (`ws`,
  `call`, `groupCall`, `chat`, `app`, `nc`, `settings`) — это и есть тот
  самый разбор существующего логирования: сейчас происходящие в проде
  ошибки (WS-разрывы, сбои групповых звонков, ошибки отправки сообщений)
  реально долетают до трекера, а не теряются в консоли пользователя.
- Точечные (не крашащие дерево) ошибки не получают новых visual popup —
  поведение для пользователя не меняется, меняется только то, что ошибка
  теперь ещё и отправляется в GlitchTip.

## 3. UI/UX — экран краша и фидбэк

`client/src/components/ErrorBoundary.tsx` — обёртка вокруг `Sentry.ErrorBoundary`
из `@sentry/react` с кастомным `fallback` (свой UI вместо встроенного iframe
report-диалога Sentry — чтобы визуально совпадал с остальным приложением и не
зависел от стороннего домена). Оборачивает `<AppRouter />` в `App.tsx`.

**Fallback-экран** (карточка по центру экрана, использует существующие
CSS-переменные `--bg-*`/`--brand-*`/`--text-*`, поддерживает both themes):
- Иконка + заголовок «Что-то пошло не так» + короткая поддерживающая
  подпись («Мы уже знаем об этом. Попробуйте перезагрузить приложение»).
- Кнопка **«Перезагрузить»** (primary, `window.location.reload()`).
- Мелкая строка с `event.id` (из `Sentry.showReportDialog`/
  `Sentry.lastEventId()`) и кнопкой **«Скопировать ID»** — на случай, если
  пользователь пишет в поддержку напрямую.
- Раскрывающееся (`<details>`/accordion) необязательное поле **«Что вы
  делали, когда это произошло?»** + кнопка **«Отправить»**.
  - По отправке — **не** полагаемся на `Sentry.captureUserFeedback`
    (совместимость эндпоинта user-feedback с GlitchTip не гарантирована),
    а шлём обычный `Sentry.captureMessage('User feedback', { level: 'info',
    tags: { associated_event_id: <id из краша> }, extra: { comments } })` —
    гарантированно долетает через тот же протокол, что и обычные события.
  - После отправки кнопка меняется на «Спасибо, отправлено ✓» без повторной
    отправки (локальный флаг в state компонента).

## 4. Конфигурация/секреты

- `.env.prod`: `VITE_SENTRY_DSN`, `GLITCHTIP_SECRET_KEY`,
  `GLITCHTIP_DATABASE_URL`, `GLITCHTIP_REDIS_URL`, `GLITCHTIP_DOMAIN`,
  `EMAIL_URL`.
- `client/.env.production`: `VITE_SENTRY_DSN=` (плейсхолдер, реальное
  значение проставляется в `.env.prod`/build args на проде — DSN сам по себе
  не секрет, это публичный идентификатор, предназначенный для встраивания в
  клиентский бандл, как и остальные `VITE_*` в этом файле).
- `docker-compose.prod.yml`: сервис `client` — добавить `VITE_SENTRY_DSN` в
  `build.args`, аналогично `VITE_API_URL`.
- Локальный dev (`docker-compose.yml`) — GlitchTip не поднимается, не нужен
  для разработки.

## 5. Зависимости

- `client/package.json`: `@sentry/react`, `@sentry/electron` — добавляются
  в `dependencies` (не dev).

## 6. Верификация

1. `npm run build` (tsc + vite build) проходит без ошибок с новыми
   зависимостями.
2. Локально (`VITE_SENTRY_DSN` не задан) — в консоли подтверждаем, что
   инициализация Sentry пропущена (нет сетевых запросов к GlitchTip).
3. После деплоя на прод — намеренно вызвать тестовую ошибку (временная
   кнопка/консольный вызов), убедиться, что событие появилось в GlitchTip
   дашборде с правильными `release`/`platform`, без токена в breadcrumbs/URL.
4. Проверить ErrorBoundary: смонтировать компонент, кидающий исключение при
   рендере (временно, в dev), убедиться, что показывается кастомный
   fallback, а не белый экран/дефолтный React error overlay в prod-сборке.

## Вне рамок (не делаем сейчас)

- Performance monitoring / tracing (`tracesSampleRate: 0`).
- Source maps upload в GlitchTip (полезно для читаемых стектрейсов, но
  отдельная работа — можно сделать отдельным тикетом после MVP).
- Email-алерты из GlitchTip (SMTP не настраиваем, `EMAIL_URL=consolemail://`).
- Server-side (Go API/SFU) error reporting — задача только про клиент.
