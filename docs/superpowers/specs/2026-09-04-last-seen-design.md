# Last seen (последний визит)

**Задача (VYC-89):** правый сайдбар участников сервера (`UserList.tsx`)
показывает офлайн-пользователей без указания, когда они были в сети в
последний раз. Нужно фиксировать и показывать «последний визит». Ручка
чтения проектируется как отдельный переиспользуемый API-контракт —
её со временем будет дёргать и мобильное приложение (сейчас не существует
в этом репозитории — см. «Факты о текущем коде»).

**Дата:** 2026-09-04
**Ветка:** `VYC-89-last-online`
**Статус:** дизайн утверждён пользователем (одним заходом, вопросы —
момент фиксации, видимость, формат, форма батч-API — заданы и отвечены до
письменной спеки)

## Решённые вопросы

| Вопрос | Решение |
|---|---|
| Момент фиксации `last_seen_at` | **При переходе в офлайн** — реальный WS-дисконнект, не heartbeat и не «на каждое действие». Пока пользователь online, время не обновляется. |
| Видимость | **С privacy-настройкой у пользователя.** Есть булев флаг `show_last_seen` (по умолчанию `true`); выключивший его отдаёт `visible:false, last_seen_at:null` любому, кто спрашивает — приватность не персонализирована по зрителю (нет «покажи только друзьям»), это сознательный минимум первой итерации. |
| Формат отображения | **Относительное время** («5 мин назад», «вчера в 14:30», полная дата для давних) — рендерится на клиенте из ISO-таймстампа, бэкенд отдаёт сырое время. |
| Форма чтения для сайдбара (много офлайн-юзеров сразу) | **Батч-эндпоинт по списку ID**, не N запросов и не «раздуть» `/users/online`. Тот же контракт годится мобильному клиенту (профиль одного юзера — батч из одного id). |

## Факты о текущем коде, на которые опирается дизайн

Проверено чтением кода 2026-09-04:

- **Источник истины online/offline — WS-хаб в памяти**
  (`server/internal/delivery/ws/hub.go:12-13`, `clients map[uuid.UUID]*Client`),
  не БД. `users.status` — производная копия, которую хендлер апдейтит сбоку.
- **Точка настоящего дисконнекта** — `readPump`'s `defer` в
  `server/internal/delivery/http/handler/websocket.go:97-109`. Перед
  `UpdateStatus(..., StatusOffline)` там уже стоит `wasCurrent :=
  h.hub.IsCurrentClient(client)` — снапшот **до** `UnregisterClient`,
  защищающий от гонки: протухшее соединение, вытесненное реконнектом с
  другой вкладки/устройства, не должно затирать статус живого соединения.
  `last_seen_at` пишется **в этом же `if wasCurrent` блоке**, рядом с
  `UpdateStatus` — переиспользует готовую защиту от гонки, отдельной не
  требуется.
- **`hub.go` не знает про БД** — `unregister`-ветка (`hub.go:93-124`)
  оперирует только `h.clients`/`h.voiceChannels` и рассылает
  `user_left` (`notifyAllOnlineUsersAfterDisconnect`, `hub.go:365-381`).
  Запись `last_seen_at` в БД остаётся целиком в хендлере
  (`websocket.go`), а не в хабе — тот же слой, что уже сегодня зовёт
  `userUseCase.UpdateStatus`.
- **`user_left`-событие не несёт таймстамп** (`hub.go:371-377`, payload —
  только `user_id` и `user_ids` оставшихся онлайн). Фронт после этого
  события обязан отдельно спросить `last_seen_at` — расширять хаб под
  таймстамп не нужно (см. «Реалтайм в сайдбаре» ниже).
- **`User` — плоская модель без слоя настроек**
  (`server/internal/domain/user.go:9-24`): `ID, Username, Email, Password,
  AvatarURL, Status, LastServerID, LastChannelID, CreatedAt, UpdatedAt,
  EmailVerifiedAt`. В миграциях нет таблицы `settings`/`user_settings`,
  JSONB-колонки `settings` тоже нет. Единственный прецедент приватности —
  плоский булев столбец: `servers.is_private`
  (`server/migrations/014_server_privacy.up.sql`). `show_last_seen`
  повторяет этот паттерн, а не заводит отдельную таблицу настроек ради
  одного флага.
- **`Update(id, updates map[string]interface{})` — whitelist-паттерн**
  (`postgres/user.go:176-183`, `allowedUpdateColumns`). Клиенто-управляемые
  поля (`username`, `avatar_url`, `status`, …) идут через него.
  Системно-управляемые (`email_verified_at` — `MarkEmailVerified`,
  `last_server_id`/`last_channel_id` — `UpdateLastVisited`) сознательно
  **вне** whitelist, отдельным методом — см. комментарий у
  `MarkEmailVerified`: «не входит в whitelist произвольных обновлений и
  меняться должна ровно в одном сценарии». `last_seen_at` пишется системой
  (хаб/хендлер при дисконнекте), не клиентом → отдельный метод
  `UpdateLastSeen`, не whitelist-колонка. `show_last_seen`, наоборот,
  переключает сам пользователь по своей воле → обычная whitelist-колонка.
- **`GET /api/v1/users/online`** (`online_users.go`) — уже существующий
  сосед: берёт ID из `hub.GetOnlineUsers()`, догружает по одному через
  `userRepo.GetByID` (N+1 к БД, но список онлайн обычно короткий — тот же
  компромисс, не блокер, просто существующий факт). Новый эндпоинт для
  last-seen **не** встраивается в него — `/users/online` семантически про
  «кто сейчас в сети», батч last-seen — про историю визитов; смешение
  усложнило бы оба контракта и не подошло бы мобильному профилю одного
  юзера.
- **Роутинг** — `net/http.ServeMux` с Go 1.22 method-паттернами,
  `router.HandleFunc("METHOD /path", authMid.RequireAuth(handler))`
  (`server/cmd/api/main.go:221-234`). Юзер из контекста —
  `r.Context().Value("user_id").(uuid.UUID)` (`user.go:41,70,135,173`).
- **Хендлер-паттерн запроса с телом** — `UpdateLastVisited`
  (`user.go:69-106`): `json.NewDecoder(r.Body).Decode(&req)` →
  `httperr.CodeInvalidBody` при ошибке парсинга → вызов usecase →
  `httperr.Code...Failed` при ошибке usecase → `204 No Content` на успех.
  Тот же скелет годится для батч-эндпоинта и для privacy-эндпоинта.
- **Последняя миграция — `022_call_participants`**, пара файлов
  `022_call_participants.up.sql` / `.down.sql`, каждый с собственным
  маркером (`-- +migrate Up` / `-- +migrate Down`) — тот же парный формат,
  что и у `007_user_last_visited`, и тот же, что генерирует
  `make migrate-create NAME=...`. Новая миграция — пара
  `023_user_last_seen.up.sql` / `023_user_last_seen.down.sql`.
- **Фронт**: `UserList.tsx` — `onlineIds: Set<string>` из локального
  `useState`, подгружается `apiService.getOnlineUsers()`
  (`UserList.tsx:50-57`), рефетчится на `online_users`/`user_joined`/
  `user_left`/`user_updated` (`UserList.tsx:40-45`). Разбивка
  online/offline — `useMemo` (`UserList.tsx:110-117`), рендер офлайн-строки
  — `renderMember(m, false)` (`UserList.tsx:119-143,163`). `MemberWithUser`
  (`types/index.ts:141-147`) сейчас не несёт `last_seen_at` — придётся
  добавить.
- **Готового relative-time хелпера нет.** Ближайший образец —
  `formatCallDuration` (`i18n/format.ts:23-38`) и `resolveDayLabel`
  (`format.ts:48-62`) — оба захардкожены по локали (не через
  `plural.ts`/словарь), используют `RU_MONTHS_GENITIVE`/`EN_MONTHS`.
  `formatLastSeen` пишется тем же приёмом.
- **Локали уже несут `server.online`/`server.offline`**
  (`i18n/locales/ru.ts:363-364`, `en.ts:352-353`) — новые ключи для
  last-seen встают рядом.
- **Мобильного клиента в репозитории нет** — ни директории, ни
  RN/Expo/Flutter-конфигов. Контракт проектируется вперёд, но
  реализуется и тестируется только против веб-клиента.

## API-контракт

```
POST /api/v1/users/last-seen
  auth: обязателен (RequireAuth)
  body: {"user_ids": ["uuid", ...]}       // 1..200 элементов
  200: {"<uuid>": {"last_seen_at": "2026-09-04T10:00:00Z" | null, "visible": true|false}, ...}
  400: пустой список, >200 id, невалидный UUID в списке (httperr.CodeInvalidBody / новый код на лимит)

PATCH /api/v1/users/me/privacy
  auth: обязателен
  body: {"show_last_seen": true|false}
  204: успех
  400: невалидное тело
```

Оба — тонкие хендлеры поверх `UserUseCase`, тем же скелетом, что
`UpdateLastVisited` (см. факты выше). Батч выбран через `POST` с телом, не
`GET ?ids=`: список офлайн-участников большого сервера может быть длинным,
упираться в лимит длины URL незачем, и мобильный клиент получает тот же
контракт независимо от платформенных лимитов на длину query-строки.

Ответ на батч — по каждому запрошенному id, а не по массиву в порядке
запроса: так проще матчить на клиенте (`response[userId]`), и несуществующий
id просто не появляется в ключах вместо отдельной ошибки на весь батч.

`visible:false` всегда сопровождается `last_seen_at:null` — на клиенте
это единственное, что нужно проверить, чтобы решить, показывать строку.
Пользователь, который никогда не выходил в офлайн (только зарегистрировался)
и не скрывал last-seen, получает `visible:true, last_seen_at:null` — клиент
просто не рендерит строку (не «давно не был», а ничего), различие с privacy
кейсом клиенту не требуется — оба случая рендерятся одинаково (ничего не
показываем), поле `visible` нужно только чтобы будущий мобильный клиент мог
при желании отрисовать эти два случая по-разному («скрыто пользователем» vs
«ещё ни разу не выходил»).

## Модель данных

Миграция `023_user_last_seen` — пара файлов, тот же парный формат, что и
`022_call_participants`:

```sql
-- server/migrations/023_user_last_seen.up.sql
-- +migrate Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_last_seen BOOLEAN NOT NULL DEFAULT true;
```

```sql
-- server/migrations/023_user_last_seen.down.sql
-- +migrate Down
ALTER TABLE users DROP COLUMN IF EXISTS show_last_seen;
ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at;
```

Индекс не нужен: чтение всегда по `WHERE id = ANY($1)` (первичный ключ),
не по `last_seen_at`.

`domain.User` получает `LastSeenAt *time.Time` и `ShowLastSeen bool`
(добавляются в `SELECT`/`Scan` в `GetByID` — `GetByEmail`/`GetByUsername`/
`Search` их не используют, туда не добавляются, как и `last_server_id`/
`last_channel_id` сейчас не тянутся всеми четырьмя запросами).

## Серверный поток

### `domain/user.go` — контракты

```go
type UserRepository interface {
    // ...существующее...

    // UpdateLastSeen проставляет last_seen_at. Отдельный метод, а не Update
    // с картой — тот же принцип, что уже применён к MarkEmailVerified: не
    // входит в whitelist произвольных обновлений, меняется ровно в одном
    // сценарии (дисконнект WS), клиент не может дёрнуть его напрямую.
    UpdateLastSeen(id uuid.UUID, at time.Time) error

    // GetLastSeenBatch возвращает last_seen-инфо для запрошенных id одним
    // запросом. Отсутствующие id просто не попадают в результат.
    GetLastSeenBatch(ids []uuid.UUID) (map[uuid.UUID]LastSeenInfo, error)
}

// LastSeenInfo — снимок «когда видели» с учётом приватности: Visible=false
// всегда идёт с LastSeenAt=nil, приватность разворачивается в репозитории
// одним SQL CASE, не постфактум в Go.
type LastSeenInfo struct {
    LastSeenAt *time.Time
    Visible    bool
}
```

`show_last_seen` в `UserRepository.Update` — добавляется в
`allowedUpdateColumns["show_last_seen"] = "show_last_seen"`, отдельного
метода не требует (обычная клиенто-управляемая колонка).

### `repository/postgres/user.go`

```go
func (r *userRepository) UpdateLastSeen(id uuid.UUID, at time.Time) error {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    _, err := r.db.Exec(ctx,
        `UPDATE users SET last_seen_at = $1, updated_at = $1 WHERE id = $2`, at, id)
    if err != nil {
        return fmt.Errorf("failed to update last seen: %w", err)
    }
    return nil
}

func (r *userRepository) GetLastSeenBatch(ids []uuid.UUID) (map[uuid.UUID]domain.LastSeenInfo, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    rows, err := r.db.Query(ctx, `
        SELECT id,
               CASE WHEN show_last_seen THEN last_seen_at ELSE NULL END,
               show_last_seen
        FROM users WHERE id = ANY($1)
    `, ids)
    if err != nil {
        return nil, fmt.Errorf("failed to get last seen batch: %w", err)
    }
    defer rows.Close()

    result := make(map[uuid.UUID]domain.LastSeenInfo, len(ids))
    for rows.Next() {
        var id uuid.UUID
        var info domain.LastSeenInfo
        if err := rows.Scan(&id, &info.LastSeenAt, &info.Visible); err != nil {
            return nil, fmt.Errorf("failed to scan last seen row: %w", err)
        }
        result[id] = info
    }
    return result, nil
}
```

### `usecase/user.go`

```go
func (uc *userUseCase) UpdateLastSeen(id uuid.UUID, at time.Time) error {
    if err := uc.userRepo.UpdateLastSeen(id, at); err != nil {
        return fmt.Errorf("failed to update last seen: %w", err)
    }
    return nil
}

// GetLastSeenBatch применяет только защиту от abuse (лимит размера); сама
// приватность уже разворачивается репозиторием — usecase её не трогает
// повторно, чтобы правило "visible=false ⇒ last_seen_at=nil" жило в одном
// месте.
const maxLastSeenBatch = 200

func (uc *userUseCase) GetLastSeenBatch(ids []uuid.UUID) (map[uuid.UUID]domain.LastSeenInfo, error) {
    if len(ids) == 0 {
        return map[uuid.UUID]domain.LastSeenInfo{}, nil
    }
    if len(ids) > maxLastSeenBatch {
        return nil, domain.ErrLastSeenBatchTooLarge
    }
    return uc.userRepo.GetLastSeenBatch(ids)
}

func (uc *userUseCase) SetShowLastSeen(id uuid.UUID, show bool) error {
    if err := uc.userRepo.Update(id, map[string]interface{}{"show_last_seen": show}); err != nil {
        return fmt.Errorf("failed to update show_last_seen: %w", err)
    }
    return nil
}
```

`domain.UserUseCase` пополняется тремя методами: `UpdateLastSeen`,
`GetLastSeenBatch`, `SetShowLastSeen`.

### `websocket.go` — точка записи

```go
if wasCurrent {
    now := time.Now()
    if err := h.userUseCase.UpdateStatus(client.UserID, domain.StatusOffline); err != nil {
        h.log.Warn("failed to set user offline", "user_id", client.UserID, "error", err)
    }
    if err := h.userUseCase.UpdateLastSeen(client.UserID, now); err != nil {
        h.log.Warn("failed to update last seen", "user_id", client.UserID, "error", err)
    }
}
```

Тот же `if wasCurrent` блок, что уже несёт `UpdateStatus` — без нового
условия и без изменений в `hub.go`.

### Хендлеры (`delivery/http/handler/user.go`)

```go
func (h *UserHandler) GetLastSeenBatch(w http.ResponseWriter, r *http.Request) {
    var req struct {
        UserIDs []string `json:"user_ids"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
        return
    }
    if len(req.UserIDs) == 0 {
        h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "user_ids required")
        return
    }
    ids := make([]uuid.UUID, 0, len(req.UserIDs))
    for _, s := range req.UserIDs {
        id, err := uuid.Parse(s)
        if err != nil {
            h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidUserID, "invalid user id in user_ids")
            return
        }
        ids = append(ids, id)
    }

    result, err := h.userUseCase.GetLastSeenBatch(ids)
    if err != nil {
        if errors.Is(err, domain.ErrLastSeenBatchTooLarge) {
            h.sendError(w, http.StatusBadRequest, httperr.CodeLastSeenBatchTooLarge, "too many user_ids")
            return
        }
        h.log.Error("failed to get last seen batch", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
        h.sendError(w, http.StatusInternalServerError, httperr.CodeLastSeenFailed, "failed to get last seen")
        return
    }

    resp := make(map[string]map[string]interface{}, len(result))
    for id, info := range result {
        resp[id.String()] = map[string]interface{}{
            "last_seen_at": info.LastSeenAt,
            "visible":      info.Visible,
        }
    }
    h.sendJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) UpdatePrivacy(w http.ResponseWriter, r *http.Request) {
    userID := r.Context().Value("user_id").(uuid.UUID)
    var req struct {
        ShowLastSeen *bool `json:"show_last_seen"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ShowLastSeen == nil {
        h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
        return
    }
    if err := h.userUseCase.SetShowLastSeen(userID, *req.ShowLastSeen); err != nil {
        h.log.Error("failed to update privacy", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
        h.sendError(w, http.StatusInternalServerError, httperr.CodeLastSeenFailed, "failed to update privacy")
        return
    }
    w.WriteHeader(http.StatusNoContent)
}
```

Новые `httperr` коды: `CodeLastSeenFailed = "last_seen_failed"`,
`CodeLastSeenBatchTooLarge = "last_seen_batch_too_large"`. Новый sentinel
`domain.ErrLastSeenBatchTooLarge`.

### Роуты (`main.go`)

```go
router.HandleFunc("POST /api/v1/users/last-seen", authMid.RequireAuth(userHandler.GetLastSeenBatch))
router.HandleFunc("PATCH /api/v1/users/me/privacy", authMid.RequireAuth(userHandler.UpdatePrivacy))
```

Рядом со строками 229-234 (соседние `/users/...` роуты).

## Реалтайм в сайдбаре

Отдельного WS-события не заводим (YAGNI) — `user_left` уже существует и
`UserList.tsx` уже на него рефетчит (`UserList.tsx:43`). Расширяем
`loadOnlineIds`-цепочку: после пересчёта online/offline фронт батчем
запрашивает `last-seen` для видимого набора офлайн-участников (тех, что
уже в `offlineMembers` после `useMemo`). Без нового серверного кода —
чисто клиентская правка `UserList.tsx`.

## Клиент

- `types/index.ts`: `MemberWithUser.last_seen_at?: string | null` (сырой
  ISO или `null`), `visible` на уровне ответа API маппится в наличие/
  отсутствие значения — на клиент попадает уже готовое `string | null`,
  отдельного поля `visible` в типе не нужно (см. «оба случая рендерятся
  одинаково» в разделе API-контракта).
- `services/api.ts`: `getLastSeenBatch(userIds: string[])` →
  `POST /api/v1/users/last-seen`; `updatePrivacy(showLastSeen: boolean)` →
  `PATCH /api/v1/users/me/privacy`.
- `i18n/format.ts`: `formatLastSeen(date: Date, now: Date, locale: Locale,
  t): string` — по образцу `resolveDayLabel`/`formatCallDuration`, проверка
  порогов в этом порядке (первый подошедший побеждает):
  1. `< 1 мин` → «только что»;
  2. `< 60 мин` → «N мин назад»;
  3. тот же календарный день (`isSameCalendarDay`, вне зависимости от того,
     сколько часов прошло) → «сегодня в HH:MM»;
  4. вчера (`isSameCalendarDay` со сдвигом на -1 день, как в
     `resolveDayLabel`) → «вчера в HH:MM»;
  5. старше — `resolveDayLabel`-стиль полная дата + «в HH:MM».
- `UserList.tsx`: `renderMember` для `online === false` подтягивает
  `m.last_seen_at` и рендерит `formatLastSeen(...)` в `user-item-sub`
  (тот же слот, что сейчас занят `voiceName` у онлайн-участников — они не
  пересекаются, т.к. `voiceName` показывается только при `online`).
- `i18n/locales/{ru,en}.ts`: новые ключи `server.lastSeenJustNow`,
  `server.lastSeenMinutesAgo`, `server.lastSeenToday`,
  `server.lastSeenYesterday` рядом с существующими `server.online`/
  `server.offline` (`ru.ts:363-364`, `en.ts:352-353`).
- Настройка приватности (тумблер `show_last_seen`) — в существующем экране
  настроек профиля; конкретное размещение уточняется на этапе плана
  реализации (файл не исследовался в рамках этой спеки — не архитектурная
  деталь).

## Тесты (TDD — сначала падающий тест, потом реализация)

**`server/internal/repository/postgres`** (через фейковый репозиторий в
usecase-тестах — в кодовой базе нет прецедента живого Postgres-теста,
решение уже принято и задокументировано в плане VYC-87/VYC-88):
- не отдельный Go-тест на живой БД; SQL проверяется косвенно через
  usecase-слой с моком.

**`server/internal/usecase/user_test.go`**
- `GetLastSeenBatch`: пустой список id → пустая карта, репозиторий не
  вызывается.
- `GetLastSeenBatch`: >200 id → `domain.ErrLastSeenBatchTooLarge`,
  репозиторий не вызывается.
- `GetLastSeenBatch`: репозиторий вернул `Visible:false` → usecase не
  трогает `LastSeenAt`, отдаёт как есть (приватность не дублируется в
  usecase).
- `UpdateLastSeen`/`SetShowLastSeen`: пробрасывают вызов и ошибку
  репозитория без изменений (аналог существующих тестов на
  `UpdateStatus`/`UpdateLastVisited`, если такие есть — расширить рядом).

**`server/internal/delivery/http/handler/user_test.go`** (или новый файл,
если `user_test.go` ещё не существует — завести по образцу существующих
handler-тестов в пакете)
- `GetLastSeenBatch`: пустой `user_ids` → 400; невалидный UUID в списке →
  400; успешный батч → 200 с правильной формой JSON (`last_seen_at`,
  `visible` по каждому id).
- `UpdatePrivacy`: отсутствующее/невалидное поле `show_last_seen` → 400;
  успех → 204.

**`server/internal/delivery/http/handler/websocket_test.go`** (расширить
существующий, если он покрывает `readPump`'s defer, иначе — новый
сценарий рядом с тем, что уже проверяет `UpdateStatus` на дисконнект)
- Настоящий дисконнект (`wasCurrent == true`) → `UpdateLastSeen` вызван
  ровно один раз с текущим временем.
- Протухшее соединение, вытесненное реконнектом (`wasCurrent == false`) →
  `UpdateLastSeen` **не** вызван — та же гарантия, что уже есть для
  `UpdateStatus`.

**Клиент (Vitest)**
- `formatLastSeen`: граничные значения — `< 1 мин` → «только что»;
  `5 мин` → «5 мин назад»; `2 часа назад`, тот же календарный день →
  «сегодня в HH:MM» (не «2 ч назад» — правило 3 приоритетнее правила 2 при
  переходе через часовую границу); вчера → «вчера в HH:MM»; `> 7 дней` →
  полная дата.
- `UserList.tsx`: офлайн-участник с `last_seen_at` → строка рендерится;
  `last_seen_at: null` (скрыто приватностью или ни разу не выходил) →
  строка не рендерится; онлайн-участник — `last_seen_at` игнорируется
  независимо от значения.

**Ручной сценарий**: два клиента, один выходит в офлайн (закрывает
вкладку/убивает соединение) → второй в сайдбаре через рефетч на
`user_left` видит время выхода; реконнект с той же учёткой (вытеснение
stale-сессии) → `last_seen_at` не подскакивает на момент вытеснения, только
на настоящий уход.

## Что осознанно не делается

- **Обновление на heartbeat/каждое действие** — отброшено в пользу «только
  при переходе в офлайн» (решение пользователя). Точность страдает, если
  сервер убит без graceful close (`pongWait` до сработки таймаута), но это
  тот же класс деградации, что уже принят для `StatusOffline` сегодня —
  не хуже существующего поведения.
- **Приватность, персонализированная по зрителю** («покажи только
  друзьям/участникам общего сервера») — отброшена в пользу простого
  бинарного `show_last_seen`. Если понадобится differentiated-видимость,
  это отдельная спека поверх готового `LastSeenInfo`-контракта, не
  переделка текущего.
- **WS-событие с таймстампом last-seen** — не заводим; `user_left` уже
  триггерит рефетч, батч-эндпоинт закрывает потребность без нового
  серверного broadcast-трафика.
- **Идентификация мобильного клиента в коде** — контракт спроектирован
  переносимым (usecase не знает про HTTP), но мобильного клиента в
  репозитории нет и он не появляется в рамках этой задачи.
