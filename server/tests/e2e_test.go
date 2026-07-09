package tests

import (
	"bytes"
	"encoding/json"
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

const (
	testBaseURL = "http://localhost:8080"
)

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
