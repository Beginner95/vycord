package handler

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func newTestBackgroundHandler(t *testing.T) (*BackgroundHandler, string) {
	t.Helper()
	dir := t.TempDir()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewBackgroundHandler(dir, "/backgrounds", log), dir
}

func writeBgFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestListBackgrounds(t *testing.T) {
	h, dir := newTestBackgroundHandler(t)
	writeBgFile(t, dir, "ocean.png", "png")
	writeBgFile(t, dir, "alps.jpg", "jpg")
	writeBgFile(t, dir, "town.webp", "webp")
	writeBgFile(t, dir, "notes.txt", "not an image")
	writeBgFile(t, dir, "JOE.PNG", "upper")

	rec := httptest.NewRecorder()
	h.ListBackgrounds(rec, httptest.NewRequest(http.MethodGet, "/api/v1/backgrounds", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Backgrounds []backgroundItem `json:"backgrounds"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Backgrounds) != 4 {
		t.Fatalf("items = %d, want 4 (notes.txt отфильтрован)", len(body.Backgrounds))
	}
	want := []backgroundItem{
		{ID: "alps", Name: "alps", URL: "/backgrounds/alps/file"},
		{ID: "JOE", Name: "JOE", URL: "/backgrounds/JOE/file"},
		{ID: "ocean", Name: "ocean", URL: "/backgrounds/ocean/file"},
		{ID: "town", Name: "town", URL: "/backgrounds/town/file"},
	}
	if !reflect.DeepEqual(body.Backgrounds, want) {
		t.Fatalf("items = %+v, want %+v", body.Backgrounds, want)
	}
}

func TestListBackgroundsEmptyDir(t *testing.T) {
	h, _ := newTestBackgroundHandler(t)
	rec := httptest.NewRecorder()
	h.ListBackgrounds(rec, httptest.NewRequest(http.MethodGet, "/api/v1/backgrounds", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"backgrounds":[]`) {
		t.Fatalf("body = %s, want empty list", rec.Body.String())
	}
}

func TestListBackgroundsMissingDir(t *testing.T) {
	h, _ := newTestBackgroundHandler(t)
	h.dir = filepath.Join(t.TempDir(), "не-существует")
	rec := httptest.NewRecorder()
	h.ListBackgrounds(rec, httptest.NewRequest(http.MethodGet, "/api/v1/backgrounds", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestServeFile(t *testing.T) {
	h, dir := newTestBackgroundHandler(t)
	writeBgFile(t, dir, "ocean.png", "png-bytes")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/backgrounds/ocean/file", nil)
	req.SetPathValue("id", "ocean")
	h.ServeFile(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "png-bytes" {
		t.Fatalf("body = %q, want png-bytes", rec.Body.String())
	}
}

// VYC-100: файл фона рисуется в canvas движка через <img crossorigin> —
// браузер требует CORS даже для публичного файла. ACAO: * на КАЖДОМ ответе
// (не только на CORS-запросах), чтобы закешированная копия с маршрута —
// например, от миниатюр галереи — не пережила перезапуск без заголовка и не
// заблокировала canvas-загрузку («No 'Access-Control-Allow-Origin' header»).
func TestServeFileSetsCorsHeaders(t *testing.T) {
	h, dir := newTestBackgroundHandler(t)
	writeBgFile(t, dir, "ocean.png", "png-bytes")

	for _, origin := range []string{"", "http://localhost:3000", "https://front.vycord.webvaha.ru", "null"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/backgrounds/ocean/file", nil)
		req.SetPathValue("id", "ocean")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		h.ServeFile(rec, req)

		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
			t.Fatalf("origin %q: Access-Control-Allow-Origin = %q, want *", origin, got)
		}
		if got := rec.Header().Get("Vary"); !strings.Contains(got, "Origin") {
			t.Fatalf("origin %q: Vary = %q, want to contain Origin", origin, got)
		}
	}
}

func TestServeFileDottedId(t *testing.T) {
	h, dir := newTestBackgroundHandler(t)
	writeBgFile(t, dir, "city.night.png", "night-bytes")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/backgrounds/city.night/file", nil)
	req.SetPathValue("id", "city.night")
	h.ServeFile(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "night-bytes" {
		t.Fatalf("body = %q, want night-bytes", rec.Body.String())
	}
}

func TestServeFileNotFound(t *testing.T) {
	h, _ := newTestBackgroundHandler(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/backgrounds/nope/file", nil)
	req.SetPathValue("id", "nope")
	h.ServeFile(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestServeFileTraversalRejected(t *testing.T) {
	h, dir := newTestBackgroundHandler(t)
	writeBgFile(t, dir, "ocean.png", "png")

	for _, id := range []string{"..", "../secrets", ".", "ocean.png"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/backgrounds/x/file", nil)
		req.SetPathValue("id", id)
		h.ServeFile(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("id %q: status = %d, want 404", id, rec.Code)
		}
	}
}
