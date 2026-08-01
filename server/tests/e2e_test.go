package tests

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testBaseURL — адрес запущенного API. Переопределяется через E2E_BASE_URL,
// когда порт 8080 занят другим процессом на машине разработчика.
var testBaseURL = func() string {
	if v := os.Getenv("E2E_BASE_URL"); v != "" {
		return v
	}
	return "http://localhost:8080"
}()

// TestAuthFlow tests the full registration and login flow
func TestAuthFlow(t *testing.T) {
	if os.Getenv("RUN_E2E") != "true" {
		t.Skip("Skipping E2E test. Set RUN_E2E=true to run.")
	}

	t.Run("register new user", func(t *testing.T) {
		resp, err := http.Post(
			testBaseURL+"/api/v1/auth/register",
			"application/json",
			bytes.NewBufferString(`{"username":"testuser","email":"test@example.com","password":"password123"}`),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusCreated, resp.StatusCode)

		var result map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.NotEmpty(t, result["id"])
		assert.Equal(t, "testuser", result["username"])
	})

	t.Run("login with credentials", func(t *testing.T) {
		resp, err := http.Post(
			testBaseURL+"/api/v1/auth/login",
			"application/json",
			bytes.NewBufferString(`{"email":"test@example.com","password":"password123"}`),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]string
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.NotEmpty(t, result["token"])
	})
}

// TestServerFlow tests creating a server and channels
func TestServerFlow(t *testing.T) {
	if os.Getenv("RUN_E2E") != "true" {
		t.Skip("Skipping E2E test. Set RUN_E2E=true to run.")
	}

	token := getTestToken(t)

	t.Run("create server", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/v1/servers", bytes.NewBufferString(`{"name":"Test Server"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{}
		resp, err := client.Do(req)
		// We need actual server running, so skip if connection refused
		if err != nil {
			t.Skip("Server not running")
		}
		defer resp.Body.Close()

		assert.Equal(t, http.StatusCreated, resp.StatusCode)
	})

	t.Run("duplicate server name rejected", func(t *testing.T) {
		status, body := doJSON(t, http.MethodPost, "/api/v1/servers", token, map[string]any{"name": "Test Server"})
		assert.Equal(t, http.StatusConflict, status)

		var resp struct {
			Code string `json:"code"`
		}
		require.NoError(t, json.Unmarshal(body, &resp))
		assert.Equal(t, "server_name_taken", resp.Code)
	})
}

// TestWebSocketConnection tests WebSocket connection with valid token
func TestWebSocketConnection(t *testing.T) {
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

	// Send ping
	err = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping","payload":{}}`))
	require.NoError(t, err)

	// Read response
	_, msg, err := conn.ReadMessage()
	require.NoError(t, err)

	var response map[string]string
	err = json.Unmarshal(msg, &response)
	require.NoError(t, err)
	assert.Equal(t, "pong", response["type"])
}

func getTestToken(t *testing.T) string {
	// Register and login to get token
	resp, err := http.Post(
		testBaseURL+"/api/v1/auth/register",
		"application/json",
		bytes.NewBufferString(`{"username":"e2etest","email":"e2e@test.com","password":"password123"}`),
	)
	if err != nil {
		t.Skip("Server not running")
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusConflict {
		// User already exists, try to login
		resp, err = http.Post(
			testBaseURL+"/api/v1/auth/login",
			"application/json",
			bytes.NewBufferString(`{"email":"e2e@test.com","password":"password123"}`),
		)
		require.NoError(t, err)
		defer resp.Body.Close()
	}

	var result map[string]string
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(t, err)
	return result["token"]
}

// TestWSSenderSpoofing проверяет, что сервер не пересылает в канал
// присланные клиентом chat_message/typing — идентичность отправителя должна
// браться из JWT, а не из payload. Регрессия на фикс подделки отправителя.
//
// До фикса: клиент, "просматривающий" канал (join_channel), получал бы своё же
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

// TestRolePermissionsFlow проверяет, что право, выданное ролью, действительно
// открывает действие на бэкенде, а снятие роли его закрывает.
func TestRolePermissionsFlow(t *testing.T) {
	if os.Getenv("RUN_E2E") != "true" {
		t.Skip("Skipping E2E test. Set RUN_E2E=true to run.")
	}

	ownerToken, _ := registerRandomUser(t)
	memberToken, memberID := registerRandomUser(t)

	serverID := createServer(t, ownerToken, "Roles E2E")
	joinServer(t, memberToken, serverID)

	// Без роли участник не может создать канал.
	status, _ := doJSON(t, http.MethodPost, "/api/v1/servers/"+serverID+"/channels",
		memberToken, map[string]any{"name": "нельзя", "type": "text"})
	require.Equal(t, http.StatusForbidden, status, "участник без MANAGE_CHANNELS не создаёт каналы")

	// Владелец создаёт роль с MANAGE_CHANNELS (бит 8) и назначает её участнику.
	status, body := doJSON(t, http.MethodPost, "/api/v1/servers/"+serverID+"/roles",
		ownerToken, map[string]any{"name": "Модератор", "position": 1, "permissions": "8"})
	require.Equal(t, http.StatusCreated, status)
	var role struct {
		ID          string `json:"id"`
		Permissions string `json:"permissions"`
	}
	require.NoError(t, json.Unmarshal(body, &role))
	assert.Equal(t, "8", role.Permissions, "permissions отдаются строкой")

	status, _ = doJSON(t, http.MethodPut,
		"/api/v1/servers/"+serverID+"/members/"+memberID+"/roles/"+role.ID, ownerToken, nil)
	require.Equal(t, http.StatusNoContent, status)

	// Список участников: владелец ровно один раз, у участника — назначенная
	// роль, у остальных пустой массив. Заодно это единственная проверка
	// сканирования uuid[] в []uuid.UUID через настоящий драйвер pgx.
	status, body = doJSON(t, http.MethodGet, "/api/v1/servers/"+serverID+"/members", ownerToken, nil)
	require.Equal(t, http.StatusOK, status)
	var members []struct {
		UserID   string   `json:"user_id"`
		Username string   `json:"username"`
		Roles    []string `json:"roles"`
	}
	require.NoError(t, json.Unmarshal(body, &members))

	seen := map[string]int{}
	for _, m := range members {
		seen[m.UserID]++
		assert.NotNil(t, m.Roles, "roles всегда массив, а не null")
	}
	for id, n := range seen {
		assert.Equal(t, 1, n, "участник %s встречается ровно один раз", id)
	}

	var memberRoles []string
	for _, m := range members {
		if m.UserID == memberID {
			memberRoles = m.Roles
		}
	}
	assert.Equal(t, []string{role.ID}, memberRoles, "@everyone в member_roles не хранится и в списке не появляется")

	// Теперь то же действие проходит.
	status, _ = doJSON(t, http.MethodPost, "/api/v1/servers/"+serverID+"/channels",
		memberToken, map[string]any{"name": "можно", "type": "text"})
	require.Equal(t, http.StatusCreated, status, "участник с MANAGE_CHANNELS создаёт каналы")

	// Эффективные права участника содержат выданный бит.
	status, body = doJSON(t, http.MethodGet,
		"/api/v1/servers/"+serverID+"/members/me/permissions", memberToken, nil)
	require.Equal(t, http.StatusOK, status)
	var perms struct {
		IsOwner     bool   `json:"is_owner"`
		Permissions string `json:"permissions"`
	}
	require.NoError(t, json.Unmarshal(body, &perms))
	assert.False(t, perms.IsOwner)
	assert.Equal(t, "56", perms.Permissions, "@everyone(48) | Модератор(8)")

	// Снятие роли закрывает доступ обратно.
	status, _ = doJSON(t, http.MethodDelete,
		"/api/v1/servers/"+serverID+"/members/"+memberID+"/roles/"+role.ID, ownerToken, nil)
	require.Equal(t, http.StatusNoContent, status)

	status, _ = doJSON(t, http.MethodPost, "/api/v1/servers/"+serverID+"/channels",
		memberToken, map[string]any{"name": "снова нельзя", "type": "text"})
	assert.Equal(t, http.StatusForbidden, status, "после снятия роли право пропадает")
}

// TestRolePrivilegeEscalation проверяет, что фронт обойти нельзя: прямые
// запросы к API не дают участнику поднять себе права.
func TestRolePrivilegeEscalation(t *testing.T) {
	if os.Getenv("RUN_E2E") != "true" {
		t.Skip("Skipping E2E test. Set RUN_E2E=true to run.")
	}

	ownerToken, _ := registerRandomUser(t)
	memberToken, memberID := registerRandomUser(t)

	serverID := createServer(t, ownerToken, "Escalation E2E")
	joinServer(t, memberToken, serverID)

	// Участник без MANAGE_ROLES не может создать роль вообще.
	status, _ := doJSON(t, http.MethodPost, "/api/v1/servers/"+serverID+"/roles",
		memberToken, map[string]any{"name": "Я главный", "position": 1, "permissions": "1"})
	assert.Equal(t, http.StatusForbidden, status, "нет MANAGE_ROLES — нет создания ролей")

	// Владелец выдаёт участнику MANAGE_ROLES (4) на позиции 5 — заведомо выше
	// позиции роли из следующей попытки эскалации (1), чтобы отказ там гарантированно
	// приходил от canGrant, а не от иерархии позиций (canManagePosition: 1 < 5 — пройдёт).
	status, body := doJSON(t, http.MethodPost, "/api/v1/servers/"+serverID+"/roles",
		ownerToken, map[string]any{"name": "Ролевик", "position": 5, "permissions": "4"})
	require.Equal(t, http.StatusCreated, status)
	var role struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(body, &role))

	status, _ = doJSON(t, http.MethodPut,
		"/api/v1/servers/"+serverID+"/members/"+memberID+"/roles/"+role.ID, ownerToken, nil)
	require.Equal(t, http.StatusNoContent, status)

	// Теперь у него MANAGE_ROLES и позиция 5 (иерархия для position:1 пройдёт),
	// но выдать себе ADMINISTRATOR он всё равно не может — отказ только от canGrant.
	status, _ = doJSON(t, http.MethodPost, "/api/v1/servers/"+serverID+"/roles",
		memberToken, map[string]any{"name": "Root", "position": 1, "permissions": "1"})
	assert.Equal(t, http.StatusForbidden, status, "нельзя выдать право, которого нет у себя")

	// И не может отредактировать роль на собственном уровне.
	status, _ = doJSON(t, http.MethodPatch, "/api/v1/servers/"+serverID+"/roles/"+role.ID,
		memberToken, map[string]any{"permissions": "4"})
	assert.Equal(t, http.StatusForbidden, status, "нельзя трогать роль на своём уровне")

	// Роль @everyone удалить нельзя.
	status, body = doJSON(t, http.MethodGet, "/api/v1/servers/"+serverID+"/roles", ownerToken, nil)
	require.Equal(t, http.StatusOK, status)
	var roles []struct {
		ID        string `json:"id"`
		IsDefault bool   `json:"is_default"`
	}
	require.NoError(t, json.Unmarshal(body, &roles))
	var everyoneID string
	for _, r := range roles {
		if r.IsDefault {
			everyoneID = r.ID
		}
	}
	require.NotEmpty(t, everyoneID, "@everyone должна существовать")

	status, _ = doJSON(t, http.MethodDelete, "/api/v1/servers/"+serverID+"/roles/"+everyoneID, ownerToken, nil)
	assert.Equal(t, http.StatusForbidden, status, "@everyone неудаляема даже владельцем")
}

// doJSON выполняет запрос к API с bearer-токеном и возвращает статус и тело.
// body == nil означает запрос без тела.
func doJSON(t *testing.T, method, path, token string, body any) (int, []byte) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(raw)
	}

	req, err := http.NewRequest(method, testBaseURL+path, reader)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, raw
}

// registerRandomUser регистрирует нового пользователя и возвращает токен и его id.
func registerRandomUser(t *testing.T) (string, string) {
	t.Helper()

	suffix := uuid.New().String()[:8]
	payload := map[string]any{
		"username": "e2e_" + suffix,
		"email":    "e2e_" + suffix + "@example.com",
		"password": "password123",
	}
	raw, err := json.Marshal(payload)
	require.NoError(t, err)

	resp, err := http.Post(testBaseURL+"/api/v1/auth/register", "application/json", bytes.NewReader(raw))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	var out struct {
		Token string `json:"token"`
		User  struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out.Token, out.User.ID
}

// createServer создаёт сервер от имени владельца и возвращает его id.
func createServer(t *testing.T, token, name string) string {
	t.Helper()

	status, body := doJSON(t, http.MethodPost, "/api/v1/servers", token, map[string]any{"name": name})
	require.Equal(t, http.StatusCreated, status)

	var out struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(body, &out))
	return out.ID
}

// joinServer вступает в сервер от имени участника.
func joinServer(t *testing.T, token, serverID string) {
	t.Helper()

	status, _ := doJSON(t, http.MethodPost, "/api/v1/servers/"+serverID+"/join", token, nil)
	require.Equal(t, http.StatusNoContent, status)
}
