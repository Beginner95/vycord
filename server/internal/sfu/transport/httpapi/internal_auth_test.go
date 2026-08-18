package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func newProtectedHandler(secret string) http.HandlerFunc {
	inner := func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}
	return RequireInternalSecret(secret, inner)
}

// TestRequireInternalSecretRejectsMissingHeader is the core of the requirement
// from VYC-78 8.3: /stats was found open to the entire internet (no auth at
// all) because the SFU listens on ":"+port under network_mode: host. A request
// carrying no credential at all must not reach the handler.
func TestRequireInternalSecretRejectsMissingHeader(t *testing.T) {
	h := newProtectedHandler("s3cret")
	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	rec := httptest.NewRecorder()

	h(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestRequireInternalSecretRejectsWrongSecret(t *testing.T) {
	h := newProtectedHandler("s3cret")
	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	req.Header.Set("X-Internal-Secret", "wrong")
	rec := httptest.NewRecorder()

	h(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestRequireInternalSecretAcceptsCorrectSecret(t *testing.T) {
	h := newProtectedHandler("s3cret")
	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	req.Header.Set("X-Internal-Secret", "s3cret")
	rec := httptest.NewRecorder()

	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Body.String() != "ok" {
		t.Fatalf("body = %q, want the inner handler's response to reach the caller", rec.Body.String())
	}
}

// TestRequireInternalSecretRejectsEverythingWhenUnconfigured: an operator who
// never set SFU_INTERNAL_SECRET must get a locked endpoint, not an open one —
// this is the same "fail closed" default that stopped /stats being reachable
// from the open internet unauthenticated in the first place. An empty
// configured secret must never be treated as "any header value matches" nor
// as "no header needed".
func TestRequireInternalSecretRejectsEverythingWhenUnconfigured(t *testing.T) {
	h := newProtectedHandler("")
	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	req.Header.Set("X-Internal-Secret", "")
	rec := httptest.NewRecorder()

	h(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d (empty configured secret must reject, not accept, every request)", rec.Code, http.StatusForbidden)
	}
}
