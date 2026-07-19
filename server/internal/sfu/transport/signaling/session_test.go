package signaling

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// newTestSession spins up a WS server whose server-side connection is wrapped
// in a Session (mirroring production), and returns the session plus the
// client-side connection.
func newTestSession(t *testing.T) (*Session, *websocket.Conn) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	sessCh := make(chan *Session, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		sessCh <- NewSession(context.Background(), conn, log)
	}))
	t.Cleanup(srv.Close)

	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	client, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { client.Close() })

	select {
	case s := <-sessCh:
		t.Cleanup(s.Close)
		return s, client
	case <-time.After(2 * time.Second):
		t.Fatal("server never created session")
		return nil, nil
	}
}

// TestSendMsgCloseRaceDoesNotPanic reproduces the production crash: the
// negotiator goroutine of an evicted session calls SendOffer/Notify while the
// connection handler's deferred Close runs. With close(s.send) in Close this
// panics with "send on closed channel" and takes down the whole SFU process.
func TestSendMsgCloseRaceDoesNotPanic(t *testing.T) {
	s, client := newTestSession(t)

	// Slow reader: let the send buffer fill so senders block inside select,
	// which is exactly where the panic fires when Close closes the channel.
	go func() {
		for {
			time.Sleep(10 * time.Millisecond)
			if _, _, err := client.ReadMessage(); err != nil {
				return
			}
		}
	}()

	var wg sync.WaitGroup
	start := make(chan struct{})
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for i := 0; i < 500; i++ {
				_ = s.Notify("evt", map[string]int{"i": i})
			}
		}()
	}

	close(start)
	time.Sleep(5 * time.Millisecond) // let senders saturate the buffer
	s.Close()
	wg.Wait()
}

// TestNotifyAfterCloseReturnsError: a send attempted strictly after Close must
// fail gracefully instead of blocking or panicking.
func TestNotifyAfterCloseReturnsError(t *testing.T) {
	s, _ := newTestSession(t)
	s.Close()

	done := make(chan error, 1)
	go func() { done <- s.Notify("evt", "x") }()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Notify after Close returned nil, want error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Notify after Close blocked")
	}
}

// TestQueuedMessagesFlushedOnClose: messages enqueued before Close (e.g. the
// "error" notification on a failed join) should still reach the client before
// the close frame.
func TestQueuedMessagesFlushedOnClose(t *testing.T) {
	s, client := newTestSession(t)

	if err := s.Notify("error", map[string]string{"code": "join_failed"}); err != nil {
		t.Fatalf("Notify: %v", err)
	}
	s.Close()

	client.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("client never received queued message before close: %v", err)
	}
	if !strings.Contains(string(raw), "join_failed") {
		t.Fatalf("unexpected message: %s", raw)
	}
}
