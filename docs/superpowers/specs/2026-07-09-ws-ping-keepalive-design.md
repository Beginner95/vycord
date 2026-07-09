# Spec: ping/pong keepalive + read deadline в WebSocket hub

**Дата:** 2026-07-09
**Приоритет:** Критический (Borda / Vycord)
**Задача:** Добавить ping/pong keepalive и read deadline в WebSocket hub — мёртвые соединения сейчас висят и не вычищаются.

## Проблема

`readPump` (`server/internal/delivery/http/handler/websocket.go:89`) вызывает
`client.Conn.ReadMessage()` без read deadline. При обрыве сети без корректного
TCP-закрытия (нет FIN — Wi-Fi отвалился, устройство уснуло, NAT сбросил
трансляцию) вызов блокируется бесконечно:

- горутина `readPump` висит вечно;
- `defer` с `UnregisterClient` / `Close` / `UpdateStatus(offline)` не срабатывает;
- клиент навсегда остаётся в `hub.clients` — числится онлайн;
- его `Send`-канал продолжает накапливать сообщения (буфер 512), а `writePump`
  на мёртвом сокете тоже может залипнуть (нет write deadline).

Сервер никак не инициирует проверку живости соединения. Существующий app-level
ping (`{"type":"ping"}` → `{"type":"pong"}`, `handlePing`) не помогает: клиентский
`sendPing()` (`client/src/services/websocket.ts:150`) нигде не вызывается, и даже
если бы вызывался — на мёртвом соединении ping всё равно не дойдёт, а read
deadline, который бы это обнаружил, отсутствует.

## Решение

Стандартный паттерн gorilla/websocket: сервер сам периодически шлёт протокольные
**ping-фреймы**, клиент (в т.ч. браузер) автоматически отвечает **pong**, а read
deadline продлевается в `PongHandler`. Если pong не приходит за отведённое время —
`ReadMessage()` возвращает ошибку и срабатывает уже существующая логика очистки.

**Область изменений:** только `server/internal/delivery/http/handler/websocket.go`
(+ новый тест). Фронтенд и app-level ping/pong (`handlePing`, `sendPing`) **не
трогаем** — они безвредны и не мешают.

### Таймауты

Дефолтные значения — стандартные для gorilla/websocket, заданы константами
пакетного уровня (не через env):

```go
const (
    defaultWriteWait  = 10 * time.Second       // дедлайн на одну запись в сокет
    defaultPongWait   = 60 * time.Second       // ждём pong; иначе соединение мёртвое
    defaultPingPeriod = (defaultPongWait * 9) / 10 // 54s — период отправки ping (< pongWait)
)
```

`pingPeriod` строго меньше `pongWait`, чтобы успеть получить pong до истечения
дедлайна.

### Конфигурируемость для тестов

Таймауты хранятся как **поля структуры `WebSocketHandler`**:

```go
type WebSocketHandler struct {
    // ...existing fields...
    writeWait  time.Duration
    pongWait   time.Duration
    pingPeriod time.Duration
}
```

`NewWebSocketHandler` заполняет их дефолтными константами. Тест (white-box, пакет
`handler`) переопределяет поля на короткие значения (~40–100 ms). Через env/config
они не выставляются — только код.

### readPump

Перед циклом чтения:

```go
client.Conn.SetReadDeadline(time.Now().Add(h.pongWait))
client.Conn.SetPongHandler(func(string) error {
    client.Conn.SetReadDeadline(time.Now().Add(h.pongWait))
    return nil
})
```

Существующий `defer` (Unregister + Close + set offline) и цикл `ReadMessage()`
остаются без изменений. Когда pong не приходит за `pongWait`, `ReadMessage()`
вернёт ошибку и очистка сработает штатно.

Опционально: не логировать таймаут-ошибки на уровне `Error` (текущий фильтр
`IsUnexpectedCloseError` их не покрывает — истёкший deadline это не close-фрейм),
чтобы не засорять error-лог штатными отвалами. Достаточно оставить как есть или
опустить до Info — на решение задачи не влияет.

### writePump

Переписать под `select` с тикером:

```go
func (h *WebSocketHandler) writePump(client *ws.Client) {
    ticker := time.NewTicker(h.pingPeriod)
    defer func() {
        ticker.Stop()
        client.Conn.Close()
    }()

    for {
        select {
        case message, ok := <-client.Send:
            client.Conn.SetWriteDeadline(time.Now().Add(h.writeWait))
            if !ok {
                client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
                return
            }
            w, err := client.Conn.NextWriter(websocket.TextMessage)
            if err != nil {
                return
            }
            w.Write(message)
            if err := w.Close(); err != nil {
                return
            }
        case <-ticker.C:
            client.Conn.SetWriteDeadline(time.Now().Add(h.writeWait))
            if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
                return
            }
        }
    }
}
```

Браузерный WebSocket-клиент отвечает pong на ping-фрейм автоматически — правки
JS не нужны.

## Тестирование

Файл: `server/internal/delivery/http/handler/websocket_test.go`, пакет `handler`
(white-box — нужен доступ к неэкспортируемым полям таймаутов).

### Моки

Минимальные заглушки трёх usecase-интерфейсов на `testify/mock` (как в остальном
проекте):

- `AuthUseCase.ValidateToken` → валидный `*domain.User`;
- `UserUseCase.UpdateStatus` → `nil` (прочие методы интерфейса — пустые заглушки);
- `CallUseCase.EndAllActiveCalls` → `nil` (прочие методы — заглушки).

### Схема

1. `WebSocketHandler` с укороченными таймаутами: `pongWait=100ms`,
   `pingPeriod=40ms`, `writeWait=50ms`.
2. `httptest.NewServer`, оборачивающий `HandleWebSocket`.
3. Подключение gorilla-клиентом с `?token=...`.

### Кейсы

- **Мёртвый клиент вычищается:** клиент переопределяет `PingHandler` на no-op
  (чтобы gorilla не отвечал pong автоматически) и не читает. Ждём > `pongWait`.
  Утверждаем `hub.IsOnline(userID) == false` через `assert.Eventually`.
- **Живой клиент остаётся:** клиент нормально читает в цикле (gorilla сам
  отвечает pong на ping). Ждём несколько `pingPeriod`. Утверждаем
  `hub.IsOnline(userID) == true`.

Тест зависит от таймингов: пороги ожидания берём с запасом (3–4× `pongWait`),
проверки онлайна — через `assert.Eventually`, а не фиксированный `sleep`.

## Что НЕ входит

- Изменения фронтенда (`client/src/services/websocket.ts`).
- Удаление app-level `ping`/`pong` и мёртвого `sendPing()`.
- Конфигурация таймаутов через env/config.
- Redis pub/sub, метрики подключений, presence — отдельные задачи борды.

## Критерии готовности

- Сервер шлёт ping-фреймы каждые `pingPeriod` и держит read deadline `pongWait`.
- Клиент, переставший отвечать pong, вычищается из `hub.clients` в пределах
  ~`pongWait` (защита `defer` в `readPump` срабатывает).
- Живой клиент не отваливается.
- Оба тест-кейса зелёные; `go build ./...` и `go vet ./...` чистые.
- Правок фронтенда нет.
