# WS: доверять `user_id` только из JWT — устранение подделки отправителя

**Дата:** 2026-07-09
**Приоритет:** Критический
**Задача (Borda / Vycord):** «WS: брать `user_id` только из JWT, не доверять payload — `chat_message`/`typing` пересылаются как есть, можно подделать отправителя»

## Проблема

WS-хендлеры `handleChatMessage` и `handleTyping` в
`server/internal/delivery/http/handler/websocket.go` пересылают сырой payload
клиента без изменений:

```go
h.hub.SendToChannel(channelID, &ws.Message{Type: "chat_message", Payload: msg.Payload})
```

Идентичность отправителя (`user_id`) содержится внутри `msg.Payload` и
полностью контролируется клиентом. Аутентифицированный `client.UserID`
(полученный из JWT при апгрейде соединения) не используется. Как следствие,
любой подключённый пользователь может отправить WS-событие `chat_message` с
чужим `user_id` — сервер разошлёт его всем клиентам, просматривающим канал, а
клиент-получатель отрисует сообщение как исходящее от жертвы.

Клиентский рендер завязан на `user_id` из payload:
`client/src/pages/AppPage.tsx` (слушатель `chat_message`) и
`client/src/components/ChatArea.tsx` (маппинг `user_id → username`), поэтому
подделка визуально неотличима от настоящего сообщения (ghost-сообщение — не
сохранённое в БД, но видимое всем в канале).

`typing` содержит тот же дефект, но на клиенте не используется вовсе.

## Ключевое наблюдение

Легитимный клиент **никогда не отправляет** `chat_message` и `typing` по WS:

- Чат-сообщения отправляются через HTTP `POST` → `MessageHandler.CreateMessage`
  (`server/internal/delivery/http/handler/message.go`), где `userID` берётся из
  auth-контекста (`r.Context().Value("user_id")`), сохраняется в БД и рассылается
  через `hub.SendToChannel` уже с авторитетным автором. Это единственный
  корректный путь появления `chat_message` наружу.
- `typing` не используется на клиенте ни на отправку, ни на приём
  (проверено grep по `client/src`).

Таким образом, входящие WS-хендлеры `handleChatMessage` и `handleTyping` — это
поверхность атаки без легитимного применения.

## Решение

Удалить обе точки входа.

1. **`websocket.go` — `handleMessage`:** убрать из `switch` ветки
   `case "chat_message"` и `case "typing"` (текущие строки 136–139).
2. **`websocket.go`:** удалить функции `handleChatMessage` (187–199) и
   `handleTyping` (201–213).
3. **`hub.go`:** без изменений. `SendToChannel` остаётся используемым в
   HTTP-пути (`message.go:62`), `BroadcastMessage` — в `voice_call_ring`,
   `voice_call_cancel`, `screen_share_*`. Мёртвого кода не появляется.

### Поведение после изменения

- Входящий WS `chat_message`/`typing` попадает в ветку `default` хендлера и
  логируется как `warn "unknown message type"`. Для легитимного клиента шума
  нет (он такие события не шлёт); для злоумышленника — только запись в лог,
  рассылки не происходит.
- Исходящий `chat_message` формируется исключительно HTTP-путём
  `CreateMessage` с `user_id` из JWT-контекста и записью в БД.

## Вне объёма (follow-up)

- **`voice_call_ring` / `voice_call_cancel`** несут `caller_id` внутри payload
  (`client/src/pages/AppPage.tsx` шлёт `caller_id: user.id`), сервер пересылает
  его как есть через `BroadcastMessage` — тот же класс подделки. Отдельная
  задача.
- Если в будущем понадобится **typing-индикатор**, реализовать его с
  `user_id`, инжектируемым сервером из `client.UserID` (JWT), а не из payload
  клиента.

## Проверка

- `go build ./...` — успешно.
- `go test ./...` — зелёные. Тесты не покрывают удаляемые хендлеры (проверено
  grep по `--include=*.go`), регрессий нет.
- Ручная проверка: попытка отправить WS `chat_message` с чужим `user_id` не
  приводит к рассылке (событие уходит в `default`/`warn`); обычный чат через
  HTTP работает без изменений.
