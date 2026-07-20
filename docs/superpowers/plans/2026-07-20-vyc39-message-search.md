# VYC-39: Поиск сообщений по контенту — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поиск сообщений по тексту в текущем канале: иконка/`Ctrl+Shift+F` открывают панель справа, клик по результату переносит к сообщению в ленте.

**Architecture:** Бэкенд — новый GIN-индекс pg_trgm, `Search`/`GetAround` в репозитории, usecase с `requireMembership`, два GET-эндпоинта. Клиент — новый компонент `MessageSearch` (панель справа), интеграция в `ChatArea` (иконка, хоткей, переход с подсветкой, режим просмотра истории).

**Tech Stack:** Go 1.22+ (net/http ServeMux, pgx/v5, testify), PostgreSQL (pg_trgm), React + TypeScript + zustand, CSS-переменные темы.

**Spec:** `docs/superpowers/specs/2026-07-20-vyc39-message-search-design.md`

## Global Constraints

- **НИКАКИХ git-коммитов и пушей** — коммиты делает пользователь сам (его правило, перекрывает шаблон скилла). Задача завершается прогоном тестов, не коммитом.
- Ветка: `VYC-39` (уже создана и активна).
- Тексты UI — на русском («Найдено», «Ничего не найдено», «К последним сообщениям»).
- Валидация query: после trim 2–100 символов (руны). Limit поиска: дефолт 25, кэп 50.
- Стили только на существующих CSS-переменных (`--bg-primary`, `--text-secondary`, `--brand-color`, `--border-color`, `--radius-md`…). Тем две (light/dark) — хардкод цветов запрещён.
- Сборка клиента требует Node 22: `source ~/.nvm/nvm.sh && nvm use 22`.
- Go-тесты: `cd /www/my/vycord/server && go test ./...`.

---

### Task 1: Миграция pg_trgm

**Files:**
- Create: `server/migrations/008_messages_search.up.sql`
- Create: `server/migrations/008_messages_search.down.sql`

**Interfaces:**
- Produces: GIN-индекс `idx_messages_content_trgm`, ускоряющий `content ILIKE '%...%'`. Код от него не зависит (только скорость), поэтому задача самостоятельная.

- [ ] **Step 1: Создать up-миграцию**

`server/migrations/008_messages_search.up.sql`:

```sql
-- +migrate Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON messages USING GIN (content gin_trgm_ops);
```

- [ ] **Step 2: Создать down-миграцию**

`server/migrations/008_messages_search.down.sql` (extension не дропаем — может понадобиться другим):

```sql
-- +migrate Down
DROP INDEX IF EXISTS idx_messages_content_trgm;
```

- [ ] **Step 3: Применить миграцию на локальной БД**

Run: `cd /www/my/vycord && make migrate-up`
Expected: без ошибок; если локальный Postgres не запущен — `make docker-up`, подождать 5 сек, повторить.

- [ ] **Step 4: Проверить, что индекс создан**

Run: `docker exec $(docker ps -qf name=postgres) psql -U mydiscrod -d mydiscrod -c "\di idx_messages_content_trgm"`
Expected: строка с `idx_messages_content_trgm | ... | gin`

---

### Task 2: Domain-тип + репозиторий Search/GetAround

**Files:**
- Modify: `server/internal/domain/message.go`
- Modify: `server/internal/repository/postgres/message.go`
- Create: `server/internal/repository/postgres/message_search_test.go`
- Modify: `server/internal/usecase/message_test.go` (мок `MockMessageRepository` — добавить методы, иначе перестанет компилироваться)

**Interfaces:**
- Produces:
  - `domain.MessageWithAuthor` = `Message` + `Username string \`json:"username"\``
  - `MessageRepository.Search(channelID uuid.UUID, query string, limit, offset int) ([]*MessageWithAuthor, int, error)` — результаты по убыванию даты + общий счётчик
  - `MessageRepository.GetAround(channelID, messageID uuid.UUID, limit int) ([]*Message, error)` — до `limit` сообщений до цели (включая её) + до `limit` после, по возрастанию; `ErrMessageNotFound` если цель не в этом канале
  - `escapeLike(s string) string` (приватная в пакете postgres)

- [ ] **Step 1: Написать падающий тест на escapeLike**

`server/internal/repository/postgres/message_search_test.go`:

```go
package postgres

import "testing"

func TestEscapeLike(t *testing.T) {
	cases := []struct{ in, want string }{
		{"100%", `100\%`},
		{"a_b", `a\_b`},
		{`back\slash`, `back\\slash`},
		{"обычный текст", "обычный текст"},
		{`%_\`, `\%\_\\`},
	}
	for _, c := range cases {
		if got := escapeLike(c.in); got != c.want {
			t.Errorf("escapeLike(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd /www/my/vycord/server && go test ./internal/repository/postgres/ -run TestEscapeLike -v`
Expected: FAIL (компиляция: `undefined: escapeLike`)

- [ ] **Step 3: Добавить domain-тип и методы интерфейса**

В `server/internal/domain/message.go` после структуры `Message` добавить:

```go
// MessageWithAuthor — сообщение с юзернеймом автора: результаты поиска
// отдаются сразу с именем, чтобы клиент не делал N запросов за авторами.
type MessageWithAuthor struct {
	Message
	Username string `json:"username"`
}
```

В интерфейс `MessageRepository` добавить две строки:

```go
	Search(channelID uuid.UUID, query string, limit, offset int) ([]*MessageWithAuthor, int, error)
	GetAround(channelID, messageID uuid.UUID, limit int) ([]*Message, error)
```

- [ ] **Step 4: Реализовать escapeLike, Search и GetAround в репозитории**

В `server/internal/repository/postgres/message.go` добавить в конец файла:

```go
// escapeLike экранирует спецсимволы LIKE-шаблона, чтобы пользовательский
// запрос искался как буквальная подстрока.
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func (r *messageRepository) Search(channelID uuid.UUID, query string, limit, offset int) ([]*domain.MessageWithAuthor, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pattern := "%" + escapeLike(query) + "%"

	var total int
	countQuery := `SELECT COUNT(*) FROM messages WHERE channel_id = $1 AND content ILIKE $2 ESCAPE '\'`
	if err := r.db.QueryRow(ctx, countQuery, channelID, pattern).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count search results: %w", err)
	}

	searchQuery := `
		SELECT m.id, m.channel_id, m.user_id, m.content, m.attachments, m.created_at, m.updated_at, u.username
		FROM messages m
		JOIN users u ON u.id = m.user_id
		WHERE m.channel_id = $1 AND m.content ILIKE $2 ESCAPE '\'
		ORDER BY m.created_at DESC
		LIMIT $3 OFFSET $4
	`
	rows, err := r.db.Query(ctx, searchQuery, channelID, pattern, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to search messages: %w", err)
	}
	defer rows.Close()

	var results []*domain.MessageWithAuthor
	for rows.Next() {
		res := &domain.MessageWithAuthor{}
		if err := rows.Scan(
			&res.ID,
			&res.ChannelID,
			&res.UserID,
			&res.Content,
			&res.Attachments,
			&res.CreatedAt,
			&res.UpdatedAt,
			&res.Username,
		); err != nil {
			return nil, 0, fmt.Errorf("failed to scan search result: %w", err)
		}
		results = append(results, res)
	}

	return results, total, nil
}

func (r *messageRepository) GetAround(channelID, messageID uuid.UUID, limit int) ([]*domain.Message, error) {
	target, err := r.GetByID(messageID)
	if err != nil {
		return nil, err
	}
	if target.ChannelID != channelID {
		return nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Контекст вокруг цели: limit сообщений до (включая цель) + limit после.
	// Тай-брейк по id, т.к. created_at не уникален.
	query := `
		(
			SELECT id, channel_id, user_id, content, attachments, created_at, updated_at
			FROM messages
			WHERE channel_id = $1 AND (created_at, id) <= ($2, $3)
			ORDER BY created_at DESC, id DESC
			LIMIT $4
		)
		UNION ALL
		(
			SELECT id, channel_id, user_id, content, attachments, created_at, updated_at
			FROM messages
			WHERE channel_id = $1 AND (created_at, id) > ($2, $3)
			ORDER BY created_at ASC, id ASC
			LIMIT $4
		)
	`
	rows, err := r.db.Query(ctx, query, channelID, target.CreatedAt, target.ID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages around: %w", err)
	}
	defer rows.Close()

	var messages []*domain.Message
	for rows.Next() {
		msg := &domain.Message{}
		if err := rows.Scan(
			&msg.ID,
			&msg.ChannelID,
			&msg.UserID,
			&msg.Content,
			&msg.Attachments,
			&msg.CreatedAt,
			&msg.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan message: %w", err)
		}
		messages = append(messages, msg)
	}

	sort.Slice(messages, func(i, j int) bool {
		if !messages[i].CreatedAt.Equal(messages[j].CreatedAt) {
			return messages[i].CreatedAt.Before(messages[j].CreatedAt)
		}
		return messages[i].ID.String() < messages[j].ID.String()
	})

	return messages, nil
}
```

В импорты `message.go` добавить `"sort"`.

- [ ] **Step 5: Обновить мок MockMessageRepository**

В `server/internal/usecase/message_test.go` после метода `Delete` мока добавить:

```go
func (m *MockMessageRepository) Search(channelID uuid.UUID, query string, limit, offset int) ([]*domain.MessageWithAuthor, int, error) {
	args := m.Called(channelID, query, limit, offset)
	if args.Get(0) == nil {
		return nil, args.Int(1), args.Error(2)
	}
	return args.Get(0).([]*domain.MessageWithAuthor), args.Int(1), args.Error(2)
}
func (m *MockMessageRepository) GetAround(channelID, messageID uuid.UUID, limit int) ([]*domain.Message, error) {
	args := m.Called(channelID, messageID, limit)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Message), args.Error(1)
}
```

- [ ] **Step 6: Прогнать тесты**

Run: `cd /www/my/vycord/server && go test ./internal/repository/postgres/ -run TestEscapeLike -v && go build ./...`
Expected: `TestEscapeLike` PASS, сборка без ошибок.

Run: `cd /www/my/vycord/server && go test ./...`
Expected: все PASS.

**Стоп: пользователь коммитит сам.**

---

### Task 3: Usecase SearchMessages / GetMessagesAround

**Files:**
- Modify: `server/internal/domain/usecase.go` (интерфейс `MessageUseCase`)
- Modify: `server/internal/usecase/message.go`
- Modify: `server/internal/usecase/message_test.go` (тесты)
- Modify: `server/internal/delivery/http/handler/message_test.go` (мок `mockMessageUseCase` — добавить методы, иначе перестанет компилироваться)

**Interfaces:**
- Consumes: `MessageRepository.Search` / `GetAround` из Task 2 (сигнатуры там).
- Produces:
  - `MessageUseCase.SearchMessages(channelID, userID uuid.UUID, query string, limit, offset int) ([]*MessageWithAuthor, int, error)` — limit нормализуется: `<=0 → 25`, `>50 → 50`
  - `MessageUseCase.GetMessagesAround(channelID, messageID, userID uuid.UUID, limit int) ([]*Message, error)` — limit нормализуется так же

- [ ] **Step 1: Написать падающие тесты usecase**

В конец `server/internal/usecase/message_test.go` добавить:

```go
func TestSearchMessages_Member_ReturnsResults(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	want := []*domain.MessageWithAuthor{
		{Message: domain.Message{ID: uuid.New(), ChannelID: channelID, Content: "нашёл баг"}, Username: "petya"},
	}
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("Search", channelID, "баг", 25, 0).Return(want, 1, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	got, total, err := uc.SearchMessages(channelID, userID, "баг", 0, 0) // limit 0 -> нормализуется в 25

	assert.NoError(t, err)
	assert.Equal(t, want, got)
	assert.Equal(t, 1, total)
}

func TestSearchMessages_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	got, total, err := uc.SearchMessages(channelID, userID, "баг", 25, 0)

	assert.Nil(t, got)
	assert.Equal(t, 0, total)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Search", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestSearchMessages_LimitCapped(t *testing.T) {
	channelID, serverID, ownerID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	msgRepo.On("Search", channelID, "баг", 50, 0).Return([]*domain.MessageWithAuthor{}, 0, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	_, _, err := uc.SearchMessages(channelID, ownerID, "баг", 500, 0) // 500 -> кэп 50

	assert.NoError(t, err)
	msgRepo.AssertCalled(t, "Search", channelID, "баг", 50, 0)
}

func TestGetMessagesAround_Member_ReturnsMessages(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	want := []*domain.Message{{ID: messageID, ChannelID: channelID, Content: "старое"}}
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("GetAround", channelID, messageID, 25).Return(want, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	got, err := uc.GetMessagesAround(channelID, messageID, userID, 0) // limit 0 -> 25

	assert.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestGetMessagesAround_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	got, err := uc.GetMessagesAround(channelID, messageID, userID, 25)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "GetAround", mock.Anything, mock.Anything, mock.Anything)
}
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd /www/my/vycord/server && go test ./internal/usecase/ -run 'TestSearchMessages|TestGetMessagesAround' -v`
Expected: FAIL (компиляция: `uc.SearchMessages undefined`)

- [ ] **Step 3: Добавить методы в интерфейс MessageUseCase**

В `server/internal/domain/usecase.go` в интерфейс `MessageUseCase` добавить:

```go
	SearchMessages(channelID, userID uuid.UUID, query string, limit, offset int) ([]*MessageWithAuthor, int, error)
	GetMessagesAround(channelID, messageID, userID uuid.UUID, limit int) ([]*Message, error)
```

- [ ] **Step 4: Реализовать в usecase**

В конец `server/internal/usecase/message.go` добавить:

```go
func normalizeSearchLimit(limit int) int {
	if limit <= 0 {
		return 25
	}
	if limit > 50 {
		return 50
	}
	return limit
}

func (uc *messageUseCase) SearchMessages(channelID, userID uuid.UUID, query string, limit, offset int) ([]*domain.MessageWithAuthor, int, error) {
	if _, err := uc.requireMembership(channelID, userID); err != nil {
		return nil, 0, err
	}

	results, total, err := uc.messageRepo.Search(channelID, query, normalizeSearchLimit(limit), offset)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to search messages: %w", err)
	}
	return results, total, nil
}

func (uc *messageUseCase) GetMessagesAround(channelID, messageID, userID uuid.UUID, limit int) ([]*domain.Message, error) {
	if _, err := uc.requireMembership(channelID, userID); err != nil {
		return nil, err
	}

	messages, err := uc.messageRepo.GetAround(channelID, messageID, normalizeSearchLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("failed to get messages around: %w", err)
	}
	return messages, nil
}
```

- [ ] **Step 5: Обновить мок mockMessageUseCase в handler-тестах**

В `server/internal/delivery/http/handler/message_test.go` после метода `DeleteMessage` мока добавить:

```go
func (m *mockMessageUseCase) SearchMessages(channelID, userID uuid.UUID, query string, limit, offset int) ([]*domain.MessageWithAuthor, int, error) {
	args := m.Called(channelID, userID, query, limit, offset)
	results, _ := args.Get(0).([]*domain.MessageWithAuthor)
	return results, args.Int(1), args.Error(2)
}
func (m *mockMessageUseCase) GetMessagesAround(channelID, messageID, userID uuid.UUID, limit int) ([]*domain.Message, error) {
	args := m.Called(channelID, messageID, userID, limit)
	msgs, _ := args.Get(0).([]*domain.Message)
	return msgs, args.Error(1)
}
```

- [ ] **Step 6: Прогнать тесты**

Run: `cd /www/my/vycord/server && go test ./...`
Expected: все PASS, включая новые `TestSearchMessages_*` и `TestGetMessagesAround_*`.

**Стоп: пользователь коммитит сам.**

---

### Task 4: HTTP-хендлеры + роуты

**Files:**
- Modify: `server/internal/delivery/http/handler/message.go`
- Modify: `server/internal/delivery/http/handler/message_test.go` (тесты)
- Modify: `server/cmd/api/main.go` (роуты, после строки с `GET .../messages`, сейчас ~131)

**Interfaces:**
- Consumes: `MessageUseCase.SearchMessages` / `GetMessagesAround` из Task 3.
- Produces (для клиента, Task 5):
  - `GET /api/v1/channels/{channel_id}/messages/search?q=&limit=&offset=` → `200 {"results": [{...message, "username": "..."}], "total": N}`; `400` при q < 2 или > 100 символов
  - `GET /api/v1/channels/{channel_id}/messages/around/{message_id}?limit=` → `200 [Message...]` по возрастанию даты

- [ ] **Step 1: Написать падающие тесты хендлеров**

В конец `server/internal/delivery/http/handler/message_test.go` добавить:

```go
func TestMessageHandler_SearchMessages_ShortQuery_BadRequest(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockMessageUseCase)
	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	channelID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/channels/"+channelID.String()+"/messages/search?q=a", nil)
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	h.SearchMessages(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	mockUC.AssertNotCalled(t, "SearchMessages", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestMessageHandler_SearchMessages_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockMessageUseCase)

	channelID, userID := uuid.New(), uuid.New()
	results := []*domain.MessageWithAuthor{
		{Message: domain.Message{ID: uuid.New(), ChannelID: channelID, Content: "нашёл баг"}, Username: "petya"},
	}
	// limit в запросе не задан -> хендлер передаёт 0, нормализация в usecase
	mockUC.On("SearchMessages", channelID, userID, "баг", 0, 0).Return(results, 1, nil)

	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/channels/"+channelID.String()+"/messages/search?q="+url.QueryEscape("баг"), nil)
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.SearchMessages(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp SearchMessagesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp.Total != 1 || len(resp.Results) != 1 || resp.Results[0].Username != "petya" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestMessageHandler_GetMessagesAround_InvalidMessageID_BadRequest(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockMessageUseCase)
	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	channelID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/channels/"+channelID.String()+"/messages/around/not-a-uuid", nil)
	req.SetPathValue("channel_id", channelID.String())
	req.SetPathValue("message_id", "not-a-uuid")
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	h.GetMessagesAround(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestMessageHandler_GetMessagesAround_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockMessageUseCase)

	channelID, userID, messageID := uuid.New(), uuid.New(), uuid.New()
	msgs := []*domain.Message{{ID: messageID, ChannelID: channelID, Content: "старое"}}
	// limit в запросе не задан -> хендлер передаёт 0, нормализация в usecase
	mockUC.On("GetMessagesAround", channelID, messageID, userID, 0).Return(msgs, nil)

	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/channels/"+channelID.String()+"/messages/around/"+messageID.String(), nil)
	req.SetPathValue("channel_id", channelID.String())
	req.SetPathValue("message_id", messageID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.GetMessagesAround(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var got []*domain.Message
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if len(got) != 1 || got[0].ID != messageID {
		t.Fatalf("unexpected response: %+v", got)
	}
}
```

В импорты тестового файла добавить `"net/url"`.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd /www/my/vycord/server && go test ./internal/delivery/http/handler/ -run TestMessageHandler_Search -v`
Expected: FAIL (компиляция: `h.SearchMessages undefined`)

- [ ] **Step 3: Реализовать хендлеры**

В `server/internal/delivery/http/handler/message.go` после `GetMessages` добавить:

```go
type SearchMessagesResponse struct {
	Results []*domain.MessageWithAuthor `json:"results"`
	Total   int                         `json:"total"`
}

func (h *MessageHandler) SearchMessages(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if n := utf8.RuneCountInString(query); n < 2 || n > 100 {
		h.sendError(w, http.StatusBadRequest, "search query must be 2-100 characters")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset < 0 {
		offset = 0
	}

	results, total, err := h.messageUseCase.SearchMessages(channelID, userID, query, limit, offset)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	if results == nil {
		results = []*domain.MessageWithAuthor{}
	}

	h.sendJSON(w, http.StatusOK, SearchMessagesResponse{Results: results, Total: total})
}

func (h *MessageHandler) GetMessagesAround(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}
	messageID, err := uuid.Parse(r.PathValue("message_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid message id")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	messages, err := h.messageUseCase.GetMessagesAround(channelID, messageID, userID, limit)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	if messages == nil {
		messages = []*domain.Message{}
	}

	h.sendJSON(w, http.StatusOK, messages)
}
```

В импорты `message.go` добавить `"strings"` и `"unicode/utf8"`.

- [ ] **Step 4: Зарегистрировать роуты**

В `server/cmd/api/main.go` после строки `router.HandleFunc("GET /api/v1/channels/{channel_id}/messages", ...)` добавить:

```go
	router.HandleFunc("GET /api/v1/channels/{channel_id}/messages/search", authMid.RequireAuth(messageHandler.SearchMessages))
	router.HandleFunc("GET /api/v1/channels/{channel_id}/messages/around/{message_id}", authMid.RequireAuth(messageHandler.GetMessagesAround))
```

- [ ] **Step 5: Прогнать все тесты**

Run: `cd /www/my/vycord/server && go test ./... && go vet ./...`
Expected: все PASS, vet чистый.

**Стоп: пользователь коммитит сам.**

---

### Task 5: Клиент — типы и API-методы

**Files:**
- Modify: `client/src/types/index.ts` (после `interface Message`)
- Modify: `client/src/services/api.ts` (секция `// Messages`)

**Interfaces:**
- Consumes: эндпоинты из Task 4.
- Produces (для Task 6–7):
  - `MessageWithAuthor extends Message { username: string }`
  - `MessageSearchResponse { results: MessageWithAuthor[]; total: number }`
  - `apiService.searchMessages(channelId: string, query: string, limit = 25, offset = 0)`
  - `apiService.getMessagesAround(channelId: string, messageId: string)`

- [ ] **Step 1: Добавить типы**

В `client/src/types/index.ts` после `interface Message` добавить:

```ts
export interface MessageWithAuthor extends Message {
  username: string;
}

export interface MessageSearchResponse {
  results: MessageWithAuthor[];
  total: number;
}
```

- [ ] **Step 2: Добавить API-методы**

В `client/src/services/api.ts` после `getMessages` добавить:

```ts
  async searchMessages(channelId: string, query: string, limit = 25, offset = 0) {
    return this.request(
      `/api/v1/channels/${channelId}/messages/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`
    );
  }

  async getMessagesAround(channelId: string, messageId: string) {
    return this.request(`/api/v1/channels/${channelId}/messages/around/${messageId}`);
  }
```

- [ ] **Step 3: Проверить типы**

Run: `cd /www/my/vycord/client && source ~/.nvm/nvm.sh && nvm use 22 && npx tsc --noEmit`
Expected: без ошибок.

**Стоп: пользователь коммитит сам.**

---

### Task 6: Компонент MessageSearch (панель поиска)

**Files:**
- Create: `client/src/components/MessageSearch.tsx`
- Create: `client/src/components/MessageSearch.css`

**Interfaces:**
- Consumes: `apiService.searchMessages` из Task 5; типы `Channel`, `MessageWithAuthor`, `MessageSearchResponse`.
- Produces (для Task 7): `<MessageSearch channel={Channel} onJumpToMessage={(messageId: string) => void} onClose={() => void} />` — панель абсолютным позиционированием прижата к правому краю ближайшего `position: relative` предка, ниже шапки 56px.

- [ ] **Step 1: Создать компонент**

`client/src/components/MessageSearch.tsx`:

```tsx
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { apiService } from '@/services/api';
import type { Channel, MessageWithAuthor, MessageSearchResponse } from '@/types';
import './MessageSearch.css';

const MIN_QUERY_LEN = 2;
const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;

interface MessageSearchProps {
  channel: Channel;
  onJumpToMessage: (messageId: string) => void;
  onClose: () => void;
}

function formatResultDate(dateStr: string) {
  const date = new Date(dateStr);
  const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

// Обрезает длинный текст окном вокруг первого совпадения.
function snippetAround(content: string, query: string, radius = 80): string {
  if (content.length <= radius * 2) return content;
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return `${content.slice(0, radius * 2)}…`;
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + query.length + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

function highlightMatches(text: string, query: string): ReactNode[] {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: ReactNode[] = [];
  let pos = 0;
  let key = 0;
  for (;;) {
    const idx = lower.indexOf(q, pos);
    if (idx === -1) break;
    if (idx > pos) parts.push(text.slice(pos, idx));
    parts.push(<mark key={key++}>{text.slice(idx, idx + q.length)}</mark>);
    pos = idx + q.length;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

export function MessageSearch({ channel, onJumpToMessage, onClose }: MessageSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessageWithAuthor[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LEN) {
      setResults([]);
      setTotal(0);
      setSearched(false);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = (await apiService.searchMessages(channel.id, trimmed, PAGE_SIZE, 0)) as MessageSearchResponse;
        if (cancelled) return;
        setResults(data.results);
        setTotal(data.total);
        setError(null);
        setSearched(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось выполнить поиск');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, channel.id]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = (await apiService.searchMessages(channel.id, trimmed, PAGE_SIZE, results.length)) as MessageSearchResponse;
      setResults((prev) => [...prev, ...data.results]);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить поиск');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <aside className="message-search" aria-label="Поиск сообщений">
      <div className="message-search-header">
        <div className="message-search-input-wrap">
          <svg className="message-search-input-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={`Поиск в #${channel.name}`}
            maxLength={100}
          />
          {query && (
            <button type="button" className="message-search-clear" aria-label="Очистить" onClick={() => setQuery('')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
        <button type="button" className="message-search-close" aria-label="Закрыть поиск" onClick={onClose}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {searched && !loading && !error && (
        <div className="message-search-count">Найдено: {total}</div>
      )}

      <div className="message-search-body">
        {trimmed.length < MIN_QUERY_LEN ? (
          <div className="message-search-hint">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <p>Введите минимум {MIN_QUERY_LEN} символа для поиска по каналу</p>
          </div>
        ) : loading ? (
          <div className="message-search-hint">
            <div className="message-search-spinner" aria-label="Загрузка" />
          </div>
        ) : error ? (
          <div className="message-search-hint message-search-error">
            <p>{error}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="message-search-hint">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            <p>Ничего не найдено по запросу «{trimmed}»</p>
          </div>
        ) : (
          <>
            {results.map((msg) => (
              <button
                key={msg.id}
                type="button"
                className="message-search-result"
                onClick={() => onJumpToMessage(msg.id)}
              >
                <div className="message-search-result-avatar">
                  {msg.username.charAt(0).toUpperCase()}
                </div>
                <div className="message-search-result-main">
                  <div className="message-search-result-meta">
                    <span className="message-search-result-author">{msg.username}</span>
                    <span className="message-search-result-date">{formatResultDate(msg.created_at)}</span>
                  </div>
                  <p className="message-search-result-text">
                    {highlightMatches(snippetAround(msg.content, trimmed), trimmed)}
                  </p>
                </div>
              </button>
            ))}
            {results.length < total && (
              <button
                type="button"
                className="message-search-more"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Загрузка…' : 'Показать ещё'}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Создать стили**

`client/src/components/MessageSearch.css`:

```css
/* ── Search Panel ── */
.message-search {
  position: absolute;
  top: 56px; /* высота .chat-header */
  right: 0;
  bottom: 0;
  width: 360px;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-color);
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
  z-index: 20;
  animation: message-search-slide-in 0.18s ease-out;
}

@keyframes message-search-slide-in {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.message-search-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
}

.message-search-input-wrap {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}

.message-search-input-icon {
  position: absolute;
  left: 10px;
  color: var(--text-muted);
  pointer-events: none;
}

.message-search-input-wrap input {
  width: 100%;
  padding: 8px 30px 8px 30px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color 0.15s;
}

.message-search-input-wrap input:focus {
  border-color: var(--brand-color);
}

.message-search-input-wrap input::placeholder {
  color: var(--text-muted);
}

.message-search-clear {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  padding: 2px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
}

.message-search-clear:hover {
  color: var(--text-primary);
}

.message-search-close {
  display: flex;
  align-items: center;
  padding: 6px;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.message-search-close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.message-search-count {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  border-bottom: 1px solid var(--border-color);
}

.message-search-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-search-hint {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  color: var(--text-muted);
  text-align: center;
}

.message-search-hint p {
  font-size: 13px;
  line-height: 1.5;
}

.message-search-error {
  color: var(--red-color);
}

.message-search-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--bg-tertiary);
  border-top-color: var(--brand-color);
  border-radius: var(--radius-full);
  animation: message-search-spin 0.7s linear infinite;
}

@keyframes message-search-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Result Card ── */
.message-search-result {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 10px;
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.12s;
}

.message-search-result:hover {
  background: var(--bg-hover);
}

.message-search-result-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: var(--brand-color);
  border-radius: var(--radius-full);
}

.message-search-result-main {
  flex: 1;
  min-width: 0;
}

.message-search-result-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
}

.message-search-result-author {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.message-search-result-date {
  font-size: 11px;
  color: var(--text-muted);
}

.message-search-result-text {
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-secondary);
  word-break: break-word;
  white-space: pre-wrap;
}

.message-search-result-text mark {
  padding: 0 1px;
  color: var(--text-primary);
  background: var(--brand-subtle);
  border-radius: 2px;
  box-shadow: 0 1px 0 var(--brand-color);
}

.message-search-more {
  margin: 6px 8px 10px;
  padding: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-color);
  background: var(--brand-subtle);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.message-search-more:hover:not(:disabled) {
  background: var(--brand-100);
}

.message-search-more:disabled {
  opacity: 0.6;
  cursor: default;
}

/* Мобильный: панель на всю ширину */
@media (max-width: 768px) {
  .message-search {
    width: 100%;
    border-left: none;
  }
}
```

- [ ] **Step 3: Проверить типы**

Run: `cd /www/my/vycord/client && source ~/.nvm/nvm.sh && nvm use 22 && npx tsc --noEmit`
Expected: без ошибок (компонент пока никем не используется — это нормально).

**Стоп: пользователь коммитит сам.**

---

### Task 7: Интеграция в ChatArea (иконка, хоткей, переход, режим истории)

**Files:**
- Modify: `client/src/components/ChatArea.tsx`
- Modify: `client/src/components/ChatArea.css`

**Interfaces:**
- Consumes: `<MessageSearch>` из Task 6, `apiService.getMessagesAround`/`getMessages` из Task 5, `useMessageStore().setMessages`.
- Produces: готовая фича end-to-end.

- [ ] **Step 1: Импорты и стейт**

В `client/src/components/ChatArea.tsx`:

Добавить импорт после существующих:

```tsx
import { MessageSearch } from '@/components/MessageSearch';
```

В деструктуризацию стора добавить `setMessages`:

```tsx
const { messages, setMessages, addMessage, updateMessage, removeMessage } = useMessageStore();
```

После `const chatMessagesRef = ...` добавить стейт:

```tsx
const [searchOpen, setSearchOpen] = useState(false);
const [historyMode, setHistoryMode] = useState(false);
const [highlightedId, setHighlightedId] = useState<string | null>(null);
```

- [ ] **Step 2: Guard автоскролла + сброс при смене канала + хоткей**

Заменить существующий эффект автоскролла:

```tsx
useEffect(() => {
  scrollToBottom();
}, [messages]);
```

на:

```tsx
useEffect(() => {
  if (historyMode) return; // в режиме просмотра истории не утаскиваем вниз
  scrollToBottom();
}, [messages, historyMode]);
```

В существующий эффект по `[channel?.id]` (тот, что делает `inputRef.current?.focus()`) добавить в конец тела:

```tsx
setSearchOpen(false);
setHistoryMode(false);
setHighlightedId(null);
```

После него добавить эффект хоткея:

```tsx
useEffect(() => {
  const handler = (e: globalThis.KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f' || e.code === 'KeyF')) {
      e.preventDefault();
      setSearchOpen((open) => !open);
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, []);
```

- [ ] **Step 3: Логика перехода и возврата**

После функции `scrollToBottom` добавить:

```tsx
const jumpToMessage = async (messageId: string) => {
  if (!channel) return;
  try {
    const context = await apiService.getMessagesAround(channel.id, messageId) as Message[];
    setHistoryMode(true);
    setMessages(context);
    setHighlightedId(messageId);
    requestAnimationFrame(() => {
      chatMessagesRef.current
        ?.querySelector(`[data-message-id="${messageId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    window.setTimeout(() => setHighlightedId(null), 2200);
  } catch (err) {
    console.error('Failed to jump to message:', err);
    setSendError(err instanceof Error ? err.message : 'Не удалось перейти к сообщению');
    setTimeout(() => setSendError(null), 5000);
  }
};

const backToLatest = async () => {
  if (!channel) return;
  try {
    const latest = await apiService.getMessages(channel.id) as Message[];
    setHistoryMode(false);
    setHighlightedId(null);
    setMessages(latest);
  } catch (err) {
    console.error('Failed to load latest messages:', err);
  }
};
```

- [ ] **Step 4: Кнопка поиска в шапке**

В JSX шапки (`<div className="chat-header">`) перед блоком `{onShowMembers && (` добавить:

```tsx
<button
  type="button"
  className={`chat-search-btn${searchOpen ? ' active' : ''}`}
  onClick={() => setSearchOpen((open) => !open)}
  aria-label="Поиск сообщений"
  title="Поиск (Ctrl+Shift+F)"
>
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
</button>
```

- [ ] **Step 5: Атрибут и подсветка сообщения**

В рендере сообщений заменить открывающий div:

```tsx
<div
  key={msg.id}
  className={`message ${isCompact ? 'compact' : ''} ${isFromMe ? 'self' : 'other'}`}
>
```

на:

```tsx
<div
  key={msg.id}
  data-message-id={msg.id}
  className={`message ${isCompact ? 'compact' : ''} ${isFromMe ? 'self' : 'other'}${highlightedId === msg.id ? ' jump-highlight' : ''}`}
>
```

- [ ] **Step 6: Рендер панели и кнопки возврата**

Перед закрывающим `</main>` (после блоков FloatingQuoteButton) добавить:

```tsx
{searchOpen && (
  <MessageSearch
    channel={channel}
    onJumpToMessage={jumpToMessage}
    onClose={() => setSearchOpen(false)}
  />
)}
{historyMode && (
  <button type="button" className="back-to-latest-btn" onClick={backToLatest}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
    <span>К последним сообщениям</span>
  </button>
)}
```

- [ ] **Step 7: Стили в ChatArea.css**

В правило `.chat-area` добавить строку `position: relative;` (панель и кнопка возврата позиционируются относительно него).

В конец файла добавить:

```css
/* ── Message Search integration ── */
.chat-search-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  padding: 6px;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}

.chat-search-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.chat-search-btn.active {
  color: var(--brand-color);
  background: var(--brand-subtle);
}

.message.jump-highlight {
  animation: jump-flash 2.2s ease-out;
  border-radius: var(--radius-md);
}

@keyframes jump-flash {
  0% {
    background: var(--brand-subtle);
    box-shadow: inset 3px 0 0 var(--brand-color);
  }
  60% {
    background: var(--brand-subtle);
    box-shadow: inset 3px 0 0 var(--brand-color);
  }
  100% {
    background: transparent;
    box-shadow: none;
  }
}

.back-to-latest-btn {
  position: absolute;
  bottom: 96px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--brand-color);
  border: none;
  border-radius: var(--radius-xl);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  z-index: 15;
  transition: background 0.12s;
}

.back-to-latest-btn:hover {
  background: var(--brand-hover);
}
```

Примечание: `.mobile-members-btn` раньше мог полагаться на то, что он последний в шапке; `chat-search-btn` теперь берёт `margin-left: auto` на себя, кнопка участников остаётся справа от него. Проверить визуально на мобильной ширине; если у `.mobile-members-btn` тоже стоит `margin-left: auto` — конфликтов нет (auto схлопнется у первого).

- [ ] **Step 8: Проверить типы и сборку**

Run: `cd /www/my/vycord/client && source ~/.nvm/nvm.sh && nvm use 22 && npx tsc --noEmit`
Expected: без ошибок.

**Стоп: пользователь коммитит сам.**

---

### Task 8: Финальная верификация

**Files:** нет новых.

- [ ] **Step 1: Все Go-тесты и vet**

Run: `cd /www/my/vycord/server && go test ./... && go vet ./...`
Expected: все PASS, vet чистый.

- [ ] **Step 2: Полная сборка клиента**

Run: `cd /www/my/vycord/client && source ~/.nvm/nvm.sh && nvm use 22 && npm run build:vite`
Expected: сборка без ошибок.

- [ ] **Step 3: Ручной smoke-тест**

Поднять локально (`make docker-up`, сервер `make run` или как обычно), в клиенте:

1. Открыть текстовый канал с сообщениями → иконка-лупа в шапке видна.
2. Клик по лупе → панель выезжает справа, фокус в поле.
3. `Ctrl+Shift+F` → панель закрывается/открывается.
4. Ввести 1 символ → подсказка «минимум 2 символа»; 2+ символа → результаты с подсветкой и счётчиком «Найдено: N».
5. Запрос `%` или `_` (два символа, например `10%`) → ищется буквально, не матчит всё подряд.
6. Клик по старому результату (за пределами последних 50) → лента перезагружается контекстом, скролл к сообщению, вспышка-подсветка, внизу кнопка «К последним сообщениям».
7. Клик «К последним сообщениям» → лента возвращается к свежим, автоскролл вниз работает.
8. `Esc` в поле поиска → панель закрывается.
9. Сменить канал при открытой панели → панель закрыта, поиск сброшен.
10. Сузить окно < 768px → панель на всю ширину.

Expected: всё по списку; о результатах доложить пользователю (коммиты он делает сам).
