# Редактирование и удаление сервера/каналов

**Задача (Borda, IN PROGRESS):** Добавить редактирование и удаление сервера/каналов (название, иконка; сейчас только создание).

**Дата:** 2026-07-28
**Ветка:** `VYC-51-delete-chanel`

## Предпосылки

- `ServerRepository.Update/Delete` и `ChannelRepository.Update/Delete` в `internal/repository/postgres/{server,channel}.go` уже реализованы и рабочие, но нигде не вызываются — usecase/handler/route-обвязки нет.
- FK на `channels.server_id`, `server_members.server_id`, `messages.channel_id` — все `ON DELETE CASCADE` (миграции 002-005). Удаление сервера/канала на уровне БД safe: связанные каналы/участники/сообщения удалятся автоматически.
- Ролевой системы нет (см. [[2026-07-15-message-edit-delete-design]] — тот же вывод для сообщений): различимы только «владелец сервера» (`server.OwnerID`) и «участник». Требование задачи — «редактировать и удалить может только владелец» — ложится ровно на `server.OwnerID == userID`, без завязки на `domain.Role`.
- Создания каналов в UI сейчас нет (только 2 дефолтных канала при создании сервера, `serverUseCase.CreateServer`). Отсюда защита от удаления последнего канала (см. таблицу решений) — иначе владелец может оставить сервер без единого канала и без способа создать новый через UI.
- Загрузка иконки сервера технически идентична загрузке аватара пользователя (VYC-?, `2026-07-21-user-avatar-upload-design.md`): тот же `pkg/filestorage.Storage`, тот же формат/лимиты.

## Принятые решения

| Вопрос | Решение |
|---|---|
| Кто может редактировать/удалять | Только владелец (`server.OwnerID == userID`), без исключений для admin |
| UI-вызов действий | Контекстное меню (ПКМ / кнопка «⋮» на мобильных) на иконке сервера в `ServerList` и на строке канала в `ChannelSidebar`, видно только владельцу |
| Удаление последнего канала сервера | Запрещено (400, дизейбл пункта меню в UI) |
| Способ удаления | Hard delete, каскад через существующие FK — миграции не нужны |
| Confirm перед удалением | `window.confirm(...)`, как для сообщений |
| Синхронизация с другими клиентами | WS-события `server_update`/`server_delete`/`channel_update`/`channel_delete`, глобальный broadcast (как `user_updated`) |
| Активный звонок в удаляемом канале/сервере | У пострадавших клиентов (включая владельца) автоматически вызывается `window.leaveGroupCall()` перед переключением |
| Иконка сервера | Отдельные эндпоинты upload/remove (как у аватара), а не часть `PATCH` с именем |

## Backend

### Доменный слой

`internal/domain/errors.go` — новые сентинелы:
```go
ErrServerNotFound = errors.New("server not found")
ErrLastChannel     = errors.New("cannot delete the last channel of a server")
```
(`ErrForbidden`, `ErrChannelNotFound` уже существуют и переиспользуются как есть.)

`internal/domain/usecase.go` — расширяем `ServerUseCase`:
```go
type ServerUseCase interface {
    // ...существующие методы без изменений...
    UpdateServer(serverID, userID uuid.UUID, name string) (*Server, error)
    UpdateServerIcon(serverID, userID uuid.UUID, data []byte) (*Server, error)
    RemoveServerIcon(serverID, userID uuid.UUID) (*Server, error)
    DeleteServer(serverID, userID uuid.UUID) error
    UpdateChannel(serverID, channelID, userID uuid.UUID, name string) (*Channel, error)
    DeleteChannel(serverID, channelID, userID uuid.UUID) error
}
```
`domain.ServerRepository`/`domain.ChannelRepository` не меняются — `Update`/`Delete` уже подходят как есть.

### Usecase (`internal/usecase/server.go`)

Общий приватный хелпер, аналог `requireMembership` в `messageUseCase`:
```go
// requireOwner проверяет, что сервер существует и userID — его владелец.
// Возвращает domain.ErrServerNotFound или domain.ErrForbidden.
func (uc *serverUseCase) requireOwner(serverID, userID uuid.UUID) (*domain.Server, error) {
    server, err := uc.serverRepo.GetByID(serverID)
    if err != nil {
        return nil, fmt.Errorf("server %s: %w", serverID, domain.ErrServerNotFound)
    }
    if server.OwnerID != userID {
        return nil, domain.ErrForbidden
    }
    return server, nil
}
```
Существующий `serverRepo.GetByID` возвращает plain-ошибку без сентинела (в отличие от `channelRepo.GetByID`) — оборачиваем в `requireOwner`, репозиторий не трогаем (он используется в других местах, где такая семантика не нужна).

- **`UpdateServer(serverID, userID, name)`**: `requireOwner` → если `name == ""` вернуть ошибку валидации на уровне handler (как у `CreateServer`) → `serverRepo.Update(id, map[string]interface{}{"name": name})` → вернуть обновлённый `*Server` (патчим поле локально, не перечитываем).
- **`UpdateServerIcon(serverID, userID, data)`**: `requireOwner` → валидация изображения общим хелпером `validateImage(data)` (см. ниже, шарится с `userUseCase.UpdateAvatar`) → сохранить через `uc.storage.Save(ctx, "server-icons/{serverID}/{randomHex}.{ext}", ...)` → `serverRepo.Update(id, {"icon_url": url})` → удалить старый файл (best-effort, как в `RemoveAvatar`) → вернуть `*Server`. Требует добавить `storage filestorage.Storage` в `serverUseCase` (сейчас его нет) и прокинуть в `NewServerUseCase`.
- **`RemoveServerIcon(serverID, userID)`**: `requireOwner` → если `IconURL == nil` — no-op, вернуть как есть → иначе `serverRepo.Update(id, {"icon_url": nil})` + `storage.Delete` старого файла.
- **`DeleteServer(serverID, userID)`**: `requireOwner` → `serverRepo.Delete(id)`. Иконку сервера (файл) отдельно не чистим — как и у аватаров, орфан-файл не хуже жёсткого фейла запроса; тем более сервер целиком исчезает вместе с данными.
- **`UpdateChannel(serverID, channelID, userID, name)`**: `requireOwner(serverID, userID)` (владение проверяем по серверу из URL, не по каналу) → `channelRepo.GetByID(channelID)` → если `channel.ServerID != serverID` вернуть `domain.ErrChannelNotFound` (та же защита от подмены ID, что у сообщений) → `channelRepo.Update(id, {"name": name})` → вернуть обновлённый `*Channel`.
- **`DeleteChannel(serverID, channelID, userID)`**: `requireOwner(serverID, userID)` → `channelRepo.GetByID(channelID)` + проверка `ServerID` как выше → `channelRepo.GetByServerID(serverID)` посчитать количество каналов → если `len(channels) <= 1` вернуть `domain.ErrLastChannel` → иначе `channelRepo.Delete(channelID)`.

### Общая валидация изображений (`internal/usecase/image.go`, новый файл)

Сейчас логика проверки формата/размеров живёт инлайн в `userUseCase.UpdateAvatar` (`internal/usecase/user.go:86-105`). Выношу в пакетный хелпер, чтобы не дублировать между аватаром и иконкой сервера:
```go
func validateImage(data []byte) (ext, contentType string, err error) { ... }
```
Возвращает те же сентинелы, что сейчас (`domain.ErrUnsupportedAvatarFormat`, `domain.ErrInvalidAvatarImage`, `domain.ErrInvalidAvatarDimensions`) — переименование ошибок не требуется, они уже достаточно общие по смыслу (просто применяются теперь и к иконке сервера). `userUseCase.UpdateAvatar` переключается на вызов этого хелпера, поведение не меняется.

### HTTP-хендлеры и роуты

`internal/delivery/http/handler/server.go` — новые методы `ServerHandler`, паттерн 1:1 с `CreateServer`/`CreateChannel` и `UserHandler.UploadAvatar`/`RemoveAvatar`:

```
PATCH  /api/v1/servers/{id}                                 → serverHandler.UpdateServer        (JSON {name})
POST   /api/v1/servers/{id}/icon                            → serverHandler.UploadServerIcon     (multipart, поле "icon", ≤2MB)
DELETE /api/v1/servers/{id}/icon                             → serverHandler.RemoveServerIcon
DELETE /api/v1/servers/{id}                                  → serverHandler.DeleteServer
PATCH  /api/v1/servers/{server_id}/channels/{channel_id}     → serverHandler.UpdateChannel        (JSON {name})
DELETE /api/v1/servers/{server_id}/channels/{channel_id}     → serverHandler.DeleteChannel
```

Все — за `authMid.RequireAuth`, `user_id` только из контекста (JWT), никогда из тела/пути. Общий `writeUseCaseError`-стиль хелпер (как в `message.go`) добавляет кейсы:
- `ErrServerNotFound` → 404
- `ErrChannelNotFound` → 404
- `ErrForbidden` → 403
- `ErrLastChannel` → 400
- avatar-сентинелы (для upload icon) → те же коды, что у `UserHandler.writeUserError`

После каждой успешной мутации — WS-broadcast (см. ниже), затем JSON-ответ (`200` с объектом для update/upload, `204` для delete).

`UploadServerIcon` переиспользует те же константы лимитов, что и `UploadAvatar` (`maxAvatarRequestBytes`/`maxAvatarFileBytes` из `user.go` — оставляю как есть, имя не переименовываю, чтобы не разводить дублирование ради формализма; поле формы называется `"icon"` вместо `"avatar"`).

### WebSocket-события

Публикуются из HTTP-хендлера через `h.hub.BroadcastMessage` (тот же способ, что `Hub.BroadcastUserUpdate` — глобально всем онлайн-клиентам; хаб не знает о принадлежности клиента серверу, а участник может быть онлайн, но не смотреть сейчас на этот сервер/канал — фильтрация по актуальности на клиенте):

- `server_update` — payload: `{"id", "name", "icon_url"}` (сериализованный `domain.Server` полностью, как `message_update` шлёт весь `Message`).
- `server_delete` — payload: `{"id"}`.
- `channel_update` — payload: `{"id", "server_id", "name", "type", "position"}` (сериализованный `domain.Channel`).
- `channel_delete` — payload: `{"id", "server_id"}`.

Отдельный метод хаба не добавляется: у `Hub` уже есть публичный `BroadcastMessage(*Message)`, вызываем его напрямую из хендлера — прямой вызов `h.hub.BroadcastMessage(&ws.Message{Type: "server_update", Payload: payload})`, аналогично тому, как `MessageHandler` сам собирает `ws.Message` и зовёт `SendToChannel`. Выделенные методы вроде `BroadcastUserUpdate`/`BroadcastVoiceParticipants` существуют там, где хабу нужно держать доп. состояние (voice-роcтер) или которое переиспользуется из нескольких мест (disconnect-хендлер) — здесь этого нет.

## Frontend

### `client/src/services/api.ts` — новые методы
```ts
async updateServer(id: string, name: string) { PATCH /api/v1/servers/{id} }
async uploadServerIcon(id: string, blob: Blob) { POST /api/v1/servers/{id}/icon (requestForm, multipart) }
async removeServerIcon(id: string) { DELETE /api/v1/servers/{id}/icon (requestForm) }
async deleteServer(id: string) { DELETE /api/v1/servers/{id} }
async updateChannel(serverId: string, channelId: string, name: string) { PATCH /api/v1/servers/{serverId}/channels/{channelId} }
async deleteChannel(serverId: string, channelId: string) { DELETE /api/v1/servers/{serverId}/channels/{channelId} }
```

### `client/src/types/index.ts`
Без изменений — `Server`/`Channel` уже содержат все нужные поля.

### `client/src/stores/serverStore.ts` — новые экшены
```ts
patchServer: (id: string, patch: Partial<Server>) => void;
removeServer: (id: string) => void;
patchChannel: (id: string, patch: Partial<Channel>) => void;
removeChannel: (id: string) => void;
```
Реализация — `map`/`filter` по массивам `servers`/`channels`, плюс синхронизация `currentServer`/`currentChannel`, если патчится/удаляется именно текущий.

### Новый компонент `client/src/components/ContextMenu.tsx` (+ `.css`)
Универсальный: `{ x, y, items: {label, onClick, danger?, disabled?}[], onClose }`. Рендерится в портале поверх всего, закрывается по клику вне/Escape. Переиспользуется и для сервера, и для канала — без дублирования разметки/позиционирования.

### `ServerList.tsx`
- `onContextMenu` (ПКМ) на `.server-icon` (только для серверов, не для «Home»/«+»/«🔍»), плюс кнопка `⋮`, видимая при наведении/на тач-устройствах — оба открывают один и тот же `ContextMenu` с пунктами «Редактировать»/«Удалить сервер», **только если `server.owner_id === user.id`** (нужен проп `user: User | null`, прокинуть из `AppPage`).
- Пункт «Редактировать» открывает модалку `EditServerModal` (новый компонент или расширение существующей инлайн-модалки в `AppPage`) — поле имени (prefilled) + текущая иконка с кнопками «Загрузить»/«Удалить иконку» (файловый `<input type=file>`, тот же UX, что у аватара в `Settings.tsx` — проверю точный компонент на этапе реализации и переиспользую).
- «Удалить сервер» → `window.confirm('Удалить сервер «{name}»? Это действие необратимо.')` → `apiService.deleteServer` → `removeServer` в сторе → если это был `currentServer`, тот же fallback, что при обычном переключении (следующий сервер из списка или пустое состояние).

### `ChannelSidebar.tsx`
- `onContextMenu` на `.channel` (и текстовых, и голосовых) → `ContextMenu` с «Редактировать»/«Удалить канал», видно только если `server?.owner_id === user?.id`. «Удалить канал» задизейблен (с title-подсказкой), если в списке всего 1 канал — клиентская подсказка поверх серверной проверки (последнее слово всегда за 400 от API).
- «Редактировать» → маленькая инлайн-модалка с полем имени.
- «Удалить» → `window.confirm` → `apiService.deleteChannel` → `removeChannel`.

### `AppPage.tsx` — WS-подписки и навигация при чужих изменениях
Новые `wsService.on(...)` эффекты, симметричные существующему `user_updated`:

- `server_update` → `useServerStore.getState().patchServer(id, {name, icon_url})`.
- `channel_update` → `useServerStore.getState().patchChannel(id, {name})`.
- `server_delete` → если `id === currentServer?.id`:
  1. если сейчас в голосовом канале этого сервера — `(window as any).leaveGroupCall?.()`;
  2. `removeServer(id)`, выбрать следующий сервер из `servers` (`handleSelectServer`) либо очистить `currentServer/currentChannel/channels/members` (состояние «нет сервера», как в `ChannelSidebar` при `server === null`).
  Если `id !== currentServer?.id` — просто `removeServer(id)` (список слева).
- `channel_delete` → если `channel_id === currentChannel?.id`:
  1. если это был голосовой и я в звонке — `leaveGroupCall()`;
  2. `removeChannel(id)`, переключиться на первый текстовый канал сервера (тот же fallback, что в `handleSelectServer`), либо, если каналов не осталось (не должно происходить благодаря серверной защите, но на случай гонки — сервер тоже мог быть удалён параллельно) — пустое состояние.
  Иначе — просто `removeChannel(id)`.

Обработчик `server_delete`/`channel_delete` должен быть идемпотентным к повторной доставке (глобальный broadcast может прийти клиенту, уже не имеющему этот сервер в списке, — `removeServer`/`removeChannel` на несуществующем id — no-op по построению `filter`).

## Тестирование

`internal/usecase/server_test.go` — расширяем существующий файл (там уже есть `MockServerRepository`/`MockChannelRepository`), новые кейсы:

- **UpdateServer** — owner меняет имя → `Update` вызван, возвращён обновлённый `Server`; не-owner → `ErrForbidden`, `Update` не вызван; сервер не найден → `ErrServerNotFound`.
- **DeleteServer** — owner → `Delete` вызван; не-owner → `ErrForbidden`, `Delete` не вызван.
- **UpdateChannel** — owner сервера меняет имя канала → `Update` вызван; не-owner → `ErrForbidden`; канал из другого сервера (`channel.ServerID != serverID`) → `ErrChannelNotFound`, `Update` не вызван.
- **DeleteChannel** — owner, ≥2 канала → `Delete` вызван; owner, ровно 1 канал → `ErrLastChannel`, `Delete` не вызван; не-owner → `ErrForbidden`.
- **UpdateServerIcon/RemoveServerIcon** — переиспользовать существующие кейсы `TestUpdateAvatar_*`/`TestRemoveAvatar_*` из `user_test.go` как шаблон (тот же `validateImage`, тот же mock `filestorage.Storage`), плюс owner-проверка сверху.

Ручная проверка (`/verify`) после реализации: два открытых клиента (владелец и участник) в одном сервере — переименование/смена иконки сервера, переименование канала, удаление не-последнего канала и удаление всего сервера мгновенно отражаются у обоих через WS; попытка удалить последний канал блокируется; участник (не владелец) не видит пункты редактирования в контекстном меню и получает 403 при прямом вызове API.

## Вне скоупа

- UI создания дополнительных каналов — самостоятельная задача борды, не входит в «редактирование и удаление»; последний канал защищён от удаления именно из-за отсутствия этого UI.
- Кастомные роли/права admin на редактирование — в проекте не реализованы (см. «Предпосылки»).
- Изменение `type`/`position` канала, категории каналов — не запрошено, `position` уже редактируется отдельно репозиторием, но эндпоинта для reorder нет и не добавляется.
- Явное уведомление участников голосового канала о принудительном завершении звонка (кроме автоматического `leaveGroupCall()` у пострадавшего клиента) — SFU-комната на сервере освобождается естественным путём, когда все участники выходят, отдельная админ-команда «закрыть комнату» не добавляется.
- Soft delete / история изменений сервера/канала — hard delete, как и у сообщений.
