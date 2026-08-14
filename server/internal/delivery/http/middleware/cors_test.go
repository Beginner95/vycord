package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Electron грузит прод-сборку через loadFile ("file://"), и браузер отправляет
// такой запрос с заголовком Origin: null. Сервер должен разрешать этот origin,
// иначе fetch() в клиенте падает с "TypeError: Failed to fetch" (GlitchTip issue #38).
func TestCORS_AllowsElectronFileOrigin(t *testing.T) {
	cors := DefaultCORS()
	handler := cors.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/servers", nil)
	req.Header.Set("Origin", "null")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "null" {
		t.Fatalf("expected Access-Control-Allow-Origin: null, got %q", got)
	}
}

func TestCORS_PreflightAllowsElectronFileOrigin(t *testing.T) {
	cors := DefaultCORS()
	handler := cors.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("preflight OPTIONS request should not reach the next handler")
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/servers", nil)
	req.Header.Set("Origin", "null")
	req.Header.Set("Access-Control-Request-Method", "GET")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "null" {
		t.Fatalf("expected Access-Control-Allow-Origin: null on preflight, got %q", got)
	}
}
