package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestRequestID_SetsResponseHeaderWithValidUUID(t *testing.T) {
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	id := rec.Header().Get(RequestIDHeader)
	if id == "" {
		t.Fatalf("expected %s header to be set", RequestIDHeader)
	}
	if _, err := uuid.Parse(id); err != nil {
		t.Fatalf("expected valid UUID, got %q: %v", id, err)
	}
}

func TestRequestID_PropagatesIDToContext(t *testing.T) {
	var gotFromContext string

	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotFromContext = RequestIDFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	headerID := rec.Header().Get(RequestIDHeader)
	if gotFromContext == "" {
		t.Fatal("expected request id to be available in handler context")
	}
	if gotFromContext != headerID {
		t.Fatalf("context id %q does not match header id %q", gotFromContext, headerID)
	}
}

func TestRequestIDFromContext_EmptyWhenNotSet(t *testing.T) {
	if got := RequestIDFromContext(context.Background()); got != "" {
		t.Fatalf("expected empty string, got %q", got)
	}
}
