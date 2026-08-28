package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// Регрессия на дыру в доступе: FileServer, укоренённый в UploadDir, раздавал
// весь каталог, включая attachments/, — в обход подписанных ссылок и с
// Content-Type по расширению пользовательского имени файла.
func TestUploadsHandlerHidesAttachments(t *testing.T) {
	dir := t.TempDir()
	writeUpload(t, dir, "attachments/ch/evil.html", "<script>alert(1)</script>")
	writeUpload(t, dir, "avatars/me.png", "png-bytes")
	writeUpload(t, dir, "server-icons/s.png", "png-bytes")
	writeUpload(t, dir, "stickers/st.png", "png-bytes")
	writeUpload(t, dir, "secret.txt", "top secret")

	h := newUploadsHandler(dir)

	tests := []struct {
		path string
		want int
	}{
		{"/uploads/attachments/ch/evil.html", http.StatusNotFound},
		{"/uploads/attachments/", http.StatusNotFound},
		{"/uploads/secret.txt", http.StatusNotFound},
		// Обход белого списка через ведущий слэш или обратный шаг тоже закрыт.
		{"/uploads//attachments/ch/evil.html", http.StatusNotFound},
		{"/uploads/avatars/../attachments/ch/evil.html", http.StatusNotFound},
		{"/uploads/avatars/me.png", http.StatusOK},
		{"/uploads/server-icons/s.png", http.StatusOK},
		{"/uploads/stickers/st.png", http.StatusOK},
		// Публичный префикс не отменяет отсутствия файла.
		{"/uploads/avatars/nope.png", http.StatusNotFound},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, tt.path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != tt.want {
			t.Errorf("GET %s = %d, want %d", tt.path, rec.Code, tt.want)
		}
	}
}

func writeUpload(t *testing.T, dir, key, body string) {
	t.Helper()
	path := filepath.Join(dir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
