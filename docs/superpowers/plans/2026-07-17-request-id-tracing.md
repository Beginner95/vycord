# Request ID для трассировки HTTP-запросов API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Каждый HTTP-запрос к `cmd/api` получает уникальный request ID (UUID), доступный в заголовке ответа `X-Request-Id`, в контексте запроса для хендлеров, и в единой строке access-лога — чтобы можно было сопоставить конкретный запрос клиента со строками серверного лога.

**Architecture:** Два новых middleware в `server/internal/delivery/http/middleware/` — `RequestID` (генерирует UUID, кладёт в typed context key, ставит заголовок ответа) и `Logging` (пишет одну структурированную строку `slog` на запрос: method/path/status/duration/request_id). Оборачивают весь роутер в `cmd/api/main.go`, в порядке `RequestID(Logging(CORS(router)))`. Три существующих места, где хендлеры логируют внутренние (500) ошибки, дополнительно получают `request_id` из контекста для сопоставления с access-логом.

**Tech Stack:** Go 1.24, `log/slog` (текстовый хендлер уже настроен в `pkg/logger`), `github.com/google/uuid` (уже в go.mod), `net/http` (стандартный `ServeMux`), тесты — `testing` + `github.com/stretchr/testify/mock` (уже используется в `websocket_test.go`).

## Global Constraints

- Область — только `cmd/api` (REST-эндпоинты + апгрейд `/ws`). `cmd/sfu` не трогаем.
- Request ID всегда генерируется сервером — клиент не может передать свой (нет чтения входящего `X-Request-Id`).
- Заголовок ответа: `X-Request-Id`.
- Никаких новых внешних зависимостей — используем то, что уже в `go.mod`.
- Новый context key должен быть typed (неэкспортируемый `contextKey`), а не строковый литерал — не повторяем анти-паттерн существующего `"user_id"`.
- Внутренние WS-хендлеры уже открытого соединения (`handleCallStart` и т.п. в `websocket.go`) не меняем — вне объёма.

---

## Task 1: Request ID middleware

**Files:**
- Create: `server/internal/delivery/http/middleware/request_id.go`
- Test: `server/internal/delivery/http/middleware/request_id_test.go`

**Interfaces:**
- Produces: `middleware.RequestIDHeader` (const `string` = `"X-Request-Id"`), `middleware.RequestID(next http.Handler) http.Handler`, `middleware.RequestIDFromContext(ctx context.Context) string`.

- [ ] **Step 1: Write the failing test**

```go
package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestRequestID_SetsResponseHeaderWithValidUUID(t *testing.T) {
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	id := rec.Header().Get(RequestIDHeader)
	if id == "" {
		t.Fatalf("expected %s header to be set", RequestIDHeader)
	}
	if _, err := uuid.Parse(id); err != nil {
		t.Fatalf("expected valid UUID, got %q: %v", id, err)
	}
}

func TestRequestID_PropagatesIDToContext(t *testing.T) {
	var gotFromContext string

	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotFromContext = RequestIDFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	headerID := rec.Header().Get(RequestIDHeader)
	if gotFromContext == "" {
		t.Fatal("expected request id to be available in handler context")
	}
	if gotFromContext != headerID {
		t.Fatalf("context id %q does not match header id %q", gotFromContext, headerID)
	}
}

func TestRequestIDFromContext_EmptyWhenNotSet(t *testing.T) {
	if got := RequestIDFromContext(context.Background()); got != "" {
		t.Fatalf("expected empty string, got %q", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/delivery/http/middleware/... -run TestRequestID -v`
Expected: FAIL — `undefined: RequestID`, `undefined: RequestIDHeader`, `undefined: RequestIDFromContext` (package doesn't compile yet).

- [ ] **Step 3: Write minimal implementation**

```go
package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

type contextKey int

const requestIDKey contextKey = iota

// RequestIDHeader is the response header carrying the per-request trace ID.
const RequestIDHeader = "X-Request-Id"

// RequestID generates a UUID for every incoming request, exposes it via the
// X-Request-Id response header, and makes it available to downstream
// handlers through the request context.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := uuid.New().String()
		w.Header().Set(RequestIDHeader, id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestIDFromContext returns the request ID stored by RequestID, or an
// empty string if none is present (e.g. in tests that call a handler
// directly without wiring the middleware).
func RequestIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/delivery/http/middleware/... -run TestRequestID -v`
Expected: PASS (3/3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/internal/delivery/http/middleware/request_id.go server/internal/delivery/http/middleware/request_id_test.go
git commit -m "feat(middleware): add RequestID middleware for per-request trace IDs"
```

---

## Task 2: Access-log middleware

**Files:**
- Create: `server/internal/delivery/http/middleware/logging.go`
- Test: `server/internal/delivery/http/middleware/logging_test.go`

**Interfaces:**
- Consumes: `middleware.RequestIDFromContext` and `middleware.RequestID`, `middleware.RequestIDHeader` (Task 1).
- Produces: `middleware.Logging(log *slog.Logger) func(http.Handler) http.Handler`.

- [ ] **Step 1: Write the failing test**

```go
package middleware

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogging_RecordsStatusMethodPath(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	handler := Logging(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/123", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	out := buf.String()
	for _, want := range []string{"method=GET", "path=/api/v1/users/123", "status=404"} {
		if !strings.Contains(out, want) {
			t.Fatalf("expected log output to contain %q, got: %s", want, out)
		}
	}
}

func TestLogging_DefaultsToStatus200WhenWriteHeaderNotCalled(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	handler := Logging(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !strings.Contains(buf.String(), "status=200") {
		t.Fatalf("expected status=200 in log output, got: %s", buf.String())
	}
}

func TestLogging_IncludesRequestIDFromContext(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	chain := RequestID(Logging(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	chain.ServeHTTP(rec, req)

	headerID := rec.Header().Get(RequestIDHeader)
	if headerID == "" {
		t.Fatal("expected X-Request-Id header to be set")
	}
	if !strings.Contains(buf.String(), "request_id="+headerID) {
		t.Fatalf("expected log output to contain request_id=%s, got: %s", headerID, buf.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/delivery/http/middleware/... -run TestLogging -v`
Expected: FAIL — `undefined: Logging`.

- [ ] **Step 3: Write minimal implementation**

```go
package middleware

import (
	"log/slog"
	"net/http"
	"time"
)

// statusRecorder wraps http.ResponseWriter to capture the status code
// written by the wrapped handler, so Logging can include it after the
// handler has already returned.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

// Logging returns middleware that writes one structured log line per
// request, tagged with the request ID set by RequestID (empty if that
// middleware isn't wired in, e.g. in isolated tests).
func Logging(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			log.Info("http request",
				"request_id", RequestIDFromContext(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/delivery/http/middleware/... -v`
Expected: PASS — all `TestRequestID*` and `TestLogging*` tests green (6 total).

- [ ] **Step 5: Commit**

```bash
git add server/internal/delivery/http/middleware/logging.go server/internal/delivery/http/middleware/logging_test.go
git commit -m "feat(middleware): add Logging access-log middleware"
```

---

## Task 3: Wire middleware chain into cmd/api

**Files:**
- Modify: `server/cmd/api/main.go:141-152`

**Interfaces:**
- Consumes: `middleware.RequestID` (Task 1), `middleware.Logging` (Task 2).

- [ ] **Step 1: Edit `main.go`**

Find this block (current lines 141–152):

```go
	// Wrap router with CORS middleware
	corsMid := middleware.DefaultCORS()
	if cfg.ClientURL != "" {
		corsMid.AllowedOrigins = append(corsMid.AllowedOrigins, cfg.ClientURL)
	}
	handlerWithCORS := corsMid.Handler(router)

	// Start server
	srv := &http.Server{
		Addr:    cfg.ServerAddr(),
		Handler: handlerWithCORS,
	}
```

Replace with:

```go
	// Wrap router with CORS middleware
	corsMid := middleware.DefaultCORS()
	if cfg.ClientURL != "" {
		corsMid.AllowedOrigins = append(corsMid.AllowedOrigins, cfg.ClientURL)
	}
	handlerWithCORS := corsMid.Handler(router)

	// Request ID + access logging wrap the whole stack so every request,
	// including CORS preflight, gets a trace ID and a log line.
	handlerWithLogging := middleware.Logging(log)(handlerWithCORS)
	rootHandler := middleware.RequestID(handlerWithLogging)

	// Start server
	srv := &http.Server{
		Addr:    cfg.ServerAddr(),
		Handler: rootHandler,
	}
```

No new imports needed — `middleware` is already imported in `main.go`.

- [ ] **Step 2: Verify it builds**

Run: `cd server && go build ./...`
Expected: no output, exit code 0.

- [ ] **Step 3: Manual verification against a running server**

Run:
```bash
make docker-up   # starts postgres + redis
make run         # cd server && go run ./cmd/api
```

In another terminal:
```bash
curl -i http://localhost:8080/api/v1/auth/me
```

Expected: response includes a header `X-Request-Id: <uuid>`, and the server's stdout has a matching line, e.g.:
```
level=INFO msg="http request" request_id=<same-uuid> method=GET path=/api/v1/auth/me status=401 duration_ms=0
```

Stop the server (Ctrl+C) once confirmed.

- [ ] **Step 4: Commit**

```bash
git add server/cmd/api/main.go
git commit -m "feat(api): wire RequestID and Logging middleware into the request chain"
```

---

## Task 4: Enrich message handler error log with request_id

**Files:**
- Modify: `server/internal/delivery/http/handler/message.go`
- Test: `server/internal/delivery/http/handler/message_test.go`

**Interfaces:**
- Consumes: `middleware.RequestID`, `middleware.RequestIDHeader`, `middleware.RequestIDFromContext` (Tasks 1–2), `domain.MessageUseCase` (existing interface in `internal/domain/usecase.go:31-36`).

- [ ] **Step 1: Write the failing test**

```go
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type mockMessageUseCase struct{ mock.Mock }

func (m *mockMessageUseCase) CreateMessage(channelID, userID uuid.UUID, content string) (*domain.Message, error) {
	args := m.Called(channelID, userID, content)
	msg, _ := args.Get(0).(*domain.Message)
	return msg, args.Error(1)
}
func (m *mockMessageUseCase) GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*domain.Message, error) {
	args := m.Called(channelID, userID, limit, offset)
	msgs, _ := args.Get(0).([]*domain.Message)
	return msgs, args.Error(1)
}
func (m *mockMessageUseCase) UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*domain.Message, error) {
	args := m.Called(channelID, messageID, userID, content)
	msg, _ := args.Get(0).(*domain.Message)
	return msg, args.Error(1)
}
func (m *mockMessageUseCase) DeleteMessage(channelID, messageID, userID uuid.UUID) error {
	return m.Called(channelID, messageID, userID).Error(0)
}

func TestMessageHandler_CreateMessage_LogsRequestIDOnInternalError(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	mockUC := new(mockMessageUseCase)
	channelID := uuid.New()
	userID := uuid.New()
	mockUC.On("CreateMessage", channelID, userID, "hello").Return(nil, errors.New("db down"))

	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	body, _ := json.Marshal(CreateMessageRequest{Content: "hello"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/channels/"+channelID.String()+"/messages", bytes.NewReader(body))
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	chain := middleware.RequestID(http.HandlerFunc(h.CreateMessage))
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	headerID := rec.Header().Get(middleware.RequestIDHeader)
	if headerID == "" {
		t.Fatal("expected X-Request-Id header to be set")
	}
	if !strings.Contains(buf.String(), "request_id="+headerID) {
		t.Fatalf("expected error log to contain request_id=%s, got: %s", headerID, buf.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/delivery/http/handler/... -run TestMessageHandler_CreateMessage_LogsRequestIDOnInternalError -v`
Expected: FAIL — log output doesn't contain `request_id=<id>` (current `writeUseCaseError` doesn't log it yet).

- [ ] **Step 3: Modify `message.go`**

Add the import:

```go
	"github.com/vycord/server/internal/delivery/http/middleware"
```

(next to the existing `"github.com/vycord/server/internal/delivery/ws"` import).

Change the three call sites from `h.writeUseCaseError(w, err)` to `h.writeUseCaseError(w, r, err)` — in `CreateMessage` (line 56), `UpdateMessage` (line 130), `DeleteMessage` (line 163).

Change the method itself:

```go
// writeUseCaseError транслирует доменные ошибки в HTTP-статусы, не раскрывая
// внутренние детали (err.Error()) наружу.
func (h *MessageHandler) writeUseCaseError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrChannelNotFound):
		h.sendError(w, http.StatusNotFound, "channel not found")
	case errors.Is(err, domain.ErrMessageNotFound):
		h.sendError(w, http.StatusNotFound, "message not found")
	case errors.Is(err, domain.ErrInvalidMention):
		h.sendError(w, http.StatusBadRequest, "invalid mention: user is not a member of this server")
	case errors.Is(err, domain.ErrMentionForbidden):
		h.sendError(w, http.StatusForbidden, "only server owner/admin can mention @everyone")
	case errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, "access denied")
	default:
		h.log.Error("message request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, "internal server error")
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/delivery/http/handler/... -run TestMessageHandler -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/delivery/http/handler/message.go server/internal/delivery/http/handler/message_test.go
git commit -m "feat(handler): include request_id in message handler error logs"
```

---

## Task 5: Enrich TURN handler error log with request_id

**Files:**
- Modify: `server/internal/delivery/http/handler/turn.go`
- Test: `server/internal/delivery/http/handler/turn_test.go`

**Interfaces:**
- Consumes: `middleware.RequestID`, `middleware.RequestIDHeader`, `middleware.RequestIDFromContext` (Tasks 1–2), `domain.TURNUseCase` (existing interface in `internal/domain/usecase.go:38-42`).

- [ ] **Step 1: Write the failing test**

```go
package handler

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

type mockTURNUseCase struct{ mock.Mock }

func (m *mockTURNUseCase) GetCredentials(userID uuid.UUID) (*domain.TURNCredentials, error) {
	args := m.Called(userID)
	c, _ := args.Get(0).(*domain.TURNCredentials)
	return c, args.Error(1)
}

func TestTURNHandler_GetCredentials_LogsRequestIDOnError(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	mockUC := new(mockTURNUseCase)
	userID := uuid.New()
	mockUC.On("GetCredentials", userID).Return(nil, errors.New("turn secret not configured"))

	h := NewTURNHandler(mockUC, log)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/turn/credentials", nil)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	chain := middleware.RequestID(http.HandlerFunc(h.GetCredentials))
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	headerID := rec.Header().Get(middleware.RequestIDHeader)
	if headerID == "" {
		t.Fatal("expected X-Request-Id header to be set")
	}
	if !strings.Contains(buf.String(), "request_id="+headerID) {
		t.Fatalf("expected error log to contain request_id=%s, got: %s", headerID, buf.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/delivery/http/handler/... -run TestTURNHandler -v`
Expected: FAIL — log output doesn't contain `request_id=<id>`.

- [ ] **Step 3: Modify `turn.go`**

Add the import `"github.com/vycord/server/internal/delivery/http/middleware"` next to the existing `"github.com/vycord/server/internal/domain"` import.

Change line 43 from:

```go
		h.log.Error("failed to generate turn credentials", "user_id", userID, "error", err)
```

to:

```go
		h.log.Error("failed to generate turn credentials", "user_id", userID, "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/delivery/http/handler/... -run TestTURNHandler -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/delivery/http/handler/turn.go server/internal/delivery/http/handler/turn_test.go
git commit -m "feat(handler): include request_id in TURN handler error log"
```

---

## Task 6: Enrich user handler error log with request_id

**Files:**
- Modify: `server/internal/delivery/http/handler/user.go`
- Test: `server/internal/delivery/http/handler/user_test.go`

**Interfaces:**
- Consumes: `middleware.RequestID`, `middleware.RequestIDHeader`, `middleware.RequestIDFromContext` (Tasks 1–2), existing `mockUserUseCase` type already defined in `server/internal/delivery/http/handler/websocket_test.go:41-64` (same package — do not redefine it).

- [ ] **Step 1: Write the failing test**

```go
package handler

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/vycord/server/internal/delivery/http/middleware"
)

func TestUserHandler_UpdateLastVisited_LogsRequestIDOnError(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	mockUC := new(mockUserUseCase)
	userID := uuid.New()
	mockUC.On("UpdateLastVisited", userID, (*uuid.UUID)(nil), (*uuid.UUID)(nil)).Return(errors.New("db down"))

	h := NewUserHandler(mockUC, log)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/me/last-visited", strings.NewReader(`{}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	chain := middleware.RequestID(http.HandlerFunc(h.UpdateLastVisited))
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	headerID := rec.Header().Get(middleware.RequestIDHeader)
	if headerID == "" {
		t.Fatal("expected X-Request-Id header to be set")
	}
	if !strings.Contains(buf.String(), "request_id="+headerID) {
		t.Fatalf("expected error log to contain request_id=%s, got: %s", headerID, buf.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/delivery/http/handler/... -run TestUserHandler_UpdateLastVisited_LogsRequestIDOnError -v`
Expected: FAIL — log output doesn't contain `request_id=<id>`.

- [ ] **Step 3: Modify `user.go`**

Add the import `"github.com/vycord/server/internal/delivery/http/middleware"` next to the existing `"github.com/vycord/server/internal/domain"` import.

Change line 85 from:

```go
		h.log.Error("failed to update last visited", "error", err)
```

to:

```go
		h.log.Error("failed to update last visited", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/delivery/http/handler/... -run TestUserHandler -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/delivery/http/handler/user.go server/internal/delivery/http/handler/user_test.go
git commit -m "feat(handler): include request_id in user handler error log"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Build the whole module**

Run: `cd server && go build ./...`
Expected: no output, exit code 0.

- [ ] **Step 2: Run the full test suite**

Run: `cd server && go test ./... -v`
Expected: all tests pass, including the new `TestRequestID*`, `TestLogging*`, `TestMessageHandler_CreateMessage_LogsRequestIDOnInternalError`, `TestTURNHandler_GetCredentials_LogsRequestIDOnError`, `TestUserHandler_UpdateLastVisited_LogsRequestIDOnError`. E2E tests in `server/tests/e2e_test.go` remain skipped (no `RUN_E2E=true`).

- [ ] **Step 3: `go vet`**

Run: `cd server && go vet ./...`
Expected: no output.

This closes out the spec's "Проверка (после реализации)" section in full.
