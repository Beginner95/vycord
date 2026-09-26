package handler

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	wantFirst := backgroundItem{ID: "alps", Name: "alps", URL: "/backgrounds/alps/file"}
	got := body.Backgrounds[0]
	if got != wantFirst {
		t.Fatalf("first = %+v, want %+v", got, wantFirst)
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
