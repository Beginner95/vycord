package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLimiterFixedWindow(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := New(3, time.Minute)
	l.now = func() time.Time { return now }

	for i := 0; i < 3; i++ {
		assert.True(t, l.Allow("a"), "call %d", i+1)
	}
	assert.False(t, l.Allow("a"))
	assert.True(t, l.Exhausted("a"))
	assert.True(t, l.Allow("b"), "keys are independent")
	assert.False(t, l.Exhausted("b"))

	now = now.Add(time.Minute)
	assert.True(t, l.Allow("a"), "the window resets")
	assert.False(t, l.Exhausted("a"))
}

func TestLimiterExhaustedDoesNotCount(t *testing.T) {
	l := New(1, time.Minute)
	assert.False(t, l.Exhausted("a"))
	assert.False(t, l.Exhausted("a"))
	assert.True(t, l.Allow("a"), "Exhausted must not consume the budget")
	assert.True(t, l.Exhausted("a"))
}

func TestLimiterMiddleware(t *testing.T) {
	l := New(1, time.Minute)
	calls := 0
	h := l.Middleware(func(*http.Request) string { return "k" }, func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodPost, "/x", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	rec = httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodPost, "/x", nil))
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"rate_limited"`)
	assert.Equal(t, 1, calls)
}

func TestClientIP(t *testing.T) {
	req := func(remote, realIP string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = remote
		if realIP != "" {
			r.Header.Set("X-Real-IP", realIP)
		}
		return r
	}

	assert.Equal(t, "203.0.113.9", ClientIP(req("127.0.0.1:5000", "203.0.113.9")), "loopback proxy is trusted")
	assert.Equal(t, "203.0.113.9", ClientIP(req("172.18.0.1:5000", "203.0.113.9")), "docker bridge gateway is trusted")
	assert.Equal(t, "198.51.100.7", ClientIP(req("198.51.100.7:5000", "203.0.113.9")),
		"a public peer cannot claim someone else's address")
	assert.Equal(t, "127.0.0.1", ClientIP(req("127.0.0.1:5000", "")))
	assert.Equal(t, "127.0.0.1", ClientIP(req("127.0.0.1:5000", "garbage")))
	assert.Equal(t, "10.0.0.5", ClientIP(req("10.0.0.5", "")), "RemoteAddr without a port still works")
}

func TestLimiterSweepsExpiredKeys(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := New(1, time.Second)
	l.now = func() time.Time { return now }
	for i := 0; i < 4096; i++ {
		l.Allow(strings.Repeat("k", i%17) + string(rune('a'+i%26)))
		now = now.Add(time.Second)
	}
	l.mu.Lock()
	size := len(l.hits)
	l.mu.Unlock()
	assert.Less(t, size, 4096, "expired windows are swept, the map does not grow forever")
}
