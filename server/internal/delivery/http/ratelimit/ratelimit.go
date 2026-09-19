// Package ratelimit — простой счётчик запросов с фиксированным окном для
// публичных гостевых эндпоинтов. До гостевого входа ограничений частоты в
// сервисе не было вообще (ни здесь, ни в nginx), а preview/join по секрету
// принимают кого угодно.
package ratelimit

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/vycord/server/internal/delivery/http/httperr"
)

// sweepEvery — как часто Allow подчищает истёкшие окна. Иначе карта растёт по
// одному ключу на каждый новый IP и никогда не уменьшается.
const sweepEvery = 1024

type bucket struct {
	count   int
	resetAt time.Time
}

type Limiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string]*bucket
	calls  int
	now    func() time.Time
}

func New(limit int, window time.Duration) *Limiter {
	return &Limiter{limit: limit, window: window, hits: map[string]*bucket{}, now: time.Now}
}

// Allow засчитывает событие для key и сообщает, укладывается ли оно в лимит.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.maybeSweepLocked(now)

	b := l.hits[key]
	if b == nil || !now.Before(b.resetAt) {
		b = &bucket{resetAt: now.Add(l.window)}
		l.hits[key] = b
	}
	if b.count >= l.limit {
		return false
	}
	b.count++
	return true
}

// Exhausted сообщает, исчерпан ли лимит key, НЕ засчитывая событие. Нужен для
// счётчика неудачных проверок секрета: он растёт только на реальных промахах,
// но закрывает эндпоинт до конца окна.
func (l *Limiter) Exhausted(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	b := l.hits[key]
	return b != nil && l.now().Before(b.resetAt) && b.count >= l.limit
}

func (l *Limiter) maybeSweepLocked(now time.Time) {
	l.calls++
	if l.calls%sweepEvery != 0 {
		return
	}
	for k, b := range l.hits {
		if !now.Before(b.resetAt) {
			delete(l.hits, k)
		}
	}
}

// Middleware отклоняет запрос с 429 rate_limited, когда ключ исчерпал лимит.
func (l *Limiter) Middleware(key func(*http.Request) string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !l.Allow(key(r)) {
			httperr.Write(w, http.StatusTooManyRequests, httperr.CodeRateLimited, "too many requests")
			return
		}
		next(w, r)
	}
}

// ClientIP — адрес вызывающего. X-Real-IP принимается только от loopback или
// приватного пира: в проде API слушает в docker-сети, а его порт опубликован
// на 127.0.0.1 хоста, так что дотянуться до него может только nginx с того же
// хоста. От публичного пира заголовок игнорируется — иначе лимит и бан
// обходились бы подстановкой чужого адреса.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer := net.ParseIP(host)
	if peer != nil && (peer.IsLoopback() || peer.IsPrivate()) {
		if real := strings.TrimSpace(r.Header.Get("X-Real-IP")); net.ParseIP(real) != nil {
			return real
		}
	}
	return host
}
