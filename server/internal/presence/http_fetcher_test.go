package presence

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPFetcherSendsSecretHeaderAndParsesSnapshot(t *testing.T) {
	var gotSecret string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSecret = r.Header.Get("X-Internal-Secret")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"room-1":["user-a","user-b"]}`))
	}))
	defer srv.Close()

	f := NewHTTPFetcher(srv.URL, "s3cret")
	snapshot, err := f.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}

	if gotSecret != "s3cret" {
		t.Fatalf("X-Internal-Secret sent = %q, want %q", gotSecret, "s3cret")
	}
	if got := snapshot["room-1"]; len(got) != 2 || got[0] != "user-a" || got[1] != "user-b" {
		t.Fatalf("snapshot[\"room-1\"] = %v, want [user-a user-b]", got)
	}
}

func TestHTTPFetcherReturnsErrorOnNonOKStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	f := NewHTTPFetcher(srv.URL, "wrong-or-whatever")
	if _, err := f.Fetch(context.Background()); err == nil {
		t.Fatal("Fetch returned no error for a 403 response")
	}
}
