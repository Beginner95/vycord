# Упоминания (@user, @role, @everyone)

**Задача (Borda, «Чаты и Сообщения»):** Добавить упоминания (@user, @role, @everyone).

**Дата:** 2026-07-16
**Ветка:** `VYC-32-tag`

## Предпосылки и блокирующая зависимость

Проверены связанные пункты борды:
- **Блокер (включён в этот же план):** эндпоинта «список участников сервера» нет — `UserList.tsx` показывает только глобальный онлайн (`apiService.getOnlineUsers()`), не участников конкретного сервера. Без него нельзя ни строить автокомплит `@user`, ни валидировать на бэкенде, что упомянутый юзер вообще состоит в сервере. Таблица `server_members(server_id, user_id, role, joined_at)` уже существует (`internal/repository/postgres/server.go`), миграция не нужна — не хватает только эндпоинта и репозиторного метода джойна с `users`.
- **Кастомные роли (`roles`/`role_permissions` из борды, раздел «Архитектура БД») не реализованы.** `domain.Member.Role` — фиксированный enum `owner`/`admin`/`member`, нигде не используется репозиторием для проверки прав (тот же вывод уже зафиксирован в спеке VYC-31). Для `@role` в этой итерации это не блокер — целимся только в 3 фиксированные роли.
- Санитизация HTML в сообщениях (борда, «Безопасность») не блокер: сообщения рендерятся как `<p className="message-text">{msg.content}</p>` без `dangerouslySetInnerHTML` (`ChatArea.tsx:280`) — React экранирует текст. Рендер упоминаний через разбор строки на React-элементы (см. ниже) сохраняет это свойство, отдельная санитизация не нужна.
- Проверка членства в канале/сервере (VYC-27, `messageUseCase.requireMembership`) уже смержена — переиспользуется как есть.

## Принятые решения

| Вопрос | Решение |
|---|---|
| `@role` — на что ориентируемся | Только 3 фиксированные роли (`owner`/`admin`/`member`), без кастомных ролей |
| Формат хранения в `content` | Discord-style токены: `<@USER_UUID>`, `<@&role>`, `@everyone` (литерал) — в БД и по WS в сыром виде, парсятся только на рендере |
| Реакция на упоминание пользователя | Только визуальная подсветка ника в тексте сообщения — без счётчиков непрочитанного и без push/WS-уведомлений |
| Автокомплит при вводе `@` | Да, выпадающий список: участники сервера + 3 роли + everyone, с фильтрацией по вводу |
| Вид токена в поле ввода до отправки | Сырой `<@uuid>`/`<@&role>` — красивый рендер только после отправки (нет rich-text/pill-инпута, это отдельная и более дорогая задача) |
| Кто может использовать `@everyone` | Только owner/admin сервера; иначе сервер отклоняет создание/редактирование сообщения (403) |
| Список участников сервера | Реализуется в рамках этого же плана как блокирующая зависимость |

## Backend

### Доменный слой

`internal/domain/errors.go` — новые сентинелы:
```go
// ErrInvalidMention — упомянутый пользователь не существует или не состоит в сервере,
// либо указана неизвестная роль в <@&role>.
ErrInvalidMention = errors.New("invalid mention")
// ErrMentionForbidden — @everyone от пользователя без прав owner/admin.
ErrMentionForbidden = errors.New("mention not allowed")
```

`internal/domain/server.go` — расширяем `Member`/`ServerRepository`:
```go
type MemberWithUser struct {
    UserID    uuid.UUID `json:"user_id"`
    Username  string    `json:"username"`
    AvatarURL *string   `json:"avatar_url,omitempty"`
    Role      Role      `json:"role"`
    JoinedAt  time.Time `json:"joined_at"`
}

type ServerRepository interface {
    // ...существующие методы...
    GetMembersWithUsers(serverID uuid.UUID) ([]*MemberWithUser, error)
    GetMemberRole(serverID, userID uuid.UUID) (Role, error) // возвращает RoleOwner, если userID == server.OwnerID
}
```

`GetMembersWithUsers` — `JOIN server_members m ON m.user_id = users.id WHERE m.server_id = $1`, плюс отдельно добавляем владельца сервера (он не в `server_members`, как уже отмечено в `requireMembership`) с ролью `owner`.

`GetMemberRole` нужен для проверки права на `@everyone`: сейчас есть только `IsMember` (bool), роль не возвращается.

`internal/domain/usecase.go` — расширяем интерфейсы:
```go
type ServerUseCase interface {
    // ...существующие методы...
    GetMembers(serverID, userID uuid.UUID) ([]*MemberWithUser, error)
}
```
`GetMembers` проверяет, что вызывающий сам состоит в сервере (переиспользует ту же логику владелец-или-`IsMember`, что и `messageUseCase.requireMembership`), иначе `ErrForbidden`.

### Разбор упоминаний (новый файл `internal/usecase/mentions.go`)

Чистые функции без побочных эффектов:
```go
var (
    userMentionRe = regexp.MustCompile(`<@([0-9a-fA-F-]{36})>`)
    roleMentionRe = regexp.MustCompile(`<@&(owner|admin|member)>`)
    everyoneRe    = regexp.MustCompile(`@everyone`)
)

type parsedMentions struct {
    userIDs   []uuid.UUID
    everyone  bool
}

func parseMentions(content string) parsedMentions
```
Роли (`<@&role>`) не требуют отдельной проверки существования — regex уже ограничивает набор тремя известными значениями, невалидные роли (`<@&foo>`) просто не матчатся и остаются как обычный текст (не считаются упоминанием, ничего не ломают).

### Usecase (`internal/usecase/message.go`)

Новая приватная функция `validateMentions(serverID, authorID uuid.UUID, content string) error`, вызывается из `CreateMessage` и `UpdateMessage` сразу после `requireMembership`:
1. `parseMentions(content)`.
2. Для каждого `userIDs` — `serverRepo.IsMember(serverID, uid)` (+ сверка с `OwnerID`, по аналогии с `requireMembership`); если хоть один не найден → `domain.ErrInvalidMention`.
3. Если `everyone == true` — `serverRepo.GetMemberRole(serverID, authorID)`; если не `RoleOwner`/`RoleAdmin` → `domain.ErrMentionForbidden`.

`serverID` в `CreateMessage`/`UpdateMessage` сейчас не передаётся явно — достаём его тем же способом, что и `requireMembership` (`channelRepo.GetByID(channelID).ServerID`), внутри `validateMentions` или переиспользуя уже полученный `ch` из `requireMembership` (небольшой рефакторинг: `requireMembership` возвращает `*domain.Channel`, чтобы не делать повторный запрос).

### HTTP-хендлер

`writeUseCaseError` (`message.go:178`) — новые кейсы:
```go
case errors.Is(err, domain.ErrInvalidMention):
    h.sendError(w, http.StatusBadRequest, "invalid mention: user is not a member of this server")
case errors.Is(err, domain.ErrMentionForbidden):
    h.sendError(w, http.StatusForbidden, "only server owner/admin can mention @everyone")
```

Новый `ServerHandler.GetMembers` (`internal/delivery/http/handler/server.go`), паттерн 1:1 с `GetChannels`:
```go
router.HandleFunc("GET /api/v1/servers/{server_id}/members", authMid.RequireAuth(serverHandler.GetMembers))
```

Никаких новых WS-событий не требуется — `message_create`/`message_update` уже разносят полный объект с `content` в сыром виде (со встроенными токенами), клиент парсит их сам при рендере.

## Frontend

### `client/src/services/api.ts`
```ts
async getServerMembers(serverId: string) {
  return this.request(`/api/v1/servers/${serverId}/members`) as Promise<MemberWithUser[]>;
}
```

### Новый стор/кэш участников (`client/src/stores/memberStore.ts` или расширение существующего серверного стора)
Загружается при входе на сервер (там же, где сейчас грузятся каналы), кэшируется по `server_id`, инвалидируется по WS `user_joined`/`user_left`/при явном выходе из сервера — минимально: просто перезапрашивать при смене активного сервера.

### Автокомплит в композере (`ChatArea.tsx`, поле ввода)
- Слушатель на `onChange`/`onKeyUp` textarea: если непосредственно перед курсором есть `@` и после него нет пробела — открыть выпадающий список.
- Источник записей: участники текущего сервера (из стора выше) + 3 статичные записи ролей + `everyone`. `everyone` скрыта/задизейблена, если `currentUserRole` в этом сервере не `owner`/`admin` (роль участника уже доступна на клиенте из member-list или профиля сервера).
- Фильтрация — по подстроке в `username`/названии роли/`everyone`, регистронезависимо.
- Навигация: `↑`/`↓` по списку, `Enter`/клик — вставка токена в позицию курсора (`<@uuid>`, `<@&role>` или `@everyone`), закрытие списка.

### Рендер сообщений (`ChatArea.tsx`, замена `<p className="message-text">{msg.content}</p>`)
Новая чистая функция `renderMessageContent(content, members, currentUserId): ReactNode[]`:
- Разбивает `content` на обычный текст и токены теми же регулярками, что и на бэкенде (`<@uuid>`, `<@&role>`, `@everyone`).
- `<@uuid>` → ищет в закэшированном списке участников, рендерит `<span className="mention">@{username}</span>`; не найден (вышел из сервера) → `@unknown-user`.
- `<@&role>` → `<span className="mention mention-role">@Владелец|@Админ|@Участник</span>` по фиксированному маппингу.
- `@everyone` → `<span className="mention mention-everyone">@everyone</span>`.
- Если токен резолвится в `currentUserId` — дополнительный класс `mention-self` (более яркая подсветка, как в Discord).
- Рендерится через React-элементы (не `dangerouslySetInnerHTML`), XSS-риска нет.

### Обработка ошибок отправки
При `400`/`403` от `POST/PATCH .../messages` — показать inline-ошибку в композере (по аналогии с уже существующей обработкой ошибок отправки), сообщение не добавляется в ленту оптимистично.

## Тестирование

`internal/usecase/message_test.go` (или новый `mentions_test.go` для чистых функций парсинга):
- `parseMentions`: корректно достаёт `user IDs`/роли/`everyone`; невалидный UUID в `<@...>` не матчится (остаётся текстом), нет паники.
- `CreateMessage`/`UpdateMessage`:
  - упоминание участника сервера → ок;
  - упоминание НЕ участника (валидный UUID, но не в `server_members` и не owner) → `ErrInvalidMention`;
  - `<@&admin>` от обычного `member` → ок (роль валидна, право на упоминание роли не требуется, только на `@everyone`);
  - `@everyone` от `member` → `ErrMentionForbidden`;
  - `@everyone` от `admin`/`owner` → ок;
  - сообщение без упоминаний → `validateMentions` не делает лишних вызовов репозитория.
- `ServerHandler.GetMembers` / `GetMembers` usecase: возвращает всех участников + владельца; не-участник сервера → `ErrForbidden`.

Ручная проверка (`/verify`): автокомплит открывается по `@`, фильтрует и вставляет токен; после отправки сообщение рендерит `@username`/`@Роль`/`@everyone` с подсветкой; упоминание себя выделено сильнее; отправка `@everyone` от обычного участника отклоняется с понятной ошибкой в UI.

## Вне скоупа

- Кастомные роли сервера (`roles`/`role_permissions`) — `@role` ограничен 3 фиксированными ролями до появления полноценной ролевой системы.
- Уведомления о упоминании (WS-событие, бейдж непрочитанного, звук/системный notification) — только визуальная подсветка в этой итерации.
- Rich-text/pill-инпут в композере — токен виден как сырой текст до отправки.
- Инвалидация кэша списка участников в реальном времени (WS `user_joined`/`user_left` уже транслируются глобально, но привязка к конкретному серверу для точечной инвалидации не делается) — перезапрос при смене активного сервера считается достаточным.
- Упоминания в DM/групповых DM — в проекте нет системы DM вообще (отдельный пункт борды).
