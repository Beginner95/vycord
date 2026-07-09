# Проверка членства при чтении/отправке сообщений (REST)

**Задача (Borda, Критический приоритет):** Добавить проверку членства в сервере/канале при чтении и отправке сообщений. Сейчас REST `GET/POST /api/v1/channels/{channel_id}/messages` доступны любому авторизованному пользователю.

**Дата:** 2026-07-09
**Ветка:** предполагается отдельная feature-ветка от `main`.

## Проблема

Роуты защищены только `authMid.RequireAuth` (`cmd/api/main.go:127-128`), то есть любой залогиненный пользователь может читать и писать сообщения в **любой** канал по его ID, даже не будучи участником сервера.

Дополнительно обнаружен смежный баг: в `internal/repository/postgres/channel.go` (`GetByID`) проверка «не найдено» сделана через `err == sql.ErrNoRows`, но драйвер `pgx/v5` возвращает `pgx.ErrNoRows`. Ветка мёртвая — несуществующий канал сейчас отдаёт обёрнутую ошибку `"failed to get channel"` → HTTP 500.

## Решение

Проверка членства выполняется в **usecase-слое** (`messageUseCase`), где уже есть `channelRepo`. Канал знает свой `ServerID`, а в `ServerRepository` уже есть готовый метод `IsMember(serverID, userID)`. Добавляем в usecase зависимость `serverRepo` и переиспользуем `IsMember`. Хендлер остаётся тонким и лишь транслирует доменные ошибки в HTTP-статусы.

### Поток

```
handler.CreateMessage/GetMessages(channelID, userID, …)
  → usecase: channelRepo.GetByID(channelID)         // узнаём server_id; если нет — ErrChannelNotFound
  → usecase: serverRepo.IsMember(server_id, userID)  // если false — ErrForbidden
  → (create) messageRepo.Create / (get) messageRepo.GetByChannelID
```

Порядок важен: сначала проверяем существование канала (404), затем членство (403). Сообщение **не** создаётся и broadcast в hub **не** происходит, если проверка не прошла.

### Ответы API для не-участника

| Ситуация | Статус | Тело |
|---|---|---|
| Канал не существует | `404` | `{"error":"channel not found"}` |
| Канал есть, но пользователь не участник | `403` | `{"error":"access denied"}` |
| Прочие внутренние ошибки | `500` | общий текст (без утечки `err.Error()`) |

Владелец и админ — тоже строки в `server_members`, поэтому `IsMember` их пропускает.

## Изменения по файлам

### 1. `internal/domain/errors.go` (новый)
```go
package domain

import "errors"

var (
	ErrForbidden       = errors.New("access denied")
	ErrChannelNotFound = errors.New("channel not found")
)
```

### 2. `internal/domain/usecase.go`
Сигнатура `GetMessages` получает `userID`:
```go
GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*Message, error)
```
`CreateMessage(channelID, userID uuid.UUID, content string)` уже принимает `userID` — не меняется.

### 3. `internal/repository/postgres/channel.go` — `GetByID`
- Заменить `if err == sql.ErrNoRows` на `if errors.Is(err, pgx.ErrNoRows)` и возвращать `domain.ErrChannelNotFound` (через `%w`, чтобы сохранить цепочку).
- Импорты: убрать `database/sql`, добавить `errors` и `github.com/jackc/pgx/v5`.

### 4. `internal/usecase/message.go`
- Поле `serverRepo domain.ServerRepository` + параметр конструктора `NewMessageUseCase`.
- `CreateMessage`: после `channelRepo.GetByID` пробросить ошибку через `%w` (чтобы `errors.Is(…, ErrChannelNotFound)` работал), затем `serverRepo.IsMember(ch.ServerID, userID)`; при `false` → `return nil, domain.ErrForbidden` (до вставки в БД).
- `GetMessages`: принять `userID`, выполнить тот же блок (fetch channel → IsMember), затем чтение.

### 5. `internal/delivery/http/handler/message.go`
- `GetMessages`: извлечь `userID` из контекста, передать в usecase.
- Оба метода — маппинг ошибок по порядку:
  - `errors.Is(err, domain.ErrChannelNotFound)` → `404`
  - `errors.Is(err, domain.ErrForbidden)` → `403`
  - иначе → `500` с общим текстом (заодно убирается текущая утечка `err.Error()` наружу в `CreateMessage`).

### 6. `cmd/api/main.go:80`
`NewMessageUseCase(messageRepo, channelRepo, serverRepo)` — `serverRepo` уже создан на строке 71.

## Тестирование

Новый файл `internal/usecase/message_test.go`, паттерн `testify/mock` (как в `auth_test.go`). Моки: `MockMessageRepository`, `MockChannelRepository`, `MockServerRepository`.

Кейсы:
- **CreateMessage**
  - участник → успех, `messageRepo.Create` вызван;
  - не-участник → `ErrForbidden`, `Create` **не** вызван;
  - канал не найден → ошибка оборачивает `ErrChannelNotFound`, `IsMember`/`Create` **не** вызваны.
- **GetMessages**
  - участник → возвращает сообщения;
  - не-участник → `ErrForbidden`, `GetByChannelID` **не** вызван;
  - канал не найден → ошибка оборачивает `ErrChannelNotFound`.

Repo-уровень (`channel.go`) отдельными тестами не покрываем — доменная ошибка проверяется через мок в usecase-тестах.

## Вне скоупа (отдельные задачи Borda)

- WS-подделка `sender` в `chat_message`/`typing` (брать `user_id` только из JWT).
- Non-member всё ещё может подписаться на канал через WS-hub и получать broadcast — та же WS-задача.
- Реакция клиента на 403/404: на happy-path пользователь всегда участник, регресса нет; отдельная обработка на клиенте не требуется в рамках этой задачи.
- Полноценный пакет `pkg/errors` с доменными ошибками — здесь вводим минимальные сентинелы в `internal/domain`.
