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

- номер уникален и существует только как ключ поиска — нигде в UI и API не
  отображается (кроме маскированного вида в собственном профиле);
- колонка `phone_verified_at` (nullable) создаётся сразу — подключение
  SMS-верификации позже не потребует миграции и ломки API;
- Rate limit на PUT phone (см. «Безопасность»).

## Хранилище

Миграция `026_phone.up.sql`:

```sql
ALTER TABLE users ADD COLUMN phone TEXT UNIQUE;
ALTER TABLE users ADD COLUMN allow_search_by_phone BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN phone_verified_at TIMESTAMPTZ;
CREATE INDEX idx_users_phone ON users(phone);
```

`026_phone.down.sql` — снять колонки и индекс.

Дефолт `allow_search_by_phone = true` согласован с открытыми дефолтами
существующих настроек (`allow_friend_requests = 'everyone'`, `show_last_seen = true`).

`domain.User`:
- `Phone *string` с `json:"-"` — не попадает ни в один публичный ответ;
- `AllowSearchByPhone bool` с `json:"-"` — как остальные privacy-поля, наружу
  только через `meResponse`;
- `PhoneVerifiedAt *time.Time` с `json:"-"` — не используется в этом этапе,
  задел под SMS.

## Нормализация номера

Единственный источник истины — сервер. Одна функция в usecase
`NormalizePhone(s string) (string, error)`:

1. Убрать пробелы, тире, скобки.
2. Ведущая `8` → `+7`.
3. Требуется итоговая форма `^\+[0-9]{10,14}$` (11–15 цифр с `+`, E.164).
4. Иначе — ошибка `ErrInvalidPhone`.

Применяется и при установке номера, и при поиске в `SendRequest` — ввод
`8 912 345-67-89` находит сохранённый `+79123456789`.

## Серверные эндпоинты

### Установка/удаление номера

- `PUT /api/v1/users/me/phone`, body `{"phone": "..."}`:
  - нормализация; невалидный номер → 400 `phone_invalid`;
  - номер занят другим пользователем → 409 `phone_taken`
    (константа в `httperr.go`, по аналогии с `email_taken`);
  - идемпотентность: повторный PUT тем же номером → 200;
  - `phone_verified_at` остаётся NULL (нет верификации);
  - ответ — `meResponse`.
- `DELETE /api/v1/users/me/phone`:
  - обнуляет номер (освобождает для других);
  - без номера → идемпотентный 200;
  - ответ — `meResponse`.
- Rate limit: отдельный `ratelimit.Limiter` с ключом по user ID на PUT
  (для DELETE не нужен).

Механику обновления: поле `phone` добавляется в `allowedUpdateColumns` в
`repository/postgres/user.go`.

### Запрос в друзья

`POST /api/v1/friends/requests` — body принимает опциональное
`{"username": "...", "phone": "..."}`, требуется ровно один из ключей
(оба → 400 `invalid_request_body`, ни одного → 400 `username_required`
как сейчас).

- Handler определяет ключ по наличию поля (не по форме строки).
- Usecase `SendRequest`:
  - если `phone` — нормализация + `GetByPhone`, иначе `GetByUsername`;
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

- Номер не экспонируется: `json:"-"` в `domain.User`; нет в `UserBrief`,
  `FriendProfile`, `SearchUsers`, списках друзей, `meResponse`.
- Номер нигде не логируется.
- Тумблер выключен → непрозрачный 404.
- Смена номера освобождает старый сразу (без верификации иначе нельзя).

## Клиент

### Типы и API

- `src/types/index.ts`: `User.allow_search_by_phone: boolean`.
  Поле `phone` в тип не добавляется — значение номера клиенту не нужно.
- `src/services/api.ts`:
  - `updatePhone(phone)` → PUT `/users/me/phone`;
  - `deletePhone()` → DELETE `/users/me/phone`;
  - `sendFriendRequest({username} | {phone})` → body `{username?, phone?}`.

### Настройки профиля (`ProfileAccountBody.tsx` + CSS)

- Строка «Номер телефона» с показом в маскированном виде (`+7 912 ••• •• 89`).
- Кнопки «Добавить» / «Изменить» — inline-инпут, применение по Enter/кнопке.
- Кнопка «Удалить» (без confirm).
- Ошибки `phone_invalid` / `phone_taken` через `apiErrorText` → i18n
  `errors.phone_*`.
- Без оптимистичного обновления (ждём ответа сервера).
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

- `NormalizePhone`: `8 912 345-67-89` → `+79123456789`; `+7 (912) 345-67-89`;
  инвалиды (буквы, <11 цифр, >15 цифр, пусто).
- `usecase/user`: PUT — успех, занятый номер (`ErrPhoneTaken`),
  идемпотентность; DELETE — успех, идемпотентность, освобождение номера.
- `usecase/friend`: `SendRequest(phone)` — найден, тумблер выключен → not found,
  сам себе → `ErrSelfFriendship`, нормализация при поиске.
- `handler/friend`: body с `phone`; оба ключа → 400 `invalid_request_body`;
  невалидный номер → 400.
- `handler/user`: PUT/DELETE phone — 200/409/400, авто-нормализация.

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