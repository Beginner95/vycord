# Request ID для трассировки HTTP-запросов API

**Дата:** 2026-07-17
**Раздел борды:** 🧱 Clean Architecture (улучшения)
**Задача (Borda / Vycord):** «Добавить request ID в каждый запрос для трассировки»

## Проблема

В `cmd/api` нет ни одного общего лога запросов — `main.go` собирает
`http.ServeMux` и оборачивает его только `middleware.CORS`
(`server/internal/delivery/http/middleware/cors.go`). Логирование ошибок
точечное: из ~10 хендлеров в `internal/delivery/http/handler/` вызовы
`h.log.Error/Warn` встречаются лишь в трёх местах (`message.go:191`,
`turn.go:43`, `user.go:85`), и ни один из них не несёт признака, к какому
именно HTTP-запросу относится ошибка. Сопоставить строку лога с конкретным
запросом клиента (для отладки прод-инцидента или багрепорта) сейчас
невозможно.

## Предварительные задачи

Блокирующих зависимостей на борде не найдено — задача изолированная, не
требует миграций БД или новых WS-событий. По пути будет добавлен новый typed
context key (хорошая практика для нового кода); существующий
нетипизированный ключ `"user_id"` в `auth.go` — отдельный пункт борды
(«Типизировать ключ `user_id` в `context.Value`»), сознательно вне объёма
этой задачи.

## Объём

**В объёме:** только `cmd/api` — REST-эндпоинты и апгрейд `/ws`.

**Вне объёма:**
- `cmd/sfu` (signaling/`/health`/`/stats`) — отдельный бинарник со своей
  WebRTC-спецификой, не трогаем.
- Внутренние WS-хендлеры уже открытого соединения (`handleCallStart`,
  `handleWebRTCOffer` и т.п. в `websocket.go`) — это события внутри
  долгоживущего соединения, не отдельные HTTP-запросы; апгрейд `/ws` сам
  получит ID и попадёт в access-log как обычный запрос (`GET /ws 101`).
- Клиент не может передать свой request ID — сервер всегда генерирует новый
  на каждый запрос.

## Архитектура

Два новых файла в `server/internal/delivery/http/middleware/` (рядом с
`auth.go`, `cors.go`):

### `request_id.go`

```go
package middleware

type contextKey int

const requestIDKey contextKey = iota

const RequestIDHeader = "X-Request-Id"

func RequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := uuid.New().String()
        w.Header().Set(RequestIDHeader, id)
        ctx := context.WithValue(r.Context(), requestIDKey, id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func RequestIDFromContext(ctx context.Context) string {
    id, _ := ctx.Value(requestIDKey).(string)
    return id
}
```

Ключ — неэкспортируемый typed `contextKey`, коллизий с чужими пакетами быть
не может (в отличие от строковых ключей в `auth.go`).

### `logging.go`

```go
package middleware

type statusRecorder struct {
    http.ResponseWriter
    status int
}

func (w *statusRecorder) WriteHeader(status int) {
    w.status = status
    w.ResponseWriter.WriteHeader(status)
}

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

`statusRecorder.status` инициализирован `http.StatusOK`, потому что хендлеры
вроде `DeleteMessage` (`message.go:173`) вызывают `w.WriteHeader` явно только
для не-200 статусов, а для `200 OK` полагаются на дефолт `net/http`.

### Цепочка в `cmd/api/main.go`

Было:
```go
handlerWithCORS := corsMid.Handler(router)
```

Станет:
```go
handlerWithCORS := corsMid.Handler(router)
handlerWithLogging := middleware.Logging(log)(handlerWithCORS)
handler := middleware.RequestID(handlerWithLogging)
```

Порядок: `RequestID` — самый внешний слой (ID проставляется даже для
preflight/некорсных ответов), `Logging` видит финальный статус после
CORS/роутинга/auth, `CORS` — как раньше, ближе к роутеру.

## Обогащение существующих логов ошибок

Три места, где хендлеры уже логируют внутренние ошибки, получают
`request_id` из контекста:

- `message.go`: `writeUseCaseError(w http.ResponseWriter, err error)` →
  `writeUseCaseError(w http.ResponseWriter, r *http.Request, err error)`
  (плюс правка трёх call-сайтов `h.writeUseCaseError(w, err)` →
  `h.writeUseCaseError(w, r, err)` в `CreateMessage`/`UpdateMessage`/
  `DeleteMessage`); внутри — `h.log.Error("message request failed",
  "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)`.
- `turn.go:43` — добавить `"request_id", middleware.RequestIDFromContext(r.Context())`
  в существующий вызов.
- `user.go:85` — аналогично.

Это позволяет по `request_id` из access-log-строки найти соответствующую
строку с деталями 500-ошибки (и наоборот).

## Данные и поток

1. Запрос приходит → `RequestID` генерирует UUID, кладёт в контекст, ставит
   заголовок ответа `X-Request-Id`.
2. `Logging` засекает время, передаёт управление дальше через обёрнутый
   `ResponseWriter`.
3. `CORS` → роутер → (опционально) `AuthMiddleware` → хендлер. Хендлер при
   необходимости логирует ошибку с тем же `request_id` из
   `r.Context()`.
4. После возврата из хендлера `Logging` пишет итоговую строку с
   `method/path/status/duration_ms/request_id`.
5. Клиент получает `X-Request-Id` в заголовке ответа (на будущее — можно
   показывать в UI при ошибке или прикладывать к багрепорту).

## Тестирование

- Unit-тест `request_id_test.go`: заголовок `X-Request-Id` присутствует в
  ответе и является валидным UUID; значение в контексте, видимое next-хендлером,
  совпадает со значением заголовка.
- Unit-тест `logging_test.go`: после запроса с известным статусом (напр. 404)
  лог (через `slog` с буфером вместо stdout) содержит `status=404` и
  непустой `request_id`; для запроса без явного `WriteHeader` — `status=200`.
- Ручная проверка: `curl -i http://localhost:8080/api/v1/auth/me` без токена
  → в ответе есть `X-Request-Id`, в логе сервера — строка с тем же ID и
  `status=401`.

## Проверка (после реализации)

- `go build ./...`
- `go test ./...`
- Ручная проверка curl выше.
