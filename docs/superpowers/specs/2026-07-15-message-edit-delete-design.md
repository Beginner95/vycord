# Редактирование и удаление сообщений

**Задача (Borda, «Чаты и Сообщения»):** Добавить редактирование и удаление сообщений. Смежные пункты борды («WebSocket Events Map»): событие `message_update` — редактирование сообщения, событие `message_delete` — удаление сообщения.

**Дата:** 2026-07-15
**Ветка:** `VYC-31-delete-edit-message`

## Предпосылки

Проверены все связанные пункты борды — блокеров нет:
- Проверка членства в канале/сервере (VYC-27, `messageUseCase.requireMembership`) уже смержена в main.
- JWT-only `user_id` на HTTP и WS (VYC-25/VYC-28) уже смержено — `user_id` для авторизации всегда берётся из контекста аутентификации, никогда из тела запроса/WS-payload.
- Ролевой системы (custom roles/admin) в проекте нет — `Role` enum (`owner`/`admin`/`member`) объявлен в `domain.Member`, но нигде не используется репозиторием. Реально различимы только «автор сообщения» и «owner сервера». Для этой задачи это не требуется: право на edit/delete — только у автора.

## Принятые решения

| Вопрос | Решение |
|---|---|
| Кто может удалять/редактировать | Только автор сообщения (не owner, не admin) |
| Способ удаления | Hard delete (`DELETE FROM messages`) — репозиторий уже это умеет, миграция `deleted_at` не нужна |
| UI-вызов действий | Hover-иконки (карандаш/корзина) над своим сообщением |
| Пометка «изменено» | Показывать, если `updated_at !== created_at` |
| Confirm перед удалением | Да |
| Форма редактирования | Inline, как в Discord — текст сообщения в ленте заменяется на текстовое поле |
| Лимит по времени на edit/delete | Без ограничения — автор может редактировать/удалять всегда |

## Backend

### Доменный слой

`internal/domain/errors.go` — новый сентинел:
```go
ErrMessageNotFound = errors.New("message not found")
```

`internal/domain/usecase.go` — расширяем интерфейс:
```go
type MessageUseCase interface {
    CreateMessage(channelID, userID uuid.UUID, content string) (*Message, error)
    GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*Message, error)
    UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*Message, error)
    DeleteMessage(channelID, messageID, userID uuid.UUID) error
}
```

`domain.MessageRepository` не меняется — `Update(id, updates map[string]interface{})` и `Delete(id)` уже реализованы в `internal/repository/postgres/message.go:130-181` и не используются нигде; сейчас они подключаются.

### Usecase (`internal/usecase/message.go`)

Общий поток для `UpdateMessage` и `DeleteMessage`:
1. `requireMembership(channelID, userID)` — переиспользуем без изменений (канал существует + юзер в сервере).
2. `messageRepo.GetByID(messageID)` — если ошибка (не найдено) → обернуть в `domain.ErrMessageNotFound`.
3. Проверка `msg.ChannelID == channelID` — защита от подмены `channel_id` в URL при валидном `message_id` из другого канала. Несовпадение → `domain.ErrMessageNotFound` (не «протекать» существование сообщения в чужом канале).
4. Проверка `msg.UserID == userID` — не автор → `domain.ErrForbidden`.

`UpdateMessage` дополнительно:
- Если `content == msg.Content` (без реальных изменений) — вернуть текущий `msg` как есть, **не** дергать `messageRepo.Update` и не публиковать WS-событие (не плодим ложный «(изменено)» и лишний трафик).
- Иначе `messageRepo.Update(id, map[string]interface{}{"content": content})`, затем собрать актуальный `*Message` (обновлённые `Content`/`UpdatedAt`) для ответа и WS-broadcast.
- Валидация пустого `content` — на уровне handler, тем же способом, что в `CreateMessage`.

`DeleteMessage`:
- `messageRepo.Delete(id)`.

### HTTP-хендлер и роуты

Новые роуты в `cmd/api/main.go`, рядом с существующими (~строка 127-128):
```
PATCH  /api/v1/channels/{channel_id}/messages/{message_id}  → authMid.RequireAuth(messageHandler.UpdateMessage)
DELETE /api/v1/channels/{channel_id}/messages/{message_id}  → authMid.RequireAuth(messageHandler.DeleteMessage)
```

`MessageHandler.UpdateMessage`/`DeleteMessage` (`internal/delivery/http/handler/message.go`) — паттерн 1:1 с `CreateMessage`:
- `user_id` только из `r.Context().Value("user_id")` (JWT), не из тела запроса.
- Парсинг `channel_id` и `message_id` из path.
- `UpdateMessage`: тело `{"content": string}`, валидация непустого содержимого (как в `CreateMessageRequest`).
- Вызов usecase → `writeUseCaseError`, куда добавляется кейс `errors.Is(err, domain.ErrMessageNotFound) → 404`.
- После успеха — WS-broadcast через `h.hub.SendToChannel` (см. ниже), затем JSON-ответ (`200` с обновлённым сообщением / `204` для удаления).

### WebSocket-события

Имена — как в борде: `message_update`, `message_delete`. Публикуются из HTTP-хендлера тем же способом, что и `chat_message` (`hub.SendToChannel`, `internal/delivery/http/handler/message.go:60-65`). Входящих WS-хендлеров не добавляется — все identity-чувствительные операции идут через REST+JWT (согласовано с VYC-28: WS payload от клиента для этого не используется).

- `message_update`: payload — сериализованный обновлённый `domain.Message` (тот же формат, что и `chat_message`).
- `message_delete`: payload — `{"id": "<message_id>", "channel_id": "<channel_id>"}` (после hard delete полного объекта уже нет).

## Frontend

### `client/src/services/api.ts`
```ts
async updateMessage(channelId: string, messageId: string, content: string) {
  return this.request(`/api/v1/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

async deleteMessage(channelId: string, messageId: string) {
  return this.request(`/api/v1/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
  });
}
```

### `client/src/stores/messageStore.ts`
Добавить:
```ts
updateMessage: (id: string, patch: Partial<Message>) => void;
removeMessage: (id: string) => void;
```
Реализация — `map`/`filter` по `id` в массиве `messages`.

### WS-подписка (`ChatArea.tsx` / `websocket.ts`)
Подписки на `message_update` → `updateMessage(payload.id, payload)`, на `message_delete` → `removeMessage(payload.id)`. Это же закрывает синхронизацию между несколькими открытыми клиентами одного пользователя (сейчас не работает даже для `chat_message` — вне скоупа для create, но для update/delete делаем сразу правильно, иначе после правки в одной вкладке в другой останется устаревший текст).

### `ChatArea.tsx` — UI сообщения (рендер ~строки 159-208)

- Hover-тулбар с иконками карандаш/корзина поверх своего сообщения, показывается только когда `msg.user_id === user?.id`.
- **Карандаш** → локальный `editingId` state; текст сообщения (`<p className="message-text">`) заменяется на `<input>`/`<textarea>` с текущим содержимым. `Enter` — сохранить (`apiService.updateMessage` → на успехе `updateMessage` в сторе с ответом сервера), `Esc` — отмена без сохранения. Пустой текст при сохранении блокируется той же проверкой, что при отправке.
- **Корзина** → confirm-диалог («Удалить сообщение?») → на подтверждение `apiService.deleteMessage` → на успехе `removeMessage`.
- Рядом с `message-timestamp` — пометка «(изменено)», если `msg.updated_at !== msg.created_at`.

## Тестирование

`internal/usecase/message_test.go` — моки `MockMessageRepository` уже содержат заготовки `Update`/`Delete`. Новые кейсы:

- **UpdateMessage**
  - автор, контент изменился → `messageRepo.Update` вызван, возвращён обновлённый `Message`;
  - автор, контент не изменился → `messageRepo.Update` **не** вызван;
  - не автор → `ErrForbidden`, `Update` не вызван;
  - сообщение не найдено → `ErrMessageNotFound`;
  - `message_id` из другого канала (`msg.ChannelID != channelID`) → `ErrMessageNotFound`;
  - не участник сервера → `ErrForbidden` (до чтения сообщения).
- **DeleteMessage** — те же кейсы (автор/не автор/не найдено/чужой канал/не участник), с проверкой вызова `messageRepo.Delete`.

Ручная проверка (`/verify`) после реализации: два открытых клиента в одном канале — редактирование и удаление в одном тут же отражается в другом через WS.

## Вне скоупа

- Ограничение прав удаления для owner/admin — роль admin в проекте не реализована (нет назначения ролей), делать этот функционал не на что опереться; можно вернуться при появлении полноценной ролевой системы.
- Soft delete / история изменений сообщения — не запрашивалось, добавлено бы миграцией `deleted_at`.
- Лимит по времени на редактирование/удаление.
- Редактирование `attachments` — в проекте пока нет UI загрузки вложений, редактируется только `content`.
- Централизованный WS-router (борда, «Clean Architecture») — вне скоупа, паттерн broadcast переиспользуется как есть.
