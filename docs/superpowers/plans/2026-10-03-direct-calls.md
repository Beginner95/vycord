# Звонки 1:1 через SFU (VYC-103) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** личные звонки 1:1 (из списка друзей и из списка участников сервера) работают надёжно — через приватную комнату SFU, с протоколом вызова «звоним / входящий / идёт / завершён», на десктопе и мобильном.

**Architecture:** API — единственный владелец жизненного цикла звонка (`CallUseCase`: машина состояний поверх таблицы `calls` + таймеры в памяти). Медиа — существующий `groupCallService`/`callStore`, обобщённые с «канала» до «комнаты» (`room_id = call_id`). Клиентский протокол вызова — новый `directCallStore`. Старый P2P (`services/call.ts`, `CallUI`, ретрансляция `webrtc_*`) удаляется.

**Tech Stack:** Go (net/http, pgx, testify), PostgreSQL; React 19 + Zustand 5 + TypeScript + Vitest; Electron.

**Spec:** `docs/superpowers/specs/2026-10-03-direct-calls-design.md` (раздел «Поправки при планировании» — обязателен к прочтению: пять решений спеки уточнены).

## Global Constraints

- Коммиты и пуши делает **пользователь**. Шаг «Checkpoint» в каждой задаче = показать `git status`/`git diff --stat` и остановиться; **не** выполнять `git commit`, **никогда** не добавлять Claude в co-author. Никогда `git add -A` / `git add .`.
- Go-команды — из корня репо через `make` (`make test`, `make vet`, `make build`) или `cd server && go test ./...`. Базовая линия на 2026-10-03: `go build`, `go vet`, `go test ./...` — **все зелёные**; любое падение — ваше.
- Интеграционные тесты Postgres пропускаются без `VYCORD_TEST_DSN`; если есть локальный Postgres — запускать с ним.
- Клиентские команды — только из `client/`. Гейты: `npx tsc --noEmit` — exit 0 и 0 байт; `npx stylelint "src/**/*.css"` — 0 байт; `npm run check:i18n` — «непереведённых строк не найдено.»; `npm test` — ровно 3 падения, все в `api.network-retry.test.ts` (этот файл не трогать).
- Перед UI-работой прочитать `client/CLAUDE.md` и `client/docs/` (дизайн-система, токены, верификация). Цвета/отступы — только токены.
- Таймауты: дозвон **45 с**; grace обрыва WS с API **20 с**; клиентский grace ухода собеседника из SFU **15 с**.
- Права на звонок — **ровно `CanDM`** (`friendUseCase.CanDM`), никакой своей логики.
- Строки UI — ru и en через i18n (`client/src/i18n/locales/{ru,en}.ts`), секция `call` / `directCall`.
- Ответы и комментарии в коде — по-русски, в стиле окружающего кода.

## Review Focus

1. **Принятие звонка, будучи в голосовом канале** — ожидается: выход из канала (`voice_left` уходит, участники канала видят уход), вход в комнату 1:1, второй участник не «падает» из-за `Already in a call` (тест в Task 8).
2. **Вход в голосовой канал, будучи в звонке 1:1** (кнопка в шапке чата) — ожидается: 1:1 завершается у обоих с `reason: ended`, канал подключается (тест в Task 8 + Task 9).
3. **Перезагрузка вкладки/реконнект WS в активном звонке** — ожидается: звонок у собеседника не завершается, если вернулся за 20 с; клиент по `call_state` восстанавливает фазу и снова входит в комнату (тесты в Task 3 и Task 9).
4. **Комната 1:1 не протекает в голосовое присутствие каналов** — presence-воркер не записывает `call_id` в `voiceChannels`, не создаёт «событие звонка» в чате (тест в Task 5).
5. **Звонок пользователю, которому уже кто-то звонит** — ожидается `call_error busy` и тост, а не вторая карточка поверх первой (тест в Task 2).

---

## Поправки к спеке, принятые при планировании

Эти пункты внесены в спеку (раздел «Поправки при планировании»); план следует им.

1. **Уникальных индексов нет.** Индекс «один живой звонок на получателя» противоречит решению «звонок проходит, принятие переключает» (занятый в активном звонке должен получить `ringing`). Конкурентность закрывает `sync.Mutex` в `CallUseCase` (API — один процесс) + условные переходы в БД. Новое правило: если у получателя **уже звонит** другой вызов (`ringing`, входящий или исходящий) — `call_error busy`.
2. **`callChannelId` не переименовывается.** Он остаётся «канал звонка» (у 1:1 — `null`), добавляются `callKind`, `callRoomId`, `callPeer`. Все проверки «я в звонке вообще» переводятся на `callRoomId` (список в Task 8). Переименование задело бы ~20 файлов и 17 тестов без пользы: сравнения «этот ли канал» для 1:1 корректно дают `false`.
3. **Фильтр комнат в presence-воркере.** Воркер считает каждую комнату SFU голосовым каналом; комнаты звонков 1:1 отфильтровываются (`CallUseCase.IsCallRoom`).
4. **`call_state` при коннекте пишется прямо в `client.Send`**, а не через хаб: регистрация клиента в хабе асинхронна, `SendToUser` сразу после `RegisterClient` может промахнуться.
5. **Рингтон** — существующий `audioService.startRingtone()`; генератор из `useCallRing` не выносится (у `audioService` уже есть свой). Гудки исходящего — новый `audioService.startRingback()`.

Найдено попутно: `callRepository` сравнивает `err == sql.ErrNoRows`, а pgx возвращает `pgx.ErrNoRows` — `GetActiveByUser` без активного звонка возвращал ошибку, `StartCall` падал всегда. Это, вероятно, главная причина «звонок не проходит»; репозиторий переписывается в Task 1.

---

## Структура файлов

**Сервер**

| Файл | Ответственность |
|---|---|
| `server/migrations/028_direct_calls.{up,down}.sql` | `accepted_at`, закрытие висящих звонков |
| `server/internal/domain/call.go` | `Call`, статусы, причины, `CallParty`, интерфейсы репо/usecase/портов |
| `server/internal/domain/errors.go` | `ErrCallNotFound`, `ErrCallInvalidState`, `ErrCallPeerOffline`, `ErrCallBusy` |
| `server/internal/repository/postgres/call.go` | репозиторий (переписан) |
| `server/internal/usecase/callclock.go` | `Clock` + реальная реализация |
| `server/internal/usecase/call.go` | машина состояний (переписана) |
| `server/internal/delivery/ws/call_notifier.go` | адаптер хаба под `domain.CallNotifier` |
| `server/internal/delivery/http/handler/websocket.go` | WS-протокол звонка, хуки connect/disconnect |
| `server/internal/delivery/http/handler/call.go` | `POST /api/v1/calls/{call_id}/voice-token` |
| `server/internal/presence/worker.go` | фильтр комнат |
| `server/cmd/api/main.go` | сборка |

**Клиент**

| Файл | Ответственность |
|---|---|
| `client/src/types/directCall.ts` | типы протокола |
| `client/src/services/api.ts` | `getCallVoiceToken` |
| `client/src/services/callCredentials.ts` | маршрутизация токена по комнате |
| `client/src/stores/callStore.ts` | `kind: 'direct'`, `callRoomId/callKind/callPeer`, переключение звонков |
| `client/src/stores/directCallStore.ts` | протокол вызова на клиенте |
| `client/src/services/audio.ts` | гудки исходящего, тихий рингтон |
| `client/src/components/directCall/*` | `DirectCallView`, `IncomingCallCard`, `MissedCallToasts`, `CallButton` |
| `client/src/components/{CallDock,CallStage,FriendRow,FriendsPanel,UserList,ChatArea}.tsx` | интеграция |
| `client/src/pages/app/{DesktopShell,useAppController}.ts(x)` | экран звонка в основной колонке |
| `client/src/mobile/...` | `CallPill`, `CallScreen`, меню, оболочка |
| `client/electron/{main,preload}.ts` | `flashFrame` |

---

### Task 1: Домен, миграция 028, репозиторий звонков

**Files:**
- Modify: `server/internal/domain/call.go` (переписать целиком)
- Modify: `server/internal/domain/errors.go` (добавить 4 ошибки)
- Create: `server/migrations/028_direct_calls.up.sql`, `server/migrations/028_direct_calls.down.sql`
- Modify: `server/internal/repository/postgres/call.go` (переписать целиком)
- Test: `server/internal/repository/postgres/call_integration_test.go`

**Interfaces:**
- Produces (используют Task 2–5):
  ```go
  type CallRepository interface {
      Create(call *Call) error
      GetByID(id uuid.UUID) (*Call, error)               // ErrCallNotFound
      ListLiveByUser(userID uuid.UUID) ([]*Call, error)  // ringing|active, новые первыми; пусто — nil, nil
      Transition(id uuid.UUID, from []CallStatus, to CallStatus, at time.Time) (bool, error)
      CloseAllLive(at time.Time) (int64, error)
      Exists(id uuid.UUID) (bool, error)
  }
  ```
  Плюс типы `Call`, `CallStatus`, `CallEndReason`, `CallParty`, `CallSnapshot`, порты `CallNotifier`, `CallPresence`, `CallPermission`, `CallUserLookup`, интерфейс `CallUseCase` (ниже).

- [ ] **Step 1: Переписать `server/internal/domain/call.go`**

```go
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Call — личный звонок 1:1 (VYC-103). Медиа идёт через комнату SFU с
// room_id = ID; жизненным циклом владеет CallUseCase, SFU о звонке не знает.
type Call struct {
	ID         uuid.UUID
	CallerID   uuid.UUID
	ReceiverID uuid.UUID
	Status     CallStatus
	StartedAt  time.Time
	AcceptedAt *time.Time
	EndedAt    *time.Time
}

// Has — участвует ли userID в звонке.
func (c *Call) Has(userID uuid.UUID) bool {
	return c.CallerID == userID || c.ReceiverID == userID
}

// Peer — собеседник userID. Для не-участника возвращает uuid.Nil.
func (c *Call) Peer(userID uuid.UUID) uuid.UUID {
	switch userID {
	case c.CallerID:
		return c.ReceiverID
	case c.ReceiverID:
		return c.CallerID
	}
	return uuid.Nil
}

type CallStatus string

const (
	CallStatusRinging  CallStatus = "ringing"
	CallStatusActive   CallStatus = "active"
	CallStatusEnded    CallStatus = "ended"
	CallStatusMissed   CallStatus = "missed"
	CallStatusRejected CallStatus = "rejected"
)

// Live — звонок ещё идёт или звонит.
func (s CallStatus) Live() bool { return s == CallStatusRinging || s == CallStatusActive }

// CallEndReason — причина в событии call_ended. Это не статус в БД:
// timeout и missed оба пишутся как missed, failed — как ended.
type CallEndReason string

const (
	CallEndEnded    CallEndReason = "ended"
	CallEndMissed   CallEndReason = "missed"
	CallEndTimeout  CallEndReason = "timeout"
	CallEndRejected CallEndReason = "rejected"
	CallEndFailed   CallEndReason = "failed"
)

// CallParty — участник звонка в событиях: клиенту не нужен отдельный запрос.
type CallParty struct {
	ID        uuid.UUID `json:"id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
}

// CallSnapshot — состояние звонка в call_ringing / call_state.
type CallSnapshot struct {
	CallID   uuid.UUID  `json:"call_id"`
	Status   CallStatus `json:"status"`
	Caller   CallParty  `json:"caller"`
	Receiver CallParty  `json:"receiver"`
}

type CallRepository interface {
	Create(call *Call) error
	// GetByID возвращает ErrCallNotFound, если строки нет.
	GetByID(id uuid.UUID) (*Call, error)
	// ListLiveByUser — ringing/active звонки пользователя с любой стороны,
	// новые первыми. Нет звонков — nil, nil.
	ListLiveByUser(userID uuid.UUID) ([]*Call, error)
	// Transition — условный переход: меняет статус, только если текущий входит
	// в from. false — гонку выиграл кто-то другой. Ставит accepted_at при
	// переходе в active и ended_at при переходе в завершающий статус.
	Transition(id uuid.UUID, from []CallStatus, to CallStatus, at time.Time) (bool, error)
	// CloseAllLive закрывает висящие звонки при старте API: ringing → missed,
	// active → ended. Возвращает число закрытых.
	CloseAllLive(at time.Time) (int64, error)
	// Exists — есть ли звонок с таким id в любом статусе.
	Exists(id uuid.UUID) (bool, error)
}

// CallNotifier доставляет событие пользователю (адаптер хаба).
type CallNotifier interface {
	Notify(userID uuid.UUID, msgType string, payload any)
}

// CallPresence — онлайн ли пользователь (хаб).
type CallPresence interface {
	IsOnline(userID uuid.UUID) bool
}

// CallPermission — те же правила, что у ЛС (friendUseCase.CanDM).
type CallPermission interface {
	CanDM(fromID, toID uuid.UUID) error
}

// CallUserLookup — имя и аватар участника (userRepo).
type CallUserLookup interface {
	GetByID(id uuid.UUID) (*User, error)
}

type CallUseCase interface {
	Start(callerID, receiverID uuid.UUID) (*Call, error)
	Accept(userID, callID uuid.UUID) error
	Reject(userID, callID uuid.UUID) error
	// End — «Завершить» или отмена при дозвоне. reason из клиента: ended | failed.
	End(userID, callID uuid.UUID, reason CallEndReason) error
	// OnConnect снимает grace-таймер и возвращает снимок живого звонка
	// пользователя (nil — звонка нет). Снимок отправляет вызывающий.
	OnConnect(userID uuid.UUID) *CallSnapshot
	// OnDisconnect — последний WS пользователя закрылся.
	OnDisconnect(userID uuid.UUID)
	// IssueRoomToken — room-токен SFU для участника активного звонка.
	IssueRoomToken(userID, callID uuid.UUID) (string, error)
	// IsCallRoom — комната SFU принадлежит звонку 1:1 (для presence-воркера).
	IsCallRoom(roomID uuid.UUID) bool
	// RecoverOnStartup закрывает звонки, пережившие рестарт (таймеры в памяти).
	RecoverOnStartup() error
}
```

- [ ] **Step 2: Добавить ошибки в `server/internal/domain/errors.go`** (внутрь блока `var (`, рядом с `ErrUserNotFound`)

```go
	// ErrCallNotFound — звонка нет или вызывающий в нём не участник
	// (неразличимо наружу: не раскрываем чужие звонки).
	ErrCallNotFound = errors.New("call not found")
	// ErrCallInvalidState — переход недопустим из текущего статуса (звонок
	// уже принят, отклонён, завершён, истёк таймаут).
	ErrCallInvalidState = errors.New("call invalid state")
	// ErrCallPeerOffline — получатель не в сети.
	ErrCallPeerOffline = errors.New("call peer offline")
	// ErrCallBusy — у получателя уже звонит другой вызов.
	ErrCallBusy = errors.New("call peer busy")
```

- [ ] **Step 3: Миграция**

`server/migrations/028_direct_calls.up.sql`:
```sql
-- +migrate Up
-- VYC-103: звонки 1:1 через SFU. Звонки, висящие с эпохи P2P, закрываются:
-- новые таймеры живут в памяти API и про них не знают.
UPDATE calls SET status = 'missed', ended_at = NOW() WHERE status = 'ringing';
UPDATE calls SET status = 'ended',  ended_at = NOW() WHERE status = 'active';
-- Момент ответа — для длительности звонка в будущих личках (VYC-91).
ALTER TABLE calls ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
```

`server/migrations/028_direct_calls.down.sql`:
```sql
-- +migrate Down
ALTER TABLE calls DROP COLUMN IF EXISTS accepted_at;
```

(Каждый оператор — одна строка без `;` внутри: харнесс и `cmd/migrate` режут файл по `;`.)

- [ ] **Step 4: Написать падающий интеграционный тест** `server/internal/repository/postgres/call_integration_test.go`

```go
package postgres_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

func newRingingCall(caller, receiver uuid.UUID) *domain.Call {
	return &domain.Call{
		ID: uuid.New(), CallerID: caller, ReceiverID: receiver,
		Status: domain.CallStatusRinging, StartedAt: time.Now().UTC(),
	}
}

func TestCallRepository_Lifecycle(t *testing.T) {
	pool := openIntegrationDB(t)
	repo := postgres.NewCallRepository(pool)
	a, b := seedUser(t, pool), seedUser(t, pool)

	// Без звонков — nil, nil, а не ошибка (регрессия pgx.ErrNoRows).
	live, err := repo.ListLiveByUser(a)
	require.NoError(t, err)
	assert.Empty(t, live)

	_, err = repo.GetByID(uuid.New())
	assert.ErrorIs(t, err, domain.ErrCallNotFound)

	call := newRingingCall(a, b)
	require.NoError(t, repo.Create(call))

	ok, err := repo.Exists(call.ID)
	require.NoError(t, err)
	assert.True(t, ok)

	live, err = repo.ListLiveByUser(b)
	require.NoError(t, err)
	require.Len(t, live, 1)
	assert.Equal(t, call.ID, live[0].ID)

	now := time.Now().UTC()
	moved, err := repo.Transition(call.ID, []domain.CallStatus{domain.CallStatusRinging}, domain.CallStatusActive, now)
	require.NoError(t, err)
	assert.True(t, moved)

	// Повтор того же перехода проигрывает: статус уже active.
	moved, err = repo.Transition(call.ID, []domain.CallStatus{domain.CallStatusRinging}, domain.CallStatusActive, now)
	require.NoError(t, err)
	assert.False(t, moved)

	got, err := repo.GetByID(call.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.CallStatusActive, got.Status)
	require.NotNil(t, got.AcceptedAt)
	assert.Nil(t, got.EndedAt)

	moved, err = repo.Transition(call.ID, []domain.CallStatus{domain.CallStatusActive}, domain.CallStatusEnded, now)
	require.NoError(t, err)
	assert.True(t, moved)
	got, err = repo.GetByID(call.ID)
	require.NoError(t, err)
	require.NotNil(t, got.EndedAt)

	live, err = repo.ListLiveByUser(a)
	require.NoError(t, err)
	assert.Empty(t, live)
}

func TestCallRepository_CloseAllLive(t *testing.T) {
	pool := openIntegrationDB(t)
	repo := postgres.NewCallRepository(pool)
	a, b, c := seedUser(t, pool), seedUser(t, pool), seedUser(t, pool)

	ringing := newRingingCall(a, b)
	require.NoError(t, repo.Create(ringing))
	active := newRingingCall(c, a)
	require.NoError(t, repo.Create(active))
	_, err := repo.Transition(active.ID, []domain.CallStatus{domain.CallStatusRinging}, domain.CallStatusActive, time.Now())
	require.NoError(t, err)

	n, err := repo.CloseAllLive(time.Now())
	require.NoError(t, err)
	assert.EqualValues(t, 2, n)

	got, _ := repo.GetByID(ringing.ID)
	assert.Equal(t, domain.CallStatusMissed, got.Status)
	got, _ = repo.GetByID(active.ID)
	assert.Equal(t, domain.CallStatusEnded, got.Status)
}
```

- [ ] **Step 5: Убедиться, что не компилируется**

Run: `cd server && go vet ./internal/repository/postgres/`
Expected: ошибки компиляции (`ListLiveByUser`, `Transition`, `CloseAllLive`, `Exists` не определены; usecase/handler тоже не собираются — это нормально до Task 2/4).

- [ ] **Step 6: Переписать `server/internal/repository/postgres/call.go`**

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

type callRepository struct {
	db *pgxpool.Pool
}

func NewCallRepository(db *pgxpool.Pool) domain.CallRepository {
	return &callRepository{db: db}
}

const callColumns = `id, caller_id, receiver_id, status, started_at, accepted_at, ended_at`

func scanCall(row pgx.Row) (*domain.Call, error) {
	c := &domain.Call{}
	err := row.Scan(&c.ID, &c.CallerID, &c.ReceiverID, &c.Status, &c.StartedAt, &c.AcceptedAt, &c.EndedAt)
	return c, err
}

func (r *callRepository) Create(call *domain.Call) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := r.db.Exec(ctx,
		`INSERT INTO calls (id, caller_id, receiver_id, status, started_at) VALUES ($1, $2, $3, $4, $5)`,
		call.ID, call.CallerID, call.ReceiverID, call.Status, call.StartedAt)
	if err != nil {
		return fmt.Errorf("create call: %w", err)
	}
	return nil
}

func (r *callRepository) GetByID(id uuid.UUID) (*domain.Call, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, err := scanCall(r.db.QueryRow(ctx, `SELECT `+callColumns+` FROM calls WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrCallNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get call: %w", err)
	}
	return c, nil
}

func (r *callRepository) ListLiveByUser(userID uuid.UUID) ([]*domain.Call, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := r.db.Query(ctx, `
		SELECT `+callColumns+` FROM calls
		WHERE (caller_id = $1 OR receiver_id = $1) AND status IN ('ringing', 'active')
		ORDER BY started_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list live calls: %w", err)
	}
	defer rows.Close()
	var out []*domain.Call
	for rows.Next() {
		c, err := scanCall(rows)
		if err != nil {
			return nil, fmt.Errorf("scan live call: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *callRepository) Transition(id uuid.UUID, from []domain.CallStatus, to domain.CallStatus, at time.Time) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	fromStr := make([]string, len(from))
	for i, s := range from {
		fromStr[i] = string(s)
	}
	tag, err := r.db.Exec(ctx, `
		UPDATE calls SET
			status      = $2,
			accepted_at = CASE WHEN $2 = 'active' THEN $4 ELSE accepted_at END,
			ended_at    = CASE WHEN $2 IN ('ended', 'missed', 'rejected') THEN $4 ELSE ended_at END
		WHERE id = $1 AND status = ANY($3)`, id, string(to), fromStr, at)
	if err != nil {
		return false, fmt.Errorf("transition call: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

func (r *callRepository) CloseAllLive(at time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tag, err := r.db.Exec(ctx, `
		UPDATE calls SET
			status   = CASE WHEN status = 'ringing' THEN 'missed' ELSE 'ended' END,
			ended_at = $1
		WHERE status IN ('ringing', 'active')`, at)
	if err != nil {
		return 0, fmt.Errorf("close live calls: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (r *callRepository) Exists(id uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var ok bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM calls WHERE id = $1)`, id).Scan(&ok); err != nil {
		return false, fmt.Errorf("call exists: %w", err)
	}
	return ok, nil
}
```

- [ ] **Step 7: Проверить пакет репозитория**

Run: `cd server && go vet ./internal/repository/postgres/ ./internal/domain/ && go test ./internal/repository/postgres/ -run TestCallRepository -v`
Expected: vet чистый; тесты `SKIP` без `VYCORD_TEST_DSN` (или `PASS` с ним — запустить, если Postgres доступен). Пакеты `usecase`/`handler` пока не собираются — их чинят Task 2 и 4.

- [ ] **Step 8: Checkpoint** — `git status`, показать пользователю список файлов задачи; коммит делает пользователь.

---

### Task 2: `CallUseCase` — Start / Accept / Reject / End

**Files:**
- Create: `server/internal/usecase/callclock.go`
- Modify: `server/internal/usecase/call.go` (переписать целиком)
- Create: `server/internal/usecase/call_mocks_test.go`
- Create: `server/internal/usecase/call_test.go`

**Interfaces:**
- Consumes: Task 1 (`domain.CallRepository`, порты, ошибки).
- Produces:
  ```go
  type Clock interface { Now() time.Time; AfterFunc(d time.Duration, f func()) Stopper }
  type Stopper interface { Stop() bool }
  type CallDeps struct {
      Repo domain.CallRepository; Notifier domain.CallNotifier; Presence domain.CallPresence
      Permission domain.CallPermission; Users domain.CallUserLookup; Clock Clock; JWTSecret string
  }
  const CallRingTimeout = 45 * time.Second
  const CallDisconnectGrace = 20 * time.Second
  func NewCallUseCase(d CallDeps) domain.CallUseCase
  ```
  События (`Notify(userID, type, payload)`), которые читает клиент (Task 7):
  - `call_ringing` → `domain.CallSnapshot`
  - `call_accepted` → `{"call_id": "<uuid>"}`
  - `call_ended` → `{"call_id": "<uuid>", "reason": "ended|missed|timeout|rejected|failed"}`

Правила (из спеки + поправка 1):
- `Start`: `CanDM` → онлайн → (встречный ringing receiver→caller ⇒ `Accept`) → (живой звонок той же пары ⇒ вернуть его) → у получателя другой `ringing` ⇒ `ErrCallBusy` → живые звонки звонящего с другими завершаются → создать `ringing`, таймер 45 с, `call_ringing` обоим.
- `Accept`: только получатель, только `ringing`; живые звонки получателя с другими завершаются; `active`, `call_accepted` обоим.
- `Reject`: только получатель, `ringing` → `rejected`, `call_ended{rejected}` обоим.
- `End`: участник; `ringing` у звонящего → `missed` (`reason: missed`), у получателя — как `Reject`; `active` → `ended` (`reason`: `ended` или `failed`).
- «Завершить другие звонки» (`finishLocked`): `ringing` — получатель ⇒ `rejected`, звонящий ⇒ `missed`; `active` ⇒ `ended`; событие `call_ended` обоим участникам того звонка.

- [ ] **Step 1: `server/internal/usecase/callclock.go`**

```go
package usecase

import "time"

// Clock — источник времени и таймеров CallUseCase; в тестах подменяется
// фейком, чтобы 45 с дозвона и 20 с grace проверялись без ожидания.
type Clock interface {
	Now() time.Time
	AfterFunc(d time.Duration, f func()) Stopper
}

// Stopper — то, что умеет *time.Timer.
type Stopper interface {
	Stop() bool
}

type realClock struct{}

// RealClock — системные часы.
func RealClock() Clock { return realClock{} }

func (realClock) Now() time.Time { return time.Now().UTC() }

func (realClock) AfterFunc(d time.Duration, f func()) Stopper { return time.AfterFunc(d, f) }
```

- [ ] **Step 2: Моки и фейковые часы `server/internal/usecase/call_mocks_test.go`**

```go
package usecase_test

import (
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

// memCallRepo — честная in-memory реализация CallRepository: тестам машины
// состояний важна семантика условных переходов, а не вызовы мока.
type memCallRepo struct {
	mu    sync.Mutex
	calls map[uuid.UUID]*domain.Call
}

func newMemCallRepo() *memCallRepo { return &memCallRepo{calls: map[uuid.UUID]*domain.Call{}} }

func (r *memCallRepo) Create(c *domain.Call) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *c
	r.calls[c.ID] = &cp
	return nil
}

func (r *memCallRepo) GetByID(id uuid.UUID) (*domain.Call, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.calls[id]
	if !ok {
		return nil, domain.ErrCallNotFound
	}
	cp := *c
	return &cp, nil
}

func (r *memCallRepo) ListLiveByUser(u uuid.UUID) ([]*domain.Call, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*domain.Call
	for _, c := range r.calls {
		if c.Has(u) && c.Status.Live() {
			cp := *c
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out, nil
}

func (r *memCallRepo) Transition(id uuid.UUID, from []domain.CallStatus, to domain.CallStatus, at time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.calls[id]
	if !ok {
		return false, nil
	}
	for _, s := range from {
		if c.Status == s {
			c.Status = to
			if to == domain.CallStatusActive {
				c.AcceptedAt = &at
			} else if !to.Live() {
				c.EndedAt = &at
			}
			return true, nil
		}
	}
	return false, nil
}

func (r *memCallRepo) CloseAllLive(at time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var n int64
	for _, c := range r.calls {
		switch c.Status {
		case domain.CallStatusRinging:
			c.Status, c.EndedAt, n = domain.CallStatusMissed, &at, n+1
		case domain.CallStatusActive:
			c.Status, c.EndedAt, n = domain.CallStatusEnded, &at, n+1
		}
	}
	return n, nil
}

func (r *memCallRepo) Exists(id uuid.UUID) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.calls[id]
	return ok, nil
}

func (r *memCallRepo) status(id uuid.UUID) domain.CallStatus {
	c, _ := r.GetByID(id)
	return c.Status
}

type sentEvent struct {
	To      uuid.UUID
	Type    string
	Payload any
}

type recNotifier struct {
	mu     sync.Mutex
	events []sentEvent
}

func (n *recNotifier) Notify(to uuid.UUID, t string, p any) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.events = append(n.events, sentEvent{to, t, p})
}

// of — события типа t, адресованные to.
func (n *recNotifier) of(to uuid.UUID, t string) []sentEvent {
	n.mu.Lock()
	defer n.mu.Unlock()
	var out []sentEvent
	for _, e := range n.events {
		if e.To == to && e.Type == t {
			out = append(out, e)
		}
	}
	return out
}

func (n *recNotifier) reset() {
	n.mu.Lock()
	n.events = nil
	n.mu.Unlock()
}

type setPresence struct {
	mu     sync.Mutex
	online map[uuid.UUID]bool
}

func (p *setPresence) IsOnline(u uuid.UUID) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.online[u]
}

func (p *setPresence) set(u uuid.UUID, on bool) {
	p.mu.Lock()
	p.online[u] = on
	p.mu.Unlock()
}

type denyList struct{ denied map[[2]uuid.UUID]error }

func (d denyList) CanDM(from, to uuid.UUID) error {
	if from == to {
		return domain.ErrSelfFriendship
	}
	return d.denied[[2]uuid.UUID{from, to}]
}

type usersByID struct{}

func (usersByID) GetByID(id uuid.UUID) (*domain.User, error) {
	return &domain.User{ID: id, Username: "u-" + id.String()[:4]}, nil
}

// fakeClock: AfterFunc копит таймеры, Advance срабатывает наступившие —
// вне собственной блокировки, потому что f берёт мьютекс usecase.
type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}

type fakeTimer struct {
	at      time.Time
	f       func()
	stopped bool
	fired   bool
}

func (t *fakeTimer) Stop() bool {
	was := !t.stopped && !t.fired
	t.stopped = true
	return was
}

func newFakeClock() *fakeClock { return &fakeClock{now: time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) usecase.Stopper {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{at: c.now.Add(d), f: f}
	c.timers = append(c.timers, t)
	return t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	var due []*fakeTimer
	for _, t := range c.timers {
		if !t.stopped && !t.fired && !t.at.After(c.now) {
			t.fired = true
			due = append(due, t)
		}
	}
	c.mu.Unlock()
	for _, t := range due {
		t.f()
	}
}

type callEnv struct {
	uc       domain.CallUseCase
	repo     *memCallRepo
	notes    *recNotifier
	presence *setPresence
	clock    *fakeClock
	deny     denyList
}

func newCallEnv(online ...uuid.UUID) *callEnv {
	env := &callEnv{
		repo:     newMemCallRepo(),
		notes:    &recNotifier{},
		presence: &setPresence{online: map[uuid.UUID]bool{}},
		clock:    newFakeClock(),
		deny:     denyList{denied: map[[2]uuid.UUID]error{}},
	}
	for _, u := range online {
		env.presence.set(u, true)
	}
	env.uc = usecase.NewCallUseCase(usecase.CallDeps{
		Repo: env.repo, Notifier: env.notes, Presence: env.presence,
		Permission: env.deny, Users: usersByID{}, Clock: env.clock, JWTSecret: "test-secret",
	})
	return env
}

func endReason(e sentEvent) domain.CallEndReason {
	return e.Payload.(map[string]any)["reason"].(domain.CallEndReason)
}
```

- [ ] **Step 3: Написать падающие тесты `server/internal/usecase/call_test.go`**

```go
package usecase_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
)

func TestCallStart_RingsBothParties(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)

	call, err := env.uc.Start(a, b)
	require.NoError(t, err)
	assert.Equal(t, domain.CallStatusRinging, env.repo.status(call.ID))

	for _, u := range []uuid.UUID{a, b} {
		evs := env.notes.of(u, "call_ringing")
		require.Len(t, evs, 1, "call_ringing обоим")
		snap := evs[0].Payload.(domain.CallSnapshot)
		assert.Equal(t, call.ID, snap.CallID)
		assert.Equal(t, a, snap.Caller.ID)
		assert.Equal(t, b, snap.Receiver.ID)
		assert.NotEmpty(t, snap.Caller.Username)
	}
}

func TestCallStart_Forbidden(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	env.deny.denied[[2]uuid.UUID{a, b}] = domain.ErrInteractionForbidden

	_, err := env.uc.Start(a, b)
	assert.ErrorIs(t, err, domain.ErrInteractionForbidden)
	assert.Empty(t, env.notes.of(b, "call_ringing"))
}

func TestCallStart_Self(t *testing.T) {
	a := uuid.New()
	env := newCallEnv(a)
	_, err := env.uc.Start(a, a)
	assert.ErrorIs(t, err, domain.ErrSelfFriendship)
}

func TestCallStart_ReceiverOffline(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a)
	_, err := env.uc.Start(a, b)
	assert.ErrorIs(t, err, domain.ErrCallPeerOffline)
}

func TestCallStart_Idempotent(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	first, err := env.uc.Start(a, b)
	require.NoError(t, err)
	second, err := env.uc.Start(a, b)
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
}

func TestCallStart_CrossCallAcceptsExisting(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	first, err := env.uc.Start(a, b)
	require.NoError(t, err)

	second, err := env.uc.Start(b, a) // встречный вызов
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(first.ID))
	assert.Len(t, env.notes.of(a, "call_accepted"), 1)
}

func TestCallStart_ReceiverAlreadyRinging_Busy(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, c)
	_, err := env.uc.Start(a, b)
	require.NoError(t, err)

	_, err = env.uc.Start(c, b)
	assert.ErrorIs(t, err, domain.ErrCallBusy)
}

func TestCallStart_ReceiverInActiveCall_StillRings(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, c)
	ab, err := env.uc.Start(a, b)
	require.NoError(t, err)
	require.NoError(t, env.uc.Accept(b, ab.ID))

	cb, err := env.uc.Start(c, b)
	require.NoError(t, err, "занятый активным звонком всё равно получает вызов")
	assert.Equal(t, domain.CallStatusRinging, env.repo.status(cb.ID))
	assert.Equal(t, domain.CallStatusActive, env.repo.status(ab.ID))
}

func TestCallStart_CallerSwitchesAwayFromActiveCall(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, c)
	ab, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, ab.ID))
	env.notes.reset()

	_, err := env.uc.Start(a, c)
	require.NoError(t, err)
	assert.Equal(t, domain.CallStatusEnded, env.repo.status(ab.ID))
	evs := env.notes.of(b, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndEnded, endReason(evs[0]))
}

func TestCallAccept_OnlyReceiver(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	assert.ErrorIs(t, env.uc.Accept(a, call.ID), domain.ErrCallNotFound)
	assert.ErrorIs(t, env.uc.Accept(uuid.New(), call.ID), domain.ErrCallNotFound)
	require.NoError(t, env.uc.Accept(b, call.ID))
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))
	assert.Len(t, env.notes.of(a, "call_accepted"), 1)
	assert.Len(t, env.notes.of(b, "call_accepted"), 1)

	assert.ErrorIs(t, env.uc.Accept(b, call.ID), domain.ErrCallInvalidState, "повторный accept")
}

func TestCallAccept_SwitchesReceiverAwayFromActiveCall(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, c)
	ab, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, ab.ID))
	cb, _ := env.uc.Start(c, b)
	env.notes.reset()

	require.NoError(t, env.uc.Accept(b, cb.ID))
	assert.Equal(t, domain.CallStatusEnded, env.repo.status(ab.ID))
	assert.Equal(t, domain.CallStatusActive, env.repo.status(cb.ID))
	require.Len(t, env.notes.of(a, "call_ended"), 1)
}

func TestCallReject(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	assert.ErrorIs(t, env.uc.Reject(a, call.ID), domain.ErrCallNotFound, "звонящий не отклоняет")
	require.NoError(t, env.uc.Reject(b, call.ID))
	assert.Equal(t, domain.CallStatusRejected, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndRejected, endReason(evs[0]))
}

func TestCallEnd_CallerCancelsWhileRinging_IsMissed(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	require.NoError(t, env.uc.End(a, call.ID, domain.CallEndEnded))
	assert.Equal(t, domain.CallStatusMissed, env.repo.status(call.ID))
	evs := env.notes.of(b, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndMissed, endReason(evs[0]))
}

func TestCallEnd_ActiveByEitherSide(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	require.NoError(t, env.uc.End(b, call.ID, domain.CallEndFailed))
	assert.Equal(t, domain.CallStatusEnded, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndFailed, endReason(evs[0]))

	assert.ErrorIs(t, env.uc.End(a, call.ID, domain.CallEndEnded), domain.ErrCallInvalidState)
}

func TestCallEnd_UnknownReasonBecomesEnded(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	require.NoError(t, env.uc.End(a, call.ID, domain.CallEndReason("timeout")))
	evs := env.notes.of(b, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndEnded, endReason(evs[0]), "клиент не может прислать серверную причину")
}
```

- [ ] **Step 4: Убедиться, что падают**

Run: `cd server && go test ./internal/usecase/ -run 'TestCall(Start|Accept|Reject|End)' -v`
Expected: FAIL компиляции (`NewCallUseCase(usecase.CallDeps{...})`, `usecase.Stopper` не существуют).

- [ ] **Step 5: Переписать `server/internal/usecase/call.go`** (таймеры OnConnect/OnDisconnect/IssueRoomToken/IsCallRoom/RecoverOnStartup — заглушки, которые доделывает Task 3; здесь — полные Start/Accept/Reject/End)

```go
package usecase

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/authtoken"
)

const (
	// CallRingTimeout — сколько звонит вызов до missed (спека, решение 6).
	CallRingTimeout = 45 * time.Second
	// CallDisconnectGrace — сколько активный звонок ждёт участника, у которого
	// оборвался WS с API (спека, раздел 1).
	CallDisconnectGrace = 20 * time.Second
	callRoomTokenTTL    = 60 * time.Second
)

type CallDeps struct {
	Repo       domain.CallRepository
	Notifier   domain.CallNotifier
	Presence   domain.CallPresence
	Permission domain.CallPermission
	Users      domain.CallUserLookup
	Clock      Clock
	JWTSecret  string
}

// callUseCase — машина состояний звонка 1:1. Все публичные методы и
// срабатывания таймеров идут под одним mu: API — один процесс, звонков мало,
// а сериализация снимает целый класс гонок (встречные вызовы, accept против
// таймаута). Условные переходы в БД — вторая линия обороны.
type callUseCase struct {
	d  CallDeps
	mu sync.Mutex

	ringTimers  map[uuid.UUID]Stopper // call_id → таймер дозвона
	graceTimers map[uuid.UUID]Stopper // user_id → grace обрыва
	knownRooms  map[uuid.UUID]bool    // call_id → это комната звонка (кэш IsCallRoom)
}

func NewCallUseCase(d CallDeps) domain.CallUseCase {
	if d.Clock == nil {
		d.Clock = RealClock()
	}
	return &callUseCase{
		d:           d,
		ringTimers:  map[uuid.UUID]Stopper{},
		graceTimers: map[uuid.UUID]Stopper{},
		knownRooms:  map[uuid.UUID]bool{},
	}
}

func (uc *callUseCase) Start(callerID, receiverID uuid.UUID) (*domain.Call, error) {
	uc.mu.Lock()
	defer uc.mu.Unlock()

	if err := uc.d.Permission.CanDM(callerID, receiverID); err != nil {
		return nil, err
	}
	if !uc.d.Presence.IsOnline(receiverID) {
		return nil, domain.ErrCallPeerOffline
	}

	callerLive, err := uc.d.Repo.ListLiveByUser(callerID)
	if err != nil {
		return nil, err
	}
	for _, c := range callerLive {
		if !c.Has(receiverID) {
			continue
		}
		if c.Status == domain.CallStatusRinging && c.ReceiverID == callerID {
			// Встречный вызов: B звонит A, пока A звонит B — это согласие.
			if err := uc.acceptLocked(callerID, c); err != nil {
				return nil, err
			}
			return c, nil
		}
		return c, nil // повторное «Позвонить» тому же — тот же звонок
	}

	receiverLive, err := uc.d.Repo.ListLiveByUser(receiverID)
	if err != nil {
		return nil, err
	}
	for _, c := range receiverLive {
		if c.Status == domain.CallStatusRinging {
			return nil, domain.ErrCallBusy
		}
	}

	// «Позвонить» выводит звонящего из его текущих звонков (решение 5).
	for _, c := range callerLive {
		if err := uc.finishLocked(c, callerID, domain.CallEndEnded); err != nil {
			return nil, err
		}
	}

	call := &domain.Call{
		ID:         uuid.New(),
		CallerID:   callerID,
		ReceiverID: receiverID,
		Status:     domain.CallStatusRinging,
		StartedAt:  uc.d.Clock.Now(),
	}
	if err := uc.d.Repo.Create(call); err != nil {
		return nil, err
	}
	uc.knownRooms[call.ID] = true
	callID := call.ID
	uc.ringTimers[callID] = uc.d.Clock.AfterFunc(CallRingTimeout, func() { uc.onRingTimeout(callID) })

	snap, err := uc.snapshot(call)
	if err != nil {
		return nil, err
	}
	uc.d.Notifier.Notify(callerID, "call_ringing", *snap)
	uc.d.Notifier.Notify(receiverID, "call_ringing", *snap)
	return call, nil
}

func (uc *callUseCase) Accept(userID, callID uuid.UUID) error {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	call, err := uc.ownCall(userID, callID)
	if err != nil {
		return err
	}
	if call.ReceiverID != userID {
		return domain.ErrCallNotFound
	}
	return uc.acceptLocked(userID, call)
}

func (uc *callUseCase) acceptLocked(receiverID uuid.UUID, call *domain.Call) error {
	if call.Status != domain.CallStatusRinging {
		return domain.ErrCallInvalidState
	}
	// «Принять» выводит получателя из его текущих звонков (решение 5).
	live, err := uc.d.Repo.ListLiveByUser(receiverID)
	if err != nil {
		return err
	}
	for _, c := range live {
		if c.ID != call.ID {
			if err := uc.finishLocked(c, receiverID, domain.CallEndEnded); err != nil {
				return err
			}
		}
	}
	ok, err := uc.d.Repo.Transition(call.ID, []domain.CallStatus{domain.CallStatusRinging}, domain.CallStatusActive, uc.d.Clock.Now())
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrCallInvalidState
	}
	uc.stopRing(call.ID)
	call.Status = domain.CallStatusActive
	payload := map[string]any{"call_id": call.ID.String()}
	uc.d.Notifier.Notify(call.CallerID, "call_accepted", payload)
	uc.d.Notifier.Notify(call.ReceiverID, "call_accepted", payload)
	return nil
}

func (uc *callUseCase) Reject(userID, callID uuid.UUID) error {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	call, err := uc.ownCall(userID, callID)
	if err != nil {
		return err
	}
	if call.ReceiverID != userID {
		return domain.ErrCallNotFound
	}
	if call.Status != domain.CallStatusRinging {
		return domain.ErrCallInvalidState
	}
	return uc.finishLocked(call, userID, domain.CallEndRejected)
}

func (uc *callUseCase) End(userID, callID uuid.UUID, reason domain.CallEndReason) error {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	call, err := uc.ownCall(userID, callID)
	if err != nil {
		return err
	}
	if !call.Status.Live() {
		return domain.ErrCallInvalidState
	}
	if reason != domain.CallEndFailed {
		reason = domain.CallEndEnded // клиент не вправе прислать серверную причину
	}
	return uc.finishLocked(call, userID, reason)
}

// finishLocked завершает живой звонок от имени actor. Статус и причина
// выводятся из текущего статуса и стороны actor (см. план, Task 2).
func (uc *callUseCase) finishLocked(call *domain.Call, actor uuid.UUID, reason domain.CallEndReason) error {
	var to domain.CallStatus
	switch {
	case call.Status == domain.CallStatusRinging && actor == call.ReceiverID:
		to, reason = domain.CallStatusRejected, domain.CallEndRejected
	case call.Status == domain.CallStatusRinging:
		to = domain.CallStatusMissed
		if reason != domain.CallEndTimeout {
			reason = domain.CallEndMissed
		}
	default:
		to = domain.CallStatusEnded
	}
	ok, err := uc.d.Repo.Transition(call.ID, []domain.CallStatus{call.Status}, to, uc.d.Clock.Now())
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrCallInvalidState
	}
	uc.stopRing(call.ID)
	payload := map[string]any{"call_id": call.ID.String(), "reason": reason}
	uc.d.Notifier.Notify(call.CallerID, "call_ended", payload)
	uc.d.Notifier.Notify(call.ReceiverID, "call_ended", payload)
	return nil
}

// ownCall — звонок, в котором userID участник; чужой неотличим от несуществующего.
func (uc *callUseCase) ownCall(userID, callID uuid.UUID) (*domain.Call, error) {
	call, err := uc.d.Repo.GetByID(callID)
	if err != nil {
		return nil, err
	}
	if !call.Has(userID) {
		return nil, domain.ErrCallNotFound
	}
	return call, nil
}

func (uc *callUseCase) stopRing(callID uuid.UUID) {
	if t, ok := uc.ringTimers[callID]; ok {
		t.Stop()
		delete(uc.ringTimers, callID)
	}
}

func (uc *callUseCase) onRingTimeout(callID uuid.UUID) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	delete(uc.ringTimers, callID)
	call, err := uc.d.Repo.GetByID(callID)
	if err != nil || call.Status != domain.CallStatusRinging {
		return // уже приняли/отклонили/отменили — таймер опоздал
	}
	_ = uc.finishLocked(call, call.CallerID, domain.CallEndTimeout)
}

func (uc *callUseCase) snapshot(call *domain.Call) (*domain.CallSnapshot, error) {
	caller, err := uc.party(call.CallerID)
	if err != nil {
		return nil, err
	}
	receiver, err := uc.party(call.ReceiverID)
	if err != nil {
		return nil, err
	}
	return &domain.CallSnapshot{CallID: call.ID, Status: call.Status, Caller: caller, Receiver: receiver}, nil
}

func (uc *callUseCase) party(id uuid.UUID) (domain.CallParty, error) {
	u, err := uc.d.Users.GetByID(id)
	if err != nil {
		return domain.CallParty{}, fmt.Errorf("call party %s: %w", id, err)
	}
	return domain.CallParty{ID: u.ID, Username: u.Username, AvatarURL: u.AvatarURL}, nil
}

// --- Доделывает Task 3 ---

func (uc *callUseCase) OnConnect(userID uuid.UUID) *domain.CallSnapshot { return nil }
func (uc *callUseCase) OnDisconnect(userID uuid.UUID)                   {}
func (uc *callUseCase) IssueRoomToken(userID, callID uuid.UUID) (string, error) {
	return "", errors.New("not implemented")
}
func (uc *callUseCase) IsCallRoom(roomID uuid.UUID) bool { return false }
func (uc *callUseCase) RecoverOnStartup() error           { return nil }

var _ = authtoken.GenerateRoomToken // используется в Task 3
```

- [ ] **Step 6: Прогнать тесты**

Run: `cd server && go test ./internal/usecase/ -run 'TestCall(Start|Accept|Reject|End)' -v`
Expected: PASS все. (Пакет `handler` и `cmd/api` пока не собираются — чинит Task 4/5.)

- [ ] **Step 7: Checkpoint** — показать пользователю изменённые файлы.

---

### Task 3: `CallUseCase` — таймауты, grace, токен комнаты, восстановление

**Files:**
- Modify: `server/internal/usecase/call.go` (заменить блок «Доделывает Task 3»)
- Test: `server/internal/usecase/call_timers_test.go`

**Interfaces:**
- Consumes: Task 2 (`callUseCase`, `finishLocked`, `snapshot`, `knownRooms`, `graceTimers`), `authtoken.GenerateRoomToken(secret string, userID, roomID uuid.UUID, ttl time.Duration) (string, error)`, `authtoken.ValidateRoomToken(secret, token string) (uuid.UUID, uuid.UUID, error)`.
- Produces: рабочие `OnConnect`, `OnDisconnect`, `IssueRoomToken`, `IsCallRoom`, `RecoverOnStartup`.

Правила:
- `OnDisconnect(u)`: живые `ringing` пользователя завершаются сразу (`finishLocked(c, u, …)`: получатель ⇒ rejected… — **нет**: обрыв получателя при дозвоне — это `missed`, не отказ; поэтому для `ringing` всегда `finishLocked(c, c.CallerID, CallEndMissed)`). Для `active` — grace-таймер 20 с по `u` (повторный обрыв перезапускает).
- grace сработал: если `Presence.IsOnline(u)` — ничего; иначе все `active` пользователя → `finishLocked(c, u, CallEndEnded)`.
- `OnConnect(u)`: стоп grace; вернуть снимок первого живого звонка (`active` приоритетнее `ringing`) или `nil`.
- `IssueRoomToken`: `ownCall` + статус `active`, иначе `ErrCallInvalidState`; токен `GenerateRoomToken(secret, user, callID, 60s)`.
- `IsCallRoom`: кэш `knownRooms`, при промахе `Repo.Exists` и кэширование только положительного ответа.
- `RecoverOnStartup`: `Repo.CloseAllLive(now)`.

- [ ] **Step 1: Падающие тесты `server/internal/usecase/call_timers_test.go`**

```go
package usecase_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/authtoken"
)

func TestRingTimeout_Missed(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	env.clock.Advance(usecase.CallRingTimeout - time.Second)
	assert.Equal(t, domain.CallStatusRinging, env.repo.status(call.ID))

	env.clock.Advance(time.Second)
	assert.Equal(t, domain.CallStatusMissed, env.repo.status(call.ID))
	for _, u := range []uuid.UUID{a, b} {
		evs := env.notes.of(u, "call_ended")
		require.Len(t, evs, 1)
		assert.Equal(t, domain.CallEndTimeout, endReason(evs[0]))
	}
}

func TestRingTimeout_AfterAccept_NoOp(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	env.clock.Advance(usecase.CallRingTimeout * 2)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))
	assert.Empty(t, env.notes.of(a, "call_ended"))
}

func TestDisconnect_WhileRinging_EndsImmediately(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	env.presence.set(b, false)
	env.uc.OnDisconnect(b)
	assert.Equal(t, domain.CallStatusMissed, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndMissed, endReason(evs[0]))
}

func TestDisconnect_Active_GraceThenEnd(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	env.presence.set(b, false)
	env.uc.OnDisconnect(b)
	env.clock.Advance(usecase.CallDisconnectGrace - time.Second)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))

	env.clock.Advance(time.Second)
	assert.Equal(t, domain.CallStatusEnded, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndEnded, endReason(evs[0]))
}

func TestDisconnect_Active_ReconnectWithinGrace_KeepsCall(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	env.presence.set(b, false)
	env.uc.OnDisconnect(b)
	env.clock.Advance(10 * time.Second)
	env.presence.set(b, true)
	snap := env.uc.OnConnect(b)

	require.NotNil(t, snap, "реконнект возвращает снимок живого звонка")
	assert.Equal(t, call.ID, snap.CallID)
	assert.Equal(t, domain.CallStatusActive, snap.Status)

	env.clock.Advance(usecase.CallDisconnectGrace)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))
}

func TestOnConnect_NoCall_Nil(t *testing.T) {
	a := uuid.New()
	env := newCallEnv(a)
	assert.Nil(t, env.uc.OnConnect(a))
}

func TestIssueRoomToken(t *testing.T) {
	a, b, stranger := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	_, err := env.uc.IssueRoomToken(a, call.ID)
	assert.ErrorIs(t, err, domain.ErrCallInvalidState, "до ответа токена нет")

	require.NoError(t, env.uc.Accept(b, call.ID))
	_, err = env.uc.IssueRoomToken(stranger, call.ID)
	assert.ErrorIs(t, err, domain.ErrCallNotFound)

	tok, err := env.uc.IssueRoomToken(a, call.ID)
	require.NoError(t, err)
	uid, room, err := authtoken.ValidateRoomToken("test-secret", tok)
	require.NoError(t, err)
	assert.Equal(t, a, uid)
	assert.Equal(t, call.ID, room)
}

func TestIsCallRoom(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	assert.True(t, env.uc.IsCallRoom(call.ID))
	assert.False(t, env.uc.IsCallRoom(uuid.New()), "id канала — не комната звонка")
}

func TestRecoverOnStartup(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.RecoverOnStartup())
	assert.Equal(t, domain.CallStatusMissed, env.repo.status(call.ID))
}
```

Перед запуском свериться с сигнатурой: `grep -n "func ValidateRoomToken\|func GenerateRoomToken" server/pkg/authtoken/*.go` — если `ValidateRoomToken` возвращает другой порядок значений, поправить тест под неё (в `signaling/handler.go:40` вызывается как `uid, tokenRoomID, err := authtoken.ValidateRoomToken(h.jwtSecret, token)`).

- [ ] **Step 2: Убедиться, что падают**

Run: `cd server && go test ./internal/usecase/ -run 'TestRing|TestDisconnect|TestOnConnect|TestIssueRoomToken|TestIsCallRoom|TestRecover' -v`
Expected: FAIL (заглушки возвращают nil/false/ошибку).

- [ ] **Step 3: Заменить блок «Доделывает Task 3» в `call.go`** (и удалить строку `var _ = authtoken.GenerateRoomToken` и неиспользуемый импорт `errors`)

```go
func (uc *callUseCase) OnConnect(userID uuid.UUID) *domain.CallSnapshot {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	if t, ok := uc.graceTimers[userID]; ok {
		t.Stop()
		delete(uc.graceTimers, userID)
	}
	live, err := uc.d.Repo.ListLiveByUser(userID)
	if err != nil || len(live) == 0 {
		return nil
	}
	pick := live[0]
	for _, c := range live {
		if c.Status == domain.CallStatusActive {
			pick = c
			break
		}
	}
	snap, err := uc.snapshot(pick)
	if err != nil {
		return nil
	}
	return snap
}

func (uc *callUseCase) OnDisconnect(userID uuid.UUID) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	live, err := uc.d.Repo.ListLiveByUser(userID)
	if err != nil {
		return
	}
	hasActive := false
	for _, c := range live {
		if c.Status == domain.CallStatusRinging {
			// Обрыв во время дозвона — пропущенный, а не отказ: актор — звонящий.
			_ = uc.finishLocked(c, c.CallerID, domain.CallEndMissed)
			continue
		}
		hasActive = true
	}
	if !hasActive {
		return
	}
	if t, ok := uc.graceTimers[userID]; ok {
		t.Stop()
	}
	var timer Stopper
	timer = uc.d.Clock.AfterFunc(CallDisconnectGrace, func() { uc.onGraceExpired(userID, timer) })
	uc.graceTimers[userID] = timer
}

func (uc *callUseCase) onGraceExpired(userID uuid.UUID, timer Stopper) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	if uc.graceTimers[userID] != timer {
		return // реконнект снял или новый обрыв заменил этот таймер
	}
	delete(uc.graceTimers, userID)
	if uc.d.Presence.IsOnline(userID) {
		return
	}
	live, err := uc.d.Repo.ListLiveByUser(userID)
	if err != nil {
		return
	}
	for _, c := range live {
		if c.Status == domain.CallStatusActive {
			_ = uc.finishLocked(c, userID, domain.CallEndEnded)
		}
	}
}

func (uc *callUseCase) IssueRoomToken(userID, callID uuid.UUID) (string, error) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	call, err := uc.ownCall(userID, callID)
	if err != nil {
		return "", err
	}
	if call.Status != domain.CallStatusActive {
		return "", domain.ErrCallInvalidState
	}
	return authtoken.GenerateRoomToken(uc.d.JWTSecret, userID, callID, callRoomTokenTTL)
}

func (uc *callUseCase) IsCallRoom(roomID uuid.UUID) bool {
	uc.mu.Lock()
	known := uc.knownRooms[roomID]
	uc.mu.Unlock()
	if known {
		return true
	}
	ok, err := uc.d.Repo.Exists(roomID)
	if err != nil || !ok {
		// Ошибка БД — «не звонок»: худший исход — комната на тик попадёт в
		// presence как канал, аудитория которого не резолвится (fail-closed).
		return false
	}
	uc.mu.Lock()
	uc.knownRooms[roomID] = true
	uc.mu.Unlock()
	return true
}

func (uc *callUseCase) RecoverOnStartup() error {
	n, err := uc.d.Repo.CloseAllLive(uc.d.Clock.Now())
	if err != nil {
		return err
	}
	_ = n
	return nil
}
```

Примечание к `OnDisconnect`: `timer` захватывается замыканием до присваивания — это корректно, потому что `onGraceExpired` берёт `uc.mu`, а мы держим его до выхода из `OnDisconnect`, т.е. к моменту сравнения переменная уже присвоена.

- [ ] **Step 4: Прогнать весь пакет**

Run: `cd server && go test ./internal/usecase/ -v -run 'TestCall|TestRing|TestDisconnect|TestOnConnect|TestIssueRoomToken|TestIsCallRoom|TestRecover' && go vet ./internal/usecase/`
Expected: PASS, vet чистый.

- [ ] **Step 5: Тест гонок**

Run: `cd server && go test -race ./internal/usecase/ -run 'TestCall|TestRing|TestDisconnect'`
Expected: PASS без `DATA RACE`.

- [ ] **Step 6: Checkpoint.**

---

### Task 4: WS-протокол звонка и хуки connect/disconnect

**Files:**
- Create: `server/internal/delivery/ws/call_notifier.go`
- Modify: `server/internal/delivery/http/handler/websocket.go` (обработчики `call_*`, удаление `webrtc_*`, хуки в `HandleWebSocket`/`readPump`)
- Modify: `server/internal/delivery/http/handler/websocket_test.go` (новый `mockCallUseCase`, харнессы, тесты протокола)

**Interfaces:**
- Consumes: `domain.CallUseCase` (Task 1–3).
- Produces:
  - `ws.NewCallNotifier(h *Hub) *CallNotifier` с методом `Notify(userID uuid.UUID, msgType string, payload any)`.
  - Клиент → сервер: `call_start {receiver_id}`, `call_accept {call_id}`, `call_reject {call_id}`, `call_end {call_id, reason?}`.
  - Сервер → клиент: `call_error {code, call_id?}`, коды: `forbidden | offline | busy | not_found | invalid_state | internal`; `call_state {call: CallSnapshot | null}` при каждом WS-коннекте.

- [ ] **Step 1: `server/internal/delivery/ws/call_notifier.go`**

```go
package ws

import (
	"encoding/json"

	"github.com/google/uuid"
)

// CallNotifier — адаптер хаба под domain.CallNotifier: usecase звонков шлёт
// события сам (в том числе из таймеров), не зная про WebSocket.
type CallNotifier struct{ hub *Hub }

func NewCallNotifier(h *Hub) *CallNotifier { return &CallNotifier{hub: h} }

func (n *CallNotifier) Notify(userID uuid.UUID, msgType string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		n.hub.log.Error("call notifier: marshal payload", "type", msgType, "error", err)
		return
	}
	n.hub.SendToUser(userID, &Message{Type: msgType, Payload: data})
}
```

(Проверить, что у `Hub` поле логгера называется `log`: `grep -n "log \*slog.Logger\|log  *\*slog" server/internal/delivery/ws/hub.go`; если иначе — использовать его имя.)

- [ ] **Step 2: Заменить `mockCallUseCase` в `websocket_test.go`** (строки 114–131) на мок нового интерфейса и обновить оба харнесса

```go
type mockCallUseCase struct{ mock.Mock }

func (m *mockCallUseCase) Start(callerID, receiverID uuid.UUID) (*domain.Call, error) {
	args := m.Called(callerID, receiverID)
	c, _ := args.Get(0).(*domain.Call)
	return c, args.Error(1)
}
func (m *mockCallUseCase) Accept(userID, callID uuid.UUID) error { return m.Called(userID, callID).Error(0) }
func (m *mockCallUseCase) Reject(userID, callID uuid.UUID) error { return m.Called(userID, callID).Error(0) }
func (m *mockCallUseCase) End(userID, callID uuid.UUID, reason domain.CallEndReason) error {
	return m.Called(userID, callID, reason).Error(0)
}
func (m *mockCallUseCase) OnConnect(userID uuid.UUID) *domain.CallSnapshot {
	s, _ := m.Called(userID).Get(0).(*domain.CallSnapshot)
	return s
}
func (m *mockCallUseCase) OnDisconnect(userID uuid.UUID) { m.Called(userID) }
func (m *mockCallUseCase) IssueRoomToken(userID, callID uuid.UUID) (string, error) {
	args := m.Called(userID, callID)
	return args.String(0), args.Error(1)
}
func (m *mockCallUseCase) IsCallRoom(roomID uuid.UUID) bool { return m.Called(roomID).Bool(0) }
func (m *mockCallUseCase) RecoverOnStartup() error          { return m.Called().Error(0) }

// defaultCallUseCase — звонков нет: connect/disconnect — no-op.
func defaultCallUseCase() *mockCallUseCase {
	m := &mockCallUseCase{}
	m.On("OnConnect", mock.Anything).Return(nil)
	m.On("OnDisconnect", mock.Anything).Return()
	return m
}
```

В `newTestHandler` и `newMultiUserTestHandler` заменить
```go
	calls := &mockCallUseCase{}
	calls.On("EndAllActiveCalls", userID).Return(nil)
```
(и вариант с `mock.Anything`) на `calls := defaultCallUseCase()`. Добавить харнесс с подменяемым моком:

```go
// newCallTestHandler — как newMultiUserTestHandler, но с заданным моком звонков.
func newCallTestHandler(t *testing.T, users map[string]*domain.User, calls *mockCallUseCase) *WebSocketHandler {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	auth := &mockAuthUseCase{}
	for token, user := range users {
		auth.On("ValidateToken", token).Return(user, nil)
	}
	userUC := &mockUserUseCase{}
	userUC.On("UpdateStatus", mock.Anything, mock.Anything).Return(nil)
	userUC.On("UpdateLastSeen", mock.Anything, mock.Anything).Return(nil)
	hub := ws.NewHub(log)
	go hub.Run()
	h := NewWebSocketHandler(hub, auth, calls, userUC, allowAllChannelAccess(), log)
	h.pongWait = 200 * time.Millisecond
	h.pingPeriod = 80 * time.Millisecond
	h.writeWait = 100 * time.Millisecond
	return h
}
```

- [ ] **Step 3: Падающие тесты протокола** (в конец `websocket_test.go`)

```go
func TestCallStart_ForwardsToUseCase(t *testing.T) {
	a := &domain.User{ID: uuid.New(), Username: "a"}
	b := uuid.New()
	calls := defaultCallUseCase()
	done := make(chan struct{})
	calls.On("Start", a.ID, b).Return(&domain.Call{ID: uuid.New()}, nil).Run(func(mock.Arguments) { close(done) })
	h := newCallTestHandler(t, map[string]*domain.User{"ta": a}, calls)
	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()
	conn := dialWSWithToken(t, srv, "ta")
	defer conn.Close()

	sendJSON(t, conn, "call_start", map[string]string{"receiver_id": b.String()})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Start не вызван")
	}
	assertNoMessageOfType(t, conn, "call_error", 200*time.Millisecond)
}

func TestCallStart_ErrorMapsToCallError(t *testing.T) {
	cases := map[error]string{
		domain.ErrInteractionForbidden: "forbidden",
		domain.ErrSelfFriendship:       "forbidden",
		domain.ErrUserNotFound:         "forbidden",
		domain.ErrCallPeerOffline:      "offline",
		domain.ErrCallBusy:             "busy",
	}
	for useErr, code := range cases {
		t.Run(code+"/"+useErr.Error(), func(t *testing.T) {
			a := &domain.User{ID: uuid.New(), Username: "a"}
			b := uuid.New()
			calls := defaultCallUseCase()
			calls.On("Start", a.ID, b).Return(nil, useErr)
			h := newCallTestHandler(t, map[string]*domain.User{"ta": a}, calls)
			srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
			defer srv.Close()
			conn := dialWSWithToken(t, srv, "ta")
			defer conn.Close()

			sendJSON(t, conn, "call_start", map[string]string{"receiver_id": b.String()})
			raw := readUntilType(t, conn, "call_error", time.Second)
			var msg struct {
				Payload struct{ Code string `json:"code"` } `json:"payload"`
			}
			require.NoError(t, json.Unmarshal(raw, &msg))
			assert.Equal(t, code, msg.Payload.Code)
		})
	}
}

func TestCallEnd_PassesReason(t *testing.T) {
	a := &domain.User{ID: uuid.New(), Username: "a"}
	callID := uuid.New()
	calls := defaultCallUseCase()
	done := make(chan struct{})
	calls.On("End", a.ID, callID, domain.CallEndFailed).Return(nil).Run(func(mock.Arguments) { close(done) })
	h := newCallTestHandler(t, map[string]*domain.User{"ta": a}, calls)
	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()
	conn := dialWSWithToken(t, srv, "ta")
	defer conn.Close()

	sendJSON(t, conn, "call_end", map[string]string{"call_id": callID.String(), "reason": "failed"})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("End не вызван")
	}
}

func TestConnect_SendsCallState(t *testing.T) {
	a := &domain.User{ID: uuid.New(), Username: "a"}
	snap := &domain.CallSnapshot{CallID: uuid.New(), Status: domain.CallStatusActive}
	calls := &mockCallUseCase{}
	calls.On("OnConnect", a.ID).Return(snap)
	calls.On("OnDisconnect", mock.Anything).Return()
	h := newCallTestHandler(t, map[string]*domain.User{"ta": a}, calls)
	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()
	conn := dialWSWithToken(t, srv, "ta")
	defer conn.Close()

	raw := readUntilType(t, conn, "call_state", time.Second)
	var msg struct {
		Payload struct {
			Call *domain.CallSnapshot `json:"call"`
		} `json:"payload"`
	}
	require.NoError(t, json.Unmarshal(raw, &msg))
	require.NotNil(t, msg.Payload.Call)
	assert.Equal(t, snap.CallID, msg.Payload.Call.CallID)
}

func TestConnect_NoCall_SendsNullCallState(t *testing.T) {
	a := &domain.User{ID: uuid.New(), Username: "a"}
	h := newCallTestHandler(t, map[string]*domain.User{"ta": a}, defaultCallUseCase())
	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()
	conn := dialWSWithToken(t, srv, "ta")
	defer conn.Close()

	raw := readUntilType(t, conn, "call_state", time.Second)
	assert.Contains(t, string(raw), `"call":null`)
}

func TestDisconnect_CallsOnDisconnectOnce(t *testing.T) {
	a := &domain.User{ID: uuid.New(), Username: "a"}
	calls := &mockCallUseCase{}
	calls.On("OnConnect", a.ID).Return(nil)
	done := make(chan struct{}, 4)
	calls.On("OnDisconnect", a.ID).Return().Run(func(mock.Arguments) { done <- struct{}{} })
	h := newCallTestHandler(t, map[string]*domain.User{"ta": a}, calls)
	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()
	conn := dialWSWithToken(t, srv, "ta")
	readUntilType(t, conn, "call_state", time.Second)
	conn.Close()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("OnDisconnect не вызван после закрытия")
	}
}

func TestWebRTCRelayRemoved(t *testing.T) {
	a := &domain.User{ID: uuid.New(), Username: "a"}
	b := &domain.User{ID: uuid.New(), Username: "b"}
	h := newCallTestHandler(t, map[string]*domain.User{"ta": a, "tb": b}, defaultCallUseCase())
	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()
	ca := dialWSWithToken(t, srv, "ta")
	defer ca.Close()
	cb := dialWSWithToken(t, srv, "tb")
	defer cb.Close()

	sendJSON(t, ca, "webrtc_offer", map[string]any{"target_user_id": b.ID.String(), "sdp": map[string]string{"type": "offer"}})
	assertNoMessageOfType(t, cb, "webrtc_offer", 300*time.Millisecond)
}
```

- [ ] **Step 4: Убедиться, что падают**

Run: `cd server && go test ./internal/delivery/http/handler/ -run 'TestCall|TestConnect|TestDisconnect_Calls|TestWebRTC' -v`
Expected: FAIL (компиляция: старые методы `h.callUseCase.StartCall` и т.д.).

- [ ] **Step 5: Переписать обработчики в `websocket.go`**

1. В `HandleWebSocket` заменить блок `EndAllActiveCalls` (строки ~104–107) на:
```go
	// Снимок звонка пишется прямо в client.Send, а не через хаб: регистрация
	// в хабе асинхронна, и SendToUser сразу после RegisterClient может не
	// найти клиента. Буфер Send (512) ещё пуст — запись не блокирует.
	client.Send <- mustMarshal(&ws.Message{
		Type:    "call_state",
		Payload: mustMarshal(map[string]any{"call": h.callUseCase.OnConnect(user.ID)}),
	})
```
Внимание: `OnConnect` возвращает `*domain.CallSnapshot`; nil-указатель в `map[string]any` сериализуется как `null` — это и нужно (`"call":null`).

2. В `readPump` в `defer`, внутри `if wasCurrent { … }`, добавить последней строкой:
```go
			h.callUseCase.OnDisconnect(client.UserID)
```

3. В `handleMessage` удалить `case "webrtc_offer"`, `"webrtc_answer"`, `"webrtc_ice_candidate"`; `call_*` оставить.

4. Удалить функции `handleWebRTCOffer`, `handleWebRTCAnswer`, `handleWebRTCICECandidate` и заменить `handleCallStart/Accept/Reject/End` на:

```go
// --- Звонки 1:1 (VYC-103) ---
// Хендлеры только разбирают payload и переводят ошибки в call_error: события
// звонка (call_ringing/accepted/ended) шлёт сам CallUseCase.

func (h *WebSocketHandler) handleCallStart(client *ws.Client, msg *ws.Message) {
	var p struct {
		ReceiverID string `json:"receiver_id"`
	}
	if err := json.Unmarshal(msg.Payload, &p); err != nil {
		h.sendCallError(client, "not_found", "")
		return
	}
	receiverID, err := uuid.Parse(p.ReceiverID)
	if err != nil {
		h.sendCallError(client, "not_found", "")
		return
	}
	if _, err := h.callUseCase.Start(client.UserID, receiverID); err != nil {
		h.log.Info("call_start refused", "caller_id", client.UserID, "receiver_id", receiverID, "error", err)
		h.sendCallError(client, callErrorCode(err), "")
	}
}

func (h *WebSocketHandler) handleCallAccept(client *ws.Client, msg *ws.Message) {
	h.withCallID(client, msg, func(callID uuid.UUID) error { return h.callUseCase.Accept(client.UserID, callID) })
}

func (h *WebSocketHandler) handleCallReject(client *ws.Client, msg *ws.Message) {
	h.withCallID(client, msg, func(callID uuid.UUID) error { return h.callUseCase.Reject(client.UserID, callID) })
}

func (h *WebSocketHandler) handleCallEnd(client *ws.Client, msg *ws.Message) {
	var p struct {
		Reason string `json:"reason"`
	}
	_ = json.Unmarshal(msg.Payload, &p)
	h.withCallID(client, msg, func(callID uuid.UUID) error {
		return h.callUseCase.End(client.UserID, callID, domain.CallEndReason(p.Reason))
	})
}

func (h *WebSocketHandler) withCallID(client *ws.Client, msg *ws.Message, fn func(uuid.UUID) error) {
	var p struct {
		CallID string `json:"call_id"`
	}
	if err := json.Unmarshal(msg.Payload, &p); err != nil {
		h.sendCallError(client, "not_found", "")
		return
	}
	callID, err := uuid.Parse(p.CallID)
	if err != nil {
		h.sendCallError(client, "not_found", p.CallID)
		return
	}
	if err := fn(callID); err != nil {
		h.log.Info("call action refused", "type", msg.Type, "user_id", client.UserID, "call_id", callID, "error", err)
		h.sendCallError(client, callErrorCode(err), callID.String())
	}
}

// callErrorCode — код для клиента. Запрет, блокировка и «нет такого
// пользователя» неразличимы наружу (как в canInteract).
func callErrorCode(err error) string {
	switch {
	case errors.Is(err, domain.ErrInteractionForbidden),
		errors.Is(err, domain.ErrSelfFriendship),
		errors.Is(err, domain.ErrUserNotFound):
		return "forbidden"
	case errors.Is(err, domain.ErrCallPeerOffline):
		return "offline"
	case errors.Is(err, domain.ErrCallBusy):
		return "busy"
	case errors.Is(err, domain.ErrCallNotFound):
		return "not_found"
	case errors.Is(err, domain.ErrCallInvalidState):
		return "invalid_state"
	default:
		return "internal"
	}
}

func (h *WebSocketHandler) sendCallError(client *ws.Client, code, callID string) {
	payload := map[string]string{"code": code}
	if callID != "" {
		payload["call_id"] = callID
	}
	h.hub.SendToUser(client.UserID, &ws.Message{Type: "call_error", Payload: mustMarshal(payload)})
}
```
Добавить импорт `errors`, если его нет.

- [ ] **Step 6: Прогнать пакет хендлеров целиком**

Run: `cd server && go test ./internal/delivery/... -race`
Expected: PASS (старые тесты голосовых событий тоже зелёные — `defaultCallUseCase` покрывает connect/disconnect).

- [ ] **Step 7: Checkpoint.**

---

### Task 5: HTTP-токен комнаты, фильтр presence, сборка в `main.go`

**Files:**
- Create: `server/internal/delivery/http/handler/call.go`
- Test: `server/internal/delivery/http/handler/call_test.go`
- Modify: `server/internal/delivery/http/httperr/httperr.go` (коды `call_not_found`, `call_not_active`)
- Modify: `server/internal/presence/worker.go` (+ `SetRoomFilter`)
- Test: `server/internal/presence/worker_test.go` (новый тест)
- Modify: `server/cmd/api/main.go`

**Interfaces:**
- Consumes: `domain.CallUseCase.IssueRoomToken`, `IsCallRoom`, `RecoverOnStartup`; `ws.NewCallNotifier`.
- Produces: `POST /api/v1/calls/{call_id}/voice-token` → `200 {"token": "…"}`; `404 call_not_found`; `409 call_not_active`; `400 invalid_call_id`. `(*presence.Worker).SetRoomFilter(skip func(uuid.UUID) bool)`.

- [ ] **Step 1: Коды в `httperr.go`** (рядом с `CodeVoiceTokenFailed`)

```go
	// Звонки 1:1
	CodeInvalidCallID = "invalid_call_id"
	CodeCallNotFound  = "call_not_found"
	CodeCallNotActive = "call_not_active"
```

- [ ] **Step 2: Падающий тест `server/internal/delivery/http/handler/call_test.go`**

```go
package handler

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
)

func callTokenRequest(t *testing.T, calls *mockCallUseCase, userID uuid.UUID, rawCallID string) *httptest.ResponseRecorder {
	t.Helper()
	h := NewCallHandler(calls, slog.New(slog.NewTextHandler(io.Discard, nil)))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/calls/"+rawCallID+"/voice-token", nil)
	req.SetPathValue("call_id", rawCallID)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))
	rec := httptest.NewRecorder()
	h.IssueVoiceToken(rec, req)
	return rec
}

func TestCallVoiceToken(t *testing.T) {
	user, callID := uuid.New(), uuid.New()

	calls := &mockCallUseCase{}
	calls.On("IssueRoomToken", user, callID).Return("tok", nil)
	rec := callTokenRequest(t, calls, user, callID.String())
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"token":"tok"}`, rec.Body.String())

	calls = &mockCallUseCase{}
	calls.On("IssueRoomToken", user, callID).Return("", domain.ErrCallNotFound)
	assert.Equal(t, http.StatusNotFound, callTokenRequest(t, calls, user, callID.String()).Code)

	calls = &mockCallUseCase{}
	calls.On("IssueRoomToken", user, callID).Return("", domain.ErrCallInvalidState)
	assert.Equal(t, http.StatusConflict, callTokenRequest(t, calls, user, callID.String()).Code)

	assert.Equal(t, http.StatusBadRequest, callTokenRequest(t, &mockCallUseCase{}, user, "nope").Code)
}
```

(Ключ контекста `"user_id"` — тот же, что читает `VoiceTokenHandler.IssueToken`. Если `go vet` ругается на строковый ключ — так уже сделано в соседнем хендлере, повторяем существующий приём.)

- [ ] **Step 3: Падает** — `cd server && go test ./internal/delivery/http/handler/ -run TestCallVoiceToken` → FAIL (`NewCallHandler` не определён).

- [ ] **Step 4: `server/internal/delivery/http/handler/call.go`**

```go
package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

// CallHandler — HTTP-часть звонков 1:1: room-токен SFU. Сигналинг вызова
// идёт по WS (websocket.go), здесь только то, что нужно до входа в комнату.
type CallHandler struct {
	calls domain.CallUseCase
	log   *slog.Logger
}

func NewCallHandler(calls domain.CallUseCase, log *slog.Logger) *CallHandler {
	return &CallHandler{calls: calls, log: log}
}

// IssueVoiceToken — room-токен для комнаты SFU звонка (room_id = call_id).
// Только участнику и только в статусе active.
func (h *CallHandler) IssueVoiceToken(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	callID, err := uuid.Parse(r.PathValue("call_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidCallID, "invalid call id")
		return
	}
	token, err := h.calls.IssueRoomToken(userID, callID)
	switch {
	case err == nil:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(voiceTokenResponse{Token: token})
	case errors.Is(err, domain.ErrCallNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeCallNotFound, "call not found")
	case errors.Is(err, domain.ErrCallInvalidState):
		h.sendError(w, http.StatusConflict, httperr.CodeCallNotActive, "call is not active")
	default:
		h.log.Error("call voice token failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeVoiceTokenFailed, "failed to issue voice token")
	}
}

// sendError — тот же формат ответа, что у токена канала: делегируем
// VoiceTokenHandler.sendError, чтобы ошибки двух эндпоинтов не разошлись.
func (h *CallHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	(&VoiceTokenHandler{log: h.log}).sendError(w, status, code, message)
}
```

- [ ] **Step 5: Тест проходит** — `cd server && go test ./internal/delivery/http/handler/ -run TestCallVoiceToken -v` → PASS.

- [ ] **Step 6: Падающий тест фильтра в `server/internal/presence/worker_test.go`**

Сначала посмотреть существующие фейки в файле: `grep -n "type fake\|func newWorker\|func Test" server/internal/presence/worker_test.go`. Добавить тест по их образцу (имена фейков подставить из файла):

```go
func TestTick_RoomFilterSkipsCallRooms(t *testing.T) {
	channelID, callRoom, user := uuid.New(), uuid.New(), uuid.New()
	fetcher := &fakeFetcher{snapshot: map[string][]string{
		channelID.String(): {user.String()},
		callRoom.String():  {user.String()},
	}}
	rec := &fakeReconciler{}
	w := NewWorker(fetcher, rec, slog.New(slog.NewTextHandler(io.Discard, nil)))
	w.SetRoomFilter(func(id uuid.UUID) bool { return id == callRoom })

	w.tick(context.Background())

	require.Len(t, rec.reconciled, 1)
	_, hasCall := rec.reconciled[0][callRoom]
	assert.False(t, hasCall, "комната звонка 1:1 не попадает в голосовое присутствие")
	_, hasChannel := rec.reconciled[0][channelID]
	assert.True(t, hasChannel)
}
```

Если у существующего `fakeReconciler` нет поля с последним снимком — добавить `reconciled []map[uuid.UUID][]uuid.UUID` и дописывать в `ReconcileVoicePresence`.

- [ ] **Step 7: Реализовать фильтр в `worker.go`**

Поле в `Worker`:
```go
	// skipRoom отсекает комнаты SFU, которые не голосовые каналы — звонки 1:1
	// (VYC-103). Без него комната звонка попала бы в voiceChannels и в
	// «событие звонка» чата как несуществующий канал. nil — ничего не отсекать.
	skipRoom func(uuid.UUID) bool
```
Сеттер:
```go
// SetRoomFilter ставит фильтр комнат; skip(id) == true — комнату пропустить.
func (w *Worker) SetRoomFilter(skip func(uuid.UUID) bool) {
	w.skipRoom = skip
}
```
В `tick` сразу после успешного `parseSnapshot`:
```go
	if w.skipRoom != nil {
		for roomID := range actual {
			if w.skipRoom(roomID) {
				delete(actual, roomID)
			}
		}
	}
```

Run: `cd server && go test ./internal/presence/ -v` → PASS.

- [ ] **Step 8: Сборка в `server/cmd/api/main.go`**

1. Строку `callUseCase := usecase.NewCallUseCase(callRepo)` (≈155) **перенести** ниже создания `hub` (≈159) и заменить на:
```go
	callUseCase := usecase.NewCallUseCase(usecase.CallDeps{
		Repo:       callRepo,
		Notifier:   ws.NewCallNotifier(hub),
		Presence:   hub,
		Permission: friendUseCase,
		Users:      userRepo,
		JWTSecret:  cfg.JWTSecret,
	})
```
(Проверить, что `friendUseCase` объявлен выше — строка ≈144 — и что между ≈155 и ≈159 никто не использует `callUseCase`; если использует — перенести `hub := ws.NewHub(log)` выше.)

2. Рядом с `CloseOrphanedCalls` (≈206), до `go hub.Run()`:
```go
	// Звонки 1:1, пережившие рестарт: их таймеры жили в памяти (VYC-103).
	if err := callUseCase.RecoverOnStartup(); err != nil {
		log.Error("failed to close orphaned direct calls at startup", "error", err)
	}
```

3. После `presenceWorker.SetCallSweeper(callRecorder)` (≈227):
```go
		presenceWorker.SetRoomFilter(callUseCase.IsCallRoom)
```

4. Хендлер и маршрут (рядом с `voiceTokenHandler`, ≈260 и ≈404):
```go
	callHandler := handler.NewCallHandler(callUseCase, log)
```
```go
	router.HandleFunc("POST /api/v1/calls/{call_id}/voice-token", authMid.RequireAuth(callHandler.IssueVoiceToken))
```

- [ ] **Step 9: Полный прогон сервера**

Run (из корня): `make build && make vet && make test 2>&1 | tail -40`
Expected: сборка OK, vet чистый, все пакеты `ok` (базовая линия — всё зелёное). Если есть `golangci-lint`: `make lint` — сравнить с результатом на `git stash` (базовой линии lint нет).

- [ ] **Step 10: Checkpoint.**

---

### Task 6: Клиент — типы протокола, токен комнаты звонка, `callStore` с `kind: 'direct'`

**Files:**
- Create: `client/src/types/directCall.ts`
- Modify: `client/src/services/api.ts` (метод `getCallVoiceToken`)
- Modify: `client/src/services/callCredentials.ts` (реестр комнат 1:1)
- Modify: `client/src/stores/callStore.ts`
- Test: `client/src/stores/__tests__/callStore.direct.test.ts`
- Test: `client/src/services/__tests__/callCredentials.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types/directCall.ts
  export interface CallPeer { id: string; username: string; avatar_url?: string | null }
  export interface CallSnapshot { call_id: string; status: 'ringing' | 'active'; caller: CallPeer; receiver: CallPeer }
  export type CallEndReason = 'ended' | 'missed' | 'timeout' | 'rejected' | 'failed';
  export type CallErrorCode = 'forbidden' | 'offline' | 'busy' | 'not_found' | 'invalid_state' | 'internal';
  // api.ts
  getCallVoiceToken(callId: string): Promise<{ token: string }>
  // callCredentials.ts
  export function markDirectCallRoom(roomId: string | null): void
  // callStore.ts
  export type CallKind = 'channel' | 'direct';
  export type JoinCallOptions =
    | { kind?: 'channel'; channelId: string; channelName: string; serverId: string | null; serverName: string | null; userId: string; userName: string }
    | { kind: 'direct'; callId: string; peer: CallPeer; userId: string; userName: string };
  // новые поля CallState: callKind: CallKind | null; callRoomId: string | null; callPeer: CallPeer | null;
  //                         lastExit: 'leave' | 'reset' | null
  ```
- Семантика: `callChannelId` — только канальный звонок (у 1:1 `null`). «Я в каком-либо звонке» = `callRoomId !== null`. `lastExit` выставляется при уходе в `idle`: `leave()` → `'leave'`, `reset()` → `'reset'`; `join` сбрасывает в `null`.

- [ ] **Step 1: `client/src/types/directCall.ts`** — код из блока Interfaces выше, с комментарием-шапкой:

```ts
/**
 * Протокол звонков 1:1 (VYC-103): docs/superpowers/specs/2026-10-03-direct-calls-design.md.
 * Сервер шлёт события обоим участникам; peer — всегда «другой» участник.
 */
export interface CallPeer {
  id: string;
  username: string;
  avatar_url?: string | null;
}

export interface CallSnapshot {
  call_id: string;
  status: 'ringing' | 'active';
  caller: CallPeer;
  receiver: CallPeer;
}

export type CallEndReason = 'ended' | 'missed' | 'timeout' | 'rejected' | 'failed';

export type CallErrorCode = 'forbidden' | 'offline' | 'busy' | 'not_found' | 'invalid_state' | 'internal';
```

- [ ] **Step 2: `api.ts`** — после `getVoiceToken`:

```ts
  async getCallVoiceToken(callId: string): Promise<{ token: string }> {
    return this.request(`/api/v1/calls/${callId}/voice-token`, { method: 'POST' });
  }
```

- [ ] **Step 3: Падающий тест `client/src/services/__tests__/callCredentials.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/api', () => ({
  apiService: {
    getVoiceToken: vi.fn(async () => ({ token: 'channel-token' })),
    getCallVoiceToken: vi.fn(async () => ({ token: 'call-token' })),
  },
}));
vi.mock('@/services/iceConfig', () => ({ getIceServers: vi.fn(async () => []) }));

import { accountCallCredentials, markDirectCallRoom } from '@/services/callCredentials';
import { apiService } from '@/services/api';

describe('accountCallCredentials.getVoiceToken', () => {
  beforeEach(() => {
    markDirectCallRoom(null);
    vi.clearAllMocks();
  });

  it('для канала ходит в /channels/{id}/voice-token', async () => {
    await expect(accountCallCredentials.getVoiceToken('ch-1')).resolves.toEqual({ token: 'channel-token' });
    expect(apiService.getVoiceToken).toHaveBeenCalledWith('ch-1');
  });

  it('для отмеченной комнаты звонка 1:1 — в /calls/{id}/voice-token', async () => {
    markDirectCallRoom('call-1');
    await expect(accountCallCredentials.getVoiceToken('call-1')).resolves.toEqual({ token: 'call-token' });
    expect(apiService.getCallVoiceToken).toHaveBeenCalledWith('call-1');
    expect(apiService.getVoiceToken).not.toHaveBeenCalled();
  });
});
```

Run: `cd client && npx vitest run src/services/__tests__/callCredentials.test.ts` → FAIL (`markDirectCallRoom` нет).

- [ ] **Step 4: `callCredentials.ts`** — заменить `accountCallCredentials`:

```ts
/**
 * Комната текущего звонка 1:1 (room_id = call_id, VYC-103). groupCall просит
 * токен по roomId и не знает, канал это или звонок, — различает здесь.
 * Ставит callStore.join({kind: 'direct'}), снимает выход из звонка.
 */
let directRoomId: string | null = null;

export function markDirectCallRoom(roomId: string | null): void {
  directRoomId = roomId;
}

export const accountCallCredentials: CallCredentials = {
  getVoiceToken: (roomId) =>
    roomId === directRoomId ? apiService.getCallVoiceToken(roomId) : apiService.getVoiceToken(roomId),
  getIceServers: () => accountIceServers(),
};
```

Run тот же тест → PASS.

- [ ] **Step 5: Падающий тест `client/src/stores/__tests__/callStore.direct.test.ts`**

Сначала посмотреть, как `callStore.test.ts` мокает `groupCallService`/`callBus`/`audioService` (`sed -n 1,60p client/src/stores/__tests__/callStore.test.ts`) и повторить те же `vi.mock`. Тесты:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock поднимается выше объявлений: всё, что фабрика читает при
// вычислении, создаётся в vi.hoisted, иначе ReferenceError (TDZ).
const { sent, gc, marked } = vi.hoisted(() => {
  const gc = {
    isInGroupCallState: false,
    currentRoomIdState: null as string | null,
    isMicrophoneAvailable: true,
    lastMediaWarningState: null,
    isScreenSharing: false,
    localStreamState: null,
    joinGroupCall: vi.fn(async (roomId: string) => { gc.currentRoomIdState = roomId; gc.isInGroupCallState = true; return true; }),
    leaveGroupCall: vi.fn(() => { gc.currentRoomIdState = null; gc.isInGroupCallState = false; }),
  };
  return { sent: [] as Array<[string, Record<string, unknown>]>, gc, marked: [] as Array<string | null> };
});
vi.mock('@/services/callBus', () => ({
  callBus: { send: vi.fn((t: string, p: Record<string, unknown>) => { sent.push([t, p]); }), on: vi.fn(() => () => {}) },
}));
vi.mock('@/services/groupCall', () => ({ groupCallService: gc }));
vi.mock('@/services/audio', () => ({ audioService: { playUserJoined: vi.fn(), playUserLeft: vi.fn() } }));
vi.mock('@/services/callCredentials', () => ({ markDirectCallRoom: (id: string | null) => marked.push(id) }));

import { useCallStore } from '@/stores/callStore';

const peer = { id: 'u-b', username: 'bob' };

describe('callStore: звонок 1:1', () => {
  beforeEach(() => {
    sent.length = 0;
    marked.length = 0;
    gc.currentRoomIdState = null;
    gc.isInGroupCallState = false;
    useCallStore.getState().reset();
  });

  it('join direct: комната = callId, без voice_* событий, канал = null', async () => {
    await useCallStore.getState().join({ kind: 'direct', callId: 'call-1', peer, userId: 'u-a', userName: 'alice' });
    const s = useCallStore.getState();
    expect(gc.joinGroupCall).toHaveBeenCalledWith('call-1', 'u-a');
    expect(s.callKind).toBe('direct');
    expect(s.callRoomId).toBe('call-1');
    expect(s.callChannelId).toBeNull();
    expect(s.callPeer).toEqual(peer);
    expect(s.status).toBe('connected');
    expect(marked).toContain('call-1');
    const types = sent.map(([t]) => t);
    expect(types).not.toContain('voice_joined');
    expect(types).not.toContain('voice_call_ring');
    expect(types).toContain('mic_unmuted');
  });

  it('leave direct: без voice_left/voice_call_cancel, lastExit = leave', async () => {
    await useCallStore.getState().join({ kind: 'direct', callId: 'call-1', peer, userId: 'u-a', userName: 'alice' });
    sent.length = 0;
    useCallStore.getState().leave();
    const types = sent.map(([t]) => t);
    expect(types).not.toContain('voice_left');
    expect(types).not.toContain('voice_call_cancel');
    expect(useCallStore.getState().callRoomId).toBeNull();
    expect(useCallStore.getState().lastExit).toBe('leave');
    expect(marked.at(-1)).toBeNull();
  });

  it('join в другую комнату, будучи в звонке, сначала выходит из текущего', async () => {
    await useCallStore.getState().join({
      channelId: 'ch-1', channelName: 'general', serverId: 's', serverName: 'S', userId: 'u-a', userName: 'alice',
    });
    sent.length = 0;
    await useCallStore.getState().join({ kind: 'direct', callId: 'call-1', peer, userId: 'u-a', userName: 'alice' });
    expect(gc.leaveGroupCall).toHaveBeenCalled();
    expect(sent.map(([t]) => t)).toContain('voice_left');
    expect(useCallStore.getState().callRoomId).toBe('call-1');
  });

  it('reset помечает lastExit = reset', async () => {
    await useCallStore.getState().join({ kind: 'direct', callId: 'call-1', peer, userId: 'u-a', userName: 'alice' });
    useCallStore.getState().reset();
    expect(useCallStore.getState().lastExit).toBe('reset');
  });
});
```

Run: `cd client && npx vitest run src/stores/__tests__/callStore.direct.test.ts` → FAIL.

- [ ] **Step 6: Изменить `callStore.ts`**

1. Импорты: `import { markDirectCallRoom } from '@/services/callCredentials';` и `import type { CallPeer } from '@/types/directCall';`.
2. `JoinCallOptions` → union из Interfaces; экспорт `CallKind`.
3. В `CallState` добавить:
```ts
  /** Вид текущего звонка; null — не в звонке. */
  callKind: CallKind | null;
  /** Комната SFU текущего звонка любого вида: id канала или call_id 1:1. «В звонке» = не null. */
  callRoomId: string | null;
  /** Собеседник звонка 1:1; у канального звонка null. */
  callPeer: CallPeer | null;
  /** Как закончился последний звонок: осознанный leave() или молчаливый reset(). */
  lastExit: 'leave' | 'reset' | null;
```
4. В `idle()` добавить `callKind: null as CallKind | null, callRoomId: null as string | null, callPeer: null as CallPeer | null,` (а `lastExit` в `idle()` **не** добавлять — его выставляют `leave/reset` явно).
5. В начало стора (`...idle(), lastExit: null,`).
6. `join` переписать так (логика канального звонка не меняется — та же последовательность, только `roomId` вычисляется и ветки `voice_*` под `if (!direct)`):

```ts
  join: async (opts) => {
    if (get().status === 'joining') return;
    const direct = opts.kind === 'direct';
    const roomId = direct ? opts.callId : opts.channelId;
    if (groupCallService.isInGroupCallState && groupCallService.currentRoomIdState === roomId) {
      return;
    }
    // Звонок может быть только один: вход в другую комнату — осознанный выход
    // из текущей (решение «принятие переключает»). Без этого groupCall упрётся
    // в «Already in a call» и уронит оба звонка через onError.
    const current = get().callRoomId;
    if (current !== null && current !== roomId) {
      get().leave();
    }
    const alreadyInThisRoom = groupCallService.currentRoomIdState === roomId;

    set({ status: 'joining', lastExit: null });
    markDirectCallRoom(direct ? roomId : null);

    let isFirst = false;
    try {
      isFirst = await groupCallService.joinGroupCall(roomId, opts.userId);
    } catch (err) {
      markDirectCallRoom(null);
      set({ status: 'idle' });
      throw err;
    }

    if (!direct && !alreadyInThisRoom && groupCallService.currentRoomIdState === roomId) {
      callBus.send('voice_joined', { channel_id: roomId });
      audioService.playUserJoined();
    }

    const micAvailable = groupCallService.isMicrophoneAvailable;
    const mediaWarning = groupCallService.lastMediaWarningState;
    set({
      status: 'connected',
      startedAt: Date.now(),
      callKind: direct ? 'direct' : 'channel',
      callRoomId: roomId,
      callPeer: direct ? opts.peer : null,
      callChannelId: direct ? null : opts.channelId,
      callChannelName: direct ? null : opts.channelName,
      callServerId: direct ? null : opts.serverId,
      callServerName: direct ? null : opts.serverName,
      isMicAvailable: micAvailable,
      isMuted: !micAvailable,
      mediaWarning,
    });
    callBus.send(micAvailable ? 'mic_unmuted' : 'mic_muted', {});
    announceCameraState();

    if (!direct && isFirst) {
      callBus.send('voice_call_ring', {
        channel_id: opts.channelId,
        server_id: opts.serverId,
        caller_id: opts.userId,
        caller_name: opts.userName,
        channel_name: opts.channelName,
      });
    }
  },
```
7. `leave`:
```ts
  leave: () => {
    const roomId = groupCallService.currentRoomIdState;
    const direct = get().callKind === 'direct';
    if (groupCallService.isScreenSharing) {
      callBus.send('screen_share_stopped', {});
    }
    if (roomId && !direct) {
      callBus.send('voice_call_cancel', { channel_id: roomId, server_id: get().callServerId });
      callBus.send('voice_left', { channel_id: roomId });
    }
    // Звучит только осознанный выход. Обрыв, session_replaced и исчерпанный
    // реконнект приходят в reset() и остаются молчаливыми.
    if (roomId) audioService.playUserLeft();
    groupCallService.leaveGroupCall();
    markDirectCallRoom(null);
    useGuestManagementStore.getState().reset();
    cancelCameraReannounce();
    set({ ...idle(), lastExit: 'leave' });
  },

  reset: () => {
    markDirectCallRoom(null);
    useGuestManagementStore.getState().reset();
    cancelCameraReannounce();
    set({ ...idle(), lastExit: 'reset' });
  },
```
8. Перевести проверки «в звонке вообще» на `callRoomId`:
   - `announceCameraState`: `if (useCallStore.getState().callRoomId === null) return;`
   - функция на ≈строке 294 (`if (useCallStore.getState().callChannelId === null) return;`) — то же.
   - `const inCall = (): boolean => useCallStore.getState().callRoomId !== null;`
   - подписка на `isVideoOff` (≈647): `if (s.callRoomId === null || prev.callRoomId === null) return;`
   - `onCallEnded`/`onError` в `initCallBridge`: `voice_left` слать только если `useCallStore.getState().callKind !== 'direct'`:
     ```ts
     const channelId = groupCallService.currentRoomIdState;
     if (channelId && useCallStore.getState().callKind !== 'direct') callBus.send('voice_left', { channel_id: channelId });
     ```
   - `guest_links_changed` (≈669) — оставить `callChannelId` (гостевые ссылки только у каналов).

- [ ] **Step 7: Прогнать тесты стора и всё, что его использует**

Run: `cd client && npx vitest run src/stores src/services/__tests__/callCredentials.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` может падать в местах, читающих `JoinCallOptions` как объект канала (`guestCallStore`, тесты) — там `kind` опционален, поэтому падать не должно; если падает — сузить тип через `'channelId' in opts`, не менять поведение.

- [ ] **Step 8: Checkpoint.**

---

### Task 7: `directCallStore` — клиентский протокол вызова

**Files:**
- Create: `client/src/stores/directCallStore.ts`
- Test: `client/src/stores/__tests__/directCallStore.test.ts`
- Modify: `client/src/services/audio.ts` (`startRingback/stopRingback`, `startRingtone({ quiet })`)
- Modify: `client/src/pages/app/useAppController.ts` (вызов `initDirectCallBridge`)

**Interfaces:**
- Consumes: Task 6 (`useCallStore.join/leave`, `callRoomId`, `callKind`, `lastExit`, `participants`), `wsService.on/send`, `useAuthStore.getState().user`.
- Produces:
  ```ts
  export type DirectCallPhase =
    | { kind: 'idle' }
    | { kind: 'outgoing'; callId: string | null; peer: CallPeer }      // callId null — call_start ушёл, call_ringing ещё нет
    | { kind: 'incoming'; callId: string; peer: CallPeer; wouldSwitch: boolean }
    | { kind: 'connecting'; callId: string; peer: CallPeer }
    | { kind: 'active'; callId: string; peer: CallPeer }
    | { kind: 'ending'; peer: CallPeer; reason: CallEndReason };
  export interface MissedCall { callId: string; peer: CallPeer; at: number }
  export const useDirectCallStore: UseBoundStore<…> // { phase, missed, viewOpen, lastError, call, accept, reject, hangup, dismissMissed, openView, closeView, clearError }
  export function initDirectCallBridge(): () => void
  export const DIRECT_CALL_ENDING_MS = 2500;
  export const PEER_LEFT_GRACE_MS = 15_000;
  ```
  `call(peer: CallPeer)` — принимает собеседника целиком (кнопки знают имя/аватар), шлёт `call_start`.
  `lastError: CallErrorCode | null` — для тоста (`forbidden`, `offline`, `busy`, `internal`).

Переходы (`initDirectCallBridge` подписывается на WS):
- `call_ringing(snap)`: я звонящий (`snap.caller.id === me`) ⇒ `outgoing{callId, peer: receiver}`, `viewOpen = true`, гудки; я получатель ⇒ `incoming{callId, peer: caller, wouldSwitch: useCallStore.callRoomId !== null}`, рингтон (тихий при `wouldSwitch`).
- `call_accepted{call_id}`: совпадает с текущим ⇒ стоп звуков, `connecting`, `viewOpen = true`, `useCallStore.join({kind:'direct', …})`, по успеху ⇒ `active`; ошибка join ⇒ `wsService.send('call_end', {call_id, reason:'failed'})`.
- `call_ended{call_id, reason}`: совпадает с текущим ⇒ стоп звуков; если был `incoming` и `reason ∈ {missed, timeout}` ⇒ в `missed`; если `useCallStore.callRoomId === call_id` ⇒ `useCallStore.leave()`; ⇒ `ending{reason}` (звук: `rejected` → `playBusy`, иначе `playCallEnded`), через `DIRECT_CALL_ENDING_MS` ⇒ `idle`, `viewOpen = false`.
- `call_error{code, call_id?}`: `lastError = code`; если `outgoing` без `callId` (старт отказан) ⇒ `idle`, `viewOpen=false`, стоп гудков; `invalid_state` для текущего `incoming` ⇒ `idle`.
- `call_state{call}`: `call === null` ⇒ если фаза не `idle`/`ending` ⇒ сброс в `idle` (+ `useCallStore.leave()` при `callKind==='direct'`); `call.status==='ringing'` ⇒ как `call_ringing`; `call.status==='active'` ⇒ как `call_accepted` (вход в комнату, если ещё не в ней).
- Подписка на `useCallStore`: если фаза `active|connecting` и `callKind` был `'direct'` и стал `null`: `lastExit==='leave'` ⇒ `call_end{reason:'ended'}`, иначе ⇒ `call_end{reason:'failed'}`; фаза ⇒ `ending`.
- Подписка на `participants`: в `active`, если собеседник был в `participants` и пропал ⇒ таймер `PEER_LEFT_GRACE_MS`; вернулся ⇒ отмена; истёк ⇒ `call_end{reason:'failed'}`.
- `hangup()`: `outgoing|active|connecting` ⇒ `call_end{call_id}` (для `outgoing` без callId — просто `idle`); выход из комнаты придёт через `call_ended`; UI сразу переводим в `ending{reason:'ended'}`.
- `accept()`: `incoming` ⇒ `call_accept`, стоп рингтона, фаза `connecting` (дальше по `call_accepted`).
- `reject()`: `incoming` ⇒ `call_reject`, стоп рингтона, `idle`.

- [ ] **Step 1: Звуки в `audio.ts`**

`startRingtone` — опциональный параметр громкости:
```ts
  startRingtone(opts: { quiet?: boolean } = {}): void {
    if (this.isRinging) return;
    this.isRinging = true;
    this.ringtoneQuiet = opts.quiet ?? false;
    …
```
и в `playRingPattern` множитель `const k = this.ringtoneQuiet ? 0.3 : 1;` для обоих `playTone(…, this.settings.volume * 0.3 * k)`. Поле `private ringtoneQuiet = false;`.

Гудки исходящего (425 Гц, 1 с звука / 3 с тишины — классический ringback):
```ts
  private ringbackTimer: ReturnType<typeof setTimeout> | null = null;

  /** Гудки, пока собеседнику звонит наш вызов. */
  startRingback(): void {
    if (this.ringbackTimer !== null) return;
    const loop = () => {
      this.playTone(this.getAudioContext(), 425, 0, 1.0, this.settings.volume * 0.15);
      this.ringbackTimer = setTimeout(loop, 4000);
    };
    loop();
  }

  stopRingback(): void {
    if (this.ringbackTimer !== null) clearTimeout(this.ringbackTimer);
    this.ringbackTimer = null;
  }
```
(Сигнатуру `playTone(ctx, freq, offset, duration, volume)` сверить с существующей в файле.)

- [ ] **Step 2: Падающий тест `client/src/stores/__tests__/directCallStore.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Listener = (p: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const sent: Array<[string, unknown]> = [];
vi.mock('@/services/websocket', () => ({
  wsService: {
    on: (type: string, l: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(l);
      return () => listeners.get(type)!.delete(l);
    },
    send: (type: string, p: unknown) => { sent.push([type, p]); },
  },
}));
const emit = (type: string, p: unknown) => listeners.get(type)?.forEach((l) => l(p));

vi.mock('@/services/audio', () => ({
  audioService: {
    startRingtone: vi.fn(), stopRingtone: vi.fn(), startRingback: vi.fn(), stopRingback: vi.fn(),
    playBusy: vi.fn(), playCallEnded: vi.fn(), playCallAccepted: vi.fn(),
  },
}));

const callStoreState = {
  callRoomId: null as string | null,
  callKind: null as 'channel' | 'direct' | null,
  lastExit: null as 'leave' | 'reset' | null,
  participants: [] as Array<{ userId: string }>,
  join: vi.fn(async (o: { callId: string }) => {
    callStoreState.callRoomId = o.callId;
    callStoreState.callKind = 'direct';
    notify();
  }),
  leave: vi.fn(() => {
    callStoreState.callRoomId = null;
    callStoreState.callKind = null;
    callStoreState.lastExit = 'leave';
    notify();
  }),
};
const subs = new Set<(s: typeof callStoreState, p: typeof callStoreState) => void>();
let prevSnapshot = { ...callStoreState };
function notify() {
  const next = { ...callStoreState };
  subs.forEach((f) => f(next, prevSnapshot));
  prevSnapshot = next;
}
vi.mock('@/stores/callStore', () => ({
  useCallStore: Object.assign(() => callStoreState, {
    getState: () => callStoreState,
    subscribe: (f: (s: typeof callStoreState, p: typeof callStoreState) => void) => { subs.add(f); return () => subs.delete(f); },
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'me', username: 'me' } }) },
}));

import { useDirectCallStore, initDirectCallBridge, DIRECT_CALL_ENDING_MS, PEER_LEFT_GRACE_MS } from '@/stores/directCallStore';
import { audioService } from '@/services/audio';

const me = { id: 'me', username: 'me' };
const bob = { id: 'bob', username: 'bob' };
let off: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  listeners.clear();
  subs.clear();
  Object.assign(callStoreState, { callRoomId: null, callKind: null, lastExit: null, participants: [] });
  prevSnapshot = { ...callStoreState };
  useDirectCallStore.setState({ phase: { kind: 'idle' }, missed: [], viewOpen: false, lastError: null });
  off = initDirectCallBridge();
});
afterEach(() => { off(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('directCallStore', () => {
  it('исходящий: call → call_start, ringing → outgoing с callId и гудки', () => {
    useDirectCallStore.getState().call(bob);
    expect(sent).toContainEqual(['call_start', { receiver_id: 'bob' }]);
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'outgoing', callId: null, peer: bob });
    expect(useDirectCallStore.getState().viewOpen).toBe(true);

    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: me, receiver: bob });
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'outgoing', callId: 'c1', peer: bob });
    expect(audioService.startRingback).toHaveBeenCalled();
  });

  it('входящий: карточка; при текущем звонке wouldSwitch и тихий рингтон', () => {
    callStoreState.callRoomId = 'channel-x';
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'incoming', callId: 'c1', peer: bob, wouldSwitch: true });
    expect(audioService.startRingtone).toHaveBeenCalledWith({ quiet: true });
  });

  it('accept → call_accept; call_accepted → join direct → active', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    expect(sent).toContainEqual(['call_accept', { call_id: 'c1' }]);

    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    expect(callStoreState.join).toHaveBeenCalledWith(expect.objectContaining({ kind: 'direct', callId: 'c1', peer: bob }));
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'c1', peer: bob });
  });

  it('reject → call_reject и idle', () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().reject();
    expect(sent).toContainEqual(['call_reject', { call_id: 'c1' }]);
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
    expect(audioService.stopRingtone).toHaveBeenCalled();
  });

  it('пропущенный: входящий + call_ended timeout → в missed, ending → idle', () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    emit('call_ended', { call_id: 'c1', reason: 'timeout' });
    expect(useDirectCallStore.getState().missed).toEqual([expect.objectContaining({ callId: 'c1', peer: bob })]);
    vi.advanceTimersByTime(DIRECT_CALL_ENDING_MS);
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
  });

  it('отказ у звонящего: call_ended rejected → ending rejected и playBusy', () => {
    useDirectCallStore.getState().call(bob);
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: me, receiver: bob });
    emit('call_ended', { call_id: 'c1', reason: 'rejected' });
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'ending', peer: bob, reason: 'rejected' });
    expect(audioService.playBusy).toHaveBeenCalled();
    expect(audioService.stopRingback).toHaveBeenCalled();
  });

  it('call_error при старте → idle и lastError', () => {
    useDirectCallStore.getState().call(bob);
    emit('call_error', { code: 'forbidden' });
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
    expect(useDirectCallStore.getState().lastError).toBe('forbidden');
  });

  it('call_ended в активном звонке → leave комнаты', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    sent.length = 0;
    emit('call_ended', { call_id: 'c1', reason: 'ended' });
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined(); // сервер уже завершил — эхо не шлём
  });

  it('выход из комнаты кнопкой (leave) → call_end ended', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    sent.length = 0;
    callStoreState.leave();
    expect(sent).toContainEqual(['call_end', { call_id: 'c1', reason: 'ended' }]);
  });

  it('сброс комнаты (reset: обрыв) → call_end failed', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    sent.length = 0;
    Object.assign(callStoreState, { callRoomId: null, callKind: null, lastExit: 'reset' });
    notify();
    expect(sent).toContainEqual(['call_end', { call_id: 'c1', reason: 'failed' }]);
  });

  it('собеседник ушёл из SFU и не вернулся за 15 с → call_end failed', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    callStoreState.participants = [{ userId: 'bob' }];
    notify();
    sent.length = 0;
    callStoreState.participants = [];
    notify();
    vi.advanceTimersByTime(PEER_LEFT_GRACE_MS - 1);
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(sent).toContainEqual(['call_end', { call_id: 'c1', reason: 'failed' }]);
  });

  it('call_state active после реконнекта WS → снова входит в комнату', async () => {
    emit('call_state', { call: { call_id: 'c1', status: 'active', caller: bob, receiver: me } });
    await vi.runOnlyPendingTimersAsync();
    expect(callStoreState.join).toHaveBeenCalledWith(expect.objectContaining({ callId: 'c1' }));
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'c1', peer: bob });
  });

  it('hangup в активном звонке: call_end и выход из комнаты', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    sent.length = 0;
    useDirectCallStore.getState().hangup();
    expect(sent.filter(([t]) => t === 'call_end')).toEqual([['call_end', { call_id: 'c1' }]]); // ровно один, без эха
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(useDirectCallStore.getState().phase.kind).toBe('ending');
  });

  it('call_state null сбрасывает зависшую фазу', () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    emit('call_state', { call: null });
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
  });
});
```

Run: `cd client && npx vitest run src/stores/__tests__/directCallStore.test.ts` → FAIL (модуля нет).

- [ ] **Step 3: `client/src/stores/directCallStore.ts`**

```ts
import { create } from 'zustand';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import { useCallStore } from '@/stores/callStore';
import { useAuthStore } from '@/stores/authStore';
import { logger } from '@/utils/logger';
import type { CallEndReason, CallErrorCode, CallPeer, CallSnapshot } from '@/types/directCall';

/**
 * Клиентская сторона протокола звонков 1:1 (VYC-103). Жизненным циклом владеет
 * сервер; стор лишь отражает его события и переводит их в вход/выход из
 * комнаты SFU через callStore. Спека: docs/superpowers/specs/2026-10-03-direct-calls-design.md.
 */

export type DirectCallPhase =
  | { kind: 'idle' }
  | { kind: 'outgoing'; callId: string | null; peer: CallPeer }
  | { kind: 'incoming'; callId: string; peer: CallPeer; wouldSwitch: boolean }
  | { kind: 'connecting'; callId: string; peer: CallPeer }
  | { kind: 'active'; callId: string; peer: CallPeer }
  | { kind: 'ending'; peer: CallPeer; reason: CallEndReason };

export interface MissedCall {
  callId: string;
  peer: CallPeer;
  at: number;
}

/** Сколько висит исход звонка («Отклонён», «Не отвечает») перед закрытием. */
export const DIRECT_CALL_ENDING_MS = 2500;
/** Grace ухода собеседника из комнаты SFU — совпадает с grace самого SFU. */
export const PEER_LEFT_GRACE_MS = 15_000;

interface DirectCallState {
  phase: DirectCallPhase;
  missed: MissedCall[];
  /** Открыт ли экран звонка в основной колонке (десктоп) / экран звонка (мобильный). */
  viewOpen: boolean;
  lastError: CallErrorCode | null;
  call: (peer: CallPeer) => void;
  accept: () => void;
  reject: () => void;
  hangup: () => void;
  dismissMissed: (callId: string) => void;
  openView: () => void;
  closeView: () => void;
  clearError: () => void;
}

const callIdOf = (p: DirectCallPhase): string | null =>
  p.kind === 'idle' || p.kind === 'ending' ? null : p.callId;

const peerOf = (p: DirectCallPhase): CallPeer | null => (p.kind === 'idle' ? null : p.peer);

let endingTimer: ReturnType<typeof setTimeout> | null = null;
let peerLeftTimer: ReturnType<typeof setTimeout> | null = null;

function stopSounds(): void {
  audioService.stopRingtone();
  audioService.stopRingback();
}

function clearPeerLeft(): void {
  if (peerLeftTimer !== null) clearTimeout(peerLeftTimer);
  peerLeftTimer = null;
}

export const useDirectCallStore = create<DirectCallState>((set, get) => ({
  phase: { kind: 'idle' },
  missed: [],
  viewOpen: false,
  lastError: null,

  call: (peer) => {
    const kind = get().phase.kind;
    if (kind === 'outgoing' || kind === 'connecting') return;
    wsService.send('call_start', { receiver_id: peer.id });
    set({ phase: { kind: 'outgoing', callId: null, peer }, viewOpen: true, lastError: null });
  },

  accept: () => {
    const p = get().phase;
    if (p.kind !== 'incoming') return;
    stopSounds();
    wsService.send('call_accept', { call_id: p.callId });
    set({ phase: { kind: 'connecting', callId: p.callId, peer: p.peer }, viewOpen: true });
  },

  reject: () => {
    const p = get().phase;
    if (p.kind !== 'incoming') return;
    stopSounds();
    wsService.send('call_reject', { call_id: p.callId });
    set({ phase: { kind: 'idle' } });
  },

  hangup: () => {
    const p = get().phase;
    if (p.kind === 'outgoing' && p.callId === null) {
      stopSounds();
      set({ phase: { kind: 'idle' }, viewOpen: false });
      return;
    }
    if (p.kind !== 'outgoing' && p.kind !== 'connecting' && p.kind !== 'active') return;
    wsService.send('call_end', { call_id: p.callId });
    // Сначала ending: ответный call_ended для фазы ending игнорируется, а
    // подписка на callStore не шлёт эхо call_end. Поэтому из комнаты выходим сами.
    finish(p.peer, 'ended', false);
    if (useCallStore.getState().callRoomId === p.callId) useCallStore.getState().leave();
  },

  dismissMissed: (callId) => set((s) => ({ missed: s.missed.filter((m) => m.callId !== callId) })),
  openView: () => set({ viewOpen: true }),
  closeView: () => set({ viewOpen: false }),
  clearError: () => set({ lastError: null }),
}));

/** Переход в ending с исходом и звуком, затем в idle. */
function finish(peer: CallPeer, reason: CallEndReason, withSound = true): void {
  stopSounds();
  clearPeerLeft();
  if (withSound) {
    if (reason === 'rejected') audioService.playBusy();
    else audioService.playCallEnded();
  }
  useDirectCallStore.setState({ phase: { kind: 'ending', peer, reason } });
  if (endingTimer !== null) clearTimeout(endingTimer);
  endingTimer = setTimeout(() => {
    endingTimer = null;
    if (useDirectCallStore.getState().phase.kind === 'ending') {
      useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false });
    }
  }, DIRECT_CALL_ENDING_MS);
}

const me = (): string | undefined => useAuthStore.getState().user?.id;

function onRinging(snap: CallSnapshot): void {
  const self = me();
  if (snap.caller.id === self) {
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: snap.call_id, peer: snap.receiver }, viewOpen: true });
    audioService.startRingback();
    return;
  }
  const wouldSwitch = useCallStore.getState().callRoomId !== null;
  useDirectCallStore.setState({ phase: { kind: 'incoming', callId: snap.call_id, peer: snap.caller, wouldSwitch } });
  audioService.startRingtone({ quiet: wouldSwitch });
}

async function enterRoom(callId: string, peer: CallPeer): Promise<void> {
  stopSounds();
  useDirectCallStore.setState({ phase: { kind: 'connecting', callId, peer }, viewOpen: true });
  const user = useAuthStore.getState().user;
  if (!user) return;
  try {
    await useCallStore.getState().join({ kind: 'direct', callId, peer, userId: user.id, userName: user.username });
  } catch (err) {
    logger.error('[DirectCall] join failed', err, { module: 'directCall' });
    wsService.send('call_end', { call_id: callId, reason: 'failed' });
    finish(peer, 'failed');
    return;
  }
  const p = useDirectCallStore.getState().phase;
  if (p.kind === 'connecting' && p.callId === callId) {
    audioService.playCallAccepted();
    useDirectCallStore.setState({ phase: { kind: 'active', callId, peer } });
  }
}

function onAccepted(callId: string): void {
  const p = useDirectCallStore.getState().phase;
  if (callIdOf(p) !== callId) return;
  const peer = peerOf(p);
  if (peer) void enterRoom(callId, peer);
}

function onEnded(callId: string, reason: CallEndReason): void {
  const p = useDirectCallStore.getState().phase;
  if (callIdOf(p) !== callId) return;
  const peer = peerOf(p)!;
  if (p.kind === 'incoming' && (reason === 'missed' || reason === 'timeout')) {
    useDirectCallStore.setState((s) => ({ missed: [...s.missed, { callId, peer, at: Date.now() }] }));
  }
  // Фаза уходит в ending ДО leave(): подписка ниже видит не-active фазу и
  // не шлёт эхо call_end на уже завершённый сервером звонок.
  finish(peer, reason);
  if (useCallStore.getState().callRoomId === callId) useCallStore.getState().leave();
  if (p.kind === 'incoming') useDirectCallStore.setState({ phase: { kind: 'idle' } });
}

function onError(code: CallErrorCode, callId?: string): void {
  useDirectCallStore.setState({ lastError: code });
  const p = useDirectCallStore.getState().phase;
  if (p.kind === 'outgoing' && p.callId === null) {
    stopSounds();
    useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false });
  } else if (p.kind === 'incoming' && callId === p.callId && code === 'invalid_state') {
    stopSounds();
    useDirectCallStore.setState({ phase: { kind: 'idle' } });
  }
}

function onState(call: CallSnapshot | null): void {
  const p = useDirectCallStore.getState().phase;
  if (call === null) {
    if (p.kind !== 'idle' && p.kind !== 'ending') {
      stopSounds();
      clearPeerLeft();
      if (useCallStore.getState().callKind === 'direct') useCallStore.getState().leave();
      useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false });
    }
    return;
  }
  if (call.status === 'ringing') {
    if (callIdOf(p) !== call.call_id) onRinging(call);
    return;
  }
  const peer = call.caller.id === me() ? call.receiver : call.caller;
  if (p.kind === 'active' && p.callId === call.call_id && useCallStore.getState().callRoomId === call.call_id) return;
  void enterRoom(call.call_id, peer);
}

/** Подписки на WS и на callStore. Вызывается один раз на сессию (useAppController). */
export function initDirectCallBridge(): () => void {
  const offs = [
    wsService.on('call_ringing', (pl) => onRinging(pl as CallSnapshot)),
    wsService.on('call_accepted', (pl) => onAccepted((pl as { call_id: string }).call_id)),
    wsService.on('call_ended', (pl) => {
      const { call_id, reason } = pl as { call_id: string; reason: CallEndReason };
      onEnded(call_id, reason);
    }),
    wsService.on('call_error', (pl) => {
      const { code, call_id } = pl as { code: CallErrorCode; call_id?: string };
      onError(code, call_id);
    }),
    wsService.on('call_state', (pl) => onState((pl as { call: CallSnapshot | null }).call)),
  ];

  // Выход из комнаты 1:1 мимо hangup (кнопка в доке/сцене, медиа-сессия,
  // обрыв SFU): leave() — осознанное «Завершить», reset() — сбой.
  const offRoom = useCallStore.subscribe((s, prev) => {
    if (prev.callKind !== 'direct' || s.callRoomId !== null) return;
    const p = useDirectCallStore.getState().phase;
    if (p.kind !== 'active' && p.kind !== 'connecting') return;
    const reason = s.lastExit === 'leave' ? 'ended' : 'failed';
    wsService.send('call_end', { call_id: p.callId, reason });
    finish(p.peer, reason, reason === 'ended');
  });

  // Собеседник пропал из комнаты SFU и не вернулся за grace — звонок сломан.
  const offPeer = useCallStore.subscribe((s, prev) => {
    const p = useDirectCallStore.getState().phase;
    if (p.kind !== 'active') return;
    const had = prev.participants.some((x) => x.userId === p.peer.id);
    const has = s.participants.some((x) => x.userId === p.peer.id);
    if (has) {
      clearPeerLeft();
    } else if (had && peerLeftTimer === null) {
      const { callId } = p;
      peerLeftTimer = setTimeout(() => {
        peerLeftTimer = null;
        const cur = useDirectCallStore.getState().phase;
        if (cur.kind === 'active' && cur.callId === callId) {
          wsService.send('call_end', { call_id: callId, reason: 'failed' });
          finish(cur.peer, 'failed');
          if (useCallStore.getState().callRoomId === callId) useCallStore.getState().leave();
        }
      }, PEER_LEFT_GRACE_MS);
    }
  });

  return () => {
    offs.forEach((off) => off());
    offRoom();
    offPeer();
    clearPeerLeft();
  };
}
```

Внимание к порядку в `peerLeftTimer`: `finish` переводит фазу в `ending` до `leave()`, поэтому подписка `offRoom` не шлёт второй `call_end`.

- [ ] **Step 4: Тесты проходят**

Run: `cd client && npx vitest run src/stores/__tests__/directCallStore.test.ts`
Expected: PASS. Если `useCallStore.subscribe` в моке получает `(state, prev)` — как у Zustand 5 без `subscribeWithSelector`; проверить, что реальный стор создан через `create` без middleware (`grep -n "subscribeWithSelector" client/src/stores/callStore.ts` — должно быть пусто).

- [ ] **Step 5: Подключить мост** в `useAppController.ts` рядом с `initFriendBridge` (≈106):

```ts
  useEffect(() => initDirectCallBridge(), []);
```
(+ импорт `import { initDirectCallBridge } from '@/stores/directCallStore';`). Мобильная оболочка использует тот же `useAppController` — проверить: `grep -n "useAppController" client/src/mobile/MobileShell.tsx`; если нет — добавить такой же `useEffect` в мобильную точку инициализации, где вызывается `initFriendBridge`.

- [ ] **Step 6: Гейты** — `cd client && npx tsc --noEmit && npx vitest run src/stores` → 0 байт / PASS.

- [ ] **Step 7: Checkpoint.**

---

### Task 8: Удаление старого P2P и перевод точек входа

**Files:**
- Delete: `client/src/services/call.ts`, `client/src/services/__tests__/call.mediaPermissions.test.ts`, `client/src/components/CallUI.tsx`, `client/src/components/CallUI.css`, `client/src/components/__tests__/CallUI.dom.test.tsx`
- Modify: `client/src/services/websocket.ts` (убрать `discrod:*` CustomEvent)
- Modify: `client/src/pages/app/DesktopShell.tsx`, `client/src/mobile/MobileShell.tsx` (убрать `<CallUI />`)
- Modify: `client/src/components/UpdateBanner.tsx`, `client/src/hooks/useVoiceRecording.ts`
- Modify: `client/src/components/UserList.tsx`, `client/src/mobile/screens/FriendsScreen.tsx`, `client/src/mobile/screens/ChannelInfoScreen.tsx`
- Modify: `client/src/components/ChatArea.tsx`, `client/src/components/useCallStageModel.ts`
- Modify: тесты, ссылающиеся на удалённое (`grep` в Step 1)

**Interfaces:**
- Consumes: `useDirectCallStore.getState().call(peer)` (Task 7), `useCallStore` `callRoomId` (Task 6).

- [ ] **Step 1: Найти всех потребителей**

Run: `cd client && grep -rn "services/call'\|services/call\"\|callService\|CallUI\|discrod:\|p2p-" src --include=*.ts --include=*.tsx --include=*.css`
Записать список; каждый пункт закрывается шагами ниже. `p2p-` в `src/styles/__tests__/overlay-scrim-contract.test.ts` и в `docs/superpowers/backlog/post-redesign-backlog.md` — убрать упоминания удалённых классов из контракта (тест должен проверять существующие файлы).

- [ ] **Step 2: Удалить файлы** (явными путями):

```bash
cd /www/my/vycord/client
git rm src/services/call.ts src/services/__tests__/call.mediaPermissions.test.ts \
  src/components/CallUI.tsx src/components/CallUI.css src/components/__tests__/CallUI.dom.test.tsx
```
Перед удалением `call.ts` сверить, что логика камеры/фона (VYC-100: заглушка-чёрный кадр, `setCameraOutput`, `cameraInputState`) есть в `groupCall.ts`: `grep -n "createBlackVideoTrack\|setCameraOutput\|cameraInputState" src/services/groupCall.ts`. Если чего-то нет — остановиться и сообщить (спека: «сверить, что ничего уникального не теряется»).

- [ ] **Step 3: `websocket.ts`** — удалить блок

```ts
      // Also dispatch custom events for CallUI
      window.dispatchEvent(
        new CustomEvent(`discrod:${message.type}`, { detail: message.payload })
      );
```

- [ ] **Step 4: Оболочки и «в звонке ли я»**
- `DesktopShell.tsx`, `MobileShell.tsx`: удалить импорт и `<CallUI />` (комментарий у `app-account-dock` про `CallUI` — поправить на `IncomingCallCard`, который добавит Task 10).
- `UpdateBanner.tsx:12`: `return groupCallService.isInGroupCallState;` (1:1 теперь тоже идёт через `groupCallService`); убрать импорт `callService`.
- `useVoiceRecording.ts:12`: `const defaultInCall = () => useCallStore.getState().callRoomId !== null;`; убрать импорт `callService`.
- `useCallStageModel.ts:201`: `const isInGroupCall = useCallStore((s) => s.callRoomId) !== null;` (или отдельным селектором `callRoomId`), чтобы сцена работала и для 1:1.
- `ChatArea.tsx:773/782`: тернарник «в другом звонке» перевести на `callRoomId`:
  ```ts
  const callRoomId = useCallStore((s) => s.callRoomId);
  …
  : callRoomId ? t('call.goToCall') : t('call.joinVoice')
  ```
  Клик остаётся `onJoinVoice(channel)` — `callStore.join` из Task 6 сам выходит из 1:1, а `directCallStore` по `lastExit === 'leave'` шлёт `call_end ended` (Review Focus №2). Заголовок кнопки при звонке 1:1 должен честно говорить, что текущий звонок завершится: добавить ветку `callKind === 'direct' ? t('directCall.joinEndsCurrent') : …` для `title`.

- [ ] **Step 5: Точки входа**
- `UserList.tsx`: удалить `handleCallUser`/импорт `callService`; кнопка:
  ```tsx
  onClick={() => useDirectCallStore.getState().call({ id: m.user_id, username: m.username, avatar_url: m.avatar_url })}
  ```
  (имена полей `MemberWithUser` сверить: `grep -n "interface MemberWithUser" -A12 src/types/index.ts`). Тултип при текущем звонке: `callRoomId ? t('directCall.callEndsCurrent', { name }) : t('server.callUser', { name })`.
- `mobile/screens/FriendsScreen.tsx:47`: `onCall: (menuOnline && !menuBlocked) ? () => useDirectCallStore.getState().call({ id: menuTarget.user_id, username: menuTarget.username, avatar_url: menuTarget.avatar_url }) : undefined,`
- `mobile/screens/ChannelInfoScreen.tsx:113`: `onClick: () => useDirectCallStore.getState().call({ id: callTarget.user_id, username: callTarget.username, avatar_url: callTarget.avatar_url }),`
- Иконка в мобильных меню звонка — `Phone`, а не `Headphones` (Headphones — «войти в голосовой канал»): `useFriendMenuItems.tsx:20`, `ChannelInfoScreen.tsx`.

- [ ] **Step 6: Строки i18n** (`ru.ts` / `en.ts`, новая секция `directCall` рядом с `call`):

```ts
  directCall: {
    callEndsCurrent: 'Позвонить {{name}} — текущий звонок завершится',
    joinEndsCurrent: 'Войти в голосовой канал — звонок 1:1 завершится',
  },
```
```ts
  directCall: {
    callEndsCurrent: 'Call {{name}} — your current call will end',
    joinEndsCurrent: 'Join voice — your 1:1 call will end',
  },
```
Удалить ключи, которыми пользовался только `CallUI` (`call.incomingCall`, `call.userCalling`, `call.rejected`, `call.youSuffix`, `call.ctl*`, `call.leaveLabel`, `call.startFailed`, `call.mediaPermissionDenied` — каждый проверить `grep -rn "'call.<key>'" src` перед удалением).

- [ ] **Step 7: Обновить тесты** — `src/mobile/menus/__tests__/useFriendMenuItems.test.tsx`, `src/mobile/screens/__tests__/{FriendsScreen,ChannelInfoScreen}.test.tsx`: мок `@/services/call` заменить на мок `@/stores/directCallStore` (`useDirectCallStore: { getState: () => ({ call: callSpy }) }`) и проверять `callSpy` с `{ id, username }`. Добавить тест в `UserList` (если есть файл тестов — туда, иначе новый `src/components/__tests__/UserList.call.test.tsx`): онлайн-участник — кнопка есть и вызывает `call`, офлайн и сам пользователь — кнопки нет.

- [ ] **Step 8: Гейты клиента**

Run: `cd client && npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test 2>&1 | tail -15`
Expected: tsc/stylelint — 0 байт; i18n — «непереведённых строк не найдено.»; vitest — ровно 3 падения в `api.network-retry.test.ts`.

- [ ] **Step 9: Checkpoint.**

---

### Task 9: Десктоп — экран звонка в основной колонке, док, сцена, навигация

**Files:**
- Create: `client/src/components/directCall/DirectCallView.tsx`, `DirectCallView.css`
- Modify: `client/src/pages/app/DesktopShell.tsx`
- Modify: `client/src/pages/app/useAppController.ts` (`goToCall`, закрытие экрана при навигации)
- Modify: `client/src/components/CallDock.tsx`
- Modify: `client/src/components/CallStage.tsx`, `client/src/components/useCallStageModel.ts` (заголовок 1:1, без счётчика/инвайта)
- Test: `client/src/components/directCall/__tests__/DirectCallView.test.tsx`, `client/src/components/__tests__/CallDock.direct.test.tsx`

**Interfaces:**
- Consumes: `useDirectCallStore` (`phase`, `viewOpen`, `hangup`, `openView`, `closeView`), `useCallStore` (`callKind`, `callPeer`, `callRoomId`, `status`).
- Produces: `<DirectCallView />` — рисует по фазе: `outgoing` → экран дозвона; `connecting|active` → `<CallStage />`; `ending` → исход. Возвращает `null`, если `!viewOpen` или фаза `idle|incoming`.
- `onGoToCall` у `CallDock` расширяется: `onGoToCall: (target: { kind: 'channel'; serverId: string | null; channelId: string } | { kind: 'direct' }) => void`.

- [ ] **Step 1: Прочитать дизайн-систему** — `client/CLAUDE.md`, `client/docs/` (токены, панели, кнопки, пустые состояния), `CallStage.css` (переиспользовать `stage-*` классы и токены сцены).

- [ ] **Step 2: Падающий тест `DirectCallView.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/components/CallStage', () => ({ CallStage: () => <div data-testid="stage" /> }));
import { DirectCallView } from '@/components/directCall/DirectCallView';
import { useDirectCallStore } from '@/stores/directCallStore';

const bob = { id: 'bob', username: 'bob' };

describe('DirectCallView', () => {
  beforeEach(() => useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false, missed: [], lastError: null }));

  it('ничего не рисует, пока экран закрыт', () => {
    useDirectCallStore.setState({ phase: { kind: 'active', callId: 'c', peer: bob }, viewOpen: false });
    const { container } = render(<DirectCallView />);
    expect(container).toBeEmptyDOMElement();
  });

  it('исходящий: имя, «Звоним…», кнопка «Отменить» вызывает hangup', () => {
    const hangup = vi.fn();
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: 'c', peer: bob }, viewOpen: true, hangup });
    render(<DirectCallView />);
    expect(screen.getByText('bob')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /отменить|cancel/i }));
    expect(hangup).toHaveBeenCalled();
  });

  it('активный: сцена звонка', () => {
    useDirectCallStore.setState({ phase: { kind: 'active', callId: 'c', peer: bob }, viewOpen: true });
    render(<DirectCallView />);
    expect(screen.getByTestId('stage')).toBeInTheDocument();
  });

  it('исход: текст причины', () => {
    useDirectCallStore.setState({ phase: { kind: 'ending', peer: bob, reason: 'timeout' }, viewOpen: true });
    render(<DirectCallView />);
    expect(screen.getByText(/не отвечает|no answer/i)).toBeInTheDocument();
  });
});
```
(Проверить, что `@testing-library/react` и jsdom-окружение подключены так же, как в существующих `*.test.tsx` — при необходимости скопировать директиву окружения из `src/components/__tests__/` соседнего теста.)

Run → FAIL.

- [ ] **Step 3: `DirectCallView.tsx`**

```tsx
import { PhoneOff } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { CallStage } from '@/components/CallStage';
import { useDirectCallStore } from '@/stores/directCallStore';
import { useT } from '@/i18n';
import type { CallEndReason } from '@/types/directCall';
import './DirectCallView.css';

const REASON_KEY: Record<CallEndReason, string> = {
  ended: 'directCall.endedEnded',
  missed: 'directCall.endedMissed',
  timeout: 'directCall.endedTimeout',
  rejected: 'directCall.endedRejected',
  failed: 'directCall.endedFailed',
};

/** Экран звонка 1:1 в основной колонке: дозвон → сцена → исход. */
export function DirectCallView() {
  const t = useT();
  const phase = useDirectCallStore((s) => s.phase);
  const viewOpen = useDirectCallStore((s) => s.viewOpen);
  const hangup = useDirectCallStore((s) => s.hangup);

  if (!viewOpen || phase.kind === 'idle' || phase.kind === 'incoming') return null;
  if (phase.kind === 'active' || phase.kind === 'connecting') {
    return (
      <div className="direct-call-view is-stage">
        <CallStage />
      </div>
    );
  }

  const ringing = phase.kind === 'outgoing';
  return (
    <div className="direct-call-view">
      <div className={`direct-call-avatar${ringing ? ' is-ringing' : ''}`}>
        <Avatar url={phase.peer.avatar_url ?? undefined} username={phase.peer.username} className="direct-call-avatar-img" />
      </div>
      <h2 className="direct-call-name">{phase.peer.username}</h2>
      <p className="direct-call-status" role="status">
        {ringing ? t('directCall.calling') : t(REASON_KEY[phase.reason])}
      </p>
      {ringing && (
        <button type="button" className="direct-call-cancel" onClick={hangup} aria-label={t('directCall.cancel')}>
          <PhoneOff size={18} strokeWidth={1.8} />
          <span>{t('directCall.cancel')}</span>
        </button>
      )}
    </div>
  );
}
```

`DirectCallView.css`: колонка во всю высоту, контент по центру; аватар 96px с кольцом-пульсом (`@keyframes` + `prefers-reduced-motion: reduce` отключает анимацию — см. `docs/superpowers/backlog/post-redesign-backlog.md` про зацикленные анимации); кнопка «Отменить» — опасная (токен danger, как `.panel-icon-btn.is-danger`); `.is-stage` — `display:flex; flex:1; min-height:0`, чтобы `CallStage` занял всю высоту. Только токены дизайн-системы.

i18n (`ru` / `en`, секция `directCall`):
```ts
    calling: 'Звоним…',
    cancel: 'Отменить',
    endedEnded: 'Звонок завершён',
    endedMissed: 'Не отвечает',
    endedTimeout: 'Не отвечает',
    endedRejected: 'Звонок отклонён',
    endedFailed: 'Не удалось соединиться',
    inCallWith: 'В звонке с {{name}}',
    callingName: 'Звоним {{name}}',
```
```ts
    calling: 'Calling…',
    cancel: 'Cancel',
    endedEnded: 'Call ended',
    endedMissed: 'No answer',
    endedTimeout: 'No answer',
    endedRejected: 'Call declined',
    endedFailed: "Couldn't connect",
    inCallWith: 'In a call with {{name}}',
    callingName: 'Calling {{name}}',
```

Run тест → PASS.

- [ ] **Step 4: Сцена для 1:1** — в `useCallStageModel.ts` вернуть из модели `callKind` и `callPeer` (селекторы стора); в `CallStage.tsx:128`:

```tsx
        <h2 className="stage-title">
          {m.callKind === 'direct' && m.callPeer
            ? m.callPeer.username
            : m.callChannelName ? `#${m.callChannelName}` : t('call.groupCallTitle')}
        </h2>
```
Счётчик участников (`stage-count-chip`) для `direct` не показывать. Кнопка приглашения гостей уже скрыта (`invitePosition && m.callChannelId` — у 1:1 `callChannelId` null; кнопку-триггер проверить по `guestLinksEnabled`, который берёт сервер из `callServerId` = null → false). То же в `MobileCallScreen.tsx:251`.

- [ ] **Step 5: Основная колонка в `DesktopShell.tsx`**

```tsx
  const directViewOpen = useDirectCallStore((s) => s.viewOpen && s.phase.kind !== 'idle' && s.phase.kind !== 'incoming');
```
Тернарник `{currentServer ? (…) : (<HomeView />)}` обернуть так, чтобы при `directViewOpen` центральная колонка показывала `<DirectCallView />` вместо `channel-body` / `HomeView`, а `ServerList`, `ChannelSidebar` (если есть сервер) и `UserList` оставались:

```tsx
        {currentServer && (
          <ChannelSidebar … />
        )}
        {directViewOpen ? (
          <DirectCallView />
        ) : currentServer ? (
          <div className="channel-body" …>…</div>
        ) : (
          <HomeView />
        )}
```
(Сохранить существующие пропсы `ChannelSidebar` и `channel-body` без изменений — только вынести `ChannelSidebar` из фрагмента.)

- [ ] **Step 6: Навигация** в `useAppController.ts`: в начало `handleSelectChannel`, `handleSelectServer`, `handleSelectHome` — `useDirectCallStore.getState().closeView();`. `handleGoToCall` → принимает цель:

```ts
  const handleGoToCall = (target: CallTarget) => {
    if (target.kind === 'direct') {
      useDirectCallStore.getState().openView();
      return;
    }
    const targetServer = servers.find((s) => s.id === target.serverId);
    if (targetServer && targetServer.id !== currentServer?.id) {
      handleSelectServer(targetServer);
    }
    const channel = useServerStore.getState().channels.find((c) => c.id === target.channelId);
    if (channel) handleSelectChannel(channel);
  };
```
`export type CallTarget = { kind: 'channel'; serverId: string | null; channelId: string } | { kind: 'direct' };` — в `useAppController.ts`, тип `goToCall(target: CallTarget): void` в интерфейсе контроллера (≈34). Обновить вызов `goToCall` в мобильной оболочке и `CommandPalette`, если он там есть (`grep -rn "goToCall\|onGoToCall" src`).

- [ ] **Step 7: `CallDock.tsx`** для 1:1

```tsx
export function CallDock({ onGoToCall }: CallDockProps) {
  const t = useT();
  const { callRoomId, callKind, callPeer, callChannelId, callChannelName, callServerId, callServerName, status, isMuted, isVideoOff } =
    useCallStore();
  const directPhase = useDirectCallStore((s) => s.phase);
  const currentServerId = useServerStore((s) => s.currentServer?.id ?? null);

  // Исходящий вызов ещё без комнаты — док показывает «Звоним …» и отмену.
  if (directPhase.kind === 'outgoing') {
    return (
      <div className="call-dock">
        <button type="button" className="call-dock-target" onClick={() => onGoToCall({ kind: 'direct' })} title={t('call.goToCall')}>
          <span className="call-dock-status">{t('directCall.callingName', { name: directPhase.peer.username })}</span>
        </button>
        <div className="call-dock-actions">
          <button type="button" className="panel-icon-btn is-danger" onClick={() => useDirectCallStore.getState().hangup()} title={t('directCall.cancel')}>
            <PhoneOff size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    );
  }
  if (!callRoomId || status === 'idle') return null;

  const direct = callKind === 'direct';
  const otherServer = !direct && callServerId !== null && callServerId !== currentServerId;
  const goTo = () => (direct ? onGoToCall({ kind: 'direct' }) : onGoToCall({ kind: 'channel', serverId: callServerId, channelId: callChannelId! }));
  const leave = () => (direct ? useDirectCallStore.getState().hangup() : useCallStore.getState().leave());
  …
        <span className="call-dock-channel">
          {direct && callPeer
            ? t('directCall.inCallWith', { name: callPeer.username })
            : <>#{callChannelName}{otherServer && callServerName && <span className="call-dock-server"> · {callServerName}</span>}</>}
        </span>
  … кнопка «положить трубку»: onClick={leave}
```
(Имя `CallDockProps.onGoToCall` — тип `(target: CallTarget) => void`, импорт типа из `useAppController`.)

Аналогично в `useCallStageModel.ts:534` (кнопка выхода в сцене): `if (useCallStore.getState().callKind === 'direct') { useDirectCallStore.getState().hangup(); return; }` перед `leave()`. (Даже без этого `directCallStore` пошлёт `call_end ended` по `lastExit`, но `hangup()` сразу показывает исход.)

- [ ] **Step 8: Тест дока** `CallDock.direct.test.tsx`: при `callKind: 'direct'`, `callPeer: bob` — текст «В звонке с bob», клик по кнопке трубки зовёт `hangup`, клик по цели — `onGoToCall({kind:'direct'})`; при `phase.kind === 'outgoing'` — «Звоним bob».

- [ ] **Step 9: Гейты** — как в Task 8 Step 8.

- [ ] **Step 10: Checkpoint.**

---

### Task 10: Входящая карточка, пропущенные, тост ошибок, уведомления Electron

**Files:**
- Create: `client/src/components/directCall/IncomingCallCard.tsx`, `IncomingCallCard.css`
- Create: `client/src/components/directCall/MissedCallToasts.tsx`, `MissedCallToasts.css`
- Create: `client/src/components/directCall/CallErrorToast.tsx`
- Create: `client/src/services/desktopAttention.ts`
- Modify: `client/electron/main.ts`, `client/electron/preload.ts` (+ тип `electronAPI`, где он объявлен: `grep -rn "electronAPI" src/types`)
- Modify: `client/src/pages/app/DesktopShell.tsx`, `client/src/mobile/MobileShell.tsx` (смонтировать три компонента)
- Test: `client/src/components/directCall/__tests__/IncomingCallCard.test.tsx`, `MissedCallToasts.test.tsx`, `client/src/services/__tests__/desktopAttention.test.ts`

**Interfaces:**
- Consumes: `useDirectCallStore` (`phase`, `accept`, `reject`, `missed`, `dismissMissed`, `call`, `lastError`, `clearError`).
- Produces:
  ```ts
  // desktopAttention.ts
  export function requestAttention(title: string, body: string): void
  // electronAPI
  flashFrame(): void   // ipc 'window:flash'
  ```

- [ ] **Step 1: Падающий тест `IncomingCallCard.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IncomingCallCard } from '@/components/directCall/IncomingCallCard';
import { useDirectCallStore } from '@/stores/directCallStore';

const bob = { id: 'bob', username: 'bob' };

describe('IncomingCallCard', () => {
  beforeEach(() => useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false, missed: [], lastError: null }));

  it('скрыта без входящего', () => {
    const { container } = render(<IncomingCallCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('показывает звонящего и вызывает accept/reject', () => {
    const accept = vi.fn();
    const reject = vi.fn();
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: false }, accept, reject });
    render(<IncomingCallCard />);
    expect(screen.getByText('bob')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /принять|accept/i }));
    fireEvent.click(screen.getByRole('button', { name: /отклонить|decline/i }));
    expect(accept).toHaveBeenCalled();
    expect(reject).toHaveBeenCalled();
  });

  it('при wouldSwitch предупреждает о завершении текущего звонка', () => {
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: true } });
    render(<IncomingCallCard />);
    expect(screen.getByText(/завершит текущий|end your current/i)).toBeInTheDocument();
  });
});
```
Run → FAIL.

- [ ] **Step 2: `IncomingCallCard.tsx`**

```tsx
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Phone, PhoneOff } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { useDirectCallStore } from '@/stores/directCallStore';
import { requestAttention } from '@/services/desktopAttention';
import { useT } from '@/i18n';
import './IncomingCallCard.css';

/** Карточка входящего звонка 1:1 — без затемнения, приложение под ней живое. */
export function IncomingCallCard() {
  const t = useT();
  const phase = useDirectCallStore((s) => s.phase);
  const accept = useDirectCallStore((s) => s.accept);
  const reject = useDirectCallStore((s) => s.reject);
  const incoming = phase.kind === 'incoming' ? phase : null;

  useEffect(() => {
    if (incoming) requestAttention(t('directCall.incomingTitle'), t('directCall.incomingBody', { name: incoming.peer.username }));
    // Уведомление — один раз на вызов, не на каждый ре-рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.callId]);

  if (!incoming) return null;
  return createPortal(
    <div className="incoming-call-card" role="dialog" aria-live="assertive" aria-label={t('directCall.incomingTitle')}>
      <Avatar url={incoming.peer.avatar_url ?? undefined} username={incoming.peer.username} className="incoming-call-avatar" />
      <div className="incoming-call-text">
        <span className="incoming-call-name">{incoming.peer.username}</span>
        <span className="incoming-call-sub">{t('directCall.callingYou')}</span>
        {incoming.wouldSwitch && <span className="incoming-call-warn">{t('directCall.acceptEndsCurrent')}</span>}
      </div>
      <div className="incoming-call-actions">
        <button type="button" className="incoming-call-reject" onClick={reject} aria-label={t('directCall.decline')} title={t('directCall.decline')}>
          <PhoneOff size={18} strokeWidth={1.8} />
        </button>
        <button type="button" className="incoming-call-accept" onClick={accept} aria-label={t('directCall.accept')} title={t('directCall.accept')}>
          <Phone size={18} strokeWidth={1.8} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
```
CSS: `position: fixed; top: var(--space-…); left: 50%; transform: translateX(-50%)`, поверхность-карточка с тенью из токенов, `z-index` из шкалы дизайн-системы (выше тостов, ниже модалок); на ширине мобильного (`@media` с брейкпоинтом из `client/docs/`) — `left: 16px; right: 16px; transform: none` (полноширинная плашка). Кнопки — круглые 40px, accept — токен success, reject — danger. Без scrim.

Run тест → PASS.

- [ ] **Step 3: `MissedCallToasts.tsx`** + тест (показывает «Пропущенный звонок от bob»; «Перезвонить» вызывает `call(peer)` и `dismissMissed(callId)`; ✕ — только `dismissMissed`):

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PhoneMissed, Phone, X } from 'lucide-react';
import { useDirectCallStore } from '@/stores/directCallStore';
import { requestAttention } from '@/services/desktopAttention';
import { useT } from '@/i18n';
import './MissedCallToasts.css';

/** Пропущенные звонки: живут до закрытия, «Перезвонить» — новый вызов. */
export function MissedCallToasts() {
  const t = useT();
  const missed = useDirectCallStore((s) => s.missed);
  const call = useDirectCallStore((s) => s.call);
  const dismiss = useDirectCallStore((s) => s.dismissMissed);
  const notified = useRef(new Set<string>());

  useEffect(() => {
    for (const m of missed) {
      if (notified.current.has(m.callId)) continue;
      notified.current.add(m.callId);
      requestAttention(t('directCall.missedTitle'), t('directCall.missedFrom', { name: m.peer.username }));
    }
  }, [missed, t]);

  if (missed.length === 0) return null;
  return createPortal(
    <div className="missed-call-stack" aria-live="polite">
      {missed.map((m) => (
        <div key={m.callId} className="missed-call-toast">
          <PhoneMissed size={16} strokeWidth={1.8} className="missed-call-icon" />
          <span className="missed-call-text">{t('directCall.missedFrom', { name: m.peer.username })}</span>
          <button type="button" className="btn btn-primary missed-call-back" onClick={() => { dismiss(m.callId); call(m.peer); }}>
            <Phone size={14} strokeWidth={1.8} /> {t('directCall.callBack')}
          </button>
          <button type="button" className="modal-close-btn" onClick={() => dismiss(m.callId)} aria-label={t('common.close')}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
```
CSS: стопка `position: fixed; right/bottom` на десктопе, `top` на мобильной ширине.

- [ ] **Step 4: `CallErrorToast.tsx`** — по `lastError` показывает текст 5 с и вызывает `clearError()`; ключи: `forbidden` → `directCall.errForbidden` («Пользователь принимает звонки только от друзей»), `offline` → `errOffline` («Пользователь не в сети»), `busy` → `errBusy` («Пользователь сейчас занят»), `internal` → `errInternal` («Не удалось позвонить»); `not_found`/`invalid_state` — молча. Использовать существующий класс тоста ошибки (`error-toast`, был в `CallUI` — найти его стили: `grep -rn "\.error-toast" src`; если он жил в `CallUI.css` — перенести правило в `CallErrorToast.css`).

- [ ] **Step 5: `desktopAttention.ts`** + тест

```ts
/**
 * Привлечь внимание к звонку, когда окно не в фокусе: системное уведомление
 * (HTML5 Notification — в Electron оно нативное) и подсветка окна в панели
 * задач. В фокусе — ничего: карточка и так на экране.
 */
export function requestAttention(title: string, body: string): void {
  if (typeof document === 'undefined' || (document.hasFocus() && !document.hidden)) return;
  const api = (window as Window & typeof globalThis & { electronAPI?: { flashFrame?: () => void } }).electronAPI;
  api?.flashFrame?.();
  if (typeof Notification === 'undefined') return;
  const show = () => {
    try {
      const n = new Notification(title, { body, silent: true });
      n.onclick = () => window.focus();
    } catch {
      // Уведомления запрещены политикой — карточка всё равно появится.
    }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') void Notification.requestPermission().then((p) => { if (p === 'granted') show(); });
}
```
Тест: в фокусе — `Notification` не создаётся; не в фокусе с `permission: 'granted'` — создаётся и `flashFrame` вызван (мок `window.electronAPI`, `vi.spyOn(document, 'hasFocus')`, глобальный мок `Notification`).

- [ ] **Step 6: Electron**
`preload.ts` — в объект `electronAPI`: `flashFrame: () => ipcRenderer.send('window:flash'),`.
`main.ts` — рядом с другими `ipcMain.on`:
```ts
// Звонок 1:1 при свёрнутом окне: подсветка в панели задач до фокуса.
ipcMain.on('window:flash', () => {
  if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
});
```
и в месте создания окна: `mainWindow.on('focus', () => mainWindow?.flashFrame(false));` (имя переменной окна сверить в `main.ts`). Тип `electronAPI` в `src/types` дополнить `flashFrame?: () => void`.

- [ ] **Step 7: Смонтировать** `<IncomingCallCard />`, `<MissedCallToasts />`, `<CallErrorToast />` в `DesktopShell.tsx` (на месте удалённого `<CallUI />`) и в `MobileShell.tsx`.

- [ ] **Step 8: i18n** (`directCall`):
```ts
    incomingTitle: 'Входящий звонок',
    incomingBody: '{{name}} звонит вам',
    callingYou: 'Звонит вам…',
    acceptEndsCurrent: 'Принятие завершит текущий звонок',
    accept: 'Принять',
    decline: 'Отклонить',
    missedTitle: 'Пропущенный звонок',
    missedFrom: 'Пропущенный звонок от {{name}}',
    callBack: 'Перезвонить',
    errForbidden: 'Пользователь принимает звонки только от друзей',
    errOffline: 'Пользователь не в сети',
    errBusy: 'Пользователь сейчас занят',
    errInternal: 'Не удалось позвонить',
```
```ts
    incomingTitle: 'Incoming call',
    incomingBody: '{{name}} is calling you',
    callingYou: 'Calling you…',
    acceptEndsCurrent: 'Accepting will end your current call',
    accept: 'Accept',
    decline: 'Decline',
    missedTitle: 'Missed call',
    missedFrom: 'Missed call from {{name}}',
    callBack: 'Call back',
    errForbidden: 'This user only accepts calls from friends',
    errOffline: 'This user is offline',
    errBusy: 'This user is busy right now',
    errInternal: "Couldn't place the call",
```

- [ ] **Step 9: Гейты** — как в Task 8 Step 8.

- [ ] **Step 10: Checkpoint.**

---

### Task 11: Кнопка звонка в списке друзей (десктоп)

**Files:**
- Modify: `client/src/components/FriendRow.tsx`, `client/src/components/FriendsPanel.css` (или CSS строки — где живут стили `.friend-row`)
- Modify: `client/src/components/FriendsPanel.tsx`
- Test: `client/src/components/__tests__/FriendRow.call.test.tsx`

**Interfaces:**
- Consumes: `useDirectCallStore.getState().call(peer)`.
- Produces: `FriendRow` проп `onCall?: () => void` — кнопка «Позвонить» в `friend-row-actions` перед «⋮»; видна при наведении на строку и при `:focus-within`.

- [ ] **Step 1: Падающий тест**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FriendRow } from '@/components/FriendRow';

const user = { user_id: 'bob', username: 'bob' };

describe('FriendRow: звонок', () => {
  it('кнопка есть при onCall и вызывает его', () => {
    const onCall = vi.fn();
    render(<FriendRow user={user} online onCall={onCall} />);
    fireEvent.click(screen.getByRole('button', { name: /позвонить|call/i }));
    expect(onCall).toHaveBeenCalled();
  });

  it('без onCall кнопки нет', () => {
    render(<FriendRow user={user} online />);
    expect(screen.queryByRole('button', { name: /позвонить|call/i })).toBeNull();
  });
});
```
Run → FAIL.

- [ ] **Step 2: `FriendRow.tsx`** — проп `onCall?: () => void`; обновить JSDoc-комментарий у `actions` (фраза «“Позвонить” НЕ передаются сюда» больше неверна — звонок теперь отдельный проп; «Написать» по-прежнему ждёт VYC-91). В `friend-row-actions` перед кнопкой меню:

```tsx
        {onCall && (
          <button
            type="button"
            className="panel-icon-btn friend-row-call-btn"
            aria-label={t('friends.call', { name: user.username })}
            title={t('friends.call', { name: user.username })}
            onClick={onCall}
          >
            <Phone size={16} strokeWidth={1.8} />
          </button>
        )}
```
CSS: `.friend-row-call-btn { opacity: 0; }` и `.friend-row:hover .friend-row-call-btn, .friend-row:focus-within .friend-row-call-btn { opacity: 1; }`; на устройствах без hover (`@media (hover: none)`) — всегда видна. i18n `friends.call`: «Позвонить {{name}}» / «Call {{name}}».

- [ ] **Step 3: `FriendsPanel.tsx`** — во вкладках «В сети» и «Все» передавать

```tsx
onCall={onlineIds.has(f.user_id) ? () => useDirectCallStore.getState().call({ id: f.user_id, username: f.username, avatar_url: f.avatar_url }) : undefined}
```
(Поле аватара `FriendProfile` сверить: `grep -n "interface FriendProfile\|interface UserBrief" -A8 src/types/index.ts`.)

- [ ] **Step 4: Гейты** — как в Task 8 Step 8.

- [ ] **Step 5: Checkpoint.**

---

### Task 12: Мобильный — пилюля звонка, экран звонка, дозвон

**Files:**
- Modify: `client/src/mobile/components/CallPill.tsx`
- Modify: `client/src/mobile/screens/renderScreen.tsx` (`CallScreen`)
- Modify: `client/src/mobile/MobileShell.tsx` (переход на экран звонка при `viewOpen`)
- Modify: `client/src/mobile/call/CallAudioHost.tsx:155` (hangup медиа-сессии)
- Modify: `client/src/mobile/call/CallOverflowSheets.tsx` (без гостевого листа для 1:1 — уже по `callChannelId`, проверить)
- Test: `client/src/mobile/components/__tests__/CallPill.direct.test.tsx`, дополнить `src/mobile/screens/__tests__/` для `CallScreen`

**Interfaces:**
- Consumes: Task 7 (`useDirectCallStore`), Task 9 (`DirectCallView` — для фаз `outgoing`/`ending` на мобильном используется тот же компонент, его CSS уже адаптивен).

- [ ] **Step 1: `CallPill`** — та же логика, что у `CallDock` в Task 9 Step 7: `outgoing` → «Звоним {name}» + отмена; `callKind === 'direct'` → «В звонке с {name}», трубка → `hangup()`, клик → `onGoToCall({ kind: 'direct' })`. Тип `onGoToCall` — `CallTarget`. Тест — копия `CallDock.direct.test.tsx` под `CallPill`.

- [ ] **Step 2: `CallScreen`** в `renderScreen.tsx`:

```tsx
  const callKind = useCallStore((s) => s.callKind);
  const directPhase = useDirectCallStore((s) => s.phase.kind);
  …
  if (callKind !== 'direct' && (directPhase === 'outgoing' || directPhase === 'ending')) {
    return <DirectCallView />;
  }
  if (callKind === 'direct') {
    return (/* тот же MobileCallScreen + CallOverflowSheets, onOpenChat не передаётся (у 1:1 нет чата) */);
  }
  if (!callChannelId || callChannelId !== ctx.c.currentChannel?.id) return <div className="mobile-screen-loading" />;
```
Если `MobileCallScreen` требует `onOpenChat` — сделать проп опциональным и скрыть кнопку чата при его отсутствии. `DirectCallView` на мобильном должен рендериться независимо от `viewOpen` внутри экрана `call` — передать проп `force` или вынести тело в `DirectCallPanel` и использовать его в обоих местах (предпочтительно: `DirectCallView` принимает `{ ignoreViewOpen?: boolean }`).

- [ ] **Step 3: Навигация** в `MobileShell.tsx`: эффект — когда `useDirectCallStore` `viewOpen` становится `true` (исходящий или принятый), `nav.push({ kind: 'call' })`, если вершина стека не `call`; `onGoToCall({kind:'direct'})` → `openView()` + тот же push. Когда фаза уходит в `idle` и вершина — `call`, а `callRoomId === null` — `nav.back()`.

- [ ] **Step 4: `CallAudioHost.tsx:155`** — `setHandler(ms, HANGUP, () => (useCallStore.getState().callKind === 'direct' ? useDirectCallStore.getState().hangup() : useCallStore.getState().leave()));`

- [ ] **Step 5: Гейты** — как в Task 8 Step 8.

- [ ] **Step 6: Checkpoint.**

---

### Task 13: Спека, визуальная проверка, ручной e2e

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-direct-calls-design.md` (раздел «Поправки при планировании» — уже добавлен при написании плана; сверить, что совпадает с итогом реализации)

- [ ] **Step 1: Полные гейты**

Run (из корня): `make build && make vet && make test 2>&1 | grep -v "^ok\|no test files" | head`
Expected: пусто (всё `ok`).
Run: `cd client && npx tsc --noEmit; npx stylelint "src/**/*.css"; npm run check:i18n; npm test 2>&1 | tail -8`
Expected: 0 байт / 0 байт / «непереведённых строк не найдено.» / ровно 3 падения в `api.network-retry.test.ts`.

- [ ] **Step 2: Визуальная проверка CDP-харнессом** (`client/tools/verify/README.md`; dev-сервер — `npm run dev:vite`, не `npm run dev`). Снять в светлой и тёмной теме, на десктопной и мобильной ширине: `IncomingCallCard` (обычная и с «Принятие завершит…»), `DirectCallView` в фазе дозвона и исхода, `CallStage` 1:1 (заголовок — имя, без счётчика), `CallDock`/`CallPill` («Звоним…», «В звонке с …»), `MissedCallToasts`, кнопка звонка в `FriendRow` при наведении. Для состояний — выставлять `useDirectCallStore.setState(...)` через консоль страницы, как описано в README харнесса.

- [ ] **Step 3: Ручной e2e на двух аккаунтах** (локальный стек: API + SFU + клиент; два профиля браузера или браузер + Electron). Чек-лист — отметить каждый пункт с результатом:
  1. Друг онлайн → кнопка при наведении → гудки у A, карточка у B → «Принять» → оба в сцене, звук и видео в обе стороны.
  2. Участник сервера, не друг, `allow_dm_from = friends` → тост «только от друзей»; после смены настройки на `mutual_servers` — звонок проходит.
  3. «Отклонить» → у A «Звонок отклонён» + сигнал занято.
  4. Не отвечать 45 с → у A «Не отвечает», у B тост «Пропущенный звонок» → «Перезвонить» работает.
  5. A отменяет во время дозвона → у B карточка исчезает, тост пропущенного.
  6. «Завершить» у A, затем (новый звонок) у B — у второго звонок закрывается сам.
  7. B в голосовом канале → звонок от A: карточка с предупреждением → «Принять» → B вышел из канала (участники канала это видят), в звонке с A.
  8. В звонке 1:1 нажать «Войти в голосовой» в шапке чата → 1:1 закрылся у обоих, канал подключился.
  9. Перезагрузка вкладки B в звонке → вернулся за 20 с → звонок продолжился (A не получил «завершён»).
  10. Отключить сеть у B > 20 с → у A «Звонок завершён».
  11. Сайдбар каналов у третьего пользователя на общем сервере — комната 1:1 нигде не видна как голосовой канал (presence-фильтр).
  12. Мобильная ширина: всё из п.1, 3, 4 — через `CallPill` и экран звонка.

- [ ] **Step 4: Итог для пользователя** — список изменённых файлов (`git status`), результаты гейтов с выводом, результаты e2e по пунктам (что проверено, что не удалось проверить и почему). Коммит, `git add -f` для `docs/superpowers/**` и PR делает пользователь.

---

## Self-review (выполнен при написании)

- **Покрытие спеки:** сервер — Task 1–5 (данные, машина состояний, таймеры, протокол, токен, восстановление, presence); клиент — Task 6–7 (стор и протокол), Task 8 (удаление P2P, точки входа участников сервера и мобильных меню), Task 9 (экран, док, сцена, навигация), Task 10 (карточка, пропущенные, тосты, Electron), Task 11 (друзья), Task 12 (мобильный), Task 13 (гейты, визуал, e2e). Совместимость версий — специальных действий не требует (сервер молча игнорирует `webrtc_*`, Task 4 тест `TestWebRTCRelayRemoved`).
- **Типы сквозные:** `CallPeer`/`CallSnapshot`/`CallEndReason`/`CallErrorCode` (Task 6) используются в Task 7–12; `CallTarget` (Task 9) — в Task 9 и 12; `domain.CallUseCase` (Task 1) реализуют Task 2–3, потребляют Task 4–5; `markDirectCallRoom` (Task 6) вызывается только из `callStore`.
- **Review Focus:** №1 — `callStore.direct.test` «join в другую комнату… выходит из текущего» + `TestCallAccept_SwitchesReceiverAwayFromActiveCall`; №2 — тот же тест стора + `directCallStore.test` «выход из комнаты кнопкой → call_end ended»; №3 — `TestDisconnect_Active_ReconnectWithinGrace_KeepsCall` + `directCallStore.test` «call_state active после реконнекта»; №4 — `TestTick_RoomFilterSkipsCallRooms`; №5 — `TestCallStart_ReceiverAlreadyRinging_Busy` + `directCallStore.test` «call_error при старте».
