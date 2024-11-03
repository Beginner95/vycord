package tests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

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
