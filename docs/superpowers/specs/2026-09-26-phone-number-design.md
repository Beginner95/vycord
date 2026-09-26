# Добавление номера телефона пользователя

Дата: 2026-09-26
Ветка: `VYC-97-phone`

## Цели

1. Пользователь может добавить номер телефона в настройках профиля.
2. Запрос в друзья можно отправить по номеру телефона либо по имени (как сейчас).
3. При отправке по номеру приложение показывает имя найденного пользователя.

## Решение о верификации

SMS-верификация **не вводится** на этом этапе: SMS-провайдер не подключён.
Принятый риск — кто угодно может первым занять чужой номер. Митигации:

- номер хранится зашифрованным и существует только как ключ поиска — нигде в
  UI и API не отображается (кроме маскированного вида в собственном профиле);
- колонка `phone_verified_at` (nullable) создаётся сразу — подключение
  SMS-верификации позже не потребует миграции и ломки API;
- rate limit на PUT phone (см. «Безопасность»).

## Хранилище

Миграция `026_phone.up.sql`:

```sql
ALTER TABLE users ADD COLUMN phone_index TEXT UNIQUE;
ALTER TABLE users ADD COLUMN phone_cipher TEXT;
ALTER TABLE users ADD COLUMN allow_search_by_phone BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN phone_verified_at TIMESTAMPTZ;
```

`026_phone.down.sql` — снять колонки.

Дефолт `allow_search_by_phone = true` согласован с открытыми дефолтами
существующих настроек (`allow_friend_requests = 'everyone'`, `show_last_seen = true`).

`domain.User`:
- `PhoneIndex *string` с `json:"-"` — детерминированный поисковый ключ;
- `PhoneCipher *string` с `json:"-"` — зашифрованное значение;
- `AllowSearchByPhone bool` с `json:"-"` — как остальные privacy-поля, наружу
  только через `meResponse`;
- `PhoneVerifiedAt *time.Time` с `json:"-"` — не используется в этом этапе,
  задел под SMS.

## Шифрование номера

Открытым текстом номер в БД не хранится никогда. Схема «слепой индекс +
AEAD»: детерминированный поиск (тот же номер → то же значение, иначе
UNIQUE и поиск сломались бы) совмещён с настоящим шифрованием значения.
Детерминированные шифры (ECB, фиксированный IV у GCM) отвергнуты — они
светят паттерны; вместо этого:

- **Ключ**: 32 байта (AES-256) из env `PHONE_ENC_KEY` (hex, 64 символа).
  Один на все номера. **Обязателен** — fail-fast при старте, по образцу
  `JWT_SECRET`/`OTP_SECRET` в `config.New()`. Новое поле
  `config.Config.PhoneEncKey`. Ротация ключа — не в скоупе (смена ключа
  потребовала бы перешифрования всех номеров).
- **`phone_index`**: `hex(HMAC-SHA256(key, "phone:" + нормализованный_номер))`.
  По нему — поиск и проверка уникальности. Детерминирован.
- **`phone_cipher`**: `base64(nonce || ciphertext)` от AES-256-GCM. Nonce
  случайный (12 байт, `crypto/rand`) на каждое шифрование — одинаковые
  номера в БД неразличимы по паттерну.
- **Зависимости**: только stdlib (`crypto/aes`, `crypto/cipher`,
  `crypto/hmac`, `crypto/sha256`, `crypto/rand`) — ноль новых go-зависимостей.
- **Расшифровка «при желании»**: зная `PHONE_ENC_KEY`, любой AES-256-GCM
  инструмент расшифровывает любой `phone_cipher` (формат документирован
  выше). Отдельная CLI-утилита в скоуп не входит.

Функции (usecase или pkg `phonecrypto`):
- `EncryptPhone(key, normalized) (index, cipher string, err error)`;
- `DecryptPhone(key, cipher string) (normalized string, err error)`;
- `MaskPhone(normalized string) string` — маска для показа.

## Нормализация номера

Единственный источник истины — сервер. `NormalizePhone(s string) (string, error)`:

1. Убрать пробелы, тире, скобки.
2. Ведущая `8` → `+7`.
3. Требуется итоговая форма `^\+[0-9]{10,14}$` (11–15 цифр с `+`, E.164).
4. Иначе — ошибка `ErrInvalidPhone`.

Применяется и при установке номера, и при поиске в `SendRequest` — ввод
`8 912 345-67-89` находит сохранённый `+79123456789`.

## Маска для показа

`MaskPhone(normalized)`: первые 6 символов (`+7` + 4 цифры) + `" ••• •• "` +
последние 2 цифры. Пример: `+79123456789` → `+79123 ••• •• 89`.
В `meResponse` возвращается готовая маска (`phone_masked`) — открытый номер
сервер не покидает.

## Серверные эндпоинты

### Установка/удаление номера

- `PUT /api/v1/users/me/phone`, body `{"phone": "..."}`:
  - нормализация; невалидный номер → 400 `phone_invalid`;
  - `phone_index` уже принадлежит другому пользователю → 409 `phone_taken`
    (константа в `httperr.go`, по аналогии с `email_taken`);
  - идемпотентность: повторный PUT тем же номером → 200;
  - `phone_verified_at` остаётся NULL (нет верификации);
  - ответ — `meResponse` c `phone_masked`.
- `DELETE /api/v1/users/me/phone`:
  - обнуляет `phone_index` и `phone_cipher` (освобождает номер);
  - без номера → идемпотентный 200;
  - ответ — `meResponse`.
- Rate limit: отдельный `ratelimit.Limiter` с ключом по user ID на PUT
  (для DELETE не нужен).

Реализация обновления — через `Repository` с явными колонками
(`phone_index`, `phone_cipher`) и методом поиска по индексу.

### Отдача маски

`meResponse` (handler/user.go) получает `phone_masked: string | null`:
расшифровка `phone_cipher` → `MaskPhone` → включить в ответ. Открытый номер
в ответах не появляется нигде.

### Запрос в друзья

`POST /api/v1/friends/requests` — body принимает опциональное
`{"username": "...", "phone": "..."}`, требуется ровно один из ключей
(оба → 400 `invalid_request_body`, ни одного → 400 `username_required`
как сейчас).

- Handler определяет ключ по наличию поля (не по форме строки).
- Usecase `SendRequest`:
  - если `phone` — нормализация → `phone_index` → `GetByPhoneIndex`, иначе
    `GetByUsername`;
  - общий путь дальше без изменений: `canInteract`, `GetByPair`/`Create`,
    WS-пуши `friend_request` / `friend_added`.
- Поиск по номеру при выключенном `allow_search_by_phone` → 404
  `user_not_found` (опакно: не отличаем «номер не существует» от «скрыт»).
- Ответ без изменений: `{status: "pending", request: {id, user: {user_id,
  username, avatar_url}, created_at}}` — имя найденного пользователя уже в
  ответе (требование 3).

Ошибки без изменений: `friend_self`, `friend_request_exists`,
`already_friends`, `interaction_forbidden`.

## Безопасность

- Номер **в открытом виде**: не в БД (только index + cipher), не в ответах
  (только `phone_masked` в `meResponse`), не в сети, не в JS-бundle, не в
  логах. Покидает сервер в открытом виде только внутри процесса при его
  установке (и в `phone_cipher`).
- Утечка БД без `PHONE_ENC_KEY` → номера нечитаемы; одинаковые номера
  неразличимы по шифротексту; уникальность и поиск не зависят от расшифровки.
- Тумблер выключен → непрозрачный 404.
- Смена номера освобождает старый сразу (без верификации иначе нельзя).
- `PHONE_ENC_KEY` обязателен при старте (fail-fast), не логируется.

## Клиент

### Типы и API

- `src/types/index.ts`: `User.allow_search_by_phone: boolean`,
  `phone_masked?: string | null`. Открытый номер клиенту не приходит.
- `src/services/api.ts`:
  - `updatePhone(phone)` → PUT `/users/me/phone`;
  - `deletePhone()` → DELETE `/users/me/phone`;
  - `sendFriendRequest({username} | {phone})` → body `{username?, phone?}`.

### Настройки профиля (`ProfileAccountBody.tsx` + CSS)

- Строка «Номер телефона» с показом `phone_masked` из профиля.
- Кнопки «Добавить» / «Изменить» — inline-инпут, применение по Enter/кнопке.
- Кнопка «Удалить» (без confirm).
- Ошибки `phone_invalid` / `phone_taken` через `apiErrorText` → i18n
  `errors.phone_*`.
- Без оптимистичного обновления (ждём ответа сервера); после успешного
  PUT/DELETE → `updateUser({ phone_masked })` в authStore.
- Строка рендерится и в desktop, и в mobile — компонент общий
  (`SettingsScreen` монтирует тот же `ProfileAccountBody`).

### Приватность (`PrivacyBody.tsx`)

- Тумблер «Разрешить поиск по номеру телефона» — точно как существующие:
  optimistic-обновление `updateUser(patch)` → `apiService.updatePrivacy(patch)`
  → откат при ошибке.

### Форма запроса в друзья (`AddFriendForm.tsx`)

- Один инпут, автодетект: если `value.replace(/\D/g, '').length >= 10` →
  `sendFriendRequest({phone})`, иначе `{username}`.
- Плейсхолдер: «имя пользователя или номер телефона».
- Успех: существующие сообщения `addSent` / `addAccepted` + имя найденного
  пользователя из ответа (`Запрос отправлен пользователю {name}`).
- Явно похожий на номер ввод с серверной ошибкой → `phone_invalid` из i18n.

### i18n

Ключи в `src/i18n/locales/ru.ts` и `en.ts` одним коммитом (типизация
`Dictionary` гонится через `tsc`):
- `settings.phone*` (заголовок, кнопки, маска-подпись);
- `settings.privacy.allowSearchByPhone`;
- `friends.byPhonePlaceholder`, `friends.addSentTo`;
- `errors.phone_taken`, `errors.phone_invalid`.

## Тестирование

### Сервер (Go)

- Крипта (pkg `phonecrypto` или usecase):
  - round-trip: `EncryptPhone` → `DecryptPhone` = исходный номер;
  - детерминизм: тот же номер → тот же `phone_index`;
  - разные nonce: два шифрования одного номера → разные `phone_cipher`;
  - неверный ключ → ошибка расшифровки;
  - `MaskPhone`: `+79123456789` → `+79123 ••• •• 89`.
- `NormalizePhone`: `8 912 345-67-89` → `+79123456789`; `+7 (912) 345-67-89`;
  инвалиды (буквы, <11 цифр, >15 цифр, пусто).
- `usecase/user`: PUT — успех, занятый номер (`ErrPhoneTaken`),
  идемпотентность; DELETE — успех, идемпотентность, освобождение номера.
- `usecase/friend`: `SendRequest(phone)` — найден, тумблер выключен → not found,
  сам себе → `ErrSelfFriendship`, нормализация при поиске.
- `handler/friend`: body с `phone`; оба ключа → 400 `invalid_request_body`;
  невалидный номер → 400.
- `handler/user`: PUT/DELETE phone — 200/409/400, авто-нормализация,
  в `meResponse` появляется `phone_masked`, открытый номер никогда не
  присутствует в JSON.
- `config`: `PHONE_ENC_KEY` без значения → ошибка; hex 64 симв. → 32 байта.

### Клиент

- `AddFriendForm` компонентный тест: номер → `{phone}`, имя → `{username}`.
- `Settings.dom.test.tsx` + снапшот `Settings.profile.html` — обновить.
- `check:i18n` зелёный.
- `npm test` — ровно 3 известных фейла в `api.network-retry.test.ts`
  (не трогать).
- Ручная проверка: обе темы, узкая ширина (mobile), `npm run dev:vite`.

## Не входит в скоуп

- SMS/иная верификация номера (задел — `phone_verified_at`).
- Поиск по номеру в других местах (например, общий поиск пользователей).
- Отображение номера другим пользователям (никогда).
- CLI-утилита расшифровки (формат документирован, расшифровать можно любым
  AES-256-GCM инструментом при наличии `PHONE_ENC_KEY`).
- Ротация/смена `PHONE_ENC_KEY` (требует перешифрования всех номеров).