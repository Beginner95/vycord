package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
)

// backgroundExts — допустимые расширения картинок-фонов. Путь к файлу — только
// из имени id, которое берётся из каталога, поэтому расширение не исполняется
// как код; фильтр здесь для чистоты списка.
var backgroundExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
}

type backgroundItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

// BackgroundHandler отдаёт список виртуальных фонов и их файлы из каталога.
// Списка на диске нет — каталог сканируется при каждом запросе, поэтому
// добавление файла не требует рестарта и не имеет состояния для очистки.
type BackgroundHandler struct {
	dir    string
	prefix string
	log    *slog.Logger
}

func NewBackgroundHandler(dir, prefix string, log *slog.Logger) *BackgroundHandler {
	return &BackgroundHandler{dir: dir, prefix: strings.TrimSuffix(prefix, "/"), log: log}
}

// ListBackgrounds отдаёт JSON {"backgrounds":[{id,name,url}]}, отсортированный
// по id. Пустой/отсутствующий каталог даёт пустой список, а не ошибку: клиент
// должен показать «фонов нет», а не падать.
func (h *BackgroundHandler) ListBackgrounds(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(h.dir)
	if err != nil {
		if os.IsNotExist(err) {
			h.sendJSON(w, http.StatusOK, map[string]any{"backgrounds": []backgroundItem{}})
			return
		}
		h.log.Error("backgrounds dir read failed",
			"request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
		return
	}
	items := make([]backgroundItem, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !backgroundExts[strings.ToLower(filepath.Ext(e.Name()))] {
			continue
		}
		id := strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
		items = append(items, backgroundItem{ID: id, Name: id, URL: h.prefix + "/" + id + "/file"})
	}
	sort.Slice(items, func(i, j int) bool {
		return strings.ToLower(items[i].ID) < strings.ToLower(items[j].ID)
	})
	h.sendJSON(w, http.StatusOK, map[string]any{"backgrounds": items})
}

// resolvePath ищет в каталоге файл с именем "<id><допустимое расширение>".
// Для картинки расширение извне неизвестно, поэтому перебираем каталог; это же
// делает подмену невозможной: путь всегда строится из имени реального файла.
func (h *BackgroundHandler) resolvePath(id string) (string, bool) {
	if id == "" || strings.ContainsAny(id, `/\`) {
		return "", false
	}
	entries, err := os.ReadDir(h.dir)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !backgroundExts[strings.ToLower(filepath.Ext(name))] {
			continue
		}
		if strings.TrimSuffix(name, filepath.Ext(name)) == id {
			abs, err := filepath.Abs(filepath.Join(h.dir, name))
			if err != nil {
				return "", false
			}
			return abs, true
		}
	}
	return "", false
}

// ServeFile отдаёт файл фона по id. Публичный маршрут: <img src> не умеет
// слать Authorization (тот же резон, что у /uploads/). CORS-заголовки ставятся
// на каждый ответ: движок фона грузит картинку в canvas через
// <img crossorigin="anonymous">, и закешированная копия без ACAO (например,
// от миниатюр галереи) блокировала бы canvas-загрузку. Файлы публичные,
// без credentials — подходит "*".
func (h *BackgroundHandler) ServeFile(w http.ResponseWriter, r *http.Request) {
	path, ok := h.resolvePath(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Vary", "Origin")
	http.ServeFile(w, r, path)
}

func (h *BackgroundHandler) sendJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (h *BackgroundHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
