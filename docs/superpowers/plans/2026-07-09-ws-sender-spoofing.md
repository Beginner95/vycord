# WS Sender Spoofing Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить подделку отправителя в WebSocket, удалив входящие хендлеры `chat_message` и `typing`, которые пересылают сырой payload клиента без проверки идентичности.

**Architecture:** Легитимный клиент не отправляет `chat_message`/`typing` по WS: чат идёт через HTTP `CreateMessage` (автор из JWT-контекста, запись в БД), `typing` не используется вовсе. Входящие WS-хендлеры `handleChatMessage`/`handleTyping` — поверхность атаки без применения; удаляем их. После удаления такие входящие события попадают в ветку `default` (`warn "unknown message type"`) и наружу не рассылаются.

**Tech Stack:** Go (net/http, gorilla/websocket), тесты — `testing` + `testify`, gorilla/websocket dialer; e2e-тесты гейтятся `RUN_E2E=true` против живого сервера.

## Global Constraints

- Модуль: `github.com/vycord/server`.
- Изменения только на сервере, файл `server/internal/delivery/http/handler/websocket.go`; `hub.go` не трогаем.
- `hub.SendToChannel` и `hub.BroadcastMessage` должны остаться используемыми (первый — в `message.go:62`, второй — в voice/screen-share хендлерах). После правок не должно появиться мёртвого кода и неиспользуемых импортов.
- Существующий стиль e2e-тестов: гейт `if os.Getenv("RUN_E2E") != "true" { t.Skip(...) }`, dial `ws://localhost:8080/ws?token=...`, `t.Skip` при отсутствии живого сервера.

---

### Task 1: Удалить WS-хендлеры `chat_message` и `typing` + регрессионный e2e-тест

**Files:**
- Modify: `server/internal/delivery/http/handler/websocket.go` (удалить `case "chat_message"`/`case "typing"` из `handleMessage`, строки ~136–139; удалить функции `handleChatMessage` ~187–199 и `handleTyping` ~201–213)
- Test: `server/tests/e2e_test.go` (добавить `TestWSSenderSpoofing`)

**Interfaces:**
- Consumes: существующий e2e-хелпер `getTestToken(t *testing.T) string` из `server/tests/e2e_test.go`; эндпоинт `GET /ws?token=<jwt>`; WS-события `join_channel` (payload `{"channel_id": "<uuid>"}`), `chat_message`, `typing`.
- Produces: ничего для последующих задач (единственная задача плана).

**Важно (порядок e2e-проверки):** тест гоняется против *живого* сервера. Чтобы увидеть «красный» до фикса и «зелёный» после, сервер нужно пересобрать и перезапустить между шагами 2 и 4. Убедитесь, что БД поднята и сервер запущен с `RUN_E2E`-совместимым окружением (как для остальных e2e-тестов репозитория).

- [ ] **Step 1: Написать падающий регрессионный тест**

Добавьте в конец `server/tests/e2e_test.go` новую функцию. Также добавьте в блок `import` пакеты `"time"` и `"github.com/google/uuid"` (остальные — `encoding/json`, `os`, `testing`, `github.com/gorilla/websocket`, `github.com/stretchr/testify/require` — уже импортированы).

```go
// TestWSSenderSpoofing проверяет, что сервер не пересылает в канал
// присланные клиентом chat_message/typing — идентичность отправителя должна
// браться из JWT, а не из payload. Регрессия на фикс подделки отправителя.
//
// До фикла: клиент, "просматривающий" канал (join_channel), получал бы своё же
// подделанное chat_message/typing обратно через SendToChannel. После фикса эти
// события уходят в ветку default и наружу не рассылаются.
func TestWSSenderSpoofing(t *testing.T) {
	if os.Getenv("RUN_E2E") != "true" {
		t.Skip("Skipping E2E test. Set RUN_E2E=true to run.")
	}

	token := getTestToken(t)
	wsURL := "ws://localhost:8080/ws?token=" + token

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Skip("WebSocket server not running")
	}
	defer conn.Close()

	channelID := uuid.NewString()

	// Начинаем "просматривать" канал, чтобы SendToChannel таргетил это соединение.
	err = conn.WriteMessage(websocket.TextMessage,
		[]byte(`{"type":"join_channel","payload":{"channel_id":"`+channelID+`"}}`))
	require.NoError(t, err)

	// Подделываем chat_message от чужого user_id.
	err = conn.WriteMessage(websocket.TextMessage,
		[]byte(`{"type":"chat_message","payload":{"channel_id":"`+channelID+`","user_id":"00000000-0000-0000-0000-000000000001","content":"spoofed"}}`))
	require.NoError(t, err)

	// Подделываем typing от чужого user_id.
	err = conn.WriteMessage(websocket.TextMessage,
		[]byte(`{"type":"typing","payload":{"channel_id":"`+channelID+`","user_id":"00000000-0000-0000-0000-000000000001"}}`))
	require.NoError(t, err)

	// Читаем входящие кадры короткое окно. Кадры online_users/user_joined,
	// приходящие при подключении, дренируем. Тест падает, только если сервер
	// прислал обратно chat_message или typing.
	_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break // дедлайн — эха нет, успех
		}
		var m struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		if m.Type == "chat_message" || m.Type == "typing" {
			t.Fatalf("server echoed spoofed %q back to channel", m.Type)
		}
	}
}
```

- [ ] **Step 2: Запустить тест — убедиться, что он ПАДАЕТ**

Предусловие: собран и запущен сервер с *текущим* (до-фиксным) кодом, БД поднята.

Run: `cd server && RUN_E2E=true go test ./tests/ -run TestWSSenderSpoofing -v`
Expected: FAIL с сообщением `server echoed spoofed "chat_message" back to channel` (сервер пересылает подделанный payload обратно).

- [ ] **Step 3: Удалить ветки switch в `handleMessage`**

В `server/internal/delivery/http/handler/websocket.go`, в функции `handleMessage`, удалите две ветки:

```go
	case "chat_message":
		h.handleChatMessage(client, msg)
	case "typing":
		h.handleTyping(client, msg)
```

(остальные `case` и `default` оставьте без изменений).

- [ ] **Step 4: Удалить функции `handleChatMessage` и `handleTyping`**

В том же файле удалите целиком обе функции:

```go
func (h *WebSocketHandler) handleChatMessage(client *ws.Client, msg *ws.Message) {
	var payload struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err == nil && payload.ChannelID != "" {
		channelID, err := uuid.Parse(payload.ChannelID)
		if err == nil {
			h.hub.SendToChannel(channelID, &ws.Message{Type: "chat_message", Payload: msg.Payload})
			return
		}
	}
	h.hub.BroadcastMessage(&ws.Message{Type: "chat_message", Payload: msg.Payload})
}

func (h *WebSocketHandler) handleTyping(client *ws.Client, msg *ws.Message) {
	var payload struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err == nil && payload.ChannelID != "" {
		channelID, err := uuid.Parse(payload.ChannelID)
		if err == nil {
			h.hub.SendToChannel(channelID, &ws.Message{Type: "typing", Payload: msg.Payload})
			return
		}
	}
	h.hub.BroadcastMessage(&ws.Message{Type: "typing", Payload: msg.Payload})
}
```

- [ ] **Step 5: Проверить компиляцию (импорты не осахли)**

`uuid` и `json` по-прежнему используются в файле (например, `handleJoinChannel`, `handleWebRTCOffer`, `mustMarshal`), поэтому импорты остаются валидными.

Run: `cd server && go build ./...`
Expected: успешно, без ошибок «imported and not used» и «declared and not used».

- [ ] **Step 6: Пересобрать/перезапустить сервер и убедиться, что тест ПРОХОДИТ**

Перезапустите сервер с новым кодом (БД поднята), затем:

Run: `cd server && RUN_E2E=true go test ./tests/ -run TestWSSenderSpoofing -v`
Expected: PASS (подделанные `chat_message`/`typing` не возвращаются в канал).

- [ ] **Step 7: Прогнать весь набор тестов**

Run: `cd server && go test ./...`
Expected: PASS (все пакеты; e2e-тесты без `RUN_E2E` скипаются — это нормально).

- [ ] **Step 8: Коммит**

```bash
cd /www/my/vycord
git add server/internal/delivery/http/handler/websocket.go server/tests/e2e_test.go
git commit -m "VYC-28 WS: удалить хендлеры chat_message/typing — user_id только из JWT

Входящие WS chat_message/typing пересылали сырой payload клиента без
проверки идентичности, позволяя подделать отправителя. Легитимный клиент
эти события по WS не шлёт (чат — через HTTP CreateMessage, typing не
используется), поэтому хендлеры удалены как поверхность атаки.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- «Удалить `case chat_message`/`typing` из switch» → Step 3. ✓
- «Удалить функции `handleChatMessage`/`handleTyping`» → Step 4. ✓
- «hub.go без изменений; `SendToChannel`/`BroadcastMessage` остаются используемыми» → Global Constraints + Step 5 (build проходит, значит нет мёртвого/неиспользуемого). ✓
- «Поведение после: входящие уходят в default/warn, наружу не рассылаются» → закреплено тестом `TestWSSenderSpoofing` (Step 1, 6). ✓
- «Проверка: go build + go test зелёные» → Step 5, 7. ✓
- Вне объёма (`voice_call_ring`/`voice_call_cancel`, будущий typing) — намеренно не входят в план. ✓

**2. Placeholder scan:** плейсхолдеров/TODO нет; весь код и команды приведены полностью.

**3. Type consistency:** тест использует только существующий хелпер `getTestToken`, стандартный `websocket.DefaultDialer`, `uuid.NewString()`, `json.Unmarshal`. Имена удаляемых функций (`handleChatMessage`, `handleTyping`) и ветки switch соответствуют фактическому коду `websocket.go`.
