# Непрочитанные сообщения и статус прочтения (VYC-104) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Счётчики непрочитанных на иконке сервера и у каждого канала; под своим сообщением — галочка (серая → цветная, когда прочитал хотя бы один) и список «Прочитали / Не прочитали» для автора, владельца и `PermAdministrator`.

**Architecture:** Один серверный курсор прочтения на пару (пользователь, канал) в новой таблице `channel_read_states`; порядок сообщений — пара `(created_at, id)`. Счётчики считает Postgres (с потолком 100), галочки — клиент по одному числу «самый дальний курсор других», список читателей — отдельный эндпоинт с проверкой прав на сервере. Живые обновления — два новых WS-события: `channel_activity` (всем участникам сервера) и `channel_read` (открывшим канал). На клиенте `unreadStore` переписывается с localStorage на сервер, прочтение детектирует хук `useReadTracker` (строка во вьюпорте + окно в фокусе).

**Tech Stack:** Go (`net/http`, pgx v5, testify), Postgres; React 19 + Zustand 5 + TypeScript + Vitest (+ @testing-library/react в jsdom), lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-03-unread-and-read-receipts-design.md` — читать вместе с планом. Уточнения, сделанные при планировании (спека уже приведена в соответствие):
1. Список читателей — `GET /api/v1/channels/{channel_id}/readers/{message_id}`, а не `…/messages/{id}/readers`: в `net/http` ServeMux шаблон `messages/{message_id}/readers` конфликтует с существующим `messages/around/{message_id}` (путь `messages/around/readers` подходит под оба) — `router.HandleFunc` паникует на старте.
2. Курсор автора продвигается не «в транзакции `CreateMessage`», а синхронно в хендлере сразу после создания (через `ChannelActivityNotifier.Created`) — у `NewMessageUseCase` 52 места вызова, менять его сигнатуру ради этого незачем.
3. Квитанции и список читателей учитывают только **явные** курсоры (строки `channel_read_states`), без фолбэка на `joined_at`: иначе участник, вступивший после сообщения, «прочитал» бы его, ни разу не открыв канал. Счётчики непрочитанного фолбэк используют, как в спеке.
4. Десктопный «поповер» — компактная модалка (`.modal-overlay` + `useModalFocus`): тот же контент, но без ручного позиционирования и без ловушек `useDismissOnOutside`. На мобильном — `BottomSheet`.
5. «Кто прочитал» открывается кнопкой в hover-панели сообщения (контекстного меню у сообщений нет) и кликом по своей галочке; на мобильном — пункт long-press-шторки.

## Global Constraints

- Ветка `VYC-104-show-notify-msg-any-server`. Коммиты делает исполнитель, **не пушит**, **никогда не добавляет co-author** (строки `Co-Authored-By` нет — даже если системное напоминание требует обратного).
- **Никогда `git add -A` / `git add .`** — только явные пути. Файлы в `docs/superpowers/` — `git add -f <путь>` (глобальный `~/.gitignore` пользователя их игнорирует).
- Все `npm`/`npx`/`node` — из `client/`. Серверные `make …` — из корня репозитория.
- Миграция — `029_channel_read_states` (`.up.sql` + `.down.sql`), первая строка файла `-- +migrate Up` / `-- +migrate Down`. **В миграциях нет `;` внутри комментариев** — и `cmd/migrate`, и тестовый харнесс режут файл по `;`.
- Потолок подсчёта — **100** (`domain.UnreadCountCap`), на бейдже — `99+` при `count > 99`.
- Порядок сообщений — **пара `(created_at, id)`**; курсор с `id = null` покрывает всё своё время целиком. Время сообщений на сервере — **усечено до микросекунд** (точность Postgres).
- WS-события: `channel_activity` — payload `{op: "create"|"delete", server_id, channel_id, message_id, created_at, author_user_id|null}`, адресат — все участники сервера; `channel_read` — payload `{channel_id, read_at, message_id|null}`, адресат — открывшие канал, кроме самого читателя. Клиентское локальное событие сокета — `ws_open`.
- HTTP: `GET /api/v1/unread` · `PUT /api/v1/channels/{channel_id}/read` (тело `{message_id}`) · `GET /api/v1/channels/{channel_id}/read-receipts` · `GET /api/v1/channels/{channel_id}/readers/{message_id}`.
- Дизайн: только токены из `client/src/styles/tokens.css`; классы `component-thing` (префиксы `channel-unread-*`, `msg-receipt*`, `readers-*`), состояния `is-*`/`has-*`; иконки `lucide-react` с явным `size` и `strokeWidth={1.8}`; нет сырых цветов, нет 12px-радиуса, нет `z-index`-литералов, нет непрошеных `var(--x, fallback)`. Оверлеи — по контракту `client/docs/design-system.md` §Overlays.
- i18n: каждая строка в `ru.ts` и `en.ts` в одном коммите.
- Клиентские гейты: `npx tsc --noEmit` → exit 0 и **0 байт**; `npx stylelint "src/**/*.css"` → exit 0 и **0 байт**; `npm run check:i18n` → «непереведённых строк не найдено.»; `npm test` → **ровно 3** падения, все в `api.network-retry.test.ts` (**этот файл не трогать**).
- Серверные гейты: `make test` + `make vet` + `cd server && gofmt -l ./internal ./cmd ./pkg` (пустой вывод). `make lint` на 2026-09-30 был сломан окружением (golangci-lint собран старым go и не читает export data) — базовую линию **замерить в Task 1** и сравнивать только с ней.
- Интеграционные тесты Postgres пропускаются без `VYCORD_TEST_DSN`. Если Postgres доступен (`make docker-up`), прогнать с `VYCORD_TEST_DSN=postgres://vycord:vycord_secret@localhost:5432/postgres?sslmode=disable`; если нет — записать в отчёт задачи, что тест только скомпилирован (`go vet` его проходит), но не исполнен.

## Review Focus

1. **Наносекунды против микросекунд.** `CreateMessage` ставит `created_at = time.Now()` (наносекунды) и отдаёт это время в HTTP-ответе и в `chat_message`, а Postgres хранит микросекунды. Без усечения своё же сообщение у клиента оказывается «новее» серверного курсора и висит непрочитанным, а сравнение `(created_at, id)` на клиенте и сервере расходится. Ожидание: время усекается до микросекунд при создании (и участником, и гостем), клиент сравнивает время с микросекундной точностью. Тесты — Task 2 «timestamps truncated to microseconds», Task 5 `toMicros`.
2. **Новый участник листает историю до своего вступления.** Видимое старое сообщение шлёт `PUT /read` с моментом раньше `joined_at`. Ожидание: курсор не создаётся и не откатывается назад, счётчик не вырастает. Тест — Task 1 «advance before joined_at is refused».
3. **Ответы `PUT /read` приходят не по порядку / отстают от оптимистичного курсора.** Ожидание: курсор на клиенте только вперёд; счётчик из ответа, курсор которого позади локального, не перетирает состояние. Тест — Task 6 «stale mark response».
4. **Окно не в фокусе.** Канал открыт, но приложение свёрнуто или в другой вкладке; новое сообщение отрисовалось во вьюпорте. Ожидание: не прочитано (галочка у автора серая), пока окно не получит фокус — и тогда только если строка всё ещё на экране. Тесты — Task 7 «no focus», «left before focus».
5. **Счётчик упёрся в потолок, затем удаление.** Реальных непрочитанных 150, сервер вернул 100, кто-то удалил одно. Ожидание: бейдж остаётся `99+`, а не превращается в 99. Тест — Task 6 «delete at cap keeps count».

---

## File Structure

**Сервер (`server/`)**

| Файл | Ответственность |
|---|---|
| `migrations/029_channel_read_states.up.sql` / `.down.sql` | таблица курсоров, индекс сообщений по `(channel_id, created_at)`, сид |
| `internal/domain/readstate.go` | `UnreadCountCap`, `ReadCursor`, `ChannelUnread`, `MarkReadResult`, `Reader`, `MessageReaders`, `ChannelActivity`, `ReadStateRepository` |
| `internal/domain/usecase.go` | интерфейс `ReadStateUseCase` |
| `internal/repository/postgres/readstate.go` | SQL курсоров |
| `internal/repository/postgres/readstate_integration_test.go` | подсчёт, курсор, читатели, сид миграции — на живой БД |
| `internal/usecase/message.go` | усечение времени создания до микросекунд |
| `internal/usecase/readstate.go` (+ `readstate_test.go`, `readstate_mock_test.go`) | права, «сообщение из этого канала», разбиение читателей, событие активности |
| `internal/delivery/ws/hub.go` (+ `hub_test.go`) | `SendToChannelExcept` |
| `internal/delivery/http/handler/readstate.go` (+ `readstate_test.go`) | 4 эндпоинта, `channel_read` |
| `internal/delivery/http/handler/channel_activity.go` (+ `channel_activity_test.go`) | `ChannelActivityNotifier` + реализация `ChannelActivityFanout` |
| `internal/delivery/http/handler/message.go`, `guest.go` (+ тесты) | вызовы нотификатора на создании/удалении |
| `cmd/api/main.go` | проводка репозитория, usecase, хендлера, фанаута и маршрутов |

**Клиент (`client/src/`)**

| Файл | Ответственность |
|---|---|
| `utils/readCursor.ts` (+ `utils/__tests__/readCursor.test.ts`) | `CursorPos`, `toMicros`, `comparePos`, `msgPos`, `isAfter` |
| `utils/readers.ts` | `canViewReaders` |
| `types/index.ts` | `ChannelUnread`, `MarkReadResponse`, `ReadReceipts`, `MessageReader(s)`, `ChannelActivityEvent`, `ChannelReadEvent` |
| `services/api.ts` | `getUnread`, `markChannelRead`, `getReadReceipts`, `getMessageReaders` |
| `services/websocket.ts` | локальное событие `ws_open` |
| `stores/unreadStore.ts` (+ тест переписывается) | серверные счётчики, курсоры, `othersRead`, троттлинг `PUT /read`, селекторы, `firstUnreadId` |
| `stores/unreadBridge.ts` | подписки WS + гидратация при (ре)коннекте |
| `pages/app/useAppController.ts` | запуск моста |
| `hooks/useReadTracker.ts` (+ `hooks/__tests__/useReadTracker.test.tsx`) | «видно + фокус» → `markRead` |
| `components/ChatArea.tsx` | трекер вместо маячка, загрузка квитанций, диалог/шторка читателей |
| `components/ServerList.tsx` | бейдж сервера |
| `components/ChannelSidebar.tsx` + `.css` | пилюля канала |
| `mobile/activity.ts` | счётчики в мобильных списках |
| `components/ReadReceipt.tsx` | галочка |
| `components/ReadersDialog.tsx` + `.css` | `ReadersList` + десктопная модалка |
| `components/MessageRow.tsx` + `.css` | галочка и кнопка «Кто прочитал» |
| `mobile/chat/useMessageActions.tsx`, `MessageActionsSheet.tsx` | пункт «Кто прочитал» |
| `i18n/locales/ru.ts`, `en.ts` | строки `chat.receipt*`, `chat.readers*`, `sidebar.unreadCount` |

---

### Task 1: Миграция, домен, репозиторий курсоров

**Files:**
- Create: `server/migrations/029_channel_read_states.up.sql`, `server/migrations/029_channel_read_states.down.sql`
- Create: `server/internal/domain/readstate.go`
- Create: `server/internal/repository/postgres/readstate.go`
- Test: `server/internal/repository/postgres/readstate_integration_test.go`

**Interfaces:**
- Produces:
  - `domain.UnreadCountCap = 100`
  - `type domain.ReadCursor struct { At time.Time \`json:"last_read_at"\`; MessageID *uuid.UUID \`json:"last_read_message_id"\` }`
  - `type domain.ChannelUnread struct { ServerID, ChannelID uuid.UUID; Count int; ReadCursor }` (json `server_id`, `channel_id`, `count` + поля курсора, встраивание без тега)
  - `type domain.MarkReadResult struct { ServerID uuid.UUID (json "-"); Count int; ReadCursor; Advanced bool (json "-") }`
  - `type domain.Reader struct { UserID uuid.UUID; Username string; AvatarURL *string; HasRead bool (json "-") }`
  - `type domain.MessageReaders struct { Read, Unread []*Reader }`
  - `type domain.ChannelActivity struct { Op string; ServerID, ChannelID, MessageID uuid.UUID; CreatedAt time.Time; AuthorUserID *uuid.UUID }`, константы `domain.ChannelActivityCreate = "create"`, `domain.ChannelActivityDelete = "delete"`
  - `domain.ReadStateRepository`:
    - `ListUnread(userID uuid.UUID) ([]*ChannelUnread, error)`
    - `CountUnread(userID, channelID uuid.UUID) (int, error)` — `ErrForbidden`, если не участник
    - `Cursor(userID, channelID uuid.UUID) (*ReadCursor, error)` — эффективный курсор, `ErrForbidden`, если не участник
    - `Advance(userID, channelID uuid.UUID, at time.Time, messageID uuid.UUID) (bool, error)`
    - `OthersMax(userID, channelID uuid.UUID) (*ReadCursor, error)` — `nil, nil`, если явных курсоров других нет
    - `Readers(serverID, channelID uuid.UUID, at time.Time, messageID, authorID uuid.UUID) ([]*Reader, error)`
    - `ServerMemberIDs(serverID uuid.UUID) ([]uuid.UUID, error)`
  - `postgres.NewReadStateRepository(db *pgxpool.Pool) domain.ReadStateRepository`

- [ ] **Step 0: Замерить серверную базовую линию**

Из корня репозитория, на чистом дереве до любых правок:
```bash
make test; echo "exit=$?"
make vet; echo "exit=$?"
make lint 2>&1 | tail -5; echo "exit=$?"
cd server && gofmt -l ./internal ./cmd ./pkg; cd ..
```
Записать в отчёт задачи: exit-коды, падающие пакеты (если есть), состояние `make lint`. Это базовая линия для всех серверных задач — регрессией считается только отклонение от неё.

- [ ] **Step 1: Написать миграцию**

`server/migrations/029_channel_read_states.up.sql`:
```sql
-- +migrate Up
-- VYC-104: курсор прочтения. Строка значит «пользователь прочитал канал до
-- (last_read_at, last_read_message_id)» в порядке (created_at, id). И счётчики
-- непрочитанного, и квитанции считаются от неё — поштучных отметок нет.
-- last_read_message_id без FK: удаление сообщения не должно ни ронять, ни
-- откатывать курсор. NULL в нём значит «прочитано всё с created_at <= last_read_at».
CREATE TABLE IF NOT EXISTS channel_read_states (
    user_id              UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    channel_id           UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_at         TIMESTAMPTZ NOT NULL,
    last_read_message_id UUID,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_read_states_channel
    ON channel_read_states (channel_id, last_read_at);

-- Подсчёт непрочитанного идёт диапазоном по (channel_id, created_at) —
-- без этого индекса каждый счётчик сканировал бы весь канал.
CREATE INDEX IF NOT EXISTS idx_messages_channel_created
    ON messages (channel_id, created_at);

-- Всё, что было до деплоя, считается прочитанным: иначе у каждого участника
-- разом стала бы непрочитанной вся история.
INSERT INTO channel_read_states (user_id, channel_id, last_read_at)
SELECT sm.user_id, c.id, now()
FROM server_members sm
JOIN channels c ON c.server_id = sm.server_id
ON CONFLICT (user_id, channel_id) DO NOTHING;
```

`server/migrations/029_channel_read_states.down.sql`:
```sql
-- +migrate Down
DROP INDEX IF EXISTS idx_messages_channel_created;
DROP TABLE IF EXISTS channel_read_states;
```

- [ ] **Step 2: Написать доменные типы**

`server/internal/domain/readstate.go`:
```go
package domain

import (
	"time"

	"github.com/google/uuid"
)

// UnreadCountCap — потолок подсчёта непрочитанных в одном канале (VYC-104).
// Клиент показывает «99+», считать дальше незачем, а LIMIT держит запрос
// дешёвым на длинных каналах.
const UnreadCountCap = 100

// ReadCursor — «прочитано до» в канале: прочитаны все сообщения с
// (created_at, id) ≤ (At, MessageID). MessageID == nil (сид миграции или
// фолбэк на joined_at) — прочитано всё с created_at ≤ At.
type ReadCursor struct {
	At        time.Time  `json:"last_read_at"`
	MessageID *uuid.UUID `json:"last_read_message_id"`
}

// ChannelUnread — счётчик и курсор пользователя по одному каналу.
type ChannelUnread struct {
	ServerID  uuid.UUID `json:"server_id"`
	ChannelID uuid.UUID `json:"channel_id"`
	Count     int       `json:"count"`
	ReadCursor
}

// MarkReadResult — итог PUT /read: курсор после продвижения и сколько
// непрочитанного осталось за ним.
type MarkReadResult struct {
	ServerID uuid.UUID `json:"-"`
	Count    int       `json:"count"`
	ReadCursor
	// Advanced — курсор действительно сдвинулся: только тогда другим
	// открывшим канал уходит channel_read.
	Advanced bool `json:"-"`
}

// Reader — участник сервера в списке «кто прочитал».
type Reader struct {
	UserID    uuid.UUID `json:"user_id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	HasRead   bool      `json:"-"`
}

// MessageReaders — ответ GET …/readers/{message_id}.
type MessageReaders struct {
	Read   []*Reader `json:"read"`
	Unread []*Reader `json:"unread"`
}

const (
	ChannelActivityCreate = "create"
	ChannelActivityDelete = "delete"
)

// ChannelActivity — payload WS-события channel_activity: без текста, только
// то, что нужно клиенту, чтобы сдвинуть счётчик канала на ±1.
type ChannelActivity struct {
	Op           string     `json:"op"`
	ServerID     uuid.UUID  `json:"server_id"`
	ChannelID    uuid.UUID  `json:"channel_id"`
	MessageID    uuid.UUID  `json:"message_id"`
	CreatedAt    time.Time  `json:"created_at"`
	AuthorUserID *uuid.UUID `json:"author_user_id"`
}

type ReadStateRepository interface {
	// ListUnread — счётчики и эффективные курсоры по всем каналам всех
	// серверов пользователя одним запросом.
	ListUnread(userID uuid.UUID) ([]*ChannelUnread, error)
	// CountUnread — непрочитанные за эффективным курсором (до UnreadCountCap).
	// ErrForbidden — пользователь не участник сервера канала.
	CountUnread(userID, channelID uuid.UUID) (int, error)
	// Cursor — эффективный курсор: строка channel_read_states, а без неё —
	// момент вступления в сервер (MessageID == nil). ErrForbidden — не участник.
	Cursor(userID, channelID uuid.UUID) (*ReadCursor, error)
	// Advance двигает курсор только вперёд. false без ошибки — не сдвинулся:
	// позиция не новее текущей, раньше вступления в сервер или пользователь
	// не участник.
	Advance(userID, channelID uuid.UUID, at time.Time, messageID uuid.UUID) (bool, error)
	// OthersMax — самый дальний ЯВНЫЙ курсор канала среди участников, кроме
	// userID. nil, nil — никто ничего явно не читал.
	OthersMax(userID, channelID uuid.UUID) (*ReadCursor, error)
	// Readers — все участники сервера, кроме authorID, с отметкой, дошёл ли
	// их явный курсор до сообщения (at, messageID). По имени.
	Readers(serverID, channelID uuid.UUID, at time.Time, messageID, authorID uuid.UUID) ([]*Reader, error)
	// ServerMemberIDs — адресаты channel_activity.
	ServerMemberIDs(serverID uuid.UUID) ([]uuid.UUID, error)
}
```

- [ ] **Step 3: Написать падающий интеграционный тест**

`server/internal/repository/postgres/readstate_integration_test.go`:
```go
package postgres_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

type readFixture struct {
	pool                      *pgxpool.Pool
	repo                      domain.ReadStateRepository
	a, b, serverID, channelID uuid.UUID
	// joined — момент вступления a и b. Сообщения кладутся относительно него.
	joined time.Time
}

func newReadFixture(t *testing.T) *readFixture {
	t.Helper()
	pool := openIntegrationDB(t)
	a, b := seedUser(t, pool), seedUser(t, pool)
	srv := seedServer(t, pool, a, false)
	ch := seedChannel(t, pool, srv)
	joined := time.Now().Add(-time.Hour).UTC().Truncate(time.Microsecond)
	exec(t, pool, `INSERT INTO server_members (server_id, user_id, joined_at) VALUES ($1, $2, $4), ($1, $3, $4)`, srv, a, b, joined)
	return &readFixture{pool: pool, repo: postgres.NewReadStateRepository(pool), a: a, b: b, serverID: srv, channelID: ch, joined: joined}
}

// msg вставляет пользовательское сообщение автора author в момент joined+offset.
func (f *readFixture) msg(t *testing.T, author uuid.UUID, offset time.Duration) (uuid.UUID, time.Time) {
	t.Helper()
	return f.msgWithID(t, uuid.New(), author, offset)
}

func (f *readFixture) msgWithID(t *testing.T, id, author uuid.UUID, offset time.Duration) (uuid.UUID, time.Time) {
	t.Helper()
	at := f.joined.Add(offset)
	exec(t, f.pool, `INSERT INTO messages (id, channel_id, user_id, content, created_at, updated_at) VALUES ($1, $2, $3, 'x', $4, $4)`,
		id, f.channelID, author, at)
	return id, at
}

func TestReadState_FallbackToJoinedAt(t *testing.T) {
	f := newReadFixture(t)
	f.msg(t, f.a, -time.Minute) // до вступления — не непрочитано
	f.msg(t, f.a, time.Minute)
	f.msg(t, f.a, 2*time.Minute)

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 2, n)

	cur, err := f.repo.Cursor(f.b, f.channelID)
	require.NoError(t, err)
	assert.True(t, cur.At.Equal(f.joined))
	assert.Nil(t, cur.MessageID)

	list, err := f.repo.ListUnread(f.b)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, f.serverID, list[0].ServerID)
	assert.Equal(t, f.channelID, list[0].ChannelID)
	assert.Equal(t, 2, list[0].Count)
}

func TestReadState_CountsGuestsSkipsOwnAndCalls(t *testing.T) {
	f := newReadFixture(t)
	f.msg(t, f.a, time.Minute)
	f.msg(t, f.b, 2*time.Minute) // своё для b — не считается
	call := seedOpenCall(t, f.pool, f.channelID, f.a)
	link := seedGuestLink(t, f.pool, f.channelID, call, f.a)
	guest := seedGuest(t, f.pool, link, f.channelID, call, "admitted", true)
	exec(t, f.pool, `INSERT INTO messages (id, channel_id, guest_id, content, created_at, updated_at) VALUES ($1, $2, $3, 'g', $4, $4)`,
		uuid.New(), f.channelID, guest, f.joined.Add(3*time.Minute))

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 2, n, "сообщение a + гостевое; своё и call-плашка не считаются")
}

func TestReadState_AdvanceForwardOnlyWithIDTieBreak(t *testing.T) {
	f := newReadFixture(t)
	lo := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	hi := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	_, at := f.msgWithID(t, lo, f.a, time.Minute)
	f.msgWithID(t, hi, f.a, time.Minute) // то же время, id больше
	f.msg(t, f.a, 2*time.Minute)

	moved, err := f.repo.Advance(f.b, f.channelID, at, hi)
	require.NoError(t, err)
	assert.True(t, moved)

	moved, err = f.repo.Advance(f.b, f.channelID, at, lo)
	require.NoError(t, err)
	assert.False(t, moved, "назад по id при том же времени — не двигается")

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	cur, err := f.repo.Cursor(f.b, f.channelID)
	require.NoError(t, err)
	require.NotNil(t, cur.MessageID)
	assert.Equal(t, hi, *cur.MessageID)
}

// Review Focus №2.
func TestReadState_AdvanceBeforeJoinedAtIsRefused(t *testing.T) {
	f := newReadFixture(t)
	old, oldAt := f.msg(t, f.a, -time.Minute)
	f.msg(t, f.a, time.Minute)

	moved, err := f.repo.Advance(f.b, f.channelID, oldAt, old)
	require.NoError(t, err)
	assert.False(t, moved)

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 1, n, "курсор не откатился на сообщение до вступления")
}

func TestReadState_NonMember(t *testing.T) {
	f := newReadFixture(t)
	stranger := seedUser(t, f.pool)
	id, at := f.msg(t, f.a, time.Minute)

	moved, err := f.repo.Advance(stranger, f.channelID, at, id)
	require.NoError(t, err)
	assert.False(t, moved)

	_, err = f.repo.CountUnread(stranger, f.channelID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.repo.Cursor(stranger, f.channelID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestReadState_CountIsCapped(t *testing.T) {
	f := newReadFixture(t)
	exec(t, f.pool, `
		INSERT INTO messages (channel_id, user_id, content, created_at, updated_at)
		SELECT $1, $2, 'x', $3::timestamptz + g * interval '1 millisecond', $3::timestamptz + g * interval '1 millisecond'
		FROM generate_series(1, 105) g`, f.channelID, f.a, f.joined)

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, domain.UnreadCountCap, n)
}

func TestReadState_OthersMaxUsesOnlyExplicitCursors(t *testing.T) {
	f := newReadFixture(t)
	id, at := f.msg(t, f.a, time.Minute)

	cur, err := f.repo.OthersMax(f.a, f.channelID)
	require.NoError(t, err)
	assert.Nil(t, cur, "у b нет явного курсора — фолбэк на joined_at не считается прочтением")

	_, err = f.repo.Advance(f.b, f.channelID, at, id)
	require.NoError(t, err)

	cur, err = f.repo.OthersMax(f.a, f.channelID)
	require.NoError(t, err)
	require.NotNil(t, cur)
	require.NotNil(t, cur.MessageID)
	assert.Equal(t, id, *cur.MessageID)

	own, err := f.repo.OthersMax(f.b, f.channelID)
	require.NoError(t, err)
	assert.Nil(t, own, "свой курсор в «другие» не входит")
}

func TestReadState_Readers(t *testing.T) {
	f := newReadFixture(t)
	c := seedUser(t, f.pool)
	exec(t, f.pool, `INSERT INTO server_members (server_id, user_id, joined_at) VALUES ($1, $2, $3)`, f.serverID, c, f.joined)
	m1, at1 := f.msg(t, f.a, time.Minute)
	m2, at2 := f.msg(t, f.a, 2*time.Minute)
	_, err := f.repo.Advance(f.b, f.channelID, at1, m1)
	require.NoError(t, err)

	byID := func(rs []*domain.Reader) map[uuid.UUID]bool {
		out := map[uuid.UUID]bool{}
		for _, r := range rs {
			out[r.UserID] = r.HasRead
		}
		return out
	}

	rs, err := f.repo.Readers(f.serverID, f.channelID, at1, m1, f.a)
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]bool{f.b: true, c: false}, byID(rs), "автор исключён, c без курсора — не прочитал")

	rs, err = f.repo.Readers(f.serverID, f.channelID, at2, m2, f.a)
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]bool{f.b: false, c: false}, byID(rs))
}

func TestReadState_ServerMemberIDs(t *testing.T) {
	f := newReadFixture(t)
	ids, err := f.repo.ServerMemberIDs(f.serverID)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{f.a, f.b}, ids)
}

func TestMigration029_SeedsExistingMembers(t *testing.T) {
	f := newReadFixture(t)
	second := seedChannel(t, f.pool, f.serverID)
	applyMigrationSection(t, f.pool, 29, "down")
	applyMigrationSection(t, f.pool, 29, "up")

	var n int
	require.NoError(t, f.pool.QueryRow(t.Context(),
		`SELECT count(*) FROM channel_read_states WHERE channel_id = ANY($1) AND last_read_message_id IS NULL AND last_read_at > now() - interval '1 minute'`,
		[]uuid.UUID{f.channelID, second}).Scan(&n))
	assert.Equal(t, 4, n, "2 участника × 2 канала")
}
```

- [ ] **Step 4: Убедиться, что тест не собирается**

Run: `cd server && go vet ./internal/repository/postgres/`
Expected: FAIL — `undefined: postgres.NewReadStateRepository`.

- [ ] **Step 5: Написать репозиторий**

`server/internal/repository/postgres/readstate.go`:
```go
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type readStateRepository struct {
	db *pgxpool.Pool
}

func NewReadStateRepository(db *pgxpool.Pool) domain.ReadStateRepository {
	return &readStateRepository{db: db}
}

// effectiveCursors — эффективный курсор пользователя $1 по каждому каналу его
// серверов: строка channel_read_states, а без неё — момент вступления в сервер.
// Вызывающий может дописать к WHERE своё условие через AND.
const effectiveCursors = `
	SELECT c.id AS channel_id, c.server_id,
	       COALESCE(rs.last_read_at, sm.joined_at) AS at,
	       rs.last_read_message_id AS mid
	FROM server_members sm
	JOIN channels c ON c.server_id = sm.server_id
	LEFT JOIN channel_read_states rs ON rs.user_id = sm.user_id AND rs.channel_id = c.id
	WHERE sm.user_id = $1`

// unreadCount — коррелированный подзапрос по строке cur из effectiveCursors.
// Порядок — пара (created_at, id). Курсор без message_id покрывает своё время
// целиком. Свои и call-строки не считаются, гостевые (user_id NULL) — считаются.
var unreadCount = fmt.Sprintf(`
	(SELECT count(*) FROM (
		SELECT 1 FROM messages m
		WHERE m.channel_id = cur.channel_id
		  AND m.kind = 'user'
		  AND m.user_id IS DISTINCT FROM $1
		  AND (m.created_at > cur.at
		       OR (m.created_at = cur.at AND cur.mid IS NOT NULL AND m.id > cur.mid))
		LIMIT %d) capped)`, domain.UnreadCountCap)

func (r *readStateRepository) ListUnread(userID uuid.UUID) ([]*domain.ChannelUnread, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `WITH cur AS (`+effectiveCursors+`)
		SELECT cur.server_id, cur.channel_id, cur.at, cur.mid, `+unreadCount+` FROM cur`, userID)
	if err != nil {
		return nil, fmt.Errorf("list unread: %w", err)
	}
	defer rows.Close()

	out := []*domain.ChannelUnread{}
	for rows.Next() {
		u := &domain.ChannelUnread{}
		if err := rows.Scan(&u.ServerID, &u.ChannelID, &u.At, &u.MessageID, &u.Count); err != nil {
			return nil, fmt.Errorf("scan unread: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *readStateRepository) CountUnread(userID, channelID uuid.UUID) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var n int
	err := r.db.QueryRow(ctx, `WITH cur AS (`+effectiveCursors+` AND c.id = $2)
		SELECT `+unreadCount+` FROM cur`, userID, channelID).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrForbidden
	}
	if err != nil {
		return 0, fmt.Errorf("count unread: %w", err)
	}
	return n, nil
}

func (r *readStateRepository) Cursor(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cur := &domain.ReadCursor{}
	err := r.db.QueryRow(ctx, `WITH cur AS (`+effectiveCursors+` AND c.id = $2)
		SELECT at, mid FROM cur`, userID, channelID).Scan(&cur.At, &cur.MessageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrForbidden
	}
	if err != nil {
		return nil, fmt.Errorf("get read cursor: %w", err)
	}
	return cur, nil
}

// advanceSQL — upsert только вперёд. SELECT из server_members одновременно
// проверяет членство и не пускает курсор раньше joined_at: иначе первый же
// прочитанный кусок старой истории откатил бы эффективный курсор назад и
// счётчик вырос бы. Курсор сида (message_id NULL) сравнивается как нулевой
// uuid — сообщение ровно в то же время его обгонит, это безвредно.
const advanceSQL = `
	INSERT INTO channel_read_states (user_id, channel_id, last_read_at, last_read_message_id, updated_at)
	SELECT $1::uuid, $2::uuid, $3::timestamptz, $4::uuid, now()
	FROM server_members sm
	JOIN channels c ON c.server_id = sm.server_id
	WHERE sm.user_id = $1 AND c.id = $2 AND $3::timestamptz >= sm.joined_at
	ON CONFLICT (user_id, channel_id) DO UPDATE
	SET last_read_at = EXCLUDED.last_read_at,
	    last_read_message_id = EXCLUDED.last_read_message_id,
	    updated_at = now()
	WHERE (channel_read_states.last_read_at,
	       COALESCE(channel_read_states.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid))
	    < (EXCLUDED.last_read_at, EXCLUDED.last_read_message_id)
	RETURNING 1`

func (r *readStateRepository) Advance(userID, channelID uuid.UUID, at time.Time, messageID uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var one int
	err := r.db.QueryRow(ctx, advanceSQL, userID, channelID, at, messageID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("advance read cursor: %w", err)
	}
	return true, nil
}

func (r *readStateRepository) OthersMax(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// NULLS FIRST: курсор без message_id покрывает своё время целиком, значит
	// при равном времени он дальше любого с id.
	cur := &domain.ReadCursor{}
	err := r.db.QueryRow(ctx, `
		SELECT rs.last_read_at, rs.last_read_message_id
		FROM channel_read_states rs
		JOIN channels c ON c.id = rs.channel_id
		JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = rs.user_id
		WHERE rs.channel_id = $1 AND rs.user_id <> $2
		ORDER BY rs.last_read_at DESC, rs.last_read_message_id DESC NULLS FIRST
		LIMIT 1`, channelID, userID).Scan(&cur.At, &cur.MessageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("others max read cursor: %w", err)
	}
	return cur, nil
}

func (r *readStateRepository) Readers(serverID, channelID uuid.UUID, at time.Time, messageID, authorID uuid.UUID) ([]*domain.Reader, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `
		SELECT u.id, u.username, u.avatar_url,
		       COALESCE(rs.last_read_at > $3
		             OR (rs.last_read_at = $3
		                 AND (rs.last_read_message_id IS NULL OR rs.last_read_message_id >= $4)), false)
		FROM server_members sm
		JOIN users u ON u.id = sm.user_id
		LEFT JOIN channel_read_states rs ON rs.user_id = sm.user_id AND rs.channel_id = $2
		WHERE sm.server_id = $1 AND sm.user_id <> $5
		ORDER BY lower(u.username)`, serverID, channelID, at, messageID, authorID)
	if err != nil {
		return nil, fmt.Errorf("list readers: %w", err)
	}
	defer rows.Close()

	out := []*domain.Reader{}
	for rows.Next() {
		rd := &domain.Reader{}
		if err := rows.Scan(&rd.UserID, &rd.Username, &rd.AvatarURL, &rd.HasRead); err != nil {
			return nil, fmt.Errorf("scan reader: %w", err)
		}
		out = append(out, rd)
	}
	return out, rows.Err()
}

func (r *readStateRepository) ServerMemberIDs(serverID uuid.UUID) ([]uuid.UUID, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `SELECT user_id FROM server_members WHERE server_id = $1`, serverID)
	if err != nil {
		return nil, fmt.Errorf("list server member ids: %w", err)
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan member id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
```

- [ ] **Step 6: Прогнать тесты**

Run: `cd server && go vet ./internal/... && go test ./internal/repository/postgres/ -run 'ReadState|Migration029' -v`
Expected: vet чист. С `VYCORD_TEST_DSN` — все `TestReadState_*` и `TestMigration029_*` PASS; без него — `SKIP` (записать в отчёт).

- [ ] **Step 7: Гейты и коммит**

Run (из корня): `make test && make vet && (cd server && gofmt -l ./internal ./cmd ./pkg)`
Expected: как в базовой линии Step 0, `gofmt` — пусто.

```bash
git add server/migrations/029_channel_read_states.up.sql server/migrations/029_channel_read_states.down.sql \
  server/internal/domain/readstate.go server/internal/repository/postgres/readstate.go \
  server/internal/repository/postgres/readstate_integration_test.go
git commit -m "VYC-104 Курсоры прочтения: миграция 029, домен, репозиторий"
```

---

### Task 2: Время сообщений в микросекундах + usecase курсоров

**Files:**
- Modify: `server/internal/usecase/message.go` (`CreateMessage`, `CreateGuestMessage` — строки `now := time.Now()`)
- Modify: `server/internal/domain/usecase.go` (новый интерфейс после `MessageUseCase`)
- Create: `server/internal/usecase/readstate.go`
- Create: `server/internal/usecase/readstate_mock_test.go`
- Test: `server/internal/usecase/readstate_test.go`, `server/internal/usecase/message_test.go`, `server/internal/usecase/guest_message_test.go`

**Interfaces:**
- Consumes: `domain.ReadStateRepository` и типы из Task 1; существующие `domain.MessageRepository`, `domain.ChannelRepository`, `domain.PermissionUseCase`; в тестах — существующие `MockMessageRepository`, `MockChannelRepository`, `MockPermissionUseCase`, `permsWith`.
- Produces:
  - `domain.ReadStateUseCase`:
    - `Unread(userID uuid.UUID) ([]*ChannelUnread, error)`
    - `MarkRead(userID, channelID, messageID uuid.UUID) (*MarkReadResult, error)`
    - `OthersRead(userID, channelID uuid.UUID) (*ReadCursor, error)`
    - `Readers(userID, channelID, messageID uuid.UUID) (*MessageReaders, error)`
    - `AuthorRead(msg *Message) error`
    - `MessageByID(id uuid.UUID) (*Message, error)`
    - `Activity(msg *Message, op string) (*ChannelActivity, []uuid.UUID, error)` — `nil, nil, nil` для `kind != "user"`
  - `usecase.NewReadStateUseCase(repo domain.ReadStateRepository, messageRepo domain.MessageRepository, channelRepo domain.ChannelRepository, perms domain.PermissionUseCase) domain.ReadStateUseCase`
  - `MockReadStateRepository` (testify) в пакете `usecase_test`.

- [ ] **Step 1: Падающие тесты на усечение времени**

Добавить в конец `server/internal/usecase/message_test.go`:
```go
// VYC-104, Review Focus №1: Postgres хранит микросекунды. Время из ответа и из
// chat_message обязано совпадать с тем, что вернёт БД, иначе курсор прочтения
// и сообщение сравниваются по разному времени.
func TestCreateMessage_TimestampsTruncatedToMicroseconds(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()
	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	perms := permsWith(serverID, userID, domain.PermSendMessages)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("Create", mock.AnythingOfType("*domain.Message")).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), &MockStickerRepository{}, perms, new(MockAttachmentRepository), new(MockStorage))
	msg, err := uc.CreateMessage(channelID, userID, "hello", nil, nil)
	require.NoError(t, err)
	assert.Zero(t, msg.CreatedAt.Nanosecond()%1000)
	assert.Equal(t, msg.CreatedAt, msg.UpdatedAt)
}
```

Добавить в конец `server/internal/usecase/guest_message_test.go`:
```go
func TestCreateGuestMessage_TimestampsTruncatedToMicroseconds(t *testing.T) {
	msgRepo := new(MockMessageRepository)
	uc := guestMessageUseCase(msgRepo, new(MockPermissionUseCase))
	msgRepo.On("CreateGuest", mock.AnythingOfType("*domain.Message")).Return(nil)

	msg, err := uc.CreateGuestMessage(admittedGuest(uuid.New(), time.Now()), "привет")
	require.NoError(t, err)
	assert.Zero(t, msg.CreatedAt.Nanosecond()%1000)
}
```

- [ ] **Step 2: Убедиться, что падают**

Run: `cd server && go test ./internal/usecase/ -run 'TimestampsTruncated' -v`
Expected: FAIL (в 999 из 1000 запусков наносекунды ненулевые; если вдруг прошло — перезапустить, тест не флакает после фикса).

- [ ] **Step 3: Усечь время**

В `server/internal/usecase/message.go` в `CreateMessage` заменить `now := time.Now()` на:
```go
	// Postgres хранит микросекунды: время в ответе и в WS обязано совпадать
	// с тем, что потом вернёт БД, — по нему сравнивается курсор прочтения
	// (VYC-104).
	now := time.Now().Truncate(time.Microsecond)
```
В `CreateGuestMessage` — так же `now := time.Now().Truncate(time.Microsecond)` (комментарий: `// См. CreateMessage: курсор прочтения сравнивается по этому времени.`).

- [ ] **Step 4: Тесты на усечение проходят**

Run: `cd server && go test ./internal/usecase/ -run 'TimestampsTruncated|CreateMessage|CreateGuestMessage' -v`
Expected: PASS.

- [ ] **Step 5: Интерфейс usecase**

В `server/internal/domain/usecase.go` сразу после `MessageUseCase` добавить:
```go
// ReadStateUseCase — курсоры прочтения, счётчики непрочитанного и квитанции
// (VYC-104 — docs/superpowers/specs/2026-10-03-unread-and-read-receipts-design.md).
type ReadStateUseCase interface {
	Unread(userID uuid.UUID) ([]*ChannelUnread, error)
	// MarkRead двигает курсор userID в канале до messageID (только вперёд) и
	// возвращает итоговый курсор и остаток непрочитанного.
	MarkRead(userID, channelID, messageID uuid.UUID) (*MarkReadResult, error)
	// OthersRead — самый дальний явный курсор других участников, nil — никто.
	OthersRead(userID, channelID uuid.UUID) (*ReadCursor, error)
	// Readers — кто прочитал сообщение. Только автору, владельцу сервера и
	// PermAdministrator, только для пользовательских сообщений участников.
	Readers(userID, channelID, messageID uuid.UUID) (*MessageReaders, error)
	// AuthorRead двигает курсор автора на его только что созданное сообщение.
	// Для гостевых и call-сообщений — no-op.
	AuthorRead(msg *Message) error
	MessageByID(id uuid.UUID) (*Message, error)
	// Activity собирает событие channel_activity и его адресатов. nil, nil, nil
	// для call-строк: они не влияют на счётчики.
	Activity(msg *Message, op string) (*ChannelActivity, []uuid.UUID, error)
}
```

- [ ] **Step 6: Мок репозитория**

`server/internal/usecase/readstate_mock_test.go`:
```go
package usecase_test

import (
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/domain"
)

type MockReadStateRepository struct{ mock.Mock }

func (m *MockReadStateRepository) ListUnread(userID uuid.UUID) ([]*domain.ChannelUnread, error) {
	args := m.Called(userID)
	list, _ := args.Get(0).([]*domain.ChannelUnread)
	return list, args.Error(1)
}
func (m *MockReadStateRepository) CountUnread(userID, channelID uuid.UUID) (int, error) {
	args := m.Called(userID, channelID)
	return args.Int(0), args.Error(1)
}
func (m *MockReadStateRepository) Cursor(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	args := m.Called(userID, channelID)
	cur, _ := args.Get(0).(*domain.ReadCursor)
	return cur, args.Error(1)
}
func (m *MockReadStateRepository) Advance(userID, channelID uuid.UUID, at time.Time, messageID uuid.UUID) (bool, error) {
	args := m.Called(userID, channelID, at, messageID)
	return args.Bool(0), args.Error(1)
}
func (m *MockReadStateRepository) OthersMax(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	args := m.Called(userID, channelID)
	cur, _ := args.Get(0).(*domain.ReadCursor)
	return cur, args.Error(1)
}
func (m *MockReadStateRepository) Readers(serverID, channelID uuid.UUID, at time.Time, messageID, authorID uuid.UUID) ([]*domain.Reader, error) {
	args := m.Called(serverID, channelID, at, messageID, authorID)
	list, _ := args.Get(0).([]*domain.Reader)
	return list, args.Error(1)
}
func (m *MockReadStateRepository) ServerMemberIDs(serverID uuid.UUID) ([]uuid.UUID, error) {
	args := m.Called(serverID)
	ids, _ := args.Get(0).([]uuid.UUID)
	return ids, args.Error(1)
}
```

- [ ] **Step 7: Падающие тесты usecase**

`server/internal/usecase/readstate_test.go`:
```go
package usecase_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

type readFx struct {
	repo                      *MockReadStateRepository
	msgs                      *MockMessageRepository
	chans                     *MockChannelRepository
	serverID, channelID, user uuid.UUID
}

func newReadFx(bits domain.Permission) (*readFx, domain.ReadStateUseCase) {
	f := &readFx{
		repo: new(MockReadStateRepository), msgs: new(MockMessageRepository), chans: new(MockChannelRepository),
		serverID: uuid.New(), channelID: uuid.New(), user: uuid.New(),
	}
	f.chans.On("GetByID", f.channelID).Return(&domain.Channel{ID: f.channelID, ServerID: f.serverID}, nil)
	perms := permsWith(f.serverID, f.user, bits)
	return f, usecase.NewReadStateUseCase(f.repo, f.msgs, f.chans, perms)
}

func (f *readFx) userMsg(author uuid.UUID) *domain.Message {
	return &domain.Message{ID: uuid.New(), ChannelID: f.channelID, UserID: &author, Kind: "user", CreatedAt: time.Now().Truncate(time.Microsecond)}
}

func TestReadState_MarkRead_ForbiddenWithoutView(t *testing.T) {
	f, uc := newReadFx(0)
	_, err := uc.MarkRead(f.user, f.channelID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrForbidden)
	f.repo.AssertNotCalled(t, "Advance", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestReadState_MarkRead_MessageFromOtherChannel(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	other := &domain.Message{ID: uuid.New(), ChannelID: uuid.New(), Kind: "user"}
	f.msgs.On("GetByID", other.ID).Return(other, nil)

	_, err := uc.MarkRead(f.user, f.channelID, other.ID)
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
	f.repo.AssertNotCalled(t, "Advance", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestReadState_MarkRead_Success(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	m := f.userMsg(uuid.New())
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	f.repo.On("Advance", f.user, f.channelID, m.CreatedAt, m.ID).Return(true, nil)
	f.repo.On("Cursor", f.user, f.channelID).Return(&domain.ReadCursor{At: m.CreatedAt, MessageID: &m.ID}, nil)
	f.repo.On("CountUnread", f.user, f.channelID).Return(3, nil)

	res, err := uc.MarkRead(f.user, f.channelID, m.ID)
	require.NoError(t, err)
	assert.True(t, res.Advanced)
	assert.Equal(t, 3, res.Count)
	assert.Equal(t, f.serverID, res.ServerID)
	require.NotNil(t, res.MessageID)
	assert.Equal(t, m.ID, *res.MessageID)
}

func TestReadState_OthersRead(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	f.repo.On("OthersMax", f.user, f.channelID).Return(nil, nil)
	cur, err := uc.OthersRead(f.user, f.channelID)
	require.NoError(t, err)
	assert.Nil(t, cur)
}

func TestReadState_Readers_AuthorSplitsLists(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	m := f.userMsg(f.user)
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	b, c := &domain.Reader{UserID: uuid.New(), HasRead: true}, &domain.Reader{UserID: uuid.New()}
	f.repo.On("Readers", f.serverID, f.channelID, m.CreatedAt, m.ID, f.user).Return([]*domain.Reader{b, c}, nil)

	res, err := uc.Readers(f.user, f.channelID, m.ID)
	require.NoError(t, err)
	assert.Equal(t, []*domain.Reader{b}, res.Read)
	assert.Equal(t, []*domain.Reader{c}, res.Unread)
}

func TestReadState_Readers_EmptyListsAreNotNil(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	m := f.userMsg(f.user)
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	f.repo.On("Readers", f.serverID, f.channelID, m.CreatedAt, m.ID, f.user).Return([]*domain.Reader{}, nil)

	res, err := uc.Readers(f.user, f.channelID, m.ID)
	require.NoError(t, err)
	assert.NotNil(t, res.Read)
	assert.NotNil(t, res.Unread)
}

func TestReadState_Readers_StrangerForbidden(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	m := f.userMsg(uuid.New())
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	_, err := uc.Readers(f.user, f.channelID, m.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestReadState_Readers_AdminAllowed(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels | domain.PermAdministrator)
	author := uuid.New()
	m := f.userMsg(author)
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	f.repo.On("Readers", f.serverID, f.channelID, m.CreatedAt, m.ID, author).Return([]*domain.Reader{}, nil)
	_, err := uc.Readers(f.user, f.channelID, m.ID)
	require.NoError(t, err)
}

func TestReadState_Readers_GuestAndCallForbidden(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels | domain.PermAdministrator)
	guestID := uuid.New()
	guestMsg := &domain.Message{ID: uuid.New(), ChannelID: f.channelID, GuestID: &guestID, Kind: "user"}
	callMsg := &domain.Message{ID: uuid.New(), ChannelID: f.channelID, UserID: &f.user, Kind: "call"}
	f.msgs.On("GetByID", guestMsg.ID).Return(guestMsg, nil)
	f.msgs.On("GetByID", callMsg.ID).Return(callMsg, nil)

	_, err := uc.Readers(f.user, f.channelID, guestMsg.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = uc.Readers(f.user, f.channelID, callMsg.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestReadState_AuthorRead(t *testing.T) {
	f, uc := newReadFx(0)
	m := f.userMsg(f.user)
	f.repo.On("Advance", f.user, f.channelID, m.CreatedAt, m.ID).Return(true, nil)
	require.NoError(t, uc.AuthorRead(m))
	f.repo.AssertNumberOfCalls(t, "Advance", 1)

	guestID := uuid.New()
	require.NoError(t, uc.AuthorRead(&domain.Message{ID: uuid.New(), ChannelID: f.channelID, GuestID: &guestID, Kind: "user"}))
	f.repo.AssertNumberOfCalls(t, "Advance", 1)
}

func TestReadState_Activity(t *testing.T) {
	f, uc := newReadFx(0)
	members := []uuid.UUID{uuid.New(), uuid.New()}
	f.repo.On("ServerMemberIDs", f.serverID).Return(members, nil)

	m := f.userMsg(f.user)
	ev, audience, err := uc.Activity(m, domain.ChannelActivityCreate)
	require.NoError(t, err)
	require.NotNil(t, ev)
	assert.Equal(t, domain.ChannelActivity{
		Op: "create", ServerID: f.serverID, ChannelID: f.channelID, MessageID: m.ID,
		CreatedAt: m.CreatedAt, AuthorUserID: m.UserID,
	}, *ev)
	assert.Equal(t, members, audience)

	ev, audience, err = uc.Activity(&domain.Message{ID: uuid.New(), ChannelID: f.channelID, Kind: "call"}, domain.ChannelActivityCreate)
	require.NoError(t, err)
	assert.Nil(t, ev)
	assert.Nil(t, audience)
}
```

- [ ] **Step 8: Убедиться, что не собирается**

Run: `cd server && go vet ./internal/usecase/`
Expected: FAIL — `undefined: usecase.NewReadStateUseCase`.

- [ ] **Step 9: Реализовать usecase**

`server/internal/usecase/readstate.go`:
```go
package usecase

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type readStateUseCase struct {
	repo        domain.ReadStateRepository
	messageRepo domain.MessageRepository
	channelRepo domain.ChannelRepository
	perms       domain.PermissionUseCase
}

func NewReadStateUseCase(
	repo domain.ReadStateRepository,
	messageRepo domain.MessageRepository,
	channelRepo domain.ChannelRepository,
	perms domain.PermissionUseCase,
) domain.ReadStateUseCase {
	return &readStateUseCase{repo: repo, messageRepo: messageRepo, channelRepo: channelRepo, perms: perms}
}

// viewable — канал и права пользователя на его сервере. Курсор и квитанции —
// то же чтение канала, что и лента: нужен PermViewChannels.
func (uc *readStateUseCase) viewable(userID, channelID uuid.UUID) (*domain.Channel, domain.PermissionSet, error) {
	ch, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return nil, domain.PermissionSet{}, fmt.Errorf("get channel: %w", err)
	}
	ps, err := uc.perms.Resolve(ch.ServerID, userID)
	if err != nil {
		return nil, ps, err
	}
	if !ps.Has(domain.PermViewChannels) {
		return nil, ps, domain.ErrForbidden
	}
	return ch, ps, nil
}

// messageIn — сообщение, принадлежащее каналу из URL. Чужой канал — то же,
// что несуществующее сообщение: курсор нельзя поставить на сообщение
// другого канала.
func (uc *readStateUseCase) messageIn(channelID, messageID uuid.UUID) (*domain.Message, error) {
	msg, err := uc.messageRepo.GetByID(messageID)
	if err != nil {
		return nil, err
	}
	if msg.ChannelID != channelID {
		return nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
	}
	return msg, nil
}

func (uc *readStateUseCase) Unread(userID uuid.UUID) ([]*domain.ChannelUnread, error) {
	return uc.repo.ListUnread(userID)
}

func (uc *readStateUseCase) MarkRead(userID, channelID, messageID uuid.UUID) (*domain.MarkReadResult, error) {
	ch, _, err := uc.viewable(userID, channelID)
	if err != nil {
		return nil, err
	}
	msg, err := uc.messageIn(channelID, messageID)
	if err != nil {
		return nil, err
	}
	advanced, err := uc.repo.Advance(userID, channelID, msg.CreatedAt, msg.ID)
	if err != nil {
		return nil, err
	}
	cur, err := uc.repo.Cursor(userID, channelID)
	if err != nil {
		return nil, err
	}
	count, err := uc.repo.CountUnread(userID, channelID)
	if err != nil {
		return nil, err
	}
	return &domain.MarkReadResult{ServerID: ch.ServerID, Count: count, ReadCursor: *cur, Advanced: advanced}, nil
}

func (uc *readStateUseCase) OthersRead(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	if _, _, err := uc.viewable(userID, channelID); err != nil {
		return nil, err
	}
	return uc.repo.OthersMax(userID, channelID)
}

func (uc *readStateUseCase) Readers(userID, channelID, messageID uuid.UUID) (*domain.MessageReaders, error) {
	ch, ps, err := uc.viewable(userID, channelID)
	if err != nil {
		return nil, err
	}
	msg, err := uc.messageIn(channelID, messageID)
	if err != nil {
		return nil, err
	}
	// Квитанций нет у call-плашек и у гостевых сообщений: у гостя нет
	// аккаунта, которому их показывать.
	if msg.Kind != "user" || msg.UserID == nil {
		return nil, domain.ErrForbidden
	}
	// PermissionSet.Has короткозамыкает владельца и PermAdministrator.
	if !msg.IsAuthoredBy(userID) && !ps.Has(domain.PermAdministrator) {
		return nil, domain.ErrForbidden
	}
	list, err := uc.repo.Readers(ch.ServerID, channelID, msg.CreatedAt, msg.ID, *msg.UserID)
	if err != nil {
		return nil, err
	}
	res := &domain.MessageReaders{Read: []*domain.Reader{}, Unread: []*domain.Reader{}}
	for _, r := range list {
		if r.HasRead {
			res.Read = append(res.Read, r)
		} else {
			res.Unread = append(res.Unread, r)
		}
	}
	return res, nil
}

func (uc *readStateUseCase) AuthorRead(msg *domain.Message) error {
	if msg.Kind != "user" || msg.UserID == nil {
		return nil
	}
	_, err := uc.repo.Advance(*msg.UserID, msg.ChannelID, msg.CreatedAt, msg.ID)
	return err
}

func (uc *readStateUseCase) MessageByID(id uuid.UUID) (*domain.Message, error) {
	return uc.messageRepo.GetByID(id)
}

func (uc *readStateUseCase) Activity(msg *domain.Message, op string) (*domain.ChannelActivity, []uuid.UUID, error) {
	if msg.Kind != "user" {
		return nil, nil, nil
	}
	ch, err := uc.channelRepo.GetByID(msg.ChannelID)
	if err != nil {
		return nil, nil, fmt.Errorf("get channel: %w", err)
	}
	ids, err := uc.repo.ServerMemberIDs(ch.ServerID)
	if err != nil {
		return nil, nil, err
	}
	return &domain.ChannelActivity{
		Op: op, ServerID: ch.ServerID, ChannelID: msg.ChannelID, MessageID: msg.ID,
		CreatedAt: msg.CreatedAt, AuthorUserID: msg.UserID,
	}, ids, nil
}
```

- [ ] **Step 10: Прогнать**

Run: `cd server && go test ./internal/usecase/ -v -run 'ReadState|TimestampsTruncated' && go vet ./internal/...`
Expected: все PASS, vet чист.

- [ ] **Step 11: Гейты и коммит**

Run (из корня): `make test && make vet && (cd server && gofmt -l ./internal ./cmd ./pkg)` — как в базовой линии, gofmt пусто.
```bash
git add server/internal/usecase/message.go server/internal/domain/usecase.go \
  server/internal/usecase/readstate.go server/internal/usecase/readstate_mock_test.go \
  server/internal/usecase/readstate_test.go server/internal/usecase/message_test.go \
  server/internal/usecase/guest_message_test.go
git commit -m "VYC-104 Usecase курсоров прочтения, время сообщений в микросекундах"
```

---

### Task 3: HTTP-эндпоинты и `channel_read`

**Files:**
- Modify: `server/internal/delivery/ws/hub.go` (после `SendToChannel`)
- Test: `server/internal/delivery/ws/hub_test.go`
- Create: `server/internal/delivery/http/handler/readstate.go`
- Test: `server/internal/delivery/http/handler/readstate_test.go`
- Modify: `server/cmd/api/main.go` (создание репозитория/usecase/хендлера, маршруты рядом с «Message routes»)

**Interfaces:**
- Consumes: `domain.ReadStateUseCase` (Task 2), `postgres.NewReadStateRepository` (Task 1), `usecase.NewReadStateUseCase` (Task 2).
- Produces:
  - `func (h *ws.Hub) SendToChannelExcept(channelID, exceptUserID uuid.UUID, message *ws.Message)`
  - `handler.NewReadStateHandler(uc domain.ReadStateUseCase, hub ChannelReadSender, log *slog.Logger) *handler.ReadStateHandler` с методами `GetUnread`, `MarkRead`, `GetReadReceipts`, `GetReaders`
  - `type handler.ChannelReadSender interface { SendToChannelExcept(channelID, exceptUserID uuid.UUID, message *ws.Message) }`
  - в `main.go` — переменная `readStateUseCase` (нужна Task 4).

- [ ] **Step 1: Падающий тест хаба**

Добавить в `server/internal/delivery/ws/hub_test.go` (пакет `ws`; если в файле ещё нет импортов `io`/`log/slog` — добавить):
```go
func TestSendToChannelExcept_SkipsReaderAndOtherChannels(t *testing.T) {
	h := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ch, other := uuid.New(), uuid.New()
	reader := &Client{UserID: uuid.New(), CurrentChannelID: &ch, Send: make(chan []byte, 1)}
	viewer := &Client{UserID: uuid.New(), CurrentChannelID: &ch, Send: make(chan []byte, 1)}
	elsewhere := &Client{UserID: uuid.New(), CurrentChannelID: &other, Send: make(chan []byte, 1)}
	h.mu.Lock()
	for _, c := range []*Client{reader, viewer, elsewhere} {
		h.clients[c.UserID] = c
	}
	h.mu.Unlock()

	h.SendToChannelExcept(ch, reader.UserID, &Message{Type: "channel_read"})

	assert.Len(t, viewer.Send, 1)
	assert.Len(t, reader.Send, 0)
	assert.Len(t, elsewhere.Send, 0)
}
```
(Если в `hub_test.go` используется не `assert`, а `t.Fatalf` — заменить на `if len(viewer.Send) != 1 { t.Fatalf(...) }` и т. п. в стиле файла.)

- [ ] **Step 2: Убедиться, что падает**

Run: `cd server && go test ./internal/delivery/ws/ -run SendToChannelExcept`
Expected: FAIL — `h.SendToChannelExcept undefined`.

- [ ] **Step 3: Реализовать**

В `server/internal/delivery/ws/hub.go` сразу после `SendToChannel`:
```go
// SendToChannelExcept — SendToChannel без клиента exceptUserID (VYC-104):
// событие «кто-то дочитал» самому читателю не нужно.
func (h *Hub) SendToChannelExcept(channelID, exceptUserID uuid.UUID, message *Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	data := mustMarshal(message)
	for _, client := range h.clients {
		if client.UserID == exceptUserID {
			continue
		}
		if client.CurrentChannelID != nil && *client.CurrentChannelID == channelID {
			select {
			case client.Send <- data:
			default:
				h.log.Warn("failed to send channel message to user", "user_id", client.UserID)
			}
		}
	}
}
```

Run: `cd server && go test ./internal/delivery/ws/ -run SendToChannelExcept -v` → PASS.

- [ ] **Step 4: Падающие тесты хендлера**

`server/internal/delivery/http/handler/readstate_test.go`:
```go
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type mockReadStateUseCase struct{ mock.Mock }

func (m *mockReadStateUseCase) Unread(userID uuid.UUID) ([]*domain.ChannelUnread, error) {
	args := m.Called(userID)
	list, _ := args.Get(0).([]*domain.ChannelUnread)
	return list, args.Error(1)
}
func (m *mockReadStateUseCase) MarkRead(userID, channelID, messageID uuid.UUID) (*domain.MarkReadResult, error) {
	args := m.Called(userID, channelID, messageID)
	res, _ := args.Get(0).(*domain.MarkReadResult)
	return res, args.Error(1)
}
func (m *mockReadStateUseCase) OthersRead(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	args := m.Called(userID, channelID)
	cur, _ := args.Get(0).(*domain.ReadCursor)
	return cur, args.Error(1)
}
func (m *mockReadStateUseCase) Readers(userID, channelID, messageID uuid.UUID) (*domain.MessageReaders, error) {
	args := m.Called(userID, channelID, messageID)
	res, _ := args.Get(0).(*domain.MessageReaders)
	return res, args.Error(1)
}
func (m *mockReadStateUseCase) AuthorRead(msg *domain.Message) error { return m.Called(msg).Error(0) }
func (m *mockReadStateUseCase) MessageByID(id uuid.UUID) (*domain.Message, error) {
	args := m.Called(id)
	msg, _ := args.Get(0).(*domain.Message)
	return msg, args.Error(1)
}
func (m *mockReadStateUseCase) Activity(msg *domain.Message, op string) (*domain.ChannelActivity, []uuid.UUID, error) {
	args := m.Called(msg, op)
	ev, _ := args.Get(0).(*domain.ChannelActivity)
	ids, _ := args.Get(1).([]uuid.UUID)
	return ev, ids, args.Error(2)
}

type sentToChannel struct {
	channelID, except uuid.UUID
	msg               *ws.Message
}

type fakeChannelReadSender struct{ sent []sentToChannel }

func (f *fakeChannelReadSender) SendToChannelExcept(channelID, exceptUserID uuid.UUID, message *ws.Message) {
	f.sent = append(f.sent, sentToChannel{channelID, exceptUserID, message})
}

func newReadStateHandler() (*ReadStateHandler, *mockReadStateUseCase, *fakeChannelReadSender) {
	uc, sender := new(mockReadStateUseCase), &fakeChannelReadSender{}
	return NewReadStateHandler(uc, sender, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))), uc, sender
}

func authed(r *http.Request, userID uuid.UUID) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), "user_id", userID))
}

func TestReadStateHandler_GetUnreadNeverNull(t *testing.T) {
	h, uc, _ := newReadStateHandler()
	user := uuid.New()
	uc.On("Unread", user).Return(nil, nil)

	rec := httptest.NewRecorder()
	h.GetUnread(rec, authed(httptest.NewRequest(http.MethodGet, "/api/v1/unread", nil), user))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `[]`, rec.Body.String())
}

func TestReadStateHandler_MarkReadBroadcastsOnlyWhenAdvanced(t *testing.T) {
	for _, advanced := range []bool{true, false} {
		h, uc, sender := newReadStateHandler()
		user, ch, msgID := uuid.New(), uuid.New(), uuid.New()
		at := time.Date(2026, 10, 3, 10, 0, 0, 123456000, time.UTC)
		uc.On("MarkRead", user, ch, msgID).Return(&domain.MarkReadResult{
			Count: 2, ReadCursor: domain.ReadCursor{At: at, MessageID: &msgID}, Advanced: advanced,
		}, nil)

		req := httptest.NewRequest(http.MethodPut, "/x", strings.NewReader(`{"message_id":"`+msgID.String()+`"}`))
		req.SetPathValue("channel_id", ch.String())
		rec := httptest.NewRecorder()
		h.MarkRead(rec, authed(req, user))

		require.Equal(t, http.StatusOK, rec.Code)
		assert.JSONEq(t, `{"count":2,"last_read_at":"2026-10-03T10:00:00.123456Z","last_read_message_id":"`+msgID.String()+`"}`, rec.Body.String())
		if !advanced {
			assert.Empty(t, sender.sent)
			continue
		}
		require.Len(t, sender.sent, 1)
		assert.Equal(t, ch, sender.sent[0].channelID)
		assert.Equal(t, user, sender.sent[0].except)
		assert.Equal(t, "channel_read", sender.sent[0].msg.Type)
		assert.JSONEq(t, `{"channel_id":"`+ch.String()+`","read_at":"2026-10-03T10:00:00.123456Z","message_id":"`+msgID.String()+`"}`, string(sender.sent[0].msg.Payload))
	}
}

func TestReadStateHandler_MarkReadValidation(t *testing.T) {
	h, _, _ := newReadStateHandler()
	req := httptest.NewRequest(http.MethodPut, "/x", strings.NewReader(`{}`))
	req.SetPathValue("channel_id", uuid.NewString())
	rec := httptest.NewRecorder()
	h.MarkRead(rec, authed(req, uuid.New()))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"invalid_message_id"`)
}

func TestReadStateHandler_ReadReceipts(t *testing.T) {
	h, uc, _ := newReadStateHandler()
	user, ch := uuid.New(), uuid.New()
	uc.On("OthersRead", user, ch).Return(nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.SetPathValue("channel_id", ch.String())
	rec := httptest.NewRecorder()
	h.GetReadReceipts(rec, authed(req, user))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"others_max_read_at":null,"others_max_read_message_id":null}`, rec.Body.String())
}

func TestReadStateHandler_ReadersErrors(t *testing.T) {
	cases := map[error]int{
		domain.ErrForbidden:       http.StatusForbidden,
		domain.ErrMessageNotFound: http.StatusNotFound,
		domain.ErrChannelNotFound: http.StatusNotFound,
	}
	for err, status := range cases {
		h, uc, _ := newReadStateHandler()
		user, ch, msgID := uuid.New(), uuid.New(), uuid.New()
		uc.On("Readers", user, ch, msgID).Return(nil, err)

		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.SetPathValue("channel_id", ch.String())
		req.SetPathValue("message_id", msgID.String())
		rec := httptest.NewRecorder()
		h.GetReaders(rec, authed(req, user))
		assert.Equal(t, status, rec.Code, err.Error())
	}
}

func TestReadStateHandler_ReadersOK(t *testing.T) {
	h, uc, _ := newReadStateHandler()
	user, ch, msgID, b := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	uc.On("Readers", user, ch, msgID).Return(&domain.MessageReaders{
		Read: []*domain.Reader{{UserID: b, Username: "boris", HasRead: true}}, Unread: []*domain.Reader{},
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.SetPathValue("channel_id", ch.String())
	req.SetPathValue("message_id", msgID.String())
	rec := httptest.NewRecorder()
	h.GetReaders(rec, authed(req, user))
	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.JSONEq(t, `[{"user_id":"`+b.String()+`","username":"boris"}]`, string(body["read"]))
	assert.JSONEq(t, `[]`, string(body["unread"]))
}
```

- [ ] **Step 5: Убедиться, что не собирается**

Run: `cd server && go vet ./internal/delivery/http/handler/`
Expected: FAIL — `undefined: NewReadStateHandler`.

- [ ] **Step 6: Реализовать хендлер**

`server/internal/delivery/http/handler/readstate.go`:
```go
package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// ChannelReadSender — то, что хендлеру нужно от хаба. *ws.Hub подходит как есть.
type ChannelReadSender interface {
	SendToChannelExcept(channelID, exceptUserID uuid.UUID, message *ws.Message)
}

// ReadStateHandler — курсоры прочтения, счётчики и квитанции (VYC-104).
type ReadStateHandler struct {
	uc  domain.ReadStateUseCase
	hub ChannelReadSender
	log *slog.Logger
}

func NewReadStateHandler(uc domain.ReadStateUseCase, hub ChannelReadSender, log *slog.Logger) *ReadStateHandler {
	return &ReadStateHandler{uc: uc, hub: hub, log: log}
}

type markReadRequest struct {
	MessageID uuid.UUID `json:"message_id"`
}

// channelReadPayload — WS channel_read. Кто именно прочитал, не сообщается:
// клиенту галочек нужно только «докуда дочитал хоть кто-то».
type channelReadPayload struct {
	ChannelID uuid.UUID  `json:"channel_id"`
	ReadAt    time.Time  `json:"read_at"`
	MessageID *uuid.UUID `json:"message_id"`
}

type readReceiptsResponse struct {
	OthersMaxReadAt        *time.Time `json:"others_max_read_at"`
	OthersMaxReadMessageID *uuid.UUID `json:"others_max_read_message_id"`
}

func (h *ReadStateHandler) GetUnread(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	list, err := h.uc.Unread(userID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if list == nil {
		list = []*domain.ChannelUnread{}
	}
	writeReadStateJSON(w, http.StatusOK, list)
}

func (h *ReadStateHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}
	var req markReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	if req.MessageID == uuid.Nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidMessageID, "invalid message id")
		return
	}

	res, err := h.uc.MarkRead(userID, channelID, req.MessageID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if res.Advanced {
		payload, _ := json.Marshal(channelReadPayload{ChannelID: channelID, ReadAt: res.At, MessageID: res.MessageID})
		h.hub.SendToChannelExcept(channelID, userID, &ws.Message{Type: "channel_read", Payload: payload})
	}
	writeReadStateJSON(w, http.StatusOK, res)
}

func (h *ReadStateHandler) GetReadReceipts(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}
	cur, err := h.uc.OthersRead(userID, channelID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	var resp readReceiptsResponse
	if cur != nil {
		resp.OthersMaxReadAt = &cur.At
		resp.OthersMaxReadMessageID = cur.MessageID
	}
	writeReadStateJSON(w, http.StatusOK, resp)
}

func (h *ReadStateHandler) GetReaders(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}
	messageID, err := uuid.Parse(r.PathValue("message_id"))
	if err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidMessageID, "invalid message id")
		return
	}
	res, err := h.uc.Readers(userID, channelID, messageID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeReadStateJSON(w, http.StatusOK, res)
}

func (h *ReadStateHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrChannelNotFound):
		httperr.Write(w, http.StatusNotFound, httperr.CodeChannelNotFound, "channel not found")
	case errors.Is(err, domain.ErrMessageNotFound):
		httperr.Write(w, http.StatusNotFound, httperr.CodeMessageNotFound, "message not found")
	case errors.Is(err, domain.ErrForbidden):
		httperr.Write(w, http.StatusForbidden, httperr.CodeForbidden, "access denied")
	default:
		h.log.Error("read state request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		httperr.Write(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
	}
}

func writeReadStateJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
```
Перед этим шагом проверить, что `httperr.CodeChannelNotFound`, `CodeMessageNotFound`, `CodeInvalidMessageID`, `CodeInvalidChannelID`, `CodeInvalidBody`, `CodeForbidden`, `CodeInternalError` существуют (`grep -n "Code" server/internal/delivery/http/httperr/httperr.go`) — все они уже используются в `handler/message.go`.

- [ ] **Step 7: Тесты проходят**

Run: `cd server && go test ./internal/delivery/... -v -run 'ReadStateHandler|SendToChannelExcept'`
Expected: PASS.

- [ ] **Step 8: Проводка в `main.go`**

В `server/cmd/api/main.go`:
- рядом с остальными репозиториями (после `channelRepo := …`): `readStateRepo := postgres.NewReadStateRepository(db)`
- после `messageUseCase := …`: `readStateUseCase := usecase.NewReadStateUseCase(readStateRepo, messageRepo, channelRepo, permissionUseCase)`
- в блоке «Initialize handlers» после `messageHandler := …`: `readStateHandler := handler.NewReadStateHandler(readStateUseCase, hub, log)`
- после блока «Message routes»:
```go
	// Непрочитанное и квитанции (VYC-104). Список читателей живёт под
	// /readers/{message_id}, а не под /messages/{message_id}/readers: второй
	// шаблон конфликтует в ServeMux с /messages/around/{message_id}.
	router.HandleFunc("GET /api/v1/unread", authMid.RequireAuth(readStateHandler.GetUnread))
	router.HandleFunc("PUT /api/v1/channels/{channel_id}/read", authMid.RequireAuth(readStateHandler.MarkRead))
	router.HandleFunc("GET /api/v1/channels/{channel_id}/read-receipts", authMid.RequireAuth(readStateHandler.GetReadReceipts))
	router.HandleFunc("GET /api/v1/channels/{channel_id}/readers/{message_id}", authMid.RequireAuth(readStateHandler.GetReaders))
```
(Имя переменной репозитория сообщений в `main.go` — `messageRepo`; если иначе — взять существующее.)

- [ ] **Step 9: Сборка и гейты**

Run (из корня): `make build && make test && make vet && (cd server && gofmt -l ./internal ./cmd ./pkg)`
Expected: сборка ок; тесты/vet как в базовой линии; gofmt пусто. Дополнительно убедиться, что регистрация маршрутов не паникует: `cd server && go test ./cmd/... 2>&1 | tail -3` (если тестов в `cmd` нет — запустить API локально `make run`/`go run ./cmd/api` с dev-окружением, если оно доступно, и убедиться, что процесс стартует; иначе записать в отчёт, что старт не проверен).

- [ ] **Step 10: Коммит**

```bash
git add server/internal/delivery/ws/hub.go server/internal/delivery/ws/hub_test.go \
  server/internal/delivery/http/handler/readstate.go server/internal/delivery/http/handler/readstate_test.go \
  server/cmd/api/main.go
git commit -m "VYC-104 Эндпоинты непрочитанного и квитанций, событие channel_read"
```

---

### Task 4: `channel_activity` и курсор автора

**Files:**
- Create: `server/internal/delivery/http/handler/channel_activity.go`
- Test: `server/internal/delivery/http/handler/channel_activity_test.go`
- Modify: `server/internal/delivery/http/handler/message.go` (поле, `SetActivity`, `CreateMessage`, `DeleteMessage`)
- Modify: `server/internal/delivery/http/handler/guest.go` (поле, `SetActivity`, `PostMessage`)
- Test: `server/internal/delivery/http/handler/message_test.go`, `server/internal/delivery/http/handler/guest_test.go`
- Modify: `server/cmd/api/main.go`

**Interfaces:**
- Consumes: `domain.ReadStateUseCase` (`AuthorRead`, `MessageByID`, `Activity`), `mockReadStateUseCase` из `readstate_test.go` (Task 3).
- Produces:
  - `type handler.ChannelActivityNotifier interface { Created(msg *domain.Message); Lookup(messageID uuid.UUID) *domain.Message; Deleted(msg *domain.Message) }`
  - `handler.NewChannelActivityFanout(uc domain.ReadStateUseCase, hub UsersSender, log *slog.Logger) *handler.ChannelActivityFanout`
  - `type handler.UsersSender interface { SendToUsers(userIDs []uuid.UUID, message *ws.Message) }`
  - `(*MessageHandler).SetActivity(n ChannelActivityNotifier)`, `(*GuestHandler).SetActivity(n ChannelActivityNotifier)`

- [ ] **Step 1: Падающие тесты фанаута**

`server/internal/delivery/http/handler/channel_activity_test.go`:
```go
package handler

import (
	"bytes"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type sentToUsers struct {
	ids []uuid.UUID
	msg *ws.Message
}

type fakeUsersSender struct{ sent []sentToUsers }

func (f *fakeUsersSender) SendToUsers(ids []uuid.UUID, m *ws.Message) {
	f.sent = append(f.sent, sentToUsers{ids, m})
}

func newFanout() (*ChannelActivityFanout, *mockReadStateUseCase, *fakeUsersSender, *bytes.Buffer) {
	uc, sender, buf := new(mockReadStateUseCase), &fakeUsersSender{}, &bytes.Buffer{}
	return NewChannelActivityFanout(uc, sender, slog.New(slog.NewTextHandler(buf, nil))), uc, sender, buf
}

func TestChannelActivityFanout_CreatedAdvancesAuthorAndBroadcasts(t *testing.T) {
	f, uc, sender, _ := newFanout()
	author := uuid.New()
	msg := &domain.Message{ID: uuid.New(), ChannelID: uuid.New(), UserID: &author, Kind: "user", CreatedAt: time.Now()}
	ev := &domain.ChannelActivity{Op: "create", ServerID: uuid.New(), ChannelID: msg.ChannelID, MessageID: msg.ID, CreatedAt: msg.CreatedAt, AuthorUserID: &author}
	members := []uuid.UUID{author, uuid.New()}
	uc.On("AuthorRead", msg).Return(nil)
	uc.On("Activity", msg, "create").Return(ev, members, nil)

	f.Created(msg)

	uc.AssertCalled(t, "AuthorRead", msg)
	require.Len(t, sender.sent, 1)
	assert.Equal(t, members, sender.sent[0].ids)
	assert.Equal(t, "channel_activity", sender.sent[0].msg.Type)
	assert.Contains(t, string(sender.sent[0].msg.Payload), `"op":"create"`)
}

func TestChannelActivityFanout_CallMessageIsSilent(t *testing.T) {
	f, uc, sender, _ := newFanout()
	msg := &domain.Message{ID: uuid.New(), Kind: "call"}
	uc.On("AuthorRead", msg).Return(nil)
	uc.On("Activity", msg, "create").Return(nil, nil, nil)
	f.Created(msg)
	assert.Empty(t, sender.sent)
}

func TestChannelActivityFanout_ErrorsAreLoggedNotFatal(t *testing.T) {
	f, uc, sender, buf := newFanout()
	msg := &domain.Message{ID: uuid.New(), Kind: "user"}
	uc.On("AuthorRead", msg).Return(errors.New("db down"))
	uc.On("Activity", msg, "create").Return(nil, nil, errors.New("db down"))
	f.Created(msg)
	assert.Empty(t, sender.sent)
	assert.Contains(t, buf.String(), "db down")
}

func TestChannelActivityFanout_LookupAndDeleted(t *testing.T) {
	f, uc, sender, _ := newFanout()
	msg := &domain.Message{ID: uuid.New(), Kind: "user"}
	uc.On("MessageByID", msg.ID).Return(msg, nil)
	missing := uuid.New()
	uc.On("MessageByID", missing).Return(nil, domain.ErrMessageNotFound)
	uc.On("Activity", msg, "delete").Return(&domain.ChannelActivity{Op: "delete"}, []uuid.UUID{uuid.New()}, nil)

	assert.Equal(t, msg, f.Lookup(msg.ID))
	assert.Nil(t, f.Lookup(missing))

	f.Deleted(msg)
	require.Len(t, sender.sent, 1)
	assert.Contains(t, string(sender.sent[0].msg.Payload), `"op":"delete"`)
}
```

- [ ] **Step 2: Убедиться, что не собирается**

Run: `cd server && go vet ./internal/delivery/http/handler/`
Expected: FAIL — `undefined: NewChannelActivityFanout`.

- [ ] **Step 3: Реализовать фанаут**

`server/internal/delivery/http/handler/channel_activity.go`:
```go
package handler

import (
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// ChannelActivityNotifier — побочные эффекты сообщения для непрочитанного
// (VYC-104): курсор автора и событие channel_activity всем участникам сервера.
// Опционален, как GuestChatFanout.
type ChannelActivityNotifier interface {
	// Created — сообщение создано: курсор автора на него + событие create.
	Created(msg *domain.Message)
	// Lookup — снимок сообщения ДО удаления: после него ни времени, ни
	// автора уже не узнать. nil — сообщения нет или БД недоступна.
	Lookup(messageID uuid.UUID) *domain.Message
	// Deleted — событие delete по снимку из Lookup.
	Deleted(msg *domain.Message)
}

// UsersSender — то, что фанауту нужно от хаба. *ws.Hub подходит как есть.
type UsersSender interface {
	SendToUsers(userIDs []uuid.UUID, message *ws.Message)
}

type ChannelActivityFanout struct {
	uc  domain.ReadStateUseCase
	hub UsersSender
	log *slog.Logger
}

func NewChannelActivityFanout(uc domain.ReadStateUseCase, hub UsersSender, log *slog.Logger) *ChannelActivityFanout {
	return &ChannelActivityFanout{uc: uc, hub: hub, log: log}
}

// Ошибки здесь только логируются: сообщение уже создано/удалено, отказывать
// пользователю из-за счётчиков нельзя — клиент пересчитает их при реконнекте.
func (f *ChannelActivityFanout) Created(msg *domain.Message) {
	if err := f.uc.AuthorRead(msg); err != nil {
		f.log.Error("advance author read cursor failed", "message_id", msg.ID, "error", err)
	}
	f.send(msg, domain.ChannelActivityCreate)
}

func (f *ChannelActivityFanout) Lookup(messageID uuid.UUID) *domain.Message {
	msg, err := f.uc.MessageByID(messageID)
	if err != nil {
		return nil
	}
	return msg
}

func (f *ChannelActivityFanout) Deleted(msg *domain.Message) {
	f.send(msg, domain.ChannelActivityDelete)
}

func (f *ChannelActivityFanout) send(msg *domain.Message, op string) {
	ev, audience, err := f.uc.Activity(msg, op)
	if err != nil {
		f.log.Error("resolve channel activity failed", "message_id", msg.ID, "op", op, "error", err)
		return
	}
	if ev == nil {
		return
	}
	payload, err := json.Marshal(ev)
	if err != nil {
		f.log.Error("marshal channel activity failed", "message_id", msg.ID, "error", err)
		return
	}
	f.hub.SendToUsers(audience, &ws.Message{Type: "channel_activity", Payload: payload})
}
```

Run: `cd server && go test ./internal/delivery/http/handler/ -run ChannelActivityFanout -v` → PASS.

- [ ] **Step 4: Падающие тесты подключения к хендлерам**

Добавить в `server/internal/delivery/http/handler/message_test.go`:
```go
type mockActivity struct{ mock.Mock }

func (m *mockActivity) Created(msg *domain.Message) { m.Called(msg) }
func (m *mockActivity) Lookup(id uuid.UUID) *domain.Message {
	msg, _ := m.Called(id).Get(0).(*domain.Message)
	return msg
}
func (m *mockActivity) Deleted(msg *domain.Message) { m.Called(msg) }

func TestMessageHandler_CreateMessage_NotifiesActivity(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC, act := new(mockMessageUseCase), new(mockActivity)
	channelID, userID := uuid.New(), uuid.New()
	msg := &domain.Message{ID: uuid.New(), ChannelID: channelID, UserID: &userID, Content: "hi", Kind: "user"}
	mockUC.On("CreateMessage", channelID, userID, "hi", (*uuid.UUID)(nil), []uuid.UUID(nil)).Return(msg, nil)
	act.On("Created", msg).Return()

	h := NewMessageHandler(mockUC, ws.NewHub(log), log, testSigner())
	h.SetActivity(act)

	body, _ := json.Marshal(CreateMessageRequest{Content: "hi"})
	req := httptest.NewRequest(http.MethodPost, "/x", bytes.NewReader(body))
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))
	rec := httptest.NewRecorder()
	h.CreateMessage(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rec.Code)
	}
	act.AssertCalled(t, "Created", msg)
}

func TestMessageHandler_DeleteMessage_SnapshotsBeforeDelete(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	channelID, userID, messageID := uuid.New(), uuid.New(), uuid.New()
	snapshot := &domain.Message{ID: messageID, ChannelID: channelID, Kind: "user"}

	for _, deleteErr := range []error{nil, domain.ErrForbidden} {
		mockUC, act := new(mockMessageUseCase), new(mockActivity)
		act.On("Lookup", messageID).Return(snapshot)
		act.On("Deleted", snapshot).Return()
		mockUC.On("DeleteMessage", channelID, messageID, userID).Return(deleteErr)

		h := NewMessageHandler(mockUC, ws.NewHub(log), log, testSigner())
		h.SetActivity(act)
		req := httptest.NewRequest(http.MethodDelete, "/x", nil)
		req.SetPathValue("channel_id", channelID.String())
		req.SetPathValue("message_id", messageID.String())
		req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))
		h.DeleteMessage(httptest.NewRecorder(), req)

		act.AssertCalled(t, "Lookup", messageID)
		if deleteErr == nil {
			act.AssertCalled(t, "Deleted", snapshot)
		} else {
			act.AssertNotCalled(t, "Deleted", mock.Anything)
		}
	}
}
```

Добавить в `server/internal/delivery/http/handler/guest_test.go` (рядом с `TestGuestHandler_PostMessage`; `mockActivity` объявлен в `message_test.go` того же пакета):
```go
func TestGuestHandler_PostMessage_NotifiesActivity(t *testing.T) {
	channelID := uuid.New()
	gc := admittedGuestContext(channelID)
	h, _, messages := newGuestHandler(t)
	act := new(mockActivity)
	h.SetActivity(act)
	msg := &domain.Message{ID: uuid.New(), ChannelID: channelID, Content: "привет", Kind: "user"}
	messages.On("CreateGuestMessage", gc, "привет").Return(msg, nil)
	act.On("Created", msg).Return()

	rec := httptest.NewRecorder()
	h.PostMessage(rec, guestRequest(http.MethodPost, "/x", `{"content":"привет"}`, gc))
	require.Equal(t, http.StatusCreated, rec.Code)
	act.AssertCalled(t, "Created", msg)
}
```

- [ ] **Step 5: Убедиться, что не собирается**

Run: `cd server && go vet ./internal/delivery/http/handler/`
Expected: FAIL — `h.SetActivity undefined`.

- [ ] **Step 6: Подключить нотификатор**

`server/internal/delivery/http/handler/message.go`:
- в `MessageHandler` добавить поле `activity ChannelActivityNotifier`;
- после `SetGuestChat`:
```go
// SetActivity installs the unread/read-receipt side effects (VYC-104).
// Called once from main.go.
func (h *MessageHandler) SetActivity(n ChannelActivityNotifier) { h.activity = n }
```
- в `CreateMessage` после блока `if h.guestChat != nil { … }` и перед `h.sendJSON(...)`:
```go
	if h.activity != nil {
		h.activity.Created(msg)
	}
```
- в `DeleteMessage` перед вызовом `h.messageUseCase.DeleteMessage(...)`:
```go
	// Снимок до удаления: после него ни времени, ни автора сообщения уже не
	// узнать, а клиентам нужно и то и другое, чтобы поправить счётчик.
	var snapshot *domain.Message
	if h.activity != nil {
		snapshot = h.activity.Lookup(messageID)
	}
```
  и после блока `if h.guestChat != nil { h.guestChat.MessageDeleted(...) }`:
```go
	if snapshot != nil {
		h.activity.Deleted(snapshot)
	}
```

`server/internal/delivery/http/handler/guest.go`:
- в `GuestHandler` поле `activity ChannelActivityNotifier`;
- после `SetGuestChat`: `func (h *GuestHandler) SetActivity(n ChannelActivityNotifier) { h.activity = n }` с комментарием `// SetActivity — см. MessageHandler.SetActivity.`;
- в `PostMessage` после блока `if h.guestChat != nil { … }`:
```go
	if h.activity != nil {
		h.activity.Created(msg)
	}
```

`server/cmd/api/main.go`, рядом с `messageHandler.SetGuestChat(guestEvents)`:
```go
	activityFanout := handler.NewChannelActivityFanout(readStateUseCase, hub, log)
	messageHandler.SetActivity(activityFanout)
	guestHandler.SetActivity(activityFanout)
```

- [ ] **Step 7: Тесты проходят**

Run: `cd server && go test ./internal/delivery/http/handler/ -v -run 'Activity|MessageHandler|GuestHandler_PostMessage'`
Expected: PASS (включая существующие тесты MessageHandler: без `SetActivity` поле nil, поведение прежнее).

- [ ] **Step 8: Гейты и коммит**

Run (из корня): `make build && make test && make vet && (cd server && gofmt -l ./internal ./cmd ./pkg)` — как в базовой линии.
```bash
git add server/internal/delivery/http/handler/channel_activity.go server/internal/delivery/http/handler/channel_activity_test.go \
  server/internal/delivery/http/handler/message.go server/internal/delivery/http/handler/message_test.go \
  server/internal/delivery/http/handler/guest.go server/internal/delivery/http/handler/guest_test.go \
  server/cmd/api/main.go
git commit -m "VYC-104 Событие channel_activity и курсор автора при отправке"
```

---

### Task 5: Клиент — сравнение курсоров, типы, API, `ws_open`

**Files:**
- Create: `client/src/utils/readCursor.ts`
- Test: `client/src/utils/__tests__/readCursor.test.ts`
- Modify: `client/src/types/index.ts` (после `MessageSearchResponse`)
- Modify: `client/src/services/api.ts` (после `deleteMessage`)
- Modify: `client/src/services/websocket.ts` (`onopen`, экспорт константы)

**Interfaces:**
- Produces:
  - `interface CursorPos { at: string; id: string | null }`
  - `toMicros(iso: string): number`, `comparePos(a: CursorPos, b: CursorPos): number`, `msgPos(m: { created_at: string; id: string }): CursorPos`, `isAfter(pos: CursorPos, cursor: CursorPos | null | undefined): boolean`
  - типы `ChannelUnread`, `MarkReadResponse`, `ReadReceipts`, `MessageReader`, `MessageReaders`, `ChannelActivityEvent`, `ChannelReadEvent`
  - `apiService.getUnread()`, `apiService.markChannelRead(channelId, messageId)`, `apiService.getReadReceipts(channelId)`, `apiService.getMessageReaders(channelId, messageId)`
  - `export const WS_OPEN_EVENT = 'ws_open'` в `services/websocket.ts`; слушатели `wsService.on(WS_OPEN_EVENT, …)` вызываются на каждом открытии сокета.

- [ ] **Step 1: Падающий тест**

`client/src/utils/__tests__/readCursor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toMicros, comparePos, isAfter, msgPos } from '../readCursor';

describe('readCursor', () => {
  it('toMicros keeps microseconds that Date.parse would drop', () => {
    expect(toMicros('2026-10-03T10:00:00.000001Z') - toMicros('2026-10-03T10:00:00Z')).toBe(1);
  });
  it('toMicros truncates nanoseconds to microseconds', () => {
    expect(toMicros('2026-10-03T10:00:00.123456789Z')).toBe(toMicros('2026-10-03T10:00:00.123456Z'));
  });
  it('toMicros honours offsets', () => {
    expect(toMicros('2026-10-03T13:00:00.5+03:00')).toBe(toMicros('2026-10-03T10:00:00.500000Z'));
  });
  it('comparePos orders by time, then by id', () => {
    const at = '2026-10-03T10:00:00Z';
    expect(comparePos({ at, id: 'a' }, { at, id: 'b' })).toBeLessThan(0);
    expect(comparePos({ at, id: 'b' }, { at, id: 'b' })).toBe(0);
    expect(comparePos({ at: '2026-10-03T10:00:01Z', id: 'a' }, { at, id: 'z' })).toBeGreaterThan(0);
  });
  it('a cursor without id covers its whole instant', () => {
    const at = '2026-10-03T10:00:00Z';
    expect(comparePos({ at, id: 'ffff' }, { at, id: null })).toBeLessThan(0);
    expect(comparePos({ at, id: null }, { at, id: 'ffff' })).toBeGreaterThan(0);
  });
  it('isAfter: no cursor means nothing is unread', () => {
    const m = msgPos({ id: 'a', created_at: '2026-10-03T10:00:00Z' });
    expect(isAfter(m, undefined)).toBe(false);
    expect(isAfter(m, { at: '2026-10-03T09:00:00Z', id: null })).toBe(true);
    expect(isAfter(m, { at: '2026-10-03T10:00:00Z', id: 'a' })).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd client && npx vitest run src/utils/__tests__/readCursor.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`client/src/utils/readCursor.ts`:
```ts
/**
 * VYC-104: позиция в ленте канала — пара (created_at, id), ровно как на сервере.
 * Курсор с id === null (сид миграции, фолбэк на момент вступления) покрывает
 * своё время целиком.
 */
export interface CursorPos {
  at: string;
  id: string | null;
}

const ISO_RE = /^(.*?T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * ISO-8601 → микросекунды эпохи. Date.parse режет до миллисекунд, а сервер
 * хранит микросекунды: без них два сообщения одной миллисекунды и курсор
 * между ними были бы неразличимы. 1.7e15 мкс — далеко от 2^53.
 */
export function toMicros(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) return Date.parse(iso) * 1000;
  const whole = Date.parse(m[1] + m[3]);
  const frac = (m[2] ?? '').padEnd(6, '0').slice(0, 6);
  return whole * 1000 + Number(frac);
}

/** <0 — a раньше b, 0 — та же позиция, >0 — позже. uuid сравниваются строкой:
 *  для строчных hex с дефисами на одних местах это тот же порядок, что у
 *  Postgres. */
export function comparePos(a: CursorPos, b: CursorPos): number {
  const d = toMicros(a.at) - toMicros(b.at);
  if (d !== 0) return d;
  if (a.id === b.id) return 0;
  if (a.id === null) return 1;
  if (b.id === null) return -1;
  return a.id < b.id ? -1 : 1;
}

export function msgPos(m: { created_at: string; id: string }): CursorPos {
  return { at: m.created_at, id: m.id };
}

/** Позиция за курсором, то есть не прочитана. Нет курсора — ничего не считаем. */
export function isAfter(pos: CursorPos, cursor: CursorPos | null | undefined): boolean {
  return !!cursor && comparePos(pos, cursor) > 0;
}
```

- [ ] **Step 4: Тест проходит**

Run: `cd client && npx vitest run src/utils/__tests__/readCursor.test.ts` → PASS.

- [ ] **Step 5: Типы, API, `ws_open`**

`client/src/types/index.ts`, после `MessageSearchResponse`:
```ts
/** VYC-104: счётчик и курсор по одному каналу (GET /api/v1/unread). */
export interface ChannelUnread {
  server_id: string;
  channel_id: string;
  count: number;
  last_read_at: string;
  last_read_message_id: string | null;
}

export interface MarkReadResponse {
  count: number;
  last_read_at: string;
  last_read_message_id: string | null;
}

/** Самый дальний курсор других участников канала — для галочек. */
export interface ReadReceipts {
  others_max_read_at: string | null;
  others_max_read_message_id: string | null;
}

export interface MessageReader {
  user_id: string;
  username: string;
  avatar_url?: string;
}

export interface MessageReaders {
  read: MessageReader[];
  unread: MessageReader[];
}

/** WS channel_activity: сообщение появилось/исчезло в канале одного из моих серверов. */
export interface ChannelActivityEvent {
  op: 'create' | 'delete';
  server_id: string;
  channel_id: string;
  message_id: string;
  created_at: string;
  author_user_id: string | null;
}

/** WS channel_read: кто-то другой дочитал канал до этой позиции. */
export interface ChannelReadEvent {
  channel_id: string;
  read_at: string;
  message_id: string | null;
}
```

`client/src/services/api.ts` — в импорт типов из `@/types` добавить `ChannelUnread, MarkReadResponse, ReadReceipts, MessageReaders`; после метода `deleteMessage`:
```ts
  // Непрочитанное и квитанции (VYC-104).
  async getUnread() {
    return this.request<ChannelUnread[]>('/api/v1/unread');
  }

  async markChannelRead(channelId: string, messageId: string) {
    return this.request<MarkReadResponse>(`/api/v1/channels/${channelId}/read`, {
      method: 'PUT',
      body: JSON.stringify({ message_id: messageId }),
    });
  }

  async getReadReceipts(channelId: string) {
    return this.request<ReadReceipts>(`/api/v1/channels/${channelId}/read-receipts`);
  }

  async getMessageReaders(channelId: string, messageId: string) {
    return this.request<MessageReaders>(`/api/v1/channels/${channelId}/readers/${messageId}`);
  }
```

`client/src/services/websocket.ts`:
- над классом:
```ts
/**
 * Локальное событие: сокет (пере)открылся. Сервер его не шлёт — его
 * испускает сам сервис, чтобы подписчики, которым после реконнекта нужно
 * заново синхронизироваться (VYC-104: счётчики непрочитанного), не лезли
 * во внутренности соединения.
 */
export const WS_OPEN_EVENT = 'ws_open';
```
- в `this.ws.onopen = () => { … }` сразу после `this.resendJoinChannel();`:
```ts
        this.listeners.get(WS_OPEN_EVENT)?.forEach((listener) => listener(null));
```

- [ ] **Step 6: Гейты и коммит**

Run: `cd client && npx tsc --noEmit && npx vitest run src/utils/__tests__/readCursor.test.ts`
Expected: tsc — 0 байт; тест PASS.
```bash
git add client/src/utils/readCursor.ts client/src/utils/__tests__/readCursor.test.ts \
  client/src/types/index.ts client/src/services/api.ts client/src/services/websocket.ts
git commit -m "VYC-104 Клиент: сравнение курсоров, типы и API непрочитанного"
```

---

### Task 6: `unreadStore` на серверном курсоре + мост WS

**Files:**
- Modify (переписать): `client/src/stores/unreadStore.ts`
- Test (переписать): `client/src/stores/__tests__/unreadStore.test.ts`
- Create: `client/src/stores/unreadBridge.ts`
- Modify: `client/src/pages/app/useAppController.ts` (рядом с `initFriendBridge`)
- Modify: `client/src/components/ChatArea.tsx:192` (вызов `firstUnreadId`)

**Interfaces:**
- Consumes: Task 5 (`CursorPos`, `comparePos`, `isAfter`, `msgPos`, типы, методы `apiService`, `WS_OPEN_EVENT`).
- Produces (из `@/stores/unreadStore`):
  - `UNREAD_CAP = 100`, `interface ChannelUnreadState { serverId: string; count: number; cursor: CursorPos }`
  - `useUnreadStore` с полями `channels: Record<string, ChannelUnreadState>`, `othersRead: Record<string, CursorPos>` и действиями `hydrate(): Promise<void>`, `applyActivity(ev: ChannelActivityEvent, selfId: string | undefined): void`, `applyChannelRead(ev: ChannelReadEvent): void`, `loadReceipts(channelId: string): Promise<void>`, `markRead(channelId: string, msg: { id: string; created_at: string }): void`, `forgetChannel(channelId: string): void`, `forgetServer(serverId: string): void`, `reset(): void`
  - `selectChannelUnread(channelId) => (s) => number`, `selectServerUnread(serverId) => (s) => number`, `formatUnread(n: number): string`
  - `firstUnreadId(cursor: CursorPos | undefined, messages: Message[]): string | null`
  - `MARK_READ_WINDOW_MS = 1000`
- Produces (из `@/stores/unreadBridge`): `initUnreadBridge(): () => void`

- [ ] **Step 1: Переписать тест (падающий)**

`client/src/stores/__tests__/unreadStore.test.ts` — заменить содержимое целиком:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/services/api', () => ({
  apiService: { getUnread: vi.fn(), markChannelRead: vi.fn(), getReadReceipts: vi.fn() },
}));

import { apiService } from '@/services/api';
import {
  useUnreadStore, firstUnreadId, selectServerUnread, selectChannelUnread, formatUnread, UNREAD_CAP, MARK_READ_WINDOW_MS,
} from '../unreadStore';
import type { ChannelActivityEvent, Message } from '@/types';

const api = vi.mocked(apiService);
const T = (s: number) => `2026-10-03T10:00:${String(s).padStart(2, '0')}Z`;
const m = (id: string, ts: string, kind: Message['kind'] = 'user'): Message => ({
  id, channel_id: 'c1', user_id: 'u2', content: 'x', kind, created_at: ts, updated_at: ts,
});
const act = (over: Partial<ChannelActivityEvent> = {}): ChannelActivityEvent => ({
  op: 'create', server_id: 's1', channel_id: 'c1', message_id: 'mX', created_at: T(30), author_user_id: 'u2', ...over,
});

beforeEach(() => {
  useUnreadStore.getState().reset();
  useUnreadStore.setState({
    channels: { c1: { serverId: 's1', count: 2, cursor: { at: T(10), id: 'm10' } }, c2: { serverId: 's1', count: 3, cursor: { at: T(10), id: null } } },
  });
  api.getUnread.mockReset();
  api.markChannelRead.mockReset();
  api.getReadReceipts.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('unreadStore', () => {
  it('hydrate replaces channels from the server', async () => {
    api.getUnread.mockResolvedValue([{ server_id: 's9', channel_id: 'c9', count: 4, last_read_at: T(1), last_read_message_id: null }]);
    await useUnreadStore.getState().hydrate();
    expect(useUnreadStore.getState().channels).toEqual({ c9: { serverId: 's9', count: 4, cursor: { at: T(1), id: null } } });
  });

  it('hydrate keeps a local cursor that is ahead of the snapshot', async () => {
    api.getUnread.mockResolvedValue([{ server_id: 's1', channel_id: 'c1', count: 7, last_read_at: T(5), last_read_message_id: 'm5' }]);
    await useUnreadStore.getState().hydrate();
    expect(useUnreadStore.getState().channels.c1).toEqual({ serverId: 's1', count: 2, cursor: { at: T(10), id: 'm10' } });
  });

  it('applyActivity create: +1 only for others, only after the cursor', () => {
    const s = useUnreadStore.getState();
    s.applyActivity(act(), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(3);
    s.applyActivity(act({ author_user_id: 'me' }), 'me');
    s.applyActivity(act({ created_at: T(5) }), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(3);
  });

  it('applyActivity counts guest messages (author null)', () => {
    useUnreadStore.getState().applyActivity(act({ author_user_id: null }), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(3);
  });

  it('applyActivity delete: -1, never below zero', () => {
    const s = useUnreadStore.getState();
    s.applyActivity(act({ op: 'delete' }), 'me');
    s.applyActivity(act({ op: 'delete' }), 'me');
    s.applyActivity(act({ op: 'delete' }), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(0);
  });

  // Review Focus №5.
  it('delete at cap keeps count', () => {
    useUnreadStore.setState((st) => ({ channels: { ...st.channels, c1: { ...st.channels.c1, count: UNREAD_CAP } } }));
    useUnreadStore.getState().applyActivity(act({ op: 'delete' }), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(UNREAD_CAP);
  });

  it('applyActivity on an unknown channel re-hydrates', async () => {
    api.getUnread.mockResolvedValue([]);
    useUnreadStore.getState().applyActivity(act({ channel_id: 'new' }), 'me');
    await vi.waitFor(() => expect(api.getUnread).toHaveBeenCalledTimes(1));
  });

  it('markRead moves the cursor optimistically and sends on the leading edge', () => {
    api.markChannelRead.mockReturnValue(new Promise(() => {}));
    useUnreadStore.getState().markRead('c1', { id: 'm20', created_at: T(20) });
    expect(useUnreadStore.getState().channels.c1.cursor).toEqual({ at: T(20), id: 'm20' });
    expect(api.markChannelRead).toHaveBeenCalledWith('c1', 'm20');
  });

  it('markRead never moves backwards and sends nothing', () => {
    useUnreadStore.getState().markRead('c1', { id: 'm5', created_at: T(5) });
    expect(useUnreadStore.getState().channels.c1.cursor).toEqual({ at: T(10), id: 'm10' });
    expect(api.markChannelRead).not.toHaveBeenCalled();
  });

  it('markRead coalesces a burst into leading + trailing requests', async () => {
    vi.useFakeTimers();
    api.markChannelRead.mockImplementation(async (_c, id) => ({ count: 0, last_read_at: T(Number(id.slice(1))), last_read_message_id: id }));
    const s = useUnreadStore.getState();
    s.markRead('c1', { id: 'm20', created_at: T(20) });
    s.markRead('c1', { id: 'm21', created_at: T(21) });
    s.markRead('c1', { id: 'm22', created_at: T(22) });
    expect(api.markChannelRead).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MARK_READ_WINDOW_MS);
    expect(api.markChannelRead).toHaveBeenCalledTimes(2);
    expect(api.markChannelRead).toHaveBeenLastCalledWith('c1', 'm22');
  });

  it('mark response sets the server count', async () => {
    api.markChannelRead.mockResolvedValue({ count: 1, last_read_at: T(20), last_read_message_id: 'm20' });
    useUnreadStore.getState().markRead('c1', { id: 'm20', created_at: T(20) });
    await vi.waitFor(() => expect(useUnreadStore.getState().channels.c1.count).toBe(1));
  });

  // Review Focus №3.
  it('stale mark response does not override a cursor that is ahead', async () => {
    let resolve!: (v: { count: number; last_read_at: string; last_read_message_id: string }) => void;
    api.markChannelRead.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    useUnreadStore.getState().markRead('c1', { id: 'm20', created_at: T(20) });
    useUnreadStore.setState((st) => ({ channels: { ...st.channels, c1: { ...st.channels.c1, cursor: { at: T(25), id: 'm25' } } } }));
    resolve({ count: 9, last_read_at: T(20), last_read_message_id: 'm20' });
    await Promise.resolve();
    await Promise.resolve();
    expect(useUnreadStore.getState().channels.c1).toEqual({ serverId: 's1', count: 2, cursor: { at: T(25), id: 'm25' } });
  });

  it('applyChannelRead keeps only the maximum', () => {
    const s = useUnreadStore.getState();
    s.applyChannelRead({ channel_id: 'c1', read_at: T(20), message_id: 'm20' });
    s.applyChannelRead({ channel_id: 'c1', read_at: T(15), message_id: 'm15' });
    expect(useUnreadStore.getState().othersRead.c1).toEqual({ at: T(20), id: 'm20' });
  });

  it('loadReceipts applies the others max, ignores null', async () => {
    api.getReadReceipts.mockResolvedValueOnce({ others_max_read_at: null, others_max_read_message_id: null });
    await useUnreadStore.getState().loadReceipts('c1');
    expect(useUnreadStore.getState().othersRead.c1).toBeUndefined();
    api.getReadReceipts.mockResolvedValueOnce({ others_max_read_at: T(12), others_max_read_message_id: 'm12' });
    await useUnreadStore.getState().loadReceipts('c1');
    expect(useUnreadStore.getState().othersRead.c1).toEqual({ at: T(12), id: 'm12' });
  });

  it('selectors and formatting', () => {
    const st = useUnreadStore.getState();
    expect(selectServerUnread('s1')(st)).toBe(5);
    expect(selectServerUnread('nope')(st)).toBe(0);
    expect(selectChannelUnread('c2')(st)).toBe(3);
    expect(formatUnread(99)).toBe('99');
    expect(formatUnread(100)).toBe('99+');
  });

  it('forgetChannel / forgetServer', () => {
    useUnreadStore.getState().forgetChannel('c1');
    expect(useUnreadStore.getState().channels.c1).toBeUndefined();
    useUnreadStore.getState().forgetServer('s1');
    expect(useUnreadStore.getState().channels).toEqual({});
  });
});

describe('firstUnreadId', () => {
  it('no cursor → null (first visit shows no divider)', () => {
    expect(firstUnreadId(undefined, [m('a', T(1))])).toBeNull();
  });
  it('returns the first message after the cursor', () => {
    expect(firstUnreadId({ at: T(1), id: 'a' }, [m('a', T(1)), m('b', T(2))])).toBe('b');
  });
  it('everything read → null', () => {
    expect(firstUnreadId({ at: T(2), id: 'b' }, [m('a', T(1)), m('b', T(2))])).toBeNull();
  });
  it('empty list → null', () => {
    expect(firstUnreadId({ at: T(1), id: 'a' }, [])).toBeNull();
  });
  it('skips a call row, returns the next real message', () => {
    expect(firstUnreadId({ at: T(1), id: 'a' }, [m('a', T(1)), m('call', T(2), 'call'), m('c', T(3))])).toBe('c');
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd client && npx vitest run src/stores/__tests__/unreadStore.test.ts`
Expected: FAIL — нет экспортов `selectServerUnread` и др.

- [ ] **Step 3: Переписать стор**

`client/src/stores/unreadStore.ts` — заменить содержимое целиком:
```ts
import { create } from 'zustand';
import { apiService } from '@/services/api';
import { logger } from '@/utils/logger';
import { comparePos, isAfter, msgPos, type CursorPos } from '@/utils/readCursor';
import type { ChannelActivityEvent, ChannelReadEvent, Message } from '@/types';

/** Сервер считает непрочитанные до 100 (domain.UnreadCountCap). */
export const UNREAD_CAP = 100;
/** Окно троттлинга PUT /read на канал: ведущий край сразу, хвост — в конце окна. */
export const MARK_READ_WINDOW_MS = 1000;
const REHYDRATE_MIN_GAP_MS = 2000;

export interface ChannelUnreadState {
  serverId: string;
  count: number;
  /** Мой курсор прочтения: только вперёд. */
  cursor: CursorPos;
}

interface UnreadState {
  channels: Record<string, ChannelUnreadState>;
  /** Самый дальний курсор ДРУГИХ участников — для галочек моих сообщений. */
  othersRead: Record<string, CursorPos>;
  hydrate(): Promise<void>;
  applyActivity(ev: ChannelActivityEvent, selfId: string | undefined): void;
  applyChannelRead(ev: ChannelReadEvent): void;
  loadReceipts(channelId: string): Promise<void>;
  markRead(channelId: string, msg: { id: string; created_at: string }): void;
  forgetChannel(channelId: string): void;
  forgetServer(serverId: string): void;
  reset(): void;
}

// Троттлинг PUT /read по каналам. Модульный, а не в сторе: таймеры — не
// состояние для рендера.
const windows = new Map<string, { trailing: string | null; timer: ReturnType<typeof setTimeout> | undefined }>();
let lastRehydrate = 0;

function requestRehydrate() {
  const now = Date.now();
  if (now - lastRehydrate < REHYDRATE_MIN_GAP_MS) return;
  lastRehydrate = now;
  void useUnreadStore.getState().hydrate();
}

async function sendMark(channelId: string, messageId: string) {
  try {
    const res = await apiService.markChannelRead(channelId, messageId);
    const serverCursor: CursorPos = { at: res.last_read_at, id: res.last_read_message_id };
    useUnreadStore.setState((s) => {
      const st = s.channels[channelId];
      if (!st) return s;
      // Ответы приходят не по порядку, а оптимистичный курсор может уже уйти
      // дальше: count из ответа про более ранний курсор устарел.
      if (comparePos(serverCursor, st.cursor) < 0) return s;
      return { channels: { ...s.channels, [channelId]: { ...st, cursor: serverCursor, count: res.count } } };
    });
  } catch (err) {
    logger.error('failed to mark channel read', err, { module: 'unread' });
  }
}

function scheduleMark(channelId: string, messageId: string) {
  const open = windows.get(channelId);
  if (open) {
    open.trailing = messageId;
    return;
  }
  const win = { trailing: null as string | null, timer: undefined as ReturnType<typeof setTimeout> | undefined };
  windows.set(channelId, win);
  void sendMark(channelId, messageId);
  win.timer = setTimeout(() => {
    windows.delete(channelId);
    if (win.trailing) void sendMark(channelId, win.trailing);
  }, MARK_READ_WINDOW_MS);
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  channels: {},
  othersRead: {},

  hydrate: async () => {
    try {
      const list = await apiService.getUnread();
      const prev = get().channels;
      const channels: Record<string, ChannelUnreadState> = {};
      for (const u of list) {
        const cursor: CursorPos = { at: u.last_read_at, id: u.last_read_message_id };
        const local = prev[u.channel_id];
        // Снимок мог уйти до того, как долетел наш PUT: локальный курсор
        // впереди — он и его счётчик свежее.
        channels[u.channel_id] = local && comparePos(local.cursor, cursor) > 0
          ? local
          : { serverId: u.server_id, count: u.count, cursor };
      }
      set({ channels });
    } catch (err) {
      logger.error('failed to load unread counters', err, { module: 'unread' });
    }
  },

  applyActivity: (ev, selfId) => {
    const st = get().channels[ev.channel_id];
    if (!st) {
      // Канал, которого не было в снимке (новый канал, только что вступили
      // в сервер): ни курсора, ни сервера не знаем — берём свежий снимок.
      requestRehydrate();
      return;
    }
    if (ev.author_user_id !== null && ev.author_user_id === selfId) return;
    if (!isAfter({ at: ev.created_at, id: ev.message_id }, st.cursor)) return;
    // На потолке реальное число неизвестно (сервер дальше 100 не считал):
    // минус один мог бы показать 99 вместо «99+».
    if (ev.op === 'delete' && st.count >= UNREAD_CAP) return;
    const count = Math.max(0, st.count + (ev.op === 'create' ? 1 : -1));
    set((s) => ({ channels: { ...s.channels, [ev.channel_id]: { ...st, count } } }));
  },

  applyChannelRead: (ev) => set((s) => {
    const pos: CursorPos = { at: ev.read_at, id: ev.message_id };
    const cur = s.othersRead[ev.channel_id];
    if (cur && comparePos(pos, cur) <= 0) return s;
    return { othersRead: { ...s.othersRead, [ev.channel_id]: pos } };
  }),

  loadReceipts: async (channelId) => {
    try {
      const r = await apiService.getReadReceipts(channelId);
      if (!r.others_max_read_at) return;
      get().applyChannelRead({ channel_id: channelId, read_at: r.others_max_read_at, message_id: r.others_max_read_message_id });
    } catch (err) {
      logger.error('failed to load read receipts', err, { module: 'unread' });
    }
  },

  markRead: (channelId, msg) => {
    const pos = msgPos(msg);
    const st = get().channels[channelId];
    if (st && comparePos(pos, st.cursor) <= 0) return;
    if (st) set((s) => ({ channels: { ...s.channels, [channelId]: { ...st, cursor: pos } } }));
    scheduleMark(channelId, msg.id);
  },

  forgetChannel: (channelId) => set((s) => {
    const { [channelId]: _gone, ...channels } = s.channels;
    const { [channelId]: _read, ...othersRead } = s.othersRead;
    return { channels, othersRead };
  }),

  forgetServer: (serverId) => set((s) => ({
    channels: Object.fromEntries(Object.entries(s.channels).filter(([, c]) => c.serverId !== serverId)),
  })),

  reset: () => {
    // Хвостовые таймеры прошлой сессии (или прошлого теста) не должны
    // отправить PUT и стереть окно, открытое уже после сброса.
    for (const w of windows.values()) clearTimeout(w.timer);
    windows.clear();
    lastRehydrate = 0;
    set({ channels: {}, othersRead: {} });
  },
}));

export const selectChannelUnread = (channelId: string) => (s: UnreadState): number => s.channels[channelId]?.count ?? 0;

export const selectServerUnread = (serverId: string) => (s: UnreadState): number => {
  let n = 0;
  for (const c of Object.values(s.channels)) if (c.serverId === serverId) n += c.count;
  return n;
};

export function formatUnread(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/**
 * Якорь разделителя «новые сообщения»: первое сообщение строго после курсора.
 * Нет курсора (стор ещё не загрузился) — разделителя нет.
 */
export function firstUnreadId(cursor: CursorPos | undefined, messages: Message[]): string | null {
  if (!cursor || messages.length === 0) return null;
  const found = messages.find((m) => m.kind !== 'call' && isAfter(msgPos(m), cursor));
  return found ? found.id : null;
}
```
Если линтер TS ругается на неиспользуемые `_gone`/`_read` — переписать через копию объекта и `delete`.

- [ ] **Step 4: Мост**

`client/src/stores/unreadBridge.ts`:
```ts
import { wsService, WS_OPEN_EVENT } from '@/services/websocket';
import { useAuthStore } from '@/stores/authStore';
import { useUnreadStore } from '@/stores/unreadStore';
import type { ChannelActivityEvent, ChannelReadEvent } from '@/types';

const LEGACY_KEY = 'vycord.lastRead';

/**
 * VYC-104: счётчики непрочитанного живут всю сессию, а не пока открыт какой-то
 * экран — тот же приём, что initFriendBridge. Полный снимок — при запуске и
 * после каждого (ре)коннекта: дельты WS могли потеряться, курсоры серверные.
 */
export function initUnreadBridge(): () => void {
  // Отметка прочтения раньше жила в localStorage — источник теперь сервер.
  try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* приватный режим */ }

  const store = () => useUnreadStore.getState();
  void store().hydrate();
  const offs = [
    wsService.on(WS_OPEN_EVENT, () => { void store().hydrate(); }),
    wsService.on('channel_activity', (p) => store().applyActivity(p as ChannelActivityEvent, useAuthStore.getState().user?.id)),
    wsService.on('channel_read', (p) => store().applyChannelRead(p as ChannelReadEvent)),
    wsService.on('channel_delete', (p) => store().forgetChannel((p as { id: string }).id)),
    wsService.on('server_delete', (p) => store().forgetServer((p as { id: string }).id)),
  ];
  return () => {
    offs.forEach((off) => off());
    store().reset();
  };
}
```

`client/src/pages/app/useAppController.ts` — импорт `import { initUnreadBridge } from '@/stores/unreadBridge';` и рядом с `useEffect(() => initFriendBridge(), []);`:
```ts
  // Непрочитанное (VYC-104) — на всю сессию, как друзья и звонки 1:1.
  useEffect(() => initUnreadBridge(), []);
```

`client/src/components/ChatArea.tsx` — в эффекте якоря (строка ~192) заменить
`firstUnreadId(useUnreadStore.getState().lastRead[channel.id], messages)` на
`firstUnreadId(useUnreadStore.getState().channels[channel.id]?.cursor, messages)`.
Старый `IntersectionObserver` с `markRead(channel.id, last.id, last.created_at)` (строки ~243–256) этой задачей **временно** переводится на новую сигнатуру: `useUnreadStore.getState().markRead(channel.id, last)` — его целиком заменит Task 7.

- [ ] **Step 5: Тесты проходят**

Run: `cd client && npx vitest run src/stores/__tests__/unreadStore.test.ts && npx tsc --noEmit`
Expected: PASS; tsc — 0 байт.

- [ ] **Step 6: Полный прогон и коммит**

Run: `cd client && npm test 2>&1 | tail -15`
Expected: ровно 3 падения, все в `api.network-retry.test.ts`.
```bash
git add client/src/stores/unreadStore.ts client/src/stores/__tests__/unreadStore.test.ts \
  client/src/stores/unreadBridge.ts client/src/pages/app/useAppController.ts client/src/components/ChatArea.tsx
git commit -m "VYC-104 unreadStore на серверных курсорах, мост WS"
```

---

### Task 7: `useReadTracker` — «видно + фокус»

**Files:**
- Create: `client/src/hooks/useReadTracker.ts`
- Test: `client/src/hooks/__tests__/useReadTracker.test.tsx`
- Modify: `client/src/components/ChatArea.tsx` (удалить эффект «Viewport mark-read» ~строки 225–256, подключить хук)

**Interfaces:**
- Consumes: `useUnreadStore().markRead(channelId, msg)` (Task 6), `comparePos`, `msgPos` (Task 5), `useMessageStore` / `ChatMessage` (существующие).
- Produces: `useReadTracker(channelId: string | undefined, containerRef: RefObject<HTMLElement | null>, enabled: boolean): void`, `isAttentive(): boolean`.

- [ ] **Step 1: Падающий тест**

`client/src/hooks/__tests__/useReadTracker.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { useReadTracker } from '../useReadTracker';
import { useMessageStore, type ChatMessage } from '@/stores/messageStore';
import { useUnreadStore } from '@/stores/unreadStore';

vi.mock('@/services/api', () => ({ apiService: {} }));

type Entry = Pick<IntersectionObserverEntry, 'target' | 'isIntersecting' | 'intersectionRatio' | 'boundingClientRect' | 'rootBounds'>;
let ioCallback: ((entries: Entry[]) => void) | null = null;
class FakeIO {
  constructor(cb: (entries: Entry[]) => void) { ioCallback = cb; }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

const msg = (id: string, at: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, channel_id: 'c1', user_id: 'u2', content: 'x', kind: 'user', created_at: at, updated_at: at, ...extra,
});

function Probe({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useReadTracker('c1', ref, enabled);
  const messages = useMessageStore((s) => s.messages);
  return <div ref={ref}>{messages.map((m) => <div key={m.id} data-message-id={m.id} />)}</div>;
}

const entry = (id: string, visible: boolean): Entry => ({
  target: document.querySelector(`[data-message-id="${id}"]`)!,
  isIntersecting: visible,
  intersectionRatio: visible ? 1 : 0,
  boundingClientRect: { bottom: 100 } as DOMRectReadOnly,
  rootBounds: { bottom: 500 } as DOMRectReadOnly,
});
const see = (...ids: string[]) => act(() => { ioCallback!(ids.map((id) => entry(id, true))); });
const hide = (...ids: string[]) => act(() => { ioCallback!(ids.map((id) => entry(id, false))); });

let focused = true;
const markRead = vi.fn();

beforeEach(() => {
  ioCallback = null;
  focused = true;
  markRead.mockReset();
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  useUnreadStore.setState({ markRead });
  useMessageStore.setState({
    messages: [
      msg('m1', '2026-10-03T10:00:00.000001Z'),
      msg('m2', '2026-10-03T10:00:01Z'),
      msg('call', '2026-10-03T10:00:02Z', { kind: 'call' }),
      msg('p', '2026-10-03T10:00:03Z', { deliveryState: 'sending' }),
    ],
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('useReadTracker', () => {
  it('marks the latest visible message', () => {
    render(<Probe />);
    see('m1', 'm2');
    expect(markRead).toHaveBeenLastCalledWith('c1', expect.objectContaining({ id: 'm2' }));
  });

  it('skips call rows and pending sends', () => {
    render(<Probe />);
    see('call', 'p');
    expect(markRead).not.toHaveBeenCalled();
    see('m1');
    expect(markRead).toHaveBeenLastCalledWith('c1', expect.objectContaining({ id: 'm1' }));
  });

  // Review Focus №4.
  it('no focus: nothing is read until the window gets focus', () => {
    focused = false;
    render(<Probe />);
    see('m2');
    expect(markRead).not.toHaveBeenCalled();
    focused = true;
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(markRead).toHaveBeenLastCalledWith('c1', expect.objectContaining({ id: 'm2' }));
  });

  it('left before focus: a row that scrolled away is not read', () => {
    focused = false;
    render(<Probe />);
    see('m2');
    hide('m2');
    focused = true;
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(markRead).not.toHaveBeenCalled();
  });

  it('hidden tab counts as not attentive', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    render(<Probe />);
    see('m2');
    expect(markRead).not.toHaveBeenCalled();
  });

  it('disabled: does not observe at all', () => {
    render(<Probe enabled={false} />);
    expect(ioCallback).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd client && npx vitest run src/hooks/__tests__/useReadTracker.test.tsx`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать хук**

`client/src/hooks/useReadTracker.ts`:
```ts
import { useEffect, type RefObject } from 'react';
import { useMessageStore, type ChatMessage } from '@/stores/messageStore';
import { useUnreadStore } from '@/stores/unreadStore';
import { comparePos, msgPos } from '@/utils/readCursor';

/** «Видно на экране» значит «прочитано» только при окне в фокусе и видимой вкладке. */
export function isAttentive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * VYC-104: двигает курсор прочтения канала до самого позднего сообщения,
 * чья строка в ленте видна, пока окно в фокусе. Видимое без фокуса копится
 * и фиксируется на focus/visibilitychange — если строка всё ещё на экране.
 *
 * Строки ищутся по data-message-id (его ставит MessageRow). Эффект
 * пересоздаётся на каждое изменение ленты: новые строки нужно начать
 * наблюдать, а начальное уведомление IntersectionObserver заново соберёт
 * множество видимых.
 */
export function useReadTracker(
  channelId: string | undefined,
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  const messages = useMessageStore((s) => s.messages);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !channelId || !enabled) return;

    const byId = new Map<string, ChatMessage>();
    for (const m of messages) byId.set(m.id, m);
    const visible = new Set<string>();

    const commit = () => {
      if (!isAttentive()) return;
      let best: ChatMessage | null = null;
      for (const id of visible) {
        const m = byId.get(id);
        // Строка из ленты прошлого канала (переключение ещё не доехало),
        // плашка звонка, неотправленное — курсор на них не ставим.
        if (!m || m.channel_id !== channelId || m.kind === 'call' || m.deliveryState) continue;
        if (!best || comparePos(msgPos(m), msgPos(best)) > 0) best = m;
      }
      if (best) useUnreadStore.getState().markRead(channelId, best);
    };

    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.messageId;
        if (!id) continue;
        // Видна хотя бы половина строки или её нижний край — высокое
        // сообщение не засчитывается по одной верхней кромке.
        const rootBottom = e.rootBounds?.bottom ?? Number.POSITIVE_INFINITY;
        const seen = e.isIntersecting && (e.intersectionRatio >= 0.5 || e.boundingClientRect.bottom <= rootBottom);
        if (seen) visible.add(id);
        else visible.delete(id);
      }
      commit();
    }, { root, threshold: [0, 0.5, 1] });

    root.querySelectorAll<HTMLElement>('[data-message-id]').forEach((el) => observer.observe(el));
    window.addEventListener('focus', commit);
    document.addEventListener('visibilitychange', commit);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', commit);
      document.removeEventListener('visibilitychange', commit);
    };
  }, [channelId, containerRef, enabled, messages]);
}
```

- [ ] **Step 4: Тест проходит**

Run: `cd client && npx vitest run src/hooks/__tests__/useReadTracker.test.tsx` → PASS.

- [ ] **Step 5: Подключить в `ChatArea`**

`client/src/components/ChatArea.tsx`:
- удалить эффект с комментарием «Viewport mark-read» (весь блок `useEffect(() => { const sentinel = messagesEndRef.current; … }, [channel?.id, messages]);` вместе с его комментарием). `messagesEndRef` и `<div ref={messagesEndRef} />` **оставить** — на них держится прокрутка.
- импорт `import { useReadTracker } from '@/hooks/useReadTracker';` и на месте удалённого блока:
```tsx
  // Прочтение (VYC-104): строка во вьюпорте + окно в фокусе двигают серверный
  // курсор канала. В режиме истории (jumpToMessage) и в скрытом под другим
  // экраном чате — нет: пользователь там не читает ленту подряд.
  useReadTracker(channel?.id, chatMessagesRef, active && !historyMode);
```
- если `useUnreadStore` в `ChatArea` теперь используется только в эффекте якоря — импорт остаётся (`firstUnreadId` + `useUnreadStore`).

- [ ] **Step 6: Регрессия ленты**

Run: `cd client && npx vitest run src/components/__tests__/ChatArea && npx tsc --noEmit`
Expected: PASS (снапшоты ленты не меняются — разметка та же); tsc 0 байт. Если упал тест, полагавшийся на старый маячок-наблюдатель, — переписать его ожидания на `useReadTracker` (наблюдаются строки `[data-message-id]`), не возвращая маячок.

- [ ] **Step 7: Коммит**

```bash
git add client/src/hooks/useReadTracker.ts client/src/hooks/__tests__/useReadTracker.test.tsx client/src/components/ChatArea.tsx
git commit -m "VYC-104 Трекер прочтения: видно на экране + окно в фокусе"
```

---

### Task 8: Бейджи — рейл серверов, сайдбар каналов, мобильные списки

**Files:**
- Modify: `client/src/components/ServerList.tsx`
- Modify: `client/src/components/ChannelSidebar.tsx`, `client/src/components/ChannelSidebar.css`
- Modify: `client/src/mobile/activity.ts`
- Modify: `client/src/i18n/locales/ru.ts`, `client/src/i18n/locales/en.ts` (namespace `sidebar`)
- Test: `client/src/components/__tests__/ServerList.unread.test.tsx`, `client/src/components/__tests__/ChannelSidebar.unread.test.tsx`, `client/src/mobile/__tests__/activity.test.tsx`

**Interfaces:**
- Consumes: `useUnreadStore`, `selectServerUnread`, `selectChannelUnread`, `formatUnread` (Task 6).
- Produces: i18n-ключ `sidebar.unreadCount` (`{{count}}`); классы `channel-unread-pill`, `has-unread`.

- [ ] **Step 1: i18n**

`client/src/i18n/locales/ru.ts`, в `sidebar`:
```ts
    unreadCount: 'Непрочитанных: {{count}}',
```
`client/src/i18n/locales/en.ts`, в `sidebar`:
```ts
    unreadCount: 'Unread: {{count}}',
```

- [ ] **Step 2: Падающие тесты**

`client/src/components/__tests__/ServerList.unread.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ServerList } from '../ServerList';
import { useUnreadStore } from '@/stores/unreadStore';
import { useLocaleStore } from '@/stores/localeStore';
import type { Server } from '@/types';

vi.mock('@/services/api', async (orig) => ({ ...(await orig<typeof import('@/services/api')>()), apiService: {} }));

const srv = (id: string): Server => ({ id, name: id.toUpperCase(), owner_id: 'o' } as Server);
const mount = () => render(
  <ServerList servers={[srv('s1'), srv('s2')]} currentServer={null} user={null} onSelectServer={vi.fn()}
    onCreateServer={vi.fn()} onOpenFindServer={vi.fn()} onServerDeleted={vi.fn()} onSelectHome={vi.fn()} pendingCount={0} />,
);

beforeEach(() => {
  useLocaleStore.setState({ locale: 'ru' });
  useUnreadStore.setState({
    channels: {
      a: { serverId: 's1', count: 3, cursor: { at: '2026-10-03T10:00:00Z', id: null } },
      b: { serverId: 's1', count: 7, cursor: { at: '2026-10-03T10:00:00Z', id: null } },
      c: { serverId: 's2', count: 0, cursor: { at: '2026-10-03T10:00:00Z', id: null } },
    },
  });
});
afterEach(cleanup);

describe('ServerList unread badge', () => {
  it('shows the sum of channel counters, hides zero', () => {
    mount();
    const badges = document.querySelectorAll('.server-icon[title="S1"] .server-icon-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('10');
    expect(badges[0].getAttribute('aria-label')).toBe('Непрочитанных: 10');
    expect(document.querySelector('.server-icon[title="S2"] .server-icon-badge')).toBeNull();
  });

  it('caps at 99+', () => {
    useUnreadStore.setState((s) => ({ channels: { ...s.channels, a: { ...s.channels.a, count: 100 } } }));
    mount();
    expect(document.querySelector('.server-icon[title="S1"] .server-icon-badge')?.textContent).toBe('99+');
  });
});
```
(Если `Server` требует других обязательных полей — `as Server` уже снимает это; при ошибке рендера из-за отсутствующего поля дописать его в `srv`.)

`client/src/components/__tests__/ChannelSidebar.unread.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChannelSidebar } from '../ChannelSidebar';
import { useServerStore } from '@/stores/serverStore';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore } from '@/stores/callStore';
import { useLocaleStore } from '@/stores/localeStore';
import { useUnreadStore } from '@/stores/unreadStore';
import { channel, me, otherUser, serverA, stubBrowser } from './chatHarness';
import type { Channel } from '@/types';

vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

const second: Channel = { ...channel, id: 'c2', name: 'random', position: 1 };
const cur = { at: '2026-10-03T10:00:00Z', id: null };

beforeAll(stubBrowser);
beforeEach(() => {
  useLocaleStore.setState({ locale: 'ru' });
  useAuthStore.setState({ user: me });
  useCallStore.setState({ callChannelId: null });
  useServerStore.setState({ currentServer: serverA, servers: [serverA], members: [otherUser], channels: [channel, second], permissions: new Map() });
  useUnreadStore.setState({ channels: { [channel.id]: { serverId: serverA.id, count: 0, cursor: cur }, c2: { serverId: serverA.id, count: 5, cursor: cur } } });
});
afterEach(cleanup);

const mount = (voice = new Map<string, string[]>()) => render(
  <ChannelSidebar server={serverA} channels={[channel, second]} currentChannel={channel} onSelectChannel={vi.fn()}
    onJoinVoice={vi.fn()} user={me} voiceParticipants={voice} members={[otherUser]}
    onChannelDeleted={vi.fn()} onServerDeleted={vi.fn()} onCreateChannel={vi.fn()} />,
);

describe('ChannelSidebar unread pill', () => {
  it('text row: pill with count and has-unread, none for zero', () => {
    mount();
    const rows = document.querySelectorAll('.channel-row');
    expect(rows[0].querySelector('.channel-unread-pill')).toBeNull();
    expect(rows[0].classList.contains('has-unread')).toBe(false);
    expect(rows[1].querySelector('.channel-unread-pill')?.textContent).toBe('5');
    expect(rows[1].classList.contains('has-unread')).toBe(true);
  });

  it('voice card row also shows the pill', () => {
    mount(new Map([['c2', ['u2']]]));
    expect(document.querySelector('.voice-card .channel-unread-pill')?.textContent).toBe('5');
  });
});
```

В `client/src/mobile/__tests__/activity.test.tsx` добавить в `describe('activity extension point', …)` (импорт `useUnreadStore` из `@/stores/unreadStore` вверху файла; в `afterEach` добавить `useUnreadStore.getState().reset();`):
```tsx
  it('without an override: unread counter comes from the store', () => {
    useUnreadStore.setState({ channels: { c1: { serverId: 's1', count: 4, cursor: { at: '2026-10-03T10:00:00Z', id: null } } } });
    function P() {
      const ch = useChannelActivity('c1');
      const sv = useServerActivity('s1');
      return <i data-ch={String(ch?.unreadCount)} data-sv={String(sv?.unreadCount)} data-zero={String(useChannelActivity('zz'))} />;
    }
    render(<P />);
    const el = document.querySelector('i')!;
    expect(el.getAttribute('data-ch')).toBe('4');
    expect(el.getAttribute('data-sv')).toBe('4');
    expect(el.getAttribute('data-zero')).toBe('null');
  });
```
Если `unreadStore` через `apiService` тянет сеть в этом тесте — добавить в начало файла `vi.mock('@/services/api', () => ({ apiService: {} }));`.

- [ ] **Step 3: Убедиться, что падают**

Run: `cd client && npx vitest run src/components/__tests__/ServerList.unread.test.tsx src/components/__tests__/ChannelSidebar.unread.test.tsx src/mobile/__tests__/activity.test.tsx`
Expected: FAIL (бейджей нет, мобильный хук возвращает `null`).

- [ ] **Step 4: Реализовать**

`client/src/components/ServerList.tsx` — импорт `import { useUnreadStore, selectServerUnread, formatUnread } from '@/stores/unreadStore';`; внутри иконки сервера после `<span className="server-icon-name">{server.name}</span>`:
```tsx
            <ServerUnreadBadge serverId={server.id} />
```
и в конец файла:
```tsx
/** VYC-104: сумма непрочитанного по каналам сервера. Тот же бейдж, что у «Дома». */
function ServerUnreadBadge({ serverId }: { serverId: string }) {
  const t = useT();
  const count = useUnreadStore(selectServerUnread(serverId));
  if (count === 0) return null;
  return (
    <span className="server-icon-badge" aria-label={t('sidebar.unreadCount', { count: String(count) })}>
      {formatUnread(count)}
    </span>
  );
}
```

`client/src/components/ChannelSidebar.tsx` — импорт `import { useUnreadStore, formatUnread } from '@/stores/unreadStore';`; в теле компонента рядом с другими подписками на сторы:
```tsx
  const unreadByChannel = useUnreadStore((s) => s.channels);
```
внутри `channels.map((channel) => { … })` после `const isActive = …`:
```tsx
          const unread = unreadByChannel[channel.id]?.count ?? 0;
          const unreadPill = unread > 0 && (
            <span className="channel-unread-pill" aria-label={t('sidebar.unreadCount', { count: String(unread) })}>
              {formatUnread(unread)}
            </span>
          );
```
- в `voice-card-row` вставить `{unreadPill}` между `<span className="voice-card-name">…</span>` и `<span className="voice-card-count">…</span>`;
- у текстовой строки: `className={`channel-row${isActive ? ' is-active' : ''}${unread > 0 ? ' has-unread' : ''}`}` и `{unreadPill}` сразу после `<span className="channel-name">{channel.name}</span>`.

`client/src/components/ChannelSidebar.css` — в конец файла (вне блока с замерами специфичности `channel-join-voice`):
```css
/* ── Unread (VYC-104) ──
   Пилюля — та же форма, что бейдж сервера на рейле (.server-icon-badge), но в
   потоке строки, а не абсолютом на иконке. Имя непрочитанного канала — цвет
   основного текста и вес 600. */
.channel-unread-pill {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--danger);
  color: var(--white);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.channel-row.has-unread .channel-name {
  color: var(--ink);
  font-weight: 600;
}
```
Если stylelint выдаст `no-descending-specificity` из-за существующих правил `.channel-name`/`.channel-row:hover …` — перенести правило `.channel-row.has-unread .channel-name` выше конфликтующего, перепроверить stylelint до 0 байт; комментарий-«замер» рядом с блоком `channel-join-voice` не трогать.

`client/src/mobile/activity.ts` — импорт `import { useUnreadStore, selectChannelUnread, selectServerUnread } from '@/stores/unreadStore';`, заменить комментарий над `override` и тела хуков:
```ts
// Превью последнего сообщения сервер не отдаёт (вне рамок VYC-104) — только
// счётчик непрочитанного из unreadStore. Override — для тестов и проб.
let override: Override = null;
```
```ts
function fromCount(count: number): ChannelActivity | null {
  return count > 0 ? { preview: null, timestamp: null, unreadCount: count, hasUnread: true } : null;
}

export function useChannelActivity(channelId: string): ChannelActivity | null {
  const count = useUnreadStore(selectChannelUnread(channelId));
  return override ? override(channelId, 'channel') : fromCount(count);
}

export function useServerActivity(serverId: string): ChannelActivity | null {
  const count = useUnreadStore(selectServerUnread(serverId));
  return override ? override(serverId, 'server') : fromCount(count);
}
```

- [ ] **Step 5: Тесты проходят**

Run: `cd client && npx vitest run src/components/__tests__/ServerList.unread.test.tsx src/components/__tests__/ChannelSidebar src/mobile/__tests__/activity.test.tsx src/mobile/screens/__tests__/ServersScreen.test.tsx src/mobile/screens/__tests__/ChannelsScreen.test.tsx`
Expected: PASS (существующие снапшоты сайдбара не меняются — в них стор пуст).

- [ ] **Step 6: Гейты и коммит**

Run: `cd client && npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n`
Expected: 0 байт, 0 байт, «непереведённых строк не найдено.»
```bash
git add client/src/components/ServerList.tsx client/src/components/ChannelSidebar.tsx client/src/components/ChannelSidebar.css \
  client/src/mobile/activity.ts client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts \
  client/src/components/__tests__/ServerList.unread.test.tsx client/src/components/__tests__/ChannelSidebar.unread.test.tsx \
  client/src/mobile/__tests__/activity.test.tsx
git commit -m "VYC-104 Бейджи непрочитанного: сервер, канал, мобильные списки"
```

---

### Task 9: Галочки на своих сообщениях

**Files:**
- Create: `client/src/components/ReadReceipt.tsx`
- Modify: `client/src/components/MessageRow.tsx`, `client/src/components/MessageRow.css`
- Modify: `client/src/components/ChatArea.tsx` (загрузка квитанций при входе, проп `showReceipt`)
- Modify: `client/src/i18n/locales/ru.ts`, `en.ts` (namespace `chat`)
- Test: `client/src/components/__tests__/ReadReceipt.test.tsx`; снапшоты `client/src/components/__tests__/__snapshots__/ChatArea.*.html` (обновляются)

**Interfaces:**
- Consumes: `useUnreadStore` (`othersRead`, `loadReceipts`), `comparePos`, `msgPos`.
- Produces:
  - `ReadReceipt({ msg, onOpen }: { msg: Message; onOpen?: () => void })`
  - новые пропсы `MessageRow`: `showReceipt?: boolean`, `onOpenReaders?: () => void` (второй рендерится в Task 10 — здесь только передаётся в галочку)
  - i18n: `chat.receiptSent`, `chat.receiptRead`

- [ ] **Step 1: i18n**

`ru.ts`, в `chat`:
```ts
    receiptSent: 'Отправлено',
    receiptRead: 'Прочитано',
```
`en.ts`, в `chat`:
```ts
    receiptSent: 'Sent',
    receiptRead: 'Read',
```

- [ ] **Step 2: Падающий тест**

`client/src/components/__tests__/ReadReceipt.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ReadReceipt } from '../ReadReceipt';
import { useUnreadStore } from '@/stores/unreadStore';
import { useLocaleStore } from '@/stores/localeStore';
import type { Message } from '@/types';

vi.mock('@/services/api', () => ({ apiService: {} }));

const msg: Message = { id: 'm5', channel_id: 'c1', user_id: 'me', content: 'x', kind: 'user', created_at: '2026-10-03T10:00:05Z', updated_at: '2026-10-03T10:00:05Z' };

beforeEach(() => { useLocaleStore.setState({ locale: 'ru' }); useUnreadStore.getState().reset(); });
afterEach(cleanup);

describe('ReadReceipt', () => {
  it('grey "sent" until someone else reads up to the message', () => {
    render(<ReadReceipt msg={msg} />);
    const el = document.querySelector('.msg-receipt')!;
    expect(el.classList.contains('is-read')).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Отправлено');
  });

  it('turns read when othersRead reaches it, live', () => {
    render(<ReadReceipt msg={msg} />);
    act(() => { useUnreadStore.getState().applyChannelRead({ channel_id: 'c1', read_at: '2026-10-03T10:00:04Z', message_id: 'm4' }); });
    expect(document.querySelector('.msg-receipt')!.classList.contains('is-read')).toBe(false);
    act(() => { useUnreadStore.getState().applyChannelRead({ channel_id: 'c1', read_at: '2026-10-03T10:00:05Z', message_id: 'm5' }); });
    const el = document.querySelector('.msg-receipt')!;
    expect(el.classList.contains('is-read')).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Прочитано');
  });

  it('is a button only when it can open the readers list', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<ReadReceipt msg={msg} />);
    expect(document.querySelector('button.msg-receipt')).toBeNull();
    rerender(<ReadReceipt msg={msg} onOpen={onOpen} />);
    fireEvent.click(document.querySelector('button.msg-receipt')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Убедиться, что падает**

Run: `cd client && npx vitest run src/components/__tests__/ReadReceipt.test.tsx` → FAIL (нет модуля).

- [ ] **Step 4: Реализовать компонент**

`client/src/components/ReadReceipt.tsx`:
```tsx
import { Check, CheckCheck } from 'lucide-react';
import { useT } from '@/i18n';
import { useUnreadStore } from '@/stores/unreadStore';
import { comparePos, msgPos } from '@/utils/readCursor';
import type { Message } from '@/types';

/**
 * VYC-104: квитанция под своим сообщением. Серая одинарная — никто ещё не
 * прочитал, цветная двойная — прочитал хотя бы один (кто именно — в списке
 * «Кто прочитал»). Состояние — по самому дальнему курсору других участников.
 */
export function ReadReceipt({ msg, onOpen }: { msg: Message; onOpen?: () => void }) {
  const t = useT();
  const read = useUnreadStore((s) => {
    const others = s.othersRead[msg.channel_id];
    return !!others && comparePos(msgPos(msg), others) <= 0;
  });
  const label = read ? t('chat.receiptRead') : t('chat.receiptSent');
  const Icon = read ? CheckCheck : Check;
  const className = `msg-receipt${read ? ' is-read' : ''}`;
  if (!onOpen) {
    return (
      <span className={className} role="img" aria-label={label} title={label}>
        <Icon size={14} strokeWidth={1.8} />
      </span>
    );
  }
  return (
    <button type="button" className={`${className} is-action`} aria-label={label} title={label} onClick={onOpen}>
      <Icon size={14} strokeWidth={1.8} />
    </button>
  );
}
```

- [ ] **Step 5: Подключить в `MessageRow`**

`client/src/components/MessageRow.tsx`:
- импорт `import { ReadReceipt } from '@/components/ReadReceipt';`
- в `MessageRowProps` (после `enterSends`):
```ts
  /** VYC-104: галочка прочтения под своим сообщением. Только в ленте канала
   *  участника — в гостевом чате квитанций нет. */
  showReceipt?: boolean;
  /** Открыть «Кто прочитал» (автор, владелец, администратор). */
  onOpenReaders?: () => void;
```
- в `msg-content` сразу после блока `{!isEditing && msg.deliveryState === 'failed' && ( … )}`:
```tsx
        {!isEditing && props.showReceipt && isOwn && msg.kind === 'user' && !msg.guest && !msg.deliveryState && (
          <ReadReceipt msg={msg} onOpen={props.onOpenReaders} />
        )}
```

`client/src/components/MessageRow.css` — в конец файла:
```css
/* ── Read receipt (VYC-104) ──
   Под своим сообщением, у правого края колонки — там же, где индикатор
   отправки. Серая — отправлено, акцентная — прочитано. */
.msg-receipt {
  display: flex;
  width: fit-content;
  margin: 2px 0 0 auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--faint);
}

.msg-receipt.is-read {
  color: var(--accent-text);
}

.msg-receipt.is-action {
  cursor: pointer;
}
```

`client/src/components/ChatArea.tsx`:
- рядом с эффектом якоря разделителя:
```tsx
  // Галочки (VYC-104): самый дальний курсор других — при входе в канал,
  // дальше его двигают события channel_read.
  useEffect(() => {
    if (channel?.id) void useUnreadStore.getState().loadReceipts(channel.id);
  }, [channel?.id]);
```
- в `<MessageRow …>` добавить проп `showReceipt`.

- [ ] **Step 6: Тесты и снапшоты**

Run: `cd client && npx vitest run src/components/__tests__/ReadReceipt.test.tsx` → PASS.
Run: `cd client && npx vitest run src/components/__tests__/ChatArea` — снапшоты с собственными сообщениями `me` упадут из-за новой галочки. Просмотреть diff: единственное допустимое изменение — добавленный `<span class="msg-receipt" role="img" aria-label="Отправлено" …><svg …></span>` под своими сообщениями. Если diff именно такой — обновить: `npx vitest run src/components/__tests__/ChatArea -u` и закоммитить обновлённые снапшоты; любое другое изменение — баг, не обновлять.

- [ ] **Step 7: Гейты и коммит**

Run: `cd client && npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n`
```bash
git add client/src/components/ReadReceipt.tsx client/src/components/MessageRow.tsx client/src/components/MessageRow.css \
  client/src/components/ChatArea.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts \
  client/src/components/__tests__/ReadReceipt.test.tsx client/src/components/__tests__/__snapshots__/
git commit -m "VYC-104 Галочки прочтения на своих сообщениях"
```

---

### Task 10: «Кто прочитал» — модалка на десктопе, шторка на мобильном

**Files:**
- Create: `client/src/utils/readers.ts`
- Create: `client/src/components/ReadersDialog.tsx`, `client/src/components/ReadersDialog.css`
- Modify: `client/src/components/MessageRow.tsx` (кнопка в hover-панели)
- Modify: `client/src/components/ChatArea.tsx` (состояние, рендер диалога/шторки, проводка пропсов)
- Modify: `client/src/mobile/chat/useMessageActions.tsx`, `client/src/mobile/chat/MessageActionsSheet.tsx`
- Modify: `client/src/i18n/locales/ru.ts`, `en.ts`
- Test: `client/src/components/__tests__/ReadersDialog.test.tsx`, `client/src/mobile/chat/__tests__/useMessageActions.readers.test.tsx`

**Interfaces:**
- Consumes: `apiService.getMessageReaders` (Task 5), `MessageReaders` (Task 5), `ReadReceipt`/проп `onOpenReaders` (Task 9), `can`, `PERMISSIONS`, `useModalFocus`, `BottomSheet`, `Avatar`.
- Produces:
  - `canViewReaders(msg: Message, userId: string | undefined, perms: PermissionSet | undefined): boolean`
  - `ReadersList({ channelId, messageId })`, `ReadersDialog({ channelId, messageId, onClose })`
  - `MessageActionsInput.onReaders?: () => void`; пропсы `MessageActionsSheet`: `canViewReaders: (m: ChatMessage) => boolean`, `onReaders: (m: ChatMessage) => void`
  - i18n: `chat.readersTitle`, `chat.readersRead`, `chat.readersUnread`, `chat.readersEmpty`, `chat.readersLoading`, `chat.readersError`

- [ ] **Step 1: i18n**

`ru.ts`, в `chat`:
```ts
    readersTitle: 'Кто прочитал',
    readersRead: 'Прочитали · {{count}}',
    readersUnread: 'Не прочитали · {{count}}',
    readersEmpty: 'Никого',
    readersLoading: 'Загрузка…',
    readersError: 'Не удалось загрузить список',
```
`en.ts`, в `chat`:
```ts
    readersTitle: 'Read by',
    readersRead: 'Read · {{count}}',
    readersUnread: 'Not read yet · {{count}}',
    readersEmpty: 'Nobody',
    readersLoading: 'Loading…',
    readersError: 'Could not load the list',
```

- [ ] **Step 2: Падающие тесты**

`client/src/components/__tests__/ReadersDialog.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/services/api', async (orig) => ({
  ...(await orig<typeof import('@/services/api')>()),
  apiService: { getMessageReaders: vi.fn() },
}));

import { apiService } from '@/services/api';
import { ReadersDialog } from '../ReadersDialog';
import { canViewReaders } from '@/utils/readers';
import { useLocaleStore } from '@/stores/localeStore';
import { PERMISSIONS } from '@/utils/permissions';
import type { Message } from '@/types';

const api = vi.mocked(apiService);
beforeEach(() => { useLocaleStore.setState({ locale: 'ru' }); api.getMessageReaders.mockReset(); });
afterEach(cleanup);

describe('ReadersDialog', () => {
  it('loads and splits the list', async () => {
    api.getMessageReaders.mockResolvedValue({ read: [{ user_id: 'u2', username: 'boris' }], unread: [] });
    render(<ReadersDialog channelId="c1" messageId="m1" onClose={vi.fn()} />);
    expect(document.body.textContent).toContain('Загрузка…');
    await waitFor(() => expect(document.body.textContent).toContain('Прочитали · 1'));
    expect(document.body.textContent).toContain('boris');
    expect(document.body.textContent).toContain('Не прочитали · 0');
    expect(document.body.textContent).toContain('Никого');
    expect(api.getMessageReaders).toHaveBeenCalledWith('c1', 'm1');
  });

  it('shows an error state', async () => {
    api.getMessageReaders.mockRejectedValue(new Error('403'));
    render(<ReadersDialog channelId="c1" messageId="m1" onClose={vi.fn()} />);
    await waitFor(() => expect(document.body.textContent).toContain('Не удалось загрузить список'));
  });

  it('closes on the close button', () => {
    api.getMessageReaders.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    render(<ReadersDialog channelId="c1" messageId="m1" onClose={onClose} />);
    fireEvent.click(document.querySelector('.modal-close-btn')!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('canViewReaders', () => {
  const base: Message = { id: 'm', channel_id: 'c', user_id: 'me', content: 'x', kind: 'user', created_at: 't', updated_at: 't' };
  it('author, admin, owner — yes; others, guests, calls — no', () => {
    expect(canViewReaders(base, 'me', undefined)).toBe(true);
    expect(canViewReaders(base, 'u2', undefined)).toBe(false);
    expect(canViewReaders(base, 'u2', { isOwner: false, bits: PERMISSIONS.ADMINISTRATOR, highestPosition: 1 })).toBe(true);
    expect(canViewReaders(base, 'u2', { isOwner: true, bits: 0n, highestPosition: 1 })).toBe(true);
    expect(canViewReaders({ ...base, user_id: null, guest: { id: 'g', display_name: 'G' } }, 'me', { isOwner: true, bits: 0n, highestPosition: 1 })).toBe(false);
    expect(canViewReaders({ ...base, kind: 'call' }, 'me', undefined)).toBe(false);
  });
});
```

`client/src/mobile/chat/__tests__/useMessageActions.readers.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMessageActions, type MessageActionsInput } from '../useMessageActions';
import { useLocaleStore } from '@/stores/localeStore';

beforeEach(() => { useLocaleStore.setState({ locale: 'ru' }); });

const input = (over: Partial<MessageActionsInput> = {}): MessageActionsInput => ({
  msg: { id: 'm', channel_id: 'c', user_id: 'me', content: 'привет', kind: 'user', created_at: 't', updated_at: 't' },
  canModify: true, members: [],
  onQuote: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn(), onDiscard: vi.fn(),
  ...over,
});

describe('useMessageActions — readers', () => {
  it('adds "Кто прочитал" only when onReaders is given', () => {
    const without = renderHook(() => useMessageActions(input())).result.current;
    expect(without.map((i) => i.label)).not.toContain('Кто прочитал');
    const onReaders = vi.fn();
    const withIt = renderHook(() => useMessageActions(input({ onReaders }))).result.current;
    const item = withIt.find((i) => i.label === 'Кто прочитал');
    expect(item).toBeDefined();
    item!.onClick();
    expect(onReaders).toHaveBeenCalled();
  });
});
```
(Если `ContextMenuItem.onClick` имеет другую сигнатуру — вызвать так, как её вызывает `ActionSheet`.)

- [ ] **Step 3: Убедиться, что падают**

Run: `cd client && npx vitest run src/components/__tests__/ReadersDialog.test.tsx src/mobile/chat/__tests__/useMessageActions.readers.test.tsx` → FAIL.

- [ ] **Step 4: Реализовать**

`client/src/utils/readers.ts`:
```ts
import type { Message, PermissionSet } from '@/types';
import { can, PERMISSIONS } from '@/utils/permissions';

/**
 * VYC-104: кому показывать «Кто прочитал». Зеркало проверки на сервере
 * (ReadStateUseCase.Readers): пользовательское сообщение участника — его
 * автору, владельцу сервера и PermAdministrator (can() покрывает обоих).
 * Это только UI-гейт: сервер на чужой запрос ответит 403.
 */
export function canViewReaders(msg: Message, userId: string | undefined, perms: PermissionSet | undefined): boolean {
  if (msg.kind !== 'user' || !msg.user_id) return false;
  return msg.user_id === userId || can(perms, PERMISSIONS.ADMINISTRATOR);
}
```

`client/src/components/ReadersDialog.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { useModalFocus } from '@/hooks/useModalFocus';
import { apiService } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import type { MessageReader, MessageReaders } from '@/types';
import './ReadersDialog.css';

type ReadersState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: MessageReaders };

/** Снимок на момент открытия: живого обновления нет (спека §0, YAGNI). */
function useMessageReaders(channelId: string, messageId: string): ReadersState {
  const [state, setState] = useState<ReadersState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    apiService.getMessageReaders(channelId, messageId)
      .then((data) => { if (alive) setState({ status: 'ok', data }); })
      .catch(() => { if (alive) setState({ status: 'error' }); });
    return () => { alive = false; };
  }, [channelId, messageId]);
  return state;
}

/** Содержимое «Кто прочитал» — общее для десктопной модалки и мобильной шторки. */
export function ReadersList({ channelId, messageId }: { channelId: string; messageId: string }) {
  const t = useT();
  const st = useMessageReaders(channelId, messageId);
  if (st.status === 'loading') return <div className="readers-status">{t('chat.readersLoading')}</div>;
  if (st.status === 'error') return <div className="readers-status is-error">{t('chat.readersError')}</div>;
  return (
    <div className="readers-list">
      <ReadersSection title={t('chat.readersRead', { count: String(st.data.read.length) })} users={st.data.read} />
      <ReadersSection title={t('chat.readersUnread', { count: String(st.data.unread.length) })} users={st.data.unread} />
    </div>
  );
}

function ReadersSection({ title, users }: { title: string; users: MessageReader[] }) {
  const t = useT();
  return (
    <section className="readers-section">
      <h3 className="readers-section-title">{title}</h3>
      {users.length === 0 ? (
        <div className="readers-empty">{t('chat.readersEmpty')}</div>
      ) : (
        <ul className="readers-users">
          {users.map((u) => (
            <li key={u.user_id} className="readers-user">
              <Avatar url={u.avatar_url} username={u.username} className="readers-user-avatar" />
              <span className="readers-user-name">{u.username}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Десктоп: компактная модалка по контракту оверлеев (.modal-overlay + useModalFocus). */
export function ReadersDialog({ channelId, messageId, onClose }: { channelId: string; messageId: string; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(true, ref, onClose);
  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        ref={ref}
        className="modal readers-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.readersTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('chat.readersTitle')}</h2>
          <button type="button" className="modal-close-btn" aria-label={t('common.close')} data-autofocus onClick={onClose}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <ReadersList channelId={channelId} messageId={messageId} />
      </div>
    </div>
  );
}
```
(`common.close` уже есть в обоих словарях.)

`client/src/components/ReadersDialog.css`:
```css
/* ── «Кто прочитал» (VYC-104) ──
   Модалка уже .modal — ширину сужаем до списка, вертикальный скролл внутри
   списка, чтобы сервер на сотню участников не растягивал диалог за экран. */
.readers-dialog {
  width: min(360px, 100%);
}

.readers-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 60vh;
  overflow-y: auto;
}

.readers-section-title {
  margin: 0 0 6px;
  font-size: var(--fs-label);
  font-weight: 700;
  color: var(--muted);
}

.readers-users {
  margin: 0;
  padding: 0;
  list-style: none;
}

.readers-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  color: var(--ink);
}

.readers-user-avatar {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
}

.readers-user-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.readers-empty,
.readers-status {
  color: var(--muted);
}

.readers-status.is-error {
  color: var(--danger-text);
}
```
(Проверить токен `--fs-label` в `tokens.css` — он используется в `ChannelSidebar.css`. Если stylelint ругается на размер аватара или порядок — привести к паттерну существующих списков участников в `UserList.css`.)

`client/src/components/MessageRow.tsx`:
- импорт иконки: `import { Pencil, Trash2, Quote, Clock, Eye } from 'lucide-react';`
- условие обёртки hover-панели: `{!isEditing && !msg.deliveryState && ((!msg.sticker_id && !voice) || canModify || !!props.onOpenReaders) && (`
- **последней** кнопкой внутри `msg-actions` (после кнопки удаления — тесты `ChatArea.dom` адресуют кнопки по индексу, новая не должна сдвигать существующие):
```tsx
          {props.onOpenReaders && (
            <button type="button" className="msg-action-btn" aria-label={t('chat.readersTitle')} title={t('chat.readersTitle')} onClick={props.onOpenReaders}>
              <Eye size={15} strokeWidth={1.8} />
            </button>
          )}
```

`client/src/mobile/chat/useMessageActions.tsx`:
- импорт `Eye` из `lucide-react`;
- в `MessageActionsInput`: `/** «Кто прочитал» — только если вызывающий уже проверил права (canViewReaders). */ onReaders?: () => void;`
- перед `return items;`:
```tsx
  if (i.onReaders) items.push({ label: t('chat.readersTitle'), icon: icon(Eye), onClick: i.onReaders });
```

`client/src/mobile/chat/MessageActionsSheet.tsx`:
- в `Props`: `canViewReaders: (m: ChatMessage) => boolean;` и `onReaders: (m: ChatMessage) => void;`
- в `Body` деструктурировать их и передать в `useMessageActions`: `onReaders: canViewReaders(msg) ? () => onReaders(msg) : undefined,`

`client/src/components/ChatArea.tsx`:
- импорты: `import { ReadersDialog, ReadersList } from '@/components/ReadersDialog';`, `import { BottomSheet } from '@/mobile/sheets/BottomSheet';`, `import { canViewReaders } from '@/utils/readers';`
- состояние рядом с `actionsMsg`: `const [readersFor, setReadersFor] = useState<string | null>(null);`
- сброс при смене канала — в существующий эффект, где `setEditingId(null)` и т. д.: добавить `setReadersFor(null);`
- хелпер в теле компонента (после `permissions`):
```tsx
  const readersAllowed = (m: ChatMessage) => !m.deliveryState && canViewReaders(m, user?.id, permissions);
```
  (`ChatMessage` — из `@/stores/messageStore`; добавить в импорт, если его там ещё нет.)
- в `<MessageRow …>`: `onOpenReaders={readersAllowed(msg) ? () => setReadersFor(msg.id) : undefined}`
- в `<MessageActionsSheet …>`: `canViewReaders={readersAllowed}` и `onReaders={(m) => setReadersFor(m.id)}`
- перед закрывающим `</main>`:
```tsx
      {readersFor && channel && (messageActions === 'sheet' ? (
        <BottomSheet open onClose={() => setReadersFor(null)} title={t('chat.readersTitle')}>
          <ReadersList channelId={channel.id} messageId={readersFor} />
        </BottomSheet>
      ) : (
        <ReadersDialog channelId={channel.id} messageId={readersFor} onClose={() => setReadersFor(null)} />
      ))}
```

- [ ] **Step 5: Тесты проходят**

Run: `cd client && npx vitest run src/components/__tests__/ReadersDialog.test.tsx src/mobile/chat src/components/__tests__/ChatArea src/components/__tests__/MessageRow`
Expected: PASS. Снапшоты `ChatArea.*` с собственными сообщениями получат кнопку `Eye` в hover-панели — просмотреть diff (единственное допустимое изменение — эта кнопка последней в `msg-actions` и, для своих сообщений, `button.msg-receipt is-action` вместо `span.msg-receipt`) и обновить `-u`. Тест `src/styles/__tests__/overlay-scrim-contract.test.ts` должен остаться зелёным.

- [ ] **Step 6: Гейты и коммит**

Run: `cd client && npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test 2>&1 | tail -15`
Expected: 0 байт / 0 байт / «непереведённых строк не найдено.» / ровно 3 падения в `api.network-retry.test.ts`.
```bash
git add client/src/utils/readers.ts client/src/components/ReadersDialog.tsx client/src/components/ReadersDialog.css \
  client/src/components/MessageRow.tsx client/src/components/ChatArea.tsx \
  client/src/mobile/chat/useMessageActions.tsx client/src/mobile/chat/MessageActionsSheet.tsx \
  client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts \
  client/src/components/__tests__/ReadersDialog.test.tsx client/src/mobile/chat/__tests__/useMessageActions.readers.test.tsx \
  client/src/components/__tests__/__snapshots__/
git commit -m "VYC-104 Список «Кто прочитал»: модалка и мобильная шторка"
```

---

### Task 11: Финальная проверка — гейты, визуал, ручной e2e

**Files:**
- Create: `docs/superpowers/plans/2026-10-03-vyc104-manual-checklist.md`

**Interfaces:**
- Consumes: всё из Task 1–10.
- Produces: отчёт о проверке (файл-чеклист с отметками).

- [ ] **Step 1: Все гейты**

Из корня: `make build && make test && make vet && (cd server && gofmt -l ./internal ./cmd ./pkg)` — сравнить с базовой линией Task 1 Step 0.
С Postgres: `cd server && VYCORD_TEST_DSN=… go test ./internal/repository/postgres/ -run 'ReadState|Migration029' -v` → все PASS (иначе — отметить в отчёте «не исполнено»).
Клиент: `cd client && npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test 2>&1 | tail -15` → 0 / 0 / ок / ровно 3 падения в `api.network-retry.test.ts`.

- [ ] **Step 2: Миграция на dev-БД**

Если dev-окружение поднято: `make migrate-up` → `make migrate-down` (откат 029) → `make migrate-up`; после последнего `SELECT count(*) FROM channel_read_states;` > 0 при наличии серверов. Иначе — отметить в отчёте.

- [ ] **Step 3: Визуальная проверка**

По `client/docs/verification.md` и `client/tools/verify/README.md` (dev-сервер — `npm run dev:vite`, свежее последнего коммита): обе темы, ширины 1440 и 760, мобильная раскладка:
- бейдж на иконке сервера (`10`, `99+`) и отсутствие бейджа при нуле;
- пилюля у текстового канала и у голосовой карточки, жирное имя непрочитанного канала, кнопка «Присоединиться к голосу» на hover не налезает на пилюлю;
- серая и цветная галочка под своим сообщением, обычное и continuation-сообщение;
- модалка «Кто прочитал» (пустая секция, длинный список со скроллом, ошибка); Escape закрывает только её;
- мобильные: бейдж в списке серверов и каналов, long-press → «Кто прочитал» → шторка.

- [ ] **Step 4: Ручной e2e на двух аккаунтах**

Записать в `docs/superpowers/plans/2026-10-03-vyc104-manual-checklist.md` и пройти:
```markdown
# VYC-104 — ручная проверка

- [ ] А пишет в канале X сервера S, Б смотрит другой сервер → у Б растут бейдж S и пилюля X (без перезагрузки).
- [ ] Б открывает X при свёрнутом/расфокусированном окне → у А галочка серая, у Б счётчик не сбрасывается.
- [ ] Б фокусирует окно → у А галочка становится цветной (без перезагрузки), у Б бейдж S и пилюля X пропадают.
- [ ] А открывает «Кто прочитал» → Б в «Прочитали», третий участник В — в «Не прочитали», сам А в списке отсутствует.
- [ ] В (не автор, не админ) не видит кнопки «Кто прочитал» под сообщением А; прямой GET …/readers/{id} от В → 403.
- [ ] Владелец сервера видит «Кто прочитал» под чужим сообщением.
- [ ] А удаляет непрочитанное Б сообщение → счётчик у Б уменьшается.
- [ ] Гость звонка пишет в чат → у Б счётчик растёт; под гостевым сообщением нет галочки и кнопки.
- [ ] Звонок в канале (call-плашка) не увеличивает счётчик.
- [ ] Б рвёт сеть, А пишет 3 сообщения, сеть возвращается → после реконнекта у Б счётчик 3.
- [ ] Новый участник Г вступает в сервер → старая история у него не подсвечена непрочитанной; листает историю вверх → счётчик не растёт.
- [ ] Б читает на телефоне, потом открывает десктоп → счётчики совпадают после подключения.
```
Отметить каждый пункт; несошедшиеся — описать в отчёте с шагами воспроизведения.

- [ ] **Step 5: Коммит чеклиста**

```bash
git add -f docs/superpowers/plans/2026-10-03-vyc104-manual-checklist.md
git commit -m "VYC-104 Чеклист ручной проверки"
```
